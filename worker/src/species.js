// Species names: how a typed or scientific name becomes the key a care sheet is kept under.
// SYNONYMS and ALIASES come from species-seed.js, generated from content/referencia/plantas.json (tools/build-species-seed.mjs).
import { SYNONYMS, ALIASES } from "./species-seed.js";

export const normName = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

// Words that are not part of the species: hybrid sign, «spp.», cultivar and variety marks.
const NOISE = new Set(["x", "spp", "sp", "cv", "var", "subsp", "ssp", "f"]);
// Genus + epithet, lowercase, without hybrid signs, authors, varieties or cultivars: «Citrus × limon», «Citrus limon (L.) Osbeck» and «Citrus limon» are
// the same plant here. A name with a single word (a genus) stays as it is. Empty when there is no usable species.
export const rawSpeciesKey = (species) => normName(species).split(" ").filter((w) => w && !NOISE.has(w)).slice(0, 2).join(" ");

// An old or alternative scientific name points to the accepted one («rosmarinus officinalis» → «salvia rosmarinus»).
export const canonicalKey = (key) => SYNONYMS[key] ?? key;
export const speciesKey = (species) => canonicalKey(rawSpeciesKey(species));
// The other keys a species may still be kept under (sheets saved before the synonym was known).
const SOURCES = {};
for (const [from, to] of Object.entries(SYNONYMS)) (SOURCES[to] ??= []).push(from);
export const synonymSources = (key) => SOURCES[key] ?? [];
// A common name we know for sure: «pelargonio» → «pelargonium hortorum». Ambiguous names («jazmín», «ficus») are not in the list.
export const seedAlias = (name) => ALIASES[normName(name)] ?? "";
