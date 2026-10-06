# 🌿 Florvia

Inventario de plantas de jardín y terraza, registro de cuidados y avisos según el tiempo.
Web instalable en el móvil (PWA), sin compilación: HTML + JS plano, como TempCheck.

Publicada en https://florvia.app (GitHub Pages desde la raíz de `main`, dominio propio en `CNAME`). La raíz es la landing (`index.html`), la política de privacidad está en `privacidad/` y la app en `app/`. Antes se llamó «Mi Jardín» (repositorio `jnozaleda/my-garden`, que sigue vivo solo para mudar a la gente a Florvia).

## Probar en local

```bash
python3 -m http.server 8767   # abre http://localhost:8767/app/
```

Abre http://localhost:8767/app/ (o la configuración `mijardin` del panel de previsualización).

## Archivos

| Archivo | Qué hace |
|---|---|
| `app/app.js` | Pantallas (Hoy, Plantas, Ajustes), fichas, formulario y guardado en `localStorage` |
| `app/rules.js` | Reglas puras: estación actual (meteorológica, invertida en el hemisferio sur), próximo riego/abonado con el intervalo de esa estación y cómo lo cambia el tiempo (lluvia, calor, helada, viento). Umbrales en `LIMITS` |
| `app/weather.js` | Previsión de Open-Meteo (sin clave), con los 2 días anteriores para saber si llovió ayer |
| `app/sync.js` | Sincronización: marcas de tiempo por planta/registro, fusión (igual que en el Worker), claves y llamadas a `/garden` |
| `app/calendar.js` | Exporta los riegos y abonados como eventos repetidos `.ics` |
| `app/sw.js` | Service worker: instalación y, en la fase 2, recepción del aviso diario |
| `worker/` | Backend en Cloudflare (`my-garden-api`): ✨ Rellenar con IA. Ver abajo |

## Publicar una versión

El sello `?v=` también es la **versión que se ve en Ajustes → Versión de la app** (fecha de la última actualización y letra del día). El botón de esa fila descarga el `index.html` actual del servidor, compara su sello más reciente con el cargado en el móvil y avisa si hay uno nuevo (y lo recarga). No hay nada más que mantener: si se publica un cambio sin subir el sello, ese cambio tampoco llegaría a los navegadores que ya tienen la app, ni se vería como versión nueva.

Los archivos llevan `?v=AAAAMMDDx` (en `index.html`, en los `import` de `app.js` y en `calendar.js`). Al publicar cambios en `app/`, sube ese número en todos a la vez: así el navegador no mezcla un archivo nuevo con otro viejo de su caché.

## Mejoras que necesitan datos nuevos de la IA

Cada planta guarda `careVersion`. Cuando una mejora necesita datos nuevos (como la pauta por estación), se añade a `UPGRADES` en `app/app.js` con su versión, un texto y una función que rellena solo lo nuevo. Las plantas con versión anterior aparecen en un aviso arriba en Hoy (con «Más tarde», que lo oculta hasta la siguiente mejora), con un punto rojo en la pestaña Ajustes y en la tarjeta «Fichas por actualizar»; al pulsar «Actualizar» la IA completa lo que falta sin tocar lo que puso el usuario.

## Fases

1. ✅ Inventario, registro de cuidados, previsión, avisos en la app, exportar al calendario, copia de seguridad.
2. ✅ (adelantado) Rellenar con IA desde el nombre de la planta.
3. Aviso diario push a las 8:00 (reutilizando el Worker de Cloudflare y la GitHub Action de TempCheck) y calendario por suscripción (webcal) que se actualiza solo.
4. Identificación por foto (Pl@ntNet + Claude para la ficha de cuidados) y chat con el contexto del jardín.
5. Diagnóstico de plagas por foto y calendario de temporada. Opcional: sensores de humedad de PlantPulse.

## Backend: `worker/` (my-garden-api)

Cloudflare Worker en https://api.florvia.app (la dirección antigua `my-garden-api.tempcheck-app.workers.dev` sigue activa para las apps ya instaladas)

