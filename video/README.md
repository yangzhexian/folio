# Folio introduction film

This directory contains the editable [Remotion](https://github.com/remotion-dev/remotion) source for Folio's introduction film. The full film is 42 seconds at 1920 × 1080 and 30 fps, with English titles, Chinese captions, and an original instrumental soundtrack. A silent 12-second GIF at 960 × 540 and 12 fps provides the animated preview in the repository README.

The film shows the current Folio interface using explicitly fictional records, contact details, and attachment metadata. The capture script renders the real application frontend with a mocked native bridge; it never reads a personal vault or opens the demonstration attachments. The film presents current features, while planned features remain in the project roadmap.

## Storyboard

| Time | Scene | Focus |
| --- | --- | --- |
| 0–4 s | Introduction | Folio and its visual identity |
| 4–11 s | Organize | Collections and structured personal information |
| 11–18 s | Search and copy | Field results, synonyms, and quick access |
| 18–25 s | Edit and calendar | Flexible fields and date navigation |
| 25–31 s | Files | Named attachments and file actions |
| 31–37 s | Appearance and language | Accent colors, dark mode, and Chinese UI |
| 37–42 s | Closing | Personal information within reach |

## Setup and rendering

Run all commands below from the repository root. Install the application dependencies and the separate video dependencies before rendering:

```sh
npm ci
npm ci --prefix video
npm run video:render
```

The render command generates the original soundtrack, bundles the Remotion composition, renders review stills and a poster, exports the MP4 and GIF, and verifies the MP4's dimensions, duration, and audio stream. The committed screenshots are sufficient for rendering; recapture them when the application interface changes.

```sh
npm run video:capture
npm run video:render
```

Capture requires the root project's Playwright installation and an installed Chrome browser by default. It starts a local Vite server on port 1420 when needed and closes the server it started after capture. To use another supported Playwright browser channel, set `PLAYWRIGHT_CHANNEL`, such as `msedge`. To select the browser executable used for Remotion rendering, set `REMOTION_BROWSER_EXECUTABLE` to its absolute path. These are separate browser settings.

For example, in PowerShell:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:REMOTION_BROWSER_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run video:capture
npm run video:render
```

Open Remotion Studio to inspect the timeline and edit the composition:

```sh
npm run video:studio
```

The root Studio command generates the soundtrack before starting Studio, so it also works after a clean checkout. Select `FolioIntro` for the full film or `FolioPreview` for the shorter silent montage.

Check TypeScript or render only the review stills without encoding the full movie:

```sh
npm run typecheck --prefix video
npm run audio --prefix video
npm run stills --prefix video
```

Generate audio before rendering stills after a clean checkout because the full composition references the generated WAV. `npm run video:render` performs this preparation automatically.

## Files and outputs

| Path from repository root | Purpose |
| --- | --- |
| `video/src/Film.tsx` | Scene layout, animation, titles, captions, and soundtrack placement |
| `video/src/index.tsx` | Full-film and GIF composition definitions |
| `video/scripts/capture.mjs` | Capture the current app with synthetic demonstration data |
| `video/scripts/audio.mjs` | Generate the original 42-second stereo soundtrack |
| `video/scripts/render.mjs` | Render stills, poster, MP4, GIF, and metadata |
| `video/public/screens/` | Captured screenshots and capture manifest |
| `video/public/audio/folio.wav` | Generated soundtrack; recreated by the audio script |
| `docs/media/folio-intro.mp4` | Full 1080p film with H.264 video and AAC audio |
| `docs/media/folio-preview.gif` | Animated README preview |
| `docs/media/folio-poster.png` | Static poster |
| `docs/media/index.html` | Standalone player with native controls and no remote resources |
| `docs/media/folio-intro.en.vtt` | Optional English caption track for the standalone player |
| `docs/media/render-metadata.json` | Rendered MP4 metadata and Remotion version |
| `artifacts/video-check/` | Review stills for checking text, framing, and transitions |

The repository README displays a clickable GIF linked to the MP4 in `docs/media`. This keeps the animated preview usable in GitHub's Markdown rendering without relying on an inline HTML video player or external video hosting. Open or download the linked MP4 to watch the full film with sound.

## Dependencies and asset provenance

Remotion packages are pinned to version `4.0.538` together. The video dependency tree also overrides `zod` to `4.6.6` for the security fix. The separate `video/package.json` and lockfile keep video production dependencies outside Folio's application dependency graph and desktop bundle.

The soundtrack is synthesized deterministically in Node.js using warm pads, muted plucks, and sparse bass at 100 BPM. It uses no samples, vocals, or third-party music assets. The WAV is stereo, 44.1 kHz, and 16 bit, with a 0.5-second fade in and a 2-second fade out. The generator logs its duration, peak, RMS, and file size after rendering.

Typography uses available system fonts, including Segoe UI and Microsoft YaHei. Font files are not redistributed. Rendering on another operating system or with different installed fonts may change line wrapping and layout, so review the generated stills when changing the rendering environment.

See the [official Remotion documentation](https://www.remotion.dev/docs/) for authoring and rendering APIs and the [Remotion license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) for its terms. These links document the upstream project; this guide does not assign a new license to Remotion or to system fonts.
