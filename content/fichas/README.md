# Fichas escritas a mano

Fichas de cuidados escritas por Claude (en una sesión con Noza) a partir de `content/referencia/plantas.json` y de las notas de grupo, en lugar de dejarlas a la IA de la app. Una por planta: `<planta>.json`.

- `ficha`: la parte general de la especie (campos de la respuesta de la IA: luz, frío, maceta, cómo regar, toxicidad, notas…).
- `zonas`: por celda de clima (`"lat:lon"` redondeados; `"40:-4"` es Madrid), los días de riego y abono por estación, los consejos de cada estación, el encaje con el clima, los meses de plantar y de flor, y `calendario` (tareas del año y riesgos).
- `autor`, `fecha`, `revisado_por` (vacío mientras no la revise un experto) y `nota` (de dónde sale y qué es orientativo).

Uso:
- `node tools/fichas-curadas.mjs` comprueba todas: que los campos existan y que la app no recorte ningún texto (consejos de menos de ~160 caracteres, etc.).
- `node tools/fichas-curadas.mjs subir <planta>` la sube a producción bloqueada (la ficha general, cada zona y su calendario). La IA de la app no la sustituye ni caduca; en otras zonas, la IA solo escribe la parte de clima. Si cambia su información de referencia, llega un correo a Noza para reescribirla aquí y volver a subirla.
