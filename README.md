# nxapi-browser

Extensión de Chrome que inyecta tu presencia de Nintendo Switch (vía
<<<<<<< HEAD
[nxapi-auth](https://nxapi-auth.fancy.org.uk/), del
[proyecto nxapi](https://github.com/samuelthomas2774/nxapi)) como Rich
=======
[nxapi-presence](https://github.com/samuelthomas2774/nxapi)) como Rich
>>>>>>> b27cfb6572b3e7bafa5c07f84b6f8610b6392455
Presence real en **Discord Web**.

No trae ninguna cuenta ni credencial precargada — cada persona que la instale
configura su propia URL de presencia y su propia app de Discord desde el
popup de la extensión.

## Configuración inicial (obligatoria)

La extensión no hace nada hasta que completes estos dos pasos desde su popup:

### 1. Tu URL de nxapi-presence

<<<<<<< HEAD
Se consigue logueándote en
[nxapi-auth.fancy.org.uk](https://nxapi-auth.fancy.org.uk/) con tu cuenta de
Discord (OAuth) — ahí te genera tu URL personal de presencia, con esta forma:
=======
Es la que te da tu instancia de `nxapi-presence` (la pública en
[nxapi-presence.fancy.org.uk](https://nxapi-presence.fancy.org.uk/) o una que
vos mismo hostees corriendo el
[proyecto nxapi](https://github.com/samuelthomas2774/nxapi)). Tiene esta
forma:
>>>>>>> b27cfb6572b3e7bafa5c07f84b6f8610b6392455

```
https://nxapi-presence.fancy.org.uk/api/presence/TU_ID_DE_AMIGO
```

<<<<<<< HEAD
Esa es la URL que copiás y pegás en el popup de la extensión. Si en cambio
corrés tu propia instancia del [proyecto nxapi](https://github.com/samuelthomas2774/nxapi)
en otro dominio, la URL va a tener ese dominio en vez de
`nxapi-presence.fancy.org.uk`.

=======
>>>>>>> b27cfb6572b3e7bafa5c07f84b6f8610b6392455
> Si usás una instancia propia en otro dominio, agregá ese dominio a
> `host_permissions` en `manifest.json` antes de cargar la extensión —
> por defecto solo tiene permiso para `nxapi-presence.fancy.org.uk`.

### 2. Tu Discord Application ID

Hace falta para poder resolver imágenes (portada del juego, tu icono) como
"external assets" de Discord. Es gratis y no necesita bot ni OAuth:

1. Andá a [discord.com/developers/applications](https://discord.com/developers/applications).
2. **New Application** → ponele cualquier nombre.
3. Copiá el **Application ID** de la pantalla "General Information".
4. Pegalo en el campo correspondiente del popup de la extensión.

Con esos dos datos cargados, activá el toggle "Activado" y listo.

## Cómo funciona (y por qué es distinto a una app de escritorio)

Discord Web no expone un socket RPC como el cliente de escritorio. Lo que
hace esta extensión es:

1. Un **service worker** (`background.js`) hace polling a tu URL de nxapi
   cada X minutos y guarda el JSON en `chrome.storage.local`.
2. Un content script en modo **isolated** (`content-isolated.js`) escucha
   cambios en ese storage (presencia, tu Application ID, preferencias) y los
   reenvía a la página con `postMessage`.
3. Un content script en modo **MAIN world** (`content-main.js`) —o sea, que
   corre con acceso directo al JS de la propia página de Discord— se
   engancha al *webpack chunk loader* de Discord para encontrar su
   `FluxDispatcher` interno (o usa el de **Vencord**, si está instalado, que
   es más confiable), y le dispara un evento `LOCAL_ACTIVITY_UPDATE`. Esa es
   exactamente la técnica que usan plugins conocidos como **CustomRPC** de
   Vencord/BetterDiscord.

Esto hace que el status se vea como una Rich Presence real (visible para tus
amigos), porque se integra al mismo pipeline que usa Discord para las
actividades detectadas localmente.

## ⚠️ Cosas a tener en cuenta

- **Es una API interna no documentada.** Discord puede cambiar los nombres
  internos de sus módulos en cualquier actualización y romper el hook. Si un
  día deja de funcionar, hay que ajustar el `findModule(...)` de
  `content-main.js` (buscá "vencord customrpc" para ver cómo lo mantienen
  ellos actualizado).
- **No es una feature oficial de Discord.** Modificar el comportamiento del
  cliente vía JS inyectado cae en una zona gris de los términos de servicio.
  El riesgo es bajo (es lo mismo que hacen miles de usuarios de
  Vencord/BetterDiscord) pero existe. Cada usuario usa su propia Application
  ID, así que ese riesgo lo asume cada quien con su propia cuenta.
- **Cómo se resuelven las imágenes**: el content script saca el token de
  sesión desde `AuthenticationStore` (adentro de la propia página, nunca sale
  del navegador ni se manda a ningún servidor tercero) y llama a
  `POST /api/v9/applications/{TU_APP_ID}/external-assets` con la URL de la
  portada del juego y con tu icono de Switch. Discord devuelve una key tipo
  `mp:external/...` que se usa como `large_image`/`small_image`, cacheada en
  memoria por sesión.
- Si no ves imágenes en tu Rich Presence, abrí la consola del navegador
  (F12): vas a ver un `console.warn` con prefijo `[nxapi-rpc]` indicando si
  falló la resolución del token, del asset, o si falta configurar el
  Application ID.

## Instalación (modo desarrollador)

1. Cloná o descargá este repo.
2. Abrí `chrome://extensions`.
3. Activá **Modo desarrollador** (arriba a la derecha).
4. Click en **Cargar descomprimida** y seleccioná esta carpeta.
5. Click en el ícono de la extensión y completá la
   [configuración inicial](#configuración-inicial-obligatoria).
6. Abrí o recargá Discord Web (`https://discord.com/app`).

## Notas

- Cuando `friend.presence.state` es `OFFLINE` (o no hay `title`), la
  extensión limpia la activity — a menos que actives "Mostrar 'Not playing'
  offline" en el popup, en cuyo caso deja un estado inactivo visible.
- El timestamp de inicio (`timestamps.start`) usa `title.since` del JSON
  para que Discord muestre "hace X tiempo" correctamente.
- Cada usuario que instale esta extensión necesita su **propia** URL de
  nxapi-presence y su **propio** Application ID — no se comparten entre
  instalaciones ni se suben a ningún lado, quedan solo en
  `chrome.storage.local` de cada navegador.

## Funcionalidad portada del proyecto original nxapi

Comparando contra el código fuente de
[nxapi](https://github.com/samuelthomas2774/nxapi) (`src/discord/util.ts` y
`src/discord/titles.ts`, que es lo que usa la versión de escritorio/CLI para
armar su propia Rich Presence vía IPC), se sumó lo siguiente:

- **Texto de tiempo jugado**: `state` muestra
  `"Played for X hours, Y minutes since DD/MM/YYYY"`, calculado igual que
  `hrduration()` + `getPlayTimeText()` de nxapi, usando
  `game.totalPlayTime` y `game.firstPlayedAt` del JSON de presencia. Si el
  juego trae su propia `sysDescription` (texto que el juego reporta a
  Nintendo), esa tiene prioridad — mismo orden de prioridad que nxapi.
- **Botón de "Nintendo eShop"**: usa directamente `title.url`, que ya viene
  armado en el JSON de nxapi-presence con el link de redirección correcto,
  igual al que genera `getDiscordPresence()` en el original.
- **Texto de imagen grande**: sigue el patrón `"{Juego} | Nintendo Switch
  Online"` que usa nxapi en `large_text`.
- **Estado inactivo opcional**: réplica liviana de
  `getInactiveDiscordPresence()` — cuando estás offline y activás el
  toggle correspondiente, muestra "Not playing" en vez de borrar la
  actividad.

Lo que **no** se portó (fuera de alcance para una extensión de navegador):
- El transporte real por IPC local (`src/discord/rpc.ts`) — no aplica
  porque estamos inyectando directo en el cliente web, no hablando con un
  proceso de Discord de escritorio.
- Los overrides por juego de `src/discord/titles/*` (client IDs específicos,
  monitors externos para juegos como Splatoon/Animal Crossing, etc.) —
  bienvenidas las PRs si alguien quiere sumar alguno puntual.

## Licencia

[MIT](LICENSE) © addictive-gamer
