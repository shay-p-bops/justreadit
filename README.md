# Just Read It

A small Chrome/Chromium extension that reads selected text or the main text of the current page. **Instant** mode uses a local operating-system voice for low-latency playback. **Natural** mode uses **Kokoro-82M** locally through WASM; there is no server and no account.

## What it does

- Read highlighted text from the popup.
- Read the current article or page.
- Right-click highlighted text and choose **Read selection with Just Read It**.
- Pause, resume, stop, change mode or voice, and adjust speed.
- Start speaking quickly with a local system voice by default.
- Cache and prewarm the Kokoro model when Natural mode is selected.

Instant mode is the default because it does not wait for an audio file to be generated. Natural mode defaults to `af_heart` with the q8 Kokoro model for better voice quality at the cost of startup latency.

## Install from source

Requirements: Node.js 20+ and Chrome/Edge 116+.

```bash
npm install
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the generated `dist` folder.

Natural mode needs to download and initialise the Kokoro model on first use. Later Natural reads use the browser cache and background prewarming. Both modes remain on-device; Instant mode chooses a non-remote English voice exposed by Chrome's operating-system TTS integration.

## Development

```bash
npm test
npm run check
npm run build
```

## Permissions

- `activeTab` and `scripting`: extract text only after you click the extension.
- `tts`: speak immediately through a local operating-system voice in Instant mode.
- `offscreen`: keep Kokoro inference and audio playback alive after the popup closes.
- `storage`: remember mode, voice, speed, and volume.
- `contextMenus`: add the read-selection menu item.
- Hugging Face host access: download the Kokoro model and voice files for Natural mode.

## Current limitations

- English voices only.
- Instant-mode progress and seeking are approximate because operating-system voices do not expose an audio duration or audio buffer.
- A first-ever Kokoro model download cannot meet the Instant mode latency target.
- Kokoro inference cannot be interrupted mid-chunk; Stop takes effect immediately for playback and ignores the in-flight result.
- Browser-internal pages such as `chrome://` cannot be read.