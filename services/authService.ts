import { Capacitor } from '@capacitor/core';
import {
    GoogleAuthProvider,
    OAuthProvider,
    createUserWithEmailAndPassword,
    getRedirectResult,
    onAuthStateChanged,
    sendPasswordResetEmail,
    signInWithEmailAndPassword,
    signInWithPopup,
    signInWithRedirect,
    signOut,
    type User,
} from 'firebase/auth';
import { getAuthIfConfigured } from './firebase';

const requireAuth = () => {
    const a = getAuthIfConfigured();
    if (!a) throw new Error('Firebase is not configured.');
    return a;
};

export const isNativePlatform = (): boolean => {
    try {
        return Capacitor.isNativePlatform();
    } catch {
        return false;
    }
};

export const canUseGoogleSignIn = (): boolean => {
    // Google sign-in in Capacitor needs extra native configuration; keep v1 simple.
    return !isNativePlatform();
};

export const canUseAppleSignIn = (): boolean => {
    // Apple sign-in in Capacitor needs extra native configuration; keep v1 simple.
    return !isNativePlatform();
};

export const watchAuth = (cb: (user: User | null) => void): (() => void) => {
    return onAuthStateChanged(requireAuth(), cb);
};

export const consumeAuthRedirectResult = async (): Promise<User | null> => {
    const auth = requireAuth();
    const res = await getRedirectResult(auth);
    return res?.user ?? null;
};

export const signUpWithEmail = async (email: string, password: string): Promise<User> => {
    const cred = await createUserWithEmailAndPassword(requireAuth(), email, password);
    return cred.user;
};

export const signInWithEmail = async (email: string, password: string): Promise<User> => {
    const cred = await signInWithEmailAndPassword(requireAuth(), email, password);
    return cred.user;
};

export const resetPassword = async (email: string): Promise<void> => {
    await sendPasswordResetEmail(requireAuth(), email);
};

export const signInWithGoogleWeb = async (): Promise<User> => {
    const auth = requireAuth();
    const provider = new GoogleAuthProvider();

    // Popup is best UX on web; if blocked, fallback to redirect.
    try {
        const cred = await signInWithPopup(auth, provider);
        return cred.user;
    } catch (e: any) {
        const code = String(e?.code || '');
        const canFallbackToRedirect =
            code === 'auth/popup-blocked' ||
            code === 'auth/popup-closed-by-user' ||
            code === 'auth/cancelled-popup-request';

        if (!canFallbackToRedirect) throw e;

        await signInWithRedirect(auth, provider);
        // Redirect will reload the page; caller can just return.
        throw new Error('Redirecting to Google sign-in...');
    }
};

export const signInWithAppleWeb = async (): Promise<User> => {
    const auth = requireAuth();
    const provider = new OAuthProvider('apple.com');

    // Popup is best UX on web; if blocked, fallback to redirect.
    try {
        const cred = await signInWithPopup(auth, provider);
        return cred.user;
    } catch (e: any) {
        const code = String(e?.code || '');
        const canFallbackToRedirect =
            code === 'auth/popup-blocked' ||
            code === 'auth/popup-closed-by-user' ||
            code === 'auth/cancelled-popup-request';

        if (!canFallbackToRedirect) throw e;

        await signInWithRedirect(auth, provider);
        throw new Error('Redirecting to Apple sign-in...');
    }
};

export const signOutUser = async (): Promise<void> => {
    await signOut(requireAuth());
};
