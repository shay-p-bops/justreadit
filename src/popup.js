const voice = document.querySelector("#voice");
const speed = document.querySelector("#speed");
const speedValue = document.querySelector("#speed-value");
const volume = document.querySelector("#volume");
const volumeValue = document.querySelector("#volume-value");
const statusText = document.querySelector("#status-text");
const statusDot = document.querySelector("#status-dot");
const latencyText = document.querySelector("#latency-text");
const activity = document.querySelector("#activity");
const activityText = document.querySelector("#activity-text");
const timeline = document.querySelector("#timeline");
const scrubber = document.querySelector("#scrubber");
const elapsedText = document.querySelector("#elapsed-time");
const remainingText = document.querySelector("#remaining-time");
const segmentText = document.querySelector("#segment-text");
const readSelection = document.querySelector("#read-selection");
const readPage = document.querySelector("#read-page");
const pause = document.querySelector("#pause");
const resume = document.querySelector("#resume");
const stop = document.querySelector("#stop");

const activeStatuses = new Set(["loading", "generating", "playing", "paused"]);
const preparingStatuses = new Set(["loading", "generating"]);
let currentState = {
  status: "idle",
  message: "Ready",
  current: 0,
  total: 0,
  position: 0,
  duration: 0,
  startedAt: null,
  startupMs: null,
  updatedAt: Date.now()
};
let isScrubbing = false;
let statusRefreshInFlight = false;

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

function formatClock(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = Math.floor(safeSeconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function renderLatency() {
  if (Number.isFinite(currentState.startupMs)) {
    latencyText.textContent = `Started in ${formatDuration(currentState.startupMs)}`;
    return;
  }

  if (preparingStatuses.has(currentState.status) && Number.isFinite(currentState.startedAt)) {
    const elapsed = Date.now() - currentState.startedAt;
    const sinceUpdate = Date.now() - (Number(currentState.updatedAt) || currentState.startedAt);
    latencyText.textContent = `${sinceUpdate > 10_000 ? "Still working" : "Working"} · ${formatDuration(elapsed)}`;
    return;
  }

  latencyText.textContent = "";
}

function renderActivity() {
  const isPreparing = preparingStatuses.has(currentState.status);
  activity.hidden = !isPreparing;
  activity.setAttribute("aria-hidden", String(!isPreparing));
  if (!isPreparing) return;

  const sinceUpdate = Date.now() - (Number(currentState.updatedAt) || Date.now());
  if (sinceUpdate > 10_000) {
    activityText.textContent = currentState.status === "loading" ? "Still loading the voice model" : "Still generating audio";
    return;
  }

  activityText.textContent = currentState.status === "loading" ? "Loading voice model" : "Generating audio";
}

function renderTimeline() {
  const duration = Math.max(0, Number(currentState.duration) || 0);
  const position = Math.min(duration, Math.max(0, Number(currentState.position) || 0));
  const hasTimeline = duration > 0 && ["playing", "paused"].includes(currentState.status);

  timeline.classList.toggle("active", hasTimeline);
  scrubber.disabled = !hasTimeline;
  scrubber.max = String(duration || 1);

  if (!isScrubbing) {
    scrubber.value = String(position);
    elapsedText.textContent = formatClock(position);
    remainingText.textContent = hasTimeline ? `${formatClock(duration - position)} left` : "—";
  }

  segmentText.textContent = currentState.total > 0
    ? `Part ${Math.min(currentState.current || 1, currentState.total)} of ${currentState.total}`
    : "Waiting for audio";
}

function render(state = {}) {
  currentState = { ...currentState, ...state };
  const status = currentState.status || "idle";
  statusText.textContent = currentState.message || "Ready";
  statusDot.className = status === "error" ? "error" : activeStatuses.has(status) ? "busy" : "";
  pause.disabled = status !== "playing";
  resume.disabled = status !== "paused";
  stop.disabled = !activeStatuses.has(status);
  document.body.toggleAttribute("aria-busy", preparingStatuses.has(status));
  renderLatency();
  renderActivity();
  renderTimeline();
}

async function request(message, timeoutMs = 5_000) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("The player is taking longer than expected. The UI will keep showing its latest state.")), timeoutMs);
  });

  try {
    const response = await Promise.race([
      chrome.runtime.sendMessage({ ...message, target: "background" }),
      timeout
    ]);
    if (!response?.ok) throw new Error(response?.error || "Something went wrong.");
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function refreshPreparingStatus() {
  if (statusRefreshInFlight || !preparingStatuses.has(currentState.status)) return;
  statusRefreshInFlight = true;

  try {
    const response = await request({ type: "GET_STATUS" }, 1_500);
    render(response.state);
  } catch {
    // Keep showing the last live state; the next watchdog pass will retry.
  } finally {
    statusRefreshInFlight = false;
  }
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
    current: 0,
    total: 0,
    position: 0,
    duration: 0,
    startedAt,
    startupMs: null,
    updatedAt: startedAt
  });

  try {
    await saveSettings();
    await request({ type: "READ_ACTIVE_TAB", mode, settings: settings(), startedAt });
  } catch (error) {
    render({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
      startedAt,
      startupMs: null,
      updatedAt: Date.now()
    });
  }
}

