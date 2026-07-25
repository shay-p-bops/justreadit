const OFFSCREEN_PATH = "offscreen.html";
const MENU_ID = "just-read-it-selection";
let creatingOffscreen = null;

async function hasOffscreenDocument() {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [documentUrl]
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  if (creatingOffscreen) return creatingOffscreen;

  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["AUDIO_PLAYBACK", "BLOBS"],
    justification: "Generate local speech, create audio blobs, and play them."
  });

  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

async function sendToOffscreen(message) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ ...message, target: "offscreen" });
}

async function getSettings() {
  const stored = await chrome.storage.local.get({ voice: "af_heart", speed: 1, volume: 1 });
  return {
    voice: typeof stored.voice === "string" ? stored.voice : "af_heart",
    speed: Number.isFinite(Number(stored.speed)) ? Number(stored.speed) : 1,
    volume: Number.isFinite(Number(stored.volume)) ? Number(stored.volume) : 1
  };
}

async function startReading(text, settings, startedAt = Date.now()) {
  const cleaned = String(text ?? "").trim();
  if (!cleaned) throw new Error("No text to read.");
  return sendToOffscreen({ type: "START_READING", text: cleaned, settings, startedAt });
}

async function extractFromActiveTab(mode) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    return await chrome.tabs.sendMessage(tab.id, { target: "content", type: "EXTRACT_TEXT", mode });
  } catch {
    throw new Error("This page cannot be read. Try a normal web page.");
  }
}

function setBadge(status) {
  const text = status === "playing" ? "▶" : status === "paused" ? "Ⅱ" : ["loading", "generating"].includes(status) ? "…" : "";
  chrome.action.setBadgeText({ text });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Read selection with Just Read It",
      contexts: ["selection"]
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;
  try {
    await startReading(info.selectionText, await getSettings(), Date.now());
  } catch (error) {
    console.error("Just Read It:", error);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PLAYER_STATUS") {
    setBadge(message.state?.status);
    return;
  }

  if (message?.target !== "background") return;

  (async () => {
    switch (message.type) {
      case "READ_ACTIVE_TAB": {
        const result = await extractFromActiveTab(message.mode);
        if (!result?.ok) throw new Error(result?.error || "No readable text found.");
        return startReading(result.text, await getSettings(), message.startedAt);
      }
      case "PLAYER_COMMAND":
        return sendToOffscreen({ type: "PLAYER_COMMAND", command: message.command, value: message.value });
      case "GET_STATUS":
        if (!(await hasOffscreenDocument())) return { ok: true, state: { status: "idle", message: "Ready", startedAt: null, startupMs: null } };
        return chrome.runtime.sendMessage({ target: "offscreen", type: "GET_STATUS" });
      default:
        throw new Error("Unknown request.");
    }
  })()
    .then((result) => sendResponse(result ?? { ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  return true;
});
