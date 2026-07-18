const ALARM_NAME = "nxapi-poll";

async function getConfig() {
  const { apiUrl, pollMinutes, enabled } = await chrome.storage.local.get([
    "apiUrl",
    "pollMinutes",
    "enabled",
  ]);
  return {
    apiUrl: apiUrl || "",
    pollMinutes: pollMinutes || 1,
    enabled: enabled !== false,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Los service workers de extensiones a veces se "despiertan" para un alarm
// y el primer fetch() falla con un generico "TypeError: Failed to fetch"
// porque la pila de red todavia no termino de inicializarse. Reintentamos
// un par de veces antes de darlo por perdido.
async function fetchWithRetry(url, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      // Cache-buster manual en vez de {cache: "no-store"} para evitar
      // cualquier interaccion rara con el cache del service worker.
      const bustedUrl = url + (url.includes("?") ? "&" : "?") + "_=" + Date.now();
      return await fetch(bustedUrl);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(500 * (i + 1));
    }
  }
  throw lastErr;
}

async function poll() {
  const { apiUrl, enabled } = await getConfig();
  if (!enabled) return;

  if (!apiUrl) {
    await chrome.storage.local.set({
      lastError: "Configurá tu URL de nxapi-presence en el popup de la extensión.",
    });
    return;
  }

  try {
    const res = await fetchWithRetry(apiUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    // nxapi a veces responde 200 con un body tipo {"error": "not_found", ...}
    // cuando el servidor esta caido o la sesion vencio. No es presencia
    // valida: guardamos el error pero NO pisamos la ultima presencia buena
    // que teniamos, para que el Rich Presence no se borre solo porque el
    // servidor tuvo un bache.
    if (json?.error) {
      throw new Error(`nxapi: ${json.error}${json.error_message ? " — " + json.error_message : ""}`);
    }

    await chrome.storage.local.set({
      presenceData: json,
      lastSync: Date.now(),
      lastError: null,
    });
  } catch (err) {
    await chrome.storage.local.set({ lastError: String(err) });
    console.error("[nxapi-rpc] poll fallo", err);
  }
}

async function setupAlarm() {
  const { pollMinutes } = await getConfig();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: Math.max(0.5, pollMinutes) });
}

chrome.runtime.onInstalled.addListener(async () => {
  const cfg = await getConfig();
  await chrome.storage.local.set(cfg);
  await setupAlarm();
  poll();
});

chrome.runtime.onStartup.addListener(() => {
  setupAlarm();
  poll();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) poll();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "MANUAL_REFRESH") {
    poll().then(() => sendResponse({ ok: true }));
    return true; // async response
  }
  if (msg?.type === "UPDATE_INTERVAL") {
    chrome.storage.local.set({ pollMinutes: msg.minutes }).then(setupAlarm);
  }
});
