# Guía para escribir posts del blog

Todos los posts viven en `content/` como archivos `.md`. El script `tools/build-blog.mjs` los convierte en páginas web (`es/<tipo>/<slug>/index.html`), actualiza los índices y el `sitemap.xml`. Este archivo no se publica: el script solo lee `content/plantas/` y `content/guias/`.

Hay dos tipos de post:

| Tipo | Carpeta | Para qué sirve | Ejemplo |
|---|---|---|---|
| **Ficha de planta** | `content/plantas/` | Todo sobre una planta concreta | `romero.md` |
| **Guía** | `content/guias/` | Responde una pregunta o compara plantas | `plantas-faciles-de-cuidar.md` |

## 1. Nombre del archivo

- El nombre del archivo (sin `.md`) es el `slug`, y de él sale la dirección: `romero.md` → `/es/plantas/romero/`.
- Solo minúsculas, sin tildes ni eñes, palabras separadas por guiones: `cuando-podar-buganvilla.md`.
- Una ficha de planta se llama como la planta, en singular: `jazmin.md`, no `jazmines.md`.
- Una guía se llama como la pregunta que responde: `cada-cuanto-regar-limonero-en-maceta.md`.
- Una vez publicado, no se cambia el nombre. Cambia la dirección y se pierden las visitas que ya llegan por Google.

## 2. Cabecera del post (front matter)

Todo post empieza con un bloque entre dos líneas `---`. Ejemplo real:

```yaml
---
title: Romero: cuidados, riego, poda y maceta | Florvia
h1: Romero: cuidados, riego, poda y maceta
description: Cómo cuidar el romero: sol, poco riego, poda, frío y por qué se seca o se pone amarillo.
updated: 2026-10-05
published: 2026-10-05
plant: Romero
ctaTitle: ¿Tienes romero?
ctaText: Añádelo a Florvia y te diremos cuándo regarlo y cuándo podarlo según la época del año y el tiempo donde vives.
ctaButton: Añadir mi romero
ctaFinalTitle: Lleva los cuidados de tu romero en Florvia
ctaFinalText: Es fácil, pero la poda a tiempo marca la diferencia. Florvia te avisa.
related:
  - plantas/lavanda|Lavanda: cuidados, riego, poda y maceta
  - guias/plantas-terraza-mucho-sol|Plantas para una terraza con mucho sol
---
```

Campos opcionales:

- `popular: N` (solo en fichas de planta; número entero, único): la ficha sale en el bloque «Plantas populares» de la landing, de menor a mayor. Es una selección editorial de plantas muy comunes, **no** un ranking de uso de Florvia: no la presentes como «las más analizadas» hasta que sea verdad con datos.
- `grupo: nombre` (solo en fichas de planta; recomendado): grupo de plantas al que pertenece (`interior`, `citricos`, `mediterraneas`, `arbustos-de-flor`, `suculentas`, `huerto`), que es el nombre de un archivo de `content/conocimiento/`. Antes de escribir o revisar una ficha, lee la del grupo: allí está lo que vale para todo el grupo y para cada estación. El comprobador falla si el grupo no existe.
- `featured: N` (número entero, único): el post sale en el bloque «Aprende a cuidar tus plantas» de la landing, ordenado de menor a mayor. La tarjeta usa `h1` y `description`. Normalmente se destacan 4 guías; para quitar una de la landing, borra la línea. La landing se regenera sola con `node tools/build-blog.mjs`; no edites a mano lo que hay entre `<!-- aprende:start -->` y `<!-- aprende:end -->` en `index.html`.

