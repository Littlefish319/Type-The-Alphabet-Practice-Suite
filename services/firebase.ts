import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const env = (import.meta as any).env || {};

const readFirebaseEnv = () => {
    return {
        apiKey: String(env.VITE_FIREBASE_API_KEY || ''),
        authDomain: String(env.VITE_FIREBASE_AUTH_DOMAIN || ''),
        projectId: String(env.VITE_FIREBASE_PROJECT_ID || ''),
        storageBucket: String(env.VITE_FIREBASE_STORAGE_BUCKET || ''),
        messagingSenderId: String(env.VITE_FIREBASE_MESSAGING_SENDER_ID || ''),
        appId: String(env.VITE_FIREBASE_APP_ID || ''),
    };
};

export const isFirebaseConfigured = (): boolean => {
    const cfg = readFirebaseEnv();
    return Boolean(
        cfg.apiKey &&
        cfg.authDomain &&
        cfg.projectId &&
        cfg.appId
    );
};

export const firebaseEnvStatus = () => {
    const cfg = readFirebaseEnv();
    const apiKey = Boolean(cfg.apiKey);
    const authDomain = Boolean(cfg.authDomain);
    const projectId = Boolean(cfg.projectId);
    const appId = Boolean(cfg.appId);
    return {
        apiKey,
        authDomain,
        projectId,
        appId,
        configured: apiKey && authDomain && projectId && appId,
        mode: env.MODE,
        dev: Boolean(env.DEV),
    };
};

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let cachedDb: Firestore | null = null;

export const ensureFirebase = (): { app: FirebaseApp; auth: Auth; db: Firestore } | null => {
    if (!isFirebaseConfigured()) return null;
    if (cachedApp && cachedAuth && cachedDb) return { app: cachedApp, auth: cachedAuth, db: cachedDb };

    const cfg = readFirebaseEnv();

    const firebaseConfig = {
        apiKey: cfg.apiKey,
        authDomain: cfg.authDomain,
        projectId: cfg.projectId,
        storageBucket: cfg.storageBucket,
        messagingSenderId: cfg.messagingSenderId,
        appId: cfg.appId,
    };

    cachedApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    cachedAuth = getAuth(cachedApp);
    cachedDb = getFirestore(cachedApp);
    return { app: cachedApp, auth: cachedAuth, db: cachedDb };
};

export const getAuthIfConfigured = (): Auth | null => {
    return ensureFirebase()?.auth ?? null;
};

export const getDbIfConfigured = (): Firestore | null => {
    return ensureFirebase()?.db ?? null;
};