async function seekTo(value) {
  await request({ type: "PLAYER_COMMAND", command: "seek", value: Number(value) });
}

readSelection.addEventListener("click", () => read("selection"));
readPage.addEventListener("click", () => read("page"));
pause.addEventListener("click", () => request({ type: "PLAYER_COMMAND", command: "pause" }).catch((error) => render({ status: "error", message: error.message })));
resume.addEventListener("click", () => request({ type: "PLAYER_COMMAND", command: "resume" }).catch((error) => render({ status: "error", message: error.message })));
stop.addEventListener("click", () => request({ type: "PLAYER_COMMAND", command: "stop" }).catch((error) => render({ status: "error", message: error.message })));
voice.addEventListener("change", saveSettings);
speed.addEventListener("input", saveSettings);
volume.addEventListener("input", () => applyVolume().catch((error) => render({ status: "error", message: error.message })));

scrubber.addEventListener("pointerdown", () => {
  isScrubbing = true;
});

scrubber.addEventListener("input", () => {
  isScrubbing = true;
  const previewPosition = Number(scrubber.value);
  const duration = Number(scrubber.max);
  elapsedText.textContent = formatClock(previewPosition);
  remainingText.textContent = `${formatClock(Math.max(0, duration - previewPosition))} left`;
});

scrubber.addEventListener("change", () => {
  const value = Number(scrubber.value);
  seekTo(value)
    .catch((error) => render({ status: "error", message: error.message }))
    .finally(() => {
      isScrubbing = false;
    });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "PLAYER_STATUS") render(message.state);
});

setInterval(() => {
  renderLatency();
  renderActivity();
}, 250);
setInterval(refreshPreparingStatus, 2_000);

async function initialise() {
  render(currentState);

  const [storedSettings, storedSession] = await Promise.all([
    chrome.storage.local.get({ voice: "af_heart", speed: 1, volume: 1 }),
    chrome.storage.session.get({ playerState: null }).catch(() => ({ playerState: null }))
  ]);

  voice.value = storedSettings.voice;
  speed.value = String(storedSettings.speed);
  volume.value = String(storedSettings.volume);
  updateSettingLabels();

  if (storedSession.playerState) render(storedSession.playerState);
  await chrome.storage.local.set(settings());

  try {
    const response = await request({ type: "GET_STATUS" }, 1_500);
    render(response.state);
  } catch (error) {
    if (!storedSession.playerState) {
      render({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }
}

initialise().catch((error) => {
  render({ status: "error", message: error instanceof Error ? error.message : String(error) });
});