| Campo | ¿Obligatorio? | Qué poner |
|---|---|---|
| `title` | Sí | Lo que sale en la pestaña del navegador y en Google. Termina siempre en ` \| Florvia`. Intenta que mida **60 caracteres o menos**, para que Google no lo corte |
| `h1` | Sí | El título grande de la página. Igual que `title` pero sin ` \| Florvia` |
| `description` | Sí | El texto que Google muestra bajo el título. Entre **90 y 155 caracteres**. Dice qué va a encontrar la persona, en una frase |
| `updated` | Sí | Fecha del último cambio de fondo, `AAAA-MM-DD`. Se muestra como «Actualizado: octubre de 2026». Cámbiala cuando revises datos, no por arreglar una coma |
| `published` | Sí | Fecha de la primera publicación. No se vuelve a tocar |
| `plant` | Solo si el post trata de **una** planta | Nombre de la planta tal como la entiende la app (`Romero`). El botón del CTA abre la app con esa planta ya escrita en «Añadir» |
| `ctaHash` | Solo en guías generales | `explorar` abre «Explorar plantas» en la app. `none` deja el botón sin destino concreto. Si hay `plant`, no hace falta |
| `ctaTitle`, `ctaText`, `ctaButton` | Sí | El bloque verde oscuro que aparece **en mitad** del post (ver sección 5) |
| `ctaFinalTitle`, `ctaFinalText` | Recomendado | El mismo bloque, al **final**, con otro mensaje. Si faltan, se repite el del medio |
| `related` | Recomendado | Lista de 3 a 5 posts de «Te puede interesar» (ver sección 6) |
| `disclaimer` | No | Cambia el aviso gris del final. Déjalo vacío: ya hay uno por defecto |

Cuidado con el formato: los dos puntos y los valores van en una sola línea, sin comillas. La lista `related` usa dos espacios y un guion.

## 3. Cómo se escribe (para todos los posts)

**Primero la respuesta.** El primer párrafo responde la pregunta del título en 2 o 4 frases, sin rodeos ni introducciones. Quien llega desde Google tiene que tener la respuesta antes de bajar. Pon en **negrita** lo más importante (la época, la cantidad, la regla).

**Lenguaje sencillo.** Frases cortas. Nada de términos técnicos sin explicar. Se habla de «tú»: «riega cuando el sustrato esté seco».

**Útil y prudente.**
- Da cifras o épocas concretas cuando se puedan dar con seguridad («una vez a la semana», «al final del invierno»).
- Si depende del clima, de la variedad o de si está en maceta, dilo. No des una regla absoluta donde no la hay.
- No inventes datos. Si no estás seguro de un dato, no lo escribas o suaviza la frase («suele», «casi siempre»).
- No prometas nada que Florvia no haga. Florvia avisa de riego, abonado, poda y tiempo según la estación y la zona. No diagnostica plagas ni sustituye a un vivero.

**Formato.**
- Solo se usan títulos `##` (secciones) y `###` (apartados dentro de una sección). No hay `#`, ni `####`.
- Se pueden usar: párrafos, **negrita**, *cursiva*, listas con `-` o `1.`, tablas, citas con `>` y enlaces `[texto](/ruta/)`.
- No se pueden usar imágenes ni listas dentro de listas. El script no las entiende.
- Cada título lleva una palabra clave real, la que escribiría una persona en Google: «Cada cuánto regar el romero», no «El agua».
- Largo orientativo: entre **400 y 1.000 palabras** de texto (sin contar la cabecera). Hoy los posts miden entre 407 y 900.

## 4. Estructura de una ficha de planta (`content/plantas/`)

Siempre estas secciones y en este orden. Si una no aplica a la planta, se quita, pero no se reordena.

1. **Párrafo de apertura** (sin título): luz, riego, poda y frío en pocas frases.
2. `## Cuidados rápidos`: tabla con las cabeceras exactas `| Necesidad | Recomendación |`. Filas, en este orden: **Luz, Riego, Abono, Poda, Temperatura, Dificultad, Maceta**. El script pone un icono a cada fila a partir de esa primera palabra, así que no cambies los nombres (si pones «Humedad» saldrá sin icono, y está bien).
3. `## Dónde colocar el/la/un/una <planta>`
4. `## Cada cuánto regar el/la/un/una <planta>`
5. `{{CTA}}` (ver sección 5)
6. `## Cuándo abonar el/la/un/una <planta>`
7. `## Cuándo podar el/la/un/una <planta>`
8. `## Temperatura y heladas`
9. `## Problemas frecuentes`: cada problema es un `###` con su causa y qué hacer. Termina con `### Plagas` si aplica.
10. `## Cuidados por estación`: exactamente cuatro `###` con estos nombres y este orden: `### Primavera`, `### Verano`, `### Otoño`, `### Invierno`. El script les pone un icono por el nombre, así que no los cambies.
11. `## Preguntas frecuentes` (ver sección 7)

