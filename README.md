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

Pocket Cut started as exactly that: a tiny quick-edit tool. This branch drifted far past it. It is now a
**multi-lane non-linear editor (NLE)** that fits on a phone and weighs next to nothing: stack videos,
pictures, text and sound on layers, place them freely in time, and export as one file or as several files of a
fixed length (for example 60-second parts for Instagram Stories).

Runs entirely in the browser. No account, no upload, no watermark, no ads.

**Try it:** https://andrematomer.github.io/Pocket-Cut/

It works as a normal web page. Installing it as an app is optional: that only adds offline use and
full-screen mode.

> **Experimental NLE build (branch `nla`).** This branch replaces the one-after-another clip list with a multi-lane timeline. It is published next to the normal app at `/nla/` and keeps its own saved data. The main app stays the simple clip-sequence editor.

## Install on your phone (optional)

- **Android (Chrome):** the Install button on the welcome screen, or menu → Install app.
- **Computer (Chrome / Edge):** the install icon in the address bar, or the Install button on the welcome screen.
- **iPhone / iPad (Safari):** Share → Add to Home Screen. If you use it often, do this rather than keeping a
  normal tab: Safari deletes the stored data of websites you haven't opened for 7 days, but as far as is
  known not that of Home Screen apps.

After the first visit it works with no connection.

## What it does

| | |
|---|---|
| Timeline | Lanes of strips; the yellow line is fixed and the timeline scrolls under it. Pinch to zoom. Higher lanes draw on top. Hold a strip to lift it, then drag it in time or to another lane; it snaps to its neighbors. Drag the handles of the selected strip to trim; hold still for fine control. |
| Gaps | Tap empty space between strips to pick the gap, tap again for **Remove gap**: everything after it moves earlier, and anything that would collide hops to the next free lane. |
| Tabs | Speed, Sound, Look and Clip tabs under the timeline raise a drawer over the lower part of the timeline. |
| Speed | A snapping slider from 0.25× to 4×. The voice keeps its pitch, or follows the speed if you prefer. |
| Look | Opacity, brightness, contrast, color and warmth, per clip, for video and pictures (needs WebGL). |
| Place and crop | Drag, pinch and twist the clip on the preview, with snapping to the center, edges, quarter turns, "fits" and "fills"; up to 90% of it can leave the frame. Tap once for four crop handles. |
| Text | Several fonts and colors; the next text starts from the last style you used. Text is a picture like any other. |
| Sound | Several sound lanes (mp3, m4a, wav), volume and mute per clip, and the sound of videos is mixed in. |
| Canvas | 9:16, 4:5, 1:1, 5:4 or 16:9, and a background color. |
| Export | MP4, 480p / 720p / 1080p, 24 / 30 / 60 fps, quality presets or a bitrate, optional split into equal or fixed-length parts. Your last export settings are remembered. |

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
- At speeds other than 1× the preview plays the clip's sound from a separate, pre-rendered copy (a moment after you press play), because phones often mute video sound at unusual speeds.
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