| Ruta | Qué hace |
|---|---|
| `GET /health` | Comprobación |
| `POST /identify` | `{ image (JPEG en base64, ~640 px), place }` → `{ isPlant, candidates: [{commonName, species, confidence}] }` (1–3 candidatos). Gemini con visión (solo los modelos Gemini de la cadena `PROVIDER`; Workers AI no); cuenta en la cuota diaria. Sin memoria: cada foto es una consulta |
| `POST /share` · `GET /share/:id` | Copias compartidas de solo lectura. `{ kind: "garden", plants, zoneSun }` o `{ kind: "plant", care, calendar, refPhoto, photo, place }` → `{ id, expires }`. Solo se guardan los campos de una lista (nada de notas, historial ni ubicación); caduca a los 90 días; 20 por conexión y día. Sin IA, sin edición. Enlaces `#ver=ID` (jardín) y `#planta=ID` (planta) |
| `POST /push/subscribe` · `/push/unsubscribe` · `/push/test` | Aviso diario: guarda la suscripción del navegador (endpoint de Apple/Google/Mozilla, clave del jardín, ubicación). Un cron a las 06:00 y 07:00 UTC envía a las 8:00 de Madrid lo que toca hoy (mismas reglas que la app, `app/rules.js`) y los avisos del tiempo, solo si hay algo. Cifrado Web Push y firma VAPID hechos en el Worker (clave privada en el secreto `VAPID_PRIVATE_JWK`) |
| `GET/PUT /garden/:clave` | Sincronización («clave del jardín», 16 caracteres). PUT envía el jardín entero; el Worker lo combina con lo guardado (gana el cambio más reciente por planta y registro, los borrados se guardan como marcas) y devuelve el resultado. Se guarda en KV bajo el hash de la clave. Quien tiene la clave lo lee y edita: así se comparte |
| `POST /event` | `{ device, events: [...] }` (texto plano, sin código) → suma recuentos anónimos al resumen del día (`stats:AAAA-MM-DD` en KV: eventos, dispositivos con hash, uso de la IA). La app los envía en lotes |
| `GET /stats?days=30` | Resúmenes por día para «Uso de la app». **Siempre** exige el código de acceso, aunque la IA esté abierta. Incluye `u`: consultas de IA por jardín (`X-Usage`, un hash anónimo del jardín sincronizado o del móvil) y tipo: `care`, `care_edit`, `care_upgrade`, `care_explore`, `calendar`, `identify`; `*_hit` = respondidas desde la memoria (gratis); `limit`, `error` |
| `POST /calendar` | `{ name, species, lat, lon, place }` → calendario de tareas del año (`tasks`: tipo, título, cómo, meses, `matureOnly` = solo para plantas adultas) y riesgos (`risks`: hongos, caracoles, quemaduras, viento). Se pide aparte y en segundo plano porque tarda más. Memoria propia (`cal:`). Cabecera `X-Access-Code` obligatoria |
| `POST /care` | `{ name, lat, lon, place }` → ficha de cuidados para todo el año: especie, luz que pide (`sunNeed`: sun/partial/shade) y si el sol directo la perjudica (`sunSensitive`), temperatura mínima (`minTemp`), encaje con ese clima (`climateFit` ok/warn/no + `climateNote`), y «sobre la planta» (`plantIn`, `potAdvice`, `windSensitive`, `plantMonths`, `plantWhen`, `matureSize`, `matureNote`, `bloomMonths`, `bloomWhat`, `difficulty`, `buyTips`, `toxic`, `toxicNote`, `invasive`), `seasons` (riego y abono por estación), `tips` (un consejo por estación), heladas, notas para todo el año, confianza y `alternatives` (otras plantas que se llaman igual, p. ej. «jazmín» → falso jazmín). Si el nombre no es una planta responde `422 { error: "not_plant" }`. Si llega `month` (versiones antiguas de la app), añade también `waterEvery`/`feedEvery` de esa estación. Cabecera `X-Access-Code` obligatoria |
| `POST /diagnose` | «¿Qué le pasa?»: `{ plant: {name, species, zone, pot, sun, waterEvery, lastWatered, lastFed, minTemp, frostSensitive}, symptoms: [...], note, image (JPEG base64, opcional), place }` → `{ isPlant, photo, photoSeen, urgency, summary, causes: [{title, likelihood, why, check, action}], watch, needMore }`. Gemini, sin memoria (cada respuesta es de una planta en un momento). **Si hay foto, la IA primero dice qué ve y si coincide con la planta indicada** (`photo`: `coincide` · `otra_planta` · `no_es_planta` · `dudosa` · `sin_foto`): con `otra_planta` o `no_es_planta` no se diagnostica (`causes` vacío) y la consulta se registra como `not_plant`, así que **no gasta** uno de los diagnósticos del mes (5 gratis, 30 Premium). Cuenta en la cuota diaria. Prueba: `node tools/test-diagnose.mjs` |
| `POST /hit` · `GET /stats/web` | Visitas a la landing y al blog (`track.js`). `/hit` recibe `{ path, ref }` (texto plano; `ref` es solo el host de origen), solo si viene de florvia.app, y cuenta **una persona por día y página** con una huella diaria no reversible (salada con `ACCESS_CODE`, se borra a los 2 días). Cada visita se clasifica por su User-Agent (`person`, `search`, `ai`, `preview`, `bot`): los robots no se descartan, se muestran aparte. `/stats/web?days=30` (código de acceso) alimenta la tarjeta «Visitas a la web» de «Uso de la app». Tablas `pv_*` en `schema.sql` |
| `POST /ci-alert` | `{ subject, text }` → manda un correo a la dirección de avisos (`NOTIFY_EMAIL`, por Email Routing, igual que los comentarios). Lo usa la acción de GitHub `.github/workflows/blog-check.yml` cuando falla la comprobación del blog. Exige la cabecera `X-CI-Token` igual al secreto `CI_ALERT_TOKEN` del Worker |
| `GET /check` | Dice si el código de acceso enviado (`X-Access-Code`) vale: 200 o 401. La app lo usa en Ajustes → Asistente IA |
| `POST /suggest` | «Qué planto aquí»: `{ site: {name, sun, every, mins, desc}, prefs: [...], note, owned: [...], place, lat, lon }` → `{ picks: [{commonName, species, why, fit, sunNeed, waterDays, size}], provider }`. Cadena de IA como `/care`; memoria propia (`suggest:v1:`, no gasta si se repite la misma búsqueda); cuenta en el límite mensual `suggest` |
| `POST /place` | «¿Dónde está mejor?»: `{ name, species, needs: {sunNeed, sunSensitive, minTemp, frostSensitive, windSensitive, waterDays, inPot}, current, zones: [{name, sun, every, mins, desc}], place, lat, lon }` → `{ zones: [{name, fit, note}], best, bestWhy, seasonal: [{season, zone, why}], summary }`. Memoria propia (`place:v1:`) |
| `GET /me` | El plan de quien pregunta, según `X-Key` (jardín sincronizado, comprobado en el servidor) o `X-Device`: `{ plan (free, trial, premium o lifetime; `trial` = el mes gratis de Premium, 30 días desde el más tardío de su primer uso y `meta.paywall_start`), premium, enforced, start, trialEnds, freeLimits, limits, used: {suggest, identify, diagnose}, synced, lifetimeLeft }`. Los límites (`PLAN_LIMITS` en `worker.js`) solo se aplican desde `meta.paywall_start` (2026-10-19); antes todo es gratis y quien ya usaba la app es «founder» |
| `POST /premium/intent` | «Quiero Premium»: `{ choice: monthly\|yearly\|lifetime, contact? }` → apunta el interés (tabla `premium_intent`; aún no hay pagos) y avisa por correo y push. 10 al día por móvil |
| `POST /invite/redeem` | Acceso de amigos y familia: `{ code, email }` (el correo es obligatorio) → da Premium sin pagar al jardín (`X-Key`) o, si no está sincronizado, al móvil (`X-Device`); guarda el correo en `invite_uses` y avisa a Noza por correo. 15 intentos al día por conexión |
| `POST /invite/leave` | La persona deja el código (hoja Premium → «Dejar de usar este código»): se borra su uso y su correo, el código recupera ese uso y el plan que daba termina |
| `GET /invites` · `POST /invites` · `POST /invites/update` · `POST /invites/revoke` | Para Noza (código de acceso): listar códigos y quién los usó; editar un código `{ code, label?, maxUses?, accessDays? (vacío = sin fin), active? }` (la nueva duración se aplica también a quien ya lo usa, contando desde su activación; los usos no pueden bajar de los que ya hay); crear un código `{ label, maxUses, accessDays?, expiresDays? }` → `{ code }` (8 caracteres); retirar `{ code, email? }`: con correo solo a esa persona, sin él apaga el código y retira a todos. Hay una tarjeta «Amigos y familia» en Uso de la app |
| `POST /feedback` · `GET /feedback` · `POST /feedback/status` | Comentarios (Ajustes → Enviar un comentario y formulario de la web). `POST`: `{ type, text, contact?, tech?, website }` (`website` es una trampa para robots; las preguntas exigen correo; 5 al día por conexión o móvil); se guarda en D1 y avisa por correo y push. `GET` (código de acceso): comentarios, cuántos son nuevos y los errores de 14 días agrupados. `POST /feedback/status`: `{ id, status: new\|read\|done }` |
| `POST /error` | Errores técnicos del navegador de la app: `{ msg, device, garden, version, at }`; 10 al día por móvil; se borran a los 90 días |
| `GET /stats2?days=30` | «Uso de la app» desde D1 (código de acceso): real contra pruebas, personas, IA por función con tokens, interés en Premium y procedencia del blog (`refs`). Es la que lee la app; `/stats` (KV) es la versión antigua |
| `POST /internal` · `POST /usage/label` · `POST /usage/delete` | Marcar este móvil como tuyo (`{ on }`, no cuenta como uso real), poner un nombre a una persona del uso (`{ id, label }`), y «Borrar mis datos del servidor» (quita sus filas de uso, comentarios, errores, nombres y marcas). Los dos primeros exigen el código de acceso |
| `POST /push/admin` | Activa o desactiva el aviso de comentarios nuevos en este dispositivo (`{ sub, on }`, código de acceso) |
| `POST /auth/google` | Entrar con Google en Sincronizar: `{ credential, key }` → `{ key, existing }`; verifica el token con `GOOGLE_CLIENT_ID` y enlaza la cuenta con la clave del jardín (si ya había una, devuelve esa) |
| `DELETE /garden/:clave` · `DELETE /share/:id` | Borrar la copia sincronizada (y sus avisos y enlaces de Google) o una copia compartida |

