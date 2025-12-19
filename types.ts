
export type GameMode = 'classic' | 'blank' | 'flash' | 'guinness' | 'backwards' | 'spaces' | 'backwards-spaces';
export type View = 'practice' | 'analytics' | 'history';

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

export interface Run {
    time: number;
    mistakes: number;
    mode: GameMode;
    profile: string;
    device: string;
    blind: boolean;
    note: string;
    timestamp: number;
    log: TimingLogEntry[];
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
}

export interface Settings {
    mode: GameMode;
    blind: boolean;
    voice: boolean;
    sound: boolean;
}

export interface GameState {
    started: boolean;
    finished: boolean;
    index: number;
    startTime: number;
    lastTime: number;
    mistakes: number;
    timingLog: TimingLogEntry[];
}

export interface ChatMessage {
    sender: 'ai' | 'user';
    text: string;
}
