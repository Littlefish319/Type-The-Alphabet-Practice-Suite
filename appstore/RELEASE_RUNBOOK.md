# AlphaTyper — Release Runbook (TestFlight → App Store)

Use this once your Apple Developer Program enrollment is active.

## 1) Xcode signing (required)
In Xcode:
- Open `ios/App/App.xcodeproj`
- Target: `App`
- Signing & Capabilities:
  - Team: select your team
  - Automatically manage signing: ON
  - Bundle Identifier: `com.yunova.alphabettypingsuite`

## 2) Version/build numbers
In Target → General:
- Version: `1.0.0` (example)
- Build: `1` (increment for every upload)

## 3) Create the app in App Store Connect
In App Store Connect:
- My Apps → + → New App
  - Platform: iOS
  - Name: AlphaTyper
  - Bundle ID: `com.yunova.alphabettypingsuite`
  - SKU: `alphatyper-001` (any unique string)
  - User Access: Full Access

### 3a) iPad + Mac availability (recommended)
- iPad: in Xcode Target → General, ensure the app supports both iPhone + iPad (this project already targets `1,2`).
- Mac (Apple silicon): after your first build is uploaded, enable the App Store Connect option to make the iPhone/iPad app available on Mac computers with Apple silicon (if eligible).
  - Common blockers: requiring phone-only hardware features or setting restrictive `UIRequiredDeviceCapabilities` in `Info.plist`.

Fill required metadata:
- Privacy Policy URL: `https://alphatyper.vercel.app/privacy.html`
- Support URL: `https://alphatyper.vercel.app/support.html`
- Description/subtitle/keywords: see `appstore/APP_STORE_COPY.md`

## 4) App Privacy (nutrition label)
In App Store Connect → App Privacy:
- Disclose whether you collect:
  - Identifiers (email if login)
  - User Content (AI coach text if used)
  - Diagnostics (if any)

Tip: keep disclosures aligned with what the app actually does (optional features still count if users can use them).

## 5) Upload a build to TestFlight
In Xcode:
- Product → Archive
- Distribute App → App Store Connect → Upload

Then in App Store Connect:
- TestFlight → pick the build → add internal testers

## 6) Screenshots
Upload screenshots listed in `appstore/SCREENSHOTS.md`.

## 7) Submit for review
- Complete remaining required fields (age rating, export compliance, etc.)
- Provide review notes (from `appstore/APP_STORE_COPY.md`)
- Submit
