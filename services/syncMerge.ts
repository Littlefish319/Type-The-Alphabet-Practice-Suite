import type { LocalData, Run, Settings, FingerPattern, RhythmPattern } from '../types';

const fnv1a = (input: string): string => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(36);
};

const stableRunId = (run: Run): string => {
    const base = [
        run.timestamp,
        run.device,
        run.profile,
        run.mode,
        run.time,
        run.mistakes,
        run.blind ? 1 : 0,
        run.note || '',
        run.log?.length || 0,
    ].join('|');
    return `r_${fnv1a(base)}`;
};

export const ensureRunIds = (history: Run[]): Run[] => {
    let changed = false;
    const next = history.map((r) => {
        if (r.id) return r;
        changed = true;
        return { ...r, id: stableRunId(r) };
    });
    return changed ? next : history;
};

const pickBetterRun = (a: Run, b: Run): Run => {
    if (!a) return b;
    if (!b) return a;

    const merged: Run = { ...a };

    if ((b.note || '').length > (a.note || '').length) merged.note = b.note;

    const aLogLen = a.log?.length || 0;
    const bLogLen = b.log?.length || 0;
    if (bLogLen > aLogLen) merged.log = b.log;

    if (!merged.mistakeLog && b.mistakeLog) merged.mistakeLog = b.mistakeLog;
    if (!merged.specialized && b.specialized) merged.specialized = b.specialized;

    return merged;
};

const uniq = (arr: string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of arr) {
        if (!v) continue;
        if (seen.has(v)) continue;
        seen.add(v);
        out.push(v);
    }
    return out;
};

const mergePatternsById = <T extends { id: string; updatedAt: number }>(
    primary: T[] | undefined,
    secondary: T[] | undefined
): T[] | undefined => {
    const a = primary || [];
    const b = secondary || [];
    if (a.length === 0 && b.length === 0) return primary || secondary;

    const map = new Map<string, T>();
    for (const item of a) map.set(item.id, item);
    for (const item of b) {
        const existing = map.get(item.id);
        if (!existing || item.updatedAt > existing.updatedAt) map.set(item.id, item);
    }

    return Array.from(map.values()).sort((x, y) => y.updatedAt - x.updatedAt);
};

export const mergeLocalData = (primary: LocalData, secondary: LocalData): LocalData => {
    const primaryHistory = ensureRunIds(primary.history || []);
    const secondaryHistory = ensureRunIds(secondary.history || []);

    const historyById = new Map<string, Run>();
    for (const r of [...primaryHistory, ...secondaryHistory]) {
        const id = r.id || stableRunId(r);
        const existing = historyById.get(id);
        historyById.set(id, existing ? pickBetterRun(existing, { ...r, id }) : { ...r, id });
    }

    const mergedHistory = Array.from(historyById.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const mergedProfiles = uniq([...(primary.profiles || []), ...(secondary.profiles || [])]);
    const mergedDevices = uniq([...(primary.devices || []), ...(secondary.devices || [])]);

    const mergedProfileSettings = { ...(secondary.profileSettings || {}), ...(primary.profileSettings || {}) };

    const fingerPatterns = mergePatternsById<FingerPattern>(primary.fingerPatterns, secondary.fingerPatterns);
    const rhythmPatterns = mergePatternsById<RhythmPattern>(primary.rhythmPatterns, secondary.rhythmPatterns);

    const selectedFingerPatternId = primary.selectedFingerPatternId ?? null;
    const selectedRhythmPatternId = primary.selectedRhythmPatternId ?? null;

    const currentProfile = mergedProfiles.includes(primary.currentProfile) ? primary.currentProfile : (mergedProfiles[0] || 'Default');
    const currentDevice = mergedDevices.includes(primary.currentDevice) ? primary.currentDevice : (mergedDevices[0] || 'Default');

    return {
        ...secondary,
        ...primary,
        profiles: mergedProfiles,
        devices: mergedDevices,
        currentProfile,
        currentDevice,
        history: mergedHistory,
        profileSettings: mergedProfileSettings,
        fingerPatterns: fingerPatterns || [],
        selectedFingerPatternId,
        rhythmPatterns: rhythmPatterns || [],
        selectedRhythmPatternId,
    };
};

export const mergeSettings = (primary: Settings, secondary: Settings): Settings => {
    return { ...secondary, ...primary };
};

const hashJson = (value: unknown): string => {
    try {
        return fnv1a(JSON.stringify(value));
    } catch {
        return String(Date.now());
    }
};

export const envelopesEqual = (
    a: { localData: LocalData; settings: Settings },
    b: { localData: LocalData; settings: Settings }
): boolean => {
    return hashJson(a.localData) === hashJson(b.localData) && hashJson(a.settings) === hashJson(b.settings);
};

export const mergeEnvelopes = <T extends { updatedAt: number; localData: LocalData; settings: Settings }>(
    local: T,
    cloud: T
): { updatedAt: number; localData: LocalData; settings: Settings; didMerge: boolean } => {
    const localIsPrimary = (local.updatedAt || 0) >= (cloud.updatedAt || 0);
    const primary = localIsPrimary ? local : cloud;
    const secondary = localIsPrimary ? cloud : local;

    const mergedLocalData = mergeLocalData(primary.localData, secondary.localData);
    const mergedSettings = mergeSettings(primary.settings, secondary.settings);

    const primaryHash = hashJson({ localData: primary.localData, settings: primary.settings });
    const mergedHash = hashJson({ localData: mergedLocalData, settings: mergedSettings });
    const didMerge = primaryHash !== mergedHash;

    const baseUpdatedAt = Math.max(local.updatedAt || 0, cloud.updatedAt || 0);
    const updatedAt = didMerge ? Date.now() : baseUpdatedAt;

    return { updatedAt, localData: mergedLocalData, settings: mergedSettings, didMerge };
};
