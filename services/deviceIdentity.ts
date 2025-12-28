export type DevicePlatform = 'web' | 'ios' | 'android' | 'unknown';

export type DeviceIdentity = {
    deviceId: string;
    deviceLabel: string;
    platform: DevicePlatform;
};

const WEB_STORAGE_KEY = 'alphatyper.deviceId.v1';
const NATIVE_PREFS_KEY = 'alphatyper.deviceId.v1';

const safeRandomId = (): string => {
    // crypto.randomUUID is supported in modern browsers + iOS WKWebView.
    // Fallback is extremely unlikely to be hit, but keeps us safe.
    const anyCrypto = globalThis.crypto as any;
    if (anyCrypto?.randomUUID) return anyCrypto.randomUUID();
    return `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const detectWebPlatform = (): DevicePlatform => {
    const ua = navigator.userAgent || '';
    if (/Android/i.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    return 'web';
};

const makeWebLabel = (): string => {
    const ua = navigator.userAgent || 'Web';
    const platform = (navigator as any).platform || '';
    const shortUa = ua.length > 80 ? `${ua.slice(0, 77)}…` : ua;
    return platform ? `${platform} (${shortUa})` : shortUa;
};

export async function getDeviceIdentity(): Promise<DeviceIdentity> {
    // Native path: only load Capacitor plugins when running in Capacitor.
    try {
        const cap = await import('@capacitor/core');
        if (cap.Capacitor?.isNativePlatform?.()) {
            const [{ Preferences }, { Device }] = await Promise.all([
                import('@capacitor/preferences'),
                import('@capacitor/device'),
            ]);

            const platform = (cap.Capacitor.getPlatform?.() as DevicePlatform) ?? 'unknown';

            const existing = await Preferences.get({ key: NATIVE_PREFS_KEY });
            const deviceId = existing.value || safeRandomId();
            if (!existing.value) await Preferences.set({ key: NATIVE_PREFS_KEY, value: deviceId });

            const info = await Device.getInfo();
            const model = info.model || 'Device';
            const os = info.operatingSystem || platform;
            const osVersion = info.osVersion ? ` ${info.osVersion}` : '';
            const deviceLabel = `${model} (${os}${osVersion})`;

            return { deviceId, deviceLabel, platform };
        }
    } catch {
        // Fall through to web.
    }

    // Web path
    const platform = detectWebPlatform();
    const existing = localStorage.getItem(WEB_STORAGE_KEY);
    const deviceId = existing || safeRandomId();
    if (!existing) localStorage.setItem(WEB_STORAGE_KEY, deviceId);

    return { deviceId, deviceLabel: makeWebLabel(), platform };
}
