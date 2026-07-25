# Just Read It

A small Chrome/Chromium extension that reads selected text or the main text of the current page using **Kokoro-82M**. Speech generation runs locally in the browser through WASM; there is no server and no account.

## What it does

- Read highlighted text from the popup.
- Read the current article or page.
- Right-click highlighted text and choose **Read selection with Just Read It**.
- Pause, resume, stop, change voice, and adjust speed.
- Cache the model and voice data after the first download.
- Warm the cached speech engine when the browser starts or the popup opens, reducing click-to-speech latency for later reads.

The default voice is `af_heart`, using the q8 Kokoro model for a good balance of speed and naturalness.

## Install from source

Requirements: Node.js 20+ and Chrome/Edge 116+.

```bash
npm install
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the generated `dist` folder.

The first use still needs to download and initialise the Kokoro model. After that, the extension prewarms the cached model and its first inference in the background so playback can begin much sooner. Inference and audio playback remain on-device.

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
- A first-ever model download cannot meet the normal warm-start latency target.
- Model inference cannot be interrupted mid-chunk; Stop takes effect immediately for playback and ignores the in-flight result.
- Browser-internal pages such as `chrome://` cannot be read.
