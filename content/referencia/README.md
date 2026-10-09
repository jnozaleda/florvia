# Fichas de referencia de plantas

> Se usan de verdad: `node tools/build-species-seed.mjs` genera de este archivo los sinónimos, los nombres comunes y el texto de contexto que el Worker (`worker/src/`) da a la IA al generar la ficha de estas especies. Tras cambiar `plantas.json`, ejecútalo y despliega el Worker.

`plantas.json` reúne, para las plantas más comunes en España, lo que dicen fuentes de calidad sobre su cuidado, con **la procedencia de cada dato** (enlaces) y lo que **queda pendiente de confirmar**. Es la base para las fichas «bloqueadas» (que la IA no sustituye) y para dar contexto a la IA al generar las demás.

**Estado: borrador contrastado con fuentes. No está revisado por un experto.** Se publica a la gente como «orientativo». Cuando haya una persona con conocimiento que lo revise, se anotará en `historial` y en cada planta.

## Cómo se añade una fuente
1. Quien lleva el proyecto pasa un enlace (o el texto) sobre una planta.
2. Se lee **a mano** (no se rasca la web) y se apuntan los **datos**, nunca el texto: se escribe con palabras propias.
3. En esa planta se añade la fuente a `fuentes` (título, enlace, tipo), se anota en `contraste` cada dato en el que las fuentes coinciden o difieren, y se actualiza `verificacion` (qué queda verificado y qué pendiente).
4. Se sube la `version` y se anota en `historial`.
5. `node tools/check-referencia.mjs` comprueba que cada planta mantiene su procedencia.

## Peso de las fuentes
| Tipo | Ejemplos | Peso |
|---|---|---|
| **A** Institucional o botánica | RHS, Kew, universidades, Real Jardín Botánico, administraciones | Alto |
| **B** Blog de vivero, tienda o floristería | Verdecora, Interflora | Medio |
| **B** Canal de confianza | Chico Plantas (decisión de Noza, 2026-10-09: experiencia en clima español) | Medio, como un vivero |
| **C** Canal o blog individual | YouTube (con el minuto) | Solo desempata |

## Reglas de decisión
- Un dato se da por **contrastado** cuando **dos fuentes A o B coinciden**. Con una sola fuente se marca «una sola fuente».
- Si discrepan, se toma el **valor más prudente**, sobre todo en frío mínimo y toxicidad (una A o dos B).
- Las **fechas y temperaturas** siguen a las fuentes españolas: la RHS describe el clima británico.
- Cuando no hay dato fiable se dice «sin dato»; no se rellena con lo que parece razonable.
- Las **frecuencias de riego en días** no salen de ninguna fuente: son rangos orientativos y dependen de clima, maceta y sustrato.
- Las decisiones tomadas sin revisor humano llevan `estado: "propuesta"`. Cuando Noza las da por buenas pasan a `confirmado` (con `confirmado_por` y `fecha`): significa aceptado por quien lleva el proyecto, **no revisado por un experto**.
- Lo `confirmado` prevalece sobre el resto del texto de la planta: se le da a la IA como decisión cerrada al generar la ficha.

## Derechos
Los datos sueltos (una temperatura, una fecha) se pueden citar con su procedencia; los textos de las fuentes no se copian. Antes de publicar texto de una ficha en la web, reescribirlo con palabras propias.

## Dónde viven las fichas y cómo se bloquean
Las fichas de la IA se guardan en la base de datos D1 (`florvia-usage`), en tres tablas (definidas en `worker/schema.sql`):
- `species_parent`: el **padre** de cada especie (lo universal), con su `status` (`generada`, `con_referencia` o `bloqueada`), `grounded` (versión de esta referencia con la que se generó), `locked` y `provenance` (fuentes y decisiones confirmadas).
- `species_child`: la **hija** por especie y casilla de ubicación (~100 km): riego y abono por estación, consejos, meses.
- `species_alias`: lo que escribe la gente (por casilla) → la especie.

Un padre **bloqueado** no se sustituye ni caduca (los demás se renuevan al año; las hijas, a los 180 días). Para ver, bloquear o invalidar fichas: `node tools/ficha-admin.mjs listar | ver <especie> | bloquear <especie> | desbloquear <especie> | invalidar <especie>`.

Qué significa «bloqueada» sin revisor: la ficha se generó con los datos de este documento, las decisiones confirmadas se cumplen, y Noza la ha aceptado. **No** es «revisada por un experto».

### Retirada de fichas con quejas
Una ficha de especie **no bloqueada** se retira sola (se guarda en `species_retired` y deja de servirse) y se escribe de nuevo, con la referencia y la ficha del grupo, la próxima vez que alguien la pida, si: recibe un 👎 con «Planta equivocada» o «Consejo dudoso»; recibe 👎 de dos personas distintas; o Noza marca uno de sus casos «Malo». Solo cuentan las quejas posteriores a la ficha actual, como mucho una retirada por especie y día, y los 👎 de los dispositivos de Noza solo cuentan a través de «Malo». Una ficha bloqueada nunca se retira: llega un correo para revisarla. `node tools/ficha-admin.mjs retiradas` las lista y `recuperar <especie>` devuelve la última retirada.

### Cuando añadimos información nueva
Cada ficha guarda una «huella» de los datos de referencia de su especie y de la nota de su grupo con que se escribió. Si cambian (una fuente nueva en `plantas.json`, una nota de grupo corregida), la próxima vez que alguien pida esa planta se escribe de nuevo con lo nuevo: solo esa planta, como mucho una vez al día por zona, y sin gastar el cupo de quien la pide. Si la IA falla, se sirve la ficha anterior. Una ficha bloqueada no cambia: llega un correo para decidir si desbloquearla e invalidarla.

### Fichas parciales
En `plantas.json`, la lista `parciales` guarda plantas de las que solo tenemos unos datos de una fuente de confianza (por ejemplo, lo que cuenta Chico Plantas en un vídeo). Cada una lleva `nombre_comun`, `otros_nombres`, `nombre_cientifico`, `datos` (frases cortas, con nuestras palabras) y `fuentes` (con enlace). La IA recibe esos datos como obligatorios y completa el resto, sabiendo que la ficha es parcial. Un `nombre_cientifico` de solo el género («Agapanthus») vale para todas sus especies. En `otros_nombres` van solo nombres comunes que identifican una sola planta («laurel común», no «laurel»). Cuando una parcial reúna todos los datos de una ficha completa, se pasa a `plantas`.
