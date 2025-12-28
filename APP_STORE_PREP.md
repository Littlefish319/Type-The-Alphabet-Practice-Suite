# AlphaTyper — Pre‑Enrollment Prep Checklist

This checklist covers everything you can prep **before** Apple Developer enrollment/payment.

## URLs you will need in App Store Connect
- Support: `/support.html` (hosted)
- Privacy policy: `/privacy.html` (hosted)

If you deploy on Vercel, these are:
- https://alphatyper.vercel.app/support.html
- https://alphatyper.vercel.app/privacy.html

## iOS identity (already set in this repo)
- App name: `AlphaTyper`
- Bundle ID: `com.yunova.alphabettypingsuite`

## Xcode settings to confirm (once you have a Team)
In Xcode (Targets → App):
- **Signing & Capabilities**
  - Team: (select your Apple Developer Team)
  - Automatically manage signing: ON
  - Bundle Identifier: `com.yunova.alphabettypingsuite`

- **General**
  - Display Name: `AlphaTyper`
  - Version (Marketing Version): e.g. `1.0.0`
  - Build (Project Version): start at `1`, increment every upload

## Account deletion (App Review expectation)
If the app supports account creation, Apple expects a way to delete the account.
- In this repo: Account → **Delete Account** (deletes cloud data + Firebase account)

## Screenshots to prepare
At minimum, plan for iPhone screenshots. If you enable iPad distribution, add iPad screenshots too.
Suggested capture list:
- Practice screen (tabs visible)
- Analytics (slow letters)
- Run History
- Account / Cloud Sync

## Common submission questions (prepare answers)
- Does the app require login? **No** (offline works; login is optional)
- Data collection: depends on whether user enables cloud sync / AI coach
- Export compliance: typically **No** special export if you’re not shipping custom encryption (Apple will ask in App Store Connect)

## When enrollment/payment becomes required
- Required for: TestFlight uploads + App Store uploads
- Not required for: local Xcode installs on your own device
