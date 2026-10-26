# Folio introduction film

This directory contains the editable [Remotion](https://github.com/remotion-dev/remotion) source for Folio's continuous product tour. The full film renders at 2560 × 1440 and 30 fps, with English titles, Chinese captions, and an original instrumental soundtrack. It lasts approximately one minute; the exact duration follows the measured capture in `public/session/manifest.json`. The silent README GIF shows the complete workflow at 1920 × 1080 and 12 fps, played at normal speed for approximately 60.7 seconds. Search, editing, image/PDF preview, file management, theme colors, and language switching remain connected in one continuous session.

The right-hand demonstration is one uninterrupted recording of the real Folio frontend. Search, copying, field dragging, typing, saving, PNG preview, PDF switching and pagination, file renaming, appearance, and language changes happen in the same application session. The application window persists across every chapter. In the GIF, the video, cursor, camera, titles, and Chinese captions share the same normal playback rate, preserving the complete operation without cuts or separate chapter freezes. A global palette without error-diffusion dithering and rectangle-based differences keep text clear and reduce the animated file size. Only the surrounding captions and a gentle camera move change; the application is never replaced by chapter screenshots or sped up between operations. The [storyboard](storyboard.md) records the camera plan and workflow.

## Setup and rendering

Run these commands from the repository root:

```sh
npm ci
npm ci --prefix video
npm run video:render
```

The committed continuous capture is sufficient for rendering. The command synthesizes the original soundtrack, bundles the Remotion composition, renders review frames and a poster, exports the MP4 and GIF, and verifies dimensions, duration, frame rate, and audio. Regenerate the source session after relevant interface changes:

```sh
npm run video:capture
npm run video:render
```

Capture requires the root project's Playwright installation and an installed Chrome browser by default. It starts a local Vite server on port 1420 when needed and closes only the server it started. Set `FOLIO_CAPTURE_URL` to use an existing local development server. Set `PLAYWRIGHT_CHANNEL` to select another installed channel such as `msedge`. Set `REMOTION_BROWSER_EXECUTABLE` to select the executable used by the renderer; this is separate from Playwright's channel setting. The capture encoder uses the FFmpeg executable bundled with Remotion on Windows.

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:REMOTION_BROWSER_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run video:capture
npm run video:render
```

The capture script records timestamped Chrome DevTools Protocol frames at 1920 × 1200. A 4/3 application display scale keeps text readable while viewport-height constraints preserve the equivalent 1440 × 900 layout. A visible animated cursor, click rings, gradual typing, scrolling, and a real pointer drag are captured with the interface. FFmpeg retains the measured time between frames, including natural pauses, and encodes one constant-rate 30 fps source. The manifest records actual chapter times, verified field order, renamed attachment, browser errors, and remote requests. Capture fails if the demonstrated changes do not persist or if the frontend requests remote resources.

Open the editable timeline, or render only review frames:

```sh
npm run video:studio
npm run typecheck --prefix video
npm run audio --prefix video
npm run stills --prefix video
npm run verify --prefix video
```

The root Studio command generates the soundtrack first, so it works after a clean checkout. Select `FolioIntro` for the full film or `FolioPreview` for the complete workflow at normal speed. The soundtrack is ignored by Git and regenerated automatically by the render and Studio commands.

## Files and outputs

| Path from repository root | Purpose |
| --- | --- |
| `video/storyboard.md` | Workflow and camera plan written before production |
| `video/src/Film.tsx` | Persistent application window, camera, titles, and bilingual captions |
| `video/src/index.tsx` | 2K full-film and GIF compositions |
| `video/scripts/capture.mjs` | Reproducible continuous capture using fictional data |
| `video/scripts/audio.mjs` | Original stereo soundtrack matching the measured duration |
| `video/scripts/render.mjs` | Render stills, MP4, GIF, poster, captions, and metadata |
| `video/scripts/verify.mjs` | Verify native browser playback, chapter seeking, and the English caption track |
| `video/public/session/continuous.mp4` | One continuous 1920 × 1200 source recording |
| `video/public/session/manifest.json` | Measured cue times and capture verification |
| `video/public/session/contact-card.png` | Generated fictional PNG attachment |
| `video/public/session/certificate.pdf` | Generated fictional two-page PDF attachment |
| `video/public/session/opening.png` | The initial application frame, held during the opening |
| `video/public/session/closing.png` | The final application frame, held during the closing |
| `docs/media/folio-intro.mp4` | Full 2560 × 1440 H.264 film with AAC audio |
| `docs/media/folio-preview.gif` | Complete workflow at 1920 × 1080, normal speed, approximately 60.7 seconds |
| `docs/media/folio-poster.png` | Static 2K poster |
| `docs/media/index.html` | Local player with native controls and no remote resources |
| `docs/media/folio-intro.en.vtt` | English caption track using measured cue timing |
| `docs/media/render-metadata.json` | Verified output metadata and source capture information |
| `artifacts/video-check/` | Review frames for framing, text, preview controls, and transitions |
| `artifacts/video-session-capture/` | Temporary timestamped JPEG frames and FFmpeg concat input |

The repository README links its animated 1080p GIF to the full MP4. To regenerate only the GIF and review stills without encoding the full film, run `node video/scripts/render.mjs --preview` after generating the soundtrack. Open the standalone HTML player for native playback controls and the optional English caption track. No external video hosting is needed.

## Data and asset provenance

All personal details are fictional. The contact card is rendered locally from HTML, and the two-page certificate is generated locally from a minimal vector PDF. The script mocks only the Tauri storage boundary, while the actual frontend searches and edits records, decodes the image, renders the PDF through the bundled PDF.js worker, handles pagination and zoom, and updates settings. Clipboard and file-path operations use synthetic metadata. No personal vault, external document application, or remote service is accessed.

Remotion packages remain pinned together at `4.0.538`; the separate video dependency tree keeps production tools outside Folio's application bundle. The music is synthesized deterministically in Node.js with warm pads, muted plucks, and sparse bass at 100 BPM. It contains no samples, vocals, or third-party music assets. Output is 44.1 kHz stereo, 16-bit PCM before AAC encoding, with a short opening fade and a two-second closing fade. The generator logs duration, peak, RMS, and file size.

Typography uses available system fonts, including Segoe UI and Microsoft YaHei. Font files are not redistributed. Different installed fonts can affect wrapping; inspect the rendered review frames after changing environments. See the [official Remotion documentation](https://www.remotion.dev/docs/) and [Remotion license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) for upstream details and terms.
