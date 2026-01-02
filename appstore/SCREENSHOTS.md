# AlphaTyper — Screenshot Checklist

We now auto-generate App Store–style screenshots + an App Preview video.

## Final assets (use these)
- **iPad 12.9 landscape screenshots (ship these):** `appstore/final/screenshots/ipad-12.9-landscape/`
- **iPad 12.9 portrait screenshots (backup):** `appstore/final/screenshots/ipad-12.9/`
- **iPhone 6.7 screenshots (ship these):** `appstore/final/screenshots/iphone-6.7/`
- **iPhone 6.1 screenshots (optional fallback):** `appstore/final/screenshots/iphone-6.1/`
- **App Preview videos (MP4):**
	- iPad: `appstore/final/videos/ipad-12.9-landscape/app-preview.mp4`
	- iPhone 6.7: `appstore/final/videos/iphone-6.7/app-preview.mp4`

To regenerate the final export:
```zsh
EXPORT_FINAL=1 EXPORT_MP4=1 npm run screenshots
```

## How many screenshots to upload?
- Apple allows **up to 10** per device size.
- Recommended: **6–8** (strong story, no filler).
- You can upload all 10 now, then delete the weaker ones later.

Current iPad landscape options (pick your favorites):
- `01-practice-fingering.png`
- `02-time-results.png`
- `03-analytics-splits.png`
- `04-customize-patterns.png`
- `05-modes-backwards-spaces.png`
- `06-specialized-practice.png`
- `07-blind-mode.png`
- `08-rhythm-pattern.png`
- `09-run-history.png`
- `10-challenge-grid.png`

## Device sizes
- iPad: we’re generating **iPad 12.9"** right now.
- iPhone: we’re generating **6.7\"** (primary) and **6.1\"** (optional fallback).

## Notes
- Keep one orientation per device size (we’re shipping **landscape** for iPad).
- VS Code may not preview WebM; use the MP4 in `appstore/final/videos/...`.

## Legacy option
If you prefer manual Simulator screenshots later, this doc can be extended again — but the automated set should be good enough to ship.
