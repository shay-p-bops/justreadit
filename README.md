# Just Read It

A small Chrome/Chromium extension that reads selected text or the main text of the current page using **Kokoro-82M**. Speech generation runs locally in the browser through WASM; there is no server and no account.

## What it does

- Read highlighted text from the popup.
- Read the current article or page.
- Right-click highlighted text and choose **Read selection with Just Read It**.
- Pause, resume, stop, change voice, and adjust speed.
- Cache the model and voice data after the first download.

The default voice is `af_heart`, using the q8 Kokoro model for a good balance of speed and naturalness.

## Install from source

Requirements: Node.js 20+ and Chrome/Edge 116+.

```bash
npm install
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the generated `dist` folder.

The first reading downloads the Kokoro model from Hugging Face. That initial run is slower; later runs use the browser cache. Inference and audio playback remain on-device.

## Development

```bash
npm test
npm run check
npm run build
```

## Permissions

- `activeTab` and `scripting`: extract text only after you click the extension.
- `offscreen`: keep local inference and audio playback alive after the popup closes.
- `storage`: remember voice and speed.
- `contextMenus`: add the read-selection menu item.
- Hugging Face host access: download the model and voice files.

## Current limitations

- English voices only.
- Model inference cannot be interrupted mid-chunk; Stop takes effect immediately for playback and ignores the in-flight result.
- Browser-internal pages such as `chrome://` cannot be read.
