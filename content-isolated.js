(function () {
  const TYPE = "NXAPI_RPC_UPDATE";

  function buildConfig(storageState) {
    return {
      applicationId: storageState.applicationId || "",
      showIdleStatus: storageState.showIdleStatus === true,
    };
  }

  function relay(presenceJson, config) {
    window.postMessage({ type: TYPE, payload: presenceJson, config }, "*");
  }

  function relayOffline(config) {
    relay({ friend: { presence: { state: "OFFLINE" } } }, config);
  }

  const STORAGE_KEYS = ["presenceData", "enabled", "showIdleStatus", "applicationId"];

  // Estado inicial al cargar Discord
  chrome.storage.local.get(STORAGE_KEYS, (res) => {
    const config = buildConfig(res);
    if (res.enabled === false) {
      relayOffline(config);
    } else if (res.presenceData) {
      relay(res.presenceData, config);
    }
  });

  // Cambios en vivo (nuevo polling, toggle enabled, cambio de config, etc.)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    chrome.storage.local.get(STORAGE_KEYS, (res) => {
      const config = buildConfig(res);

      if (res.enabled === false) {
        relayOffline(config);
        return;
      }

      if (changes.presenceData || changes.showIdleStatus || changes.enabled || changes.applicationId) {
        if (res.presenceData) relay(res.presenceData, config);
      }
    });
  });
})();

