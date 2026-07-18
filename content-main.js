(function () {
  const TYPE = "NXAPI_RPC_UPDATE";
  const STATUS_TYPE = "NXAPI_RPC_STATUS";
  const SOCKET_ID = "nxapi-rpc";
  let retryAttempts = 0;

  // Le avisa al popup (via content-isolated.js) si Vencord Web esta presente.
  // Sin Vencord, el fallback manual de mas abajo es mucho mas fragil.
  function reportVencordStatus() {
    window.postMessage(
      { type: STATUS_TYPE, vencordDetected: !!window.Vencord?.Webpack },
      "*"
    );
  }
  reportVencordStatus();
  // Vencord puede tardar en inicializar sus modulos; reintentamos el chequeo.
  setTimeout(reportVencordStatus, 3000);
  setTimeout(reportVencordStatus, 8000);

  // --- Utilidades para encontrar el FluxDispatcher interno de Discord ---
  // Misma tecnica que usan plugins de Vencord/BetterDiscord tipo CustomRPC:
  // se engancha al webpack chunk loader para obtener el `require` interno,
  // y se busca en el cache de modulos el que tenga forma de FluxDispatcher.
  function getWebpackRequire() {
    let req;
    try {
      const chunkName = Object.keys(window).find((k) =>
        k.startsWith("webpackChunkdiscord_app")
      );
      if (!chunkName) return null;
      window[chunkName].push([
        [Symbol("nxapi-rpc")],
        {},
        (r) => {
          req = r;
        },
      ]);
    } catch (e) {
      console.error("[nxapi-rpc] no se pudo enganchar al webpack de Discord", e);
    }
    return req;
  }

  function findModule(wpRequire, filter) {
    if (!wpRequire || !wpRequire.c) return null;
    for (const id in wpRequire.c) {
      const mod = wpRequire.c[id]?.exports;
      if (!mod) continue;
      try {
        if (filter(mod)) return mod;
      } catch {}
      try {
        if (mod.default && filter(mod.default)) return mod.default;
      } catch {}
      for (const key in mod) {
        try {
          if (mod[key] && filter(mod[key])) return mod[key];
        } catch {}
      }
    }
    return null;
  }

  function getVencord() {
    return window.Vencord || null;
  }

  let cachedDispatcher = null;
  function getDispatcher() {
    if (cachedDispatcher) return cachedDispatcher;

    // Camino preferido: Vencord ya resolvio este modulo de forma confiable.
    const vc = getVencord();
    if (vc?.Webpack?.Common?.FluxDispatcher?.dispatch) {
      cachedDispatcher = vc.Webpack.Common.FluxDispatcher;
      console.log("[nxapi-rpc] dispatcher obtenido via Vencord.Webpack.Common");
      return cachedDispatcher;
    }

    // Fallback: busqueda manual sobre el webpack crudo.
    const wpRequire = getWebpackRequire();
    cachedDispatcher = findModule(
      wpRequire,
      (m) => m?.dispatch && m?.subscribe && m?._actionHandlers
    );
    if (cachedDispatcher) {
      console.log("[nxapi-rpc] dispatcher obtenido via busqueda manual");
    }
    return cachedDispatcher;
  }

  // AuthenticationStore expone getToken() con el token de la sesion actual.
  // Se usa solo localmente, para llamar a la API de Discord desde el propio
  // navegador del usuario (nunca sale de la pagina).
  let cachedAuthStore = null;
  function getAuthStore() {
    if (cachedAuthStore) return cachedAuthStore;

    const vc = getVencord();
    if (vc?.Webpack?.findByProps) {
      try {
        const mod = vc.Webpack.findByProps("getToken");
        if (typeof mod?.getToken === "function") {
          cachedAuthStore = mod;
          return cachedAuthStore;
        }
      } catch {}
    }

    const wpRequire = getWebpackRequire();
    cachedAuthStore = findModule(wpRequire, (m) => typeof m?.getToken === "function");
    return cachedAuthStore;
  }

  function getToken() {
    try {
      return getAuthStore()?.getToken?.() || null;
    } catch {
      return null;
    }
  }

  // --- Resolucion de imagenes externas a "external assets" de Discord ---
  // Discord solo acepta URLs de imagen para Rich Presence si vienen
  // resueltas contra una app propia via este endpoint. El resultado se
  // cachea en memoria por URL para no golpear la API de mas.
  const externalAssetCache = new Map();

  async function resolveExternalAsset(imageUrl, applicationId) {
    if (!imageUrl || !applicationId) return null;

    const cacheKey = `${applicationId}:${imageUrl}`;
    if (externalAssetCache.has(cacheKey)) return externalAssetCache.get(cacheKey);

    const token = getToken();
    if (!token) {
      console.warn("[nxapi-rpc] no se encontro el token del usuario, sin imagenes por ahora");
      return null;
    }

    try {
      const res = await fetch(
        `https://discord.com/api/v9/applications/${applicationId}/external-assets`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: token,
          },
          body: JSON.stringify({ urls: [imageUrl] }),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const path = data?.[0]?.external_asset_path;
      if (!path) return null;

      const key = `mp:${path}`;
      externalAssetCache.set(cacheKey, key);
      return key;
    } catch (e) {
      console.warn("[nxapi-rpc] no se pudo resolver el asset externo", imageUrl, e);
      return null;
    }
  }

  // --- Formato de tiempo jugado, portado de nxapi (src/util/misc.ts) ---
  function hrduration(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes - hours * 60;

    if (hours >= 1) {
      return (
        `${hours} hour${hours === 1 ? "" : "s"}` +
        (minutes ? `, ${minutes} minute${minutes === 1 ? "" : "s"}` : "")
      );
    }
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  // Portado de nxapi (src/discord/util.ts: getPlayTimeText, estilo DETAILED_PLAY_TIME_SINCE)
  function getPlayTimeText(totalPlayTime, firstPlayedAt) {
    if (typeof totalPlayTime !== "number" || totalPlayTime < 60) return null;

    const since = firstPlayedAt
      ? new Date(firstPlayedAt * 1000).toLocaleDateString("en-GB", { dateStyle: "medium" })
      : "now";

    return `Played for ${hrduration(totalPlayTime)} since ${since}`;
  }

  function setActivity(activity) {
    const FluxDispatcher = getDispatcher();
    if (!FluxDispatcher) {
      retryAttempts++;
      if (retryAttempts === 1 || retryAttempts % 10 === 0) {
        console.warn(
          `[nxapi-rpc] dispatcher de Discord no encontrado todavia (intento ${retryAttempts}), reintentando...`
        );
      }
      return false;
    }
    retryAttempts = 0;
    reportVencordStatus();
    FluxDispatcher.dispatch({
      type: "LOCAL_ACTIVITY_UPDATE",
      activity,
      socketId: SOCKET_ID,
    });
    return true;
  }

  function clearActivity() {
    return setActivity(null);
  }

  // Estado "Not playing" cuando esta offline, portado de nxapi
  // (src/discord/util.ts: getInactiveDiscordPresence). Opcional via config.
  function buildIdleActivity(applicationId) {
    return {
      application_id: applicationId,
      name: "Nintendo Switch",
      type: 0,
      state: "Not playing",
      timestamps: {},
    };
  }

  // --- Construccion de la activity a partir del JSON de nxapi ---
  // Logica de details/state/boton de eShop portada de nxapi
  // (src/discord/util.ts: getDiscordPresence).
  let warnedMissingAppId = false;

  async function buildActivity(presenceJson, config) {
    const applicationId = config?.applicationId;
    if (!applicationId) {
      if (!warnedMissingAppId) {
        warnedMissingAppId = true;
        console.warn(
          "[nxapi-rpc] falta el Application ID de Discord. Configuralo en el popup de la extension."
        );
      }
      return null;
    }
    warnedMissingAppId = false;

    const friend = presenceJson?.friend;
    const title = presenceJson?.title;

    if (!friend || friend.presence?.state !== "ONLINE" || !title) {
      return config?.showIdleStatus ? buildIdleActivity(applicationId) : null;
    }

    const game = friend.presence.game || {};
    const startMs = title.since ? new Date(title.since).getTime() : Date.now();
    const gameName = title.name || game.name || "Nintendo Switch";

    const [largeImageKey, smallImageKey] = await Promise.all([
      resolveExternalAsset(title.image_url, applicationId),
      resolveExternalAsset(friend.imageUri, applicationId),
    ]);

    const assets = {};
    if (largeImageKey) {
      assets.large_image = largeImageKey;
      assets.large_text = `${gameName} | Nintendo Switch Online`;
    }
    if (smallImageKey) {
      assets.small_image = smallImageKey;
      assets.small_text = friend.name || "Nintendo Switch";
    }

    // Prioridad del "state", igual que nxapi: descripcion del sistema si la
    // hay, si no el tiempo jugado, si no un texto generico.
    const state =
      (game.sysDescription && game.sysDescription.trim()) ||
      getPlayTimeText(game.totalPlayTime, game.firstPlayedAt) ||
      "via Nintendo Switch";

    const buttons = [];
    if (title.url) {
      buttons.push({ label: "Nintendo eShop", url: title.url });
    }

    return {
      application_id: applicationId,
      name: gameName,
      type: 0, // 0 = "Jugando a"
      details: gameName,
      state,
      timestamps: { start: startMs },
      ...(Object.keys(assets).length ? { assets } : {}),
      ...(buttons.length ? { buttons } : {}),
    };
  }

  // --- Loop de reintento por si el dispatcher todavia no cargo ---
  let pendingPresence = null;
  let pendingConfig = {};
  let retryTimer = null;
  let applySeq = 0;

  async function applyPresence(presenceJson, config) {
    pendingPresence = presenceJson;
    pendingConfig = config || pendingConfig;
    const mySeq = ++applySeq;

    const activity = await buildActivity(presenceJson, pendingConfig);

    // Si mientras resolvia assets llego una presencia mas nueva, descartar esta.
    if (mySeq !== applySeq) return;

    const ok = activity ? setActivity(activity) : clearActivity();

    clearTimeout(retryTimer);
    if (!ok) {
      retryTimer = setTimeout(() => applyPresence(pendingPresence, pendingConfig), 2000);
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== TYPE) return;
    applyPresence(data.payload, data.config);
  });

  console.log("[nxapi-rpc] content-main.js cargado, esperando datos de presencia...");
})();