Se pueden añadir secciones propias de esa planta (por ejemplo `## Qué jazmín tienes`, `## Cómo cambiar el color de las flores`, `## Soporte y poda`). Van entre «Dónde colocar» y «Problemas frecuentes», y deben aportar algo que las demás fichas no tienen.

## 5. Bloque de llamada a la app (CTA)

- Se escribe **una sola vez** en el texto, en una línea sola: `{{CTA}}`. Con las mayúsculas y las llaves exactas.
- Ponlo después de haber dado valor al lector: normalmente tras la sección de riego (fichas) o a mitad de la guía. Nunca en el primer párrafo.
- El script añade además el mismo bloque al final del post, con `ctaFinalTitle` y `ctaFinalText`.
- Los dos bloques cuentan cosas distintas: el del medio es contextual («¿Tienes romero?»); el del final es el cierre («Lleva los cuidados de tu romero en Florvia»).
- Textos: título corto (una pregunta o una frase), una frase de texto que diga qué hace Florvia por esa persona, y un botón con verbo: «Añadir mi romero», «Explorar plantas».
- El botón lleva solo, sin que tengas que escribirlo, el parámetro `?ref=planta-romero` o `?ref=guia-<slug>` para medir de qué página llega cada visita.

## 6. Estructura de una guía (`content/guias/`)

Las guías son más libres que las fichas, pero comparten estas reglas:

1. **Párrafo de apertura** con la respuesta directa, con lo esencial en negrita.
2. Una sección de **resumen** cerca del inicio cuando se comparan plantas o causas (`## Resumen rápido`, tabla). Si es una guía de «qué hacer cuando…», puede ser `## Resumen de tareas` o `## Resumen: síntoma, causa probable y qué hacer`.
3. El desarrollo, con `##` para cada bloque y `###` para cada elemento (cada planta, cada causa).
4. `{{CTA}}` en un punto natural a mitad del texto.
5. `## Preguntas frecuentes` al final.

Si la guía menciona una planta que tiene ficha, enlázala la primera vez que aparece: `[romero](/es/plantas/romero/)`.

### Enlaces dentro del texto

- Entre posts del blog: ruta completa que empieza por `/es/` y termina en `/`: `/es/plantas/romero/`, `/es/guias/proteger-plantas-heladas/`.
- Antes de enlazar, comprueba que ese post existe.
- No pongas enlaces a la app con parámetros a mano: eso lo hace el botón del CTA.

### Enlaces «Te puede interesar» (`related`)

- Formato: `tipo/slug|Texto del enlace`. El tipo es `plantas` o `guias`.
- Entre 3 y 5 enlaces. Si el post no existe, el script lo ignora sin avisar, así que revisa que no haya erratas.
- Que sea útil de verdad: la ficha de la misma planta, la guía de poda de esa planta, una guía de problemas habituales.
- El texto del enlace suele ser el `h1` del post enlazado.

## 7. Preguntas frecuentes

- El título de la sección es siempre exactamente `## Preguntas frecuentes`. El script reconoce esa frase para darles formato de desplegable.
- Cada pregunta es un `###`, redactada como la escribiría una persona: «¿Cada cuánto se riega el romero?».
- **Cuatro preguntas** en todos los posts.
- La respuesta es **un solo párrafo corto** (1 o 3 frases). Sin listas ni tablas: el script lo junta todo en un párrafo.
- Que no repitan literalmente el texto de arriba. Mejor las dudas que de verdad se tienen: «¿Puede estar en maceta?», «¿Por qué se muere?».

## 8. Tablas

- Escribe la fila de separación completa: `|---|---|`.
- Mantén las tablas pequeñas (hasta 4 columnas): en el móvil tienen que caber sin desplazarse.
- En tablas comparativas, la primera columna es lo que se compara (la planta) y las demás son los datos.

## 9. Antes de dar un post por terminado

