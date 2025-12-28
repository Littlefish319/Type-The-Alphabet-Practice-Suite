import { deleteDoc, doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import type { LocalData, Settings } from '../types';
import { getDbIfConfigured } from './firebase';

export interface CloudEnvelope {
    schemaVersion: 1;
    updatedAt: number;
    localData: LocalData;
    settings: Settings;
}

const docRefForUser = (uid: string) => {
    const db = getDbIfConfigured();
    if (!db) throw new Error('Firebase is not configured.');
    return doc(db, 'users', uid, 'appData', 'main');
};

export const pullCloudEnvelope = async (uid: string): Promise<CloudEnvelope | null> => {
    const snap = await getDoc(docRefForUser(uid));
    if (!snap.exists()) return null;
    const data = snap.data() as Partial<CloudEnvelope>;
    if (!data || typeof data.updatedAt !== 'number' || !data.localData || !data.settings) return null;
    return {
        schemaVersion: 1,
        updatedAt: data.updatedAt,
        localData: data.localData as LocalData,
        settings: data.settings as Settings,
    };
};

export const pushCloudEnvelope = async (uid: string, envelope: CloudEnvelope): Promise<void> => {
    await setDoc(docRefForUser(uid), envelope, { merge: false });
};

export const deleteCloudEnvelope = async (uid: string): Promise<void> => {
    await deleteDoc(docRefForUser(uid));
};

export const subscribeCloudEnvelope = (
    uid: string,
    cb: (env: CloudEnvelope | null) => void
): (() => void) => {
    return onSnapshot(docRefForUser(uid), (snap) => {
        if (!snap.exists()) {
            cb(null);
            return;
        }
        const data = snap.data() as Partial<CloudEnvelope>;
        if (!data || typeof data.updatedAt !== 'number' || !data.localData || !data.settings) {
            cb(null);
            return;
        }
        cb({
            schemaVersion: 1,
            updatedAt: data.updatedAt,
            localData: data.localData as LocalData,
            settings: data.settings as Settings,
        });
    });
};
