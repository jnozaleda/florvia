# Fichas de conocimiento por grupo de plantas

Notas cortas y **no públicas** (no generan páginas del blog) con lo que vale para todo un grupo de plantas y para cada estación. Sirven de contexto cuando se escribe o se revisa una ficha de planta o una guía, y están pensadas para pasárselas también a la IA que genera las fichas de cuidados de la app (ticket en el backlog).

Reglas:
- Un archivo por grupo, con nombre en minúsculas y guiones (`suculentas.md`). El nombre es el valor de `grupo:` en la cabecera de las fichas de planta.
- Cabecera: `grupo`, `nombre`, `clima` (para qué clima valen las pautas), `plantas` (ejemplos), `especies`, `nombres`, `updated`.
- `especies` (géneros o «Género especie», en latín) y `nombres` (nombres comunes; da igual con o sin tildes) dicen al Worker qué plantas son de este grupo. Una especie concreta («Ficus elastica») gana a un género; si una planta no encaja en ningún grupo, la IA no recibe ninguna ficha de grupo (mejor nada que una pauta equivocada). Al cambiar algo aquí, ejecuta `node tools/build-knowledge.mjs` (genera `worker/src/knowledge.js`) y vuelve a publicar el Worker.
- Después, un apartado por estación (`## Primavera`, `## Verano`, `## Otoño`, `## Invierno`) con 3–6 viñetas cortas, y `## Errores comunes`.
- La ficha de la planta manda: si una planta concreta contradice a su grupo, gana la ficha de la planta.
- Hemisferio norte y clima mediterráneo/templado salvo que diga otra cosa. Las pautas con cifras (temperaturas) son orientativas.
