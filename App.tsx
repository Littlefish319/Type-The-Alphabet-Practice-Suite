
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { View, GameMode, LocalData, Settings, GameState, Run, TimingLogEntry, FingeringDataItem, ChatMessage, ProfileSettings, FingerPattern, MistakeLogEntry, SpecializedPracticeSettings } from './types';
import { STORAGE_KEY, MAX_ENTRIES, ALPHABET, FINGERING_DATA, TONY_GROUPS_ROW1, TONY_GROUPS_ROW2, INITIAL_GAME_STATE, DEFAULT_LOCAL_DATA, DEFAULT_SETTINGS, getTargetSequence } from './constants';
import { getCoachingTip } from './services/geminiService';

// --- AUDIO UTILS ---
let synth: any = null;
let audioContextReady = false;

const ensureAudioContext = async () => {
    if (!audioContextReady && (window as any).Tone) {
        await (window as any).Tone.start();
        synth = new (window as any).Tone.PolySynth((window as any).Tone.Synth).toDestination();
        synth.volume.value = -10;
        audioContextReady = true;
        console.log("Audio context ready.");
    }
};

const playSound = (type: 'type' | 'error' | 'win' | 'count', soundEnabled: boolean) => {
    if (!soundEnabled || !audioContextReady || !synth) return;
    try {
        if (type === 'type') synth.triggerAttackRelease("C5", "64n");
        if (type === 'error') synth.triggerAttackRelease("A2", "16n");
        if (type === 'win') synth.triggerAttackRelease(["C4", "E4", "G4", "C5"], "8n");
        if (type === 'count') synth.triggerAttackRelease("G3", "8n");
    } catch (e) {
        console.error("Tone.js error:", e);
    }
};

