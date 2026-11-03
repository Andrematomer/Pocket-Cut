# Pocket Cut

> ## ⚠️ Work in progress. Not ready to use yet.
>
> This is an early test version, built to try out the idea. It is **not meant for real use**.
> It may fail to start on some phones, exports may fail or come out without sound, the look and the
> settings will change, and a saved project can be lost between versions.
> Please don't rely on it for anything important, and keep the original videos.

Ever tried to send a video to Discord and been greeted by the **5 MB limit**? Or needed to cut ten
seconds out of a clip and ended up downloading a 2 GB video editor you will never open again? Or
wanted to post a long video as Stories, only to find it cut off at the wrong second?

Pocket Cut is for those moments. It is a quick-edit tool, not a CapCut or VN clone: **trim, speed up,
place, join** clips and pictures, shrink them to a size that fits, and **export as several files of a
fixed length** (for example 60-second parts for Instagram Stories). It stays small on purpose.

Runs entirely in the browser. No account, no upload, no watermark, no ads.

**Try it:** https://andrematomer.github.io/Pocket-Cut/

It works as a normal web page. Installing it as an app is optional: that only adds offline use and
full-screen mode.

## Install on your phone (optional)

- **Android (Chrome):** menu → Install app.
- **iPhone / iPad (Safari):** Share → Add to Home Screen. If you use it often, do this rather than keeping a
  normal tab: Safari deletes the stored data of websites you haven't opened for 7 days, but as far as is
  known not that of Home Screen apps.

After the first visit it works with no connection.

## What it does

| | |
|---|---|
| Trim | Drag the yellow ends of the bar; drag elsewhere on the bar to look around; hold still while dragging for fine control. The scissors button cuts a clip in two. |
| Speed | A snapping slider from 0.25× to 4×. The voice keeps its pitch, or follows the speed if you prefer. |
| Place | Drag, pinch and twist the clip right on the preview, like an Instagram story: free move, zoom and turn, with snapping to the center, quarter turns, "fits" and "fills". Black bars appear where the picture does not cover the canvas. |
| Join | Add several videos and pictures. Press and hold a thumbnail to turn, reset, copy or delete it; the Order tab moves it earlier or later. Undo and redo are in the header. A picture shows for 5 s by default (changeable in Settings). |
| Export | MP4, 480p / 720p / 1080p, 24 / 30 / 60 fps. Choose the canvas shape with the button at the top (9:16, 4:5, 1:1 or 16:9; a new project picks the one closest to its first clip). Your last export settings are remembered. |
| Quality | Low, Balanced, High, or Custom with a bitrate slider (1 to 20 Mbps) and a size estimate. The number is a target: simple pictures usually come out smaller. |
| **Split** | Off (default), 15 s, 30 s, 60 s or a custom length. Optionally make all parts the same length. Parts are cut on exact frame boundaries, so nothing is lost or repeated at the seams. |

Your last project (with the original videos) is kept on the device until you delete it in the settings.

## Known limits

- It needs a browser with WebCodecs (Chrome / Edge / Android Chrome, Safari 16.4 or newer). Other browsers can't
  open or export videos. **Settings → This device** shows what your device supports.
- Sound needs audio decoding and encoding in the browser. Some browsers (older Safari versions in particular)
  lack them, and then exported videos have no sound. The export screen tells you when that happens.
- The codecs depend on the device. It uses H.264 + AAC when available and says so when it has to fall back.
- Exporting runs on the main thread: keep the screen on and the app open until it finishes. Long 1080p exports are slow on old phones.
- Each output part is held in memory while it is written, so very long parts at 1080p / 60 fps can run out of memory on low-end phones. Shorter parts help.
- A web app can't run while it is closed, so the saved project is never cleaned up automatically. Use the delete button.
- Big videos also get a small, light copy (144 to 360 px, set in Settings) made in the background, only for the on-screen preview. Export always reads your original file.
- On iPhone the preview volume may not follow the Sound slider (the browser limits it); the export always does. The lock screen may show a bare player while a preview plays; a web page cannot fully switch that off.
- The preview pauses briefly between two different source files. The exported video has no gap.

## Develop

```
npm install
npm run dev      # dev server (no offline cache in dev)
npm test         # unit tests: placement, rotation, splitting, bitrate, pitch-preserving speed
npm run build    # type-check + production build into dist/, including the service worker
```

Preact + TypeScript + Vite. Decoding and encoding use WebCodecs through [Mediabunny](https://mediabunny.dev) (MPL-2.0).
Pushes to `main` deploy to GitHub Pages through `.github/workflows/pages.yml`.
The icon is `public/icons/icon.svg`; `node scripts/make-icons.cjs` redraws the PNG sizes (needs Playwright).

The export approach (WebCodecs, Mediabunny, canvas rendering) comes from the author's Win-Movie-Faker project.

## License

MIT. See [LICENSE](LICENSE).
