
export type GameMode = 'classic' | 'blank' | 'flash' | 'guinness' | 'backwards' | 'spaces' | 'backwards-spaces';
export type View = 'practice' | 'clickSpeed' | 'rankings' | 'fingerPatterns' | 'analytics' | 'history' | 'about' | 'account';

export type FingerCode = string;

export interface FingerPattern {
    id: string;
    name: string;
    map: Record<string, FingerCode>;
    createdAt: number;
    updatedAt: number;
}

export interface RhythmPattern {
    id: string;
    name: string;
    groupsRow1: string[][];
    groupsRow2: string[][];
    createdAt: number;
    updatedAt: number;
}

export interface SpecializedPracticeSettings {
    enabled: boolean;
    start: string;
    end: string;
}

export interface FingeringDataItem {
    char: string;
    code: string;
}

export interface TimingLogEntry {
    char: string;
    duration: number;
    total: number;
    prev: string;
}

export interface MistakeLogEntry {
    target: string;
    typed: string;
}

export interface Run {
    id?: string;
    time: number;
    mistakes: number;
    mode: GameMode;
    profile: string;
    device: string;
    deviceId?: string;
    deviceLabel?: string;
    platform?: 'web' | 'ios' | 'android' | 'unknown';
    blind: boolean;
    note: string;
    timestamp: number;
    log: TimingLogEntry[];

    // Optional fields for backwards compatibility with older stored runs.
    mistakeLog?: MistakeLogEntry[];
    specialized?: SpecializedPracticeSettings;
}

export interface ProfileSettings {
    tonysRhythm: boolean;
    fingering: boolean;
}

export interface LocalData {
    profiles: string[];
    devices: string[];
    currentProfile: string;
    currentDevice: string;
    history: Run[];
    profileSettings: { [profile: string]: ProfileSettings };

    // Custom finger patterns
    fingerPatterns?: FingerPattern[];
    selectedFingerPatternId?: string | null;

    // Custom rhythm patterns
    rhythmPatterns?: RhythmPattern[];
    selectedRhythmPatternId?: string | null;

    // Click speed test
    clickSpeed?: {
        bestByDurationMs: Record<string, number>; // durationMs -> best CPS
        recent: Array<{ durationMs: number; count: number; cps: number; timestamp: number }>;
    };
}

export interface Settings {
    mode: GameMode;
    blind: boolean;
    voice: boolean;
    sound: boolean;

    specializedPractice: SpecializedPracticeSettings;

    // Optional user-configured benchmarks for quick comparison.
    worldRecords?: Partial<Record<GameMode, number>>;

    // Optional source links for the benchmarks above.
    worldRecordLinks?: Partial<Record<GameMode, string>>;

    leaderboard?: {
        enabled: boolean;
        displayName: string;
    };
}

export interface GameState {
    started: boolean;
    finished: boolean;
    index: number;
    startTime: number;
    lastTime: number;
    mistakes: number;
    timingLog: TimingLogEntry[];

    mistakeLog: MistakeLogEntry[];
}

export interface ChatMessage {
    sender: 'ai' | 'user';
    text: string;
}
