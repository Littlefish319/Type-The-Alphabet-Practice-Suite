<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# AlphaTyper

AlphaTyper is a practice + analytics tool for typing the alphabet faster.

## Account Login + Cloud Sync (Optional)

The app can optionally support signing in and syncing your data across devices via Firebase.

### Firebase Setup

1. Create a Firebase project.
2. Enable **Authentication** providers:
   - Email/Password
   - Google (optional; currently used on web only)
   - Apple (optional; currently used on web only)
3. Create a **Cloud Firestore** database.
4. Add a Web App in Firebase and copy its config values into your local env file.

Create `.env.local` (you can start from `.env.example`) and set:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

When Firebase env vars are not set, the app still works normally, but the `Account` tab will show "Not configured" and cloud sync will be disabled.

### iOS Note

Email/password works on both web and the Capacitor iOS build.

Google/Apple sign-in for iOS is not enabled in this repo yet (it requires native configuration). If you want Google sign-in inside iOS, Apple will also require **Sign in with Apple**.

### Apple Sign-In (Web) Prerequisites

Apple sign-in on web requires Apple-side configuration. In most cases you need an **Apple Developer Program** membership so you can create:

- A **Service ID** (your web client identifier)
- A **Sign in with Apple Key** (Key ID + private key)

Then in Firebase Console → Authentication → Sign-in method → Apple:

- Enable Apple
- Provide the Service ID, Team ID, Key ID, and private key
- Add the Firebase **redirect URL** to your Service ID configuration on Apple's side

Also ensure Firebase Console → Authentication → Settings → Authorized domains includes:

- `localhost` (for local dev)
- Your production domain(s)

If Apple isn't configured, the app will show a Firebase auth error when you click “Continue with Apple (Web)”.

### Password Reset Troubleshooting

If “Forgot Password” doesn't result in an email:

- Check Spam/Junk and any corporate email quarantine
- Verify Firebase Console → Authentication → Sign-in method → **Email/Password** is enabled
- Ensure the email entered is correct (typos/extra spaces)
- In the browser DevTools Console, look for a log like `Password reset failed:` to see the Firebase error code (e.g. `auth/user-not-found`, `auth/invalid-email`, `auth/unauthorized-domain`)

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. (Optional) Set `VITE_GEMINI_API_KEY` in `.env.local` to your Gemini API key (only needed for the AI Coach)
3. Run the app:
   `npm run dev`

## Deploy (Cloudflare Pages)

1. Add environment variables (Project → Settings → Environment variables):
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_APP_ID`
   - (optional) `VITE_GEMINI_API_KEY`
2. In Firebase Console → Authentication → Settings → Authorized domains:
   - Add your Cloudflare Pages domain (and any custom domain)
   - Keep `localhost` for local dev
3. Build command: `npm run build`
4. Output directory: `dist`
