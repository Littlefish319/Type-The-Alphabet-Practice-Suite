
import type { GameState, FingeringDataItem, LocalData, Settings, ProfileSettings, GameMode, SpecializedPracticeSettings } from './types';

export const STORAGE_KEY = 'az_speed_suite_data_react';
export const MAX_ENTRIES = 20;
export const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

export const FINGERING_DATA: FingeringDataItem[] = [
    { char: 'a', code: 'L5' }, { char: 'b', code: 'R1' }, { char: 'c', code: 'L2' }, { char: 'd', code: 'L3' },
    { char: 'e', code: 'L4' }, { char: 'f', code: 'R2' }, { char: 'g', code: 'R3' }, { char: 'h', code: 'R4' },
    { char: 'i', code: 'R3' }, { char: 'j', code: 'R2' }, { char: 'k', code: 'R3' }, { char: 'l', code: 'R4' },
    { char: 'm', code: 'R3' }, { char: 'n', code: 'R2' }, { char: 'o', code: 'R4' }, { char: 'p', code: 'R5' },
    { char: 'q', code: 'L4' }, { char: 'r', code: 'R2' }, { char: 's', code: 'L2' }, { char: 't', code: 'R3' },
    { char: 'u', code: 'R5' }, { char: 'v', code: 'R1' }, { char: 'w', code: 'L3' }, { char: 'x', code: 'R2' },
    { char: 'y', code: 'R5' }, { char: 'z', code: 'L1' }, { char: ' ', code: 'T1' }
];

export const TONY_GROUPS_ROW1 = [['a'], ['b'], ['c', 'd', 'e'], ['f', 'g', 'h'], ['i', 'j', 'k', 'l'], ['m', 'n'], ['o', 'p']];
export const TONY_GROUPS_ROW2 = [['q'], ['r'], ['s'], ['t'], ['u'], ['v'], ['w', 'x', 'y'], ['z']];

export const INITIAL_GAME_STATE: GameState = {
    started: false,
    finished: false,
    index: 0,
    startTime: 0,
    lastTime: 0,
    mistakes: 0,
    timingLog: [],
    mistakeLog: [],
};

const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
    tonysRhythm: false,
    fingering: false,
};

export const DEFAULT_LOCAL_DATA: LocalData = {
    profiles: ["Tony"],
    devices: ["Magic Keyboard", "Window Keyboard", "Touchscreen"],
    currentProfile: "Tony",
    currentDevice: "Magic Keyboard",
    history: [],
    profileSettings: {
        "Tony": DEFAULT_PROFILE_SETTINGS
    },
    fingerPatterns: [],
    selectedFingerPatternId: null,
};

export const DEFAULT_SETTINGS: Settings = {
    mode: "classic",
    blind: false,
    voice: false,
    sound: true,
    specializedPractice: {
        enabled: false,
        start: 'a',
        end: 'z',
    }
};

const getAlphabetRange = (start: string, end: string): string[] => {
    const alpha = ALPHABET.split('');
    const startIdx = alpha.indexOf((start || '').toLowerCase());
    const endIdx = alpha.indexOf((end || '').toLowerCase());
    if (startIdx === -1 || endIdx === -1) return alpha;
    const a = Math.min(startIdx, endIdx);
    const b = Math.max(startIdx, endIdx);
    return alpha.slice(a, b + 1);
};

export const getTargetSequence = (mode: GameMode, specialized?: SpecializedPracticeSettings): string[] => {
    const alpha = specialized?.enabled ? getAlphabetRange(specialized.start, specialized.end) : ALPHABET.split('');
    switch (mode) {
        case 'backwards':
            return [...alpha].reverse();
        case 'spaces':
            return alpha.flatMap((c, i) => i === alpha.length - 1 ? [c] : [c, ' ']);
        case 'backwards-spaces':
            const reversed = [...alpha].reverse();
            return reversed.flatMap((c, i) => i === reversed.length - 1 ? [c] : [c, ' ']);
        case 'classic':
        case 'blank':
        case 'flash':
        case 'guinness':
        default:
            return alpha;
    }
};
