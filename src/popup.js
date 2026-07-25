const voice = document.querySelector("#voice");
const speed = document.querySelector("#speed");
const speedValue = document.querySelector("#speed-value");
const volume = document.querySelector("#volume");
const volumeValue = document.querySelector("#volume-value");
const statusText = document.querySelector("#status-text");
const statusDot = document.querySelector("#status-dot");
const latencyText = document.querySelector("#latency-text");
const readSelection = document.querySelector("#read-selection");
const readPage = document.querySelector("#read-page");
const pause = document.querySelector("#pause");
const resume = document.querySelector("#resume");
const stop = document.querySelector("#stop");

const activeStatuses = new Set(["loading", "generating", "playing", "paused"]);
let currentState = { status: "idle", message: "Ready", startedAt: null, startupMs: null };

function settings() {
  return {
    voice: voice.value,
    speed: Number(speed.value),
    volume: Number(volume.value)
  };
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, milliseconds) / 1000;
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
}

function renderLatency() {
  if (Number.isFinite(currentState.startupMs)) {
    latencyText.textContent = `Started in ${formatDuration(currentState.startupMs)}`;
    return;
  }

  if (["loading", "generating"].includes(currentState.status) && Number.isFinite(currentState.startedAt)) {
    latencyText.textContent = `Starting · ${formatDuration(Date.now() - currentState.startedAt)}`;
    return;
  }

  latencyText.textContent = "";
}

function render(state = {}) {
  currentState = { ...state };
  const status = currentState.status || "idle";
  statusText.textContent = currentState.message || "Ready";
  statusDot.className = status === "error" ? "error" : activeStatuses.has(status) ? "busy" : "";
  pause.disabled = status !== "playing";
  resume.disabled = status !== "paused";
  stop.disabled = !activeStatuses.has(status);
  renderLatency();
}

async function request(message) {
  const response = await chrome.runtime.sendMessage({ ...message, target: "background" });
  if (!response?.ok) throw new Error(response?.error || "Something went wrong.");
  return response;
}

function updateSettingLabels() {
  speedValue.value = `${Number(speed.value).toFixed(2).replace(/0$/, "")}×`;
  volumeValue.value = `${Math.round(Number(volume.value) * 100)}%`;
}

async function saveSettings() {
  updateSettingLabels();
  await chrome.storage.local.set(settings());
}

async function applyVolume() {
  await saveSettings();
  if (activeStatuses.has(currentState.status)) {
    await request({ type: "PLAYER_COMMAND", command: "set-volume", value: Number(volume.value) });
  }
}

async function read(mode) {
  const startedAt = Date.now();
  render({
    status: "loading",
    message: mode === "selection" ? "Getting selection…" : "Getting page text…",
    startedAt,
    startupMs: null
  });

  try {
    await saveSettings();
    await request({ type: "READ_ACTIVE_TAB", mode, settings: settings(), startedAt });
  } catch (error) {
    render({ status: "error", message: error instanceof Error ? error.message : String(error), startedAt, startupMs: null });
  }
}

readSelection.addEventListener("click", () => read("selection"));
readPage.addEventListener("click", () => read("page"));
pause.addEventListener("click", () => request({ type: "PLAYER_COMMAND", command: "pause" }).catch((error) => render({ status: "error", message: error.message })));
resume.addEventListener("click", () => request({ type: "PLAYER_COMMAND", command: "resume" }).catch((error) => render({ status: "error", message: error.message })));
stop.addEventListener("click", () => request({ type: "PLAYER_COMMAND", command: "stop" }).catch((error) => render({ status: "error", message: error.message })));
voice.addEventListener("change", saveSettings);
speed.addEventListener("input", saveSettings);
volume.addEventListener("input", () => applyVolume().catch((error) => render({ status: "error", message: error.message })));

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "PLAYER_STATUS") render(message.state);
});

setInterval(renderLatency, 100);

const stored = await chrome.storage.local.get({ voice: "af_heart", speed: 1, volume: 1 });
voice.value = stored.voice;
speed.value = String(stored.speed);
volume.value = String(stored.volume);
await saveSettings();

try {
  const response = await request({ type: "GET_STATUS" });
  render(response.state);
} catch (error) {
  render({ status: "error", message: error instanceof Error ? error.message : String(error) });
}
