# Contexto de Florvia (para retomar el trabajo en otra sesión)

> Este archivo lo lee `node tools/contexto.mjs`, que lo convierte en un texto listo para pegar en un prompt.
> Mantenlo corto y cierto: si cambias algo importante, actualiza aquí la sección correspondiente.

## Quién y cómo
- Noza es la dueña de Florvia y lidera el equipo de customer success en una empresa de IA. Habla en español.
- Quiere entender cómo funcionan las cosas y no le gusta el lenguaje complicado: explica con palabras simples.
- No publica el Worker ni crea tablas/secretos en Cloudflare una sesión de Claude: lo hace ella (o una sesión con acceso a Cloudflare).

## Qué es Florvia
App web (PWA) para cuidar plantas. Todo en `jnozaleda/florvia`.
- `index.html`, `landing.js`, `track.js`: landing y baliza de visitas anónima.
- `app/`: la PWA (JS sin framework). `app/app.js`, `app/styles.css`, `app/calendar.js`. La versión es `?v=AAAAMMDDx` en `app/index.html` y se ve en Ajustes → «Versión de la app».
- `content/{plantas,guias}/*.md` → `tools/build-blog.mjs` genera `es/…`, `sitemap.xml` y `app/pages.json`. Reglas de redacción: `content/GUIA.md`. Las valida `tools/check-blog.mjs`.
- `worker/`: backend en Cloudflare Workers (`src/worker.js`, `wrangler.toml`, `schema.sql`). Usa D1 (`florvia-usage`), KV `CACHE`, Email Routing y Web Push. Rutas documentadas en `README.md`.
- `privacidad/index.html`: política de privacidad.
- Publicación: GitHub Pages desde `main`. El Worker se publica a mano: `cd worker && npx wrangler deploy`.

## Fichas de conocimiento por grupo
- `content/conocimiento/*.md` (no públicas): reglas por grupo de plantas y estación (interior, citricos, mediterraneas, arbustos-de-flor, suculentas, huerto). Cada ficha de planta lleva `grupo:`; el comprobador valida que exista. Leerlas antes de escribir fichas.
- Pendiente: pasar la ficha del grupo y la estación como contexto a la IA del Worker (ver ticket en el backlog).

## Cómo se trabaja
- Rama de trabajo de Claude: `claude/help-and-changes-6wfexr`.
- «Abre el pull request y mergealo» → crear PR hacia `main` y fusionarlo (método «merge»).
- «Actualiza el repo / sincroniza» → traer `main` y dejar la rama igual que `main`.
- Pruebas: `tools/test-*.mjs` (Node 22, `node:sqlite` simula D1). Se ejecutan en `.github/workflows/blog-check.yml` («Comprobar el blog»). Ejecutar todas: `for f in tools/test-*.mjs; do node $f || exit 1; done` y `node tools/build-blog.mjs`.
- Pendientes y tickets: repo `jnozaleda/mygarden-backlog` (etiquetas `Noza`, `Claude`, `técnico`, `idea`). Los tickets deben llevar detalle suficiente para retomarlos desde otra sesión.
- El entorno de Claude no llega a api.florvia.app ni florvia.app.

## Cómo funciona la IA
- Cadena de proveedores: Gemini `gemini-flash-latest` → `gemini-flash-lite-latest` → Workers AI (`@cf/qwen/qwen3.8-27b`).
- Fichas de cuidados: en D1 (`species_parent`, `species_child`, `species_alias`): «padre» por especie (365 días), «hijas» por zona y alias (180 días). Un padre puede estar `bloqueada` (no se sustituye ni caduca; hoy solo el olivo). Gestión: `node tools/ficha-admin.mjs listar|ver|bloquear|desbloquear|invalidar`.
- Referencia: `content/referencia/plantas.json` (20 especies con fuentes) → `tools/build-species-seed.mjs` genera alias, sinónimos y el texto de referencia que se pasa a la IA. Reglas en `content/referencia/README.md`.
- Límites: `DAILY_LIMIT=200` consultas al día, `IP_DAILY_LIMIT=50`; límites por plan (gratis/prueba/premium) y totales mensuales 40/150/300.
- Errores: `quota` (503, sin cuota), `ai` (502, otro fallo), `limit` (429, tope). `alertOnce` manda correo y push a Noza al 80 % y 100 % del tope y cuando se agota la cuota (una vez por tipo y día).
- Diagnóstico («¿Qué le pasa?»): la IA comprueba antes si la foto es de esa planta (`coincide`, `otra_planta`, `no_es_planta`, `dudosa`, `sin_foto`). Una foto equivocada no se diagnostica y no gasta cuota mensual (se registra como `not_plant`). Nota libre de hasta 300 caracteres.
- Valoración «¿Te sirvió?»: cada respuesta se guarda como caso en D1 (`ai_cases`, 180 días; foto en KV `case-photo:ID`). A Noza le llega un correo con enlace al caso y un resumen diario. Rutas: `POST /rating`, `GET /cases`, `POST /case/status`, `POST /ratings/summary`.

## Pagos y acceso
- Polar (`POLAR_ENV=production`), un mes de Premium gratis para todos, y códigos de «amigos y familia» propios (sin tarjeta).

## Métricas
- Visitas a la web: `track.js` → `POST /hit` → tablas `pv_*`; se ven en la app (Ajustes → visitas) vía `GET /stats/web`. Clasifica persona/buscador/IA/vista previa/robot.
- Uso de la IA: `GET /stats2` (tope diario, cuota, otros fallos, «no era una planta», consumo de hoy).

## Estado y pendientes (a fecha de la última actualización de este archivo)
- Última sincronización: `main` incluye valoraciones con casos guardados, fichas por especie, plantas populares y lista «Qué se pide» con CSV.
- **La política de privacidad está desfasada**: dice «No la guardamos» sobre la foto y «No guardamos el texto ni la foto» en el diagnóstico, pero ahora se guardan casos de la IA (180 días). Falta actualizarla (frases, fila «Valoraciones y casos de la IA», retención de 180 días).
- Revisar los tickets #55–#59 (calidad de la IA): #56 y #57 parecen hechos.
- Otros abiertos: #48, #49 (pruebas de fotos del diagnóstico, aviso de versión nueva), #54 (publicar el Worker para las alertas, quizá ya hecho).
- Sin respuesta de Noza: pruebas extra de los eventos de Polar (eventos fuera de orden, pago único frente a suscripción); comprobar en el panel de Polar la prueba gratuita.
- Ideas sin pedir: aviso automático «Hay una versión nueva»; probar en un iPhone real.
