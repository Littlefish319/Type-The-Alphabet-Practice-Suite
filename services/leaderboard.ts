import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    type DocumentData,
} from 'firebase/firestore';
import type { GameMode } from '../types';
import { getDbIfConfigured } from './firebase';

export type LeaderboardMode = Exclude<GameMode, 'flash' | 'blank'> | 'flash' | 'blank';

export interface LeaderboardEntry {
    uid: string;
    displayName: string;
    mode: GameMode;
    bestTime: number; // seconds
    updatedAt: number; // ms
}

const modeCollection = (mode: GameMode) => {
    const db = getDbIfConfigured();
    if (!db) throw new Error('Firebase is not configured.');
    return collection(db, 'leaderboards', mode, 'entries');
};

export const upsertLeaderboardBestTime = async (params: {
    uid: string;
    mode: GameMode;
    bestTime: number;
    displayName: string;
}): Promise<void> => {
    const { uid, mode, bestTime, displayName } = params;
    const entries = modeCollection(mode);
    const ref = doc(entries, uid);

    const snap = await getDoc(ref);
    const existing = snap.exists() ? (snap.data() as Partial<DocumentData>) : null;
    const prev = typeof existing?.bestTime === 'number' ? Number(existing.bestTime) : Infinity;

    // Only improve.
    if (bestTime >= prev) return;

    await setDoc(
        ref,
        {
            uid,
            mode,
            displayName: String(displayName || 'User').slice(0, 32),
            bestTime,
            updatedAt: Date.now(),
            serverUpdatedAt: serverTimestamp(),
        },
        { merge: true }
    );
};

export const fetchLeaderboardTop = async (params: { mode: GameMode; n: number }): Promise<LeaderboardEntry[]> => {
    const { mode, n } = params;
    const entries = modeCollection(mode);
    const q = query(entries, orderBy('bestTime', 'asc'), limit(Math.max(1, Math.min(200, n))));
    const snap = await getDocs(q);
    const out: LeaderboardEntry[] = [];

    snap.forEach((d) => {
        const data = d.data() as any;
        const bestTime = Number(data?.bestTime);
        if (!Number.isFinite(bestTime) || bestTime <= 0) return;
        out.push({
            uid: String(data?.uid || d.id),
            mode,
            displayName: String(data?.displayName || 'User'),
            bestTime,
            updatedAt: typeof data?.updatedAt === 'number' ? data.updatedAt : 0,
        });
    });

    return out;
};
