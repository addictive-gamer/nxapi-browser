const apiUrlEl = document.getElementById("apiUrl");
const applicationIdEl = document.getElementById("applicationId");
const pollEl = document.getElementById("pollMinutes");
const enabledEl = document.getElementById("enabled");
const showIdleEl = document.getElementById("showIdleStatus");
const statusEl = document.getElementById("status");
const setupWarningEl = document.getElementById("setupWarning");
const refreshBtn = document.getElementById("refresh");

function renderSetupWarning(res) {
  const missing = [];
  if (!res.apiUrl) missing.push("la URL de nxapi-presence");
  if (!res.applicationId) missing.push("el Discord Application ID");

  if (!missing.length) {
    setupWarningEl.style.display = "none";
    return;
  }

  setupWarningEl.style.display = "block";
  setupWarningEl.textContent = "Falta configurar " + missing.join(" y ") + " para que funcione.";
}

function render(state) {
  const { presenceData, lastSync, lastError } = state;
  const lines = [];

  if (lastSync) {
    lines.push("Última sincronización: " + new Date(lastSync).toLocaleTimeString());
  }
  if (lastError) {
    lines.push("Error: " + lastError);
  }

  const p = presenceData?.friend?.presence;
  if (p) {
    const game = p.game?.name ? " — " + p.game.name : "";
    lines.push("Estado: " + p.state + game);
  }

  statusEl.textContent = lines.join("\n") || "Sin datos todavía.";
}

chrome.storage.local.get(
  [
    "apiUrl",
    "applicationId",
    "pollMinutes",
    "enabled",
    "showIdleStatus",
    "presenceData",
    "lastSync",
    "lastError",
  ],
  (res) => {
    apiUrlEl.value = res.apiUrl || "";
    applicationIdEl.value = res.applicationId || "";
    pollEl.value = res.pollMinutes || 1;
    enabledEl.checked = res.enabled !== false;
    showIdleEl.checked = res.showIdleStatus === true;
    renderSetupWarning(res);
    render(res);
  }
);

apiUrlEl.addEventListener("change", () => {
  const value = apiUrlEl.value.replace(/\s+/g, "");
  apiUrlEl.value = value;
  chrome.storage.local.set({ apiUrl: value }, () => {
    renderSetupWarning({ apiUrl: value, applicationId: applicationIdEl.value.trim() });
  });
});

applicationIdEl.addEventListener("change", () => {
  const value = applicationIdEl.value.trim();
  chrome.storage.local.set({ applicationId: value }, () => {
    renderSetupWarning({ apiUrl: apiUrlEl.value.trim(), applicationId: value });
  });
});

pollEl.addEventListener("change", () => {
  const minutes = parseFloat(pollEl.value) || 1;
  chrome.runtime.sendMessage({ type: "UPDATE_INTERVAL", minutes });
});

enabledEl.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: enabledEl.checked });
});

showIdleEl.addEventListener("change", () => {
  chrome.storage.local.set({ showIdleStatus: showIdleEl.checked });
});

refreshBtn.addEventListener("click", () => {
  refreshBtn.textContent = "Actualizando…";
  chrome.runtime.sendMessage({ type: "MANUAL_REFRESH" }, () => {
    refreshBtn.textContent = "Actualizar ahora";
    chrome.storage.local.get(["presenceData", "lastSync", "lastError"], render);
  });
});
