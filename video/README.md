# Folio films

Field Guide (Remotion) and Night Desk (HyperFrames) show the same 60-second working session. Each film has a 2560 × 1440, 30 fps H.264/AAC master and a complete 1920 × 1080, 12 fps silent GIF. Both versions use the same English and Chinese captions and original instrumental bed. The [storyboard](storyboard.md) maps the camera to the product actions. Open the [comparison player](../docs/media/index.html) to switch treatments at the same timestamp.

To use browser caption tracks in a local checkout, serve the comparison player on loopback and open the printed address.

```sh
python -m http.server 8090 --bind 127.0.0.1 --directory docs/media
```

## Reproduce

Use Node 22 or later with npm, Chrome or Edge, and a full FFmpeg installation with FFprobe, libx264, AAC, palettegen, paletteuse, and image codecs. Install the app and film dependencies from their separate lockfiles.

```sh
npm ci
npm ci --prefix video
npm run video:render
```

The committed synthetic capture is sufficient for both renders. The full command synthesizes the stereo audio, renders each engine from its editable sources, resamples the finished MP4s into GIFs at normal speed, and verifies the files. The renderer can find Windows WinGet installations of Gyan FFmpeg. Put the binaries on PATH or set absolute `FFMPEG_PATH` and `FFPROBE_PATH` overrides for other installations. The reduced FFmpeg packaged with Remotion may lack filters needed by HyperFrames.

```sh
npm run render:remotion --prefix video
npm run render:hyperframes --prefix video
npm run verify --prefix video -- --update
npm run verify --prefix video
```

The first two commands render individual treatments. Use the final two to refresh the public render metadata after a deliberate change and to check published files without modifying those metadata. Verification decodes the two MP4 and two GIF streams with FFprobe, checks the AAC streams with FFmpeg, and opens both masters and caption tracks in Chrome. Frame counts must be 1,800 for MP4 and 720 for GIF. The player must preserve the current time when its treatment changes.

## Capture a changed interface

Run `npm run video:capture` after relevant product changes. The script starts Vite on loopback port 1432, exercises the current library and standalone preview React entry points, then writes the 54-second session and timing manifest. All records, image bytes, and the two-page PDF are synthetic. IPC calls for collection order, copy, file naming, and pin state stay inside the capture fixture. The screencast selects a frame for each 30 Hz output tick and holds the last visible state while the app is idle. The same cursor travels between the library and the child window. Use `node video/scripts/capture.mjs --check` for a short operation rehearsal.

Set `FOLIO_CAPTURE_URL` to use an existing local Vite server, `PLAYWRIGHT_CHANNEL` to choose the capture browser, and `REMOTION_BROWSER_EXECUTABLE` to choose the render browser. The default `FOLIO_RENDER_WORKERS` is four for Remotion and three for HyperFrames. Raw capture frames, the generated HyperFrames working directory, and review output live under the ignored `artifacts/` directory. The local soundtrack is generated into ignored `video/public/audio/`.

## Edit the two treatments

| Material | Source |
| --- | --- |
| Shared cues and bilingual copy | [story.json](src/story.json) |
| Verified operation capture | [capture.mjs](scripts/capture.mjs) |
| Remotion camera and file-jacket treatment | [Film.tsx](src/Film.tsx), [film.css](src/film.css) |
| HyperFrames composition and GSAP timeline | [hyperframes.html](hyperframes.html), [hyperframes.mjs](scripts/hyperframes.mjs) |
| Original music and common exports | [audio.mjs](scripts/audio.mjs), [exports.mjs](scripts/exports.mjs) |

For a six-second 2K renderer check, run `npm run audio --prefix video`, then `node video/scripts/render.mjs --proof` and `node video/scripts/hyperframes.mjs --proof`. Inspect the generated MP4s in `artifacts/video/`. The HyperFrames builder copies GSAP and the media from local packages and the synthetic session to the work directory. Its headless Chrome render uses the [official HyperFrames CLI](https://github.com/heygen-com/hyperframes). Field Guide uses [Remotion](https://github.com/remotion-dev/remotion) to draw each frame of its own composition.