const speak = (text: string, soundEnabled: boolean, voiceEnabled: boolean) => {
    if (!soundEnabled || !voiceEnabled || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.2;
    window.speechSynthesis.speak(u);
};

// --- HELPER COMPONENTS ---

interface LetterBoxProps {
    data: FingeringDataItem;
    index: number;
    currentIndex: number;
    showFingering: boolean;
    isCorrect: boolean;
}
const LetterBox: React.FC<LetterBoxProps> = React.memo(({ data, index, currentIndex, showFingering, isCorrect }) => {
    const isCurrent = index === currentIndex;
    let boxClass = "letter-box bg-white dark:bg-slate-700 text-slate-300 dark:text-slate-600 border border-slate-200 dark:border-slate-600 shadow-sm";

    if (isCorrect) {
        boxClass = "letter-box bg-green-500 border-green-600 text-white";
    } else if (isCurrent) {
        boxClass = "letter-box bg-blue-500 border-blue-600 text-white scale-110 shadow-lg z-10";
    }

    const displayChar = data.char === ' ' ? '␣' : data.char.toUpperCase();

    return (
        <div id={`letter-${index}`} className={boxClass}>
            <span className="letter-box-content">{displayChar}</span>
            {showFingering && (
                <div className={`fingering-badge ${data.code.startsWith('L') ? 'fingering-L' : (data.code.startsWith('R') ? 'fingering-R' : 'bg-slate-500 text-white')}`}>
                    {data.code}
                </div>
            )}
        </div>
    );
});


const App: React.FC = () => {
    const [localData, setLocalData] = useState<LocalData>(DEFAULT_LOCAL_DATA);
    const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
    const [view, setView] = useState<View>('practice');
    const [gameState, setGameState] = useState<GameState>(INITIAL_GAME_STATE);
    const [currentTime, setCurrentTime] = useState(0);
    const [isError, setIsError] = useState(false);

    const [resultsModalOpen, setResultsModalOpen] = useState(false);
    const [managementModalOpen, setManagementModalOpen] = useState(false);
    const [runNote, setRunNote] = useState("");
    const [completedRun, setCompletedRun] = useState<Run | null>(null);
    const [postRunAnalysis, setPostRunAnalysis] = useState<string[]>([]);
    const [historySort, setHistorySort] = useState<{ key: 'timestamp' | 'time'; direction: 'asc' | 'desc' }>({ key: 'timestamp', direction: 'desc' });

    const [countdown, setCountdown] = useState<string | null>(null);
    const [flashEffect, setFlashEffect] = useState(false);

    const isAiAvailable = Boolean(import.meta.env.VITE_GEMINI_API_KEY);

    const alphaLetters = useMemo(() => ALPHABET.split(''), []);
    const tonyFingeringMap = useMemo<Record<string, string>>(() => {
        const map: Record<string, string> = {};
        for (const item of FINGERING_DATA) map[item.char] = item.code;
        return map;
    }, []);

    const selectedFingerPattern = useMemo<FingerPattern | null>(() => {
        const patterns = localData.fingerPatterns || [];
        const id = localData.selectedFingerPatternId;
        if (!id) return null;
        return patterns.find(p => p.id === id) || null;
    }, [localData.fingerPatterns, localData.selectedFingerPatternId]);

    const activeFingeringMap = useMemo<Record<string, string>>(() => {
        return selectedFingerPattern?.map || tonyFingeringMap;
    }, [selectedFingerPattern, tonyFingeringMap]);

    const specializedPractice = settings.specializedPractice;

    // AI Coach State
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
        { sender: 'ai', text: "I'm your coach. Ask me 'What are my slowest letters?' or 'How can I practice faster?'" }
    ]);
    const [chatInput, setChatInput] = useState("");
    const [isCoachLoading, setIsCoachLoading] = useState(false);

    const timerIntervalRef = useRef<number | null>(null);
    const hiddenInputRef = useRef<HTMLInputElement>(null);
    const blankInputRef = useRef<HTMLTextAreaElement>(null);
    const runNoteRef = useRef<HTMLTextAreaElement>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);

    // --- TARGET SEQUENCE ---
    const targetSequence = useMemo(
        () => getTargetSequence(settings.mode, specializedPractice),
        [settings.mode, specializedPractice]
    );

    // --- DATA & SETTINGS PERSISTENCE ---
    useEffect(() => {
        try {
            const storedData = localStorage.getItem(STORAGE_KEY);
            if (storedData) {
                const parsed = JSON.parse(storedData);
                if (parsed.localData && !parsed.localData.profileSettings) {
                    const newProfileSettings: { [key: string]: ProfileSettings } = {};
                    parsed.localData.profiles.forEach((p: string) => {
                        newProfileSettings[p] = {
                            tonysRhythm: parsed.settings?.tonysRhythm || false,
                            fingering: parsed.settings?.fingering || false
                        };
                    });
                    parsed.localData.profileSettings = newProfileSettings;
                }
                if (parsed.settings && typeof parsed.settings.sound === 'undefined') {
                    parsed.settings.sound = true;
                }

                if (parsed.settings && !parsed.settings.specializedPractice) {
                    parsed.settings.specializedPractice = DEFAULT_SETTINGS.specializedPractice;
                }

                if (parsed.localData) {
                    if (!parsed.localData.fingerPatterns) parsed.localData.fingerPatterns = [];
                    if (typeof parsed.localData.selectedFingerPatternId === 'undefined') parsed.localData.selectedFingerPatternId = null;
                }

                setLocalData(parsed.localData || DEFAULT_LOCAL_DATA);
                setSettings(parsed.settings || DEFAULT_SETTINGS);
            }
        } catch (e) {
            console.error("Failed to load data from localStorage", e);
        }
    }, []);

    useEffect(() => {
        try {
            const dataToStore = { localData, settings };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToStore));
        } catch (e) {
            console.error("Failed to save data to localStorage", e);
        }
    }, [localData, settings]);
    
    // --- UI COMPUTATIONS ---
    const currentProfileSettings = useMemo(() => {
        return localData.profileSettings?.[localData.currentProfile] || { tonysRhythm: false, fingering: false };
    }, [localData.currentProfile, localData.profileSettings]);

    // --- FOCUS MANAGEMENT ---
    const focusCorrectInput = useCallback(() => {
        if (resultsModalOpen) {
            runNoteRef.current?.focus();
        } else if (view === 'practice') {
            if (settings.mode === 'blank') {
                blankInputRef.current?.focus();
            } else {
                hiddenInputRef.current?.focus();
            }
        }
    }, [view, settings.mode, resultsModalOpen]);

    const requestKeyboard = useCallback(() => {
        if (resultsModalOpen || managementModalOpen) return;
        if (view !== 'practice') return;

        if (settings.mode === 'blank') {
            blankInputRef.current?.focus();
            return;
        }

        const el = hiddenInputRef.current;
        if (!el) return;

        try {
            // iOS/WKWebView can be picky; a direct + deferred focus helps.
            (el as any).focus?.({ preventScroll: true });
        } catch {
            el.focus();
        }
        el.click();
        window.setTimeout(() => {
            try {
                (el as any).focus?.({ preventScroll: true });
            } catch {
                el.focus();
            }
        }, 0);
    }, [blankInputRef, hiddenInputRef, managementModalOpen, resultsModalOpen, settings.mode, view]);

    useEffect(() => {
       focusCorrectInput();
    }, [focusCorrectInput]);

    // --- GAME LOGIC ---

    const resetGame = useCallback((newMode?: GameMode) => {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        setGameState(INITIAL_GAME_STATE);
        setCurrentTime(0);
        setResultsModalOpen(false);
        setRunNote("");
        setCountdown(null);
        setCompletedRun(null);
        setPostRunAnalysis([]);
        if (newMode) {
             setSettings(s => ({...s, mode: newMode}));
        }
        setTimeout(focusCorrectInput, 50);
    }, [focusCorrectInput]);

    const beginRun = useCallback((processFirstKey: boolean = false) => {
        const now = performance.now();
        let initialState: GameState = {
            ...INITIAL_GAME_STATE,
            started: true,
            startTime: now,
            lastTime: now,
        };

        if (processFirstKey) {
            playSound('type', settings.sound);
            initialState = {
                ...initialState,
                index: 1,
                timingLog: [{ char: targetSequence[0], duration: 0, total: 0, prev: '' }]
            };
        }
        
        setGameState(initialState);

        timerIntervalRef.current = window.setInterval(() => {
            setCurrentTime((performance.now() - now) / 1000);
        }, 30);
    }, [settings.sound, targetSequence]);


    const startGameSequence = useCallback(async () => {
        const steps = ["3", "2", "1"];
        for (const step of steps) {
            setCountdown(step);
            speak(step, settings.sound, settings.voice);
            playSound('count', settings.sound);
            await new Promise(r => setTimeout(r, 1000));
        }
        
        beginRun(false);
        setCountdown("GO!");
        speak("GO!", settings.sound, settings.voice);
        playSound('count', settings.sound);
        setTimeout(() => setCountdown(null), 400);
    }, [beginRun, settings.sound, settings.voice]);

    const generatePostRunAnalysis = (run: Run, history: Run[]): string[] => {
        const analysis: string[] = [];
        const relevantHistory = history.filter(r => r.profile === run.profile && r.device === run.device && r.mode === run.mode);
        const times = relevantHistory.map(r => r.time).sort((a,b) => a - b);
        
        const rank = times.findIndex(t => run.time <= t);

        if (rank === 0 && run.time < (times[1] ?? Infinity)) {
            analysis.push("🚀 New Personal Best!");
        } else if (rank === -1) {
            analysis.push(`Your ${times.length + 1}${['st', 'nd', 'rd'][times.length] || 'th'} fastest run.`);
        } else {
             analysis.push(`Your ${rank + 1}${['st', 'nd', 'rd'][rank] || 'th'} fastest run.`);
        }

        if (run.log.length > 1) {
            const sortedLog = [...run.log].slice(1).sort((a,b) => b.duration - a.duration);
            const slowest = sortedLog[0];
            const fastest = sortedLog[sortedLog.length - 1];
            analysis.push(`🐌 Slowest: ${slowest.prev === ' ' ? 'Space' : slowest.prev.toUpperCase()} → ${slowest.char === ' ' ? 'Space' : slowest.char.toUpperCase()} (${slowest.duration.toFixed(3)}s)`);
            analysis.push(`⚡️ Fastest: ${fastest.prev === ' ' ? 'Space' : fastest.prev.toUpperCase()} → ${fastest.char === ' ' ? 'Space' : fastest.char.toUpperCase()} (${fastest.duration.toFixed(3)}s)`);
        }
        
        return analysis;
    };

    const endGame = useCallback((finalTime: number, finalLog: TimingLogEntry[]) => {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        
        setGameState(gs => ({...gs, finished: true }));
        setCurrentTime(finalTime);

        const newRun: Run = {
            time: finalTime,
            mistakes: gameState.mistakes,
            mode: settings.mode,
            profile: localData.currentProfile,
            device: localData.currentDevice,
            blind: settings.blind,
            note: "", 
            timestamp: Date.now(),
            log: finalLog,
            mistakeLog: gameState.mistakeLog,
            specialized: specializedPractice,
        };
        setCompletedRun(newRun);
        setPostRunAnalysis(generatePostRunAnalysis(newRun, localData.history));

        if (settings.mode === 'guinness') {
            setFlashEffect(true);
            setTimeout(() => setFlashEffect(false), 500);
        }
        
        const timeSpeech = finalTime.toFixed(2).replace('.', ' point ');
        speak(`Done! Time is ${timeSpeech} seconds, with ${gameState.mistakes} mistakes.`, settings.sound, settings.voice);
        playSound('win', settings.sound);
        
        setResultsModalOpen(true);
    }, [gameState.mistakeLog, localData, settings, gameState.mistakes, specializedPractice]);


    // --- EVENT HANDLERS ---
    const saveCurrentRun = useCallback(() => {
        if (!completedRun) return;
        const runToSave = { ...completedRun, note: runNote };
        setLocalData(d => ({...d, history: [runToSave, ...d.history].slice(0, 1000)}));
    }, [completedRun, runNote]);

    const processTypedKey = useCallback((key: string) => {
        if (managementModalOpen || resultsModalOpen) return;
        if (gameState.finished) return;
        if (countdown && countdown !== "GO!") return;
        if (settings.mode === 'blank') return;

        if (!/^[a-z ]$/.test(key)) return;

        if (!gameState.started) {
            if (key === targetSequence[0]) {
                if (settings.mode === 'guinness') {
                    startGameSequence();
                } else {
                    beginRun(true);
                }
            }
            return;
        }

        const target = targetSequence[gameState.index];
        if (key === target) {
            playSound('type', settings.sound);
            const now = performance.now();
            const duration = (now - gameState.lastTime) / 1000;
            const total = (now - gameState.startTime) / 1000;

            const newLogEntry: TimingLogEntry = {
                char: target,
                duration,
                total,
                prev: gameState.index > 0 ? targetSequence[gameState.index - 1] : ''
            };

            const nextIndex = gameState.index + 1;
            const newLog = [...gameState.timingLog, newLogEntry];

            setGameState(gs => ({
                ...gs,
                index: nextIndex,
                lastTime: now,
                timingLog: newLog
            }));

            if (nextIndex >= targetSequence.length) {
                endGame(total, newLog);
            }
        } else {
            playSound('error', settings.sound);
            setGameState(gs => ({
                ...gs,
                mistakes: gs.mistakes + 1,
                mistakeLog: [...gs.mistakeLog, { target: targetSequence[gs.index], typed: key } as MistakeLogEntry]
            }));
            setIsError(true);
            setTimeout(() => setIsError(false), 300);
        }
    }, [
        beginRun,
        countdown,
        endGame,
        gameState,
        managementModalOpen,
        resultsModalOpen,
        settings.mode,
        settings.sound,
        startGameSequence,
        targetSequence
    ]);

    const handleHiddenInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        if (!raw) return;

        const value = raw.toLowerCase();
        for (const ch of value) {
            if (ch === '\n' || ch === '\r' || ch === '\t') continue;
            processTypedKey(ch);
        }

        e.target.value = '';
    }, [processTypedKey]);

    const handleKeydown = useCallback((e: KeyboardEvent) => {
        if (managementModalOpen || resultsModalOpen) return;

        const key = e.key.toLowerCase();

        if (e.key === 'Enter') {
            e.preventDefault();
            resetGame();
            return;
        }
        
        if (gameState.finished) return; 

        if (countdown && countdown !== "GO!") return;
        
        if (settings.mode === 'blank') return; 
        if (!/^[a-z ]$/.test(key)) return;

        e.preventDefault();
        processTypedKey(key);
    }, [
        gameState, settings, localData, targetSequence,
        countdown, managementModalOpen, resultsModalOpen,
        beginRun, endGame, resetGame, startGameSequence,
        processTypedKey
    ]);
    
    const handleBlankInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value.toLowerCase();
        if (gameState.finished) return;

        const expectedFull = targetSequence.join('');

        if (!gameState.started) {
            if (value.startsWith(targetSequence[0])) {
                beginRun(true);
            } else {
                e.target.value = '';
                return;
            }
        }
        
        const lastTypedChar = value.slice(-1);
        const currentIndex = value.length - 1;

        if (currentIndex >= targetSequence.length) return;

        const expectedChar = targetSequence[currentIndex];

        if(lastTypedChar === expectedChar) {
             playSound('type', settings.sound);
             const now = performance.now();
             const duration = (now - gameState.lastTime) / 1000;
             const total = (now - gameState.startTime) / 1000;
             
             const newLogEntry: TimingLogEntry = {
                 char: expectedChar,
                 duration,
                 total,
                 prev: currentIndex > 0 ? targetSequence[currentIndex - 1] : ''
             };
             
             const newLog = [...gameState.timingLog, newLogEntry];
             
             setGameState(gs => ({
                 ...gs,
                 index: currentIndex + 1,
                 lastTime: now,
                 timingLog: newLog
             }));

             if(value === expectedFull) {
                 endGame(total, newLog);
             }

        } else if (value.length > gameState.index) {
            playSound('error', settings.sound);
            setGameState(gs => ({
                ...gs,
                mistakes: gs.mistakes + 1,
                mistakeLog: [...gs.mistakeLog, { target: expectedChar, typed: lastTypedChar }]
            }));
            setIsError(true);
            setTimeout(() => setIsError(false), 300);
        }
    };

    // --- GLOBAL LISTENERS ---
    useEffect(() => {
        window.addEventListener('keydown', handleKeydown);
        return () => window.removeEventListener('keydown', handleKeydown);
    }, [handleKeydown]);
    
    useEffect(() => {
        document.body.addEventListener('click', ensureAudioContext, { once: true });
        return () => document.body.removeEventListener('click', ensureAudioContext);
    }, []);

    // --- UI COMPUTATIONS ---
    const deviceRecord = useMemo(() => {
        const bestTime = localData.history
            .filter(r => r.profile === localData.currentProfile && r.device === localData.currentDevice && r.mode === settings.mode)
            .reduce((min, r) => Math.min(min, r.time), Infinity);
        return bestTime === Infinity ? '--' : bestTime.toFixed(2);
    }, [localData, settings.mode]);
    
    const personalBestTime = useMemo(() => {
        const bestTime = localData.history
            .filter(r => r.profile === localData.currentProfile && r.device === localData.currentDevice && r.mode === settings.mode)
            .reduce((min, r) => Math.min(min, r.time), Infinity);
        return bestTime === Infinity ? null : bestTime;
    }, [localData, settings.mode]);

    const sortedHistory = useMemo(() => {
        return [...localData.history].sort((a, b) => {
            const valA = a[historySort.key];
            const valB = b[historySort.key];
            if (historySort.direction === 'asc') {
                return valA > valB ? 1 : -1;
            }
            return valB > valA ? 1 : -1;
        });
    }, [localData.history, historySort]);

    
    // --- MANAGEMENT MODAL LOGIC ---
    const [newProfile, setNewProfile] = useState("");
    const [newDevice, setNewDevice] = useState("");
    
    const addProfile = () => {
        const name = newProfile.trim();
        if(name && !localData.profiles.includes(name) && localData.profiles.length < MAX_ENTRIES){
            const newProfiles = [...localData.profiles, name];
            const newProfileSettings = {
                ...(localData.profileSettings || {}),
                [name]: { tonysRhythm: false, fingering: false }
            };
            setLocalData(d => ({...d, profiles: newProfiles, currentProfile: name, profileSettings: newProfileSettings}));
            setNewProfile("");
        }
    };
    
    const addDevice = () => {
        const name = newDevice.trim();
        if(name && !localData.devices.includes(name) && localData.devices.length < MAX_ENTRIES){
            const newDevices = [...localData.devices, name];
            setLocalData(d => ({...d, devices: newDevices, currentDevice: name}));
            setNewDevice("");
        }
    };
    
    const removeEntry = (type: 'profile' | 'device', value: string) => {
        if(type === 'profile'){
             if (localData.profiles.length <= 1) return;
            const newProfiles = localData.profiles.filter(p => p !== value);
            const newCurrentProfile = localData.currentProfile === value ? newProfiles[0] : localData.currentProfile;
            const newProfileSettings = {...localData.profileSettings};
            delete newProfileSettings[value];
            setLocalData(d => ({
                ...d, 
                profiles: newProfiles, 
                currentProfile: newCurrentProfile,
                history: d.history.filter(r => r.profile !== value),
                profileSettings: newProfileSettings
            }));
        } else {
             if (localData.devices.length <= 1) return;
            const newDevices = localData.devices.filter(d => d !== value);
            const newCurrentDevice = localData.currentDevice === value ? newDevices[0] : localData.currentDevice;
            setLocalData(d => ({
                ...d, 
                devices: newDevices, 
                currentDevice: newCurrentDevice,
                history: d.history.filter(r => r.device !== value)
            }));
        }
    };

    const deleteRun = (timestamp: number) => {
        setLocalData(d => ({
            ...d,
            history: d.history.filter(r => r.timestamp !== timestamp)
        }));
    };
    
    // AI COACH
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [chatHistory]);

    const handleSendChat = async () => {
        const msg = chatInput.trim();
        if(!msg || isCoachLoading) return;

        if (!isAiAvailable) {
            setChatHistory(h => [...h, { sender: 'user', text: msg }, { sender: 'ai', text: "Coming soon." }]);
            setChatInput("");
            return;
        }
        
        const newHistory: ChatMessage[] = [...chatHistory, { sender: 'user', text: msg }];
        setChatHistory(newHistory);
        setChatInput("");
        setIsCoachLoading(true);

        const analyticsDataLocal = getAnalyticsData();
        const slowestLetters = analyticsDataLocal.slowest.slice(0, 3).map(
            row => `${row.key} (${row.avg.toFixed(3)}s)`
        ).join(', ') || "No specific data yet. Suggest general technique.";

        const recentRuns = localData.history
            .filter(r => r.profile === localData.currentProfile && r.device === localData.currentDevice)
            .slice(0, 5)
            .map(r => `Time: ${r.time.toFixed(2)}s, Mode: ${r.mode}`)
            .join('; ');
        
        const fullPrompt = `You are an expert typing coach named 'Coach Gemini'. Help the user improve.
        Current Profile: ${localData.currentProfile}
        Device: ${localData.currentDevice}
        Slowest Transitions: ${slowestLetters}
        Recent History: ${recentRuns}
        Question: "${msg}"
        Response Format: Markdown with 'Quick Answer', 'Data Insight', and 'Actionable Tip'.`;

        const responseText = await getCoachingTip(fullPrompt);
        
        setChatHistory(h => [...h, { sender: 'ai', text: responseText }]);
        setIsCoachLoading(false);
    };

    const handleProfileSettingChange = (key: keyof ProfileSettings, value: boolean) => {
        setLocalData(d => {
            const newProfileSettings = {
                ...(d.profileSettings || {}),
                [d.currentProfile]: {
                    ...(d.profileSettings?.[d.currentProfile] || { tonysRhythm: false, fingering: false }),
                    [key]: value
                }
            };
            return { ...d, profileSettings: newProfileSettings };
        });
    };

    const getAnalyticsData = useCallback(() => {
        const filtered = localData.history.filter(r => 
            r.profile === localData.currentProfile && r.device === localData.currentDevice
        );
        
        const transitions: { [key: string]: number[] } = {};
        filtered.forEach(r => {
            r.log.forEach(l => {
                if (l.prev && l.char) {
                    const key = `${l.prev === ' ' ? 'Space' : l.prev.toUpperCase()} → ${l.char === ' ' ? 'Space' : l.char.toUpperCase()}`;
                    if (!transitions[key]) transitions[key] = [];
                    transitions[key].push(l.duration);
                }
            });
        });
        
        const sorted = Object.keys(transitions).map(k => ({
            key: k, 
            avg: transitions[k].reduce((a,b) => a + b, 0) / transitions[k].length
        })).sort((a,b) => b.avg - a.avg);

        return {
            slowest: sorted,
            fastest: [...sorted].reverse()
        };
    }, [localData]);

    const handleSort = (key: 'timestamp' | 'time') => {
        setHistorySort(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    const analyticsDataMemo = useMemo(() => getAnalyticsData(), [getAnalyticsData]);

    // --- FINGER PATTERNS ---
    const [patternEditorOpen, setPatternEditorOpen] = useState(false);
    const [patternEditorId, setPatternEditorId] = useState<string | null>(null);
    const [patternEditorName, setPatternEditorName] = useState('');
    const [patternEditorMap, setPatternEditorMap] = useState<Record<string, string>>({});

    const fingerOptions = useMemo(() => ([
        { value: 'L5', label: 'L Pinky (L5)' },
        { value: 'L4', label: 'L Ring (L4)' },
        { value: 'L3', label: 'L Middle (L3)' },
        { value: 'L2', label: 'L Index (L2)' },
        { value: 'L1', label: 'L Thumb (L1)' },
        { value: 'R1', label: 'R Thumb (R1)' },
        { value: 'R2', label: 'R Index (R2)' },
        { value: 'R3', label: 'R Middle (R3)' },
        { value: 'R4', label: 'R Ring (R4)' },
        { value: 'R5', label: 'R Pinky (R5)' },
        { value: 'T1', label: 'Thumbs/Other (T1)' },
        { value: '?', label: 'Unknown (?)' },
    ]), []);

    const openCreatePattern = () => {
        setPatternEditorId(null);
        setPatternEditorName("");
        setPatternEditorMap({ ...tonyFingeringMap });
        setPatternEditorOpen(true);
    };

    const openEditPattern = (pattern: FingerPattern) => {
        setPatternEditorId(pattern.id);
        setPatternEditorName(pattern.name);
        setPatternEditorMap({ ...pattern.map });
        setPatternEditorOpen(true);
    };

    const savePattern = () => {
        const name = patternEditorName.trim();
        if (!name) return;

        const now = Date.now();
        const id = patternEditorId || (globalThis.crypto?.randomUUID?.() ?? `fp_${now}_${Math.random().toString(16).slice(2)}`);
        const next: FingerPattern = {
            id,
            name,
            map: { ...patternEditorMap },
            createdAt: patternEditorId ? (localData.fingerPatterns?.find(p => p.id === patternEditorId)?.createdAt ?? now) : now,
            updatedAt: now,
        };

        setLocalData(d => {
            const patterns = d.fingerPatterns || [];
            const exists = patterns.some(p => p.id === id);
            const updatedPatterns = exists ? patterns.map(p => p.id === id ? next : p) : [next, ...patterns];
            return {
                ...d,
                fingerPatterns: updatedPatterns,
                selectedFingerPatternId: d.selectedFingerPatternId || null,
            };
        });

        setPatternEditorOpen(false);
        setPatternEditorId(null);
        setPatternEditorName("");
        setPatternEditorMap({});
    };

    const deletePattern = (id: string) => {
        if (!window.confirm('Delete this finger pattern?')) return;
        setLocalData(d => {
            const patterns = (d.fingerPatterns || []).filter(p => p.id !== id);
            const selected = d.selectedFingerPatternId === id ? null : d.selectedFingerPatternId;
            return { ...d, fingerPatterns: patterns, selectedFingerPatternId: selected };
        });
    };

    const selectPattern = (idOrNull: string | null) => {
        setLocalData(d => ({ ...d, selectedFingerPatternId: idOrNull }));
    };

    const renderPatternTemplate = (map: Record<string, string>) => {
        const renderGroup = (letters: string[]) => (
            <div className="flex flex-wrap items-center gap-2 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2">
                {letters.map(ch => (
                    <div key={ch} className="flex items-center gap-2 px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                        <span className="font-mono font-black text-slate-800 dark:text-white">{ch.toUpperCase()}</span>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${((map[ch] || '?').startsWith('L')) ? 'fingering-badge fingering-L' : ((map[ch] || '?').startsWith('R') ? 'fingering-badge fingering-R' : 'bg-slate-500 text-white')}`}>{map[ch] || '?'}</span>
                    </div>
                ))}
            </div>
        );

        return (
            <div className="space-y-3">
                <div className="flex flex-wrap gap-3">{TONY_GROUPS_ROW1.map((g, idx) => <div key={`r1_${idx}`}>{renderGroup(g)}</div>)}</div>
                <div className="flex flex-wrap gap-3">{TONY_GROUPS_ROW2.map((g, idx) => <div key={`r2_${idx}`}>{renderGroup(g)}</div>)}</div>
            </div>
        );
    };

    // --- SPECIALIZED PRACTICE STATS (CURRENT RUN) ---
    const specializedRangeLetters = useMemo(() => {
        if (!specializedPractice?.enabled) return [] as string[];
        const start = (specializedPractice.start || 'a').toLowerCase();
        const end = (specializedPractice.end || 'z').toLowerCase();
        const startIdx = alphaLetters.indexOf(start);
        const endIdx = alphaLetters.indexOf(end);
        if (startIdx === -1 || endIdx === -1) return [] as string[];
        const a = Math.min(startIdx, endIdx);
        const b = Math.max(startIdx, endIdx);
        return alphaLetters.slice(a, b + 1);
    }, [alphaLetters, specializedPractice]);

    const currentRunLetterStats = useMemo(() => {
        if (!specializedPractice?.enabled) return [] as Array<{ letter: string; attempts: number; correct: number; mistakes: number; accuracy: number; avg: number | null; }>;

        const durationsByLetter: Record<string, number[]> = {};
        for (const l of specializedRangeLetters) durationsByLetter[l] = [];

        for (const entry of gameState.timingLog) {
            const ch = entry.char;
            if (!durationsByLetter[ch]) continue;
            if (!entry.prev) continue; // skip first (0s) entry
            if (entry.duration <= 0) continue;
            durationsByLetter[ch].push(entry.duration);
        }

        const mistakesByTarget: Record<string, number> = {};
        for (const l of specializedRangeLetters) mistakesByTarget[l] = 0;
        for (const m of gameState.mistakeLog) {
            if (typeof mistakesByTarget[m.target] === 'number') mistakesByTarget[m.target] += 1;
        }

        return specializedRangeLetters.map(letter => {
            const correct = durationsByLetter[letter]?.length || 0;
            const mistakes = mistakesByTarget[letter] || 0;
            const attempts = correct + mistakes;
            const avg = correct > 0 ? (durationsByLetter[letter].reduce((a, b) => a + b, 0) / correct) : null;
            const accuracy = attempts > 0 ? (correct / attempts) : 0;
            return { letter, attempts, correct, mistakes, accuracy, avg };
        });
    }, [gameState.mistakeLog, gameState.timingLog, specializedPractice, specializedRangeLetters]);


    return (
        <>
        {flashEffect && <div id="flash-overlay" className="fixed inset-0 z-[100] animate-flash"></div>}

        <div className="w-full max-w-6xl bg-white dark:bg-slate-900 shadow-2xl rounded-2xl p-4 sm:p-6 md:p-8 mt-4 border border-slate-200 dark:border-slate-800">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 border-b border-slate-100 dark:border-slate-700 pb-4">
                <div>
                    <h1 className="text-2xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-cyan-500">
                        Alphabet Typing Suite
                    </h1>
                </div>
                <div className="flex flex-wrap gap-3 items-center">
                    <div className="relative">
                        <select value={localData.currentProfile} onChange={e => setLocalData({...localData, currentProfile: e.target.value})} className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-white text-sm font-bold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 outline-none appearance-none pr-8 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition w-32">
                            {localData.profiles.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                         <div className="absolute right-2 top-1/2 transform -translate-y-1/2 pointer-events-none text-slate-400 text-xs">▼</div>
                    </div>
                    <div className="relative">
                        <select value={localData.currentDevice} onChange={e => setLocalData({...localData, currentDevice: e.target.value})} className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-white text-sm font-bold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 outline-none appearance-none pr-8 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition w-32">
                             {localData.devices.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                         <div className="absolute right-2 top-1/2 transform -translate-y-1/2 pointer-events-none text-slate-400 text-xs">▼</div>
                    </div>
                     <button onClick={() => setManagementModalOpen(true)} className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-bold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition">
                        Manage Lists
                    </button>
                </div>
            </div>

            {/* Main Navigation Tabs */}
            <div className="flex overflow-x-auto gap-6 mb-6 text-sm font-bold uppercase tracking-wide">
                <button onClick={() => setView('practice')} className={view === 'practice' ? 'active-tab pb-2' : 'inactive-tab pb-2 hover:text-blue-500 transition'}>Practice & Record</button>
                <button onClick={() => setView('fingerPatterns')} className={view === 'fingerPatterns' ? 'active-tab pb-2' : 'inactive-tab pb-2 hover:text-blue-500 transition'}>Finger Pattern Practice</button>
                <button onClick={() => setView('analytics')} className={view === 'analytics' ? 'active-tab pb-2' : 'inactive-tab pb-2 hover:text-blue-500 transition'}>Analytics & Coach</button>
                <button onClick={() => setView('history')} className={view === 'history' ? 'active-tab pb-2' : 'inactive-tab pb-2 hover:text-blue-500 transition'}>Run History</button>
                <button onClick={() => setView('about')} className={view === 'about' ? 'active-tab pb-2' : 'inactive-tab pb-2 hover:text-blue-500 transition'}>About</button>
            </div>
            
             {/* Views */}
            <div className={view !== 'practice' ? 'hidden' : ''}>
                {/* PRACTICE VIEW */}
                <div className="flex flex-wrap justify-center gap-2 mb-6 bg-slate-100 dark:bg-slate-800 p-2 rounded-xl inline-flex w-full overflow-x-auto">
                    {(['classic', 'backwards', 'spaces', 'backwards-spaces', 'blank', 'flash', 'guinness'] as GameMode[]).map(m => (
                        <button key={m} onClick={() => resetGame(m)} className={`flex-none px-4 py-2 rounded-lg text-[11px] font-bold transition ${settings.mode === m ? 'bg-white dark:bg-slate-700 shadow text-blue-600 dark:text-blue-300 scale-105' : 'text-slate-500 hover:bg-white/50'}`}>
                             {m.includes('backwards') ? (m.includes('spaces') ? 'Z Y X' : 'Z-A') : m.includes('spaces') ? 'A B C' : <span className="capitalize">{m} {m==='blank' ? 'Typing' : m==='flash' ? 'Flash' : 'Grid' }</span>}
                        </button>
                    ))}
                </div>
                
                <div className="flex flex-wrap justify-center gap-4 mb-8 text-sm">
                   {['classic', 'guinness', 'backwards', 'spaces', 'backwards-spaces'].includes(settings.mode) && 
                        <label className="flex items-center gap-2 cursor-pointer bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                            <input type="checkbox" checked={currentProfileSettings.tonysRhythm} onChange={e => handleProfileSettingChange('tonysRhythm', e.target.checked)} className="accent-blue-500" />
                            <span className="font-semibold text-slate-600 dark:text-slate-300">Tony's Rhythm</span>
                        </label>
                   }
                   {['classic', 'guinness', 'backwards', 'spaces', 'backwards-spaces'].includes(settings.mode) && 
                        <label className="flex items-center gap-2 cursor-pointer bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                            <input type="checkbox" checked={currentProfileSettings.fingering} onChange={e => handleProfileSettingChange('fingering', e.target.checked)} className="accent-blue-500" />
                            <span className="font-semibold text-slate-600 dark:text-slate-300">Show Fingering</span>
                        </label>
                   }

                   {currentProfileSettings.fingering && ['classic', 'guinness', 'backwards', 'spaces', 'backwards-spaces'].includes(settings.mode) && (
                        <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                            <span className="font-semibold text-slate-600 dark:text-slate-300">Finger Pattern</span>
                            <select
                                value={localData.selectedFingerPatternId || ''}
                                onChange={(e) => selectPattern(e.target.value || null)}
                                className="bg-transparent text-slate-700 dark:text-white text-sm font-bold outline-none"
                            >
                                <option value="">Tony's Fingering</option>
                                {(localData.fingerPatterns || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </div>
                   )}

                    <label className="flex items-center gap-2 cursor-pointer bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                        <input
                            type="checkbox"
                            checked={Boolean(specializedPractice?.enabled)}
                            onChange={(e) => {
                                const enabled = e.target.checked;
                                setSettings(s => ({
                                    ...s,
                                    specializedPractice: {
                                        ...(s.specializedPractice || DEFAULT_SETTINGS.specializedPractice),
                                        enabled,
                                    }
                                }));
                                resetGame();
                            }}
                            className="accent-blue-500"
                        />
                        <span className="font-semibold text-slate-600 dark:text-slate-300">Specialized Practice</span>
                    </label>

                    {specializedPractice?.enabled && (
                        <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                            <span className="font-semibold text-slate-600 dark:text-slate-300">Range</span>
                            <select
                                value={(specializedPractice.start || 'a').toLowerCase()}
                                onChange={(e) => {
                                    const start = e.target.value;
                                    setSettings(s => ({
                                        ...s,
                                        specializedPractice: {
                                            ...(s.specializedPractice || DEFAULT_SETTINGS.specializedPractice),
                                            start,
                                        } as SpecializedPracticeSettings
                                    }));
                                    resetGame();
                                }}
                                className="bg-transparent text-slate-700 dark:text-white text-sm font-bold outline-none"
                            >
                                {alphaLetters.map(l => <option key={`sp_s_${l}`} value={l}>{l.toUpperCase()}</option>)}
                            </select>
                            <span className="text-slate-400 font-bold">–</span>
                            <select
                                value={(specializedPractice.end || 'z').toLowerCase()}
                                onChange={(e) => {
                                    const end = e.target.value;
                                    setSettings(s => ({
                                        ...s,
                                        specializedPractice: {
                                            ...(s.specializedPractice || DEFAULT_SETTINGS.specializedPractice),
                                            end,
                                        } as SpecializedPracticeSettings
                                    }));
                                    resetGame();
                                }}
                                className="bg-transparent text-slate-700 dark:text-white text-sm font-bold outline-none"
                            >
                                {alphaLetters.map(l => <option key={`sp_e_${l}`} value={l}>{l.toUpperCase()}</option>)}
                            </select>
                        </div>
                    )}
                   {settings.mode !== 'blank' &&
                        <label className="flex items-center gap-2 cursor-pointer bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                            <input type="checkbox" checked={settings.blind} onChange={e => setSettings({...settings, blind: e.target.checked})} className="accent-blue-500" />
                            <span className="font-semibold text-slate-600 dark:text-slate-300">Blind Mode</span>
                        </label>
                   }
                   <label className="flex items-center gap-2 cursor-pointer bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                        <input type="checkbox" checked={settings.sound} onChange={e => setSettings({...settings, sound: e.target.checked})} className="accent-blue-500" />
                        <span className="font-semibold text-slate-600 dark:text-slate-300">Enable Sound</span>
                    </label>
                   <label className="flex items-center gap-2 cursor-pointer bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                        <input type="checkbox" checked={settings.voice} onChange={e => setSettings({...settings, voice: e.target.checked})} className="accent-blue-500" />
                        <span className="font-semibold text-slate-600 dark:text-slate-300">Voice Announce</span>
                    </label>
                </div>
                
                 <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                    <div className="bg-slate-50 dark:bg-slate-850 p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
                        <div className="text-[10px] uppercase font-bold text-slate-400">Mode Record</div>
                        <div className="text-2xl font-black text-blue-500 font-mono">{deviceRecord}</div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-850 p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
                        <div className="text-[10px] uppercase font-bold text-slate-400">Current Time</div>
                        <div className="text-4xl font-black text-slate-800 dark:text-white font-mono">{currentTime.toFixed(2)}</div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-850 p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
                        <div className="text-[10px] uppercase font-bold text-slate-400">Mistakes</div>
                        <div className="text-2xl font-black text-red-500 font-mono">{gameState.mistakes}</div>
                    </div>
                </div>

                <div
                    className={`relative min-h-[320px] sm:min-h-[350px] flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-800/50 rounded-2xl p-4 sm:p-8 overflow-hidden transition-all duration-300 ${isError ? 'animate-shake' : ''} ${settings.mode === 'guinness' && gameState.started && !gameState.finished ? 'border-2 border-red-500 shadow-lg shadow-red-500/10' : 'border border-slate-200 dark:border-slate-800'}`}
                    onPointerDown={() => {
                        requestKeyboard();
                        ensureAudioContext();
                    }}
                    onTouchStart={() => {
                        requestKeyboard();
                        ensureAudioContext();
                    }}
                >
                    {countdown && 
                        <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center backdrop-blur-sm">
                            <div className="text-7xl sm:text-9xl font-black text-white animate-pulse">{countdown}</div>
                        </div>
                    }

                    <div className={`w-full flex justify-center items-center transition-all ${settings.blind && settings.mode !== 'blank' ? 'blind-mode' : ''}`}>
                       {settings.mode === 'flash' && <div id="flash-letter" className="text-slate-800 dark:text-white transition-colors duration-100">{targetSequence[gameState.index]?.toUpperCase() || 'A'}</div>}
                       {settings.mode === 'blank' && <textarea ref={blankInputRef} value={targetSequence.slice(0, gameState.index).join('')} onChange={handleBlankInputChange} className="w-full h-full p-4 text-2xl font-mono resize-none rounded-lg bg-slate-50 dark:bg-slate-850 text-slate-800 dark:text-white border-2 border-slate-300 dark:border-slate-700 focus:border-blue-500 outline-none" autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck="false" rows={5} placeholder="Start typing sequence..." />}
                       {['classic', 'guinness', 'backwards', 'spaces', 'backwards-spaces'].includes(settings.mode) && (
                            <div className="flex flex-wrap justify-center gap-2 max-w-4xl">
                                {targetSequence.map((char, i) => {
                                    const code = activeFingeringMap[char] || '?';
                                    const data: FingeringDataItem = { char, code };
                                    return <LetterBox key={i} data={data} index={i} currentIndex={gameState.index} showFingering={currentProfileSettings.fingering} isCorrect={i < gameState.index} />
                                })}
                            </div>
                       )}
                    </div>

                    {!gameState.started && !gameState.finished &&
                        <div className="mt-12 bg-white dark:bg-slate-700 px-6 py-2 rounded-full shadow-lg border border-slate-200 dark:border-slate-600 text-sm font-bold text-blue-600 dark:text-blue-300 animate-bounce">
                           {settings.mode === 'guinness' ? "Press 'A' to Init Sequence" : settings.mode === 'blank' ? `Start typing: ${targetSequence.join('').substring(0, 3)}...` : `Press '${targetSequence[0].toUpperCase()}' to Start (or Enter to Restart)`}
                        </div>
                    }
                </div>

                <div className="mt-8">
                    <h2 className="text-xl font-bold mb-4 text-slate-700 dark:text-slate-200">Current Run Breakdown</h2>
                    <div className="overflow-x-auto overflow-y-auto max-h-[300px] bg-slate-50 dark:bg-slate-850 p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                        <table className="w-full text-xs sm:text-sm">
                            <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 text-[10px] uppercase font-bold text-slate-500">
                                <tr>
                                    <th className="px-3 py-2 text-left">Transition</th>
                                    <th className="px-3 py-2 text-left">Time</th>
                                    <th className="px-3 py-2 text-left">Cumulative</th>
                                </tr>
                            </thead>
                            <tbody>
                               {gameState.timingLog.length === 0 ? 
                                <tr><td colSpan={3} className="p-4 text-center text-slate-400 italic">No log data. Complete a run!</td></tr> :
                                gameState.timingLog.map((l, i) => (
                                    <tr key={i} className="hover:bg-slate-100 dark:hover:bg-slate-800 border-b border-slate-100 dark:border-slate-800">
                                        <td className="px-2 sm:px-3 py-1 font-mono whitespace-nowrap">{l.prev === ' ' ? 'Space' : l.prev.toUpperCase()} → {l.char === ' ' ? 'Space' : l.char.toUpperCase()}</td>
                                        <td className="px-2 sm:px-3 py-1 font-mono text-red-500 whitespace-nowrap">{l.duration.toFixed(3)}s</td>
                                        <td className="px-2 sm:px-3 py-1 font-mono text-blue-500 whitespace-nowrap">{l.total.toFixed(2)}s</td>
                                    </tr>
                                ))
                               }
                            </tbody>
                        </table>
                    </div>

                    {specializedPractice?.enabled && (
                        <div className="mt-4">
                            <div className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Specialized Practice: Per-letter Analysis</div>
                            <div className="overflow-x-auto bg-slate-50 dark:bg-slate-850 p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                                <table className="w-full text-xs sm:text-sm">
                                    <thead className="bg-slate-100 dark:bg-slate-800 text-[10px] uppercase font-bold text-slate-500">
                                        <tr>
                                            <th className="px-3 py-2 text-left">Letter</th>
                                            <th className="px-3 py-2 text-left">Attempts</th>
                                            <th className="px-3 py-2 text-left">Accuracy</th>
                                            <th className="px-3 py-2 text-left">Avg Time</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {currentRunLetterStats.length === 0 ? (
                                            <tr><td colSpan={4} className="p-4 text-center text-slate-400 italic">No data yet.</td></tr>
                                        ) : (
                                            currentRunLetterStats.map(row => (
                                                <tr key={`ls_${row.letter}`} className="hover:bg-slate-100 dark:hover:bg-slate-800 border-b border-slate-100 dark:border-slate-800">
                                                    <td className="px-3 py-2 font-mono font-black">{row.letter.toUpperCase()}</td>
                                                    <td className="px-3 py-2 font-mono">{row.attempts}</td>
                                                    <td className="px-3 py-2 font-mono">{(row.accuracy * 100).toFixed(0)}%</td>
                                                    <td className="px-3 py-2 font-mono text-red-500">{row.avg === null ? '--' : `${row.avg.toFixed(3)}s`}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>

            </div>
            <div className={view !== 'fingerPatterns' ? 'hidden' : ''}>
                {/* FINGER PATTERN PRACTICE VIEW */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Default</div>
                                <div className="text-lg font-black text-slate-800 dark:text-white">Tony's Fingering</div>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => selectPattern(null)} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-bold hover:bg-blue-700">Use in Practice</button>
                                <button onClick={() => setView('about')} className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-3 py-2 rounded-lg text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700">About Tony</button>
                            </div>
                        </div>

                        <div className="mt-4">{renderPatternTemplate(tonyFingeringMap)}</div>
                    </div>

                    <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-xs font-bold uppercase tracking-widest text-slate-400">My Fingerings</div>
                                <div className="text-lg font-black text-slate-800 dark:text-white">Custom Patterns</div>
                            </div>
                            <button onClick={openCreatePattern} className="bg-green-600 text-white px-3 py-2 rounded-lg text-xs font-bold hover:bg-green-700">New Pattern</button>
                        </div>

                        {(localData.fingerPatterns || []).length === 0 ? (
                            <div className="mt-4 text-sm text-slate-500 dark:text-slate-400">No custom patterns yet. Create one like “Bob's Fingering Pattern”.</div>
                        ) : (
                            <div className="mt-4 space-y-2">
                                {(localData.fingerPatterns || []).map(p => (
                                    <div key={p.id} className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2">
                                        <div className="min-w-0">
                                            <div className="font-bold text-slate-800 dark:text-white truncate">{p.name}</div>
                                            <div className="text-[11px] text-slate-500 dark:text-slate-400">Updated {new Date(p.updatedAt).toLocaleDateString()}</div>
                                        </div>
                                        <div className="flex gap-2 flex-none">
                                            <button onClick={() => selectPattern(p.id)} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-bold hover:bg-blue-700">Use</button>
                                            <button onClick={() => openEditPattern(p)} className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-3 py-2 rounded-lg text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700">Edit</button>
                                            <button onClick={() => deletePattern(p.id)} className="bg-red-600 text-white px-3 py-2 rounded-lg text-xs font-bold hover:bg-red-700">Delete</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {selectedFingerPattern && (
                    <div className="mt-6 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Selected</div>
                                <div className="text-lg font-black text-slate-800 dark:text-white">{selectedFingerPattern.name}</div>
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">Shown in Practice when “Show Fingering” is enabled.</div>
                        </div>
                        <div className="mt-4">{renderPatternTemplate(selectedFingerPattern.map)}</div>
                    </div>
                )}

                {patternEditorOpen && (
                    <div className="mt-6 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-lg font-black text-slate-800 dark:text-white">{patternEditorId ? 'Edit Pattern' : 'New Pattern'}</div>
                            <button onClick={() => { setPatternEditorOpen(false); setPatternEditorId(null); }} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 text-xs font-bold uppercase">Close</button>
                        </div>

                        <div className="mt-4">
                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Name</label>
                            <input value={patternEditorName} onChange={e => setPatternEditorName(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500" placeholder="Bob's Fingering Pattern" />
                        </div>

                        <div className="mt-5">
                            <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">Per-letter finger (L/R + finger)</div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {alphaLetters.map(letter => (
                                    <div key={`fp_${letter}`} className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2">
                                        <div className="font-mono font-black text-slate-800 dark:text-white">{letter.toUpperCase()}</div>
                                        <select
                                            value={patternEditorMap[letter] || '?'}
                                            onChange={(e) => setPatternEditorMap(m => ({ ...m, [letter]: e.target.value }))}
                                            className="bg-transparent text-slate-700 dark:text-white text-sm font-bold outline-none"
                                        >
                                            {fingerOptions.map(o => <option key={`${letter}_${o.value}`} value={o.value}>{o.label}</option>)}
                                        </select>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="mt-5 flex gap-2">
                            <button
                                onClick={savePattern}
                                disabled={!patternEditorName.trim()}
                                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 disabled:bg-blue-400"
                            >
                                Save Pattern
                            </button>
                            <button
                                onClick={() => { setPatternEditorMap({ ...tonyFingeringMap }); }}
                                className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-bold hover:bg-slate-200 dark:hover:bg-slate-700"
                            >
                                Reset to Tony
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className={view !== 'analytics' ? 'hidden' : ''}>
                {/* ANALYTICS VIEW */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl flex flex-col">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200">
                            Slowest Transitions (All Modes)
                        </div>
                        <div className="flex-grow overflow-y-auto p-2">
                             <table className="w-full text-sm">
                                <tbody>
                                    {analyticsDataMemo.slowest.length === 0 ?
                                     <tr><td colSpan={2} className="p-8 text-center text-slate-400">Complete a few runs!</td></tr> :
                                     analyticsDataMemo.slowest.slice(0, 8).map(i => (
                                         <tr key={i.key} className="hover:bg-slate-100 dark:hover:bg-slate-800">
                                            <td className="px-2 py-1 font-mono text-slate-600 dark:text-slate-300">{i.key}</td>
                                            <td className="px-2 py-1 font-mono text-red-500 font-bold text-right">{i.avg.toFixed(3)}s</td>
                                        </tr>
                                     ))
                                    }
                                </tbody>
                            </table>
                        </div>
                    </div>
                     <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl flex flex-col">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200">
                             Fastest Transitions
                        </div>
                        <div className="flex-grow overflow-y-auto p-2">
                             <table className="w-full text-sm">
                                <tbody>
                                    {analyticsDataMemo.fastest.length === 0 ?
                                     <tr><td colSpan={2} className="p-8 text-center text-slate-400">Complete a few runs!</td></tr> :
                                     analyticsDataMemo.fastest.slice(0, 8).map(i => (
                                         <tr key={i.key} className="hover:bg-slate-100 dark:hover:bg-slate-800">
                                            <td className="px-2 py-1 font-mono text-slate-600 dark:text-slate-300">{i.key}</td>
                                            <td className="px-2 py-1 font-mono text-green-500 font-bold text-right">{i.avg.toFixed(3)}s</td>
                                        </tr>
                                     ))
                                    }
                                </tbody>
                            </table>
                        </div>
                    </div>
                     <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl flex flex-col h-[500px]">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 flex justify-between">
                            <span>AI Speed Coach</span>
                            <span className="text-xs font-normal text-slate-400">Gemini</span>
                        </div>
                        {!isAiAvailable ? (
                            <div className="flex-grow p-5 bg-slate-50 dark:bg-slate-900/50">
                                <div className="text-sm font-bold text-slate-800 dark:text-slate-200">Coming soon</div>
                                <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                                    AI coaching will return in a future update.
                                </div>
                            </div>
                        ) : (
                            <>
                                <div ref={chatContainerRef} className="flex-grow overflow-y-auto p-4 space-y-3 bg-slate-50 dark:bg-slate-900/50">
                                    {chatHistory.map((msg, i) => (
                                       <div key={i} className={`p-3 rounded-lg text-sm ${msg.sender === 'ai' ? 'bg-blue-50 dark:bg-blue-900/20 text-slate-800 dark:text-slate-200' : 'bg-slate-100 dark:bg-slate-700 text-right text-slate-800 dark:text-slate-100'}`}>
                                           {msg.text.split('\n').map((line, index) => <p key={index}>{line}</p>)}
                                       </div>
                                    ))}
                                    {isCoachLoading && <div className="p-3 rounded-lg text-sm bg-blue-50 dark:bg-blue-900/20 text-slate-800 dark:text-slate-200">Coach is thinking...</div>}
                                </div>
                                <div className="p-3 border-t border-slate-100 dark:border-slate-700 flex gap-2">
                                    <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendChat()} className="flex-grow px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500" placeholder="Ask coach..." />
                                    <button onClick={handleSendChat} disabled={isCoachLoading} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-700 disabled:bg-blue-400">Send</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
            <div className={view !== 'history' ? 'hidden' : ''}>
                {/* HISTORY VIEW */}
                <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto">
                    <table className="w-full text-xs sm:text-sm text-left text-slate-600 dark:text-slate-300">
                        <thead className="bg-slate-100 dark:bg-slate-800 uppercase text-[10px] font-bold text-slate-500">
                            <tr>
                                <th className="px-3 sm:px-4 py-3">Mode</th>
                                <th className="hidden sm:table-cell px-3 sm:px-4 py-3">Device</th>
                                <th className="px-3 sm:px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700" onClick={() => handleSort('time')}>
                                    Time {historySort.key === 'time' && (historySort.direction === 'asc' ? '▲' : '▼')}
                                </th>
                                <th className="px-3 sm:px-4 py-3">Mistakes</th>
                                <th className="px-3 sm:px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700" onClick={() => handleSort('timestamp')}>
                                    Date {historySort.key === 'timestamp' && (historySort.direction === 'asc' ? '▲' : '▼')}
                                </th>
                                <th className="hidden sm:table-cell px-3 sm:px-4 py-3">Notes</th>
                                <th className="px-3 sm:px-4 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-700">
                             {sortedHistory.filter(r => r.profile === localData.currentProfile).length === 0 ?
                              <tr><td colSpan={7} className="p-8 text-center text-slate-400 italic">No history yet. Start practice!</td></tr> :
                              sortedHistory.filter(r => r.profile === localData.currentProfile).map(r => (
                                 <tr key={r.timestamp} className={`hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${r.time === personalBestTime ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}>
                                    <td className="px-3 sm:px-4 py-2 text-[10px] sm:text-xs uppercase font-bold text-blue-500 whitespace-nowrap">{r.mode} {r.blind ? '(Blind)' : ''}</td>
                                    <td className="hidden sm:table-cell px-3 sm:px-4 py-2 text-xs text-slate-500">{r.device}</td>
                                    <td className="px-3 sm:px-4 py-2 font-mono font-bold whitespace-nowrap">
                                        {r.time.toFixed(2)}s
                                        {r.time === personalBestTime && <span className="ml-2 text-amber-500" title="Personal Best">★</span>}
                                    </td>
                                    <td className="px-3 sm:px-4 py-2 text-red-500 font-bold whitespace-nowrap">{r.mistakes}</td>
                                    <td className="px-3 sm:px-4 py-2 text-xs whitespace-nowrap">{new Date(r.timestamp).toLocaleDateString()}</td>
                                    <td className="hidden sm:table-cell px-3 sm:px-4 py-2 text-xs text-slate-400 italic max-w-[150px] truncate">{r.note || '-'}</td>
                                    <td className="px-3 sm:px-4 py-2 text-right whitespace-nowrap">
                                        <button onClick={() => { if (window.confirm('Delete run?')) deleteRun(r.timestamp); }} className="text-red-500 hover:text-red-700 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">
                                            <span className="sm:hidden">Del</span>
                                            <span className="hidden sm:inline">Delete</span>
                                        </button>
                                    </td>
                                </tr>
                              ))
                             }
                        </tbody>
                    </table>
                </div>
            </div>

            <div className={view !== 'about' ? 'hidden' : ''}>
                {/* ABOUT VIEW */}
                <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl p-6 md:p-8">
                    <div className="max-w-3xl">
                        <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Engineered for</div>
                        <h2 className="text-3xl md:text-4xl font-black tracking-tight text-slate-900 dark:text-white mt-1">
                            Pure Speed.
                        </h2>

                        <div className="mt-5 space-y-4 text-sm md:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
                            <p>
                                Alphabet Typing Suite was born from a pursuit of the impossible. Created by Xiaoyu Tang ("Tony"), a speed typing phenom who shattered
                                records with an incredible 1.21-second alphabet run.
                            </p>
                            <p>
                                At this level, typing is no longer about hitting keys; it's about rhythm. Xiaoyu developed the "Tony's Rhythm" technique to group
                                letters into melodic patterns, reducing cognitive load and maximizing muscular efficiency.
                            </p>
                        </div>

                        <div className="mt-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-5">
                            <p className="text-slate-700 dark:text-slate-200 italic leading-relaxed">
                                "I built this app because standard trainers couldn't keep up with world-record speeds. The Alphabet Typing Suite treats the keyboard
                                like a musical instrument."
                            </p>
                            <div className="mt-3 text-sm font-bold text-slate-500 dark:text-slate-400">— Xiaoyu Tang</div>
                        </div>
                    </div>

                    <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="bg-slate-50 dark:bg-slate-850 p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
                            <div className="text-[10px] uppercase font-bold text-slate-400">Xiaoyu's Best</div>
                            <div className="text-3xl font-black text-blue-500 font-mono">1.21s</div>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-850 p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
                            <div className="text-[10px] uppercase font-bold text-slate-400">Technique</div>
                            <div className="text-2xl font-black text-slate-800 dark:text-white">Tony's Rhythm</div>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-850 p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
                            <div className="text-[10px] uppercase font-bold text-slate-400">Keys/Sec</div>
                            <div className="text-2xl font-black text-slate-800 dark:text-white font-mono">21.48 KPS</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer / Copyright */}
            <div className="mt-12 pt-8 border-t border-slate-100 dark:border-slate-800 text-center">
                <p className="text-sm font-bold text-slate-400 dark:text-slate-600">
                    Made with ❤️ by <span className="text-blue-500">Xiaoyu Tang</span> @ <span className="text-slate-700 dark:text-slate-400 font-black">YuNova LLC</span>
                </p>
                <p className="text-[10px] uppercase tracking-widest text-slate-300 dark:text-slate-700 mt-2">
                    © {new Date().getFullYear()} YuNova LLC. All Rights Reserved.
                </p>
            </div>

        </div>

        {/* RESULTS MODAL */}
        {resultsModalOpen && 
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-md p-4 transition-opacity">
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-slate-200 dark:border-slate-700 transform transition-all scale-100">
                     <div className="text-center">
                        <div className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-1">New Run Completed!</div>
                        <div className="text-6xl font-black text-slate-800 dark:text-white font-mono tracking-tighter mb-1">{currentTime.toFixed(2)}s</div>
                        <div className="text-sm font-bold text-red-500 mb-4">{gameState.mistakes} Mistake{gameState.mistakes !== 1 ? 's' : ''}</div>
                        
                         <div className="space-y-1 bg-slate-100 dark:bg-slate-700/50 p-3 rounded-lg mb-4 text-xs font-semibold text-left">
                            {postRunAnalysis.map((line, i) => <p key={i}>{line}</p>)}
                        </div>

                        <div className="mb-4 text-left">
                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Run Notes</label>
                            <textarea ref={runNoteRef} value={runNote} onChange={e => setRunNote(e.target.value)} className="w-full mt-1 p-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-700 border-transparent focus:ring-2 focus:ring-blue-500 outline-none resize-none" rows={2} placeholder="Any observations?"></textarea>
                        </div>

                        <button onClick={() => { saveCurrentRun(); resetGame(); }} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-lg shadow-blue-500/30 transition transform hover:scale-[1.02] mb-2">
                            Save & Restart
                        </button>
                        <button onClick={() => { saveCurrentRun(); setResultsModalOpen(false); setView('analytics'); }} className="w-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 font-bold py-2 rounded-xl transition mb-2">
                            Save & View Analysis
                        </button>
                        <button onClick={() => resetGame()} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-bold uppercase transition">Discard & Restart</button>
                    </div>
                </div>
            </div>
        }
        
        {/* MANAGEMENT MODAL */}
        {managementModalOpen && 
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-md p-4 transition-opacity">
                 <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 max-w-lg w-full border border-slate-200 dark:border-slate-700 transform transition-all scale-100">
                    <h3 className="text-xl font-bold mb-4 border-b pb-2 text-slate-700 dark:text-slate-200">Manage Profiles & Devices</h3>
                     <div className="flex gap-4">
                        <div className="flex-1">
                            <label className="text-sm font-bold text-slate-500 dark:text-slate-400">Profiles</label>
                            <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
                                {localData.profiles.map(p => (
                                    <div key={p} className="flex justify-between items-center bg-slate-50 dark:bg-slate-700 p-2 rounded-lg text-sm">
                                        <span>{p}</span>
                                        <button onClick={() => removeEntry('profile', p)} className="text-red-500 hover:text-red-700 font-bold ml-2 disabled:text-slate-500" disabled={localData.profiles.length <= 1}>X</button>
                                    </div>
                                ))}
                            </div>
                            <div className="flex mt-2 gap-2">
                                <input value={newProfile} onChange={e => setNewProfile(e.target.value)} onKeyDown={e => e.key === 'Enter' && addProfile()} type="text" placeholder="New Profile" className="flex-grow p-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-700 outline-none"/>
                                <button onClick={addProfile} className="bg-green-600 text-white p-2 rounded-lg text-sm hover:bg-green-700 px-3">Add</button>
                            </div>
                        </div>
                        <div className="flex-1">
                            <label className="text-sm font-bold text-slate-500 dark:text-slate-400">Devices</label>
                            <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
                               {localData.devices.map(d => (
                                    <div key={d} className="flex justify-between items-center bg-slate-50 dark:bg-slate-700 p-2 rounded-lg text-sm">
                                        <span>{d}</span>
                                        <button onClick={() => removeEntry('device', d)} className="text-red-500 hover:text-red-700 font-bold ml-2 disabled:text-slate-500" disabled={localData.devices.length <= 1}>X</button>
                                    </div>
                                ))}
                            </div>
                            <div className="flex mt-2 gap-2">
                                <input value={newDevice} onChange={e => setNewDevice(e.target.value)} onKeyDown={e => e.key === 'Enter' && addDevice()} type="text" placeholder="New Device" className="flex-grow p-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-700 outline-none"/>
                                <button onClick={addDevice} className="bg-green-600 text-white p-2 rounded-lg text-sm hover:bg-green-700 px-3">Add</button>
                            </div>
                        </div>
                    </div>
                    <button onClick={() => setManagementModalOpen(false)} className="mt-6 w-full bg-blue-600 text-white font-bold py-2 rounded-xl hover:bg-blue-700 transition">Close</button>
                </div>
            </div>
        }

        <input
            type="text"
            ref={hiddenInputRef}
            // Use a tiny (but focusable) input so iOS reliably shows the software keyboard.
            className="fixed top-0 left-0 w-[1px] h-[1px] opacity-0"
            inputMode="text"
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            onChange={handleHiddenInputChange}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    resetGame();
                }
            }}
        />
        </>
    );
};

export default App;