- **Proveedor de IA:** `PROVIDER` y `MODEL` en `wrangler.toml`. Hoy usa Workers AI (gratis) con `@cf/qwen/qwen3.8-27b`, elegido tras comparar con Gemma 4 y Llama 3.3 70B. Para pasar a Claude, se añade un proveedor en `src/worker.js` y se cambia `PROVIDER`.
- **Protecciones:** solo acepta peticiones desde la web publicada y desde localhost (`ALLOWED_ORIGINS`); código de acceso (secreto `ACCESS_CODE`, copia local en `worker/.access-code`, que no se sube a git) **activable con `REQUIRE_CODE`** (desde el 2026-10-02 está en `off` para compartir la app en familia; la app lo detecta con `GET /health`); tope diario total (`DAILY_LIMIT`) y por conexión (`IP_DAILY_LIMIT`). Volver a `on` antes de pasar a un proveedor de pago.
- **Memoria:** guarda cada respuesta 180 días por planta y zona de ~100 km (vale para todo el año), así que repetir una planta no gasta. No guarda las respuestas de confianza baja.

```bash
cd worker
npm install
npx wrangler deploy                       # publicar
npx wrangler secret put ACCESS_CODE       # cambiar el código de acceso
npx wrangler secret put CI_ALERT_TOKEN    # clave del aviso por correo del blog (el mismo valor va en el secreto de GitHub CI_ALERT_TOKEN)
echo 'ACCESS_CODE=local-test' > .dev.vars && npx wrangler dev --port 8788   # probar en local
```

## Backlog

El backlog vive en GitHub Issues, en el repositorio privado [jnozaleda/mygarden-backlog](https://github.com/jnozaleda/mygarden-backlog/issues) (desde el 2026-10-02). Las ideas que estaban aquí se pasaron a issues (#7–#17).

## Notas de la mudanza (2026-10)

- El Worker se llama aún `my-garden-api` (nombre interno; la app usa api.florvia.app y `workers_dev = true` mantiene la dirección antigua viva). Este repositorio es ahora su fuente de verdad: `cd worker && npx wrangler deploy`.
- Las claves de almacenamiento del navegador siguen empezando por `mj_` (cambiarlas borraría datos de la gente).
- Contacto: hello@florvia.app (Cloudflare Email Routing, reenvía al correo del autor).
