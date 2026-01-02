
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { User } from 'firebase/auth';
import type { View, GameMode, LocalData, Settings, GameState, Run, TimingLogEntry, FingeringDataItem, ChatMessage, ProfileSettings, FingerPattern, RhythmPattern, MistakeLogEntry, SpecializedPracticeSettings } from './types';
import { STORAGE_KEY, MAX_ENTRIES, ALPHABET, FINGERING_DATA, TONY_GROUPS_ROW1, TONY_GROUPS_ROW2, INITIAL_GAME_STATE, DEFAULT_LOCAL_DATA, DEFAULT_SETTINGS, getTargetSequence } from './constants';
import { APP_MAKER_LINE, APP_NAME, APP_TAGLINE } from './branding';
import { getCoachingTip } from './services/geminiService';
import { firebaseEnvStatus, isFirebaseConfigured } from './services/firebase';
import type { CloudEnvelope } from './services/cloudSync';
import { envelopesEqual, ensureRunIds, mergeEnvelopes } from './services/syncMerge';
import { getDeviceIdentity, type DeviceIdentity } from './services/deviceIdentity';

const loadAuthService = () => import('./services/authService');
const loadCloudSync = () => import('./services/cloudSync');

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

const MODE_RECORD_ORDER: GameMode[] = ['classic', 'backwards', 'spaces', 'backwards-spaces'];

const uniqStrings = (arr: string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of arr) {
        const s = String(v || '').trim();
        if (!s) continue;
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(s);
    }
    return out;
};

