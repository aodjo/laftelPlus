const DEFAULTS = {
  skipOpening: true,
  skipEnding: true,
  autoNext: true,
};
const FEATURE_KEYS = ["skipOpening", "skipEnding", "autoNext"];

const powerBtn = document.getElementById("power");
const statusText = document.getElementById("status");
const toggles = FEATURE_KEYS.map((k) => document.getElementById(k));

function isActive(state) {
  return FEATURE_KEYS.some((k) => state[k]);
}

function render(state) {
  const active = isActive(state);
  powerBtn.classList.toggle("active", active);
  powerBtn.setAttribute("aria-pressed", String(active));
  statusText.textContent = active ? "활성화됨" : "꺼짐";
  for (const t of toggles) t.checked = !!state[t.id];
}

function readState(cb) {
  chrome.storage.sync.get({ ...DEFAULTS, snapshot: null }, cb);
}

readState(render);

for (const t of toggles) {
  t.addEventListener("change", () => {
    chrome.storage.sync.set({ [t.id]: t.checked });
  });
}

powerBtn.addEventListener("click", () => {
  readState((state) => {
    if (isActive(state)) {
      const snapshot = {};
      for (const k of FEATURE_KEYS) snapshot[k] = state[k];
      const off = {};
      for (const k of FEATURE_KEYS) off[k] = false;
      chrome.storage.sync.set({ ...off, snapshot });
    } else {
      const snap = state.snapshot;
      const restore = {};
      const hasSnap = snap && FEATURE_KEYS.some((k) => snap[k]);
      for (const k of FEATURE_KEYS) restore[k] = hasSnap ? !!snap[k] : true;
      chrome.storage.sync.set(restore);
    }
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  readState(render);
});

document.getElementById("version").textContent =
  "v" + chrome.runtime.getManifest().version;
