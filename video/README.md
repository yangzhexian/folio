# Folio product tour

The 60-second Remotion film follows a continuous session in a synthetic personal library. The master is a 2560 × 1440 H.264/AAC video at 30 fps. The complete silent GIF runs at 1920 × 1080 and 12 fps. Both show the same centered English and Chinese captions, an icon and chapter label in the upper right, and the Folio wordmark. [Storyboard](storyboard.md)

## Watch locally

From the repository root, serve the published assets on loopback and open the printed address. The player offers native playback controls and timed English and Chinese caption tracks.

```sh
python -m http.server 8090 --bind 127.0.0.1 --directory docs/media
```

## Reproduce

Use Node 24, npm, Chrome or Edge, and FFmpeg with FFprobe, H.264, AAC, palettegen, paletteuse and PNG support. The scripts look for FFmpeg on PATH and recognize Windows WinGet installations of Gyan FFmpeg. Set `FFMPEG_PATH` and `FFPROBE_PATH` to use specific binaries. Install the application and media dependencies with their respective lockfiles.

```sh
npm ci
npm ci --prefix video
npm run video:render
npm run verify --prefix video
```

The render starts from the committed 54-second capture. It synthesizes the local audio bed, renders the MP4, exports the GIF, poster and WebVTT tracks, and refreshes the metadata. The verification command decodes every MP4 and GIF frame, checks audio, exercises seeking and bilingual captions in Chrome, and compares the measured metadata with the published file. The MP4 contains 1,800 frames and the GIF contains 720.

## Capture an interface change

Run `npm run video:capture` after changing the visible interface. The capture opens the main window and standalone preview against a synthetic fixture on loopback port 1432, then writes the session and measured cue times. The screen capture holds the last visible state while the app is idle. Every input, attached document, generated image and PDF belongs to this fixture. Run `node video/scripts/capture.mjs --check` for an accelerated rehearsal.

Set `FOLIO_CAPTURE_URL` to use an existing local Vite server, `PLAYWRIGHT_CHANNEL` to choose the capture browser, and `REMOTION_BROWSER_EXECUTABLE` to select the render browser. Remotion uses four render workers by default. Override that count with `FOLIO_RENDER_WORKERS` when needed.

## Edit the film

| Material | Source |
| --- | --- |
| Chapter names and bilingual copy | [Cue sheet](src/story.json) |
| Operations and synthetic fixtures | [Capture script](scripts/capture.mjs) |
| Camera, chapter overlay and typography | [Composition](src/Film.tsx), [Film styles](src/film.css) |
| Soundtrack and publishing formats | [Audio generator](scripts/audio.mjs), [Export script](scripts/exports.mjs) |

Use `npm run video:studio` to inspect the timeline. To render a six-second proof, run `npm run audio --prefix video` followed by `node video/scripts/render.mjs --proof`. The proof and diagnostic frames are written under the ignored `artifacts/video/` directory. [Remotion](https://github.com/remotion-dev/remotion)