const modeLabel = (mode: GameMode): string => {
    switch (mode) {
        case 'classic':
            return 'A–Z';
        case 'backwards':
            return 'Z–A';
        case 'spaces':
            return 'A–Z (spaces)';
        case 'backwards-spaces':
            return 'Z–A (spaces)';
        case 'blank':
            return 'Blank typing';
        case 'flash':
            return 'Flash';
        case 'guinness':
            return 'Grid';
        default:
            return mode;
    }
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

    const [deviceIdentity, setDeviceIdentity] = useState<DeviceIdentity | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const identity = await getDeviceIdentity();
                if (!cancelled) setDeviceIdentity(identity);
            } catch {
                // Non-fatal
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // --- UI MODE ---
    const PROFESSIONAL_MODE_STORAGE_KEY = 'alphabetTypingSuite.professionalMode';
    const [professionalMode, setProfessionalMode] = useState<boolean>(() => {
        try {
            return localStorage.getItem(PROFESSIONAL_MODE_STORAGE_KEY) === '1';
        } catch {
            return false;
        }
    });

    const professionalModeDirtyRef = useRef(false);

    const professionalModeRef = useRef<boolean>(professionalMode);
    useEffect(() => {
        professionalModeRef.current = professionalMode;
    }, [professionalMode]);

    useEffect(() => {
        try {
            localStorage.setItem(PROFESSIONAL_MODE_STORAGE_KEY, professionalMode ? '1' : '0');
        } catch {
            // ignore
        }
    }, [professionalMode]);

    useEffect(() => {
        if (!professionalModeDirtyRef.current) return;
        professionalModeDirtyRef.current = false;

        const now = Math.max(Date.now(), (localUpdatedAtRef.current || 0) + 1);
        localUpdatedAtRef.current = now;

        // Persist updatedAt so a reload doesn't let cloud overwrite this UI change.
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                parsed.meta = { ...(parsed.meta || {}), updatedAt: now };
                localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
            }
        } catch {
            // ignore
        }
    }, [professionalMode]);

    // --- SPLASH (COME-IN) ---
    const [showSplash, setShowSplash] = useState(true);
    const [splashLeaving, setSplashLeaving] = useState(false);

    useEffect(() => {
        // Keep the splash visible longer, then fade out.
        const t1 = window.setTimeout(() => setSplashLeaving(true), 2600);
        const t2 = window.setTimeout(() => setShowSplash(false), 3000);
        return () => {
            window.clearTimeout(t1);
            window.clearTimeout(t2);
        };
    }, []);

    useEffect(() => {
        // Styling-only global mode; keep behavior unchanged.
        document.body.classList.toggle('pro-mode', professionalMode);
        return () => {
            document.body.classList.remove('pro-mode');
        };
    }, [professionalMode]);

    // --- AUTH / CLOUD SYNC ---
    const firebaseEnabled = isFirebaseConfigured();
    const firebaseStatus = useMemo(() => firebaseEnvStatus(), [firebaseEnabled]);
    const [user, setUser] = useState<User | null>(null);
    const [authEmail, setAuthEmail] = useState('');
    const [authPassword, setAuthPassword] = useState('');
    const [authError, setAuthError] = useState<string | null>(null);
    const [authNotice, setAuthNotice] = useState<string | null>(null);
    const [authBusy, setAuthBusy] = useState(false);

    const formatFirebaseAuthError = useCallback((e: any): string => {
        const code = String(e?.code || '');
        const msg = String(e?.message || '');
        switch (code) {
            case 'auth/operation-not-allowed':
                return 'Firebase: Error (auth/operation-not-allowed). Enable this provider in Firebase Console → Authentication → Sign-in method.';
            case 'auth/unauthorized-domain':
                return 'Firebase: Error (auth/unauthorized-domain). Add this domain in Firebase Console → Authentication → Settings → Authorized domains.';
            case 'auth/user-not-found':
                return 'Firebase: Error (auth/user-not-found). That email has no account (try Create Account).';
            case 'auth/invalid-credential':
                return 'Firebase: Error (auth/invalid-credential). Usually wrong email/password, or the account was created with a different sign-in method. Try “Forgot Password”, or use the provider you originally used (Google/Apple).';
            case 'auth/wrong-password':
                return 'Firebase: Error (auth/wrong-password). Wrong password (try “Forgot Password”).';
            case 'auth/invalid-email':
                return 'Firebase: Error (auth/invalid-email). Check the email address.';
            case 'auth/too-many-requests':
                return 'Firebase: Error (auth/too-many-requests). Try again later.';
            case 'auth/requires-recent-login':
                return 'Firebase: Error (auth/requires-recent-login). For security, sign out then sign back in, and try again.';
            case 'auth/popup-blocked':
                return 'Firebase: Error (auth/popup-blocked). Allow popups, then try again.';
            default:
                return msg || (code ? `Firebase: Error (${code}).` : String(e));
        }
    }, []);

    const [syncStatus, setSyncStatus] = useState<'off' | 'idle' | 'syncing' | 'error'>('off');
    const [syncError, setSyncError] = useState<string | null>(null);
    const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

    const localUpdatedAtRef = useRef<number>(0);
    const lastUiChangeAtRef = useRef<number>(0);
    const applyingRemoteRef = useRef<boolean>(false);
    const pushTimerRef = useRef<number | null>(null);
    const localDataRef = useRef<LocalData>(localData);
    const settingsRef = useRef<Settings>(settings);

    useEffect(() => { localDataRef.current = localData; }, [localData]);
    useEffect(() => { settingsRef.current = settings; }, [settings]);

    const bumpLocalUpdatedAt = useCallback(() => {
        if (applyingRemoteRef.current) return;
        const next = Math.max(Date.now(), (localUpdatedAtRef.current || 0) + 1);
        localUpdatedAtRef.current = next;
        lastUiChangeAtRef.current = Date.now();
    }, []);

    const isAiAvailable = Boolean(import.meta.env.VITE_GEMINI_API_KEY);

    const canUseOAuthOnThisPlatform = useMemo(() => {
        try {
            // Avoid importing Capacitor eagerly; rely on global injected object when present.
            return !(globalThis as any)?.Capacitor?.isNativePlatform?.();
        } catch {
            return true;
        }
    }, []);

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
    const hiddenInputRef = useRef<HTMLTextAreaElement>(null);
    const blankInputRef = useRef<HTMLTextAreaElement>(null);
    const runNoteRef = useRef<HTMLTextAreaElement>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);

    const isNativeIOS = useMemo(() => {
        try {
            const cap = (globalThis as any)?.Capacitor;
            const isNative = Boolean(cap?.isNativePlatform?.());
            if (!isNative) return false;
            const platform = cap?.getPlatform?.();
            if (platform === 'ios') return true;
            const ua = (navigator.userAgent || '').toLowerCase();
            return ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod');
        } catch {
            return false;
        }
    }, []);

    const isIOSBrowser = useMemo(() => {
        try {
            const ua = (navigator.userAgent || '').toLowerCase();
            return ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod');
        } catch {
            return false;
        }
    }, []);

    const isIOSLike = isNativeIOS || isIOSBrowser;

    const keyboardRequestedRef = useRef(false);

    // --- TARGET SEQUENCE ---
    const targetSequence = useMemo(
        () => getTargetSequence(settings.mode, specializedPractice),
        [settings.mode, specializedPractice]
    );

    const migrateLegacyProfileDeviceNames = useCallback((data: LocalData): LocalData => {
        // Older builds used "Tony" and "Magic Keyboard" as initial defaults.
        // Migrate them to neutral defaults so new users can add their own.
        const PROFILE_RENAME: Record<string, string> = {
            'Tony': 'User',
        };
        const DEVICE_RENAME: Record<string, string> = {
            'Magic Keyboard': 'This Device',
        };

        const renameProfile = (name: string) => PROFILE_RENAME[name] || name;
        const renameDevice = (name: string) => DEVICE_RENAME[name] || name;

        const profiles = uniqStrings((data.profiles || []).map(renameProfile));
        const devices = uniqStrings((data.devices || []).map(renameDevice));

        const currentProfile = profiles.includes(renameProfile(data.currentProfile))
            ? renameProfile(data.currentProfile)
            : (profiles[0] || DEFAULT_LOCAL_DATA.currentProfile);

        const currentDevice = devices.includes(renameDevice(data.currentDevice))
            ? renameDevice(data.currentDevice)
            : (devices[0] || DEFAULT_LOCAL_DATA.currentDevice);

        const nextProfileSettings: Record<string, ProfileSettings> = { ...(data.profileSettings || {}) };
        const oldProfile = 'Tony';
        const newProfile = 'User';
        if (nextProfileSettings[oldProfile]) {
            if (nextProfileSettings[newProfile]) {
                nextProfileSettings[newProfile] = { ...nextProfileSettings[oldProfile], ...nextProfileSettings[newProfile] };
            } else {
                nextProfileSettings[newProfile] = nextProfileSettings[oldProfile];
            }
            delete nextProfileSettings[oldProfile];
        }

        // Ensure the current profile has settings.
        if (!nextProfileSettings[currentProfile]) {
            nextProfileSettings[currentProfile] = { tonysRhythm: false, fingering: false };
        }

        const history = (data.history || []).map((r) => {
            const nextProfile = renameProfile((r as any).profile);
            const nextDevice = renameDevice((r as any).device);
            if (nextProfile === (r as any).profile && nextDevice === (r as any).device) return r;
            return { ...r, profile: nextProfile, device: nextDevice };
        });

        return {
            ...data,
            profiles: profiles.length ? profiles : DEFAULT_LOCAL_DATA.profiles,
            devices: devices.length ? devices : DEFAULT_LOCAL_DATA.devices,
            currentProfile,
            currentDevice,
            profileSettings: nextProfileSettings,
            history,
        };
    }, []);

    // --- DATA & SETTINGS PERSISTENCE ---
    useEffect(() => {
        try {
            const storedData = localStorage.getItem(STORAGE_KEY);
            if (storedData) {
                const parsed = JSON.parse(storedData);
                if (parsed?.meta && typeof parsed.meta.updatedAt === 'number') {
                    localUpdatedAtRef.current = parsed.meta.updatedAt;
                }
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
                    if (!parsed.localData.rhythmPatterns) parsed.localData.rhythmPatterns = [];
                    if (typeof parsed.localData.selectedRhythmPatternId === 'undefined') parsed.localData.selectedRhythmPatternId = null;
                }

                const migratedLocalData = parsed.localData ? migrateLegacyProfileDeviceNames(parsed.localData) : DEFAULT_LOCAL_DATA;
                setLocalData(migratedLocalData);
                setSettings(parsed.settings || DEFAULT_SETTINGS);
            }
        } catch (e) {
            console.error("Failed to load data from localStorage", e);
        }
    }, [migrateLegacyProfileDeviceNames]);

    useEffect(() => {
        try {
            if (!applyingRemoteRef.current) {
                localUpdatedAtRef.current = Math.max(Date.now(), (localUpdatedAtRef.current || 0) + 1);
            }

            const dataToStore = {
                localData,
                settings,
                meta: { updatedAt: localUpdatedAtRef.current }
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToStore));
        } catch (e) {
            console.error("Failed to save data to localStorage", e);
        }
    }, [localData, settings]);

    useEffect(() => {
        if (!firebaseEnabled) {
            setUser(null);
            setSyncStatus('off');
            return;
        }
        let unsub: (() => void) | null = null;
        let cancelled = false;

        (async () => {
            try {
                const { watchAuth } = await loadAuthService();
                if (cancelled) return;
                unsub = watchAuth((u) => setUser(u));
            } catch (e) {
                console.error('Failed to load auth service:', e);
            }
        })();

        return () => {
            cancelled = true;
            unsub?.();
        };
    }, [firebaseEnabled]);

    useEffect(() => {
        if (!firebaseEnabled) return;
        // Needed for OAuth redirect flows (Google/Apple) to complete on return.
        (async () => {
            try {
                const { consumeAuthRedirectResult } = await loadAuthService();
                await consumeAuthRedirectResult();
            } catch (e) {
                // No redirect result (common) or provider not configured.
                console.warn('Auth redirect result not available:', e);
            }
        })();
    }, [firebaseEnabled]);

    const applyCloudEnvelope = useCallback((env: CloudEnvelope) => {
        applyingRemoteRef.current = true;
        localUpdatedAtRef.current = env.updatedAt;
        const migratedLocalData = migrateLegacyProfileDeviceNames({
            ...env.localData,
            history: ensureRunIds(env.localData.history || []),
        });
        setLocalData(migratedLocalData);
        setSettings(env.settings);

        if (typeof env.ui?.professionalMode === 'boolean') {
            setProfessionalMode(env.ui.professionalMode);
        }

        window.setTimeout(() => {
            applyingRemoteRef.current = false;
        }, 0);
    }, [migrateLegacyProfileDeviceNames]);

    const pushNow = useCallback(async (reason: string) => {
        if (!firebaseEnabled || !user) return;
        if (applyingRemoteRef.current) return;

        setSyncStatus('syncing');
        setSyncError(null);

        const envelope: CloudEnvelope = {
            schemaVersion: 1,
            updatedAt: localUpdatedAtRef.current || Date.now(),
            localData: {
                ...localDataRef.current,
                history: ensureRunIds(localDataRef.current.history || []),
            },
            settings: settingsRef.current,
            ui: {
                professionalMode: professionalModeRef.current,
            },
        };

        try {
            const { pushCloudEnvelope } = await loadCloudSync();
            await pushCloudEnvelope(user.uid, envelope);
            setSyncStatus('idle');
            setLastSyncAt(Date.now());
        } catch (e: any) {
            setSyncStatus('error');
            setSyncError(e?.message || String(e));
            console.error(`Cloud push failed (${reason})`, e);
        }
    }, [firebaseEnabled, user]);

    useEffect(() => {
        if (!firebaseEnabled || !user) return;

        setSyncStatus('syncing');
        setSyncError(null);
        let cancelled = false;

        (async () => {
            try {
            const { pullCloudEnvelope, pushCloudEnvelope, subscribeCloudEnvelope } = await loadCloudSync();
                const cloud = await pullCloudEnvelope(user.uid);
                if (cancelled) return;

                if (!cloud) {
                    // First login on this account: seed cloud with local.
                    await pushNow('initial-seed');
                    return;
                }

                const localEnv: CloudEnvelope = {
                    schemaVersion: 1,
                    updatedAt: localUpdatedAtRef.current || 0,
                    localData: {
                        ...localDataRef.current,
                        history: ensureRunIds(localDataRef.current.history || []),
                    },
                    settings: settingsRef.current,
                    ui: {
                        professionalMode: professionalModeRef.current,
                    },
                };

                const merged = mergeEnvelopes(localEnv, cloud);
                const mergedEnv: CloudEnvelope = {
                    schemaVersion: 1,
                    updatedAt: merged.updatedAt,
                    localData: merged.localData,
                    settings: merged.settings,
                    ui: merged.ui,
                };

                if (!envelopesEqual(mergedEnv, localEnv) || mergedEnv.updatedAt !== localEnv.updatedAt) {
                    applyCloudEnvelope(mergedEnv);
                }

                if (!envelopesEqual(mergedEnv, cloud) || mergedEnv.updatedAt !== cloud.updatedAt) {
                    await pushCloudEnvelope(user.uid, mergedEnv);
                }

                setSyncStatus('idle');
                setLastSyncAt(Date.now());
            } catch (e: any) {
                if (cancelled) return;
                setSyncStatus('error');
                setSyncError(e?.message || String(e));
                console.error('Initial cloud sync failed', e);
            }
        })();

        let unsub: (() => void) | null = null;
        (async () => {
            try {
                const { subscribeCloudEnvelope, pushCloudEnvelope } = await loadCloudSync();
                if (cancelled) return;
                unsub = subscribeCloudEnvelope(user.uid, (env) => {
                    if (!env) return;

                    const localEnv: CloudEnvelope = {
                        schemaVersion: 1,
                        updatedAt: localUpdatedAtRef.current || 0,
                        localData: {
                            ...localDataRef.current,
                            history: ensureRunIds(localDataRef.current.history || []),
                        },
                        settings: settingsRef.current,
                        ui: {
                            professionalMode: professionalModeRef.current,
                        },
                    };

                    const merged = mergeEnvelopes(localEnv, env);
                    const mergedEnv: CloudEnvelope = {
                        schemaVersion: 1,
                        updatedAt: merged.updatedAt,
                        localData: merged.localData,
                        settings: merged.settings,
                        ui: merged.ui,
                    };

                    if (!envelopesEqual(mergedEnv, localEnv) || mergedEnv.updatedAt !== localEnv.updatedAt) {
                        applyCloudEnvelope(mergedEnv);
                        setLastSyncAt(Date.now());
                        setSyncStatus('idle');
                    }

                    if (!envelopesEqual(mergedEnv, env) || mergedEnv.updatedAt !== env.updatedAt) {
                        void pushCloudEnvelope(user.uid, mergedEnv).catch((e) => {
                            console.error('Cloud reconcile push failed', e);
                        });
                    }
                });
            } catch (e) {
                console.error('Failed to start cloud subscription:', e);
            }
        })();

        return () => {
            cancelled = true;
            unsub?.();
        };
    }, [applyCloudEnvelope, firebaseEnabled, pushNow, user]);

    useEffect(() => {
        if (!firebaseEnabled || !user) return;
        if (applyingRemoteRef.current) return;

        if (pushTimerRef.current) window.clearTimeout(pushTimerRef.current);
        pushTimerRef.current = window.setTimeout(() => {
            void pushNow('debounced');
        }, 900);

        return () => {
            if (pushTimerRef.current) window.clearTimeout(pushTimerRef.current);
        };
    }, [firebaseEnabled, localData, professionalMode, pushNow, settings, user]);
    
    // --- UI COMPUTATIONS ---
    const currentProfileSettings = useMemo(() => {
        return localData.profileSettings?.[localData.currentProfile] || { tonysRhythm: false, fingering: false };
    }, [localData.currentProfile, localData.profileSettings]);

    // --- FOCUS MANAGEMENT ---
    const blurTypingInputs = useCallback(() => {
        keyboardRequestedRef.current = false;
        try {
            (hiddenInputRef.current as any)?.blur?.();
        } catch {
            // ignore
        }
        try {
            (blankInputRef.current as any)?.blur?.();
        } catch {
            // ignore
        }
    }, []);

    const focusCorrectInput = useCallback(() => {
        // iOS (Safari + native): do not auto-focus until the user requests the keyboard.
        if (isIOSLike && !keyboardRequestedRef.current) return;

        if (resultsModalOpen) {
            // Don't auto-focus the note on iOS; user can tap it.
            if (!isIOSLike) runNoteRef.current?.focus();
            return;
        }

        if (view !== 'practice') return;

        if (settings.mode === 'blank') {
            if (!isIOSLike || !gameState.finished) {
                blankInputRef.current?.focus();
            }
            return;
        }

        // Non-blank: on iOS only focus during countdown/active run.
        if (isIOSLike) {
            const shouldFocus = Boolean(countdown) || (gameState.started && !gameState.finished);
            if (!shouldFocus) return;
        }

        hiddenInputRef.current?.focus();
    }, [countdown, gameState.finished, gameState.started, isIOSLike, resultsModalOpen, settings.mode, view]);

    const requestKeyboard = useCallback(() => {
        if (resultsModalOpen || managementModalOpen) return;
        if (view !== 'practice') return;

        keyboardRequestedRef.current = true;

        if (settings.mode === 'blank') {
            try {
                (blankInputRef.current as any)?.focus?.({ preventScroll: true });
            } catch {
                blankInputRef.current?.focus();
            }
            return;
        }

        const el = hiddenInputRef.current;
        if (!el) return;

        try {
            (el as any).focus?.({ preventScroll: true });
        } catch {
            el.focus();
        }
    }, [managementModalOpen, resultsModalOpen, settings.mode, view]);

    useEffect(() => {
       focusCorrectInput();
    }, [focusCorrectInput]);

    useEffect(() => {
        // When leaving practice or opening modals, stop trying to keep the typing input focused.
        if (view !== 'practice' || resultsModalOpen || managementModalOpen) {
            blurTypingInputs();
        }
    }, [blurTypingInputs, managementModalOpen, resultsModalOpen, view]);

    // --- GAME LOGIC ---

    const resetGame = useCallback((newMode?: GameMode) => {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        blurTypingInputs();
        setGameState(INITIAL_GAME_STATE);
        setCurrentTime(0);
        setResultsModalOpen(false);
        setRunNote("");
        setCountdown(null);
        setCompletedRun(null);
        setPostRunAnalysis([]);
        if (newMode) {
            bumpLocalUpdatedAt();
            setSettings(s => ({ ...s, mode: newMode }));
        }
        setTimeout(focusCorrectInput, 50);
    }, [blurTypingInputs, bumpLocalUpdatedAt, focusCorrectInput]);

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
        const isSpecial = Boolean(run.specialized?.enabled);
        const relevantHistory = history.filter(r => {
            if (r.profile !== run.profile) return false;
            if (r.device !== run.device) return false;
            if (r.mode !== run.mode) return false;

            if (isSpecial) {
                if (!r.specialized?.enabled) return false;
                return (
                    (r.specialized.start || 'a').toLowerCase() === (run.specialized?.start || 'a').toLowerCase() &&
                    (r.specialized.end || 'z').toLowerCase() === (run.specialized?.end || 'z').toLowerCase()
                );
            }

            return !r.specialized?.enabled;
        });
        const times = relevantHistory.map(r => r.time).sort((a,b) => a - b);
        
        const rank = times.findIndex(t => run.time <= t);

        if (rank === 0 && run.time < (times[1] ?? Infinity)) {
            analysis.push(isSpecial ? "🎯 New Specialized Best!" : "🚀 New Personal Best!");
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
            id: (globalThis.crypto as any)?.randomUUID?.() || `r_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            time: finalTime,
            mistakes: gameState.mistakes,
            mode: settings.mode,
            profile: localData.currentProfile,
            device: localData.currentDevice,
            deviceId: deviceIdentity?.deviceId,
            deviceLabel: deviceIdentity?.deviceLabel,
            platform: deviceIdentity?.platform,
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

        // Hide keyboard/accessory bar unless user explicitly taps into the note.
        blurTypingInputs();
        
        setResultsModalOpen(true);
    }, [blurTypingInputs, deviceIdentity?.deviceId, deviceIdentity?.deviceLabel, deviceIdentity?.platform, gameState.mistakeLog, gameState.mistakes, generatePostRunAnalysis, localData.currentDevice, localData.currentProfile, localData.history, settings.blind, settings.mode, settings.sound, settings.voice, specializedPractice]);


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

    const handleHiddenInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
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
        if (view !== 'practice') return;

        const target = e.target as HTMLElement | null;
        const tag = (target?.tagName || '').toLowerCase();
        const isEditable =
            tag === 'input' ||
            tag === 'textarea' ||
            tag === 'select' ||
            Boolean((target as any)?.isContentEditable);
        if (isEditable) return;

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
        beginRun,
        countdown,
        endGame,
        gameState,
        localData,
        managementModalOpen,
        processTypedKey,
        resetGame,
        resultsModalOpen,
        settings,
        startGameSequence,
        targetSequence,
        view
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
            .filter(r =>
                r.profile === localData.currentProfile &&
                r.device === localData.currentDevice &&
                r.mode === settings.mode &&
                !r.specialized?.enabled
            )
            .reduce((min, r) => Math.min(min, r.time), Infinity);
        return bestTime === Infinity ? '--' : bestTime.toFixed(2);
    }, [localData, settings.mode]);

    const deviceRecordsByMode = useMemo(() => {
        const orderedModes: GameMode[] = MODE_RECORD_ORDER.includes(settings.mode)
            ? MODE_RECORD_ORDER
            : [settings.mode, ...MODE_RECORD_ORDER];

        const bestByMode = new Map<GameMode, number>(orderedModes.map(m => [m, Infinity]));

        for (const run of localData.history) {
            if (
                run.profile !== localData.currentProfile ||
                run.device !== localData.currentDevice ||
                run.specialized?.enabled
            ) {
                continue;
            }

            if (!bestByMode.has(run.mode)) continue;
            bestByMode.set(run.mode, Math.min(bestByMode.get(run.mode) ?? Infinity, run.time));
        }

        return orderedModes.map(mode => {
            const best = bestByMode.get(mode) ?? Infinity;
            return { mode, timeText: best === Infinity ? '--' : best.toFixed(2) };
        });
    }, [localData, settings.mode]);

    const specializedRecord = useMemo(() => {
        if (!specializedPractice.enabled) return null;

        const start = (specializedPractice.start || 'a').toLowerCase();
        const end = (specializedPractice.end || 'z').toLowerCase();
        const bestTime = localData.history
            .filter(r =>
                r.profile === localData.currentProfile &&
                r.device === localData.currentDevice &&
                r.mode === settings.mode &&
                r.specialized?.enabled &&
                (r.specialized.start || 'a').toLowerCase() === start &&
                (r.specialized.end || 'z').toLowerCase() === end
            )
            .reduce((min, r) => Math.min(min, r.time), Infinity);
        return bestTime === Infinity ? '--' : bestTime.toFixed(2);
    }, [localData, settings.mode, specializedPractice.enabled, specializedPractice.end, specializedPractice.start]);
    
    const personalBestTime = useMemo(() => {
        const bestTime = localData.history
            .filter(r =>
                r.profile === localData.currentProfile &&
                r.device === localData.currentDevice &&
                r.mode === settings.mode &&
                !r.specialized?.enabled
            )
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
            .map(r => `Time: ${r.time.toFixed(2)}s, Mode: ${modeLabel(r.mode)}`)
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
        bumpLocalUpdatedAt();
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

    const getFingerUi = (code: string | undefined): { hand: 'L' | 'R' | 'O' | '?'; finger: '1' | '2' | '3' | '4' | '5' } => {
        const c = (code || '?').toUpperCase();
        if (c === 'T1') return { hand: 'O', finger: '1' };
        if (c.startsWith('L') && ['1','2','3','4','5'].includes(c.slice(1))) return { hand: 'L', finger: c.slice(1) as any };
        if (c.startsWith('R') && ['1','2','3','4','5'].includes(c.slice(1))) return { hand: 'R', finger: c.slice(1) as any };
        return { hand: '?', finger: '2' };
    };

    const setFingerUi = (letter: string, hand: 'L' | 'R' | 'O' | '?', finger: '1' | '2' | '3' | '4' | '5') => {
        const nextCode = hand === 'O' ? 'T1' : hand === '?' ? '?' : `${hand}${finger}`;
        setPatternEditorMap(m => ({ ...m, [letter]: nextCode }));
    };

    // --- RHYTHM PATTERNS ---
    const tonyRhythm = useMemo(() => ({
        id: 'tony_default',
        name: "Tony's Rhythm",
        groupsRow1: TONY_GROUPS_ROW1,
        groupsRow2: TONY_GROUPS_ROW2,
    }), []);

    const selectedRhythmPattern = useMemo<RhythmPattern | null>(() => {
        const patterns = localData.rhythmPatterns || [];
        const id = localData.selectedRhythmPatternId;
        if (!id) return null;
        return patterns.find(p => p.id === id) || null;
    }, [localData.rhythmPatterns, localData.selectedRhythmPatternId]);

    const activeRhythm = useMemo(() => {
        return selectedRhythmPattern ? {
            groupsRow1: selectedRhythmPattern.groupsRow1,
            groupsRow2: selectedRhythmPattern.groupsRow2,
            name: selectedRhythmPattern.name,
        } : {
            groupsRow1: tonyRhythm.groupsRow1,
            groupsRow2: tonyRhythm.groupsRow2,
            name: tonyRhythm.name,
        };
    }, [selectedRhythmPattern, tonyRhythm.groupsRow1, tonyRhythm.groupsRow2, tonyRhythm.name]);

    const selectRhythm = (idOrNull: string | null) => {
        setLocalData(d => ({ ...d, selectedRhythmPatternId: idOrNull }));
    };

    const [rhythmEditorOpen, setRhythmEditorOpen] = useState(false);
    const [rhythmEditorId, setRhythmEditorId] = useState<string | null>(null);
    const [rhythmEditorName, setRhythmEditorName] = useState('');
    const [rhythmRow1End, setRhythmRow1End] = useState('p');
    const [rhythmRow1Splits, setRhythmRow1Splits] = useState<boolean[]>([]);
    const [rhythmRow2Splits, setRhythmRow2Splits] = useState<boolean[]>([]);

    const buildSplitsFromGroups = (groups: string[][]): boolean[] => {
        const letters = groups.flat();
        if (letters.length <= 1) return [];
        const splits = new Array(letters.length - 1).fill(false);
        let cursor = 0;
        for (let gi = 0; gi < groups.length - 1; gi++) {
            cursor += groups[gi].length;
            if (cursor - 1 >= 0 && cursor - 1 < splits.length) splits[cursor - 1] = true;
        }
        return splits;
    };

    const buildGroupsFromLettersAndSplits = (letters: string[], splits: boolean[]): string[][] => {
        if (letters.length === 0) return [];
        const out: string[][] = [];
        let group: string[] = [letters[0]];
        for (let i = 0; i < letters.length - 1; i++) {
            const shouldSplit = Boolean(splits[i]);
            const nextLetter = letters[i + 1];
            if (shouldSplit) {
                out.push(group);
                group = [nextLetter];
            } else {
                group.push(nextLetter);
            }
        }
        out.push(group);
        return out;
    };

    const openCreateRhythm = () => {
        setRhythmEditorId(null);
        setRhythmEditorName('');
        setRhythmRow1End('p');
        const row1Letters = alphaLetters.slice(0, alphaLetters.indexOf('p') + 1);
        const row2Letters = alphaLetters.slice(alphaLetters.indexOf('p') + 1);
        setRhythmRow1Splits(new Array(Math.max(0, row1Letters.length - 1)).fill(false));
        setRhythmRow2Splits(new Array(Math.max(0, row2Letters.length - 1)).fill(false));
        setRhythmEditorOpen(true);
    };

    const openEditRhythm = (pattern: RhythmPattern) => {
        setRhythmEditorId(pattern.id);
        setRhythmEditorName(pattern.name);
        const row1Letters = pattern.groupsRow1.flat();
        const row2Letters = pattern.groupsRow2.flat();
        setRhythmRow1End(row1Letters[row1Letters.length - 1] || 'p');
        setRhythmRow1Splits(buildSplitsFromGroups(pattern.groupsRow1));
        setRhythmRow2Splits(buildSplitsFromGroups(pattern.groupsRow2));
        setRhythmEditorOpen(true);
    };

    const deleteRhythm = (id: string) => {
        if (!window.confirm('Delete this rhythm pattern?')) return;
        setLocalData(d => {
            const patterns = (d.rhythmPatterns || []).filter(p => p.id !== id);
            const selected = d.selectedRhythmPatternId === id ? null : d.selectedRhythmPatternId;
            return { ...d, rhythmPatterns: patterns, selectedRhythmPatternId: selected };
        });
    };

    const saveRhythm = () => {
        const name = rhythmEditorName.trim();
        if (!name) return;

        const now = Date.now();
        const id = rhythmEditorId || (globalThis.crypto?.randomUUID?.() ?? `rp_${now}_${Math.random().toString(16).slice(2)}`);
        const endIdx = alphaLetters.indexOf((rhythmRow1End || 'p').toLowerCase());
        const splitIdx = endIdx === -1 ? alphaLetters.indexOf('p') : endIdx;
        const row1Letters = alphaLetters.slice(0, splitIdx + 1);
        const row2Letters = alphaLetters.slice(splitIdx + 1);
        const row1 = buildGroupsFromLettersAndSplits(row1Letters, rhythmRow1Splits);
        const row2 = buildGroupsFromLettersAndSplits(row2Letters, rhythmRow2Splits);

        const next: RhythmPattern = {
            id,
            name,
            groupsRow1: row1,
            groupsRow2: row2,
            createdAt: rhythmEditorId ? (localData.rhythmPatterns?.find(p => p.id === rhythmEditorId)?.createdAt ?? now) : now,
            updatedAt: now,
        };

        setLocalData(d => {
            const patterns = d.rhythmPatterns || [];
            const exists = patterns.some(p => p.id === id);
            const updatedPatterns = exists ? patterns.map(p => p.id === id ? next : p) : [next, ...patterns];
            return { ...d, rhythmPatterns: updatedPatterns, selectedRhythmPatternId: d.selectedRhythmPatternId || null };
        });

        setRhythmEditorOpen(false);
        setRhythmEditorId(null);
        setRhythmEditorName('');
    };

    const renderRhythmTemplate = (groupsRow1: string[][], groupsRow2: string[][]) => {
        const renderGroup = (letters: string[]) => (
            <div className="flex flex-wrap items-center gap-2 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2">
                {letters.map(ch => (
                    <div key={ch} className="px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                        <span className="font-mono font-black text-slate-800 dark:text-white">{ch.toUpperCase()}</span>
                    </div>
                ))}
            </div>
        );

        return (
            <div className="space-y-3">
                <div className="flex flex-wrap gap-3">{groupsRow1.map((g, idx) => <div key={`rr1_${idx}`}>{renderGroup(g)}</div>)}</div>
                <div className="flex flex-wrap gap-3">{groupsRow2.map((g, idx) => <div key={`rr2_${idx}`}>{renderGroup(g)}</div>)}</div>
            </div>
        );
    };

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
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm ${((map[ch] || '?').startsWith('L')) ? 'fingering-L' : ((map[ch] || '?').startsWith('R') ? 'fingering-R' : 'bg-slate-500 text-white')}`}>{map[ch] || '?'}</span>
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
        if (!specializedPractice.enabled) return [] as string[];
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
        if (!specializedPractice.enabled) return [] as Array<{ letter: string; attempts: number; correct: number; mistakes: number; accuracy: number; avg: number | null; }>;

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

        {showSplash && (
            <div
                className={
                    'fixed inset-0 z-[1000] bg-white text-slate-950 flex items-center justify-center px-6 ' +
                    (splashLeaving ? 'opacity-0 transition-opacity duration-300' : 'opacity-100')
                }
            >
                <div className="w-full max-w-md text-center">
                    <div className="mx-auto h-14 w-14">
                        <img src="/logo.svg" alt={`${APP_NAME} logo`} className="h-14 w-14" draggable={false} />
                    </div>
                    <div className="mt-5 text-5xl font-black tracking-tight text-slate-950">{APP_NAME}</div>
                    <div className="mt-2 text-sm font-bold uppercase tracking-[0.24em] text-slate-500">{APP_TAGLINE}</div>
                    <div className="mt-10 text-xs font-semibold text-slate-400">
                        {APP_MAKER_LINE}
                    </div>
                    <div className="mt-3 h-1 w-20 mx-auto rounded-full bg-gradient-to-r from-blue-600 via-cyan-500 to-indigo-500" />
                </div>
            </div>
        )}

        <div
            className={
                professionalMode
                    ? 'safe-shell relative h-[100dvh] w-full flex justify-center bg-gradient-to-b from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 overflow-x-hidden overflow-y-auto'
                    : 'safe-shell h-[100dvh] w-full flex justify-center bg-slate-50 dark:bg-slate-950 overflow-x-hidden overflow-y-auto'
            }
        >
        {professionalMode && (
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full bg-gradient-to-br from-blue-400/25 via-cyan-300/15 to-transparent blur-3xl" />
                <div className="absolute -bottom-56 -right-56 h-[720px] w-[720px] rounded-full bg-gradient-to-tr from-indigo-400/20 via-blue-400/10 to-transparent blur-3xl" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(148,163,184,0.18)_1px,transparent_0)] [background-size:24px_24px] opacity-30 dark:opacity-15" />
            </div>
        )}
        <div
            className={
                professionalMode
                    ? 'relative w-full max-w-6xl bg-white/80 dark:bg-slate-900/70 shadow-2xl rounded-none sm:rounded-3xl p-4 sm:p-6 md:p-8 mt-0 mb-0 sm:mt-4 sm:mb-4 border border-slate-200/70 dark:border-slate-800/80 ring-1 ring-slate-200/60 dark:ring-slate-700/60 backdrop-blur-xl'
                    : 'w-full max-w-6xl bg-white dark:bg-slate-900 shadow-2xl rounded-none sm:rounded-2xl p-4 sm:p-6 md:p-8 mt-0 mb-0 sm:mt-4 sm:mb-4 border border-slate-200 dark:border-slate-800'
            }
        >
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 border-b border-slate-100 dark:border-slate-700 pb-4">
                <div>
                    {professionalMode && (
                        <div className="relative">
                            <div className="pointer-events-none absolute -inset-x-6 -inset-y-3 rounded-3xl bg-gradient-to-r from-blue-500/15 via-cyan-400/10 to-indigo-500/15 blur-2xl" />
                        </div>
                    )}
                    <div className="flex items-center gap-3">
                        <img
                            src="/logo.svg"
                            alt={`${APP_NAME} logo`}
                            className={professionalMode ? 'h-9 w-9 drop-shadow-sm' : 'h-8 w-8'}
                            draggable={false}
                        />
                        <div className="leading-tight">
                            <h1 className="text-2xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-cyan-500">
                                {APP_NAME}
                            </h1>
                            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{APP_TAGLINE}</div>
                        </div>
                    </div>
                </div>
                <div className="flex flex-wrap gap-3 items-center">
                    <div className="flex items-center gap-3 bg-slate-100/80 dark:bg-slate-800/60 text-slate-700 dark:text-slate-100 text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div className="uppercase tracking-wide">Professional Mode</div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={professionalMode}
                            onClick={() => {
                                professionalModeDirtyRef.current = true;
                                bumpLocalUpdatedAt();
                                setProfessionalMode(v => {
                                    const next = !v;
                                    professionalModeRef.current = next;
                                    return next;
                                });
                            }}
                            className={
                                'relative inline-flex h-6 w-11 items-center rounded-full transition ' +
                                (professionalMode ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700')
                            }
                        >
                            <span
                                className={
                                    'inline-block h-5 w-5 transform rounded-full bg-white transition ' +
                                    (professionalMode ? 'translate-x-5' : 'translate-x-1')
                                }
                            />
                        </button>
                    </div>
                    <div className="relative">
                        <select
                            value={localData.currentProfile}
                            onChange={e => {
                                bumpLocalUpdatedAt();
                                const value = e.target.value;
                                setLocalData(d => ({ ...d, currentProfile: value }));
                            }}
                            className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-white text-sm font-bold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 outline-none appearance-none pr-8 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition w-32"
                        >
                            {localData.profiles.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                         <div className="absolute right-2 top-1/2 transform -translate-y-1/2 pointer-events-none text-slate-400 text-xs">▼</div>
                    </div>
                    <div className="relative">
                        <select
                            value={localData.currentDevice}
                            onChange={e => {
                                bumpLocalUpdatedAt();
                                const value = e.target.value;
                                setLocalData(d => ({ ...d, currentDevice: value }));
                            }}
                            className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-white text-sm font-bold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 outline-none appearance-none pr-8 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition w-32"
                        >
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
            <div
                className={
                    professionalMode
                        ? 'flex flex-wrap sm:flex-nowrap sm:overflow-x-auto overflow-x-visible gap-2 mb-6 text-[11px] font-black uppercase tracking-wide bg-white/70 dark:bg-slate-900/50 border border-slate-200/70 dark:border-slate-700/60 rounded-2xl p-1 backdrop-blur whitespace-normal sm:whitespace-nowrap'
                        : 'flex flex-wrap sm:flex-nowrap sm:overflow-x-auto overflow-x-visible gap-3 sm:gap-6 mb-6 text-sm font-bold uppercase tracking-wide whitespace-normal sm:whitespace-nowrap px-1'
                }
            >
                <button
                    onClick={() => { bumpLocalUpdatedAt(); setView('practice'); }}
                    className={
                        professionalMode
                            ? (view === 'practice'
                                ? 'px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-sm'
                                : 'px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100/70 dark:hover:bg-slate-800/60 transition')
                            : (view === 'practice' ? 'active-tab pb-2' : 'inactive-tab pb-2 hover:text-blue-500 transition')
                    }
                >
                    Practice & Record
                </button>
                <button
                    onClick={() => { bumpLocalUpdatedAt(); setView('fingerPatterns'); }}
                    className={
                        professionalMode
                            ? (view === 'fingerPatterns'
                                ? 'px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-sm'
                                : 'px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100/70 dark:hover:bg-slate-800/60 transition')
                            : (view === 'fingerPatterns' ? 'active-tab pb-2' : 'inactive-tab pb-2 hover:text-blue-500 transition')
                    }
                >
                    Finger Pattern Practice
                </button>
                <button
                    onClick={() => { bumpLocalUpdatedAt(); setView('analytics'); }}
                    className={
                        professionalMode
                            ? (view === 'analytics'
                                ? 'px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-sm'
                                : 'px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100/70 dark:hover:bg-slate-800/60 transition')
                            : (view === 'analytics' ? 'active-tab pb-2' : 'inactive-tab pb-2 hover:text-blue-500 transition')
                    }
                >
                    Analytics & Coach
                </button>
                <button
                    onClick={() => { bumpLocalUpdatedAt(); setView('history'); }}
                    className={
                        professionalMode
                            ? (view === 'history'
                                ? 'px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-sm'
                                : 'px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100/70 dark:hover:bg-slate-800/60 transition')
                            : (view === 'history' ? 'active-tab pb-2' : 'inactive-tab pb-2 hover:text-blue-500 transition')
                    }
                >
                    Run History
                </button>
                <button
                    onClick={() => { bumpLocalUpdatedAt(); setView('about'); }}
                    className={
                        professionalMode
                            ? (view === 'about'
                                ? 'px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-sm'
                                : 'px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100/70 dark:hover:bg-slate-800/60 transition')
                            : (view === 'about' ? 'active-tab pb-2' : 'inactive-tab pb-2 hover:text-blue-500 transition')
                    }
                >
                    About
                </button>
                <button
                    onClick={() => { bumpLocalUpdatedAt(); setView('account'); }}
                    className={
                        professionalMode
                            ? (view === 'account'
                                ? 'px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-sm'
                                : 'px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100/70 dark:hover:bg-slate-800/60 transition')
                            : (view === 'account' ? 'active-tab pb-2' : 'inactive-tab pb-2 hover:text-blue-500 transition')
                    }
                >
                    Account{user ? ' •' : ''}
                </button>
            </div>
            
             {/* Views */}
            <div className={view !== 'practice' ? 'hidden' : ''}>
                {/* PRACTICE VIEW */}
                <div className="flex flex-wrap sm:flex-nowrap justify-start gap-2 mb-6 bg-slate-100 dark:bg-slate-800 p-2 rounded-xl w-full overflow-x-visible sm:overflow-x-auto whitespace-normal sm:whitespace-nowrap">
                    {(['classic', 'backwards', 'spaces', 'backwards-spaces', 'blank', 'flash', 'guinness'] as GameMode[]).map(m => (
                        <button key={m} onClick={() => resetGame(m)} className={`px-4 py-2 rounded-lg text-[11px] font-bold transition whitespace-nowrap ${settings.mode === m ? 'bg-white dark:bg-slate-700 shadow text-blue-600 dark:text-blue-300 scale-105' : 'text-slate-500 hover:bg-white/50'}`}>
                             {modeLabel(m)}
                        </button>
                    ))}
                </div>
                
                <div className="flex flex-wrap justify-center gap-3 mb-8 text-sm">
                   {['classic', 'guinness'].includes(settings.mode) && 
                        <label className="flex items-center gap-2 cursor-pointer bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                            <input type="checkbox" checked={currentProfileSettings.tonysRhythm} onChange={e => handleProfileSettingChange('tonysRhythm', e.target.checked)} className="accent-blue-500" />
                            <span className="font-semibold text-slate-600 dark:text-slate-300">Rhythm Pattern</span>
                        </label>
                   }

                   {currentProfileSettings.tonysRhythm && ['classic', 'guinness'].includes(settings.mode) && (
                        <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                            <span className="font-semibold text-slate-600 dark:text-slate-300">Pattern</span>
                            <select
                                value={localData.selectedRhythmPatternId || ''}
                                onChange={(e) => selectRhythm(e.target.value || null)}
                                className="bg-transparent text-slate-700 dark:text-white text-sm font-bold outline-none"
                            >
                                <option value="">Tony's Rhythm</option>
                                {(localData.rhythmPatterns || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </div>
                   )}

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
                            checked={specializedPractice.enabled}
                            onChange={(e) => {
                                bumpLocalUpdatedAt();
                                const enabled = e.target.checked;
                                setSettings(s => ({
                                    ...s,
                                    specializedPractice: {
                                        ...s.specializedPractice,
                                        enabled,
                                    }
                                }));
                                resetGame();
                            }}
                            className="accent-blue-500"
                        />
                        <span className="font-semibold text-slate-600 dark:text-slate-300">Specialized Practice</span>
                    </label>

                    {specializedPractice.enabled && (
                        <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                            <span className="font-semibold text-slate-600 dark:text-slate-300">Range</span>
                            <select
                                value={specializedPractice.start.toLowerCase()}
                                onChange={(e) => {
                                    bumpLocalUpdatedAt();
                                    const start = e.target.value;
                                    setSettings(s => ({
                                        ...s,
                                        specializedPractice: {
                                            ...s.specializedPractice,
                                            start,
                                        }
                                    }));
                                    resetGame();
                                }}
                                className="bg-transparent text-slate-700 dark:text-white text-sm font-bold outline-none"
                            >
                                {alphaLetters.map(l => <option key={`sp_s_${l}`} value={l}>{l.toUpperCase()}</option>)}
                            </select>
                            <span className="text-slate-400 font-bold">–</span>
                            <select
                                value={specializedPractice.end.toLowerCase()}
                                onChange={(e) => {
                                    bumpLocalUpdatedAt();
                                    const end = e.target.value;
                                    setSettings(s => ({
                                        ...s,
                                        specializedPractice: {
                                            ...s.specializedPractice,
                                            end,
                                        }
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
                            <input type="checkbox" checked={settings.blind} onChange={e => { bumpLocalUpdatedAt(); setSettings({...settings, blind: e.target.checked}); }} className="accent-blue-500" />
                            <span className="font-semibold text-slate-600 dark:text-slate-300">Blind Mode</span>
                        </label>
                   }
                   <label className="flex items-center gap-2 cursor-pointer bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                        <input
                            type="checkbox"
                            checked={settings.sound}
                            onChange={e => {
                                const next = e.target.checked;
                                bumpLocalUpdatedAt();
                                setSettings(s => ({ ...s, sound: next }));
                                if (next) void ensureAudioContext();
                            }}
                            className="accent-blue-500"
                        />
                        <span className="font-semibold text-slate-600 dark:text-slate-300">Enable Sound</span>
                    </label>
                   <label className="flex items-center gap-2 cursor-pointer bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                        <input type="checkbox" checked={settings.voice} onChange={e => { bumpLocalUpdatedAt(); setSettings({...settings, voice: e.target.checked}); }} className="accent-blue-500" />
                        <span className="font-semibold text-slate-600 dark:text-slate-300">Voice Announce</span>
                    </label>
                </div>
                
                 <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                    <div className="bg-slate-50 dark:bg-slate-850 p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
                        <div className="text-[10px] uppercase font-bold text-slate-400">
                            {specializedPractice.enabled
                                ? `Specialized Record (${specializedPractice.start.toUpperCase()}–${specializedPractice.end.toUpperCase()})`
                                : `Device Record (${modeLabel(settings.mode)})`}
                        </div>
                        <div className="text-2xl font-black text-blue-500 font-mono">{specializedPractice.enabled ? (specializedRecord || '--') : deviceRecord}</div>
                        {specializedPractice.enabled ? (
                            <div className="mt-1 text-[10px] uppercase tracking-widest font-bold text-slate-400">Full {modeLabel(settings.mode)} record: {deviceRecord}</div>
                        ) : (
                            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                                {deviceRecordsByMode
                                    .filter(r => r.mode !== settings.mode)
                                    .map(r => (
                                        <div key={r.mode} className="flex items-baseline justify-between gap-2">
                                            <span className="font-bold text-slate-500 dark:text-slate-400">{modeLabel(r.mode)}</span>
                                            <span className="font-mono font-black text-slate-700 dark:text-slate-200">{r.timeText}</span>
                                        </div>
                                    ))}
                            </div>
                        )}
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
                    style={{ touchAction: 'manipulation' }}
                    onPointerDown={() => {
                        if (!gameState.finished) {
                            requestKeyboard();
                            setTimeout(requestKeyboard, 0);
                        }
                        ensureAudioContext();
                    }}
                    onTouchStart={() => {
                        if (!gameState.finished) {
                            requestKeyboard();
                            setTimeout(requestKeyboard, 0);
                        }
                        ensureAudioContext();
                    }}
                    onClick={() => {
                        if (!gameState.finished) {
                            requestKeyboard();
                            setTimeout(requestKeyboard, 0);
                        }
                        ensureAudioContext();
                    }}
                >
                    {settings.mode !== 'blank' && (
                        <textarea
                            ref={hiddenInputRef}
                            className="absolute inset-0 w-full h-full opacity-0 text-transparent caret-transparent"
                            inputMode="text"
                            autoCorrect="off"
                            autoCapitalize="off"
                            autoComplete="off"
                            spellCheck={false}
                            aria-hidden="true"
                            onChange={handleHiddenInputChange}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    resetGame();
                                }
                            }}
                        />
                    )}
                    {countdown && 
                        <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center backdrop-blur-sm">
                            <div className="text-7xl sm:text-9xl font-black text-white animate-pulse">{countdown}</div>
                        </div>
                    }

                    <div className={`w-full flex justify-center items-center transition-all ${settings.blind && settings.mode !== 'blank' ? 'blind-mode' : ''}`}>
                       {settings.mode === 'flash' && <div id="flash-letter" className="text-slate-800 dark:text-white transition-colors duration-100">{targetSequence[gameState.index]?.toUpperCase() || 'A'}</div>}
                       {settings.mode === 'blank' && (
                        <textarea
                            ref={blankInputRef}
                            value={targetSequence.slice(0, gameState.index).join('')}
                            onChange={handleBlankInputChange}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    resetGame();
                                }
                            }}
                            className="w-full h-full p-4 text-2xl font-mono resize-none rounded-lg bg-slate-50 dark:bg-slate-850 text-slate-800 dark:text-white border-2 border-slate-300 dark:border-slate-700 focus:border-blue-500 outline-none"
                            autoCorrect="off"
                            autoCapitalize="off"
                            autoComplete="off"
                            spellCheck={false}
                            rows={5}
                            placeholder="Start typing sequence..."
                        />
                       )}
                       {['classic', 'guinness', 'backwards', 'spaces', 'backwards-spaces'].includes(settings.mode) && (
                            <>
                                {currentProfileSettings.tonysRhythm && ['classic', 'guinness'].includes(settings.mode) ? (
                                    <div className="w-full flex flex-col items-center gap-3">
                                        <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400">{activeRhythm.name}</div>
                                        <div className="flex flex-col gap-3">
                                            {[activeRhythm.groupsRow1, activeRhythm.groupsRow2].map((row, rowIdx) => (
                                                <div key={`rh_row_${rowIdx}`} className="flex flex-wrap justify-center gap-3">
                                                    {row.map((group, gi) => {
                                                        const filtered = group.filter(ch => targetSequence.includes(ch));
                                                        if (filtered.length === 0) return null;
                                                        return (
                                                            <div key={`rh_g_${rowIdx}_${gi}`} className="flex flex-wrap justify-center gap-2 bg-white/60 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2">
                                                                {filtered.map(ch => {
                                                                    const idx = targetSequence.indexOf(ch);
                                                                    const code = activeFingeringMap[ch] || '?';
                                                                    const data: FingeringDataItem = { char: ch, code };
                                                                    return (
                                                                        <LetterBox
                                                                            key={`${ch}_${idx}`}
                                                                            data={data}
                                                                            index={idx}
                                                                            currentIndex={gameState.index}
                                                                            showFingering={currentProfileSettings.fingering}
                                                                            isCorrect={idx < gameState.index}
                                                                        />
                                                                    );
                                                                })}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap justify-center gap-2 max-w-4xl">
                                        {targetSequence.map((char, i) => {
                                            const code = activeFingeringMap[char] || '?';
                                            const data: FingeringDataItem = { char, code };
                                            return <LetterBox key={i} data={data} index={i} currentIndex={gameState.index} showFingering={currentProfileSettings.fingering} isCorrect={i < gameState.index} />
                                        })}
                                    </div>
                                )}
                            </>
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

                    {specializedPractice.enabled && (
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
                            <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">Per-letter finger</div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {alphaLetters.map(letter => {
                                    const ui = getFingerUi(patternEditorMap[letter]);
                                    const activeBtn = 'bg-blue-600 text-white';
                                    const inactiveBtn = 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700';
                                    return (
                                        <div key={`fp_${letter}`} className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2">
                                            <div className="font-mono font-black text-slate-800 dark:text-white">{letter.toUpperCase()}</div>
                                            <div className="flex items-center gap-2">
                                                <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                                                    <button type="button" onClick={() => setFingerUi(letter, 'L', ui.finger)} className={`px-2 py-1 text-xs font-black ${ui.hand === 'L' ? activeBtn : inactiveBtn}`}>L</button>
                                                    <button type="button" onClick={() => setFingerUi(letter, 'R', ui.finger)} className={`px-2 py-1 text-xs font-black ${ui.hand === 'R' ? activeBtn : inactiveBtn}`}>R</button>
                                                    <button type="button" onClick={() => setFingerUi(letter, 'O', ui.finger)} className={`px-2 py-1 text-xs font-black ${ui.hand === 'O' ? activeBtn : inactiveBtn}`}>Other</button>
                                                    <button type="button" onClick={() => setFingerUi(letter, '?', ui.finger)} className={`px-2 py-1 text-xs font-black ${ui.hand === '?' ? activeBtn : inactiveBtn}`}>?</button>
                                                </div>

                                                {(ui.hand === 'L' || ui.hand === 'R') ? (
                                                    <select
                                                        value={ui.finger}
                                                        onChange={(e) => setFingerUi(letter, ui.hand, e.target.value as any)}
                                                        className="px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-white text-xs font-black outline-none"
                                                        aria-label={`${letter.toUpperCase()} finger`}
                                                    >
                                                        <option value="1">1</option>
                                                        <option value="2">2</option>
                                                        <option value="3">3</option>
                                                        <option value="4">4</option>
                                                        <option value="5">5</option>
                                                    </select>
                                                ) : (
                                                    <span className="px-2 py-1 rounded-lg bg-white/70 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-[10px] font-black text-slate-500 dark:text-slate-300">
                                                        {ui.hand === 'O' ? 'T1' : '--'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
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

                {/* RHYTHM PATTERNS */}
                <div className="mt-8">
                    <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Rhythm Patterns (Classic / Guinness)</div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Default</div>
                                    <div className="text-lg font-black text-slate-800 dark:text-white">Tony's Rhythm</div>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => selectRhythm(null)} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-bold hover:bg-blue-700">Use in Practice</button>
                                    <button onClick={() => setView('about')} className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-3 py-2 rounded-lg text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700">About Tony</button>
                                </div>
                            </div>

                            <div className="mt-4">{renderRhythmTemplate(TONY_GROUPS_ROW1, TONY_GROUPS_ROW2)}</div>
                        </div>

                        <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-xs font-bold uppercase tracking-widest text-slate-400">My Rhythms</div>
                                    <div className="text-lg font-black text-slate-800 dark:text-white">Custom Patterns</div>
                                </div>
                                <button onClick={openCreateRhythm} className="bg-green-600 text-white px-3 py-2 rounded-lg text-xs font-bold hover:bg-green-700">New Rhythm</button>
                            </div>

                            {(localData.rhythmPatterns || []).length === 0 ? (
                                <div className="mt-4 text-sm text-slate-500 dark:text-slate-400">No custom rhythms yet. Build one like “Bob's Rhythm”.</div>
                            ) : (
                                <div className="mt-4 space-y-2">
                                    {(localData.rhythmPatterns || []).map(p => (
                                        <div key={p.id} className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2">
                                            <div className="min-w-0">
                                                <div className="font-bold text-slate-800 dark:text-white truncate">{p.name}</div>
                                                <div className="text-[11px] text-slate-500 dark:text-slate-400">Updated {new Date(p.updatedAt).toLocaleDateString()}</div>
                                            </div>
                                            <div className="flex gap-2 flex-none">
                                                <button onClick={() => selectRhythm(p.id)} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-bold hover:bg-blue-700">Use</button>
                                                <button onClick={() => openEditRhythm(p)} className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-3 py-2 rounded-lg text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700">Edit</button>
                                                <button onClick={() => deleteRhythm(p.id)} className="bg-red-600 text-white px-3 py-2 rounded-lg text-xs font-bold hover:bg-red-700">Delete</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {selectedRhythmPattern && (
                        <div className="mt-6 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Selected</div>
                                    <div className="text-lg font-black text-slate-800 dark:text-white">{selectedRhythmPattern.name}</div>
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">Shown when Rhythm Pattern is enabled in Practice.</div>
                            </div>
                            <div className="mt-4">{renderRhythmTemplate(selectedRhythmPattern.groupsRow1, selectedRhythmPattern.groupsRow2)}</div>
                        </div>
                    )}

                    {rhythmEditorOpen && (
                        <div className="mt-6 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-lg font-black text-slate-800 dark:text-white">{rhythmEditorId ? 'Edit Rhythm' : 'New Rhythm'}</div>
                                <button onClick={() => { setRhythmEditorOpen(false); setRhythmEditorId(null); }} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 text-xs font-bold uppercase">Close</button>
                            </div>

                            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Name</label>
                                    <input value={rhythmEditorName} onChange={e => setRhythmEditorName(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500" placeholder="Bob's Rhythm" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Row 1 ends at</label>
                                    <select
                                        value={rhythmRow1End}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            setRhythmRow1End(v);
                                            const endIdx = alphaLetters.indexOf(v);
                                            const row1Letters = alphaLetters.slice(0, (endIdx === -1 ? alphaLetters.indexOf('p') : endIdx) + 1);
                                            const row2Letters = alphaLetters.slice((endIdx === -1 ? alphaLetters.indexOf('p') : endIdx) + 1);
                                            setRhythmRow1Splits(new Array(Math.max(0, row1Letters.length - 1)).fill(false));
                                            setRhythmRow2Splits(new Array(Math.max(0, row2Letters.length - 1)).fill(false));
                                        }}
                                        className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        {alphaLetters.map(l => <option key={`r1end_${l}`} value={l}>{l.toUpperCase()}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div className="mt-5">
                                <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">Build groups (toggle splits between letters)</div>

                                {(() => {
                                    const endIdx = alphaLetters.indexOf(rhythmRow1End);
                                    const splitIdx = endIdx === -1 ? alphaLetters.indexOf('p') : endIdx;
                                    const row1Letters = alphaLetters.slice(0, splitIdx + 1);
                                    const row2Letters = alphaLetters.slice(splitIdx + 1);

                                    const renderRow = (letters: string[], splits: boolean[], setSplits: (next: boolean[]) => void, label: string) => (
                                        <div className="mb-4">
                                            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">{label}</div>
                                            <div className="flex flex-wrap items-center gap-1 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3">
                                                {letters.map((l, i) => (
                                                    <React.Fragment key={`${label}_${l}`}
                                                    >
                                                        <div className="px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono font-black text-slate-800 dark:text-white">{l.toUpperCase()}</div>
                                                        {i < letters.length - 1 && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const next = [...splits];
                                                                    next[i] = !next[i];
                                                                    setSplits(next);
                                                                }}
                                                                className={`w-2 h-8 rounded-full border ${splits[i] ? 'bg-blue-600 border-blue-700' : 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600'}`}
                                                                title={splits[i] ? 'Split here' : 'No split'}
                                                                aria-label={`Toggle split after ${l.toUpperCase()}`}
                                                            />
                                                        )}
                                                    </React.Fragment>
                                                ))}
                                            </div>
                                        </div>
                                    );

                                    return (
                                        <>
                                            {renderRow(row1Letters, rhythmRow1Splits, setRhythmRow1Splits, 'Row 1')}
                                            {renderRow(row2Letters, rhythmRow2Splits, setRhythmRow2Splits, 'Row 2')}
                                        </>
                                    );
                                })()}
                            </div>

                            <div className="mt-5 flex gap-2">
                                <button
                                    onClick={saveRhythm}
                                    disabled={!rhythmEditorName.trim()}
                                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 disabled:bg-blue-400"
                                >
                                    Save Rhythm
                                </button>
                                <button
                                    onClick={() => {
                                        setRhythmRow1End('p');
                                        const row1Letters = alphaLetters.slice(0, alphaLetters.indexOf('p') + 1);
                                        const row2Letters = alphaLetters.slice(alphaLetters.indexOf('p') + 1);
                                        setRhythmRow1Splits(new Array(Math.max(0, row1Letters.length - 1)).fill(false));
                                        setRhythmRow2Splits(new Array(Math.max(0, row2Letters.length - 1)).fill(false));
                                    }}
                                    className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-bold hover:bg-slate-200 dark:hover:bg-slate-700"
                                >
                                    Reset
                                </button>
                            </div>
                        </div>
                    )}
                </div>
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
                                 <tr key={r.timestamp} className={`hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${(!r.specialized?.enabled && r.time === personalBestTime) ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}>
                                    <td className="px-3 sm:px-4 py-2 text-[10px] sm:text-xs uppercase font-bold text-blue-500 whitespace-nowrap">
                                        {modeLabel(r.mode)}
                                        {r.specialized?.enabled ? ` [${r.specialized.start.toUpperCase()}-${r.specialized.end.toUpperCase()}]` : ''}
                                        {r.blind ? ' (Blind)' : ''}
                                    </td>
                                    <td className="hidden sm:table-cell px-3 sm:px-4 py-2 text-xs text-slate-500">
                                        <div>{r.device}</div>
                                        {r.deviceLabel && <div className="text-[10px] text-slate-400">{r.deviceLabel}</div>}
                                    </td>
                                    <td className="px-3 sm:px-4 py-2 font-mono font-bold whitespace-nowrap">
                                        {r.time.toFixed(2)}s
                                        {!r.specialized?.enabled && r.time === personalBestTime && <span className="ml-2 text-amber-500" title="Personal Best">★</span>}
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

                        <div className="mt-5 text-sm text-slate-500 dark:text-slate-400">
                            Company: <a className="underline font-bold" href="https://yunova.org" target="_blank" rel="noreferrer">yunova.org</a>
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

            <div className={view !== 'account' ? 'hidden' : ''}>
                {/* ACCOUNT VIEW */}
                <div className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl p-6 md:p-8">
                    <div className="max-w-2xl">
                        <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Account</div>
                        <h2 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900 dark:text-white mt-1">Login & Cloud Sync</h2>

                        {!firebaseEnabled ? (
                            <div className="mt-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-5">
                                <div className="text-sm font-bold text-slate-800 dark:text-slate-200">Not configured</div>
                                <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                                    Firebase environment variables are missing. Cloud login/sync is disabled until configured.
                                </div>
                                <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                                    If you just edited <span className="font-mono">.env.local</span>, stop the dev server and restart <span className="font-mono">npm run dev</span>.
                                </div>
                                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                                    <div className={`rounded-lg border px-3 py-2 ${firebaseStatus.apiKey ? 'border-green-300 bg-green-50 dark:border-green-900/50 dark:bg-green-900/20' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'}`}>
                                        <div className="font-bold text-slate-600 dark:text-slate-300">VITE_FIREBASE_API_KEY</div>
                                        <div className="text-slate-500 dark:text-slate-400">{firebaseStatus.apiKey ? 'Detected' : 'Missing'}</div>
                                    </div>
                                    <div className={`rounded-lg border px-3 py-2 ${firebaseStatus.authDomain ? 'border-green-300 bg-green-50 dark:border-green-900/50 dark:bg-green-900/20' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'}`}>
                                        <div className="font-bold text-slate-600 dark:text-slate-300">VITE_FIREBASE_AUTH_DOMAIN</div>
                                        <div className="text-slate-500 dark:text-slate-400">{firebaseStatus.authDomain ? 'Detected' : 'Missing'}</div>
                                    </div>
                                    <div className={`rounded-lg border px-3 py-2 ${firebaseStatus.projectId ? 'border-green-300 bg-green-50 dark:border-green-900/50 dark:bg-green-900/20' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'}`}>
                                        <div className="font-bold text-slate-600 dark:text-slate-300">VITE_FIREBASE_PROJECT_ID</div>
                                        <div className="text-slate-500 dark:text-slate-400">{firebaseStatus.projectId ? 'Detected' : 'Missing'}</div>
                                    </div>
                                    <div className={`rounded-lg border px-3 py-2 ${firebaseStatus.appId ? 'border-green-300 bg-green-50 dark:border-green-900/50 dark:bg-green-900/20' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'}`}>
                                        <div className="font-bold text-slate-600 dark:text-slate-300">VITE_FIREBASE_APP_ID</div>
                                        <div className="text-slate-500 dark:text-slate-400">{firebaseStatus.appId ? 'Detected' : 'Missing'}</div>
                                    </div>
                                </div>
                                <div className="mt-3 text-[11px] text-slate-400">
                                    Mode: <span className="font-mono">{String(firebaseStatus.mode || '')}</span> · Dev: <span className="font-mono">{firebaseStatus.dev ? 'true' : 'false'}</span>
                                </div>
                            </div>
                        ) : user ? (
                            <div className="mt-5 space-y-4">
                                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-5">
                                    <div className="text-sm font-bold text-slate-800 dark:text-slate-200">Signed in</div>
                                    <div className="mt-1 text-sm text-slate-600 dark:text-slate-300 break-all">{user.email || user.uid}</div>

                                    <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                                        Support: <a className="underline" href="/support.html" target="_blank" rel="noreferrer">support</a> ·
                                        Privacy: <a className="underline" href="/privacy.html" target="_blank" rel="noreferrer">privacy policy</a>
                                    </div>

                                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                                        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                                            <div className="text-[10px] uppercase font-bold text-slate-400">Sync</div>
                                            <div className="text-sm font-black text-slate-800 dark:text-white">
                                                {syncStatus === 'off' ? 'Off' : syncStatus === 'syncing' ? 'Syncing…' : syncStatus === 'error' ? 'Error' : 'On'}
                                            </div>
                                        </div>
                                        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                                            <div className="text-[10px] uppercase font-bold text-slate-400">Last Sync</div>
                                            <div className="text-sm font-black text-slate-800 dark:text-white">
                                                {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : '—'}
                                            </div>
                                        </div>
                                        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                                            <div className="text-[10px] uppercase font-bold text-slate-400">Providers</div>
                                            <div className="text-sm font-black text-slate-800 dark:text-white">Email</div>
                                        </div>
                                    </div>

                                    {syncError && (
                                        <div className="mt-3 text-sm text-red-600 dark:text-red-400">{syncError}</div>
                                    )}
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={() => void pushNow('manual')}
                                        className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 disabled:bg-blue-400"
                                        disabled={syncStatus === 'syncing'}
                                    >
                                        Sync Now
                                    </button>
                                    <button
                                        onClick={() =>
                                            void (async () => {
                                                try {
                                                    const { signOutUser } = await loadAuthService();
                                                    await signOutUser();
                                                } catch (e) {
                                                    console.warn('Sign out failed:', e);
                                                }
                                            })()
                                        }
                                        className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-bold hover:bg-slate-200 dark:hover:bg-slate-700"
                                    >
                                        Sign Out
                                    </button>

                                    <button
                                        onClick={() =>
                                            void (async () => {
                                                if (!user) return;
                                                const ok = window.confirm(
                                                    'Delete account?\n\nThis permanently deletes your cloud sync data and your account. This cannot be undone.'
                                                );
                                                if (!ok) return;

                                                setAuthBusy(true);
                                                setAuthError(null);
                                                setAuthNotice(null);

                                                try {
                                                    const { deleteCloudEnvelope } = await loadCloudSync();
                                                    await deleteCloudEnvelope(user.uid);

                                                    const { deleteCurrentUser } = await loadAuthService();
                                                    await deleteCurrentUser();

                                                    setAuthNotice('Account deleted.');
                                                } catch (e: any) {
                                                    console.warn('Account deletion failed:', e);
                                                    setAuthError(formatFirebaseAuthError(e));
                                                } finally {
                                                    setAuthBusy(false);
                                                }
                                            })()
                                        }
                                        disabled={authBusy}
                                        className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-red-700 disabled:bg-red-400"
                                    >
                                        Delete Account
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="mt-5 space-y-4">
                                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-5">
                                    <div className="text-sm font-bold text-slate-800 dark:text-slate-200">Sign in / Sign up</div>
                                    <div className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                                        Recommended: use <span className="font-bold">Google sign-in</span> on web for the smoothest cross-device login. Email/password works too, but can be finicky (password reset emails may land in Spam, and autofill/extra spaces can cause sign-in errors).
                                    </div>
                                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Email</label>
                                            <input
                                                value={authEmail}
                                                onChange={(e) => setAuthEmail(e.target.value)}
                                                type="email"
                                                autoComplete="email"
                                                className="w-full mt-1 px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Password</label>
                                            <input
                                                value={authPassword}
                                                onChange={(e) => setAuthPassword(e.target.value)}
                                                type="password"
                                                autoComplete="current-password"
                                                className="w-full mt-1 px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                    </div>

                                    {authError && (
                                        <div className="mt-3 text-sm text-red-600 dark:text-red-400">{authError}</div>
                                    )}

                                    {authNotice && (
                                        <div className="mt-3 text-sm text-green-600 dark:text-green-400">{authNotice}</div>
                                    )}

                                    <div className="mt-4 flex flex-wrap gap-2">
                                        <button
                                            onClick={async () => {
                                                setAuthBusy(true);
                                                setAuthError(null);
                                                setAuthNotice(null);
                                                try {
                                                    const email = authEmail.trim().toLowerCase();
                                                    const { signInWithEmail } = await loadAuthService();
                                                    await signInWithEmail(email, authPassword);
                                                } catch (e: any) {
                                                    console.warn('Email sign-in failed:', e);
                                                    setAuthError(formatFirebaseAuthError(e));
                                                } finally {
                                                    setAuthBusy(false);
                                                }
                                            }}
                                            disabled={authBusy || !authEmail.trim() || !authPassword}
                                            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 disabled:bg-blue-400"
                                        >
                                            Sign In
                                        </button>
                                        <button
                                            onClick={async () => {
                                                setAuthBusy(true);
                                                setAuthError(null);
                                                setAuthNotice(null);
                                                try {
                                                    const email = authEmail.trim().toLowerCase();
                                                    const { signUpWithEmail } = await loadAuthService();
                                                    await signUpWithEmail(email, authPassword);
                                                } catch (e: any) {
                                                    console.warn('Email sign-up failed:', e);
                                                    setAuthError(formatFirebaseAuthError(e));
                                                } finally {
                                                    setAuthBusy(false);
                                                }
                                            }}
                                            disabled={authBusy || !authEmail.trim() || !authPassword}
                                            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-green-700 disabled:bg-green-400"
                                        >
                                            Create Account
                                        </button>
                                        <button
                                            onClick={async () => {
                                                setAuthBusy(true);
                                                setAuthError(null);
                                                setAuthNotice(null);
                                                try {
                                                    const email = authEmail.trim().toLowerCase();
                                                    const { resetPassword } = await loadAuthService();
                                                    await resetPassword(email);
                                                    setAuthNotice('Password reset requested. If the account exists, you will receive an email (check Spam/Junk).');
                                                } catch (e: any) {
                                                    console.warn('Password reset failed:', e);
                                                    setAuthError(formatFirebaseAuthError(e));
                                                } finally {
                                                    setAuthBusy(false);
                                                }
                                            }}
                                            disabled={authBusy || !authEmail.trim()}
                                            className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-bold hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50"
                                        >
                                            Forgot Password
                                        </button>
                                    </div>
                                </div>

                                {canUseOAuthOnThisPlatform && (
                                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
                                        <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Or</div>
                                        <button
                                            onClick={async () => {
                                                setAuthBusy(true);
                                                setAuthError(null);
                                                try {
                                                    const { signInWithGoogleWeb } = await loadAuthService();
                                                    await signInWithGoogleWeb();
                                                } catch (e: any) {
                                                    // Popup blocked may trigger redirect. Either way, show a minimal message.
                                                    console.warn('Google sign-in failed:', e);
                                                    setAuthError(formatFirebaseAuthError(e));
                                                } finally {
                                                    setAuthBusy(false);
                                                }
                                            }}
                                            disabled={authBusy}
                                            className="mt-3 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-slate-800 disabled:bg-slate-600"
                                        >
                                            Continue with Google (Web)
                                        </button>

                                        <button
                                            onClick={async () => {
                                                setAuthBusy(true);
                                                setAuthError(null);
                                                try {
                                                    const { signInWithAppleWeb } = await loadAuthService();
                                                    await signInWithAppleWeb();
                                                } catch (e: any) {
                                                    console.warn('Apple sign-in failed:', e);
                                                    setAuthError(formatFirebaseAuthError(e));
                                                } finally {
                                                    setAuthBusy(false);
                                                }
                                            }}
                                            disabled={authBusy}
                                            className="mt-2 bg-black text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-slate-900 disabled:bg-slate-600"
                                        >
                                            Continue with Apple (Web)
                                        </button>

                                        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                            iOS uses email/password for now (Google/Apple sign-in needs extra native setup).
                                        </div>
                                    </div>
                                )}

                                {!canUseOAuthOnThisPlatform && (
                                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
                                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                            iOS uses email/password for now (Google/Apple sign-in needs extra native setup).
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Footer / Copyright */}
            <div className="mt-12 pt-8 border-t border-slate-100 dark:border-slate-800 text-center">
                <p className="text-sm font-bold text-slate-400 dark:text-slate-600">
                    Made with ❤️ by <span className="text-blue-500">Xiaoyu Tang</span> @ <span className="text-slate-700 dark:text-slate-400 font-black">YUNOVA, LLC</span>
                </p>
                <p className="text-[10px] uppercase tracking-widest text-slate-300 dark:text-slate-700 mt-2">
                    © {new Date().getFullYear()} YUNOVA, LLC. All Rights Reserved.
                </p>
            </div>

        </div>

        {/* RESULTS MODAL */}
        {resultsModalOpen && 
            <div className="modal-safe fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 backdrop-blur-md transition-opacity">
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-slate-200 dark:border-slate-700 transform transition-all scale-100 mx-auto max-h-[calc(100dvh-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-y-auto">
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
            <div className="modal-safe fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 backdrop-blur-md transition-opacity">
                  <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 max-w-lg w-full border border-slate-200 dark:border-slate-700 transform transition-all scale-100 mx-auto max-h-[calc(100dvh-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-y-auto">
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

        </div>
        </>
    );
};

export default App;
