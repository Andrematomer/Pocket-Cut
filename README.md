# Pocket Cut

Quick video edits on your phone, without a 2 GB app: **trim, speed up, rotate, crop, join** clips and
**export as several files of a fixed length** (for example 60-second parts for Instagram Stories).

Runs entirely in the browser as an installable offline app (PWA). No account, no upload, no watermark, no ads.

**Open it:** https://andrematomer.github.io/PWA-video-editor/ (the address changes if you rename the repo)

## Install on your phone

- **Android (Chrome):** menu → Install app.
- **iPhone / iPad (Safari):** Share → Add to Home Screen. Do this rather than using it as a normal tab: Safari deletes
  the stored data of websites you haven't opened for 7 days, but as far as is known not that of Home Screen apps.

After the first visit it works with no connection.

## What it does

| | |
|---|---|
| Trim | Drag the ends of the bar, or set start/end at the playhead. Cut a clip in two. |
| Speed | 0.25× to 4×. The sound keeps its pitch. |
| Rotate | 90° steps. |
| Crop | Free, or locked to 9:16, 4:5, 1:1, 16:9. |
| Join | Add several videos, reorder, duplicate, remove. |
| Export | MP4, 480p / 720p / 1080p, 24 / 30 / 60 fps. Choose the shape (9:16, 4:5, 1:1, 16:9 or follow the first clip) and whether pictures fit with bars or fill the frame. |
| **Split** | Off, 15 s, 30 s, 60 s or a custom length. Optionally make all parts the same length. Parts are cut on exact frame boundaries, so nothing is lost or repeated at the seams. |

Your last project (with the original videos) is kept on the device until you delete it in the settings.

## Known limits

- It needs a browser with WebCodecs (Chrome/Edge/Android Chrome, Safari 16.4+). Other browsers can't export.
- The codecs depend on the device. It uses H.264 + AAC when available and tells you when it has to fall back.
- Exporting runs on the main thread: keep the screen on and the app open until it finishes. Long 1080p exports are slow on old phones.
- Each output part is held in memory while it is written, so very long parts at 1080p / 60 fps can run out of memory on low-end phones. Shorter parts help.
- A web app can't run while it is closed, so the saved project is never cleaned up automatically. Use the delete button.
- The preview pauses briefly between two different source files. The exported video has no gap.

## Develop

```
npm install
npm run dev      # dev server (no offline cache in dev)
npm test         # unit tests: crop, rotation, splitting, pitch-preserving speed
npm run build    # type-check + production build into dist/, including the service worker
```

Preact + TypeScript + Vite. Decoding and encoding use WebCodecs through [Mediabunny](https://mediabunny.dev) (MPL-2.0).
Pushes to `main` deploy to GitHub Pages through `.github/workflows/pages.yml`.
The icon is `public/icons/icon.svg`; `node scripts/make-icons.cjs` redraws the PNG sizes (needs Playwright).

The export approach (WebCodecs, Mediabunny, canvas rendering) comes from the author's Win-Movie-Faker project.
