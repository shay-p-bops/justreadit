const voice = document.querySelector("#voice");
const speed = document.querySelector("#speed");
const speedValue = document.querySelector("#speed-value");
const statusText = document.querySelector("#status-text");
const statusDot = document.querySelector("#status-dot");
const readSelection = document.querySelector("#read-selection");
const readPage = document.querySelector("#read-page");
const pause = document.querySelector("#pause");
const resume = document.querySelector("#resume");
const stop = document.querySelector("#stop");

function settings() {
  return { voice: voice.value, speed: Number(speed.value) };
}

function render(state = {}) {
  const status = state.status || "idle";
  statusText.textContent = state.message || "Ready";
  statusDot.className = status === "error" ? "error" : ["loading", "generating", "playing", "paused"].includes(status) ? "busy" : "";
  pause.disabled = status !== "playing";
  resume.disabled = status !== "paused";
  stop.disabled = !["loading", "generating", "playing", "paused"].includes(status);
}

async function request(message) {
  const response = await chrome.runtime.sendMessage({ ...message, target: "background" });
  if (!response?.ok) throw new Error(response?.error || "Something went wrong.");
  return response;
}

async function saveSettings() {
  speedValue.value = `${Number(speed.value).toFixed(2).replace(/0$/, "")}×`;
  await chrome.storage.local.set(settings());
}

async function read(mode) {
  render({ status: "loading", message: mode === "selection" ? "Getting selection…" : "Reading the page…" });
  try {
    await saveSettings();
    await request({ type: "READ_ACTIVE_TAB", mode, settings: settings() });
  } catch (error) {
    render({ status: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

readSelection.addEventListener("click", () => read("selection"));
readPage.addEventListener("click", () => read("page"));
pause.addEventListener("click", () => request({ type: "PLAYER_COMMAND", command: "pause" }).catch((error) => render({ status: "error", message: error.message })));
resume.addEventListener("click", () => request({ type: "PLAYER_COMMAND", command: "resume" }).catch((error) => render({ status: "error", message: error.message })));
stop.addEventListener("click", () => request({ type: "PLAYER_COMMAND", command: "stop" }).catch((error) => render({ status: "error", message: error.message })));
voice.addEventListener("change", saveSettings);
speed.addEventListener("input", saveSettings);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "PLAYER_STATUS") render(message.state);
});

const stored = await chrome.storage.local.get({ voice: "af_heart", speed: 1 });
voice.value = stored.voice;
speed.value = String(stored.speed);
await saveSettings();

try {
  const response = await request({ type: "GET_STATUS" });
  render(response.state);
} catch (error) {
  render({ status: "error", message: error instanceof Error ? error.message : String(error) });
}