- [ ] El nombre del archivo es un `slug` correcto (sección 1).
- [ ] La cabecera tiene todos los campos obligatorios, y `title` y `description` están dentro de su largo.
- [ ] El primer párrafo responde la pregunta, y lo clave está en negrita.
- [ ] Sigue el orden de secciones de su tipo.
- [ ] Hay un solo `{{CTA}}` y los textos del CTA son específicos de ese post.
- [ ] Hay 4 preguntas frecuentes con respuestas de un párrafo.
- [ ] Los enlaces internos y los de `related` apuntan a posts que existen.
- [ ] No hay datos dudosos ni promesas que la app no cumpla.
- [ ] Se ha generado el HTML (sección 10) y se ha mirado la página en el móvil.

## 10. Publicar

Desde la carpeta del proyecto:

```bash
node tools/build-blog.mjs
```

Antes de generar nada, el script **comprueba los posts** con las reglas de esta guía (`tools/check-blog.mjs`):

- **Errores**: cosas que romperían la página (falta un campo, enlace roto, falta el `{{CTA}}`, no hay 4 preguntas frecuentes, secciones de una ficha fuera de orden…). Si hay alguno, no se genera nada hasta corregirlo.
- **Avisos**: consejos que no bloquean (título de más de 60 caracteres, descripción corta o larga, texto muy corto o muy largo, demasiados enlaces en «Te puede interesar»).

Para comprobar sin generar: `node tools/build-blog.mjs --check`.

La misma comprobación se ejecuta sola en GitHub (`.github/workflows/blog-check.yml`) cuando se sube algo de `content/`, `tools/` o `es/`. Además de las reglas, comprueba que el HTML generado coincide con los posts: si cambias un `.md` y olvidas ejecutar el script, falla. Si falla, se manda un correo de aviso. Si cambias una regla de esta guía, cambia también `tools/check-blog.mjs`.

Genera o actualiza `es/plantas/<slug>/index.html`, `es/guias/<slug>/index.html`, los dos índices (`es/plantas/index.html`, `es/guias/index.html`), `sitemap.xml`, `app/pages.json` (títulos que usa «Uso de la app») y el bloque «Aprende» de `index.html`. Hay que subir al repositorio (commit) **tanto el `.md` como todo lo generado**. La web se publica desde GitHub Pages, que sirve los archivos tal cual, sin generarlos.

Para verlo en local:

```bash
python3 -m http.server 8767   # y abre http://localhost:8767/es/plantas/romero/
```

Si cambias la plantilla (colores, iconos, cabecera) hay que editar `tools/build-blog.mjs` y volver a ejecutarlo: se regeneran todas las páginas.

## 11. Cuando cambias un post que ya existe

- Corrección pequeña (una errata): no cambies `updated`.
- Cambio de contenido (nuevo dato, nueva sección, revisión de un consejo): actualiza `updated` a la fecha de hoy.
- Si añades un post nuevo que merece enlace desde otros, añádelo a `related` de las fichas o guías relacionadas, y vuelve a ejecutar el script.

## 12. Medición de visitas (`track.js`)

Las páginas del blog y la landing cargan `track.js` (el generador lo añade al pie de cada página). Es un contador de visitas **sin cookies y sin identificadores**:

- Manda al Worker (`POST https://api.florvia.app/hit`) solo la ruta de la página y el **dominio** de procedencia (nunca la dirección completa). El Worker clasifica la visita por el navegador (persona, buscador, robot de IA, previsualización de enlaces u otro robot) y guarda solo recuentos por día, página y procedencia. Una persona cuenta una vez por página y día; para eso se guarda 2 días un hash irreversible, y luego se borra.
- No cuenta a quien tenga activado «no rastrear» (Do Not Track o Global Privacy Control), ni lo que se abra desde un dominio que no sea florvia.app.
- Solo cuenta estas rutas: la landing, los dos índices y cada página de `es/plantas/` y `es/guias/`. Si añades un tipo nuevo de página (otra carpeta), hay que ampliar `HIT_PATH` en `worker/src/worker.js` y la prueba `tools/test-hit.mjs`, o no se medirá.
- Los datos se ven en la app: Ajustes → Uso de la app → «Visitas a la web». Los títulos de las páginas salen de `app/pages.json` (se regenera con el script).
- `privacidad/` **no se mide a propósito**: saber cuánta gente lee la política de privacidad aporta poco y obligaría a abrir su política de seguridad de contenido a la API.
- Lo que se mide está descrito en `privacidad/index.html` («Visitas a la web»). Si cambia lo que se guarda, actualiza también ese texto.
