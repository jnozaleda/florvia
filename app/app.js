// Florvia — plant inventory, care log and weather-aware reminders. Plain template strings,
// data in localStorage (phase 1: this device only). Actions are wired by data-action attributes.

import { fetchWeather, searchCities, parseCoords, weatherKind } from "./weather.js?v=20261007e";
import {
  CARE, SEASONS, SEASON_LABEL, dueTasks, rainCredits, irrigationRain, lastDone, upcomingTasks, monthTasks, weatherChecks, taskWindow, weatherAlerts, nextDue, daysBetween, intervalFor, seasonOf, nextSeasonStart, irrigated, plantLabel, groupGardenTasks, SUN_LABEL, SUN_NEED_LABEL, exposureOf, sunAdvice, fitReport, irrigationChecks } from "./rules.js?v=20261007e";
import { buildICS } from "./calendar.js?v=20261007e";
import { scrubPlant } from "./clean.js?v=20261007e";
import { mergeGardens, gardenDoc, hashesOf, stampChanges, docHash, newKey, formatKey, parseKey, fetchGarden, putGarden, needsPush } from "./sync.js?v=20261007e";

const DEFAULT_LOC = { name: "Madrid", lat: 40.4168, lon: -3.7038 };
// Backend (worker/): fills a plant's care sheet with AI. Needs the access code from Ajustes.
const API = "https://api.florvia.app";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const here = () => state.loc ?? DEFAULT_LOC;
const localToday = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

// ---------- Storage ----------
const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};

const state = {
  data: store.get("mj_data", { plants: [], log: [] }),
  loc: store.get("mj_loc", null),
  tab: "today", // the app always opens on Hoy
  weather: null,
  weatherError: false,
};

state.data.plants.forEach(scrubPlant);

// Sync bookkeeping (see «Sync» below): what each plant/log entry looked like at the last save.
let syncHashes = hashesOf(state.data);
let pushTimer = null;
let syncStatus = { at: store.get("mj_sync", {})?.at ?? null, error: null, devices: store.get("mj_sync", {})?.devices ?? 0 };

function save() {
  // A paused zone switches irrigation off for its plants (they keep «tiene riego»).
  for (const p of state.data.plants) {
    p.irrigationOff = Boolean(p.autoWater && pausedZones().includes(p.zone || ""));
    if (!p.irrigationOff) delete p.irrigationOffSince;
    else p.irrigationOffSince ??= localToday();
  }
  syncHashes = stampChanges(state.data, syncHashes);
  if (syncKey()) schedulePush();
  if (!store.set("mj_data", state.data)) alert("No se ha podido guardar: el almacenamiento del navegador está lleno. Prueba con fotos más pequeñas o exporta una copia.");
}

const plantById = (id) => state.data.plants.find((p) => p.id === id);

// ---------- Dates ----------
function fmtDate(iso, opts = { day: "numeric", month: "short" }) {
  return new Date(iso + "T12:00:00").toLocaleDateString("es-ES", opts);
}
// When a care task is due, relative to today (negative = late).
function relDue(n) {
  if (n === 0) return "Hoy";
  if (n === 1) return "Mañana";
  if (n > 1) return `En ${n} días`;
  return n === -1 ? "Atrasado 1 día" : `Atrasado ${-n} días`;
}

// ---------- Weather ----------
let weatherAt = 0; // when the forecast was last fetched
// Rain that already fell counts as a watering (rules.js rainCredits): written to the log so it syncs and can be undone.
// Only with a location the user chose: the default (Madrid) is not their garden's weather.
function applyRain() {
  if (!state.loc || !state.weather) return;
  const add = rainCredits(state.data.plants, state.data.log, state.weather, localToday(), state.data.deleted ?? {});
  if (!add.length) return;
  state.data.log.push(...add);
  save();
}
async function loadWeather() {
  state.weather = null; state.weatherError = false;
  render();
  try { state.weather = await fetchWeather(state.loc ?? DEFAULT_LOC); weatherAt = Date.now(); applyRain(); } catch { state.weatherError = true; }
  render();
}
// Back to the app after a while: refresh the forecast without blanking the screen.
async function refreshWeather() {
  try { state.weather = await fetchWeather(state.loc ?? DEFAULT_LOC); state.weatherError = false; weatherAt = Date.now(); applyRain(); render(); } catch { /* keep what is on screen */ }
}

// The weather card: today large, the next six days with a rain bar each, and the alerts (or a
// single calm line) underneath.
function forecastCard(alerts = []) {
  if (state.weatherError) return `<section class="card"><p class="muted">No se ha podido cargar la previsión.</p><div class="row" style="margin-top:10px"><button class="btn small secondary" data-action="retry-weather">Reintentar</button></div></section>`;
  if (!state.weather) return `<section class="card"><p class="muted">Cargando el tiempo…</p></section>`;
  const { days, today } = state.weather;
  const t = days[today];
  const k = weatherKind(t.code);
  const rainLine = t.rain >= 1 ? `${Math.round(t.rain)} mm de lluvia` : "sin lluvia";
  const next = days.slice(today + 1, today + 7).map((d) => {
    const w = weatherKind(d.code);
    const pct = Math.min(100, Math.round((d.rain / 20) * 100));
    return `<div class="wx-day"><span>${fmtDate(d.date, { weekday: "short" }).replace(".", "")}</span>${ICONS[w.kind]}<b>${Math.round(d.max)}°</b>
      <span class="wx-bar" aria-hidden="true"><span style="height:${pct}%"></span></span><span class="wx-mm">${d.rain >= 1 ? Math.round(d.rain) : ""}</span></div>`;
  }).join("");
  const alertRows = alerts.length
    ? alerts.map((a) => `<div class="wx-alert ${a.level}">${ICONS[a.kind] ?? ICONS.alert}<div><strong>${esc(a.title)}</strong><span>${esc(a.text)}</span></div></div>`).join("")
    : `<div class="wx-calm">${ICONS.circleCheck}Sin heladas, calor extremo ni viento fuerte</div>`;
  return `<section class="card wx">
    <div class="wx-now"><span class="wx-ico ${k.kind}">${ICONS[k.kind]}</span><span class="wx-temp">${Math.round(t.max)}°</span>
      <div class="wx-desc">${k.label}<small>Mín. ${Math.round(t.min)}° · ${rainLine}</small></div></div>
    <div class="wx-days">${next}</div>
    ${alertRows}
  </section>`;
}

// ---------- Views ----------
function thumb(plant, cls = "thumb") {
  const src = plant.photo || plant.refPhoto?.url;
  return src ? `<img class="${cls}" src="${esc(src)}" alt="" />` : `<span class="${cls} placeholder">${ICONS.sprout}</span>`;
}

// Discreet traits on the plant list: water need this season as 1–3 drops (≤3 days much, ≤7 medium,
// more = little) and a snowflake for frost-sensitive plants.
function traits(p) {
  const every = intervalFor(p, "water", seasonOf(localToday(), here().lat));
  const level = !every ? 0 : every <= 3 ? 3 : every <= 7 ? 2 : 1;
  const drops = level ? `<span class="t-drops" aria-label="Riego ${["", "bajo", "medio", "alto"][level]}">${[1, 2, 3].map((i) => `<span class="${i <= level ? "on" : ""}">${ICONS.droplet}</span>`).join("")}</span>` : "";
  const frost = p.frostSensitive ? `<span class="t-frost" aria-label="Sensible a heladas">${ICONS.snow}</span>` : "";
  // Light it asks for, with the same icons as the selector in Editar: sun, cloud (partial shade), umbrella (shade).
  // A plant that burns in direct sun needs shade whatever else it says.
  const need = !p.sunNeed ? null : p.sunSensitive ? "shade" : p.sunNeed;
  const light = need ? `<span class="t-light" aria-label="${p.sunSensitive ? "Sensible al sol directo: sombra" : `Pide ${SUN_NEED_LABEL[need]}`}">${ICONS[LIGHT_ICON[need]]}</span>` : "";
  return drops || light || frost ? `<span class="p-traits">${drops}${light || frost ? `<span class="t-line">${light}${frost}</span>` : ""}</span>` : "";
}

function emptyGarden() {
  return `<section class="card empty"><div class="big">${ICONS.sprout}</div><p class="muted">Aún no tienes plantas. Añade la primera y te diremos cuándo regarla, abonarla y cuándo el tiempo cambia el plan.</p><button class="btn" data-action="new-plant">Añadir planta</button></section>`;
}

// «Primeros pasos»: a checklist for people who open Florvia with an empty garden. It's shown from the first
// empty visit until everything is done or the person hides it; existing gardens never see it.
function welcomeCard() {
  const flag = store.get("mj_welcome", null);
  if (flag === "off" || (flag === null && state.data.plants.length)) return "";
  if (flag === null) store.set("mj_welcome", "on");
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const steps = [
    ["pin", "#3b82f6", "Elige dónde está tu jardín", "Para avisarte con el tiempo de tu zona", Boolean(store.get("mj_loc", null)), "open-place"],
    ["share", "#6e6e73", "Instala Florvia en tu móvil", "Se abre como una app y permite los avisos", Boolean(standalone), "welcome-install"],
    ["refresh", "#1f8f86", "Guarda tu jardín", "Copia de seguridad y en varios móviles, con tu cuenta de Google o una clave", Boolean(syncKey()), "open-sync"],
    ["bell", "#c93b30", "Activa el aviso diario", "A las 8:00, solo si hay algo que hacer", Boolean(store.get("mj_push", false)), "open-push"],
    ["sprout", "#2f8f4e", "Añade tu primera planta", "La IA propone sus cuidados por estación", state.data.plants.length > 0, "new-plant"],
  ];
  const done = steps.filter((x) => x[4]).length;
  if (done === steps.length) { store.set("mj_welcome", "off"); return ""; }
  const row = ([icon, color, title, sub, ok, action]) =>
    `<button type="button" class="l-row" data-action="${action}"><span class="l-ico" style="background:${ok ? "#2f8f4e" : color}">${ICONS[ok ? "check" : icon]}</span><span class="l-label">${title}<span class="muted small" style="display:block;font-weight:400">${sub}</span></span><span class="l-value">${ok ? `<span class="ok">${ICONS.circleCheck}</span>` : `<span class="chev">${ICONS.chevron}</span>`}</span></button>`;
  return `<section class="card list-card settings welcome"><div class="sec">Te damos la bienvenida a Florvia <span class="meta">${done} de ${steps.length}</span></div>
    <p class="muted small" style="padding:0 16px 8px">${steps.length} pasos para empezar. Puedes hacerlos en el orden que quieras; todos son opcionales.</p>
    ${steps.map(row).join("")}
    <div class="two-btns" style="padding:8px 16px 12px">${state.data.plants.length ? "" : `<button class="btn secondary" data-action="open-sync">Ya tengo un jardín</button>`}${me?.premium && me.plan !== "trial" ? "" : `<button class="btn secondary" data-action="invite-open">Tengo un código</button>`}<button class="btn secondary" data-action="welcome-hide">Ocultar</button></div></section>`;
}
function installSheet() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  openSheet(`<div class="sheet-head"><h2>Instalar Florvia</h2><button class="btn small secondary" data-action="close">Cerrar</button></div>
    ${standalone ? `<p class="ai-status ok">Ya estás usando Florvia instalada.</p>`
      : ios ? `<ol class="steps"><li>Abre <b>florvia.app/app</b> en <b>Safari</b>.</li><li>Pulsa el botón <b>Compartir</b> (el cuadrado con la flecha).</li><li>Elige <b>Añadir a pantalla de inicio</b>.</li><li>Ábrela desde el icono nuevo: así podrás activar el aviso diario.</li></ol>`
      : `<ol class="steps"><li>Abre el menú del navegador (⋮ o «Compartir»).</li><li>Elige <b>Instalar app</b> o <b>Añadir a pantalla de inicio</b>.</li><li>Ábrela desde el icono.</li></ol>`}
    <p class="muted small">Si ya tienes plantas en el navegador, sincroniza antes (Ajustes → Sincronizar) para recuperarlas en la app instalada.</p>`);
}

// Last days of the free month of Premium: tell people before the limits start (nothing is shown the rest of the month).
function trialNudge() {
  if (!me || me.plan !== "trial" || !me.enforced || trialDaysLeft() > 5) return "";
  const n = trialDaysLeft();
  const F = me.freeLimits ?? {};
  return `<section class="card trial-nudge"><b>${n === 0 ? "Hoy termina tu mes de Premium gratis" : `Tu mes de Premium gratis termina ${n === 1 ? "mañana" : `en ${n} días`}`}</b>
    <p class="muted small">Después pasas al plan gratuito: ${F.plants ?? 8} plantas y ${F.suggest ?? 5} consultas al mes de cada función de IA. Si quieres seguir con todo, elige un plan o pide un código de uso gratuito.</p>
    <button type="button" class="btn small" data-action="open-premium">Ver opciones</button></section>`;
}
function todayView() {
  const today = localToday();
  const { plants, log } = state.data;
  const alerts = state.weather ? weatherAlerts(plants, state.weather, today).map((a) => ({ ...a, kind: ALERT_ICON[a.icon] })) : [];
  let html = trialNudge() + upgradeBanner() + forecastCard(alerts) + irrigationRainCard(today) + irrigationCard();
  if (!plants.length) return html + (welcomeCard() || emptyGarden());

  // Para hoy: overdue and due today (tomorrow onwards lives in «Próximos días»).
  const tasks = dueTasks(plants, log, state.weather, today, here().lat, 0);
  const rows = tasks.map((t) => `
    <div class="t-row">
      <span class="t-ico ${t.type}">${ICONS[TASK_ICON[t.type]]}</span>
      <div class="body">
        <div class="t-title">${CARE[t.type].label} ${esc(plantLabel(t.plant))}</div>
        ${t.type === "feed" && t.plant.feedTypes?.[seasonOf(today, here().lat)] ? `<div class="feed-type">${esc(t.plant.feedTypes[seasonOf(today, here().lat)])}</div>` : ""}
        <div class="t-when ${t.days < 0 ? "late" : ""}">${[t.days < 0 ? relDue(t.days) : "", t.plant.zone].filter(Boolean).map(esc).join(" · ") || "Hoy"}</div>
        ${t.advice ? `<div class="t-advice ${t.advice.kind}">${esc(t.advice.text)}${t.advice.kind === "skip" ? ` · <button type="button" class="link-inline" data-action="skip-rain" data-id="${t.plant.id}">Saltar</button>` : ""}</div>` : ""}
      </div>
      <button type="button" class="t-check" data-action="log" data-type="${t.type}" data-id="${t.plant.id}" aria-label="Marcar como hecho: ${CARE[t.type].label} ${esc(plantLabel(t.plant))}">${ICONS.check}</button>
    </div>`).join("");
  const upcoming = upcomingTasks(plants, log, today, here().lat, 7);
  const firstNext = upcoming.find((d) => d.items.length);
  const empty = `<div class="t-empty"><span class="badge">${ICONS.check}</span><div><b>Nada pendiente hoy</b><span>${firstNext
    ? `Próxima tarea ${dayPhrase(firstNext.date, today)}: ${CARE[firstNext.items[0].type].label.toLowerCase()} ${esc(plantLabel(firstNext.items[0].plant))}`
    : "Sin tareas en los próximos 7 días"}</span></div></div>`;
  html += tasks.length
    ? `<section class="card"><div class="sec">Para hoy <span class="meta">${tasks.length}</span></div>${rows}</section>`
    : `<section class="card">${empty}</section>`;
  return html + rainSkipCard(today) + doneTodayCard(today) + gardenWeekCard(today) + upcomingCard(today, upcoming) + locationNudge();
}

const TASK_ICON = { water: "droplet", feed: "flask" };
const YEAR_TYPE = {
  prune: ["scissors", "Poda"], repot: ["sprout", "Trasplante"], treat: ["bug", "Tratamiento"], mulch: ["shovel", "Acolchado"],
  protect: ["snow", "Frío"], clean: ["leaf", "Limpieza"], harvest: ["leaf", "Cosecha"], other: ["check", "Otros"],
};
const MONTH_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const WX_ICON = { rain: "cloud-rain", cold: "snow", heat: "flame" };

// When a year task is due: the last month of its window says «Hasta el 31 oct»; otherwise the range.
function windowLabel(w) {
  return w.lastMonth
    ? `<span class="yt-when soon">${ICONS.clock}Hasta el ${fmtDate(w.end, { day: "numeric", month: "short" })}</span>`
    : `<span class="yt-when">${ICONS.calendar}${MONTH_SHORT[Number(w.start.slice(5, 7)) - 1]} – ${MONTH_SHORT[Number(w.end.slice(5, 7)) - 1]}</span>`;
}

// «Esta semana en el jardín»: weather checks with plant names, then this month's tasks for all plants.
let weekAll = false;
// Ticks a grouped row: if every plant has it done, undo all; otherwise log it on those missing.
function toggleTasks(refs) {
  const today = localToday();
  const items = refs.map((ref) => {
    const [id, i] = ref.split(":");
    const p = plantById(id);
    const task = p?.yearTasks?.[+i];
    const w = task && taskWindow(task.months, today);
    return task && w && { p, task, ref, logs: state.data.log.filter((e) => e.type === "task" && e.ref === ref && e.date >= w.start) };
  }).filter(Boolean);
  if (items.every((x) => x.logs.length)) {
    const drop = new Set(items.flatMap((x) => x.logs));
    state.data.log = state.data.log.filter((e) => !drop.has(e));
  } else {
    const time = new Date().toTimeString().slice(0, 5);
    for (const x of items.filter((x) => !x.logs.length)) state.data.log.push({ id: uid(), plantId: x.p.id, type: "task", ref: x.ref, date: today, time, note: x.task.title });
    track("task_done");
  }
  save();
  render();
}

// «No aplica»: hides an AI year task for this plant (e.g. thinning grapes on a young vine). The task
// is marked off, not deleted, so log refs (plant:index) stay valid; its title is remembered so a
// fresh calendar from the AI doesn't bring it back. «Recuperar» in the year calendar undoes it.
const skipBtn = (x, reopen = false) => `<button type="button" class="yt-skip" data-action="task-skip" data-id="${x.plant.id}" data-i="${x.i}" ${reopen ? 'data-reopen="1"' : ""}>No aplica</button>`;
const removedLink = (p) => {
  const n = (p.yearTasks ?? []).filter((t) => t.off).length;
  return n ? `<button type="button" class="link-btn" data-action="task-restore" data-id="${p.id}">Recuperar ${n === 1 ? "1 tarea quitada" : `${n} tareas quitadas`}</button>` : "";
};
const sameTask = (a, b) => normTitle(a) === normTitle(b);
const normTitle = (t) => String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
function applyCalendar(plant, cal) {
  plant.yearTasks = (cal.tasks ?? []).map((t) => (plant.skippedTasks ?? []).some((s) => sameTask(s, t.title)) ? { ...t, off: true } : t);
  plant.risks = cal.risks ?? [];
}

function gardenWeekCard(today) {
  const { plants, log } = state.data;
  const checks = weatherChecks(plants, state.weather, today, zoneSun()).filter((c) => !c.title.startsWith("Riego automático"));
  const items = groupGardenTasks(monthTasks(plants, log, today));
  if (!checks.length && !items.length) return "";
  const done = items.filter((x) => x.done).length;
  const shown = weekAll ? items : items.slice(0, 5);
  return `<section class="card">
    <div class="sec">Esta semana en el jardín ${items.length ? `<span class="meta">${done} de ${items.length}</span>` : ""}</div>
    ${items.length ? `<div class="progress"><span style="width:${Math.round((done / items.length) * 100)}%"></span></div>` : ""}
    ${checks.map((c) => `<div class="wx-flag">${ICONS[WX_ICON[c.kind]]}<div><b>${esc(c.title)}</b><span>${esc(c.text)}</span></div></div>`).join("")}
    ${shown.map((x) => `<div class="yt-row ${x.done ? "done" : ""}">
      <button type="button" class="yt-box" data-action="task-toggle" data-refs="${x.members.map((m) => m.ref).join(",")}" aria-pressed="${x.done}" aria-label="${x.done ? "Desmarcar" : "Marcar como hecha"}: ${esc(x.title)}">${ICONS.check}</button>
      <div class="body"><b>${esc(x.title)}</b><div class="yt-how">${esc(x.how)}</div>
        <div class="yt-meta">${x.members.map((m) => `<button type="button" class="yt-plant" data-action="open-plant" data-id="${m.plant.id}">${ICONS.sprout}${esc(plantLabel(m.plant))}</button>`).join("")}${x.members.length > 1 ? `<span class="yt-when">${x.members.length} plantas</span>` : ""}${x.done ? "" : windowLabel(x.window)}${x.done || x.members.length > 1 ? "" : skipBtn(x.members[0])}</div></div>
    </div>`).join("")}
    ${items.length > 5 ? `<button type="button" class="link-btn" data-action="toggle-week-tasks">${weekAll ? "Ver menos" : `Ver las ${items.length}`}</button>` : ""}
  </section>`;
}

// Ficha: «Este mes» (this plant's tasks + weather checks that name it) and the 12-month calendar.
function plantMonthCard(p, today) {
  const items = monthTasks([p], state.data.log, today);
  const checks = weatherChecks(state.data.plants, state.weather, today, zoneSun()).filter((c) => c.plantIds.includes(p.id));
  if (calendarPending.has(p.id)) {
    return `<section class="card"><div class="sec">Este mes</div><div class="ai-step"><span class="spinner" aria-hidden="true"></span>Preparando el calendario del año…</div></section>`;
  }
  if (!items.length && !checks.length) return "";
  const month = fmtDate(today, { month: "long" });
  return `<section class="card"><div class="sec">Este mes · ${month}${p.yearTasks?.length ? ` <span class="ai-mark">✦</span>` : ""}</div>${monthRows(p, items, checks).join("")}</section>`;
}
// The rows of «Este mes» for one plant: its year tasks and the weather checks that touch it.
function monthRows(p, items, checks) {
  return [
    ...items.map((x) => `<div class="yt-row right ${x.done ? "done" : ""}">
      <span class="yt-kind ${x.task.type}">${ICONS[YEAR_TYPE[x.task.type]?.[0] ?? "check"]}</span>
      <div class="body"><b>${esc(x.task.title)}</b><div class="yt-how">${esc(x.task.how)}</div>${x.done ? "" : `<div class="yt-meta">${windowLabel(x.window)}${skipBtn(x, true)}</div>`}</div>
      <button type="button" class="yt-box" data-action="task-toggle" data-id="${p.id}" data-i="${x.i}" data-reopen="1" aria-pressed="${x.done}" aria-label="${x.done ? "Desmarcar" : "Marcar como hecha"}: ${esc(x.task.title)}">${ICONS.check}</button>
    </div>`),
    ...checks.map((c) => `<div class="yt-row right"><span class="yt-kind weather">${ICONS[WX_ICON[c.kind]]}</span><div class="body"><b>${esc(c.title)}</b><div class="yt-how">${c.plantIds.length > 3 ? `Pasa en ${c.plantIds.length} plantas de tu jardín.` : esc(c.text)}</div><div class="yt-meta"><span class="yt-when wx">${ICONS.cloud}Por el tiempo</span></div></div></div>`),
  ];
}
// For the plant sheet: { name, count, rows } or "" when there is nothing this month.
function plantMonthParts(p, today) {
  const items = monthTasks([p], state.data.log, today);
  const checks = weatherChecks(state.data.plants, state.weather, today, zoneSun()).filter((c) => c.plantIds.includes(p.id));
  if (calendarPending.has(p.id) || (!items.length && !checks.length)) return null;
  const rows = monthRows(p, items, checks);
  const pending = items.filter((x) => !x.done).length + checks.length;
  return { name: fmtDate(today, { month: "long" }), rows, count: pending ? `${pending} ${pending === 1 ? "pendiente" : "pendientes"}` : "Todo hecho" };
}

function yearCalendarCard(p, today) {
  const rows = [];
  // Feeding comes from the season table; the rest from the AI's year tasks, one row per type.
  const feedMonths = p.seasons ? [...Array(12).keys()].map((i) => i + 1).filter((m) => intervalFor(p, "feed", seasonOf(`2026-${String(m).padStart(2, "0")}-15`, here().lat))) : [];
  if (feedMonths.length) rows.push(["flask", "Abonado", "feed", feedMonths]);
  const byType = {};
  for (const t of (p.yearTasks ?? []).filter((t) => !t.off)) (byType[t.type] ??= new Set()), t.months.forEach((m) => byType[t.type].add(m));
  for (const [type, months] of Object.entries(byType)) rows.push([YEAR_TYPE[type]?.[0] ?? "check", YEAR_TYPE[type]?.[1] ?? "Otros", type, [...months]]);
  if (rows.length < 2) return removedLink(p) ? `<section class="card"><div class="sec">Calendario del año</div>${removedLink(p)}</section>` : "";
  const now = Number(today.slice(5, 7));
  return `<section class="card"><div class="sec">Calendario del año${p.yearTasks?.length ? ` <span class="ai-mark">✦</span>` : ""}</div>
    <div class="year"><span></span>${"EFMAMJJASOND".split("").map((m, i) => `<span class="ym ${i + 1 === now ? "now" : ""}">${m}</span>`).join("")}
    ${rows.map(([icon, label, cls, months]) => `<span class="yr">${ICONS[icon]}${label}</span>` +
      [...Array(12).keys()].map((i) => `<span class="yc ${months.includes(i + 1) ? `on ${cls}` : ""} ${i + 1 === now ? "now" : ""}"></span>`).join("")).join("")}
    </div>${removedLink(p)}</section>`;
}
// For the plant sheet's fold: the grid, which months have any task, and a one-line summary of this month.
function yearCalendarParts(p, today) {
  const html = yearCalendarCard(p, today).replace(/^<section class="card"><div class="sec">[\s\S]*?<\/div>/, "").replace(/<\/section>$/, "");
  if (!html.trim()) return null;
  const months = new Set();
  const feedMonths = p.seasons ? [...Array(12).keys()].map((i) => i + 1).filter((m) => intervalFor(p, "feed", seasonOf(`2026-${String(m).padStart(2, "0")}-15`, here().lat))) : [];
  feedMonths.forEach((m) => months.add(m));
  for (const t of (p.yearTasks ?? []).filter((t) => !t.off)) t.months.forEach((m) => months.add(m));
  const titles = monthTasks([p], state.data.log, today).filter((x) => !x.done).map((x) => x.task.title);
  const line = titles.length ? `Este mes: ${titles.slice(0, 2).join(", ")}${titles.length > 2 ? "…" : ""}` : "";
  return { html, months, now: Number(today.slice(5, 7)), line };
}
const ALERT_ICON = { "🥶": "snow", "🔥": "flame", "💨": "wind" };
// "mañana", "el martes"
const dayPhrase = (iso, today) => daysBetween(today, iso) === 1 ? "mañana" : `el ${fmtDate(iso, { weekday: "long" })}`;

// «Saltado por la lluvia»: waterings the rain already did in the last two days. Folded to one line (names and the rain);
// open it to see each one's next watering and undo it (the task comes back as due).
let rainSkipOpen = false;
function rainSkipCard(today) {
  const items = state.data.log.filter((e) => e.auto && e.note === "Lluvia" && daysBetween(e.date, today) <= 2 && lastDone(state.data.log, e.plantId, "water") === e.date)
    .map((e) => ({ e, p: plantById(e.plantId) })).filter((x) => x.p)
    .sort((a, b) => plantLabel(a.p).localeCompare(plantLabel(b.p), "es"));
  if (!items.length) return "";
  const newest = items.reduce((a, x) => (x.e.date > a.date ? x.e : a), items[0].e);
  const names = items.map((x) => plantLabel(x.p));
  const list = names.length > 3 ? `${names.slice(0, 3).join(", ")} y ${names.length - 3} más` : names.join(", ").replace(/, ([^,]*)$/, " y $1");
  const when = daysBetween(newest.date, today) === 1 ? "ayer" : "anteayer";
  const rows = items.map(({ e, p }) => {
    const due = nextDue(p, state.data.log, "water", today, here().lat);
    return `<div class="done-row"><span class="tick">${ICONS["cloud-rain"]}</span><span style="flex:1;min-width:0">${esc(plantLabel(p))}${due ? ` <small class="muted">· riego ${due <= today ? "hoy" : dayPhrase(due, today)}</small>` : ""}</span><button type="button" class="undo" data-action="undo-log" data-log="${e.id}">Deshacer</button></div>`;
  }).join("");
  return `<section class="card done-card ${rainSkipOpen ? "open" : ""}">
    <button type="button" class="fold" data-action="toggle-rain-skip" aria-expanded="${rainSkipOpen}"><span>Saltado por la lluvia</span><span class="meta" style="white-space:nowrap">${items.length} <span class="chev">›</span></span></button>
    ${rainSkipOpen ? `<div class="done-list">${rows}</div>` : `<p class="muted small" style="margin:0 0 2px">${esc(list)} · ${when} cayeron ${newest.mm} mm</p>`}</section>`;
}
// Automatic irrigation and the rain, per zone: pause it when the rain covers it, and remember to switch it back on once the rain has passed.
function irrigationRainCard(today) {
  const r = irrigationRain(state.data.plants, state.weather, today, pausedZones());
  const name = (z) => z || "Sin zona";
  const rows = [
    ...r.pause.map((x) => {
      const bits = [x.past >= 1 ? `han caído ${x.past} mm` : "", x.soon >= 1 ? `se esperan ${x.soon} mm` : ""].filter(Boolean).join(" y ");
      return `<div class="t-row"><span class="t-ico water">${ICONS.drip}</span><div class="body"><div class="t-title">Pausa el riego en ${esc(name(x.zone))}</div><div class="t-when">${esc(bits.replace(/^./, (c) => c.toUpperCase()))}: la lluvia lo cubre</div></div><button type="button" class="btn small secondary" data-action="zone-auto" data-zone="${esc(x.zone)}">Pausar</button></div>`;
    }),
    ...r.resume.map((x) => `<div class="t-row"><span class="t-ico water">${ICONS.drip}</span><div class="body"><div class="t-title">Riego pausado en ${esc(name(x.zone))}</div><div class="t-when">Ya no se espera lluvia: reanúdalo</div></div><button type="button" class="btn small" data-action="zone-auto" data-zone="${esc(x.zone)}">Reanudar</button></div>`),
  ];
  return rows.length ? `<section class="card"><div class="sec">Riego automático</div>${rows.join("")}</section>` : "";
}
// Without a chosen location the weather (and the rain adjustments) is Madrid's, not the garden's.
function locationNudge() {
  if (state.loc) return "";
  return `<section class="card"><div class="sec">¿Dónde está tu jardín?</div>
    <p class="muted small">Ahora ves el tiempo de Madrid. Con tu ubicación los riegos se ajustan a la lluvia que cae de verdad donde tú estás.</p>
    <div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn small" data-action="locate">Usar mi ubicación</button><button type="button" class="btn small secondary" data-action="open-place">Buscar ciudad</button><button type="button" class="btn small secondary" data-action="keep-madrid">Es Madrid</button></div></section>`;
}

// «Hecho hoy»: what was logged today, folded into one line; each entry can be undone.
let doneOpen = false;
function doneTodayCard(today) {
  const done = state.data.log.filter((e) => e.date === today && e.type !== "note").reverse();
  if (!done.length) return "";
  const rows = done.map((e) => {
    const p = plantById(e.plantId);
    const what = e.type === "water" && e.note === "Lluvia" ? `${esc(p ? plantLabel(p) : "")} · saltado por lluvia`
      : e.type === "task" ? `${esc(e.note)} · ${esc(p ? plantLabel(p) : "")}`
        : `${CARE[e.type]?.label ?? e.type} ${esc(p ? plantLabel(p) : "")}`;
    return `<div class="done-row"><span class="tick">${ICONS.check}</span><s>${what}</s>${e.time ? `<span class="time">${e.time}</span>` : ""}<button type="button" class="undo" data-action="undo-log" data-log="${e.id}">Deshacer</button></div>`;
  }).join("");
  return `<section class="card done-card ${doneOpen ? "open" : ""}">
    <button type="button" class="fold" data-action="toggle-done" aria-expanded="${doneOpen}"><span>Hecho hoy</span><span class="meta">${done.length} <span class="chev">›</span></span></button>
    ${doneOpen ? `<div class="done-list">${rows}</div>` : ""}</section>`;
}

// «Próximos días»: the next 7 days, 3 at first; rain or heat in the forecast is noted on its day.
let weekOpen = false;
function upcomingCard(today, days) {
  const forecast = Object.fromEntries((state.weather?.days ?? []).map((d) => [d.date, d]));
  const busy = days.filter((d) => d.items.length);
  const label = (iso) => daysBetween(today, iso) === 1 ? "Mañana" : fmtDate(iso, { weekday: "long" }).replace(/^./, (c) => c.toUpperCase());
  const shown = weekOpen ? busy : busy.slice(0, 3);
  const rows = shown.map(({ date, items }) => {
    const f = forecast[date];
    // Only the plants the rain reaches can skip their watering.
    const watering = items.filter((x) => x.type === "water");
    const rainy = watering.filter((x) => x.plant.rainReaches).map((x) => plantLabel(x.plant));
    const note = f && rainy.length && f.rain >= 5 && f.rainProb >= 60
      ? `<span class="day-wx">${ICONS["cloud-rain"]}${Math.round(f.rain)} mm previstos: ${rainy.length === watering.length ? "probablemente no haga falta regar" : `${esc(rainy.join(", "))} quizá no necesite${rainy.length > 1 ? "n" : ""} riego`}</span>`
      : f && watering.length && f.max >= 32 ? `<span class="day-wx hot">${ICONS.flame}${Math.round(f.max)}°: riega temprano</span>` : "";
    return `<div class="day-row"><div class="day-name">${label(date)}<small>${fmtDate(date)}</small></div><div class="day-items">
      ${items.map((x) => `<button type="button" class="day-chip ${x.type}" data-action="open-plant" data-id="${x.plant.id}">${ICONS[TASK_ICON[x.type]]}${esc(plantLabel(x.plant))}</button>`).join("")}
      ${note}</div></div>`;
  }).join("");
  const gap = busy.length && busy[0].date !== days[0].date ? `<div class="day-gap">Sin tareas hasta ${dayPhrase(busy[0].date, today).replace(/^el /, "el ")}</div>` : "";
  const body = busy.length ? gap + rows : `<div class="day-gap">Sin tareas en los próximos 7 días</div>`;
  return `<section class="card"><div class="sec">Próximos días <span class="meta">7 días</span></div>${body}
    ${busy.length > 3 ? `<button type="button" class="link-btn" data-action="toggle-week">${weekOpen ? "Ver menos" : "Ver la semana"}</button>` : ""}</section>`;
}

// Grid view (optional, remembered): photo and name only; a dot shows watering late (red) or today
// (blue). Without a photo, «Foto» picks one right there; the rest of the tile opens the plant.
function photoTile(p, log, today) {
  const due = irrigated(p) ? null : nextDue(p, log, "water", today, here().lat);
  const n = due ? daysBetween(today, due) : null;
  const dot = n === null || n > 0 ? "" : `<span class="tile-dot ${n < 0 ? "late" : "today"}" aria-label="${n < 0 ? "Riego atrasado" : "Regar hoy"}"></span>`;
  return `<div class="tile-wrap">
    <button type="button" class="tile ${p.photo || p.refPhoto ? "" : "empty"}" data-action="open-plant" data-id="${p.id}">
      ${p.photo || p.refPhoto ? `<img src="${esc(p.photo || p.refPhoto.url)}" alt="" />` : `<span class="tile-ico">${ICONS.sprout}</span>`}${dot}${p.autoWater ? `<span class="tile-drip ${irrigated(p) ? "" : "off"}" aria-label="${irrigated(p) ? "Riego automático" : "Riego pausado"}">${ICONS.drip}</span>` : ""}<span class="tile-name">${esc(plantLabel(p))}</span>
    </button>
    ${p.photo ? "" : `<label class="tile-add">${ICONS.camera}Foto<input type="file" class="tile-photo" data-id="${p.id}" accept="image/*" hidden /></label>`}
  </div>`;
}

function plantsView() {
  const { plants, log } = state.data;
  if (!plants.length) return emptyGarden();
  const today = localToday();
  const zones = [...new Set(plants.map((p) => p.zone || "Sin zona"))].sort((a, b) => a.localeCompare(b, "es"));
  plants.forEach(ensureRefPhoto);
  const grid = store.get("mj_plants_view", "list") === "grid";
  let html = `<div class="view-toggle" role="radiogroup" aria-label="Vista">
    <button type="button" role="radio" aria-checked="${!grid}" aria-label="Lista" data-action="plants-view" data-view="list">${ICONS.listView}</button>
    <button type="button" role="radio" aria-checked="${grid}" aria-label="Cuadrícula" data-action="plants-view" data-view="grid">${ICONS.gridView}</button>
  </div>`;
  for (const zone of zones) {
    const list = plants.filter((p) => (p.zone || "Sin zona") === zone).sort((a, b) => plantLabel(a).localeCompare(plantLabel(b), "es"));
    if (grid) {
      html += `<div class="zone-title">${esc(zone)} · ${list.length}</div><div class="p-grid">${list.map((p) => photoTile(p, log, today)).join("")}</div>`;
      continue;
    }
    const withIrrigation = list.some((p) => p.autoWater);
    const paused = pausedZones().includes(zone === "Sin zona" ? "" : zone);
    html += `<div class="zone-title">${esc(zone)} · ${list.length}${withIrrigation ? `<span class="zone-auto ${paused ? "off" : ""}">${ICONS.drip}${paused ? "Riego pausado" : "Riego encendido"}</span>` : ""}</div><section class="card list-card">` + list.map((p) => {
      // Next watering, coloured: late (red), today (blue), later (grey).
      const due = nextDue(p, log, "water", today, here().lat);
      const n = due ? daysBetween(today, due) : null;
      const status = irrigated(p) ? `<span class="p-status auto">${ICONS.drip}Riego automático</span>` : n === null ? "" : n < 0
        ? `<span class="p-status late">${ICONS.droplet}Regar · atrasado ${-n === 1 ? "1 día" : `${-n} días`}</span>`
        : n === 0 ? `<span class="p-status today">${ICONS.droplet}Regar hoy</span>`
          : `<span class="p-status">${ICONS.droplet}Regar ${n === 1 ? "mañana" : `en ${n} días`}</span>`;
      // Connected to irrigation but its zone has it paused: say so, so it doesn't look like a plain plant.
      const pausedTag = p.autoWater && !irrigated(p) ? `<span class="p-status auto off">${ICONS.drip}Con riego · pausado</span>` : "";
      return `<button class="p-row" data-action="open-plant" data-id="${p.id}">${thumb(p, "thumb p-thumb")}<div class="body"><div class="p-name">${esc(plantLabel(p))}</div>${p.nick ? `<div class="p-sp"><span class="p-type">${esc(p.name)}</span>${p.species ? ` · ${esc(p.species)}` : ""}</div>` : p.species ? `<div class="p-sp">${esc(p.species)}</div>` : ""}${status}${pausedTag}</div>${traits(p)}<span class="chev">${ICONS.chevron}</span></button>`;
    }).join("") + `</section>`;
  }
  return html;
}

// Automatic irrigation, two separate things: whether a plant has it (plant.autoWater, set in alta/
// Editar) and whether it's running in its zone (state.data.pausedZones, «Riego» in Ajustes). Paused,
// those plants ask for watering again; switched back on, only the ones that have it stop asking.
const pausedZones = () => state.data.pausedZones ?? [];
// Sun of each zone: set in the zone sheet (Ajustes → Zonas); used to check a plant's light and by Explorar.
const zoneSun = () => state.data.zoneSun ?? {};
// Details the user types for each zone (Ajustes → «Detalles de cada zona»): programmed irrigation
// (cada N días, minutes optional) and a short description. The irrigation figure is checked against
// what each irrigated plant of the zone asks for in the current season; see irrigationChecks (rules.js).
const zoneInfo = () => state.data.zoneInfo ?? {};
const zoneIrrigationChecks = (zone) => irrigationChecks(state.data.plants, zoneInfo(), seasonOf(localToday(), here().lat)).filter((c) => zone === undefined || c.zone === zone);
const irrigationLine = (c) => {
  const names = c.items.slice(0, 3).map((x) => `${plantLabel(x.plant)} pide cada ${x.need}`).join(", ") + (c.items.length > 3 ? "…" : "");
  return { title: c.kind === "more" ? `Riegas de más en ${c.zone || "Sin zona"}` : `Riegas de menos en ${c.zone || "Sin zona"}`,
    text: `La zona se riega cada ${c.every} ${c.every === 1 ? "día" : "días"}; ${names}. Prueba con cada ${c.suggest} ${c.suggest === 1 ? "día" : "días"}.` };
};
function irrigationCard() {
  const checks = zoneIrrigationChecks();
  if (!checks.length) return "";
  return `<section class="card"><div class="sec">Riego programado</div>${checks.map((c) => {
    const l = irrigationLine(c);
    return `<button type="button" class="fit-row link-row" data-action="zone-open" data-zone="${esc(c.zone)}"><span class="fit-ic ${c.kind === "more" ? "warn" : "info"}">${ICONS.drip}</span><div><b>${esc(l.title)}</b><span>${esc(l.text)}</span></div></button>`;
  }).join("")}</section>`;
}
function zoneDetailsCard() {
  const zones = [...new Set(state.data.plants.map((p) => p.zone || ""))].sort((a, b) => a.localeCompare(b, "es"));
  if (!zones.length) return "";
  return `<div class="group-title">Zonas</div>
    <section class="card list-card settings">${zones.map((z) => {
      const i = zoneInfo()[z] ?? {};
      const hasAuto = state.data.plants.some((p) => p.autoWater && (p.zone || "") === z);
      const bits = [SUN_LABEL[zoneSun()[z]] ?? "", hasAuto && pausedZones().includes(z) ? "riego pausado" : "", i.every ? `riego cada ${i.every} ${i.every === 1 ? "día" : "días"}` : "", i.desc ? "descrita" : ""].filter(Boolean).join(" · ");
      return `<button type="button" class="l-row" data-action="zone-open" data-zone="${esc(z)}"><span class="l-ico" style="background:#1f8f86">${ICONS.pin}</span><span class="l-label">${esc(z || "Sin zona")}${bits ? `<span class="muted small" style="display:block;font-weight:400">${esc(bits)}</span>` : ""}</span><span class="l-value"><span class="chev">${ICONS.chevron}</span></span></button>`;
    }).join("")}</section>
    <p class="group-foot">Para cada zona: cuánto sol recibe, cada cuánto riega el programador y cómo es el sitio, con tus palabras. Con eso avisamos si una planta no está donde le conviene o recibe más o menos riego del que pide, y valoramos plantas nuevas para ese sitio.</p>`;
}
function zoneSheet(zone) {
  const i = zoneInfo()[zone] ?? {};
  const checks = zoneIrrigationChecks(zone);
  openSheet(`<div class="sheet-head"><h2>${esc(zone || "Sin zona")}</h2><button class="btn small secondary" data-action="close">Cerrar</button></div>
    <form id="zoneForm" class="sheet-in" style="padding:0" data-zone="${esc(zone)}">
      <div class="group-title">Sol</div>
      <div class="seg" role="radiogroup" aria-label="Sol en ${esc(zone || "Sin zona")}">${[["sun", "Sol"], ["partial", "Media sombra"], ["shade", "Sombra"]].map(([v, t]) =>
        `<button type="button" role="radio" aria-checked="${zoneSun()[zone] === v}" data-action="zone-sun" data-zone="${esc(zone)}" data-sun="${v}">${t}</button>`).join("")}</div>
      <p class="muted small">Cuánta luz recibe la zona. Toca otra vez para quitarlo. Cada planta puede tener su propio valor en Editar.</p>
      <div class="group-title">Riego</div>
      ${(() => {
        const n = state.data.plants.filter((p) => p.autoWater && (p.zone || "") === zone).length;
        if (!n) return "";
        const on = !pausedZones().includes(zone);
        return `<button type="button" class="l-row switch-row" role="switch" aria-checked="${on}" data-action="zone-auto" data-zone="${esc(zone)}"><span class="l-label">Riego automático <span class="muted">· ${n === 1 ? "1 planta con riego" : `${n} plantas con riego`}</span></span><span class="switch" aria-hidden="true"></span></button>
        <p class="muted small">Qué plantas tienen riego se marca en cada una (Editar). Pausado, esas plantas vuelven a pedirte riego; encendido, solo te avisamos si la lluvia o el calor piden tocar el programador.</p>`;
      })()}
      <p class="muted small">Si la zona tiene programador, cada cuántos días riega. Déjalo vacío si no.</p>
      <div class="row zone-fields"><label class="grow">Cada <input type="number" name="every" min="1" max="60" inputmode="numeric" class="big-input" value="${i.every || ""}" placeholder="días" /></label>
      <label class="grow">Minutos <input type="number" name="mins" min="1" max="600" inputmode="numeric" class="big-input" value="${i.mins || ""}" placeholder="opcional" /></label></div>
      ${checks.map((c) => { const l = irrigationLine(c); return `<p class="ai-status warn"><b>${esc(l.title)}.</b> ${esc(l.text)}</p>`; }).join("")}
      <div class="group-title">Cómo es esta zona</div>
      <p class="muted small">Con tus palabras: a qué horas da el sol, sombras, viento… No escribas datos personales.</p>
      <textarea name="desc" maxlength="300" rows="4" class="big-input" placeholder="Sol de mañana hasta las 12:00 en invierno y hasta las 15:00 en verano; la pared da sombra por la tarde.">${esc(i.desc ?? "")}</textarea>
      <button class="btn block" type="submit">Guardar</button>
      <button type="button" class="btn block secondary" data-action="suggest-open" data-zone="${esc(zone)}">✦ ¿Qué planto aquí?</button>
    </form>`);
}
function saveZoneInfo(form) {
  const zone = form.dataset.zone ?? "";
  const num = (v, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 1 ? Math.min(max, n) : 0; };
  const fd = new FormData(form);
  const entry = { every: num(fd.get("every"), 60), mins: num(fd.get("mins"), 600), desc: String(fd.get("desc") ?? "").trim().slice(0, 300) };
  const all = { ...zoneInfo() };
  if (entry.every || entry.mins || entry.desc) all[zone] = entry; else delete all[zone];
  state.data.zoneInfo = all;
  save();
  closeSheet();
  render();
}

// The next season's interval, so the timer can be changed in time.
function autoHint(p, season) {
  const next = SEASONS[(SEASONS.indexOf(season) + 1) % 4];
  const every = intervalFor(p, "water", next);
  return every ? ` · en ${SEASON_LABEL[next].toLowerCase()}, cada ${every}` : "";
}

// ---------- Sync («clave del jardín», see sync.js) ----------
// After each save the changes go up a few seconds later, in one request (the free KV allows ~1,000
// writes a day); the garden comes down when the app opens or comes back to the foreground.
const syncKey = () => store.get("mj_sync", null)?.key ?? null;
const gardenLink = (key) => `${location.origin}${location.pathname}#jardin=${key}`;
function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 4000);
}
async function pushNow() {
  clearTimeout(pushTimer);
  const key = syncKey();
  if (!key) return;
  try { applyRemote(await putGarden(API, key, state.data, deviceId)); }
  catch (err) { syncStatus.error = err.message; }
}
async function pullNow() {
  const key = syncKey();
  if (!key) return;
  try {
    const remote = await fetchGarden(API, key);
    if (!remote) return pushNow();
    applyRemote(remote);
  } catch (err) { syncStatus.error = err.message; }
}
// Merge what the server has into this phone; if this phone still has something the server lacks, push again.
function applyRemote(remote) {
  const before = docHash(state.data);
  const merged = mergeGardens(gardenDoc(state.data), gardenDoc(remote));
  state.data = { ...state.data, ...merged };
  state.data.plants.forEach(scrubPlant);
  syncHashes = hashesOf(state.data);
  for (const p of state.data.plants) p.irrigationOff = Boolean(p.autoWater && (state.data.pausedZones ?? []).includes(p.zone || ""));
  store.set("mj_data", state.data);
  syncStatus = { at: Date.now(), error: null, devices: Object.keys(remote.devices ?? {}).length };
  store.set("mj_sync", { ...store.get("mj_sync", {}), key: syncKey(), at: syncStatus.at, devices: syncStatus.devices });
  if (needsPush(state.data, remote)) schedulePush();
  if (docHash(state.data) !== before) render();
  if ($("syncSheet")) syncSheet();
}
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "ahora mismo" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`;
};
function syncSheet(message = null, enterKey = false) {
  const key = syncKey();
  if (!key) {
    openSheet(`<div id="syncSheet"></div>
      <div class="sheet-head"><h2>Sincronizar</h2><button class="btn small secondary" data-action="close">Cerrar</button></div>
      <p>Guarda tu jardín en el servidor de Florvia para tenerlo igual en varios móviles o compartirlo con otra persona.</p>
      <p class="muted small">Tu jardín tendrá una clave secreta: quien la tenga puede verlo y editarlo. No hace falta crear cuenta.</p>
      ${message ? `<p class="ai-status warn">${esc(message)}</p>` : ""}
      ${GOOGLE_CLIENT_ID && !enterKey ? `<div id="gBtn" class="g-btn"></div><p class="muted small">Con Google recuperas tu jardín en cualquier móvil sin apuntar la clave. Solo guardamos una huella de tu cuenta, no tu nombre ni tu correo.</p>` : ""}
      ${enterKey ? `<input id="syncKeyInput" class="big-input key-input" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" />
        <button class="btn block" data-action="sync-enter-key">Continuar</button>`
        : `<button class="btn block" data-action="sync-on">Activar sincronización</button>
        <button class="btn block secondary" data-action="sync-have-key">Ya tengo una clave</button>`}`);
    if (enterKey) setTimeout(() => $("syncKeyInput")?.focus(), 50);
    else mountGoogleButton();
    return;
  }
  const n = state.data.plants.length;
  openSheet(`<div id="syncSheet"></div>
    <div class="sheet-head"><h2>Sincronizar</h2><button class="btn small secondary" data-action="close">Cerrar</button></div>
    <section class="card"><div class="sync-status ${syncStatus.error ? "warn" : ""}"><span class="dot"></span>${syncStatus.error ? "No se ha podido sincronizar: se reintentará" : syncStatus.at ? `Sincronizado ${ago(syncStatus.at)}` : "Sincronizando…"}</div>
      <p class="muted small">${n === 1 ? "1 planta" : `${n} plantas`}${syncStatus.devices ? ` · ${syncStatus.devices === 1 ? "1 dispositivo" : `${syncStatus.devices} dispositivos`}` : ""}</p></section>
    ${message ? `<p class="ai-status ok">${esc(message)}</p>` : ""}
    <div class="group-title">Clave del jardín</div>
    <div class="sync-key">${formatKey(key)}</div>
    <div class="sync-qr" id="syncQr"></div>
    <div class="two-btns"><button class="btn secondary" data-action="sync-copy">Copiar clave</button><button class="btn" data-action="sync-share">Compartir enlace</button></div>
    <p class="muted small">Para tenerlo en otro móvil o compartirlo: abre el enlace allí, escanea el QR con la cámara o escribe la clave en «Ya tengo una clave».</p>
    ${GOOGLE_CLIENT_ID ? (store.get("mj_sync", {}).google
      ? `<p class="ai-status ok">Vinculado a tu cuenta de Google: en otro móvil, entra con Google y tendrás este jardín.</p>`
      : `<div class="group-title">Cuenta de Google</div><div id="gBtn" class="g-btn"></div><p class="muted small">Vincúlala para recuperar este jardín sin la clave. Solo guardamos una huella de tu cuenta, no tu nombre ni tu correo.</p>`) : ""}
    <button class="btn block danger-text" data-action="sync-off">Dejar de sincronizar en este móvil</button>`);
  drawQr(gardenLink(key));
  if (GOOGLE_CLIENT_ID && !store.get("mj_sync", {}).google) mountGoogleButton();
}
// «Continuar con Google»: Google's own button (script loaded only when this sheet opens). The server turns
// the Google account into the garden key, so syncing itself still works by key.
const GOOGLE_CLIENT_ID = "234825738422-hsj10ho80vvuoosfn6rr7njjkbt751c6.apps.googleusercontent.com";
let googleLoad = null;
const loadGoogle = () => googleLoad ??= new Promise((resolve) => {
  const sc = document.createElement("script");
  sc.src = "https://accounts.google.com/gsi/client";
  sc.async = true;
  sc.onload = () => resolve(true);
  sc.onerror = () => { googleLoad = null; resolve(false); };
  document.head.append(sc);
});
async function mountGoogleButton() {
  const el = $("gBtn");
  if (!el || !GOOGLE_CLIENT_ID) return;
  if (!(await loadGoogle()) || !window.google?.accounts?.id) { el.innerHTML = `<p class="muted small">No se ha podido cargar el acceso con Google.</p>`; return; }
  window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (r) => googleSignedIn(r.credential), auto_select: false });
  const target = $("gBtn");
  if (target) window.google.accounts.id.renderButton(target, { theme: "outline", size: "large", text: "continue_with", shape: "pill", locale: "es", width: Math.min(320, target.clientWidth || 320) });
}
function activateSync(key, google = false) {
  for (const item of [...state.data.plants, ...state.data.log]) item._at ??= Date.now();
  store.set("mj_sync", { key, ...(google ? { google: true } : {}) });
}
let joinViaGoogle = false;
async function googleSignedIn(credential) {
  const mine = syncKey();
  const key = mine ?? newKey();
  syncSheet("Conectando con Google…");
  let body;
  try {
    const res = await fetch(`${API}/auth/google`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential, key }) });
    if (!res.ok) throw new Error(String(res.status));
    body = await res.json();
  } catch { return syncSheet(mine ? "No se ha podido entrar con Google. Prueba otra vez." : "No se ha podido entrar con Google. Prueba otra vez o usa la clave."); }
  if (body.key === mine) { store.set("mj_sync", { ...store.get("mj_sync", {}), google: true }); return syncSheet("Google vinculado a tu jardín."); }
  if (body.existing) { joinViaGoogle = true; return joinSheet(body.key); }
  activateSync(body.key, true);
  await refreshUsageId();
  syncSheet("Activando…");
  await pushNow();
  syncSheet("Google vinculado. Tu jardín ya se sincroniza.");
}

// QR code drawn by qrcode-generator (our own copy in vendor/, loaded on first use).
async function drawQr(text) {
  if (!window.qrcode) {
    await new Promise((resolve) => {
      const sc = document.createElement("script");
      sc.src = "vendor/qrcode.min.js?v=20261007e";
      sc.onload = resolve; sc.onerror = resolve;
      document.head.append(sc);
    });
  }
  const el = $("syncQr");
  if (!el || !window.qrcode) return;
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
}
// Joining a garden (from a #jardin= link or a typed key): show what it is, ask about this phone's plants.
let joinRemote = null;
async function joinSheet(key) {
  openSheet(`<div class="sheet-head"><h2>Unirte a un jardín</h2><button class="btn small secondary" data-action="close">Cancelar</button></div><div class="ai-step"><span class="spinner" aria-hidden="true"></span>Buscando el jardín…</div>`);
  try { joinRemote = await fetchGarden(API, key); } catch { joinRemote = undefined; }
  if (joinRemote === undefined) return syncSheet("No se ha podido conectar. Prueba otra vez.", true);
  if (joinRemote === null) return syncSheet("No hay ningún jardín con esa clave.", true);
  const names = joinRemote.plants.map(plantLabel);
  const local = state.data.plants.length;
  openSheet(`<div class="sheet-head"><h2>Unirte a un jardín</h2><button class="btn small secondary" data-action="close">Cancelar</button></div>
    <section class="card"><b>Jardín con ${names.length === 1 ? "1 planta" : `${names.length} plantas`}</b><p class="muted small">${esc(names.slice(0, 6).join(", "))}${names.length > 6 ? "…" : ""}${joinRemote.updatedAt ? ` · actualizado ${ago(joinRemote.updatedAt)}` : ""}</p></section>
    ${local ? `<p>Este móvil ya tiene ${local === 1 ? "1 planta" : `${local} plantas`}. ¿Qué hacemos con ${local === 1 ? "ella" : "ellas"}?</p>
      <label class="join-opt"><input type="radio" name="joinMode" checked /><span><b>${local === 1 ? "Juntarla" : "Juntarlas"} con el jardín</b><small>${local === 1 ? "Se añade" : "Se añaden"} al jardín compartido.</small></span></label>
      <label class="join-opt"><input type="radio" name="joinMode" id="joinReplace" /><span><b>Usar solo el jardín compartido</b><small>${local === 1 ? "Se quita la" : "Se quitan las"} de este móvil (antes se guarda una copia).</small></span></label>` : ""}
    <div class="sheet-actions"><button class="btn block" data-action="sync-join" data-key="${key}">Unirme</button></div>`);
}

// ---------- Daily push («Aviso diario», sent by the Worker at 08:00 from the synced garden) ----------
const VAPID_PUBLIC = "BAgS8ly6V2km_DtMyicFWaAQ9gGQyJdX9OP-oiXx9i9OB98Lr2H5gOkqYP9RUsYPq9333c5NPpKZgLijFUlz3ZE";
async function subscribePush() {
  const reg = await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(VAPID_PUBLIC.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
  const loc = here();
  const res = await fetch(`${API}/push/subscribe`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sub: sub.toJSON(), key: syncKey(), lat: loc.lat, lon: loc.lon }),
  });
  if (!res.ok) throw new Error(`servidor ${res.status}`);
}
function pushSheet(message = null) {
  const on = store.get("mj_push", false);
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  openSheet(`<div class="sheet-head"><h2>Aviso diario</h2><button class="btn small secondary" data-action="close">Cerrar</button></div>
    <p>Cada mañana a las 8:00, un aviso con lo que toca hoy (regar, abonar) y los avisos del tiempo (helada, calor, viento). Si no hay nada, no llega nada.</p>
    ${message ? `<p class="ai-status ${/No |Sin /.test(message) ? "warn" : "ok"}">${esc(message)}</p>` : ""}
    ${!supported || (ios && !standalone) ? `<p class="ai-status warn">${ios ? "En iPhone, los avisos solo funcionan con la app instalada: Compartir → «Añadir a pantalla de inicio», y ábrela desde el icono." : "Este navegador no admite avisos."}</p>`
      : on ? `<section class="card"><div class="sync-status"><span class="dot"></span>Activado · cada día a las 8:00</div><p class="muted small">Para ${esc(here().name)}. Usa el jardín sincronizado, así que incluye lo que hagan los demás móviles.</p></section>
        <button class="btn block secondary" data-action="push-test">Enviar un aviso de prueba</button>
        <button class="btn block danger-text" data-action="push-off">Desactivar el aviso</button>`
      : `${syncKey() ? "" : `<p class="muted small">Para avisarte con la app cerrada, el servidor tiene que conocer tus plantas: se activará también la sincronización (Ajustes → Sincronizar).</p>`}
        <button class="btn block" data-action="push-on">Activar aviso diario</button>`}`);
}

// ---------- Sharing (read-only copies; see the Worker's /share) ----------
// A fixed copy of a garden or of an explored plant, with a link that expires in 90 days. Nothing can be
// edited from it and nothing asks the AI. Notes, history and exact location never leave the phone.
const SHARE_PLANT_KEYS = ["name", "nick", "species", "zone", "photo", "refPhoto", "seasons", "tips", "feedTypes", "frostSensitive", "minTemp", "sunNeed", "sunSensitive", "sun", "rainReaches", "inPot", "autoWater", "size", "info"];
const shareLink = (kind, id) => `${location.origin}${location.pathname}#${kind === "garden" ? "ver" : "planta"}=${id}`;
async function createShare(body) {
  let res;
  try { res = await fetch(`${API}/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) }); }
  catch { throw new Error("network"); }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? "ai");
  store.set("mj_shares", [...store.get("mj_shares", []), { id: out.id, expires: out.expires }]); // so «Borrar mis datos» can remove them
  return out;
}
const shareErrorText = (err) => ({ too_big: "Pesa demasiado: quita alguna foto y prueba otra vez.", limit: "Has creado muchos enlaces hoy. Prueba mañana.", network: "Sin conexión. Prueba otra vez." }[err.message] ?? "No se ha podido crear el enlace.");
async function shareOut(url, text) {
  if (navigator.share) { await navigator.share({ title: "Florvia", text, url }).catch(() => {}); return; }
  await navigator.clipboard?.writeText(url).catch(() => {});
  toast("Enlace copiado");
}
function toast(text) {
  let t = $("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); }
  (sheet.open ? sheet : document.body).append(t);
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
}
let gardenShare = null; // { link, expires } once created
function shareGardenSheet(message = null, busy = false) {
  const n = state.data.plants.length;
  openSheet(`<div class="sheet-head"><h2>Compartir mi jardín</h2><button class="btn small secondary" data-action="close">Cerrar</button></div>
    <p>Crea un enlace para que otra persona vea tus plantas: fotos, zonas y cuidados. <b>Solo ver</b>: no puede cambiar nada y no gasta IA.</p>
    <ul class="id-tips"><li>Es una <b>copia de hoy</b>: si luego cambias algo, no se actualiza (crea otro enlace).</li><li>No incluye tus notas, el historial ni tu ubicación.</li><li>Caduca a los 90 días.</li></ul>
    ${message ? `<p class="ai-status warn">${esc(message)}</p>` : ""}
    ${gardenShare ? `<input class="big-input key-input select-on-focus" readonly value="${esc(gardenShare.link)}" />
      <p class="muted small">Copia del ${esc(fmtDate(localToday()))} · caduca el ${esc(fmtDate(new Date(gardenShare.expires).toISOString().slice(0, 10)))}</p>
      <div class="two-btns"><button class="btn secondary" data-action="share-garden-copy">Copiar enlace</button><button class="btn" data-action="share-garden-send">Compartir</button></div>`
      : n ? `<button class="btn block" data-action="share-garden-create" ${busy ? "disabled aria-busy=\"true\"" : ""}>${busy ? "Creando…" : `Crear enlace con mis ${n === 1 ? "planta" : `${n} plantas`}`}</button>` : `<p class="muted">Aún no tienes plantas que compartir.</p>`}`);
}
// What someone sees when they open a shared garden: the list, and each plant read-only.
let viewing = null; // { plants, zoneSun, at, expires }
const plantPills = (p) => [
  p.frostSensitive ? ["snow", "Sensible a heladas"] : null,
  p.sunNeed ? [LIGHT_ICON[p.sunSensitive ? "shade" : p.sunNeed], p.sunSensitive ? "Sensible al sol directo" : `Pide ${SUN_NEED_LABEL[p.sunNeed]}`] : null,
  [p.inPot ? "pot" : "ground", p.inPot ? "Maceta" : "Suelo"],
  [p.rainReaches ? "rain" : "umbrella", p.rainReaches ? "Le llega la lluvia" : "A cubierto"],
  p.autoWater ? ["drip", "Riego automático"] : null,
  p.size ? ["sprout", `Tamaño ${(SIZE_LABEL[p.size] ?? "").toLowerCase()}`] : null,
].filter(Boolean);
function viewGardenSheet() {
  const v = viewing;
  const zones = [...new Set(v.plants.map((p) => p.zone || "Sin zona"))].sort((a, b) => a.localeCompare(b, "es"));
  openSheet(`<div class="sheet-head"><h2>Jardín compartido</h2><button class="btn small secondary" data-action="close">Cerrar</button></div>
    <p class="muted small">Copia del ${esc(fmtDate(new Date(v.at).toISOString().slice(0, 10)))}. Solo para ver: no se actualiza.</p>
    ${zones.map((zone) => {
      const sun = v.zoneSun[zone === "Sin zona" ? "" : zone];
      return `<div class="zone-title">${esc(zone)} · ${v.plants.filter((p) => (p.zone || "Sin zona") === zone).length}${sun ? `<span class="zone-auto">${ICONS[LIGHT_ICON[sun]]}${SUN_LABEL[sun]}</span>` : ""}</div><section class="card list-card">${v.plants.map((p, i) => ({ p, i })).filter(({ p }) => (p.zone || "Sin zona") === zone).map(({ p, i }) =>
        `<button class="p-row" data-action="view-plant" data-i="${i}">${thumb(p, "thumb p-thumb")}<div class="body"><div class="p-name">${esc(plantLabel(p))}</div>${p.species ? `<div class="p-sp">${esc(p.species)}</div>` : ""}</div>${traits(p)}<span class="chev">${ICONS.chevron}</span></button>`).join("")}</section>`;
    }).join("")}
    <p class="muted small">¿Te gusta? Cierra esto y pulsa + para empezar el tuyo.</p>`, "shared");
}
function viewPlantSheet(i) {
  const p = viewing.plants[i];
  if (!p) return viewGardenSheet();
  const season = seasonOf(localToday(), here().lat);
  const hero = p.photo || p.refPhoto?.url;
  openSheet(`<div class="sheet-head"><h2>${esc(plantLabel(p))}</h2><div class="row"><button class="btn small secondary" data-action="view-back">Atrás</button><button class="btn small secondary" data-action="close">Cerrar</button></div></div>
    ${hero ? `<img class="hero-photo" src="${esc(hero)}" alt="" />${!p.photo && p.refPhoto ? `<small class="hero-credit">Foto de referencia: ${esc(p.refPhoto.credit)}</small>` : ""}` : ""}
    ${p.species || p.zone ? `<p class="muted">${p.nick ? `${esc(p.name)} · ` : ""}${p.species ? `<em>${esc(p.species)}</em>` : ""}${p.species && p.zone ? " · " : ""}${esc(p.zone ?? "")}</p>` : ""}
    <div class="traits">${plantPills(p).map(([icon, label]) => `<span class="trait">${ICONS[icon]}${esc(label)}</span>`).join("")}</div>
    ${p.seasons ? `<section class="card"><div class="sec">Riego y abono por estación</div><div class="season-read"><span></span><span class="st-h">Regar cada</span><span class="st-h">Abonar cada</span>${seasonReadCells(p.seasons, season)}</div>
      ${p.tips?.[season] ? `<div class="n-tip">${ICONS[SEASON_ICON[season]]}<span>${esc(p.tips[season])}</span></div>` : ""}</section>` : ""}
    ${aboutCard(p)}`, "shared");
}
// Opens a link that came with #ver= (a garden) or #planta= (an explored plant).
async function openShared(id) {
  openSheet(`<div class="sheet-head"><h2>Compartido contigo</h2><button class="btn small secondary" data-action="close">Cerrar</button></div><div class="ai-step"><span class="spinner" aria-hidden="true"></span>Abriendo…</div>`);
  let doc = null;
  try { const res = await fetch(`${API}/share/${id}`, { signal: AbortSignal.timeout(20000) }); if (res.ok) doc = await res.json(); } catch {}
  if (!doc) return openSheet(`<div class="sheet-head"><h2>Compartido contigo</h2><button class="btn small secondary" data-action="close">Cerrar</button></div><p class="ai-status warn">Este enlace ha caducado o no existe. Pídele a quien te lo envió que cree otro.</p>`);
  if (doc.kind === "garden") {
    viewing = { plants: doc.data.plants.map(scrubPlant), zoneSun: doc.data.zoneSun ?? {}, at: doc.at, expires: doc.expires };
    return viewGardenSheet();
  }
  const { care, calendar, refPhoto: ph, photo, place } = doc.data;
  explore = {
    state: "done", name: care.commonName || care.species, query: null, photo, care, calendar: calendar ?? null, refPhoto: ph ?? null,
    shared: { place, at: doc.at },
    report: fitReport(care, state.data.plants, zoneSun(), seasonOf(localToday(), here().lat), here().name),
  };
  exploreSheet();
}

// Example plant sheets from the landing («Plantas populares» → «Verla en la app»): app/demo/<planta>.json (made by tools/make-demos.mjs from the
// real AI answer for Madrid). Opens the same view as a shared plant, so visitors see what a sheet is like without spending any AI.
async function openDemo(slug) {
  openSheet(`<div class="sheet-head"><h2>Ejemplo de ficha</h2><button class="btn small secondary" data-action="close">Cerrar</button></div><div class="ai-step"><span class="spinner" aria-hidden="true"></span>Abriendo la ficha…</div>`);
  let doc = null;
  try { const res = await fetch(`demo/${slug}.json`, { signal: AbortSignal.timeout(15000) }); if (res.ok) doc = await res.json(); } catch {}
  if (!doc?.care) return openSheet(`<div class="sheet-head"><h2>Ejemplo de ficha</h2><button class="btn small secondary" data-action="close">Cerrar</button></div><p class="ai-status warn">No se ha podido abrir este ejemplo. Prueba a buscar la planta en «Explorar».</p>`);
  const { care, calendar, refPhoto: ph, place } = doc;
  explore = {
    state: "done", name: care.commonName || care.species, query: null, photo: null, care, calendar: calendar ?? null, refPhoto: ph ?? null,
    shared: { place, at: doc.made, demo: true },
    report: fitReport(care, state.data.plants, zoneSun(), seasonOf(localToday(), here().lat), here().name),
  };
  exploreSheet();
}

function moreView() {
  const loc = state.loc ?? DEFAULT_LOC;
  const aiOn = !aiOff() && (aiOpen === true || (aiCode() && codeStatus?.kind !== "warn"));
  const pending = pendingUpgrades().length;
  const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const row = (action, icon, color, label, value = "", chevron = true, disabled = false) =>
    `<button type="button" class="l-row" data-action="${action}" ${disabled ? "disabled" : ""}><span class="l-ico" style="background:${color}">${ICONS[icon]}</span><span class="l-label">${label}</span><span class="l-value">${value}${chevron ? `<span class="chev">${ICONS.chevron}</span>` : ""}</span></button>`;
  return `
    <div class="group-title">General</div>
    <section class="card list-card settings">
      ${row("open-place", "pin", "#3b82f6", "Ubicación", esc(loc.name))}
      ${row("open-sync", "sync", "#0a84ff", "Sincronizar", syncKey() ? `<span class="ok">${ICONS.circleCheck}Activada</span>` : "Desactivada")}
      ${row("open-share", "share", "#0a84ff", "Compartir mi jardín", "Solo ver")}
      ${row("delete-server", "x", "#c93b30", "Borrar mis datos del servidor", "", true)}
      ${row("open-ai", "sparkle", "#7a56d6", "Asistente IA", aiOff() ? "Apagada" : aiOn ? `<span class="ok">${ICONS.circleCheck}Activado</span>` : "Sin activar")}
      ${pending || upgrade ? row("open-upgrades", "refresh", "#c7771a", "Fichas por actualizar", pending ? `<span class="dot"></span>${pending}` : "Al día") : ""}
    </section>
    <div class="group-title">Florvia Premium</div>
    <section class="card list-card settings">${row("open-premium", "sparkle", "#7a56d6", "Plan", esc(planLabel()))}</section>
    ${zoneDetailsCard()}
    <div class="group-title">Avisos y calendario</div>
    <section class="card list-card settings">
      ${row("open-push", "bell", "#c93b30", "Aviso diario", store.get("mj_push", false) ? `<span class="ok">${ICONS.circleCheck}8:00</span>` : "Desactivado")}
      ${row("export-ics", "calendar", "#2f8f4e", "Exportar al calendario", "", true, !state.data.plants.length)}
    </section>
    <p class="group-foot">${isStandalone ? "" : "Para recibir avisos en el iPhone, instala la app: Compartir → «Añadir a pantalla de inicio». "}Los riegos y abonados se añaden a tu calendario como eventos que se repiten por estación; si cambias algo, vuelve a exportarlo.</p>
    <div class="group-title">Ayuda</div>
    <section class="card list-card settings">${row("open-feedback", "notes", "#3b82f6", "Enviar un comentario")}</section>
    ${aiCode() ? `<div class="group-title">Solo para ti</div>
    <section class="card list-card settings">${row("open-usage", "chart", "#2f8f4e", "Uso de la app", feedbackNew ? `<span class="dot"></span>${feedbackNew} ${feedbackNew === 1 ? "comentario nuevo" : "comentarios nuevos"}` : "")}</section>
    <p class="group-foot">Solo aparece en el móvil con tu código de acceso.</p>` : ""}
    <div class="group-title">Datos</div>
    <section class="card list-card settings">
      ${row("export-json", "download", "#6e6e73", "Exportar copia")}
      ${row("import-json", "upload", "#6e6e73", "Importar copia")}
    </section>
    <p class="group-foot">Tus plantas se guardan solo en este móvil. Exporta una copia de vez en cuando.${usageCode ? ` Código de uso: <b>${usageCode}</b>.` : ""}</p>
    ${versionRow(row)}
    <input type="file" id="importFile" accept="application/json" hidden />`;
}

// Sheets opened from Ajustes. They redraw on render() while open (saving the code, upgrade progress).
function aiSheet() {
  openSheet(`
    <div class="sheet-head"><h2>Asistente IA</h2><button class="btn small secondary" data-action="close">Cerrar</button></div>
    <p class="muted">Al añadir una planta, la IA propone sola sus cuidados por estación para tu zona; también puedes pedírselo desde Editar.${aiOpen ? " Ahora mismo está abierta: no hace falta código." : " Necesita tu código de acceso."}</p>
    <button type="button" class="l-row switch-row" role="switch" aria-checked="${!aiOff()}" data-action="ai-toggle"><span class="l-label">Usar la IA en este móvil</span><span class="switch" aria-hidden="true"></span></button>
    ${aiOpen ? `<p class="muted">Código de acceso: solo si administras la app (activa las métricas «Solo para ti»).</p>` : ""}
    <form id="aiCodeForm" class="row">
      <input type="text" name="code" class="code-input" placeholder="Código de acceso" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(store.get("mj_ai_code", ""))}" />
      <button class="btn small" type="submit">Guardar</button>
    </form>
    ${codeStatus ? `<p class="ai-status ${codeStatus.kind}">${esc(codeStatus.text)}</p>` : ""}`, "ai");
}
function upgradesSheet() {
  openSheet(`
    <div class="sheet-head"><h2>Fichas por actualizar</h2><button class="btn small secondary" data-action="close">Cerrar</button></div>
    ${upgradesCard() || `<p class="muted">Todas tus fichas están al día.</p>`}`, "upgrades");
}
// ---------- Premium: plan, limits and the «Quiero Premium» screen ----------
// The plan lives on the server (/me, from the garden key). Plants are limited here because they live on the phone; the
// AI limits are applied by the Worker (402 "paywall"). Until the start date nothing is limited and nobody pays.
const PRICES = { monthly: "1 € al mes", yearly: "9,99 € al año", lifetime: "20 € de por vida" };
let me = null; // { plan, premium, enforced, start, limits, used, lifetimeLeft } from /me
let premiumUi = { reason: "", sent: "", email: "", error: "" };
async function loadMe() {
  try {
    const res = await fetch(`${API}/me`, { headers: aiHeaders() });
    if (!res.ok) return;
    me = await res.json();
    render();
    if (sheet.open && sheet.dataset.view === "premium") premiumSheet(premiumUi.reason, true);
  } catch {}
}
const plantLimitHit = () => Boolean(me && me.enforced && !me.premium && me.limits?.plants && state.data.plants.length >= me.limits.plants);
const accessDaysLeft = () => (me?.accessUntil ? Math.max(0, Math.ceil((me.accessUntil - Date.now()) / 86400000)) : 0);
const trialDaysLeft = () => (me?.plan === "trial" && me.trialEnds ? Math.max(0, daysBetween(localToday(), me.trialEnds)) : 0);
const planLabel = () => (!me ? "" : me.source === "invite" ? `Premium · amigos y familia${me.accessUntil ? ` · ${accessDaysLeft()} d` : ""}` : me.plan === "lifetime" ? "Premium · de por vida" : me.plan === "trial" ? `Prueba gratuita · ${trialDaysLeft()} ${trialDaysLeft() === 1 ? "día" : "días"}` : me.premium ? "Premium" : me.enforced ? "Gratis" : "Próximamente");
function premiumSheet(reason = "", keep = false) {
  const head = `<div class="sheet-head"><h2>Florvia Premium</h2><button class="btn small secondary" data-action="close">Cerrar</button></div>`;
  if (!keep) { premiumUi = { reason, sent: "", email: premiumUi.email, error: "", thanks: false }; track("paywall_view"); }
  if (!me) { loadMe(); return openSheet(`${head}<div class="ai-step"><span class="spinner" aria-hidden="true"></span>Cargando…</div>`, "premium"); }
  const L = me.limits;
  const used = me.used ?? {};
  const row = (t, v) => `<div class="u-row"><span>${t}</span><b>${v}</b></div>`;
  const REASON = {
    plants: `Con el plan gratuito puedes tener ${me.limits?.plants ?? 8} plantas.`,
    suggest: `Has usado tus ${me.limits?.suggest ?? 5} búsquedas de «Qué planto aquí» de este mes.`,
    identify: `Has usado tus ${me.limits?.identify ?? 5} identificaciones por foto de este mes.`,
    diagnose: `Has usado tus ${me.limits?.diagnose ?? 5} diagnósticos de este mes.`,
  };
  if (me.premium && me.plan !== "trial") {
    return openSheet(`${head}
      <section class="card"><b>Tienes Premium${me.plan === "lifetime" ? " · de por vida" : me.source === "invite" ? " · amigos y familia" : ""}</b>
        <p class="muted">${me.source === "invite" ? `Gracias por probar Florvia: tienes todo incluido, sin pagar${me.accessUntil ? `, hasta el ${fmtDate(new Date(me.accessUntil).toISOString().slice(0, 10))} (${accessDaysLeft()} días)` : ""}.` : "Gracias por apoyar Florvia."}</p>${me.source === "invite" ? `<button type="button" class="link-btn" data-action="invite-leave">Dejar de usar este código</button>` : ""}</section>
      <section class="card"><div class="sec">Este mes</div>${row("Qué planto aquí", `${used.suggest ?? 0} de ${L.suggest}`)}${row("Identificar por foto", `${used.identify ?? 0} de ${L.identify}`)}${row("¿Qué le pasa?", `${used.diagnose ?? 0} de ${L.diagnose}`)}${L.plants ? "" : row("Plantas", "ilimitadas")}</section>
      <p class="muted small">Las consultas guardadas en memoria no cuentan. El contador se reinicia el día 1.</p>
      ${me.paid ? `<section class="card"><div class="sec">Tu suscripción</div><p class="muted small">${me.paid.plan === "lifetime" ? "Pago único «de por vida»." : me.paid.until ? `Cancelada: sigue activa hasta el ${fmtDate(new Date(me.paid.until).toISOString().slice(0, 10))}.` : "Activa."}</p>
        <button type="button" class="btn block secondary" data-action="premium-portal">Ver recibos${me.paid.plan === "lifetime" ? "" : " o cancelar"}</button>${premiumUi.error ? `<p class="ai-status warn">${esc(premiumUi.error)}</p>` : ""}</section>` : ""}
      ${me.payments && String(me.source).startsWith("internal") ? `<section class="card"><div class="sec">Probar el pago${me.sandbox ? " (modo de prueba)" : ""}</div>
        <p class="muted small">Solo lo ves en tus dispositivos. Tarjeta de prueba de Polar: 4242 4242 4242 4242, cualquier fecha futura y cualquier CVC.</p>
        <button type="button" class="btn block secondary" data-action="premium-buy" data-c="monthly">Mensual · ${PRICES.monthly}</button>
        <button type="button" class="btn block secondary" style="margin-top:8px" data-action="premium-buy" data-c="yearly">Anual · ${PRICES.yearly}</button>
        <button type="button" class="btn block secondary" style="margin-top:8px" data-action="premium-buy" data-c="lifetime">De por vida · ${PRICES.lifetime}</button>
        ${premiumUi.error ? `<p class="ai-status warn">${esc(premiumUi.error)}</p>` : ""}</section>` : ""}`, "premium");
  }
  const sent = premiumUi.sent;
  const plan = (key, name, price, extra = "", best = false) => `<div class="pm-plan ${best ? "best" : ""}"><div><b>${name}</b><span>${price}</span>${extra ? `<small>${extra}</small>` : ""}</div>
    <button type="button" class="btn small ${best ? "" : "secondary"}" data-action="${me.payments ? "premium-buy" : "premium-intent"}" data-c="${key}" ${sent ? "disabled" : ""}>${me.payments ? "Elegir" : "Quiero esto"}</button></div>`;
  const F = me.freeLimits ?? L;
  const trial = me.plan === "trial";
  const trialOver = !me.premium && me.trialEnds && me.trialEnds < localToday();
  const mailto = `mailto:hello@florvia.app?subject=${encodeURIComponent("Código de uso gratuito de Florvia")}&body=${encodeURIComponent("Hola, me gustaría pedir un código de uso gratuito de Florvia.\n\nMe llamo: \nMotivo: \n")}`;
  openSheet(`${head}
    ${trial ? `<section class="card"><b>Tienes Premium gratis · ${trialDaysLeft()} ${trialDaysLeft() === 1 ? "día" : "días"}</b>
      <p class="muted small">Todo Florvia sin límites hasta el ${fmtDate(me.trialEnds)}. Después pasas al plan gratuito, salvo que elijas un plan.</p>
      ${row("Qué planto aquí este mes", `${me.used?.suggest ?? 0}`)}${row("Identificaciones este mes", `${me.used?.identify ?? 0}`)}${row("Diagnósticos este mes", `${me.used?.diagnose ?? 0}`)}</section>` : ""}
    ${trialOver ? `<section class="card"><b>Tu mes de Premium gratis terminó</b><p class="muted small">Ahora tienes el plan gratuito. Si quieres seguir con Premium, elige un plan o <a href="${mailto}">escríbenos a hello@florvia.app</a> y pídenos un código de uso gratuito.</p></section>` : ""}
    ${premiumUi.reason && me.enforced ? `<p class="ai-status warn">${esc(REASON[premiumUi.reason] ?? "")}</p>` : ""}
    ${premiumUi.thanks ? `<p class="ai-status ok">¡Gracias! Estamos activando tu plan: puede tardar unos segundos.</p>` : ""}
    <section class="card"><div class="sec">${trial ? "Después de la prueba" : me.enforced ? "Gratis" : "Cómo será"}</div>
      <p class="muted small">${me.enforced || trial ? "" : `A partir del ${fmtDate(me.start)} habrá un plan gratuito y un plan Premium. Todas las personas tienen un mes de Premium gratis al empezar.`}</p>
      ${row("Plantas", `${F.plants} (Premium: ilimitadas)`)}${row("Qué planto aquí", `${F.suggest} al mes (Premium: ${PLAN_PREMIUM.suggest})`)}${row("Identificar por foto", `${F.identify} al mes (Premium: ${PLAN_PREMIUM.identify})`)}${row("¿Qué le pasa?", `${F.diagnose} al mes (Premium: ${PLAN_PREMIUM.diagnose})`)}
      <p class="muted small">Siempre gratis: ficha de cada planta, Explorar, «¿Dónde está mejor?», compartir, sincronizar y el aviso diario.</p></section>
    <section class="card"><div class="sec">Premium</div>
      ${plan("yearly", "Anual", PRICES.yearly, "La mejor opción", true)}${plan("monthly", "Mensual", PRICES.monthly)}${plan("lifetime", "De por vida", PRICES.lifetime, me.lifetimeLeft ? `Solo para las primeras personas · quedan ${me.lifetimeLeft}` : "Agotado")}
      <label class="seg-label" for="pmEmail">Tu correo, para avisarte cuando abramos los pagos (opcional)</label>
      <input id="pmEmail" type="email" class="big-input" inputmode="email" autocomplete="off" maxlength="80" placeholder="nombre@correo.com" value="${esc(premiumUi.email)}" />
      ${sent ? `<p class="ai-status ok">¡Apuntado! Todavía no se puede pagar: te avisamos en cuanto esté abierto.</p>` : ""}
      ${premiumUi.error ? `<p class="ai-status warn">${esc(premiumUi.error)}</p>` : ""}
      <p class="muted small">${me.payments ? "" : "Los pagos aún no están abiertos. Al pulsar solo apuntamos tu interés."}</p></section>
    <p class="muted small">¿Probando Florvia o eres de amigos y familia? <a href="${mailto}">Escríbenos a hello@florvia.app</a> y pídenos un código de uso gratuito.</p>
    <button type="button" class="btn block secondary" data-action="invite-open">Ya tengo un código</button>`, "premium");
}
const PLAN_PREMIUM = { suggest: 30, identify: 30, diagnose: 30 };
// Friends and family: a code + an email gives Premium without paying (Worker /invite/redeem); the email is kept so Noza knows who uses it.
let inviteUi = { code: "", email: "", error: "", done: false, busy: false };
const INVITE_ERRORS = { email: "Escribe un correo válido.", code: "Ese código no es válido o ya no está activo.", used: "Ese código ya se ha usado todas las veces posibles.", limit: "Demasiados intentos hoy. Prueba mañana o escribe a hello@florvia.app." };
function inviteSheet() {
  const head = `<div class="sheet-head"><h2>Código de amigos y familia</h2><button class="btn small secondary" data-action="close">Cerrar</button></div>`;
  if (inviteUi.done) return openSheet(`${head}<p class="ai-status ok">¡Listo! Ya tienes Premium con todo incluido. Gracias por probar Florvia.</p><button type="button" class="btn block" data-action="close">Cerrar</button>`, "invite");
  openSheet(`${head}
    <p class="muted small">Si alguien te ha dado un código para probar Florvia, escríbelo aquí junto con tu correo. Tendrás Premium sin pagar.</p>
    <label class="seg-label" for="invCode">Código</label>
    <input id="invCode" class="big-input" maxlength="16" autocomplete="off" autocapitalize="characters" placeholder="ABCD2345" value="${esc(inviteUi.code)}" />
    <label class="seg-label" for="invEmail">Tu correo</label>
    <input id="invEmail" type="email" class="big-input" inputmode="email" autocomplete="email" maxlength="80" placeholder="nombre@correo.com" value="${esc(inviteUi.email)}" />
    <p class="muted small">Guardamos tu correo para saber quién usa este acceso. Solo lo vemos nosotros y lo borramos si lo pides en hello@florvia.app o desde Ajustes → «Borrar mis datos del servidor».</p>
    ${inviteUi.error ? `<p class="ai-status warn">${esc(inviteUi.error)}</p>` : ""}
    <button type="button" class="btn block" data-action="invite-go" ${inviteUi.busy ? "disabled" : ""}>${inviteUi.busy ? "Comprobando…" : "Activar Premium"}</button>`, "invite");
}
async function inviteGo() {
  inviteUi.code = $("invCode")?.value.trim() ?? inviteUi.code;
  inviteUi.email = $("invEmail")?.value.trim() ?? inviteUi.email;
  inviteUi.error = "";
  inviteUi.busy = true;
  inviteSheet();
  try {
    const res = await fetch(`${API}/invite/redeem`, { method: "POST", headers: aiHeaders(), body: JSON.stringify({ code: inviteUi.code, email: inviteUi.email }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error in INVITE_ERRORS ? body.error : "x");
    inviteUi.done = true;
    me = null;
    loadMe();
  } catch (err) { inviteUi.error = INVITE_ERRORS[err.message] ?? "No se ha podido comprobar el código. Prueba otra vez."; }
  inviteUi.busy = false;
  inviteSheet();
}
async function inviteLeave() {
  if (!confirm("¿Dejar de usar este código? Perderás el Premium que te da y borraremos tu correo del acceso. Podrás volver a usarlo si te lo permiten.")) return;
  try {
    const res = await fetch(`${API}/invite/leave`, { method: "POST", headers: aiHeaders(), body: "{}" });
    if (!res.ok) throw new Error("x");
    me = null;
    loadMe();
    premiumSheet("", false);
  } catch { alert("No se ha podido quitar el código. Prueba otra vez."); }
}
// «Amigos y familia» for Noza (Uso de la app): create codes, see who used them, take access away.
let usageInvites = null; // { codes, uses } from /invites
function invitesCard() {
  if (!usageInvites) return "";
  const { codes, uses } = usageInvites;
  const live = uses.filter((u) => !u.revoked).length;
  const day = (ms) => fmtDate(new Date(ms).toISOString().slice(0, 10), { day: "numeric", month: "short", year: "numeric" });
  const block = (c) => {
    const people = uses.filter((u) => u.code === c.code);
    const rows = people.length ? people.map((u) => `<div class="inv-use ${u.revoked ? "off" : ""}"><span><b>${esc(u.email)}</b><small>${u.revoked ? "Retirado" : `Activado el ${day(u.ts)}${c.access_days ? ` · hasta el ${day(u.ts + c.access_days * 86400000)}` : " · sin fecha de fin"}`}</small></span>${u.revoked ? "" : `<button type="button" class="link-btn" data-action="invite-revoke" data-code="${esc(c.code)}" data-email="${esc(u.email)}">Retirar</button>`}</div>`).join("")
      : `<div class="inv-use"><span><small>${c.active ? "Sin usar todavía" : "Apagado"}</small></span></div>`;
    return `<div class="inv ${c.active ? "" : "off"}"><div class="inv-head"><span><b>${esc(c.label || "Sin nombre")}</b><small><span class="code">${esc(c.code)}</span> · ${c.uses} de ${c.max_uses} ${c.max_uses === 1 ? "uso" : "usos"} · ${c.access_days ? `${c.access_days} días` : "sin fin"}</small></span><span class="inv-acts"><button type="button" class="link-btn" data-action="invite-edit" data-code="${esc(c.code)}">Editar</button>${c.active ? `<button type="button" class="link-btn" data-action="invite-revoke" data-code="${esc(c.code)}" data-email="">Apagar</button>` : ""}</span></div>${rows}</div>`;
  };
  return `<section class="card"><div class="sec">Amigos y familia <span class="meta">${live} ${live === 1 ? "persona" : "personas"}</span></div>
    ${codes.length ? codes.map(block).join("") : `<p class="muted small">Aún no hay códigos.</p>`}
    <div style="margin-top:10px"><button type="button" class="btn small secondary" data-action="invite-new">Crear código</button></div></section>`;
}
async function inviteAdmin(path, body) {
  const res = await fetch(`${API}${path}`, { method: "POST", headers: aiHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error("x");
  return res.json();
}
// Edit a code (Uso de la app → Amigos y familia → Editar).
let inviteEdit = null; // { code, label, maxUses, days, active, uses, error, busy }
function inviteEditSheet() {
  const e = inviteEdit;
  const head = `<div class="sheet-head"><h2>Editar código</h2><button class="btn small secondary" data-action="close">Cerrar</button></div>`;
  openSheet(`${head}
    <p class="muted small">Código <b style="font-family:ui-monospace,Menlo,monospace">${esc(e.code)}</b> · lo usan ${e.uses} ${e.uses === 1 ? "persona" : "personas"}.</p>
    <label class="seg-label" for="ieLabel">Nombre (para quién es)</label>
    <input id="ieLabel" class="big-input" maxlength="60" value="${esc(e.label)}" />
    <label class="seg-label" for="ieMax">Cuántas personas pueden usarlo</label>
    <input id="ieMax" class="big-input" type="number" inputmode="numeric" min="${Math.max(1, e.uses)}" max="500" value="${esc(e.maxUses)}" />
    <label class="seg-label" for="ieDays">Días de Premium (vacío = sin fecha de fin)</label>
    <input id="ieDays" class="big-input" type="number" inputmode="numeric" min="1" max="3650" placeholder="Sin fin" value="${esc(e.days)}" />
    <p class="muted small">Si cambias los días, se aplica también a quien ya lo usa, contando desde el día que lo activó.</p>
    <div class="seg" role="radiogroup" aria-label="Estado del código"><button type="button" role="radio" aria-checked="${e.active}" data-action="invite-edit-active" data-on="1">Activo</button><button type="button" role="radio" aria-checked="${!e.active}" data-action="invite-edit-active" data-on="0">Apagado</button></div>
    ${e.error ? `<p class="ai-status warn">${esc(e.error)}</p>` : ""}
    <button type="button" class="btn block" data-action="invite-edit-save" ${e.busy ? "disabled" : ""}>${e.busy ? "Guardando…" : "Guardar"}</button>`, "inviteEdit");
}
function inviteEditRead() {
  if (!inviteEdit) return;
  inviteEdit.label = $("ieLabel")?.value ?? inviteEdit.label;
  inviteEdit.maxUses = $("ieMax")?.value ?? inviteEdit.maxUses;
  inviteEdit.days = $("ieDays")?.value ?? inviteEdit.days;
}
async function inviteEditSave() {
  inviteEditRead();
  const e = inviteEdit;
  e.error = "";
  e.busy = true;
  inviteEditSheet();
  try {
    await inviteAdmin("/invites/update", { code: e.code, label: e.label.trim(), maxUses: Number(e.maxUses), accessDays: String(e.days).trim() === "" ? null : Number(e.days), active: e.active });
    usageInvites = await fetch(`${API}/invites`, { headers: aiHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    inviteEdit = null;
    usageSheet();
    return;
  } catch { e.error = `No se ha podido guardar. Los usos máximos no pueden ser menos de los que ya hay (${e.uses}).`; }
  e.busy = false;
  inviteEditSheet();
}
async function inviteNew() {
  const label = prompt("¿Para quién es? (por ejemplo, el nombre)", "");
  if (label === null) return;
  const max = Number(prompt("¿Cuántas personas pueden usarlo?", "1"));
  if (!Number.isFinite(max) || max < 1) return;
  const days = prompt("¿Cuántos días de Premium da? (vacío = hasta que lo retires)", "");
  if (days === null) return;
  try {
    const out = await inviteAdmin("/invites", { label, maxUses: max, accessDays: days.trim() || null });
    prompt("Código creado. Cópialo y pásaselo:", out.code);
  } catch { alert("No se ha podido crear el código."); }
  usageInvites = await fetch(`${API}/invites`, { headers: aiHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (sheet.open && sheet.dataset.view === "usage") usageSheet();
}
async function inviteRevoke(code, email) {
  if (!confirm(email ? `¿Retirar el acceso de ${email}?` : `¿Apagar el código ${code} y retirar el acceso a todos los que lo usaron?`)) return;
  try { await inviteAdmin("/invites/revoke", { code, email }); } catch { alert("No se ha podido retirar."); }
  usageInvites = await fetch(`${API}/invites`, { headers: aiHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (sheet.open && sheet.dataset.view === "usage") usageSheet();
}
// Polar checkout / customer portal: the Worker makes the session, the person pays on Polar's page and comes back to ?premium=ok.
const PAY_ERRORS = { sync: "Para pagar, activa antes la sincronización (Ajustes → Sincronizar): tu plan te sigue así a todos tus móviles.", soldout: "Las plazas «de por vida» se han agotado. Elige otro plan.", closed: "Los pagos aún no están abiertos.", none: "No hay ninguna suscripción que gestionar." };
async function polarGo(path, body) {
  premiumUi.error = "";
  try {
    const res = await fetch(`${API}${path}`, { method: "POST", headers: aiHeaders(), body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.url) throw new Error(out.error in PAY_ERRORS ? out.error : "x");
    location.href = out.url;
    return;
  } catch (err) { premiumUi.error = PAY_ERRORS[err.message] ?? "No se ha podido abrir el pago. Prueba otra vez."; }
  premiumSheet(premiumUi.reason, true);
}
const premiumBuy = (choice) => { if ($("pmEmail")) premiumUi.email = $("pmEmail").value.trim(); return polarGo("/polar/checkout", { choice, email: premiumUi.email }); };
const premiumPortal = () => polarGo("/polar/portal", {});
async function premiumIntent(choice) {
  if ($("pmEmail")) premiumUi.email = $("pmEmail").value.trim();
  premiumUi.error = "";
  try {
    const res = await fetch(`${API}/premium/intent`, { method: "POST", headers: aiHeaders(), body: JSON.stringify({ choice, contact: premiumUi.email }) });
    if (!res.ok) throw new Error("x");
    premiumUi.sent = choice;
    track("premium_intent");
  } catch { premiumUi.error = "No se ha podido apuntar. Prueba otra vez."; }
  premiumSheet(premiumUi.reason, true);
}

// ---------- Comments («Enviar un comentario») and technical errors ----------
const APP_VERSION = new URL(import.meta.url).searchParams.get("v") ?? "";
// Version shown in Ajustes: the ?v=AAAAMMDDx stamp of the app files (README, «Publicar una versión»). «Buscar actualización» compares
// the newest stamp loaded on this page with the one in the index.html the server has right now.
const versionsIn = (text) => [...String(text).matchAll(/[?&]v=(\d{8}[a-z]?)/g)].map((m) => m[1]);
const newestVersion = (list) => [...list].sort().pop() ?? "";
const RUNNING_VERSION = newestVersion([APP_VERSION, ...[...document.querySelectorAll("link[href], script[src]")].flatMap((el) => versionsIn(el.getAttribute("href") ?? el.getAttribute("src") ?? ""))]);
const versionLabel = (v) => (/^\d{8}/.test(v) ? `${fmtDate(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, { day: "numeric", month: "short", year: "numeric" })}${v[8] ? ` · ${v[8]}` : ""}` : "");
let updateCheck = { state: "idle", latest: "" }; // state: idle | checking | ok | new | error
async function checkUpdate() {
  updateCheck = { state: "checking", latest: "" };
  render();
  try {
    const res = await fetch(`index.html?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("http");
    const latest = newestVersion(versionsIn(await res.text()));
    if (!latest) throw new Error("no version");
    updateCheck = { state: latest > RUNNING_VERSION ? "new" : "ok", latest };
  } catch { updateCheck = { state: "error", latest: "" }; }
  render();
}
function versionRow(row) {
  const u = updateCheck.state;
  const value = u === "checking" ? "Buscando…" : u === "ok" ? `<span class="ok">${ICONS.circleCheck}Al día</span>` : u === "new" ? `<span class="dot"></span>Actualizar` : u === "error" ? "No se pudo comprobar" : versionLabel(RUNNING_VERSION) || "Sin versión";
  const foot = u === "ok" ? `Tienes la última versión publicada (${esc(versionLabel(RUNNING_VERSION))}).`
    : u === "new" ? `Hay una versión más nueva (${esc(versionLabel(updateCheck.latest))}). Pulsa la fila para cargarla: tus plantas no se tocan.`
    : u === "error" ? "No hay conexión o el servidor no responde. Prueba más tarde."
    : "Es la fecha de la última actualización de la app que tienes cargada. Toca para comprobar si hay una más nueva: la app se actualiza sola al abrirla, y esto sirve sobre todo si la tienes abierta desde hace días.";
  return `<div class="group-title">Versión</div>
    <section class="card list-card settings">${row("check-update", "refresh", "#6e6e73", "Versión de la app", value, true, u === "checking")}</section>
    <p class="group-foot">${foot}</p>`;
}
let fb = null; // { type, text, contact, tech, state: "idle" | "sending" | "sent" | "error", error }
const FB_TYPES = [["idea", "Una idea"], ["bug", "Algo no funciona"], ["other", "Otra cosa"]];
function fbRead() {
  if (!fb) return;
  if ($("fbText")) fb.text = $("fbText").value;
  if ($("fbContact")) fb.contact = $("fbContact").value;
  if ($("fbTech")) fb.tech = $("fbTech").checked;
}
function feedbackSheet() {
  const head = `<div class="sheet-head"><h2>Enviar un comentario</h2><button class="btn small secondary" data-action="close">Cerrar</button></div>`;
  if (!fb) fb = { type: "idea", text: "", contact: "", tech: true, state: "idle" };
  if (fb.state === "sent") return openSheet(`${head}<section class="card"><b>¡Gracias!</b><p class="muted">Lo leo yo. Si dejaste un contacto, te escribiré si hace falta.</p></section><button class="btn block" data-action="close">Cerrar</button>`, "feedback");
  openSheet(`${head}
    <p class="muted small">Una idea, algo que no funcione o lo que quieras contarme. Lo lee una persona.</p>
    <div class="seg" role="radiogroup" aria-label="Tipo de comentario">${FB_TYPES.map(([v, t]) => `<button type="button" role="radio" aria-checked="${fb.type === v}" data-action="fb-type" data-t="${v}">${t}</button>`).join("")}</div>
    <textarea id="fbText" maxlength="1000" rows="6" class="big-input" placeholder="Cuéntame…">${esc(fb.text)}</textarea>
    <input id="fbContact" maxlength="80" class="big-input" placeholder="Tu correo (opcional)" autocomplete="off" inputmode="email" value="${esc(fb.contact)}" />
    <label class="check-row"><input type="checkbox" id="fbTech" ${fb.tech ? "checked" : ""} /> <span>Incluir información técnica (versión de la app, tipo de pantalla e idioma) para poder reproducir el problema.</span></label>
    <p class="muted small">No se adjuntan tus plantas, notas ni ubicación. No escribas datos personales que no quieras que lea.</p>
    ${fb.state === "error" ? `<p class="ai-status warn">${esc(fb.error)}</p>` : ""}
    <button type="button" class="btn block" data-action="fb-send" ${fb.state === "sending" ? "disabled" : ""}>${fb.state === "sending" ? "Enviando…" : "Enviar"}</button>`, "feedback");
}
async function feedbackSend() {
  fbRead();
  if (fb.text.trim().length < 4) { fb.state = "error"; fb.error = "Escribe algo más para poder enviarlo."; return feedbackSheet(); }
  fb.state = "sending";
  feedbackSheet();
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const tech = fb.tech ? { version: APP_VERSION, mode: standalone ? "instalada" : "navegador", lang: navigator.language, ua: navigator.userAgent.slice(0, 110), screen: `${innerWidth}x${innerHeight}` } : null;
  try {
    const res = await fetch(`${API}/feedback`, { method: "POST", headers: aiHeaders(), body: JSON.stringify({ type: fb.type, text: fb.text.trim(), contact: fb.contact.trim(), tech }) });
    if (res.status === 429) throw new Error("limit");
    if (!res.ok) throw new Error("ai");
    fb = { type: "idea", text: "", contact: "", tech: true, state: "sent" };
  } catch (err) {
    fb.state = "error";
    fb.error = err.message === "limit" ? "Has enviado varios hoy. Prueba mañana." : "No se ha podido enviar. Prueba otra vez.";
  }
  feedbackSheet();
}
// Errors the browser reports (message and file:line, a few per session): the Worker groups them for the admin.
let errorsSent = 0;
function reportError(msg, at) {
  if (errorsSent >= 3 || !msg) return;
  errorsSent += 1;
  try { fetch(`${API}/error`, { method: "POST", keepalive: true, headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ device: deviceId, garden: usageId?.startsWith("g:") ? usageId : "", version: APP_VERSION, msg: String(msg).slice(0, 160), at: String(at ?? "").slice(0, 120) }) }).catch(() => {}); } catch {}
}
window.addEventListener("error", (e) => {
  // «Script error.» with no file or line comes from a script of another origin (Google sign-in, a browser extension…): the browser hides
  // the details, so there is nothing to act on and it only adds noise to «Errores de la app».
  if (!e.filename && !e.lineno && /^script error\.?$/i.test(String(e.message ?? "").trim())) return;
  reportError(e.message, `${String(e.filename ?? "").split("/").pop().split("?")[0]}:${e.lineno}`);
});
window.addEventListener("unhandledrejection", (e) => reportError(e.reason?.message ?? e.reason, "promesa"));
// For the admin: new comments (badge in Ajustes), and the list inside «Uso de la app».
let adminPushMsg = "";
let feedbackNew = 0;
let feedbackData = null;
async function loadFeedback(render_ = true) {
  if (!aiCode()) return;
  try {
    const res = await fetch(`${API}/feedback`, { headers: aiHeaders() });
    if (!res.ok) return;
    feedbackData = await res.json();
    feedbackNew = feedbackData.newCount;
    if (render_) render();
    if (sheet.open && sheet.dataset.view === "usage") usageSheet();
  } catch {}
}
const FB_LABEL = { idea: "Idea", bug: "Algo no funciona", other: "Otro", question: "Duda (web)" };
function feedbackAdminCards() {
  const d = feedbackData;
  if (!d) return "";
  const items = d.items.map((f) => `<div class="fb-item ${f.status}">
      <div class="fb-top"><span class="fb-type ${f.type}">${FB_LABEL[f.type] ?? f.type}</span><small>${esc(f.label || `${f.person.length === 16 ? "Jardín" : "Móvil"} ${f.code}`)}${f.mine ? " · tuyo" : ""} · ${fmtDate(new Date(f.ts).toISOString().slice(0, 10))}${f.src !== "prod" ? ` · ${esc(f.src)}` : ""}</small></div>
      <p>${esc(f.text).replace(/\n/g, "<br>")}</p>
      ${f.contact ? `<small>Contacto: ${esc(f.contact)}</small>` : ""}
      ${f.tech ? `<small>${esc([f.tech.version, f.tech.mode, f.tech.lang, f.tech.screen].filter(Boolean).join(" · "))}</small>` : ""}
      <div class="fb-acts">${f.status === "new" ? `<button type="button" class="btn small secondary" data-action="fb-status" data-id="${f.id}" data-s="read">Leído</button>` : ""}${f.status !== "done" ? `<button type="button" class="btn small secondary" data-action="fb-status" data-id="${f.id}" data-s="done">Hecho</button>` : `<button type="button" class="btn small secondary" data-action="fb-status" data-id="${f.id}" data-s="new">Reabrir</button>`}</div></div>`).join("");
  const errs = d.errors.map((e) => `<div class="u-row"><span class="u-garden">${esc(e.msg)}<small>${esc(e.at)} · ${esc(e.versions.join(", ") || "—")}</small></span><b>${e.count}<small>${e.people} ${e.people === 1 ? "persona" : "personas"}</small></b></div>`).join("");
  return `<section class="card"><div class="sec">Comentarios <span class="meta">${d.newCount ? `${d.newCount} nuevos` : "al día"}</span></div>${items || `<p class="muted small">Todavía no hay comentarios.</p>`}</section>
    <section class="card"><div class="sec">Errores de la app <span class="meta">14 días</span></div>${errs || `<p class="muted small">Ninguno registrado.</p>`}</section>`;
}

const KIND_LABEL = { care: "Ficha (alta)", care_explore: "Explorar", care_edit: "Editar con IA", care_upgrade: "Actualizar fichas", calendar: "Calendario del año", place: "¿Dónde está mejor?", suggest: "Qué planto aquí", identify: "Identificar por foto", diagnose: "¿Qué le pasa?" };
// Real tokens per kind of AI call (from the provider's own count), to know what costs what.
// «Qué se pide»: the plants, symptoms and preferences people asked for in the last 30 days (anonymous counts from /stats2).
let topicsMine = false;
const TOPIC_LABEL = { care: "Fichas pedidas al añadir", explore: "Explorar", identify: "Identificadas por foto", added: "Añadidas al jardín", diagnose: "Diagnósticos: planta", symptom: "Diagnósticos: síntomas", place: "«¿Dónde está mejor?»", suggest_pref: "«Qué planto aquí»: preferencias", suggest_pick: "«Qué planto aquí»: sugeridas" };
function topicName(kind, key) {
  if (kind === "symptom") return DIAG_SYMPTOMS.find(([k]) => k === key)?.[1] ?? key;
  if (kind === "suggest_pref") return SG_PREFS.find(([k]) => k === key)?.[1] ?? key;
  return key.replace(/^./, (c) => c.toUpperCase());
}
let topicsAll = false; // «Qué se pide»: the last 30 days (top 10 per kind) or everything since it is measured (full lists)
function topicsCsv() {
  const t = usage?.topics?.all;
  const rows = [["tipo", "nombre", "veces", "origen"]];
  for (const [origin, set] of [["real", t?.real], ["mis_dispositivos", t?.mine]]) for (const [kind, list] of Object.entries(set ?? {})) for (const [key, n] of list) rows.push([TOPIC_LABEL[kind] ?? kind, topicName(kind, key), n, origin]);
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}
function topicsCard() {
  const t = usage?.topics;
  if (!t) return "";
  const src = topicsAll ? t.all : t;
  const set = topicsMine ? src.mine : src.real;
  const kinds = Object.keys(TOPIC_LABEL).filter((k) => set[k]?.length);
  const toggle = `<button type="button" class="btn small secondary" data-action="topics-mine" aria-pressed="${topicsMine}">${topicsMine ? "Ver el uso real" : "Ver mis pruebas"}</button>`;
  const range = `<div class="seg" role="radiogroup" aria-label="Periodo" style="margin:6px 0 10px">${[[false, "30 días"], [true, "Desde el principio"]].map(([v, l]) => `<button type="button" role="radio" aria-checked="${topicsAll === v}" data-action="topics-range" data-all="${v}">${l}</button>`).join("")}</div>`;
  const meta = `${topicsAll ? `desde ${t.since ? fmtDate(t.since, { day: "numeric", month: "short", year: "numeric" }) : "el principio"}` : "30 días"} · ${topicsMine ? "mis dispositivos" : "uso real"}`;
  return `<section class="card"><div class="sec">Qué se pide <span class="meta">${meta}</span></div>${range}
    ${kinds.length ? kinds.map((k) => `<details class="pf-plain"><summary>${TOPIC_LABEL[k]} <span class="meta">${set[k].length > 10 ? `${set[k].length} distintas · ` : ""}${set[k].reduce((a, [, n]) => a + n, 0)}</span></summary>${set[k].map(([key, n]) => `<div class="u-row"><span>${esc(topicName(k, key))}</span><b>${n}</b></div>`).join("")}</details>`).join("") : `<p class="muted small">${topicsMine ? "Todavía no hay datos de tus dispositivos." : "Todavía no hay datos de uso real. Se cuenta desde que se activó esta tarjeta."}</p>`}
    <div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">${toggle}<button type="button" class="btn small secondary" data-action="topics-csv">Descargar todo (CSV)</button></div></section>`;
}
// «Retención»: of the real people whose first day is old enough, how many came back (next day, within the week, later in the month).
function retentionCard() {
  const r = usage?.retention;
  if (!r || !r.overall.people) return "";
  const pct = (m) => (m.n ? `${Math.round((m.back / m.n) * 100)} %` : "—");
  const frac = (m) => (m.n ? `${m.back} de ${m.n}` : "aún pronto");
  const o = r.overall;
  const rows = [["Al día siguiente (D1)", o.d1], ["Esa primera semana (días 1–7)", o.w1], ["Más adelante (días 8–30)", o.m1]];
  return `<section class="card"><div class="sec">Retención <span class="meta">personas reales</span></div>
    ${rows.map(([label, m]) => `<div class="u-row"><span>${label}</span><b>${pct(m)}<small>${frac(m)}</small></b></div>`).join("")}
    <details class="pf-plain"><summary>Por semana de alta <span class="meta">${r.cohorts.length}</span></summary>
      ${r.cohorts.map((c) => `<div class="u-row"><span>Semana del ${fmtDate(c.week, { day: "numeric", month: "short" })}<small>${c.people} ${c.people === 1 ? "persona" : "personas"}</small></span><b>D1 ${pct(c.d1)} · sem. ${pct(c.w1)} · mes ${pct(c.m1)}</b></div>`).join("")}</details>
    <p class="muted small">Solo cuenta a quien ya ha tenido tiempo de volver. Con pocas personas los porcentajes bailan mucho: mira también «de cuántas».</p></section>`;
}
// «Análisis de la IA»: every answer the AI gave to someone (care sheet, photo identification, diagnosis, «¿Dónde está mejor?», «Qué planto aquí»),
// newest first, with who got it. Opens the same read-only view as the email link. Unrated ones are kept 60 days, rated ones 180.
let analyses = { list: [], more: false, loading: false, kind: "", bad: false, mine: false, loaded: false };
async function loadAnalyses(reset = true) {
  const a = analyses;
  if (a.loading) return;
  a.loading = true;
  if (reset) { a.list = []; a.more = false; }
  if (sheet.open && sheet.dataset.view === "usage") usageSheet();
  try {
    const q = new URLSearchParams({ limit: "30", ...(a.kind ? { kind: a.kind } : {}), ...(a.bad ? { bad: "1" } : {}), ...(a.mine ? { mine: "1" } : {}), ...(!reset && a.list.length ? { before: String(a.list[a.list.length - 1].ts) } : {}) });
    const res = await fetch(`${API}/cases?${q}`, { headers: aiHeaders() });
    if (res.ok) { const d = await res.json(); a.list = reset ? d.cases : [...a.list, ...d.cases]; a.more = d.more; }
  } catch { /* keep what is shown */ }
  a.loading = false;
  a.loaded = true;
  if (sheet.open && sheet.dataset.view === "usage") usageSheet();
}
function analysesCard() {
  const a = analyses;
  const chip = (label, on, action, data) => `<button type="button" class="chip ${on ? "on" : ""}" data-action="${action}" ${data} aria-pressed="${on}">${label}</button>`;
  const kinds = [["", "Todos"], ["care", "Fichas"], ["identify", "Fotos"], ["diagnose", "Diagnósticos"], ["place", "Dónde"], ["suggest", "Qué planto"], ["explore", "Explorar"]];
  const state = (c) => (c.rating === 1 ? "👍" : c.rating === 0 ? "👎" : "○");
  return `<section class="card"><div class="sec">Análisis de la IA <span class="meta">lo que respondió a cada persona</span></div>
    <div class="chips">${kinds.map(([k, l]) => chip(l, a.kind === k, "analyses-kind", `data-kind="${k}"`)).join("")}</div>
    <div class="chips" style="margin-top:6px">${chip("Solo 👎", a.bad, "analyses-bad", "")}${chip("Mis pruebas", a.mine, "analyses-mine", "")}</div>
    ${a.loaded || a.list.length ? "" : `<button type="button" class="btn small" style="margin-top:10px" data-action="analyses-load">Cargar los últimos análisis</button>`}
    ${a.list.map((c) => `<button type="button" class="u-person" data-action="case-open" data-id="${esc(c.id)}"><span class="u-garden">${state(c)} ${esc(CASE_KIND[c.kind] ?? c.kind)}${c.name ? ` · ${esc(c.name)}` : ""}${c.photo ? " 📷" : ""}</span><b><small>${esc(c.person)} · ${esc(new Date(c.ts).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</small></b></button>`).join("")}
    ${a.loading ? `<p class="muted small"><span class="spinner" aria-hidden="true"></span> Cargando…</p>` : a.loaded && !a.list.length ? `<p class="muted small">Todavía no hay análisis guardados con estos filtros. Se guardan desde que se activó esta función.</p>` : ""}
    ${a.more && !a.loading ? `<button type="button" class="btn small secondary" style="margin-top:8px" data-action="analyses-more">Ver más</button>` : ""}</section>`;
}
// «Calidad percibida»: satisfaction per AI function (real people) and the saved cases to review, 👎 first.
function qualityCard() {
  const q = usage?.quality;
  if (!q) return "";
  const pct = (u, d) => (u + d ? `${Math.round((u / (u + d)) * 100)} %` : "—");
  const kinds = Object.entries(q.byKind ?? {});
  const reasons = Object.entries(q.reasons ?? {}).sort((a, b) => b[1] - a[1]);
  const STATUS = { new: "sin revisar", revisado: "revisado", bueno: "bueno", malo: "malo", caso_de_prueba: "caso de prueba" };
  return `<section class="card"><div class="sec">Calidad percibida <span class="meta">«¿Te sirvió?»</span></div>
    ${kinds.length ? kinds.map(([k, v]) => `<div class="u-row"><span>${esc(CASE_KIND[k] ?? k)}</span><b>${pct(v.up7, v.down7)}<small>7 d: 👍 ${v.up7} · 👎 ${v.down7} · 30 d: ${pct(v.up30, v.down30)} (${v.up30 + v.down30})</small></b></div>`).join("") : `<p class="muted small">Todavía nadie ha valorado un resultado.</p>`}
    ${reasons.length ? `<p class="muted small">Motivos de los 👎: ${reasons.map(([k, n]) => `${esc(RATE_REASONS.find(([x]) => x === k)?.[1] ?? k)} (${n})`).join(", ")}</p>` : ""}
    ${q.cases?.length ? `<details class="pf-plain"${q.cases.some((c) => !c.rating && c.status === "new") ? " open" : ""}><summary>Casos para revisar <span class="meta">${q.cases.length}</span></summary>${q.cases.map((c) => `<button type="button" class="u-person" data-action="case-open" data-id="${esc(c.id)}"><span class="u-garden">${c.rating ? "👍" : "👎"} ${esc(CASE_KIND[c.kind] ?? c.kind)}${c.name ? ` · ${esc(c.name)}` : ""}</span><b><small>${esc(STATUS[c.status] ?? c.status)}${c.internal ? " · tuyo" : ""} · ${esc(fmtDate(new Date(c.ts).toISOString().slice(0, 10)))}</small></b></button>`).join("")}</details>` : ""}</section>`;
}
function tokensCard() {
  const k = usage?.aiKinds ?? {};
  const rows = Object.entries(k).sort((a, b) => b[1].tin + b[1].tout - (a[1].tin + a[1].tout));
  if (!rows.length) return `<section class="card"><div class="sec">Tokens de la IA <span class="meta">30 días</span></div><p class="muted small">Aún no hay consultas con tokens registrados.</p></section>`;
  const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)} k` : String(n));
  const totIn = rows.reduce((a, [, v]) => a + v.tin, 0), totOut = rows.reduce((a, [, v]) => a + v.tout, 0);
  return `<section class="card"><div class="sec">Tokens de la IA <span class="meta">30 días · ${fmt(totIn)} entrada · ${fmt(totOut)} salida</span></div>
    ${rows.map(([name, v]) => `<div class="u-row"><span>${esc(KIND_LABEL[name] ?? name)}</span><b>${v.n}<small>media ${fmt(Math.round(v.tin / v.n))} ent. · ${fmt(Math.round(v.tout / v.n))} sal.</small></b></div>`).join("")}</section>`;
}
let pageTitles = null; // app/pages.json (generated with the blog): ref or path → real page title; falls back to the slug
const REF_LABEL = (ref) => pageTitles?.[ref] ?? ref.replace(/^planta-/, "Planta: ").replace(/^guia-/, "Guía: ").replace(/-/g, " ");
// Where people came from (links from the blog): who opened the app and who added a plant.
function refsCard() {
  const refs = usage?.refs ?? [];
  if (!refs.length) return `<section class="card"><div class="sec">Procedencia (blog)</div><p class="muted small">Aún nadie ha entrado desde una página del blog.</p></section>`;
  return `<section class="card"><div class="sec">Procedencia (blog)</div>${refs.map((r) => `<div class="u-row"><span>${esc(REF_LABEL(r.ref))}</span><b>${r.people}<small>${r.planted} ${r.planted === 1 ? "añadió una planta" : "añadieron una planta"}</small></b></div>`).join("")}</section>`;
}
const WEB_SRC = { direct: "Directo (sin origen)", google: "Google", search: "Otros buscadores", social: "Redes sociales", ai: "Asistentes de IA", other: "Otras webs" };
const WEB_BOTS = [["search", "Buscadores (Googlebot, Bingbot…)"], ["ai", "Robots de IA (GPTBot, ClaudeBot…)"], ["preview", "Previsualizaciones de enlaces (WhatsApp…)"], ["bot", "Otros robots"]];
const WEB_PAGE = (path) => pageTitles?.[path] ?? (path === "/" ? "Inicio (landing)" : path === "/es/plantas/" ? "Fichas de plantas (índice)" : path === "/es/guias/" ? "Guías (índice)" : REF_LABEL(path.replace(/^\/es\/(plantas|guias)\/([^/]+)\/$/, (_, t, s) => `${t === "plantas" ? "planta" : "guia"}-${s}`)));
// Chart range shared by «Aperturas» and «Visitas a la web»: the last 30 days, or the last 24 hours (hour by hour, local time).
let chartRange = "30d";
const rangeToggle = () => `<div class="seg" role="radiogroup" aria-label="Periodo del gráfico" style="margin:6px 0 10px">${[["30d", "30 días"], ["24h", "24 horas"]].map(([v, t]) =>
  `<button type="button" role="radio" aria-checked="${chartRange === v}" data-action="chart-range" data-range="${v}">${t}</button>`).join("")}</div>`;
// One bar per hour: `value(h)` is the height, `label(h)` the tooltip («hoy 14:00 · 3 aperturas»).
function hourChart(hours, value, label, ariaLabel) {
  const max = Math.max(4, ...hours.map(value));
  const bars = hours.map((h) => {
    const d = new Date(h.t);
    const when = `${d.toDateString() === new Date().toDateString() ? "hoy" : "ayer"} ${d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`;
    const text = `${when} · ${label(h)}`;
    return `<span class="u-bar ${value(h) ? "" : "zero"}" style="height:${Math.max(3, (value(h) / max) * 100)}%" tabindex="0" title="${esc(text)}" aria-label="${esc(text)}"></span>`;
  }).join("");
  return `<div class="u-chart" role="img" aria-label="${esc(ariaLabel)}">${bars}</div><div class="u-axis"><span>hace 24 h</span><span>ahora</span></div><div class="u-tip" aria-live="polite"></div>`;
}
// Which emails Noza gets when someone adds a plant, identifies one from a photo or runs a diagnosis (Worker: meta «notify»).
const NOTIFY_LABEL = { plant: ["Cuando alguien añade una planta", "El nombre y si se añadió con IA o a mano"], identify: ["Cuando alguien identifica una planta con una foto", "La especie más probable; nunca la foto"], diagnose: ["Cuando alguien hace un diagnóstico", "La planta y los síntomas marcados"], rating_up: ["Cada 👍 de «¿Te sirvió?»", "Con el enlace al caso tal como lo vio"], rating_down: ["Cada 👎 de «¿Te sirvió?»", "Motivos, nota y enlace al caso; también un aviso en el móvil"] };
const NOTIFY_ICON = { plant: "sprout", identify: "camera", diagnose: "alert", rating_up: "check", rating_down: "alert" };
function notifyCard() {
  const n = usage?.notify;
  if (!n) return "";
  return `<section class="card"><div class="sec">Avisos por correo de actividad</div>
    <p class="muted small">Un correo por cada vez, solo del uso real (no de tus dispositivos). Con un tope de 40 al día.</p>
    ${Object.entries(NOTIFY_LABEL).map(([k, [t, sub]]) => `<button type="button" class="switch-row" role="switch" aria-checked="${n[k]}" data-action="notify-toggle" data-kind="${k}"><span>${ICONS[NOTIFY_ICON[k]]}<span>${t}<small class="sub">${sub}</small></span></span><span class="switch" aria-hidden="true"></span></button>`).join("")}</section>`;
}
function webCard() {
  const w = usageWeb;
  if (!w) return "";
  if (w.error) return `<section class="card"><div class="sec">Visitas a la web</div><p class="muted small">${w.error === "missing" ? "Todavía no hay datos: falta publicar el Worker con las tablas de visitas." : w.error === "code" ? "El código guardado no es válido para ver las visitas." : "No se han podido cargar las visitas."}</p></section>`;
  const last = (n, key = "person") => w.days.slice(-n).reduce((a, d) => a + d[key], 0);
  const max = Math.max(4, ...w.days.map((d) => d.person));
  const bars = w.days.map((d) => {
    const label = `${fmtDate(d.date, { weekday: "short", day: "numeric", month: "short" })} · ${d.person} ${d.person === 1 ? "visita" : "visitas"} de personas`;
    return `<span class="u-bar ${d.person ? "" : "zero"}" style="height:${Math.max(3, (d.person / max) * 100)}%" tabindex="0" title="${esc(label)}" aria-label="${esc(label)}"></span>`;
  }).join("");
  const row = (icon, label, n, small = "") => `<div class="u-row">${ICONS[icon]}<span>${label}</span><b>${n}${small ? `<small>${small}</small>` : ""}</b></div>`;
  const refs = usage?.refs ?? [];
  const fromBlog = refs.reduce((a, r) => a + r.people, 0), planted = refs.reduce((a, r) => a + r.planted, 0);
  const robots = w.totals.search + w.totals.ai + w.totals.preview + w.totals.bot;
  const crawled = w.crawled.search || w.crawled.ai ? `Han visitado ${w.crawled.search} ${w.crawled.search === 1 ? "página" : "páginas"} los buscadores y ${w.crawled.ai} los robots de IA.` : "Ningún buscador ni robot de IA ha visitado todavía el blog.";
  const hourly = chartRange === "24h";
  const chart = !hourly ? `<div class="u-chart" role="img" aria-label="Visitas de personas por día en los últimos 30 días">${bars}</div>
    <div class="u-axis"><span>${fmtDate(w.days[0].date)}</span><span>hoy</span></div>
    <div class="u-tip" aria-live="polite"></div>`
    : w.hours ? hourChart(w.hours, (h) => h.person, (h) => `${h.person} ${h.person === 1 ? "visita" : "visitas"}`, "Visitas de personas por hora en las últimas 24 horas")
      : `<p class="muted small">Todavía no hay datos por horas: se empiezan a guardar tras publicar la última versión.</p>`;
  return `<section class="card"><div class="sec">Visitas a la web <span class="meta">landing y blog · ${hourly ? "24 horas" : "30 días"}</span></div>
    <div class="u-tiles"><div><span>Hoy</span><b>${last(1)}</b></div><div><span>7 días</span><b>${last(7)}</b></div><div><span>30 días</span><b>${last(30)}</b></div></div>
    ${rangeToggle()}
    ${chart}
    ${w.pages.length ? `<div class="sec" style="margin-top:14px">Páginas más leídas</div>${w.pages.map((p) => row("notes", esc(WEB_PAGE(p.path)), p.n)).join("")}` : `<p class="muted small">Aún no hay visitas de personas.</p>`}
    ${w.sources.length ? `<div class="sec" style="margin-top:14px">De dónde llegan</div>${w.sources.map((s) => row("search", WEB_SRC[s.src] ?? s.src, s.n)).join("")}` : ""}
    <div class="sec" style="margin-top:14px">Recorrido</div>
    ${row("sprout", "Visitas de personas", last(30))}
    ${row("check", "Han abierto la app desde el blog", fromBlog, "desde que se mide")}
    ${row("plus", "Y han añadido una planta", planted)}
    <div class="sec" style="margin-top:14px">Robots <span class="meta">${robots} en 30 días · no cuentan como personas</span></div>
    ${WEB_BOTS.map(([k, label]) => row("database", label, w.totals[k])).join("")}
    <p class="muted small">${crawled}</p>
    <p class="muted small">Una <b>visita</b> es una persona en un día: si lee tres guías, cuenta una vez por cada página y una sola vez en el total. Sin cookies. Quien use un bloqueador de anuncios o «no rastrear» no aparece. Los robots se separan por cómo se identifican y solo se ven los que ejecutan JavaScript (Googlebot sí; muchos otros no): uno que se haga pasar por navegador cuenta como persona.</p></section>`;
}
function intentCard() {
  const i = usage?.intent;
  if (!i) return "";
  return `<section class="card"><div class="sec">Interés en Premium</div>
    <div class="u-row"><span>Han pulsado «Quiero»</span><b>${i.total}<small>${i.yearly} anual · ${i.monthly} mensual · ${i.lifetime} de por vida</small></b></div>
    ${i.recent.map((r) => `<div class="u-row"><span>${esc(r.contact || `Persona ${r.code}`)}</span><b>${esc({ monthly: "mensual", yearly: "anual", lifetime: "de por vida" }[r.choice])}<small>${fmtDate(new Date(r.ts).toISOString().slice(0, 10))}</small></b></div>`).join("")}</section>`;
}

// «Uso de la app» (needs the access code): real use only, from the Worker's D1 log (/stats2).
// «Real» = opened from florvia.app (or the old address), not from a device marked as Noza's, and since the
// clean start date. Tests and your own devices are listed apart and never added to the real numbers.
let usage = null; // null = loading · { error } · the /stats2 report
let usageWeb = null; // the /stats/web report (visits to the landing and the blog) · { error }
async function loadUsage() {
  try {
    const [res, webRes] = await Promise.all([fetch(`${API}/stats2?days=30`, { headers: aiHeaders() }), fetch(`${API}/stats/web?days=30`, { headers: aiHeaders() }).catch(() => null), pageTitles ? null : fetch("pages.json").then((r) => r.ok ? r.json() : null).then((t) => { pageTitles = t; }).catch(() => {})]);
    usage = res.ok ? await res.json() : { error: res.status === 401 ? "code" : "ai" };
    usageWeb = webRes?.ok ? await webRes.json() : { error: webRes?.status === 404 ? "missing" : "ai" };
    usageInvites = await fetch(`${API}/invites`, { headers: aiHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  } catch { usage = { error: "network" }; }
  if (sheet.open && sheet.dataset.view === "usage") usageSheet();
  loadAnalyses(true);
  loadFeedback(false);
}
const BUCKET_LABEL = { dev: "desde localhost (desarrollo)", none: "sin origen (scripts, curl)", internal: "de dispositivos marcados como tuyos", old: "de la dirección antigua", prod: "de producción", before: "anteriores a la fecha limpia" };
function usageSheet() {
  const head = `<div class="sheet-head"><h2>Uso de la app</h2><button class="btn small secondary" data-action="close">Cerrar</button></div>`;
  if (!usage) return openSheet(`${head}<div class="ai-step"><span class="spinner" aria-hidden="true"></span>Cargando…</div>`, "usage");
  if (usage.error) return openSheet(`${head}<p class="ai-status warn">${usage.error === "code" ? "El código guardado no es válido para ver el uso." : "No se ha podido cargar el uso. Prueba más tarde."}</p>`, "usage");
  const days = usage.days;
  const activeSince = (n) => { const from = days[Math.max(0, days.length - n)].date; return usage.people.filter((p) => p.last >= from).length; };
  const sum = (key) => days.reduce((a, d) => a + (d.events[key] ?? 0), 0);
  const ai = days.reduce((a, d) => ({ calls: a.calls + d.ai.calls, hits: a.hits + d.ai.hits, errors: a.errors + d.ai.errors, limits: a.limits + d.ai.limits, quota: a.quota + (d.ai.quota ?? 0), notPlant: a.notPlant + (d.ai.notPlant ?? 0), ms: a.ms + d.ai.ms }), { calls: 0, hits: 0, errors: 0, limits: 0, quota: 0, notPlant: 0, ms: 0 });
  // Last day with a given kind of problem, and whether something went wrong today (shown as a warning at the top of the AI card).
  const lastAiDay = (key) => { const d = [...days].reverse().find((x) => (x.ai[key] ?? 0) > 0); return d ? `última vez: ${fmtDate(d.date)}` : "ninguna vez"; };
  const todayAi = days[days.length - 1]?.ai ?? {};
  const todayWarn = (todayAi.quota ?? 0) > 0 ? "Hoy la IA ha agotado su cuota: las personas ven «La IA está saturada»." : (todayAi.limits ?? 0) > 0 ? "Hoy se ha llegado al tope diario de consultas de IA." : (todayAi.errors ?? 0) > 0 ? `Hoy la IA ha fallado ${todayAi.errors} ${todayAi.errors === 1 ? "vez" : "veces"}.` : "";
  const opens = days.map((d) => d.opens);
  const max = Math.max(4, ...opens);
  const bars = days.map((d, i) => {
    const label = `${fmtDate(d.date, { weekday: "short", day: "numeric", month: "short" })} · ${opens[i]} ${opens[i] === 1 ? "apertura" : "aperturas"} · ${d.people} ${d.people === 1 ? "persona" : "personas"}`;
    return `<span class="u-bar ${opens[i] ? "" : "zero"}" style="height:${Math.max(3, (opens[i] / max) * 100)}%" tabindex="0" title="${esc(label)}" aria-label="${esc(label)}"></span>`;
  }).join("");
  const total = ai.calls + ai.hits;
  const people = usage.people;
  const newWeek = people.filter((p) => p.first >= days[Math.max(0, days.length - 7)].date).length;
  const returning = people.filter((p) => p.activeDays >= 2).length;
  const synced = people.filter((p) => p.kind === "garden").length;
  const row = (icon, label, n, small = "") => `<div class="u-row">${ICONS[icon]}<span>${label}</span><b>${n}${small ? `<small>${small}</small>` : ""}</b></div>`;
  const t = usage.tests;
  const buckets = Object.entries(t.byBucket).map(([k, n]) => `${n} ${BUCKET_LABEL[k] ?? k}`).join(" · ");
  const nameOf = (p, i) => esc(p.label || `${p.kind === "garden" ? "Jardín" : p.kind === "device" ? "Móvil" : "Sin identificar"} ${p.code}`);
  openSheet(`${head}
    <p class="ai-status ok">Solo uso real desde el ${fmtDate(usage.cleanStart)}. Tus pruebas y tus dispositivos se cuentan aparte.</p>
    <div class="group-title">Cómo llega la gente</div>
    ${webCard()}
    ${refsCard()}
    <div class="group-title">Qué hacen</div>
    <section class="card"><div class="sec">Personas activas</div>
      <div class="u-tiles"><div><span>Hoy</span><b>${activeSince(1)}</b></div><div><span>7 días</span><b>${activeSince(7)}</b></div><div><span>30 días</span><b>${activeSince(30)}</b></div></div>
      ${row("sprout", "Personas en total", people.length, `${synced} con sincronización · ${people.length - synced} sin sincronizar`)}
      ${row("check", "Nuevas esta semana", newWeek)}
      ${row("refresh", "Han vuelto (2 o más días)", returning)}</section>
    <section class="card"><div class="sec">${chartRange === "24h" ? "Aperturas por hora" : "Aperturas por día"} <span class="meta">${chartRange === "24h" ? `24 horas · ${(usage.hours ?? []).reduce((a, h) => a + h.opens, 0)}` : `30 días · ${opens.reduce((a, b) => a + b, 0)}`}</span></div>
      ${rangeToggle()}
      ${chartRange === "24h" && usage.hours
        ? hourChart(usage.hours, (h) => h.opens, (h) => `${h.opens} ${h.opens === 1 ? "apertura" : "aperturas"} · ${h.people} ${h.people === 1 ? "persona" : "personas"}`, "Aperturas por hora en las últimas 24 horas").replace('class="u-tip"', 'class="u-tip" id="usageTip"')
        : `<div class="u-chart" role="img" aria-label="Aperturas por día en los últimos 30 días">${bars}</div>
      <div class="u-axis"><span>${fmtDate(days[0].date)}</span><span>hoy</span></div>
      <div class="u-tip" id="usageTip" aria-live="polite"></div>`}</section>
    ${retentionCard()}
    <section class="card"><div class="sec">Qué se hace <span class="meta">30 días</span></div>
      ${row("sprout", "Plantas añadidas", sum("plant_add_ai") + sum("plant_add_manual"), `${sum("plant_add_ai")} con IA · ${sum("plant_add_manual")} a mano`)}
      ${row("droplet", "Riegos marcados", sum("water_done") + sum("water_skip_rain"), sum("water_skip_rain") ? `${sum("water_skip_rain")} saltados por lluvia` : "")}
      ${row("flask", "Abonos marcados", sum("feed_done"))}
      ${row("check", "Tareas del checklist", sum("task_done"))}
      ${row("refresh", "Fichas actualizadas", sum("upgrade_done"))}</section>
    <div class="group-title">Qué piden</div>
    ${topicsCard()}
    <div class="group-title">Premium y acceso</div>
    ${intentCard()}
    ${invitesCard()}
    <div class="group-title">Inteligencia artificial</div>
    <section class="card"><div class="sec">Inteligencia artificial <span class="meta ai-mark">✦ 30 días</span></div>
      ${todayWarn ? `<p class="ai-status warn">${esc(todayWarn)}</p>` : ""}
      ${usage.cap?.limit ? row("sparkle", "Consultas de hoy", usage.cap.used, `de ${usage.cap.limit} permitidas`) : ""}
      ${row("sparkle", "Consultas", total)}
      ${row("database", "Desde la memoria (gratis)", ai.hits, total ? `${Math.round((ai.hits / total) * 100)} %` : "")}
      ${row("clock", "Tiempo medio de respuesta", ai.calls ? `${Math.round(ai.ms / ai.calls / 1000)} s` : "—")}
      ${row("alert", "Tope diario alcanzado", ai.limits, lastAiDay("limits"))}
      ${row("alert", "Cuota de la IA agotada", ai.quota, lastAiDay("quota"))}
      ${row("alert", "Otros fallos de la IA", ai.errors, lastAiDay("errors"))}
      ${row("check", "No era una planta", ai.notPlant, "no cuenta como consulta")}
      <p class="muted small">«Tope diario» es el límite propio de la app (se avisa por correo al 80 % y al 100 %). «Cuota» es que Google o Cloudflare se han quedado sin consultas gratis. «Otros fallos» son errores del modelo o de la conexión.</p></section>
    ${analysesCard()}
    ${qualityCard()}
    ${tokensCard()}
    <div class="group-title">Comentarios y avisos</div>
    ${feedbackAdminCards()}
    ${notifyCard()}
    <section class="card"><div class="sec">Avisos de comentarios nuevos</div>
      <p class="muted small">Te llega un correo cada vez que alguien manda un comentario. Aquí puedes recibir también un aviso en este dispositivo (en el iPhone, con la app instalada).</p>
      <button type="button" class="btn block secondary" data-action="admin-push" data-on="${store.get("mj_admin_push", false) ? "0" : "1"}">${store.get("mj_admin_push", false) ? "Avisos en este dispositivo activados · desactivar" : "Avisarme en este dispositivo"}</button>
      ${adminPushMsg ? `<p class="ai-status ${/No |Sin /.test(adminPushMsg) ? "warn" : "ok"}">${esc(adminPushMsg)}</p>` : ""}</section>
    <div class="group-title">Detalle y ajustes</div>
    <section class="card"><div class="sec">Personas</div>
      ${people.length ? people.map((p) => `<button type="button" class="u-person" data-action="usage-label" data-id="${esc(p.id)}" data-name="${esc(p.label)}"><span class="u-garden">${nameOf(p)}</span><b>${p.activeDays} ${p.activeDays === 1 ? "día" : "días"}<small>desde ${fmtDate(p.first)} · última ${fmtDate(p.last)} · ${p.opens} aperturas · ${p.aiCalls} consultas IA</small></b></button>`).join("") : `<p class="muted small">Todavía no hay uso real desde la fecha limpia.</p>`}
      <p class="muted small">Toca una persona para ponerle nombre. Cada persona ve su «Código de uso» al final de Ajustes: así sabes quién es quién.</p></section>
    <section class="card"><div class="sec">Pruebas y dispositivos tuyos</div>
      <p class="muted small">${buckets ? `Fuera de las cifras: ${esc(buckets)}.` : "Nada fuera de las cifras por ahora."}</p>
      <button type="button" class="btn block secondary" data-action="usage-mine" data-on="${usage.me.internal ? "0" : "1"}">${usage.me.internal ? "Este dispositivo está marcado como tuyo · quitar la marca" : "Marcar este dispositivo como mío"}</button></section>
    <section class="card"><div class="sec">Cómo se cuenta</div>
      <p class="muted small">Una <b>persona</b> es un jardín sincronizado (con clave o Google, aunque tenga varios móviles) o, si no sincroniza, un móvil: si cambia de móvil o reinstala sin sincronizar, cuenta como otra. Las <b>aperturas</b> son veces que se abre la app. Solo se cuenta lo que llega de florvia.app (y de la dirección antigua), no de localhost ni de scripts, y tampoco lo de dispositivos marcados como tuyos.</p></section>
    <p class="group-foot">Los recuentos son anónimos: sin notas, ubicación ni datos personales. Los avisos por correo de actividad sí llevan el nombre de la planta y un código de la persona (nunca fotos ni correos). Los nombres que pones a las personas solo los ves tú.</p>`, "usage");
}
// Tap or hover a bar to read its day.
document.addEventListener("focusin", (e) => { if (e.target.classList?.contains("select-on-focus")) e.target.select(); });
document.addEventListener("pointerover", (e) => { const b = e.target.closest?.(".u-bar"); const tip = b?.closest(".card")?.querySelector(".u-tip"); if (tip) tip.textContent = b.getAttribute("aria-label"); });
document.addEventListener("focusin", (e) => { const b = e.target.closest?.(".u-bar"); const tip = b?.closest(".card")?.querySelector(".u-tip"); if (tip) tip.textContent = b.getAttribute("aria-label"); });

const SHEET_VIEWS = { ai: aiSheet, upgrades: upgradesSheet, usage: usageSheet, suggest: () => { suggestRead(); suggestSheet(); }, feedback: () => { fbRead(); feedbackSheet(); }, premium: () => premiumSheet(premiumUi.reason, true), diag: () => { diagRead(); diagSheet(); } };

// ---------- Care sheet upgrades ----------
// When an improvement needs new data from the AI, it gets a version and an entry here. Plants
// whose sheet is older are offered "Actualizar fichas" in Ajustes, which fills only the new parts.
const UPGRADES = [
  {
    version: 1,
    label: "pauta de riego y abono por estación",
    // Keeps a season table the user already shaped; replaces a missing or flat (all-year) one.
    apply: (plant, care) => { if (!hasSeasonalCare(plant)) plant.seasons = care.seasons; },
  },
  {
    version: 2,
    label: "marcas ✦ de lo que propuso la IA",
    // Only records the AI's proposal as a reference: no value changes. Fields that still match it get ✦.
    // `retro`: asked after the fact, so differences aren't necessarily the user's edits.
    apply: (plant, care) => { if (!plant.ai) plant.ai = { ...aiSnapshot(care), retro: true }; },
  },
  {
    version: 3,
    label: "consejos por estación y notas para todo el año",
    // Adds the four seasonal tips. The notes are renewed when they're the AI's or of unknown origin
    // (plants from before provenance); notes the user rewrote are kept. Replaced notes go to the
    // plant's history as a note, so nothing is lost.
    apply: (plant, care) => {
      plant.tips = care.tips;
      const old = (plant.notes ?? "").trim();
      const userWrote = plant.ai && !plant.ai.retro && !isAiValue(plant, "notes");
      if (old && old !== care.notes && !userWrote) {
        state.data.log.push({ id: uid(), plantId: plant.id, type: "note", date: localToday(), time: new Date().toTimeString().slice(0, 5), note: `Notas anteriores: ${old}` });
      }
      if (!old || !userWrote) {
        plant.notes = care.notes;
        if (plant.ai) plant.ai.values.notes = care.notes;
      }
    },
  },
  {
    version: 5,
    label: "tipo de abono según la estación",
    apply: (plant, care) => { plant.feedTypes = care.feedTypes; },
  },
  {
    version: 6,
    label: "luz que necesita y temperatura mínima",
    apply: (plant, care) => {
      const f = sunFields(care);
      if (!plant.sunNeed) { plant.sunNeed = f.sunNeed; plant.sunSensitive = f.sunSensitive; }
      if (plant.minTemp == null) plant.minTemp = f.minTemp;
    },
  },
  {
    version: 7,
    label: "tareas que solo valen para plantas adultas",
    source: "calendar",
    apply: (plant, cal) => applyCalendar(plant, cal),
  },
  {
    version: 8,
    label: "cómo regarla, con método y cantidad",
    // Adds «Cómo regarla» to «Sobre la planta»; whatever else is already in the plant's info stays.
    apply: (plant, care) => { plant.info = { ...infoFields(care), ...(plant.info ?? {}), waterHow: care.waterHow ?? plant.info?.waterHow ?? "" }; },
  },
  {
    version: 4,
    label: "calendario de cuidados del año",
    source: "calendar",
    apply: (plant, cal) => applyCalendar(plant, cal),
  },
];
const CARE_VERSION = Math.max(...UPGRADES.map((u) => u.version));
// What the AI says about light and cold, kept on the plant.
// What the AI says about the plant itself (shown in Explorar and in the sheet's «Sobre la planta»).
const INFO_KEYS = ["plantIn", "potAdvice", "waterHow", "windSensitive", "plantMonths", "plantWhen", "matureSize", "matureNote", "bloomMonths", "bloomWhat", "difficulty", "toxic", "toxicNote", "invasive"];
const infoFields = (care) => Object.fromEntries(INFO_KEYS.filter((k) => care[k] !== undefined).map((k) => [k, care[k]]));
const DIFFICULTY = { facil: "Cuidado fácil", media: "Cuidado medio", exigente: "Exigente de cuidar" };
const SIZE_FINAL = { pequena: "pequeña", mediana: "mediana", grande: "grande" };
const PLANT_IN = { maceta: "Mejor en maceta", suelo: "Mejor en suelo", ambos: "Maceta o suelo" };
const TOXIC_TEXT = { mascotas: "Tóxica para mascotas", personas: "Tóxica para personas", ambos: "Tóxica para mascotas y personas" };
// 12 months, E…D, with the ones in `months` filled and the current month marked.
function monthStrip(months, label, note = "") {
  if (!months?.length) return "";
  const now = Number(localToday().slice(5, 7));
  return `<div class="mstrip-row"><span class="mstrip-label">${esc(label)}</span><div class="mstrip">${"EFMAMJJASOND".split("").map((m, i) => `<span class="${months.includes(i + 1) ? "on" : ""} ${i + 1 === now ? "now" : ""}">${m}</span>`).join("")}</div>${note ? `<small>${esc(note)}</small>` : ""}</div>`;
}
const sunFields = (care) => ({ sunNeed: care.sunNeed ?? "sun", sunSensitive: Boolean(care.sunSensitive), minTemp: care.minTemp ?? null });
const hasSeasonalCare = (p) => Boolean(p.seasons) && new Set(SEASONS.map((k) => `${p.seasons[k].water}/${p.seasons[k].feed}`)).size > 1;
// Plants from before versioning: a varied season table means version 1; a stored AI proposal, version 2.
const careVersionOf = (p) => Math.max(p.careVersion ?? (hasSeasonalCare(p) ? 1 : 0), p.ai ? 2 : 0);
const missingUpgrades = (p) => UPGRADES.filter((u) => u.version > careVersionOf(p));

let upgrade = null; // progress of the current "Actualizar fichas" run
const pendingUpgrades = () => state.data.plants.filter((p) => missingUpgrades(p).length);
const upgradeLabels = (pending) => [...new Set(pending.flatMap((p) => missingUpgrades(p).map((u) => u.label)))];

function upgradeStatus() {
  if (!upgrade) return "";
  if (upgrade.running) return `<p class="ai-status"><span class="spinner" aria-hidden="true"></span> Actualizando ${upgrade.done + 1} de ${upgrade.total}…</p>`;
  const ok = upgrade.done - upgrade.failed;
  return `<p class="ai-status ${upgrade.failed || upgrade.stopped ? "warn" : "ok"}">${esc(upgrade.stopped ?? `✅ ${ok} ${ok === 1 ? "ficha actualizada" : "fichas actualizadas"}. Revisa los datos de cada planta.${upgrade.failed ? ` ${upgrade.failed} no se pudieron actualizar; prueba más tarde.` : ""}`)}</p>`;
}

// Top of Hoy: the same offer, compact. «Más tarde» hides it until a newer improvement arrives;
// the Ajustes card and the dot on its tab stay meanwhile.
function upgradeBanner() {
  const pending = pendingUpgrades();
  const dismissed = store.get("mj_upgrade_later", 0) >= CARE_VERSION;
  if (upgrade && !upgrade.running && !upgrade.shownOnToday) return "";
  if (!upgrade && (!pending.length || dismissed)) return "";
  return `<section class="card upgrade-banner">
    ${pending.length && !upgrade?.running ? `<p><strong><span class="ai-mark">✦</span> ${pending.length === 1 ? "1 ficha tiene" : `${pending.length} fichas tienen`} mejoras nuevas</strong> <span class="muted">(${esc(upgradeLabels(pending).join(", "))})</span></p>
    <div class="row"><button class="btn small" data-action="upgrade-plants">Actualizar</button><button class="btn small secondary" data-action="upgrade-later">Más tarde</button></div>` : ""}
    ${upgradeStatus()}
    ${upgrade && !upgrade.running ? `<div class="row"><button class="btn small secondary" data-action="upgrade-close">Cerrar</button></div>` : ""}
  </section>`;
}

function upgradesCard() {
  const pending = pendingUpgrades();
  if (!pending.length && !upgrade) return "";
  const labels = upgradeLabels(pending);
  const result = upgradeStatus();
  return `<section class="card"><div class="sec">${pending.length ? `${pending.length === 1 ? "1 planta" : `${pending.length} plantas`}` : "Hecho"}</div>
    ${pending.length ? `<p class="muted">Hay mejoras que ${pending.length === 1 ? "esta planta aún no tiene" : "estas plantas aún no tienen"}: <strong>${esc(labels.join(", "))}</strong>. Pulsa una vez y la IA las completará. Lo que ya has puesto (nombre, zona, heladas y notas) no cambia.</p>
    <div class="row" style="margin-top:10px"><button class="btn small" data-action="upgrade-plants" ${upgrade?.running ? "disabled" : ""}>✦ Actualizar fichas</button></div>` : ""}
    ${result}</section>`;
}

async function upgradePlants() {
  const pending = pendingUpgrades();
  upgrade = { done: 0, total: pending.length, failed: 0, running: true, stopped: null, shownOnToday: state.tab === "today" };
  render();
  for (const plant of pending) {
    try {
      const missing = missingUpgrades(plant);
      const careUps = missing.filter((u) => u.source !== "calendar");
      if (careUps.length) {
        const care = await requestCare(plant.name, "upgrade");
        for (const u of careUps) u.apply(plant, care);
        if (!plant.species) plant.species = care.species;
        if (!plant.notes) plant.notes = care.notes;
        // Not past a calendar upgrade still to come in this run: if that one fails, it is asked again next time.
        const calPending = missing.filter((u) => u.source === "calendar").map((u) => u.version);
        plant.careVersion = Math.min(Math.max(...careUps.map((u) => u.version)), ...(calPending.length ? [Math.min(...calPending) - 1] : []));
        withCurrentIntervals(plant);
        save();
      }
      const calUps = missing.filter((u) => u.source === "calendar");
      if (calUps.length) {
        const cal = await requestCalendar(plant.name, plant.species);
        for (const u of calUps) u.apply(plant, cal);
        plant.careVersion = CARE_VERSION;
        save();
      }
      track("upgrade_done");
    } catch (err) {
      if (err.message === "code" || err.message === "limit") { upgrade.stopped = aiErrorText(err.message); break; }
      upgrade.failed += 1;
    }
    upgrade.done += 1;
    render();
  }
  upgrade.running = false;
  render();
}

function render() {
  const loc = state.loc ?? DEFAULT_LOC;
  $("placeBtn").innerHTML = `${ICONS.pin}${esc(loc.name)}`;
  // Header: the tab's name, with today's date under «Hoy» and the count under «Plantas».
  const n = state.data.plants.length;
  $("title").textContent = { today: "Hoy", plants: "Plantas", more: "Ajustes" }[state.tab] ?? "Florvia";
  $("subtitle").textContent = state.tab === "today"
    ? fmtDate(localToday(), { weekday: "long", day: "numeric", month: "long" }).replace(/^./, (c) => c.toUpperCase())
    : state.tab === "plants" ? (n === 1 ? "1 planta" : `${n} plantas`) : "Florvia";
  // Plan mark next to the title: Premium (paid, invited or Noza's), or the days left of the free month; nothing for the free plan.
  const pill = $("planPill");
  const pillText = !me || me.plan === "trial" ? "" : me.premium ? (me.accessUntil ? `Premium · ${accessDaysLeft()} d` : "Premium") : "";
  pill.hidden = !pillText;
  pill.innerHTML = pillText ? `✦ ${pillText}` : "";
  document.querySelectorAll(".tabbar button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
  $("fab").hidden = state.tab === "more";
  // Dot on Ajustes while some plant sheet has improvements to fetch.
  document.querySelector('.tabbar [data-tab="more"]').classList.toggle("has-dot", pendingUpgrades().length > 0);
  $("main").innerHTML = state.tab === "plants" ? plantsView() : state.tab === "more" ? moreView() : todayView();
  if (sheet.open && SHEET_VIEWS[sheet.dataset.view]) SHEET_VIEWS[sheet.dataset.view]();
}

// ---------- Sheets ----------
const sheet = $("sheet");
function openSheet(html, view = "") {
  sheet.dataset.view = view;
  delete sheet.dataset.plant; // plantSheet sets it again after opening
  sheet.innerHTML = `<div class="grabber" aria-hidden="true"></div><div class="sheet-in">${html}</div>`;
  if (!sheet.open) sheet.showModal();
}
function closeSheet() { sheet.close(); }

// Unsaved work in the open sheet: an edited plant form (typed or AI-filled), or a new plant
// whose name was already entered. Leaving asks first, so an AI fill isn't lost by accident.
let formDirty = false;
const hasUnsaved = () => formDirty || Boolean(wiz && ($("wizStep2") || $("wizName")?.elements.name.value.trim()));
function confirmDiscard() {
  if (hasUnsaved() && !confirm("Tienes cambios sin guardar. ¿Descartarlos?")) return false;
  formDirty = false;
  wiz = null;
  return true;
}
const leaveSheet = () => { if (confirmDiscard()) closeSheet(); };
sheet.addEventListener("click", (e) => { if (e.target === sheet) leaveSheet(); });

// Swipe down to close, as in iOS sheets: drag from the top of the sheet (or anywhere while it's
// scrolled to the top). Past 90 px it leaves (asking first if there are unsaved changes).
let drag = null;
sheet.addEventListener("touchstart", (e) => {
  if (sheet.scrollTop > 0 || e.target.closest("input, textarea, select")) return;
  drag = { y0: e.touches[0].clientY, dy: 0 };
}, { passive: true });
sheet.addEventListener("touchmove", (e) => {
  if (!drag) return;
  drag.dy = Math.max(0, e.touches[0].clientY - drag.y0);
  if (drag.dy > 0) { sheet.style.transition = "none"; sheet.style.transform = `translateY(${drag.dy}px)`; }
}, { passive: true });
sheet.addEventListener("touchend", () => {
  if (!drag) return;
  const far = drag.dy > 90;
  drag = null;
  sheet.style.transition = "transform 0.2s ease";
  if (far && confirmDiscard()) { sheet.style.transform = "translateY(100%)"; setTimeout(() => { closeSheet(); sheet.style.transform = ""; }, 180); }
  else sheet.style.transform = "";
});
sheet.addEventListener("cancel", (e) => { if (!confirmDiscard()) e.preventDefault(); }); // Esc / back gesture

// «Sobre la planta»: size, flowering, difficulty, where it does best and safety (plants added since Explorar).
let plantUi = { id: null, open: new Set(["month"]), monthAll: false, big: false, flash: null }; // what is unfolded in the plant sheet (kept across redraws)
document.addEventListener("toggle", (e) => { const d = e.target; if (d?.classList?.contains("pf") && d.dataset.k) d.open ? plantUi.open.add(d.dataset.k) : plantUi.open.delete(d.dataset.k); }, true);
// «hoy», «ayer», «hace 3 días»
const relPast = (iso, today) => { const n = daysBetween(iso, today); return n <= 0 ? "hoy" : n === 1 ? "ayer" : `hace ${n} días`; };
function aboutCard(p, bare = false) {
  const i = p.info;
  if (!i) return "";
  const row = (icon, title, text, level = "info") => `<div class="fit-row"><span class="fit-ic ${level}">${ICONS[icon]}</span><div><b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ""}</div></div>`;
  const inner = `${i.matureNote ? row("sprout", `Tamaño adulto ${SIZE_FINAL[i.matureSize] ?? ""}`.trim(), i.matureNote) : ""}
    ${monthStrip(i.bloomMonths, "Floración", i.bloomWhat)}
    ${i.difficulty ? row("check", DIFFICULTY[i.difficulty], "") : ""}
    ${i.waterHow ? row("droplet", "Cómo regarla", i.waterHow) : ""}
    ${i.plantIn ? row(i.plantIn === "suelo" ? "ground" : "pot", PLANT_IN[i.plantIn], i.potAdvice) : ""}
    ${i.toxic && i.toxic !== "no" ? row("alert", TOXIC_TEXT[i.toxic], i.toxicNote, "warn") : ""}
    ${i.invasive ? row("alert", "Puede ser invasora", "Evita que se escape del jardín.", "warn") : ""}`;
  return bare ? inner : `<section class="card"><div class="sec">Sobre la planta</div>${inner}</section>`;
}

function plantSheet(id) {
  const p = plantById(id);
  if (!p) return closeSheet();
  ensureRefPhoto(p);
  const today = localToday();
  const log = state.data.log.filter((e) => e.plantId === id).sort((a, b) => b.date.localeCompare(a.date));
  const lat = here().lat;
  const season = seasonOf(today, lat);
  const nexts = ["water", "feed"].map((type) => {
    const every = intervalFor(p, type, season);
    const due = nextDue(p, state.data.log, type, today, lat);
    const ico = `<span class="t-ico ${type}">${ICONS[TASK_ICON[type]]}</span>`;
    if (type === "water" && irrigated(p) && every) {
      return `<div class="n-row">${ico}<div class="body"><b>Riego automático</b><span>Para el programador: cada ${every} días en ${SEASON_LABEL[season].toLowerCase()}${autoHint(p, season)}</span></div></div>`;
    }
    if (due) {
      const n = daysBetween(today, due);
      const kind = type === "feed" && p.feedTypes?.[season] ? `<span class="feed-type">${esc(p.feedTypes[season])} <span class="ai-mark">✦</span></span>` : "";
      return `<div class="n-row">${ico}<div class="body"><b class="${n < 0 ? "late" : ""}">${CARE[type].label} ${relDue(n).toLowerCase()}</b><span>${fmtDate(due, { weekday: "long", day: "numeric", month: "short" }).replace(/^./, (c) => c.toUpperCase())}</span>${kind}</div>` +
        `<span class="tag">cada ${every} d${aiMark(isAiValue(p, `${season}.${type}`))}</span></div>`;
    }
    if (type === "feed" && p.seasons) {
      const back = SEASONS.slice(SEASONS.indexOf(season) + 1).concat(SEASONS).find((k) => intervalFor(p, "feed", k));
      return `<div class="n-row">${ico}<div class="body"><b>Sin abonar en ${SEASON_LABEL[season].toLowerCase()}${aiMark(isAiValue(p, `${season}.feed`))}</b>${back ? `<span>Vuelve en ${SEASON_LABEL[back].toLowerCase()}</span>` : ""}</div></div>`;
    }
    return null;
  }).filter(Boolean);
  // Heads-up when the next season changes the watering.
  const changeOn = nextSeasonStart(today, lat);
  const nextSeason = seasonOf(changeOn, lat);
  const nextWater = intervalFor(p, "water", nextSeason);
  const nextLine = p.seasons && nextWater !== intervalFor(p, "water", season)
    ? `<div class="n-next">${ICONS.calendar}El ${fmtDate(changeOn, { day: "numeric", month: "long" })} pasa a ${SEASON_LABEL[nextSeason].toLowerCase()}: regar cada ${nextWater} días</div>` : "";
  let provenance = "";
  if (p.ai) {
    const changed = Object.keys(p.ai.values).filter((k) => !isAiValue(p, k)).length;
    const diff = p.ai.retro
      ? `${changed === 1 ? "1 dato distinto" : `${changed} datos distintos`} de su propuesta`
      : `${changed === 1 ? "1 dato cambiado" : `${changed} datos cambiados`} por ti`;
    provenance = `<p class="provenance"><span class="ai-mark">✦</span> ${p.ai.retro ? "Revisado con la IA" : "Propuesto por la IA"} el ${fmtDate(p.ai.at, { day: "numeric", month: "long" })}${p.ai.time ? ` a las ${p.ai.time}` : ""}${changed ? ` · ${diff}` : ""}</p>`;
  }
  if (missingUpgrades(p).length) provenance += `<p class="provenance">Ficha por actualizar: Ajustes → Fichas por actualizar</p>`;
  const traits = [
    p.inPot ? ["pot", "Maceta"] : ["ground", "Suelo"],
    p.rainReaches ? ["rain", "Le llega la lluvia"] : ["umbrella", "A cubierto"],
    p.frostSensitive ? ["snow", "Sensible a heladas"] : null,
    p.autoWater ? ["drip", p.irrigationOff ? "Riego automático (pausado)" : "Riego automático"] : null,
    p.sunNeed ? [LIGHT_ICON[p.sunNeed], `Pide ${SUN_NEED_LABEL[p.sunNeed]}`] : null,
    exposureOf(p, zoneSun()) ? [LIGHT_ICON[exposureOf(p, zoneSun())], `Recibe ${SUN_LABEL[exposureOf(p, zoneSun())].toLowerCase()}`] : null,
    p.size ? ["sprout", `Tamaño ${(SIZE_LABEL[p.size] ?? "").toLowerCase()}`] : null,
  ].filter(Boolean);
  const sunWarn = sunAdvice(p, zoneSun(), state.weather);
  const LOG_ICON = { water: "droplet", feed: "flask", prune: "scissors", treat: "bug", note: "notes", task: "check" };
  if (plantUi.id !== id) plantUi = { id, open: new Set(["month"]), monthAll: false, big: false, flash: null };
  const open = (k) => plantUi.open.has(k);
  const fold = (k, title, preview, body) => `<details class="pf" data-k="${k}" ${open(k) ? "open" : ""}><summary><span class="pf-t"><span>${title}</span><span class="chev">${ICONS.chevron}</span></span>${preview ? `<span class="pf-prev">${preview}</span>` : ""}</summary><div class="pf-body">${body}</div></details>`;
  const month = plantMonthParts(p, today);
  const cal = yearCalendarParts(p, today);
  const about = aboutCard(p, true);
  const aboutPrev = p.info?.matureNote ? `${SIZE_FINAL[p.info.matureSize] ? `Tamaño adulto ${SIZE_FINAL[p.info.matureSize]}. ` : ""}${p.info.matureNote}` : (p.info?.difficulty ? DIFFICULTY[p.info.difficulty] : "");
  const lastLog = log[0];
  const notesBlock = p.notes
    ? fold("notes", `Notas${aiMark(isAiValue(p, "notes"))}`, `<span class="clamp2">${esc(p.notes)}</span>${p.notes.length > 100 ? `<span class="more">Ver más</span>` : ""}`, `<p class="muted notes-text">${esc(p.notes).replace(/\n/g, "<br>")}</p>`)
    : `<button type="button" class="pf-add" data-action="edit-plant" data-id="${p.id}"><span class="pf-t"><span>Notas</span><span class="chev plus">${ICONS.plus ?? "+"}</span></span><span class="pf-prev">Añadir una nota</span></button>`;
  const photoSrc = p.photo || p.refPhoto?.url || "";
  openSheet(`
    <div class="sheet-head"><h2>${esc(plantLabel(p))}</h2><div class="row"><button class="btn small secondary icon-btn" data-action="plant-share" data-id="${p.id}" aria-label="Compartir esta planta" title="Compartir">${ICONS.share}</button><button class="btn small secondary icon-btn" data-action="dup-plant" data-id="${p.id}" aria-label="Duplicar planta" title="Duplicar">${ICONS.copy}</button><button class="btn small secondary" data-action="edit-plant" data-id="${p.id}">Editar</button><button class="btn small secondary" data-action="close">Cerrar</button></div></div>
    <div class="p-top">
      <button type="button" class="p-thumb" data-action="pf-photo" aria-label="${plantUi.big ? "Reducir la foto" : "Ver la foto grande"}">${photoSrc ? `<img src="${esc(photoSrc)}" alt="" />` : ICONS.sprout}</button>
      <div class="p-meta">${p.species || p.zone || p.nick ? `<p class="muted">${p.nick ? `${esc(p.name)} · ` : ""}${p.species ? `<em>${esc(p.species)}</em>${aiMark(isAiValue(p, "species"))}` : ""}${p.species && p.zone ? " · " : ""}${esc(p.zone)}</p>` : `<p class="muted">&nbsp;</p>`}
        <div class="traits">${traits.map(([icon, label]) => `<span class="trait">${ICONS[icon]}${label}</span>`).join("")}</div></div>
    </div>
    ${plantUi.big && photoSrc ? (p.photo ? `<img class="hero-photo" src="${esc(p.photo)}" alt="" />` : `<figure class="ref-photo"><img class="hero-photo" src="${esc(p.refPhoto.url)}" alt="" /><figcaption>Foto de referencia · ${esc(p.refPhoto.credit)}</figcaption></figure>`) : ""}
    ${sunWarn ? `<p class="sun-warn ${sunWarn.level}">${ICONS.sun}${esc(sunWarn.text)}</p>` : ""}
    ${aiStrip(p)}
    ${nexts.length ? `<section class="card next-care"><div class="sec">${p.seasons ? `Ahora · ${SEASON_LABEL[season].toLowerCase()}` : "Ahora"}</div>${nexts.join("")}${p.tips?.[season] ? `<div class="n-tip">${ICONS[SEASON_ICON[season]]}<span>${esc(p.tips[season])} <span class="ai-mark">✦</span></span></div>` : ""}${nextLine}</section>` : ""}
    <section class="card reg"><div class="acts">
      ${Object.entries(CARE).filter(([type]) => type !== "task").map(([type, c]) => {
        const doneToday = log.some((e) => e.type === type && e.date === today);
        const flash = plantUi.flash?.type === type && Date.now() - plantUi.flash.at < 1500;
        return `<button type="button" class="act ${doneToday ? "done-today" : ""} ${flash ? "flash" : ""}" data-action="log" data-type="${type}" data-id="${p.id}" data-reopen="1">${doneToday ? ICONS.check : ICONS[LOG_ICON[type]]}${c.done}</button>`;
      }).join("")}
    </div></section>
    ${month ? `<details class="pf month" data-k="month" ${open("month") ? "open" : ""}><summary><span class="pf-t"><span>Este mes · ${month.name}${p.yearTasks?.length ? ` <span class="ai-mark">✦</span>` : ""}</span><span class="pf-count">${month.count}<span class="chev">${ICONS.chevron}</span></span></span></summary><div class="pf-body ${plantUi.monthAll ? "all" : ""}">${month.rows.slice(0, plantUi.monthAll ? 99 : 2).join("")}${month.rows.length > 2 ? `<button type="button" class="link-btn" data-action="pf-month">${plantUi.monthAll ? "Ver menos" : `Ver las ${month.rows.length - 2} restantes`}</button>` : ""}</div></details>` : month === null && calendarPending.has(p.id) ? `<section class="card"><div class="sec">Este mes</div><div class="ai-step"><span class="spinner" aria-hidden="true"></span>Preparando el calendario del año…</div></section>` : ""}
    <div class="pf-group">
      ${placeAdviceFold(p, fold)}
      ${cal ? fold("cal", `Calendario del año${p.yearTasks?.length ? ` <span class="ai-mark">✦</span>` : ""}`, `<span class="mini-year">${[...Array(12).keys()].map((i) => `<i class="${cal.months.has(i + 1) ? "on" : ""} ${i + 1 === cal.now ? "now" : ""}"></i>`).join("")}</span>${cal.line ? `<span class="pf-line">${esc(cal.line)}</span>` : ""}`, cal.html) : ""}
      ${about ? fold("about", "Sobre la planta", aboutPrev ? `<span class="clamp2">${esc(aboutPrev)}</span>${aboutPrev.length > 100 ? `<span class="more">Ver más</span>` : ""}` : "", about) : ""}
      ${notesBlock}
      ${fold("log", "Historial", lastLog ? `<span class="pf-line">${log.length} · ${esc(CARE[lastLog.type]?.done ?? lastLog.type)} ${esc(relPast(lastLog.date, today))}</span>` : `<span class="pf-line">Sin registros todavía</span>`, log.length ? `<ul class="log">${log.map((e) => `
      <li><span class="log-ico ${e.type}">${ICONS[LOG_ICON[e.type]] ?? ""}</span><span class="log-what">${esc(CARE[e.type]?.done ?? e.type)}${e.note ? ` — ${esc(e.note)}` : ""}</span><span class="d">${fmtDate(e.date)}</span>
      <button class="x" data-action="del-log" data-log="${e.id}" data-id="${p.id}" aria-label="Borrar">${ICONS.x}</button></li>`).join("")}</ul>` : `<p class="muted">Sin registros todavía.</p>`)}
    </div>
    ${provenance}
    `);
  sheet.dataset.plant = id;
}

// «¿Qué le pasa?»: diagnosis of one plant (Worker /diagnose). Symptoms + a note + optionally a photo, plus what the app
// knows of the plant (watering rhythm, last watering and feeding, zone). Counts against the monthly «diagnose» limit.
const DIAG_SYMPTOMS = [["amarillas", "Hojas amarillas"], ["marrones", "Puntas o hojas marrones"], ["mustia", "Hojas caídas o mustias"], ["manchas", "Manchas en las hojas"], ["bichos", "Bichos o plagas"], ["moho", "Moho o polvillo blanco"], ["enrolladas", "Hojas enrolladas"], ["sin_crecer", "No crece"], ["tallo_blando", "Tallo blando o con mal olor"], ["caen", "Se le caen hojas o flores"], ["sin_flor", "No florece"]];
// ---------- «¿Te sirvió?»: rating an AI result, and Noza's view of each saved case ----------
// A 👍/👎 under the result of the AI (care sheet in the alta, photo identification, diagnosis). Rating sends the case
// (what was asked, what the AI answered and, if there were, the photo and free text) to the Worker (POST /rating), which keeps it
// and emails Noza a link (#caso=ID) that opens it again here, read-only, as the person saw it.
const RATE_REASONS = [["planta_equivocada", "Planta equivocada"], ["cuidados_no_encajan", "Cuidados que no encajan"], ["consejo_dudoso", "Consejo dudoso o peligroso"], ["generico", "Demasiado genérico"], ["otro", "Otro"]];
const rateCtxs = {}; // key → { kind, name, input, output, photo, rerender }, filled while rendering
const rateUi = {};   // key → { step: "ask" | "why" | "sending" | "error", reasons: [], note }
const ratedKeys = () => store.get("mj_rated", []);
function shortHash(text) { let h = 5381; for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i); return (h >>> 0).toString(36); }
function ratingCard(ctx) {
  if (!hasAI()) return "";
  const key = `${ctx.kind}:${shortHash(JSON.stringify([ctx.name, ctx.output]))}`;
  if (ratedKeys().includes(key)) return "";
  rateCtxs[key] = ctx;
  const ui = (rateUi[key] ??= { step: "ask", reasons: [], note: "" });
  const note = `<p class="muted small" style="margin:6px 0 0">Al valorar, nos llega esta consulta (la planta, el resultado y, si los hay, la foto y tu texto) para mejorar Florvia.</p>`;
  if (ui.step === "ask") {
    return `<section class="card rate"><div class="row" style="justify-content:space-between;align-items:center"><b>¿Te sirvió?</b><span class="row" style="gap:8px">
      <button type="button" class="btn small secondary" data-action="rate-up" data-key="${key}" aria-label="Sí, me sirvió">👍</button>
      <button type="button" class="btn small secondary" data-action="rate-down" data-key="${key}" aria-label="No me sirvió">👎</button></span></div>${note}</section>`;
  }
  return `<section class="card rate"><b>¿Qué ha fallado?</b> <span class="muted small">(elige las que quieras)</span>
    <div class="chips" style="margin-top:8px">${RATE_REASONS.map(([k, t]) => `<button type="button" class="chip ${ui.reasons.includes(k) ? "on" : ""}" data-action="rate-reason" data-key="${key}" data-k="${k}" aria-pressed="${ui.reasons.includes(k)}">${t}</button>`).join("")}</div>
    <textarea id="rateNote" maxlength="200" rows="2" class="big-input" placeholder="Cuéntame qué esperabas (opcional)">${esc(ui.note)}</textarea>
    ${ui.step === "error" ? `<p class="ai-status warn">No se ha podido enviar. Prueba otra vez.</p>` : ""}
    <div class="row" style="gap:8px;margin-top:8px"><button type="button" class="btn small" data-action="rate-send" data-key="${key}" ${ui.step === "sending" ? "disabled" : ""}>${ui.step === "sending" ? "Enviando…" : "Enviar"}</button><button type="button" class="btn small secondary" data-action="rate-cancel" data-key="${key}">Cancelar</button></div>${note}</section>`;
}
async function rateSend(key, rating) {
  const ctx = rateCtxs[key];
  const ui = rateUi[key];
  if (!ctx || !ui) return;
  ui.note = $("rateNote")?.value ?? ui.note;
  ui.step = "sending";
  ctx.rerender();
  try {
    const res = await fetch(`${API}/rating`, { method: "POST", headers: aiHeaders(), body: JSON.stringify({ kind: ctx.kind, rating, reasons: rating ? [] : ui.reasons, note: rating ? "" : ui.note.trim(), name: ctx.name, caseId: ctx.caseId || undefined, version: APP_VERSION, input: ctx.input, output: ctx.output, photo: ctx.photo || undefined }) });
    if (!res.ok && res.status !== 429) throw new Error();
    store.set("mj_rated", [...ratedKeys(), key].slice(-300));
    delete rateUi[key];
    toast(rating ? "¡Gracias! Me alegra que te sirviera." : "¡Gracias! Lo voy a revisar.");
  } catch { ui.step = "error"; }
  ctx.rerender();
}

// Noza's view of a saved case (link #caso=ID in the email, or «Casos para revisar» in «Uso de la app»): what was asked and what the AI answered.
let caseView = null; // the /case/ID reply, or { error }
async function openCase(id) {
  caseView = null;
  openSheet(`<div class="sheet-head"><h2>Caso</h2><button class="btn small secondary" data-action="close">Cerrar</button></div><div class="ai-step"><span class="spinner" aria-hidden="true"></span>Cargando…</div>`, "case");
  try {
    const res = await fetch(`${API}/case/${id}`, { headers: aiHeaders() });
    caseView = res.ok ? await res.json() : { error: res.status === 401 ? "code" : res.status === 404 ? "notfound" : "ai" };
  } catch { caseView = { error: "network" }; }
  caseSheet();
}
const CASE_KIND = { place: "¿Dónde está mejor?", care: "Ficha de cuidados", identify: "Identificar por foto", diagnose: "Diagnóstico", suggest: "Qué planto aquí", explore: "Explorar", calendar: "Calendario del año" };
const CASE_STATUS = [["new", "Sin revisar"], ["revisado", "Revisado"], ["bueno", "Bueno"], ["malo", "Malo"], ["caso_de_prueba", "Caso de prueba"]];
function careCaseHtml(c) {
  const rows = SEASONS.filter((s) => c.seasons?.[s]).map((s) => `<div class="u-row"><span>${SEASON_LABEL[s]}</span><b>Riego cada ${c.seasons[s].water} d<small>${c.seasons[s].feed ? `abono cada ${c.seasons[s].feed} d` : "sin abono"}</small></b></div>`).join("");
  return `<section class="card"><b>${esc(c.commonName || c.species || "")}</b>${c.species ? ` <i class="muted">${esc(c.species)}</i>` : ""}
      <p class="muted small">Confianza ${esc(c.confidence ?? "—")}${c.provider ? ` · modelo ${esc(c.provider)}` : ""}${c.minTemp != null ? ` · aguanta hasta ${esc(c.minTemp)}°` : ""}</p>
      ${speciesFacts({ sunNeed: c.sunNeed, sunSensitive: c.sunSensitive, frostSensitive: c.frostSensitive })}</section>
    <section class="card"><div class="sec">Cuidados por estación</div>${rows}</section>
    ${c.tips ? `<section class="card">${tipsList(c.tips)}</section>` : ""}
    ${c.notes ? `<section class="card"><div class="sec">Notas de la IA</div><p class="muted">${esc(c.notes)}</p></section>` : ""}
    ${c.alternatives?.length ? `<section class="card"><div class="sec">Alternativas</div>${c.alternatives.map((x) => `<div class="u-row"><span>${esc(x.commonName ?? x.species ?? "")}</span><b><small>${esc(x.species ?? "")}</small></b></div>`).join("")}</section>` : ""}`;
}
function caseSheet() {
  const head = `<div class="sheet-head"><h2>Caso</h2><button class="btn small secondary" data-action="close">Cerrar</button></div>`;
  const c = caseView;
  if (!c) return openSheet(`${head}<div class="ai-step"><span class="spinner" aria-hidden="true"></span>Cargando…</div>`, "case");
  if (c.error) return openSheet(`${head}<p class="ai-status warn">${{ code: "Necesitas tu código de acceso en esta app (Ajustes → Asistente IA) para ver los casos.", notfound: "Ese caso no existe o ya ha caducado (se guardan 180 días).", network: "Sin conexión." }[c.error] ?? "No se ha podido cargar el caso."}</p>`, "case");
  const out = c.output ?? {};
  const inp = c.input ?? {};
  let body = "";
  if (c.kind === "diagnose") {
    body = `<section class="card"><div class="sec">Lo que se le pidió</div>
        <p><b>${esc(inp.plant?.name ?? c.name)}</b>${inp.plant?.zone ? ` · ${esc(inp.plant.zone)}` : ""}</p>
        ${inp.symptoms?.length ? `<p class="muted small">Síntomas: ${esc(inp.symptoms.map((k) => DIAG_SYMPTOMS.find(([x]) => x === k)?.[1] ?? k).join(", "))}</p>` : ""}
        ${inp.note ? `<p class="muted">«${esc(inp.note)}»</p>` : ""}
        ${c.photo ? `<img class="hero-photo" src="${esc(c.photo)}" alt="" style="max-height:260px;object-fit:cover" />` : `<p class="muted small">Sin foto.</p>`}</section>
      ${out.photo === "otra_planta" || out.photo === "no_es_planta" ? `<section class="card"><b>${out.photo === "otra_planta" ? "La foto no era de esa planta" : "La foto no era de una planta"}</b>${out.photoSeen ? `<p class="muted small">Parecía ${esc(out.photoSeen)}.</p>` : ""}</section>` : diagResultHtml(out)}`;
  } else if (c.kind === "identify") {
    const conf = { alta: "Muy probable", media: "Probable", baja: "Poco seguro" };
    body = `<section class="card">${c.photo ? `<img class="hero-photo" src="${esc(c.photo)}" alt="" style="max-height:260px;object-fit:cover" />` : `<p class="muted small">Sin foto guardada.</p>`}</section>
      <section class="card"><div class="sec">Qué dijo la IA</div>${(out.candidates ?? []).map((x) => `<div class="u-row"><span><b>${esc(x.commonName)}</b> <i class="muted">${esc(x.species)}</i></span><b>${esc(conf[x.confidence] ?? x.confidence)}</b></div>`).join("") || `<p class="muted small">Sin candidatos.</p>`}</section>`;
  } else if (c.kind === "care" || c.kind === "explore") {
    body = `${inp.place ? `<p class="muted small">Pedida para: ${esc(inp.place)}</p>` : ""}${careCaseHtml(out)}`;
  } else if (c.kind === "place") {
    body = `<section class="card"><div class="sec">Lo que se le pidió</div><p><b>${esc(inp.name ?? c.name)}</b>${inp.current ? ` · ahora en ${esc(inp.current)}` : ""}</p><p class="muted small">Zonas: ${esc((inp.zones ?? []).join(", "))}</p></section><section class="card"><div class="sec">Qué dijo la IA <span class="ai-mark">✦</span></div>${placeAdviceHtml(out, inp.current ?? "")}</section>`;
  } else {
    body = `<section class="card"><div class="sec">Entrada</div><pre class="muted small" style="white-space:pre-wrap">${esc(JSON.stringify(inp, null, 2))}</pre></section><section class="card"><div class="sec">Respuesta</div><pre class="muted small" style="white-space:pre-wrap">${esc(JSON.stringify(out, null, 2))}</pre></section>`;
  }
  openSheet(`${head}
    <section class="card"><div class="row" style="justify-content:space-between;align-items:center"><b>${c.rating === 1 ? "👍 Le sirvió" : c.rating === 0 ? "👎 No le sirvió" : "Sin valorar"}</b><span class="muted small">${CASE_KIND[c.kind] ?? c.kind}${c.internal ? " · prueba tuya" : ""}</span></div>
      ${c.reasons?.length ? `<div class="chips" style="margin-top:8px">${c.reasons.map((k) => `<span class="chip on">${esc(RATE_REASONS.find(([x]) => x === k)?.[1] ?? k)}</span>`).join("")}</div>` : ""}
      ${c.note ? `<p class="muted">«${esc(c.note)}»</p>` : ""}
      <p class="muted small">${esc(c.person)} · ${esc(new Date(c.ts).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" }))}${c.version ? ` · versión ${esc(c.version)}` : ""}${c.provider ? ` · ${esc(c.provider)}` : ""}</p></section>
    ${body}
    <section class="card"><div class="sec">Revisión</div>
      <div class="chips">${CASE_STATUS.map(([k, t]) => `<button type="button" class="chip ${c.status === k ? "on" : ""}" data-action="case-status" data-id="${esc(c.id)}" data-status="${k}" aria-pressed="${c.status === k}">${t}</button>`).join("")}</div></section>`, "case");
}

let diag = null; // { id, symptoms: [], note, photo, state: "idle" | "loading" | "done" | "error", res, error, saved }
// The AI tools of a plant in one strip: «¿Qué le pasa?» on top, the other two as links, and their status lines.
function aiStrip(p) {
  const off = aiOff();
  const place = plantPlace?.id === p.id && (plantPlace.running || (!plantPlace.ok && Date.now() - plantPlace.at < 15000)) ? plantPlace : null;
  const ref = plantRefresh?.id === p.id && (plantRefresh.running || Date.now() - plantRefresh.at < 15000) ? plantRefresh : null;
  const status = [place, ref].filter((x) => x?.text).map((x) => `<p class="ai-status ${x.running ? "" : x.ok ? "ok" : "warn"}">${x.running ? `<span class="spinner" aria-hidden="true"></span> ` : ""}${esc(x.text)}</p>`).join("");
  return `<section class="card ai-strip">
    <button type="button" class="dg-main" data-action="diag-open" data-id="${p.id}" ${off ? "disabled" : ""}><span aria-hidden="true">✦</span> ¿Qué le pasa?</button>
    <div class="ai-pills">${allZones().length ? `<button type="button" class="ai-pill-btn" data-action="plant-place" data-id="${p.id}" ${place?.running || off ? "disabled" : ""}>${ICONS.pin}Dónde está mejor</button>` : ""}<button type="button" class="ai-pill-btn" data-action="plant-refresh" data-id="${p.id}" ${ref?.running || off ? "disabled" : ""}>${ICONS.refresh}Actualizar ficha</button></div>
    ${status}${off ? `<p class="muted small">La IA está apagada en este móvil (Ajustes → Asistente IA).</p>` : ""}</section>`;
}
// «¿Dónde está mejor?» result as a fold (only once it has been asked).
function placeAdviceFold(p, fold) {
  const a = p.placeAdvice;
  if (!a?.zones?.length) return "";
  const stale = (a.zone ?? "") !== (p.zone || "");
  const prev = a.best && a.best !== (p.zone || "") ? `Mejor en ${esc(a.best)}` : "Donde está le va bien";
  return fold("place", `¿Dónde está mejor?${aiMark(true)}`, `<span class="pf-line">${prev}${stale ? " · ha cambiado de zona" : ""}</span>`,
    `<p class="muted small"><span class="ai-mark">✦</span> Valoración de la IA, el ${fmtDate(a.at)}${stale ? ` para «${esc(a.zone || "sin zona")}»: ha cambiado de zona, vuelve a valorar` : ""}.</p>${placeAdviceHtml(a, p.zone || "")}${placeNudge()}`);
}
function diagRead() {
  if (!diag) return;
  if ($("dgNote")) diag.note = $("dgNote").value;
}
// The result of a diagnosis (urgency, summary, causes…), shared by the diagnosis sheet and Noza's case view.
function diagResultHtml(r) {
  const LV = { alta: "Muy probable", media: "Probable", baja: "Posible" };
  const URG = { alta: ["warn", "Conviene actuar ya"], media: ["", "Conviene actuar esta semana"], baja: ["ok", "No es urgente"] };
  const [uc, ut] = URG[r.urgency] ?? URG.media;
  return `<p class="ai-status ${uc}">${esc(ut)}</p>
      ${r.summary ? `<p class="dg-summary">${esc(r.summary)}</p>` : ""}
      ${r.photo === "dudosa" ? `<p class="muted small">La foto no se ve con claridad${r.photoSeen ? ` (parece ${esc(r.photoSeen)})` : ""}: el diagnóstico se apoya sobre todo en lo que has marcado.</p>` : ""}
      ${(r.causes ?? []).map((c) => `<section class="card dg-cause"><div class="dg-title"><b>${esc(c.title)} <span class="ai-mark">✦</span></b><span class="conf ${c.likelihood}">${LV[c.likelihood]}</span></div>
        <p class="dg-why">${esc(c.why)}</p>
        ${c.check ? `<div class="dg-label">Cómo comprobarlo</div><p class="dg-text">${esc(c.check)}</p>` : ""}
        <div class="dg-label">Qué hacer</div><p class="dg-text">${esc(c.action)}</p></section>`).join("")}
      ${r.watch ? `<section class="card dg-cause"><div class="dg-label first">Vigila</div><p class="dg-text">${esc(r.watch)}</p></section>` : ""}
      ${r.needMore ? `<p class="muted small">Para afinar más: ${esc(r.needMore)}</p>` : ""}
      <p class="muted small">Es una estimación de la IA, no una garantía. Si la planta empeora o no ves mejoría, pide consejo en un vivero.</p>`;
}
function diagSheet() {
  const dg = diag;
  const p = dg && plantById(dg.id);
  if (!p) return closeSheet();
  const head = `<div class="sheet-head"><h2>¿Qué le pasa?</h2><button class="btn small secondary" data-action="open-plant" data-id="${p.id}">Volver</button></div>`;
  if (dg.state === "loading") return openSheet(`${head}<div class="ai-step"><span class="spinner" aria-hidden="true"></span>Mirando qué puede ser: unos segundos…</div>`, "diag");
  if (dg.state === "done") {
    const r = dg.res;
    // The photo is not of this plant (or not of a plant): no diagnosis, and it doesn't use up one of the monthly diagnoses.
    if (r.photo === "otra_planta" || r.photo === "no_es_planta") {
      const other = r.photo === "otra_planta";
      return openSheet(`${head}<section class="card"><b>${other ? `La foto no parece ser de «${esc(plantLabel(p))}»` : "No parece que la foto muestre una planta"}</b>
        <p class="muted small">${other && r.photoSeen ? `Parece <b>${esc(r.photoSeen)}</b>. ` : ""}Para no darte un consejo equivocado, no he hecho el diagnóstico, y esta consulta no gasta uno de tus diagnósticos del mes. ${other ? "Si es otra planta, abre su ficha y diagnostícala desde allí." : ""}</p></section>
        <button type="button" class="btn block secondary" data-action="dg-back">Probar con otra foto</button>
        <button type="button" class="btn block secondary" style="margin-top:8px" data-action="dg-dropphoto">Quitar la foto y describir el problema</button>
        <p class="muted small">Quitar la foto no llama a la IA. Cuando pulses Diagnosticar, ese diagnóstico sí gastará uno de tus diagnósticos del mes.</p>`, "diag");
    }
    if (!r.isPlant || !r.causes.length) {
      return openSheet(`${head}<section class="card"><b>No he podido sacar una causa clara</b>
        <p class="muted small">${esc(r.needMore || r.summary || "Prueba con otra foto, más cerca del problema y con luz natural.")}</p></section>
        <button type="button" class="btn block secondary" data-action="dg-back">Volver a intentarlo</button>`, "diag");
    }
    return openSheet(`${head}
      ${diagResultHtml(r)}
      ${ratingCard({ kind: "diagnose", name: plantLabel(p), input: { plant: { name: p.name, species: p.species ?? "", zone: p.zone ?? "" }, symptoms: dg.symptoms, note: dg.note }, output: r, photo: dg.photo, caseId: r.caseId, rerender: diagSheet })}
      <button type="button" class="btn block" data-action="dg-save" ${dg.saved ? "disabled" : ""}>${dg.saved ? "Anotado en el historial" : "Anotar en el historial"}</button>
      <button type="button" class="btn block secondary" data-action="dg-back" style="margin-top:8px">Hacer otra consulta</button>`, "diag");
  }
  const left = me?.limits?.diagnose ? Math.max(0, me.limits.diagnose - (me.used?.diagnose ?? 0)) : null;
  openSheet(`${head}
    <p class="muted small">${esc(plantLabel(p))}: marca lo que ves. Cuantos más detalles, mejor. La IA tiene en cuenta su riego, su zona y la época.</p>
    <div class="group-title">Síntomas</div>
    <div class="chips">${DIAG_SYMPTOMS.map(([k, t]) => `<button type="button" class="chip ${dg.symptoms.includes(k) ? "on" : ""}" data-action="dg-sym" data-k="${k}" aria-pressed="${dg.symptoms.includes(k)}">${t}</button>`).join("")}</div>
    <div class="group-title">Cuéntalo con tus palabras <span class="muted">(hasta 300 caracteres)</span></div>
    <textarea id="dgNote" maxlength="300" rows="3" class="big-input" placeholder="Desde cuándo pasa, qué has cambiado, dónde está la mancha…">${esc(dg.note)}</textarea>
    ${dg.photo ? "" : `<p class="muted small">Sin foto, la IA se apoya solo en lo que marques y cuentes: cuanto más detalle, más precisa será.</p>`}
    <div class="group-title">Foto <span class="muted">(opcional, ayuda mucho)</span></div>
    ${dg.photo ? `<img class="hero-photo" src="${esc(dg.photo)}" alt="" style="max-height:220px;object-fit:cover" />
      <div class="row"><label class="link-btn">Cambiar foto<input type="file" id="dgPhotoInput" accept="image/*" hidden /></label><button type="button" class="link-btn" data-action="dg-nophoto">Quitar</button></div>`
      : `<label class="card id-cta">${ICONS.camera}<div><b>Añadir una foto</b><span class="muted small">Del problema, de cerca y con luz natural.</span></div><input type="file" id="dgPhotoInput" accept="image/*" hidden /></label>`}
    <p class="muted small">No escribas datos personales: el texto y la foto se envían a la IA.</p>
    ${dg.state === "error" ? `<p class="ai-status warn">${esc(dg.error)}</p>` : ""}
    <button type="button" class="btn block" data-action="dg-go" ${aiOff() ? "disabled" : ""}>✦ Diagnosticar</button>
    ${left !== null ? `<p class="muted small">${me?.premium || !me?.enforced ? "" : `Te quedan ${left} de ${me.limits.diagnose} este mes en el plan gratuito.`}</p>` : ""}`, "diag");
}
async function diagGo() {
  diagRead();
  const dg = diag;
  if (!dg) return;
  if (!dg.symptoms.length && !dg.note.trim() && !dg.photo) { dg.state = "error"; dg.error = "Marca algún síntoma, escribe qué ves o añade una foto."; return diagSheet(); }
  const p = plantById(dg.id);
  if (!p) return;
  dg.state = "loading";
  diagSheet();
  try {
    if (aiOff()) throw new Error("off");
    if (aiOpen === false && !aiCode()) throw new Error("code");
    const today = localToday();
    const since = (type) => { const d = state.data.log.filter((e) => e.plantId === p.id && e.type === type).map((e) => e.date).sort().pop(); return d ? Math.max(0, daysBetween(d, today)) : -1; };
    const season = seasonOf(today, here().lat);
    const plant = { name: p.name, species: p.species ?? "", zone: p.zone ?? "", pot: typeof p.inPot === "boolean" ? p.inPot : null, sun: zoneSun()[p.zone] ?? p.sun ?? "", waterEvery: intervalFor(p, "water", season) ?? 0, lastWatered: since("water"), lastFed: since("feed"), minTemp: p.minTemp ?? null, frostSensitive: Boolean(p.frostSensitive) };
    let res;
    try {
      res = await fetch(`${API}/diagnose`, { method: "POST", signal: AbortSignal.timeout(55000), headers: aiHeaders(), body: JSON.stringify({ plant, symptoms: dg.symptoms, note: dg.note.trim(), image: dg.photo ? dg.photo.split(",")[1] : undefined, place: here().name }) });
    } catch (err) { throw new Error(err?.name === "TimeoutError" ? "timeout" : "network"); }
    const body = await res.json().catch(() => ({}));
    if (res.status === 402) { loadMe(); throw new Error("paywall"); }
    if (!res.ok) throw new Error(body.error in AI_ERRORS ? body.error : "ai");
    if (diag !== dg) return;
    dg.res = body;
    dg.state = "done";
    if (body.causes?.length) track("plant_diagnose");
    loadMe();
    diagSheet();
  } catch (err) {
    if (diag !== dg) return;
    if (err.message === "paywall") { dg.state = "idle"; diagSheet(); return premiumSheet("diagnose"); }
    dg.state = "error";
    dg.error = aiErrorText(err.message);
    diagSheet();
  }
}

// «Qué planto aquí»: the AI proposes plants for one of the user's zones or for a site they describe
// (Worker /suggest). Each pick opens in Explorar, which already knows how to judge and add it.
const SG_PREFS = [["facil", "Fácil de cuidar"], ["flores", "Con flores"], ["poca_agua", "Poca agua"], ["comestible", "Comestible"], ["mascotas", "Segura para mascotas"], ["perenne", "Hoja perenne"]];
let suggest = null; // { zone: name | null (= otro sitio), siteSun, siteDesc, prefs: [], note, state: "idle" | "loading" | "done" | "error", res, error }
function suggestOpen(zone) {
  const zones = allZones();
  suggest = { zone: zone && zones.includes(zone) ? zone : zone === "" ? null : zones[0] ?? null, siteSun: "", siteDesc: "", prefs: [], note: "", state: "idle" };
  if (zone === undefined && !zones.length) suggest.zone = null;
  suggestSheet();
}
function suggestRead() { // keep what is typed before the sheet redraws
  if (!suggest) return;
  if ($("sgDesc")) suggest.siteDesc = $("sgDesc").value;
  if ($("sgNote")) suggest.note = $("sgNote").value;
}
function suggestSiteName() { return suggest.zone ?? "Otro sitio"; }
function suggestSheet() {
  const sg = suggest;
  const head = `<div class="sheet-head"><h2>Qué planto aquí</h2><button class="btn small secondary" data-action="close">Cerrar</button></div>`;
  if (!sg) return;
  if (sg.state === "loading") return openSheet(`${head}<div class="ai-step"><span class="spinner" aria-hidden="true"></span>Buscando plantas para ${esc(suggestSiteName())}…</div>`, "suggest");
  if (sg.state === "done") {
    const picks = sg.res.picks;
    return openSheet(`${head}
      <p class="sub-line">Para «${esc(suggestSiteName())}»${sg.prefs.length ? ` · ${esc(sg.prefs.map((p) => SG_PREFS.find((x) => x[0] === p)?.[1]).filter(Boolean).join(" · ").toLowerCase())}` : ""}</p>
      ${sg.res.summary ? `<p class="muted">${esc(sg.res.summary)}</p>` : ""}
      <section class="card">${picks.map((p, i) => `<button type="button" class="sg-row" data-action="sg-open" data-i="${i}">
        <span class="sg-ph">${p.photo?.url ? `<img src="${esc(p.photo.url)}" alt="" />` : ICONS.sprout}</span>
        <span class="sg-body"><span class="verdict-dot ${p.fit === "bien" ? "good" : "mid"}">${p.fit === "bien" ? "Encaja bien" : "Con reservas"}</span>
          <b>${esc(p.commonName)}</b><i>${esc(p.species)}</i><span class="sg-why">${esc(p.why)}</span>
          <span class="sg-tags"><span>${esc(SUN_NEED_LABEL[p.sunNeed] ?? "")}</span><span>riego cada ${Number(p.waterDays)} d.</span><span>${esc(SIZE_FINAL[p.size] ?? "")}</span></span></span>
        <span class="chev">${ICONS.chevron}</span></button>`).join("") || `<p class="muted small">La IA no ha propuesto nada esta vez. Cambia la búsqueda y prueba otra vez.</p>`}</section>
      <p class="muted small">Toca una para abrirla en Explorar. Es una estimación de la IA, no una garantía.</p>
      <button type="button" class="btn block secondary" data-action="sg-back">Cambiar la búsqueda</button>`, "suggest");
  }
  const zones = allZones();
  const zoneCard = (name) => {
    const i = zoneInfo()[name] ?? {};
    const bits = [SUN_LABEL[zoneSun()[name]] ?? "", i.every ? `riego cada ${i.every} ${i.every === 1 ? "día" : "días"}` : "", i.desc ? `«${i.desc.length > 70 ? `${i.desc.slice(0, 70)}…` : i.desc}»` : ""].filter(Boolean).join(" · ");
    return `<button type="button" class="sg-zone ${sg.zone === name ? "on" : ""}" data-action="sg-zone" data-zone="${esc(name)}" aria-pressed="${sg.zone === name}"><b>${esc(name)}</b>${bits ? `<small>${esc(bits)}</small>` : ""}</button>`;
  };
  openSheet(`${head}
    <p class="muted small">La IA propone plantas que encajen con el sol, el riego y lo que hayas escrito del sitio.</p>
    <div class="group-title">¿Dónde?</div>
    ${zones.map(zoneCard).join("")}
    <button type="button" class="sg-zone ${sg.zone === null ? "on" : ""}" data-action="sg-zone" data-zone="" data-other="1" aria-pressed="${sg.zone === null}"><b>Otro sitio…</b><small>Un pasillo, una terraza, una ventana…</small></button>
    ${sg.zone === null ? `<div class="seg" role="radiogroup" aria-label="Luz del sitio">${[["sun", "Sol"], ["partial", "Media sombra"], ["shade", "Sombra"]].map(([v, t]) => `<button type="button" role="radio" aria-checked="${sg.siteSun === v}" data-action="sg-sun" data-sun="${v}">${t}</button>`).join("")}</div>
      <textarea id="sgDesc" maxlength="300" rows="3" class="big-input" placeholder="Cómo es el sitio: luz, viento, si es maceta o suelo…">${esc(sg.siteDesc)}</textarea>` : ""}
    <div class="group-title">Qué busco <span class="muted">(opcional)</span></div>
    <div class="chips">${SG_PREFS.map(([k, t]) => `<button type="button" class="chip ${sg.prefs.includes(k) ? "on" : ""}" data-action="sg-pref" data-p="${k}" aria-pressed="${sg.prefs.includes(k)}">${t}</button>`).join("")}</div>
    <input id="sgNote" maxlength="120" class="big-input" placeholder="Algo más: «que no pase de 1 m»…" value="${esc(sg.note)}" />
    <p class="muted small">No escribas datos personales: el texto se envía a la IA.</p>
    ${sg.state === "error" ? `<p class="ai-status warn">${esc(sg.error)}</p>` : ""}
    <button type="button" class="btn block" data-action="sg-go" ${aiOff() ? "disabled" : ""}>✦ Proponer plantas</button>
    ${aiOff() ? `<p class="muted small">La IA está apagada en este móvil (Ajustes → Asistente IA).</p>` : ""}`, "suggest");
}
async function suggestGo() {
  suggestRead();
  const sg = suggest;
  if (!sg) return;
  if (sg.zone === null && !sg.siteSun && !sg.siteDesc.trim()) { sg.state = "error"; sg.error = "Elige una zona o describe el sitio (luz o cómo es)."; return suggestSheet(); }
  sg.state = "loading";
  suggestSheet();
  try {
    if (aiOff()) throw new Error("off");
    if (aiOpen === false && !aiCode()) throw new Error("code");
    const loc = here();
    const info = sg.zone !== null ? zoneInfo()[sg.zone] ?? {} : {};
    const site = sg.zone !== null ? { name: sg.zone, sun: zoneSun()[sg.zone] ?? "", every: info.every ?? 0, mins: info.mins ?? 0, desc: info.desc ?? "" } : { name: "", sun: sg.siteSun, every: 0, mins: 0, desc: sg.siteDesc.trim() };
    const owned = [...new Set(state.data.plants.map((p) => p.species || p.name).filter(Boolean))];
    let res;
    try {
      res = await fetch(`${API}/suggest`, { method: "POST", signal: AbortSignal.timeout(50000), headers: aiHeaders(), body: JSON.stringify({ site, prefs: sg.prefs, note: sg.note.trim(), owned, place: loc.name, lat: loc.lat, lon: loc.lon }) });
    } catch (err) { throw new Error(err?.name === "TimeoutError" ? "timeout" : "network"); }
    const body = await res.json().catch(() => ({}));
    if (res.status === 402) throw Object.assign(new Error("paywall"), { feature: body.feature || "suggest" });
    if (!res.ok) throw new Error(body.error in AI_ERRORS ? body.error : "ai");
    if (suggest !== sg) return;
    sg.res = body;
    sg.state = "done";
    suggestSheet();
    body.picks.forEach((p) => refPhoto(p.species).then((ph) => { if (ph && suggest === sg && sg.state === "done") { p.photo = ph; if ($("sheet").open && sheet.dataset.view === "suggest") suggestSheet(); } }));
  } catch (err) {
    if (suggest !== sg) return;
    if (err.message === "paywall") { sg.state = "idle"; suggestSheet(); return premiumSheet("suggest"); }
    sg.state = "error";
    sg.error = aiErrorText(err.message);
    suggestSheet();
  }
}

// «¿Dónde está mejor?»: the AI judges a plant against each of the user's zones (sun, programmed
// irrigation and the description they wrote) and may suggest moving it with the seasons (Worker /place).
const allZones = () => [...new Set([...state.data.plants.map((p) => p.zone || ""), ...Object.keys(zoneSun()), ...Object.keys(zoneInfo())])].filter(Boolean).sort((a, b) => a.localeCompare(b, "es"));
const zonePayload = () => allZones().map((name) => ({ name, sun: zoneSun()[name] ?? "", every: zoneInfo()[name]?.every ?? 0, mins: zoneInfo()[name]?.mins ?? 0, desc: zoneInfo()[name]?.desc ?? "" }));
async function requestPlace({ name, species, needs, current }) {
  if (aiOff()) throw new Error("off");
  if (aiOpen === false && !aiCode()) throw new Error("code");
  const loc = here();
  let res;
  try {
    res = await fetch(`${API}/place`, { method: "POST", signal: AbortSignal.timeout(50000), headers: aiHeaders(), body: JSON.stringify({ name, species, needs, current, zones: zonePayload(), place: loc.name, lat: loc.lat, lon: loc.lon }) });
  } catch (err) { throw new Error(err?.name === "TimeoutError" ? "timeout" : "network"); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error in AI_ERRORS ? body.error : "ai");
  return body;
}
const FIT_LV = { bien: ["check", "ok"], reservas: ["alert", "warn"], mal: ["x", "no"] };
// The answer as rows: where it fits, the best zone and any seasonal move. `current` marks the zone it is in.
function placeAdviceHtml(a, current = "") {
  if (!a?.zones?.length) return "";
  const row = (icon, title, text, level) => `<div class="fit-row"><span class="fit-ic ${level}">${ICONS[icon]}</span><div><b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ""}</div></div>`;
  return `${a.summary ? `<p class="muted">${esc(a.summary)}</p>` : ""}
    ${a.zones.map((z) => { const [ic, lv] = FIT_LV[z.fit] ?? FIT_LV.reservas; return row(ic, `${z.name}${z.name === current ? " · está aquí" : ""}`, z.note, lv); }).join("")}
    ${a.best && a.best !== current ? row("pin", `Mejor en ${a.best}`, a.bestWhy, "info") : ""}
    ${(a.seasonal ?? []).map((x) => row("refresh", `${SEASON_LABEL[x.season] ?? x.season}: llévala a ${x.zone}`, x.why, "info")).join("")}`;
}
const zonesDescribed = () => Object.values(zoneInfo()).some((i) => i?.desc);
const placeNudge = () => (zonesDescribed() ? "" : `<p class="muted small">Cuanto mejor describas tus zonas (Ajustes → Zonas), más acertado el consejo.</p>`);
async function askExplorePlace() {
  const e = explore;
  if (!e?.care || e.place?.running) return;
  const care = e.care;
  const season = seasonOf(localToday(), here().lat);
  e.place = { running: true };
  exploreSheet();
  try {
    const needs = { sunNeed: care.sunNeed, sunSensitive: Boolean(care.sunSensitive), minTemp: care.minTemp ?? null, frostSensitive: Boolean(care.frostSensitive), windSensitive: Boolean(care.windSensitive), waterDays: care.seasons?.[season]?.water ?? 0, inPot: care.plantIn === "maceta" ? true : care.plantIn === "suelo" ? false : null };
    e.place = await requestPlace({ name: care.commonName || e.name, species: care.species ?? "", needs, current: "" });
  } catch (err) { e.place = { error: aiErrorText(err.message) }; }
  if (explore === e && $("sheet").open) {
    exploreSheet();
    requestAnimationFrame(() => document.querySelector(".place-ai")?.scrollIntoView({ block: "center" }));
  }
}
let plantPlace = null; // { id, running, ok, at, text }
async function askPlantPlace(id) {
  const p = plantById(id);
  if (!p || plantPlace?.running) return;
  const redraw = () => { if ($("sheet").open && sheet.dataset.plant === id) plantSheet(id); };
  plantPlace = { id, running: true, text: "Consultando a la IA…" };
  redraw();
  try {
    const season = seasonOf(localToday(), here().lat);
    const needs = { sunNeed: p.sunNeed, sunSensitive: Boolean(p.sunSensitive), minTemp: p.minTemp ?? null, frostSensitive: Boolean(p.frostSensitive), windSensitive: Boolean(p.info?.windSensitive), waterDays: intervalFor(p, "water", season) ?? 0, inPot: p.inPot ?? null };
    const res = await requestPlace({ name: p.name, species: p.species ?? "", needs, current: p.zone || "" });
    p.placeAdvice = { at: localToday(), zone: p.zone || "", zones: res.zones, best: res.best, bestWhy: res.bestWhy, seasonal: res.seasonal, summary: res.summary };
    save();
    plantPlace = null;
    plantUi.open.add("place"); // open the answer and bring it into view: it lands below the buttons
    redraw();
    requestAnimationFrame(() => {
      const el = document.querySelector('.pf[data-k="place"]');
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      el.classList.add("pf-flash");
      setTimeout(() => el.classList.remove("pf-flash"), 1800);
    });
    return;
  } catch (err) {
    plantPlace = { id, ok: false, at: Date.now(), text: aiErrorText(err.message) };
  }
  redraw();
}

// «Actualizar con la IA» in a plant's sheet: asks again for this one plant and refreshes what came from
// the AI (seasonal tips, fertiliser types, «Sobre la planta», calendar). Watering and feeding figures and
// notes are replaced only where they still are the AI's own; anything the person edited is kept.
let plantRefresh = null; // { id, running, ok, text }
async function refreshPlantAi(id) {
  const plant = plantById(id);
  if (!plant || plantRefresh?.running) return;
  const redraw = () => { if ($("sheet").open && sheet.dataset.plant === id) plantSheet(id); };
  plantRefresh = { id, running: true, text: "Consultando a la IA…" };
  redraw();
  try {
    const care = await requestCare(plant.name, "refresh");
    const wasAi = (key) => !plant.ai || isAiValue(plant, key);
    if (!plant.species || wasAi("species")) plant.species = care.species || plant.species;
    for (const k of SEASONS) {
      for (const kind of ["water", "feed"]) if (wasAi(`${k}.${kind}`) || !plant.seasons) { plant.seasons ??= {}; plant.seasons[k] = { ...(plant.seasons[k] ?? {}), [kind]: care.seasons[k][kind] }; }
    }
    if (!plant.notes?.trim() || wasAi("notes")) plant.notes = care.notes;
    plant.tips = care.tips;
    plant.feedTypes = care.feedTypes;
    plant.info = infoFields(care);
    const sun = sunFields(care);
    if (!plant.sunNeed) { plant.sunNeed = sun.sunNeed; plant.sunSensitive = sun.sunSensitive; }
    if (plant.minTemp == null) plant.minTemp = sun.minTemp;
    plant.ai = aiSnapshot(care);
    withCurrentIntervals(plant);
    try {
      const cal = await requestCalendar(plant.name, plant.species);
      applyCalendar(plant, cal);
    } catch (err) {
      if (err.message === "code" || err.message === "limit") throw err;
    }
    plant.careVersion = CARE_VERSION;
    save();
    plantRefresh = { id, ok: true, at: Date.now(), text: "Ficha actualizada." };
  } catch (err) {
    plantRefresh = { id, ok: false, at: Date.now(), text: aiErrorText(err.message) };
  }
  render();
  redraw();
}

let draftPhoto = null;
function plantForm(id) {
  formDirty = false;
  const p = id ? plantById(id) : { name: "", species: "", zone: "", seasons: DEFAULT_SEASONS, rainReaches: true, inPot: true, frostSensitive: false, notes: "" };
  draftPhoto = p.photo ?? null;
  const zones = [...new Set(state.data.plants.map((x) => x.zone).filter(Boolean))];
  openSheet(`
    <div class="sheet-head"><h2>${id ? "Editar planta" : "Nueva planta"}</h2><button class="btn small secondary" data-action="${id ? "open-plant" : "close"}" data-id="${id ?? ""}">Cancelar</button></div>
    <form id="plantForm" class="sheet-in" style="padding:0">
      <section class="card ai-card edit-card ${p.ai ? "ai-halo done" : ""}" id="editCard">
        <label class="thumb-pick" aria-label="Cambiar foto"><span class="cam">${ICONS.camera}</span><span id="photoPreview">${draftPhoto ? `<img class="thumb" src="${draftPhoto}" alt="" />` : `<span class="thumb placeholder">${ICONS.sprout}</span>`}</span><input type="file" id="photoInput" accept="image/*" hidden /></label>
        <div class="body">
          <input name="name" class="name-input" required placeholder="Tipo de planta" value="${esc(p.name)}" aria-label="Tipo de planta" />
          <input name="nick" class="nick-input" placeholder="Nombre propio (opcional)" value="${esc(p.nick ?? "")}" aria-label="Nombre propio" />
          <input name="species" class="species-input" placeholder="Especie (opcional)" value="${esc(p.species)}" aria-label="Especie" />
          <span id="editAiLine">${p.ai ? `<span class="ai-pill">✦ ${p.ai.retro ? "Revisado con" : "Propuesto por"} la IA el ${fmtDate(p.ai.at)}${p.ai.time ? ` a las ${p.ai.time}` : ""}</span>` : ""}</span>
        </div>
      </section>
      <button type="button" class="btn secondary ai-btn" data-action="ai-fill">${p.ai ? "✦ Volver a consultar a la IA" : "✦ Rellenar con IA"}</button>
      <p class="ai-status" id="aiStatus" hidden></p>
      <h3 class="q">¿Dónde está?</h3>
      <div class="chips" id="zoneChips">
        ${zones.map((z) => `<button type="button" class="chip ${z === p.zone ? "on" : ""}" data-action="edit-zone" data-zone="${esc(z)}">${esc(z)}</button>`).join("")}
        <button type="button" class="chip" data-action="edit-new-zone">+ Nueva zona</button>
      </div>
      <input name="zone" id="editZone" class="big-input" placeholder="Terraza sur, jardín delantero…" autocomplete="off" value="${esc(p.zone)}" hidden />
      <h3 class="q">Tu sitio <span class="muted small">(lo ves tú)</span></h3>
      ${radioSeg("inPot", "Plantada en", p.inPot, [[true, "pot", "Maceta"], [false, "ground", "Suelo"]])}
      ${radioSeg("rainReaches", "La lluvia", p.rainReaches, [[true, "rain", "Le llega"], [false, "umbrella", "A cubierto"]])}
      ${radioSeg("sun", "Sol que recibe", p.sun ?? "", SUN_CHOICES, "El sol que le da el sitio donde está.")}
      ${radioSeg("size", "Tamaño que tiene ahora", p.size ?? "", SIZE_CHOICES, SIZE_HINT)}
      <h3 class="q">Sobre esta planta ${p.ai ? `<span class="ai-pill sp-pill">✦ propuesto por la IA</span>` : ""}</h3>
      <section class="card sp-card ${p.sunNeed || p.sunSensitive || p.frostSensitive || p.ai ? "" : "empty"}" id="speciesCard">
        <div class="sp-view">
          <div id="spFacts">${speciesFacts(p)}</div>
          <p class="muted small">No hace falta tocarlo. Si no lo sabes, déjalo así.</p>
          <button type="button" class="btn small secondary" data-action="sp-toggle">Cambiar</button>
        </div>
        <div class="sp-empty">
          <b>Aún no sabemos qué luz le gusta ni si aguanta el frío.</b>
          <p class="muted small">La IA lo propone en unos segundos; tú solo lo revisas si quieres.</p>
          <button type="button" class="btn small sp-ai-btn" data-action="ai-fill">✦ Rellenar con IA</button>
          <p class="muted small">¿Prefieres ponerlo tú? <button type="button" class="link-btn" data-action="sp-toggle">Rellenar a mano</button></p>
        </div>
        <div class="sp-edit">
          ${radioSeg("sunNeed", "¿Cuánta luz le gusta?", p.sunNeed ?? "", SUN_NEED_CHOICES, LIGHT_HINT)}
          <label class="switch-row">
            <span>${ICONS.sun}<span>Se le queman las hojas con el sol fuerte<small class="sub">${SP_SUN_SUB}</small></span></span>
            <input type="checkbox" role="switch" name="sunSensitive" class="switch-input" ${p.sunSensitive ? "checked" : ""} />
            <span class="switch" aria-hidden="true"></span>
          </label>
          <label class="switch-row">
            <span>${ICONS.snow}<span>Sensible a las heladas<small class="sub">${SP_FROST_SUB}</small></span></span>
            <input type="checkbox" role="switch" name="frostSensitive" class="switch-input" ${p.frostSensitive ? "checked" : ""} />
            <span class="switch" aria-hidden="true"></span>
          </label>
          <button type="button" class="btn small secondary sp-done" data-action="sp-toggle">Hecho</button>
        </div>
      </section>
      <label class="switch-row">
        <span>${ICONS.drip}Riego automático</span>
        <input type="checkbox" role="switch" name="autoWater" class="switch-input" ${p.autoWater ? "checked" : ""} />
        <span class="switch" aria-hidden="true"></span>
      </label>
      <section class="card care-block">
        <h3>Cuidados${p.ai ? ` propuestos <span class="ai-mark">✦</span>` : ""}</h3>
        ${seasonTable(p.seasons ?? legacySeasons(p), { form: true, aiCells: aiCellsOf(p) })}
        <div id="tipsBox">${tipsList(p.tips)}</div>
        <label class="field">Notas${aiMark(isAiValue(p, "notes"))}<textarea name="notes" class="autogrow" rows="6" placeholder="Comprada en marzo, le gusta el sol de mañana…">${esc(p.notes)}</textarea></label>
      </section>
      ${id ? `<button type="button" class="btn danger block delete-plant" data-action="del-plant" data-id="${id}">Eliminar planta</button>` : ""}
      <div class="sheet-actions"><button class="btn block" type="submit">${id ? "Guardar cambios" : "Guardar"}</button></div>
    </form>`);
  $("plantForm").dataset.id = id ?? "";
  $("plantForm").dataset.hasAi = p.ai ? "1" : "";
  autogrow($("plantForm").elements.notes);
}

// Same segmented look as the new-plant step 2, but with real radio inputs so the edit form
// reads them through FormData without redrawing.
// Redraws the summary of «Sobre esta planta» from the form's inputs (after «Hecho» or after the AI filled the form).
function refreshSpeciesCard() {
  const form = $("plantForm"), card = $("speciesCard");
  if (!form || !card) return;
  const sunNeed = form.querySelector('input[name="sunNeed"]:checked')?.value ?? "";
  const sunSensitive = Boolean(form.elements.sunSensitive?.checked), frostSensitive = Boolean(form.elements.frostSensitive?.checked);
  $("spFacts").innerHTML = speciesFacts({ sunNeed, sunSensitive, frostSensitive });
  card.classList.toggle("empty", !(sunNeed || sunSensitive || frostSensitive || form.dataset.hasAi || form.dataset.aiFilled));
}
function radioSeg(name, label, current, options, hint = "") {
  return `
    <div class="seg-label" id="eseg-${name}">${label}</div>
    <div class="seg" role="radiogroup" aria-labelledby="eseg-${name}">
      ${options.map(([value, icon, text]) => `<label><input type="radio" name="${name}" value="${value}" ${current === value ? "checked" : ""} />${ICONS[icon] ?? ""}${text}</label>`).join("")}
    </div>${hint ? `<div class="seg-hint">${hint}</div>` : ""}`;
}

// waterEvery/feedEvery mirror today's season so exports and older readers stay meaningful.
function withCurrentIntervals(plant) {
  const now = seasonOf(localToday(), here().lat);
  plant.waterEvery = plant.seasons[now].water;
  plant.feedEvery = plant.seasons[now].feed;
  return plant;
}

// Water/feed interval for each season, today's highlighted. In the edit form the inputs are
// named s-<season>-<water|feed> (read through FormData); in the new-plant step they carry
// data-season/data-kind and update the draft as you type.
const DEFAULT_SEASONS = { spring: { water: 4, feed: 30 }, summer: { water: 2, feed: 30 }, autumn: { water: 5, feed: 0 }, winter: { water: 10, feed: 0 } };
const SEASON_ICON = { spring: "sprout", summer: "sun", autumn: "leaf", winter: "snow" };

// `aiCells` holds "season.kind" keys proposed by the AI and not changed since: they carry a ✦.
function seasonTable(seasons, { form = false, busy = false, aiCells = new Set() } = {}) {
  const now = seasonOf(localToday(), here().lat);
  const cell = (k, kind, value) => {
    const attrs = form ? `name="s-${k}-${kind}"` : `data-season="${k}" data-kind="${kind}"`;
    const shown = busy ? "" : Number(value) || "";
    const cls = [busy ? "skel" : "", aiCells.has(`${k}.${kind}`) ? "ai" : ""].join(" ");
    return `<label class="st-cell ${cls}"><input type="number" ${attrs} min="${kind === "water" ? 1 : 0}" max="${kind === "water" ? 60 : 365}" inputmode="numeric" value="${shown}" placeholder="${busy ? "" : kind === "feed" ? "No" : ""}" aria-label="${kind === "water" ? "Regar" : "Abonar"} en ${SEASON_LABEL[k].toLowerCase()}, días" ${busy ? "disabled" : ""} /><span>d</span></label>`;
  };
  return `
    <div class="season-table ${aiCells.size ? "has-ai" : ""}">
      <span></span><span class="st-h">Regar cada</span><span class="st-h">Abonar cada</span>
      ${SEASONS.map((k) => `
        <span class="st-name ${k === now ? "now" : ""}">${ICONS[SEASON_ICON[k]]}${SEASON_LABEL[k]}</span>
        ${cell(k, "water", seasons[k].water)}${cell(k, "feed", seasons[k].feed)}`).join("")}
    </div>
    <p class="st-legend"><span class="ai-mark">✦</span> Propuesto por la IA <span class="now-box"></span> Estación actual</p>
    <p class="muted small">Cambia solo con la estación (ahora, ${SEASON_LABEL[now].toLowerCase()}) en ${esc(here().name)}. Abono vacío = no abonar esa estación.</p>`;
}
const ALL_CELLS = SEASONS.flatMap((k) => [`${k}.water`, `${k}.feed`]);

// ---------- AI provenance ----------
// A plant keeps what the AI proposed: { at, from, values: { "spring.water": 4, …, species, notes, frostSensitive } }.
// A field counts as the AI's while its value is still the proposed one; once changed, it's the user's.
function aiSnapshot(care, from) {
  const values = { species: care.species, notes: care.notes, frostSensitive: care.frostSensitive };
  for (const k of SEASONS) { values[`${k}.water`] = care.seasons[k].water; values[`${k}.feed`] = care.seasons[k].feed; }
  return { at: localToday(), time: new Date().toTimeString().slice(0, 5), from: from ?? `${care.commonName} (${care.species})`, values };
}
function fieldValue(plant, key) {
  const [season, kind] = key.split(".");
  return kind ? plant.seasons?.[season]?.[kind] : plant[key];
}
const isAiValue = (plant, key) => Boolean(plant.ai) && key in plant.ai.values && plant.ai.values[key] === fieldValue(plant, key);
const aiCellsOf = (plant) => new Set(ALL_CELLS.filter((c) => isAiValue(plant, c)));
const aiMark = (on) => (on ? ` <span class="ai-mark" title="Propuesto por la IA">✦</span>` : "");

// The four seasonal tips from the AI, today's season first.
function tipsList(tips) {
  if (!tips) return "";
  const now = seasonOf(localToday(), here().lat);
  const order = SEASONS.slice(SEASONS.indexOf(now)).concat(SEASONS.slice(0, SEASONS.indexOf(now)));
  return `<div class="tips"><div class="tips-title">Consejos por estación <span class="ai-mark">✦</span></div>${order.filter((k) => tips[k]).map((k) =>
    `<div class="tip ${k === now ? "now" : ""}">${ICONS[SEASON_ICON[k]]}<div><b>${SEASON_LABEL[k]}</b>${esc(tips[k])}</div></div>`).join("")}</div>`;
}

const legacySeasons = (p) => Object.fromEntries(SEASONS.map((k) => [k, { water: p.waterEvery || 3, feed: p.feedEvery || 0 }]));
const readSeasonTable = (f) => Object.fromEntries(SEASONS.map((k) => [k, {
  water: Math.min(60, Math.max(1, parseInt(f.get(`s-${k}-water`), 10) || 1)),
  feed: Math.min(365, Math.max(0, parseInt(f.get(`s-${k}-feed`), 10) || 0)),
}]));

// Notes box grows with its text so a whole paragraph is readable without scrolling inside it.
function autogrow(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + 2}px`;
}

// Photos are shrunk to 640px JPEG so dozens of plants fit in localStorage.
function shrinkPhoto(file, max = 640) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function placeSheet() {
  openSheet(`
    <div class="sheet-head"><h2>Ubicación</h2><button class="btn small secondary" data-action="close">Cerrar</button></div>
    <button class="btn block" data-action="locate">📍 Usar mi ubicación</button>
    <label class="field">O busca tu ciudad, barrio o código postal<input id="placeQuery" type="search" placeholder="Valencia, Pedregalejo, 29001…" autocomplete="off" /></label>
    <div class="results" id="placeResults"></div>
    <details class="pf-plain"><summary>Escribir las coordenadas exactas</summary>
      <label class="field">Latitud y longitud<input id="placeCoords" type="text" inputmode="text" placeholder="36.7213, -4.4214" autocomplete="off" autocapitalize="off" spellcheck="false" /></label>
      <p class="muted small">Cópialas de Google Maps o Apple Maps: mantén pulsado el punto de tu jardín y copia los dos números.</p>
      <label class="field">Nombre del sitio (opcional)<input id="placeCoordName" type="text" maxlength="40" placeholder="Mi jardín" autocomplete="off" /></label>
      <p class="ai-status warn" id="placeCoordsErr" hidden></p>
      <button type="button" class="btn block secondary" data-action="coords-save">Usar estas coordenadas</button>
    </details>`);
  let timer;
  $("placeQuery").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const results = await searchCities(e.target.value).catch(() => []);
      $("placeResults").innerHTML = results.length
        ? results.map((r, i) => `<button data-action="pick-place" data-i="${i}">${esc(r.name)} <small>${esc([r.admin, r.country].filter(Boolean).join(", "))}</small></button>`).join("")
        : e.target.value.trim() ? `<p class="muted">Sin resultados</p>` : "";
      $("placeResults").dataset.results = JSON.stringify(results);
    }, 300);
  });
  $("placeQuery").focus();
}

function setLoc(loc) {
  state.loc = loc;
  store.set("mj_loc", loc);
  if (store.get("mj_push", false)) subscribePush().catch(() => {});
  closeSheet();
  loadWeather();
}

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- AI fill ----------
// Asks the backend for this plant's care sheet (for the current place and month) and fills the
// form. Nothing is saved until the user reviews it and taps Guardar.
const AI_ERRORS = {
  paywall: "Has llegado al límite gratuito de este mes. Con Premium tienes más.",
  fair_use: "Has llegado al uso razonable de este mes. Se renueva el día 1.",
  off: "La IA está apagada. Puedes volver a encenderla en Ajustes → Asistente IA.",
  code: "Código de acceso incorrecto o sin poner: revísalo en Ajustes.",
  limit: "Se ha alcanzado el límite de hoy. Rellénalo a mano o prueba mañana.",
  quota: "La IA está saturada o ha llegado a su límite por hoy. Prueba dentro de un rato o mañana, o rellénalo a mano: tus plantas no se pierden.",
  not_plant: "No parece el nombre de una planta. Si es un apodo, prueba con su nombre común (por ejemplo «poto»), o rellena los cuidados a mano.",
};

// "¿No es esta? También podría ser: …" — each button asks for that plant instead.
const altButtons = (alts, action) => alts?.length
  ? `<div class="ai-alts"><span>¿No es esta? También podría ser:</span>${alts.map((a, i) =>
      `<button type="button" class="chip" data-action="${action}" data-i="${i}">${esc(a.commonName)} <em>${esc(a.species)}</em></button>`).join("")}</div>`
  : "";
const altQuery = (a) => `${a.commonName} (${a.species})`;

// Whether the AI can be used: the Worker may run without the access code (REQUIRE_CODE = "off"),
// which /health reports; otherwise a saved code is needed. Unknown until /health answers.
let aiOpen = null;
const aiCode = () => store.get("mj_ai_code", "");
const aiOff = () => store.get("mj_ai_off", false) === true;
const hasAI = () => !aiOff() && (aiOpen === true || Boolean(aiCode()));
// True when a lookup can be tried: AI not switched off here, and either open, with a code, or not known yet.
const aiGo = () => !aiOff() && (hasAI() || aiOpen === null);
const aiHeaders = () => ({ "Content-Type": "application/json", ...(aiCode() ? { "X-Access-Code": aiCode() } : {}), ...(usageId ? { "X-Usage": usageId } : {}), ...(syncKey() ? { "X-Key": syncKey() } : {}), "X-Device": deviceId });
// Anonymous id for the Worker's usage counters: a hash of the garden key when synced, else of this
// device. It's hashed here with its own prefix, so the garden key itself is never sent with AI requests.
let usageId = null;
async function refreshUsageId() {
  const sha = async (text) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  const key = store.get("mj_sync", null)?.key;
  usageId = key ? `g:${await sha(`usage:${key}`)}` : `d:${await sha(`usage:${store.get("mj_device", "")}`)}`;
  // Short code of this person in the usage report (the Worker hashes the device id like this, and the garden id is used as is).
  const dev = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`mj:${store.get("mj_device", "")}`)))].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
  const code = (key ? usageId.slice(2) : dev).slice(0, 4).toUpperCase();
  if (code !== usageCode) { usageCode = code; if (typeof render === "function" && state?.data) render(); }
  if (typeof loadMe === "function") loadMe();
}
let usageCode = "";
fetch(`${API}/health`).then((r) => r.json()).then((h) => { aiOpen = h.code === false; render(); }).catch(() => {});

// Resolves to the care sheet, or throws an Error whose message is a key of AI_ERRORS
// ("code", "limit") or "timeout" / "network" / "ai".
async function requestCare(name, src = "") {
  if (aiOff()) throw new Error("off");
  if (aiOpen === false && !aiCode()) throw new Error("code");
  const loc = state.loc ?? DEFAULT_LOC;
  let res;
  try {
    res = await fetch(`${API}/care`, {
      method: "POST",
      signal: AbortSignal.timeout(50000),
      headers: aiHeaders(),
      body: JSON.stringify({ name, lat: loc.lat, lon: loc.lon, place: loc.name, src }),
    });
  } catch (err) {
    throw new Error(err?.name === "TimeoutError" ? "timeout" : "network");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error in AI_ERRORS ? body.error : "ai");
  return body;
}

// The year calendar comes from its own endpoint and is slower: asked in the background.
async function requestCalendar(name, species) {
  if (aiOff()) throw new Error("off");
  if (aiOpen === false && !aiCode()) throw new Error("code");
  const loc = state.loc ?? DEFAULT_LOC;
  let res;
  try {
    res = await fetch(`${API}/calendar`, {
      method: "POST",
      signal: AbortSignal.timeout(90000),
      headers: aiHeaders(),
      body: JSON.stringify({ name, species, lat: loc.lat, lon: loc.lon, place: loc.name }),
    });
  } catch (err) {
    throw new Error(err?.name === "TimeoutError" ? "timeout" : "network");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error in AI_ERRORS ? body.error : "ai");
  return body;
}

// After a plant is saved with the AI, its calendar arrives a few seconds later. Until then the
// plant shows «Preparando el calendario…»; on failure it stays in «Fichas por actualizar».
const calendarPending = new Set();
async function fetchCalendarFor(plantId) {
  const p = plantById(plantId);
  if (!p || calendarPending.has(plantId)) return;
  calendarPending.add(plantId);
  render(); if (sheet.open && sheet.dataset.plant === plantId) plantSheet(plantId);
  try {
    const cal = await requestCalendar(p.name, p.species);
    const plant = plantById(plantId);
    if (plant) { applyCalendar(plant, cal); plant.careVersion = CARE_VERSION; save(); }
  } catch { /* stays pending in «Fichas por actualizar» */ }
  calendarPending.delete(plantId);
  render(); if (sheet.open && sheet.dataset.plant === plantId) plantSheet(plantId);
}

const aiErrorText = (key) => AI_ERRORS[key] ?? {
  timeout: "El asistente está tardando demasiado. Vuelve a intentarlo en un rato o rellénalo a mano.",
  network: "Sin conexión con el asistente. Rellénalo a mano.",
}[key] ?? "El asistente no está disponible ahora. Rellénalo a mano.";

// `query` is set when the user picked one of the alternatives; otherwise the plant's name is asked.
async function aiFill(query) {
  const form = $("plantForm");
  const status = $("aiStatus");
  const show = (text, kind = "", extra = "") => { status.hidden = false; status.className = `ai-status ${kind}`; status.innerHTML = esc(text) + extra; };
  const name = form.elements.name.value.trim();
  if (!name) { form.elements.name.focus(); return show("Escribe primero el nombre de la planta.", "warn"); }
  if (aiOff()) return show(AI_ERRORS.off, "warn");
  if (!hasAI()) return show(AI_ERRORS.code, "warn");

  const btn = form.querySelector('[data-action="ai-fill"]');
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> Consultando a la IA…`;
  show(`Buscando los cuidados de «${name}». Tarda unos segundos.`, "ai");
  const loc = state.loc ?? DEFAULT_LOC;
  const cells = [...form.querySelectorAll(".st-cell")];
  cells.forEach((c) => { c.classList.add("skel"); c.classList.remove("ai"); });
  const card = $("editCard");
  const hadHalo = card.classList.contains("ai-halo");
  card.classList.remove("done");
  card.classList.add("ai-halo", "loading");
  try {
    const care = await requestCare(query ?? name, "edit");
    const f = form.elements;
    f.species.value = care.species;
    for (const k of SEASONS) {
      f[`s-${k}-water`].value = care.seasons[k].water;
      f[`s-${k}-feed`].value = care.seasons[k].feed || "";
    }
    f.frostSensitive.checked = care.frostSensitive;
    const need = form.querySelector(`input[name="sunNeed"][value="${care.sunNeed}"]`);
    if (need) need.checked = true;
    if (f.sunSensitive) f.sunSensitive.checked = Boolean(care.sunSensitive);
    form.dataset.hasAi = "1";
    refreshSpeciesCard();
    // Replace the notes if they're empty or still the AI's previous text (e.g. for another plant).
    if (!f.notes.value.trim() || f.notes.value === form.dataset.aiNotes) f.notes.value = care.notes;
    form.dataset.aiNotes = care.notes;
    form.dataset.aiSnapshot = JSON.stringify(aiSnapshot(care));
    form.dataset.sunFields = JSON.stringify({ minTemp: care.minTemp ?? null });
    form.dataset.info = JSON.stringify(infoFields(care));
    form.dataset.tips = JSON.stringify(care.tips ?? null);
    form.dataset.feedTypes = JSON.stringify(care.feedTypes ?? null);
    $("tipsBox").innerHTML = tipsList(care.tips);
    form.dataset.alternatives = JSON.stringify(care.alternatives ?? []);
    formDirty = true;
    form.dataset.aiFilled = "1";
    track("ai_fill_edit");
    cells.forEach((c) => c.classList.add("ai"));
    form.querySelector(".season-table").classList.add("has-ai");
    card.classList.add("done");
    $("editAiLine").innerHTML = `<span class="ai-pill">✦ Rellenado con IA · revisa los datos</span>`;
    autogrow(f.notes);
    show(care.confidence === "baja"
      ? `⚠️ No está seguro de qué planta es «${name}». Revisa los datos o prueba con otro nombre.`
      : `✦ Rellenado con IA para ${care.commonName} (${care.species}) en ${loc.name}. Revisa los datos y guarda.`, care.confidence === "baja" ? "warn" : "ai",
      altButtons(care.alternatives, "edit-alt"));
  } catch (err) {
    show(aiErrorText(err.message), "warn");
  } finally {
    card.classList.remove("loading");
    if (!card.classList.contains("done") && !hadHalo) card.classList.remove("ai-halo");
    if (hadHalo) card.classList.add("done");
    cells.forEach((c) => c.classList.remove("skel"));
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    btn.innerHTML = label;
  }
}

// Line icons for controls: they take the text colour, so the selected state can tint them.
// (Emoji stay for content: forecast, task rows, plant placeholders.)
const svg = (d) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICONS = {
  droplet: svg('<path d="M7.5 19.4a7.2 7.2 0 0 0 9 0 6.5 6.5 0 0 0 1.6-8.5l-4.9-7.3a1.4 1.4 0 0 0-2.4 0l-4.9 7.3a6.5 6.5 0 0 0 1.6 8.5z"/>'),
  flask: svg('<path d="M9 3h6M10 9h4M10 3v6l-4 11a.7.7 0 0 0 .5 1h11a.7.7 0 0 0 .5-1l-4-11V3"/>'),
  check: svg('<path d="M5 12l5 5L20 7"/>'),
  circleCheck: svg('<circle cx="12" cy="12" r="9"/><path d="M9 12l2 2 4-4"/>'),
  pin: svg('<circle cx="12" cy="11" r="3"/><path d="M17.7 16.7l-4.3 4.2a2 2 0 0 1-2.8 0l-4.3-4.2a8 8 0 1 1 11.4 0z"/>'),
  cloud: svg('<path d="M7 18a4.6 4.4 0 0 1 0-9 5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7H7z"/>'),
  "cloud-rain": svg('<path d="M7 18a4.6 4.4 0 0 1 0-9 5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7"/><path d="M11 13v2m0 3v2m4-5v2m0 3v2"/>'),
  "cloud-storm": svg('<path d="M7 18a4.6 4.4 0 0 1 0-9 5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7h-1"/><path d="M13 14l-2 4h3l-2 4"/>'),
  "cloud-sun": svg('<path d="M9 3.5v1M4.3 5.3l.7.7M3 10h1M13.7 5.3l-.7.7"/><path d="M6 12.5a3.5 3.5 0 1 1 6.6-2"/><path d="M9.5 20a3.4 3.4 0 0 1 0-6.8 4 4 0 0 1 7.7 1.3h.6a2.8 2.8 0 0 1 0 5.5z"/>'),
  fog: svg('<path d="M5 5h3m4 0h9M3 10h11m4 0h1M5 15h5m4 0h7M3 20h9m4 0h3"/>'),
  wind: svg('<path d="M5 8h8.5a2.5 2.5 0 1 0-2.3-3.2M3 12h15.5a2.5 2.5 0 1 1-2.3 3.2M4 16h5.5a2.5 2.5 0 1 1-2.3 3.2"/>'),
  flame: svg('<path d="M12 11c2.3-3.3.2-7.8-1-9 0 3.4-2.2 5.3-3.7 6.7C5.9 10.1 5 12.3 5 14.3 5 18 8.1 21 12 21s7-3 7-6.7c0-1.7-1.2-4.4-2.3-5.6-2.1 3.4-3.3 3.4-4.7 2.3z"/>'),
  chart: svg('<path d="M3 3v18h18"/><path d="M7 16v-4M11 16V8M15 16v-6M19 16V5"/>'),
  database: svg('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>'),
  shovel: svg('<path d="M17 4l3 3M18.5 5.5L11 13M8.5 10.5l5 5-2.5 2.5a3.5 3.5 0 0 1-5 0l0 0a3.5 3.5 0 0 1 0-5z"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  x: svg('<path d="M18 6L6 18M6 6l12 12"/>'),
  scissors: svg('<circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="M8.6 8.6L19 19M8.6 15.4L19 5"/>'),
  bug: svg('<path d="M9 9V8a3 3 0 0 1 6 0v1"/><path d="M8 9h8a6 6 0 0 1 1 3v3a5 5 0 0 1-10 0v-3a6 6 0 0 1 1-3"/><path d="M3 13h4M17 13h4M12 20v-6M4 19l3.4-2M20 19l-3.4-2M4 7l3.8 2.8M20 7l-3.8 2.8"/>'),
  notes: svg('<path d="M5 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M9 7h6M9 11h6M9 15h4"/>'),
  calendar: svg('<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M16 3v4M8 3v4M4 11h16"/>'),
  listView: svg('<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>'),
  gridView: svg('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  sync: svg('<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>'),
  share: svg('<path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>'),
  bookmark: svg('<path d="M6 4h12v17l-6-4-6 4z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
  camera: svg('<path d="M5 7h1a2 2 0 0 0 2-2 1 1 0 0 1 1-1h6a1 1 0 0 1 1 1 2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2"/><circle cx="12" cy="13" r="3"/>'),
  bell: svg('<path d="M10 5a2 2 0 1 1 4 0 7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6"/><path d="M9 17v1a3 3 0 0 0 6 0v-1"/>'),
  download: svg('<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 11l5 5 5-5M12 4v12"/>'),
  upload: svg('<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 9l5-5 5 5M12 4v12"/>'),
  refresh: svg('<path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>'),
  alert: svg('<path d="M12 9v4M12 17h.01"/><path d="M10.4 3.9L2.6 17.5A1.8 1.8 0 0 0 4.1 20h15.8a1.8 1.8 0 0 0 1.5-2.5L13.6 3.9a1.8 1.8 0 0 0-3.2 0z"/>'),
  pot: svg('<path d="M5 10h14l-1.6 9.1a1 1 0 0 1-1 .9H7.6a1 1 0 0 1-1-.9z"/><path d="M12 10V6"/><path d="M12 6c0-2 1.5-3 3.5-3 0 2-1.5 3-3.5 3zM12 7.5C12 6 10.8 5 9 5c0 1.5 1.2 2.5 3 2.5z"/>'),
  ground: svg('<path d="M3 19h18M7 22h10"/><path d="M12 19v-8"/><path d="M12 11c0-3 2-5 5.5-5 0 3-2 5-5.5 5zM12 14c0-2.5-1.8-4-4.5-4 0 2.5 1.8 4 4.5 4z"/>'),
  rain: svg('<path d="M7 14.5A4 4 0 0 1 7.6 6.6 5.5 5.5 0 0 1 18 8.5a3 3 0 0 1-.5 6z"/><path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5"/>'),
  umbrella: svg('<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v6.5a2 2 0 0 0 4 0"/><path d="M12 3v.01"/>'),
  "snow": svg('<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5 12 6l2.5-1.5M9.5 19.5 12 18l2.5 1.5"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  leaf: svg('<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19l7-7"/>'),
  drip: svg('<path d="M4 20h16M12 20v-5"/><path d="M12 15s-4-2.2-4-5a4 4 0 0 1 8 0c0 2.8-4 5-4 5z"/>'),
  sprout: svg('<path d="M12 20v-8"/><path d="M12 12c0-3 2-5 5.5-5 0 3-2 5-5.5 5zM12 14c0-2.5-1.8-4-4.5-4 0 2.5 1.8 4 4.5 4z"/>'),
  sparkle: svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16v4M17 18h4"/>'),
};

// ---------- New plant: two steps ----------
// Step 1 asks what the plant is (and starts the AI lookup); step 2 asks where it lives, with big
// toggles pre-set from the last plant added. Editing an existing plant keeps the full form.
let wiz = null;
const PLACE_DEFAULTS = { zone: "", inPot: true, rainReaches: true };

function newPlantWizard() {
  if (plantLimitHit()) return premiumSheet("plants");
  draftPhoto = null;
  wiz = {
    step: 1, name: "", ai: "idle", aiError: "", care: null, touched: {},
    ...PLACE_DEFAULTS, ...store.get("mj_last_place", {}),
    species: "", seasons: structuredClone(DEFAULT_SEASONS), frostSensitive: false, notes: "", newZone: false, sun: "", size: "medium", sunNeed: "", sunSensitive: false,
  };
  wiz.autoWater = false;
  renderWizard();
}

// Reference photo of the species (iNaturalist, else Wikipedia), so the user can check the AI understood
// the right plant; shown in the alta and, while the plant has no photo of its own, in its sheet.
// Only freely licensed iNaturalist photos, credited. Cached per species on this device.
const REF_CACHE = "mj_ref_photos";
async function refPhoto(species) {
  const key = String(species ?? "").trim();
  if (!key) return null;
  const cache = store.get(REF_CACHE, {});
  if (key in cache) return cache[key];
  let found = null;
  try {
    const r = await fetch(`https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(key)}&per_page=5`, { signal: AbortSignal.timeout(8000) }).then((x) => x.json());
    const hit = (r.results ?? []).find((t) => t.default_photo?.license_code && t.default_photo.medium_url);
    if (hit) found = { url: hit.default_photo.medium_url, credit: `${hit.default_photo.attribution.replace(/^\(c\)\s*/, "").replace(/,.*$/, "")} · iNaturalist`, source: "inaturalist" };
  } catch {}
  if (!found) {
    for (const lang of ["es", "en"]) {
      try {
        const w = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(key.replace(/ /g, "_"))}`, { signal: AbortSignal.timeout(8000) }).then((x) => (x.ok ? x.json() : null));
        if (w?.thumbnail?.source) { found = { url: w.thumbnail.source, credit: "Wikipedia", source: "wikipedia" }; break; }
      } catch {}
    }
  }
  store.set(REF_CACHE, { ...store.get(REF_CACHE, {}), [key]: found });
  return found;
}
// Plants saved before this (or by hand) get their reference photo the first time their sheet opens.
function ensureRefPhoto(p) {
  if (p.photo || !p.species || p.refPhoto !== undefined) return;
  p.refPhoto = null;
  refPhoto(p.species).then((ph) => {
    p.refPhoto = ph;
    save();
    if (!ph) return;
    if ($("sheet").open && $("sheet").querySelector(`[data-action="edit-plant"][data-id="${p.id}"]`)) plantSheet(p.id);
    else if (state.tab === "plants") render();
  });
}
// Alta, step 2: «¿Es esta tu planta?» with the species photo; «No es esta» shows the alternatives as photo cards.
function speciesCheck() {
  const ph = wiz.refPhoto;
  const alts = wiz.care?.alternatives ?? [];
  if (wiz.showAlts) {
    return `<section class="card species-alts"><div class="sec">¿Cuál es la tuya?</div><div class="alt-grid">${alts.map((a, i) => {
      const aph = wiz.altPhotos?.[i];
      return `<button type="button" class="alt-card" data-action="wiz-alt" data-i="${i}">${aph ? `<img src="${esc(aph.url)}" alt="" />` : `<span class="alt-noimg">${aph === null ? "Sin foto" : `<span class="spinner" aria-hidden="true"></span>`}</span>`}<b>${esc(a.commonName)}</b><i>${esc(a.species)}</i></button>`;
    }).join("")}</div>
    <div class="row"><button type="button" class="link-btn" data-action="wiz-species-ok">Sí era la primera</button><button type="button" class="link-btn" data-action="wiz-back">Ninguna: cambiar el nombre</button></div></section>`;
  }
  if (ph === undefined || (ph === null && !alts.length)) return "";
  return `<section class="card species-check">
    ${ph ? `<img src="${esc(ph.url)}" alt="" /><div class="body"><b>${esc(wiz.care?.commonName || wiz.name)}</b><i>${esc(wiz.species)}</i><small>Foto: ${esc(ph.credit)}</small>` : `<div class="body"><b>${esc(wiz.species)}</b>`}
    ${wiz.checked ? "" : `<div class="q-row"><span>¿Es esta tu planta?</span><button type="button" class="btn small" data-action="wiz-species-ok">Sí</button><button type="button" class="btn small secondary" data-action="wiz-species-no">No es esta</button></div>`}</div>
  </section>`;
}
// «Duplicar planta»: same type, care, calendar, zone and irrigation, without spending the AI.
function dupSheet(id) {
  const p = plantById(id);
  if (!p) return;
  const same = state.data.plants.filter((x) => x.name === p.name).length;
  openSheet(`
    <div class="sheet-head"><h2>Duplicar ${esc(p.name)}</h2><button class="btn small secondary" data-action="open-plant" data-id="${p.id}">Cancelar</button></div>
    <label class="seg-label" for="dupNick">Nombre de la copia</label>
    <input id="dupNick" class="big-input" autocomplete="off" value="${esc(`${p.name.replace(/^./, (c) => c.toUpperCase())} ${same + 1}`)}" />
    <label class="seg-label" for="dupZone">Zona</label>
    <input id="dupZone" class="big-input" autocomplete="off" value="${esc(p.zone ?? "")}" />
    <p class="muted small">Copia los cuidados, el calendario del año y el riego. No copia el historial.</p>
    ${p.photo ? `<label class="switch-row"><span>${ICONS.camera}Copiar también la foto</span><input type="checkbox" role="switch" id="dupPhoto" class="switch-input" /><span class="switch" aria-hidden="true"></span></label>` : `<input type="checkbox" id="dupPhoto" hidden />`}
    <div class="sheet-actions"><button class="btn block" data-action="dup-save" data-id="${p.id}">Crear copia</button></div>`);
}

// ---------- Identify a plant from a photo (Worker /identify, Gemini vision) ----------
// Step 1 of the alta: «¿No sabes cómo se llama?» → photo (camera or gallery, via the file input) →
// the AI proposes up to 3 species with their confidence → picking one fills the name and goes to step 2
// with the photo kept as the plant's own.
function identifyBlock() {
  const id = wiz.identify;
  const pick = `<input type="file" id="idPhotoInput" accept="image/*" hidden />`;
  if (!id) {
    return `<label class="card id-cta">${ICONS.camera}<div><b>¿No sabes cómo se llama?</b><span class="muted small">Hazle una foto (mejor de cerca a una hoja o una flor) o elige una de tu galería.</span></div>${pick}</label>`;
  }
  if (id.state === "loading") {
    return `<section class="card"><div class="ai-step"><span class="spinner" aria-hidden="true"></span>Mirando la foto: unos segundos…</div></section>`;
  }
  if (id.state !== "done") {
    return `<section class="card"><b>${id.state === "none" ? "La foto no me basta para saber qué planta es" : "No he podido mirar la foto"}</b>
      <p class="muted small">${esc(id.message ?? "")}</p>
      ${id.state === "none" ? `<ul class="id-tips"><li>Acércate a una hoja o a una flor</li><li>Con luz natural, sin sombra encima</li><li>Una sola planta en el encuadre</li></ul>` : ""}
      <label class="btn block">Hacer otra foto${pick}</label>
      <button type="button" class="btn block secondary" data-action="wiz-id-cancel">Escribir el nombre</button></section>`;
  }
  const [top, ...others] = id.candidates;
  const photoOf = (c) => id.refs?.[c.species];
  const conf = { alta: "Muy probable", media: "Probable", baja: "Poco seguro" };
  return `<section class="card species-check">
      <img src="${esc(id.photo)}" alt="" />
      <div class="body"><b>${esc(top.commonName)} <span class="ai-mark">✦</span> <span class="conf ${top.confidence}">${conf[top.confidence]}</span></b><i>${esc(top.species)}</i>
        <small>Usaremos tu foto como foto de la planta (podrás cambiarla)</small>
        <div class="q-row"><button type="button" class="btn small" data-action="wiz-id-pick" data-i="0">Sí, es esta</button></div></div>
    </section>
    ${others.length ? `<section class="card species-alts"><div class="sec">También podría ser</div><div class="alt-grid">${others.map((c, i) => {
      const ph = photoOf(c);
      return `<button type="button" class="alt-card" data-action="wiz-id-pick" data-i="${i + 1}">${ph ? `<img src="${esc(ph.url)}" alt="" />` : `<span class="alt-noimg">${ph === null ? "Sin foto" : `<span class="spinner" aria-hidden="true"></span>`}</span>`}<b>${esc(c.commonName)}</b><i>${esc(c.species)}</i></button>`;
    }).join("")}</div></section>` : ""}
    ${ratingCard({ kind: "identify", name: top.commonName, input: { place: here().name }, output: { candidates: id.candidates }, photo: id.photo, caseId: id.caseId, rerender: renderWizard })}
    <div class="row"><label class="link-btn">Hacer otra foto${pick}</label><button type="button" class="link-btn" data-action="wiz-id-cancel">Escribir el nombre</button></div>`;
}
// The /identify call: resolves to { isPlant, candidates }, or throws an Error with a message key.
async function callIdentify(photo) {
  const res = await fetch(`${API}/identify`, {
    method: "POST", headers: aiHeaders(), signal: AbortSignal.timeout(45000),
    body: JSON.stringify({ image: photo.split(",")[1], place: here().name }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 402) { loadMe(); throw new Error("paywall"); }
  if (!res.ok) throw new Error(body.error in AI_ERRORS ? body.error : "ai");
  return body;
}
const identifyErrorText = (err) => err.name === "TimeoutError" ? "Ha tardado demasiado." : (AI_ERRORS[err.message] ?? "La IA no está disponible ahora. Prueba otra vez o escribe el nombre.");
async function identifyFromFile(file) {
  const current = wiz;
  const name = $("wizName")?.elements.name.value.trim();
  if (name) current.name = name;
  const photo = await shrinkPhoto(file).catch(() => null);
  if (!photo) return;
  current.identify = { state: "loading", photo };
  renderWizard();
  try {
    const body = await callIdentify(photo);
    if (!body.isPlant || !body.candidates?.length) current.identify = { state: "none", photo, message: "Puedes repetir la foto o escribir el nombre a mano." };
    else {
      current.identify = { state: "done", photo, candidates: body.candidates, refs: {}, caseId: body.caseId };
      track("plant_identify");
      // Reference photos for the alternatives, as in the alta by name.
      body.candidates.slice(1).forEach((c) => refPhoto(c.species).then((ph) => { if (wiz === current && current.identify) { current.identify.refs[c.species] = ph; if ($("wizName")) renderWizard(); } }));
    }
  } catch (err) {
    current.identify = { state: "error", photo, message: identifyErrorText(err) };
  }
  if (wiz === current && $("wizName")) renderWizard();
}

// ---------- Explorar: look at a plant without adding it ----------
// Name or photo → the care sheet (the Worker's memory makes known plants free) → how it fits this
// garden: climate here, water next to what you have, light per zone, similar plants. «Añadir a mi
// jardín» opens the alta already filled in.
let explore = null;
const recentExplore = () => store.get("mj_explore_recent", []);
function exploreSheet() {
  const e = explore;
  const head = `<div class="sheet-head"><h2>Explorar</h2><button class="btn small secondary" data-action="close">Cerrar</button></div>`;
  if (!e?.shared && aiOff()) return openSheet(`${head}<p class="ai-status warn">${esc(AI_ERRORS.off)}</p>`);
  if (!e?.shared && !hasAI() && aiOpen !== null) return openSheet(`${head}<p class="ai-status warn">${esc(AI_ERRORS.code)}</p>`);
  if (!e || e.state === "idle") {
    const recent = recentExplore();
    return openSheet(`${head}
      <form id="exploreForm" class="sheet-in" style="padding:0">
        <input name="name" class="big-input" required placeholder="¿Qué planta estás mirando?" autocomplete="off" value="${esc(e?.name ?? "")}" />
        <button class="btn block" type="submit">Ver si encaja</button>
      </form>
      <label class="card id-cta">${ICONS.camera}<div><b>¿No sabes cómo se llama?</b><span class="muted small">Hazle una foto y la identifico.</span></div><input type="file" id="exploreCam" accept="image/*" hidden /></label>
      ${wishlist().length ? `<div class="group-title">Para decidir</div><section class="card list-card">${wishlist().map((w, i) =>
        `<div class="p-row"><button type="button" class="wish-main" data-action="explore-recent" data-w="${i}"><div class="body"><div class="p-name">${esc(w.name)}</div><div class="p-sp">${esc(w.species ?? "")}</div></div><span class="verdict-dot ${w.verdict}">${{ good: "Encaja bien", mid: "Con reservas", bad: "No encaja" }[w.verdict]}</span></button><button type="button" class="x" data-action="wish-del" data-i="${i}" aria-label="Quitar de la lista">${ICONS.x}</button></div>`).join("")}</section>` : ""}
      ${recent.length ? `<div class="group-title">Vistas hace poco</div><section class="card list-card">${recent.map((r, i) =>
        `<button type="button" class="p-row" data-action="explore-recent" data-i="${i}"><div class="body"><div class="p-name">${esc(r.name)}</div><div class="p-sp">${esc(r.species ?? "")}</div></div><span class="verdict-dot ${r.verdict}">${{ good: "Encaja bien", mid: "Con reservas", bad: "No encaja" }[r.verdict]}</span></button>`).join("")}</section>` : ""}`);
  }
  if (e.state === "loading") return openSheet(`${head}<section class="card"><div class="ai-step"><span class="spinner" aria-hidden="true"></span>${esc(e.step ?? "Buscando la planta")}…</div></section>`);
  if (e.state === "pick") {
    const conf = { alta: "Muy probable", media: "Probable", baja: "Poco seguro" };
    return openSheet(`${head}<section class="card species-check"><img src="${esc(e.photo)}" alt="" /><div class="body"><b>¿Cuál es?</b><small>Elige la que se parezca</small></div></section>
      ${e.candidates.map((c, i) => `<button type="button" class="btn block secondary" data-action="explore-pick" data-i="${i}">${esc(c.commonName)} <em>${esc(c.species)}</em> <span class="conf ${c.confidence}">${conf[c.confidence]}</span></button>`).join("")}
      <button type="button" class="link-btn" data-action="explore-again">Otra planta</button>`);
  }
  if (e.state !== "done") {
    return openSheet(`${head}<section class="card"><b>${esc(e.message ?? "No se ha podido")}</b></section><button class="btn block" data-action="explore-again">Probar otra vez</button>`);
  }
  const { care, report, refPhoto: ph } = e;
  const today = localToday();
  const season = seasonOf(today, here().lat);
  const LV = { ok: "check", warn: "alert", no: "x", info: "pin" };
  const hero = e.photo ?? ph?.url;
  const pills = [
    care.frostSensitive || care.minTemp != null ? ["snow", care.frostSensitive ? `Sensible a heladas${care.minTemp != null ? ` · mín. ${Number(care.minTemp)}°` : ""}` : `Aguanta hasta ${Number(care.minTemp)}°`] : null,
    [LIGHT_ICON[care.sunSensitive ? "shade" : care.sunNeed ?? "sun"], care.sunSensitive ? "Sensible al sol directo" : `Pide ${SUN_NEED_LABEL[care.sunNeed ?? "sun"]}`],
    care.plantIn ? [care.plantIn === "suelo" ? "ground" : "pot", PLANT_IN[care.plantIn]] : null,
    care.windSensitive ? ["wind", "Teme el viento"] : null,
    care.difficulty ? ["check", DIFFICULTY[care.difficulty]] : null,
  ].filter(Boolean);
  const row = (icon, title, text, level = "info") => `<div class="fit-row"><span class="fit-ic ${level}">${ICONS[icon]}</span><div><b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ""}</div></div>`;
  const ICON = { climate: "snow", water: "droplet", sun: "sun", similar: "sprout" };
  const seasons = seasonReadCells(care.seasons, season);
  const shareHead = `<div class="sheet-head"><h2>${e.shared?.demo ? "Ejemplo de ficha" : e.shared ? "Planta compartida" : "Explorar"}</h2><div class="row"><button class="btn small secondary icon-btn" data-action="explore-share" aria-label="Compartir">${ICONS.share}</button><button class="btn small secondary" data-action="close">Cerrar</button></div></div>`;
  openSheet(`${shareHead}
    ${e.shared?.demo ? `<p class="muted small">Así se ve la ficha de una planta en Florvia (ejemplo para ${esc(e.shared.place || "Madrid")}). Los cuidados los propone la IA y, en tu jardín, se ajustan a tu zona, a su sol y al tiempo. Pulsa «Añadir» para probarlo con esta planta.</p>` : e.shared ? `<p class="muted small">Alguien te ha enviado esta ficha. Está pensada para ${esc(e.shared.place || "otro lugar")}${e.shared.place && e.shared.place !== here().name ? `; tú estás en ${esc(here().name)}, así que el clima puede variar` : ""}. El encaje es con tu jardín.</p>` : ""}
    <section class="explore-hero">${hero ? `<img class="hero-photo" src="${esc(hero)}" alt="" />` : ""}
      ${!e.photo && ph ? `<small class="hero-credit">Foto: ${esc(ph.credit)}</small>` : ""}
      <div class="body"><b>${esc(care.commonName || e.name)} <span class="ai-mark">✦</span></b><i>${esc(care.species)}</i></div></section>
    <div class="traits">${pills.map(([icon, label]) => `<span class="trait">${ICONS[icon]}${esc(label)}</span>`).join("")}</div>
    <section class="verdict ${report.verdict}"><b>${esc(report.headline)}</b>
      <div class="vchips">${report.chips.map((c) => `<span class="vchip ${c.level}">${ICONS[LV[c.level]]}${c.label}</span>`).join("")}</div></section>
    <section class="card">${report.rows.map((r) => row(ICON[r.kind], r.title, r.text, r.level)).join("")}</section>
    <section class="card"><div class="sec">Dónde ponerla</div>
      ${(() => {
        if (!allZones().length) return "";
        const pl = e.place;
        return `<div class="place-ai">${pl?.zones ? `<div class="sec start">Con la IA y tus descripciones <span class="ai-mark">✦</span></div>${placeAdviceHtml(pl)}` : ""}
          ${pl?.running ? `<p class="ai-status"><span class="spinner" aria-hidden="true"></span> Consultando a la IA…</p>` : ""}${pl?.error ? `<p class="ai-status warn">${esc(pl.error)}</p>` : ""}
          ${pl?.running ? "" : `<button type="button" class="btn block secondary" style="margin:10px 0 4px" data-action="explore-place">✦ ${pl?.zones ? "Volver a valorar" : "Valorar con mis zonas"}</button>${pl?.zones ? "" : placeNudge()}`}</div>`;
      })()}
      ${report.zones.length ? report.zones.map((z) => row(LV[z.level], z.zone, z.text, z.level)).join("") : `<p class="muted small">Aún no tienes zonas. Cuando añadas plantas y marques el sol de cada zona (Ajustes), te diré dónde encaja.</p>`}
      ${care.waterHow ? row("droplet", "Cómo regarla", care.waterHow) : ""}
      ${care.plantIn ? row(care.plantIn === "suelo" ? "ground" : "pot", PLANT_IN[care.plantIn], care.potAdvice) : ""}
      ${care.windSensitive ? row("wind", "Mejor al abrigo del viento", "El viento fuerte la daña.", "warn") : ""}</section>
    <section class="card"><div class="sec">Cuándo y cómo será</div>
      ${care.plantWhen ? `<p class="muted">${esc(care.plantWhen)}</p>` : ""}
      ${monthStrip(care.plantMonths, "Mejores meses para plantarla")}
      ${monthStrip(care.bloomMonths, "Floración", care.bloomWhat)}
      ${care.matureNote ? row("sprout", `Tamaño adulto ${SIZE_FINAL[care.matureSize] ?? ""}`.trim(), care.matureNote) : ""}</section>
    <section class="card"><div class="sec">Riego y abono por estación</div>
      <div class="season-read"><span></span><span class="st-h">Regar cada</span><span class="st-h">Abonar cada</span>${seasons}</div>
      ${care.tips?.[season] ? `<div class="n-tip">${ICONS[SEASON_ICON[season]]}<span>${esc(care.tips[season])} <span class="ai-mark">✦</span></span></div>` : ""}</section>
    <div id="exploreCal">${exploreCalendar(e)}</div>
    ${report.similar ? `<section class="card"><div class="sec">Comparada con tu ${esc(plantLabel(report.similar.plant))}</div>${report.similar.lines.map((l) => `<p class="cmp">${esc(l)}</p>`).join("")}</section>` : ""}
    ${care.buyTips?.length ? `<section class="card"><details class="buy-tips"><summary>Qué mirar al comprarla</summary><ul>${care.buyTips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></details></section>` : ""}
    ${(care.toxic && care.toxic !== "no") || care.invasive ? `<section class="card">
      ${care.toxic && care.toxic !== "no" ? row("alert", TOXIC_TEXT[care.toxic], care.toxicNote, "warn") : ""}
      ${care.invasive ? row("alert", "Puede ser invasora", "Evita que se escape del jardín.", "warn") : ""}</section>` : ""}
    ${e.shared ? "" : altButtons(care.alternatives, "explore-alt")}
    <p class="muted small">Es una estimación de la IA, no una garantía. «Añadir» abre el alta ya rellena.</p>
    <div class="sheet-actions two-btns"><button class="btn secondary" data-action="wish-toggle" id="wishBtn">${wishLabel(care.species)}</button><button class="btn" data-action="explore-add">Añadir a mi jardín</button></div>`);
}
const seasonReadCells = (seasons, now) => SEASONS.map((k) => `<span class="st-name ${k === now ? "now" : ""}">${ICONS[SEASON_ICON[k]]}${SEASON_LABEL[k]}</span><span class="sr-cell">${Number(seasons[k].water) || 0} d</span><span class="sr-cell">${Number(seasons[k].feed) ? `${Number(seasons[k].feed)} d` : "No"}</span>`).join("");
// The year calendar of the explored plant (same grid as the plant sheet); it arrives after the rest.
function exploreCalendar(e) {
  if (e.calendar === undefined) return `<section class="card"><div class="sec">Calendario del año</div><div class="ai-step"><span class="spinner" aria-hidden="true"></span>Preparando el calendario…</div></section>`;
  if (!e.calendar) return `<section class="card"><div class="sec">Calendario del año</div><p class="muted small">No se ha podido preparar ahora. Al añadir la planta se pedirá de nuevo.</p></section>`;
  return yearCalendarCard({ seasons: e.care.seasons, yearTasks: e.calendar.tasks }, localToday());
}
// Wishlist («Para decidir»): plants looked at in Explorar and kept for later. Stays on this phone.
const wishlist = () => store.get("mj_wishlist", []);
const wishLabel = (species) => (wishlist().some((w) => w.species === species) ? `${ICONS.bookmark}Guardada · quitar` : `${ICONS.bookmark}Guardar para después`);

async function exploreLookup(query, name = query, photo = null) {
  explore = { state: "loading", name, query, photo, step: "Buscando la planta" };
  exploreSheet();
  const current = explore;
  try {
    const care = await requestCare(query, "explore");
    if (explore !== current) return;
    const today = localToday();
    const report = fitReport(care, state.data.plants, zoneSun(), seasonOf(today, here().lat), here().name);
    explore = { state: "done", name, query, photo, care, report, refPhoto: null };
    const rec = { query, name: care.commonName || name, species: care.species, verdict: report.verdict };
    store.set("mj_explore_recent", [rec, ...recentExplore().filter((r) => r.query !== query && r.species !== rec.species)].slice(0, 6));
    track("plant_explore");
    exploreSheet();
    const done = explore;
    refPhoto(care.species).then((ph) => { if (explore === done) { done.refPhoto = ph; if ($("sheet").open && sheet.querySelector('[data-action="explore-add"]')) exploreSheet(); } });
    requestCalendar(care.commonName || name, care.species)
      .then((cal) => { done.calendar = cal; }, () => { done.calendar = null; })
      .then(() => { if (explore === done && $("exploreCal")) $("exploreCal").innerHTML = exploreCalendar(done); });
  } catch (err) {
    if (explore === current) { explore = { state: "error", message: AI_ERRORS[err.message] ?? "La IA no está disponible ahora. Prueba otra vez en un rato." }; exploreSheet(); }
  }
}
async function exploreFromFile(file) {
  const photo = await shrinkPhoto(file).catch(() => null);
  if (!photo) return;
  explore = { state: "loading", photo, step: "Mirando la foto" };
  exploreSheet();
  const current = explore;
  try {
    const body = await callIdentify(photo);
    if (explore !== current) return;
    if (!body.isPlant || !body.candidates?.length) explore = { state: "error", message: "La foto no me basta para saber qué planta es. Acércate a una hoja o a una flor, con luz natural, o escribe el nombre." };
    else if (body.candidates.length === 1 || body.candidates[0].confidence === "alta") return exploreLookup(altQuery(body.candidates[0]), body.candidates[0].commonName, photo);
    else explore = { state: "pick", photo, candidates: body.candidates };
  } catch (err) {
    if (explore === current) explore = { state: "error", message: identifyErrorText(err) };
  }
  exploreSheet();
}

// «Zona» = the sun set for its zone in Ajustes.
const SUN_CHOICES = [["", "pin", "Zona"], ["sun", "sun", "Sol"], ["partial", "cloud", "Media"], ["shade", "umbrella", "Sombra"]];
const SUN_NEED_CHOICES = [["sun", "sun", "Sol"], ["partial", "cloud", "Media"], ["shade", "umbrella", "Sombra"], ["", null, "No lo sé"]]; // «No lo sé» = empty: the AI decides
// Same icons everywhere light is shown (selector, list, sheet).
var LIGHT_ICON = { sun: "sun", partial: "cloud", shade: "umbrella" };
// «Sobre esta planta»: what the AI proposes about the species (the light it likes, sun and frost sensitivity). Most people don't know it,
// so it's shown as a short summary with «Cambiar»; in the edit form the real inputs stay in the form (hidden) so saving reads them as before.
const SUN_NEED_FACT = { sun: ["sun", "Le gusta el sol directo"], partial: ["cloud", "Le gusta la luz media"], shade: ["umbrella", "Le gusta la sombra"] };
const LIGHT_HINT = "<b>Sol:</b> sol directo casi todo el día · <b>Media:</b> luz clara, sin sol fuerte · <b>Sombra:</b> poca luz";
const SIZE_HINT = "El de tu planta hoy, no el que llegará a tener.";
function speciesFacts({ sunNeed, sunSensitive, frostSensitive }) {
  const need = sunNeed || (sunSensitive ? "partial" : ""); // sensitivity needs a light need to work, so saving falls back to «media»
  const rows = [
    SUN_NEED_FACT[need] ?? ["cloud", "Luz que pide: la decide la IA"],
    sunSensitive ? ["sun", "Se le queman las hojas con el sol fuerte"] : null,
    ["snow", frostSensitive ? "Sensible a las heladas" : "No es sensible a las heladas"],
  ].filter(Boolean);
  return `<ul class="sp-facts">${rows.map(([icon, text]) => `<li>${ICONS[icon]}${text}</li>`).join("")}</ul>`;
}
const SP_SUN_SUB = "Actívalo si has visto hojas secas o marrones tras el sol";
const SP_FROST_SUB = "Si no lo sabes, déjalo como está";
const SIZE_CHOICES = [["small", "sprout", "Pequeña"], ["medium", "sprout", "Mediana"], ["large", "sprout", "Grande"]];
const SIZE_LABEL = { small: "Pequeña", medium: "Mediana", large: "Grande" };

function renderWizard() {
  if (!wiz) return;
  const head = (right) => `<div class="sheet-head"><h2>Nueva planta</h2><div class="row"><span class="muted">${wiz.step} de 2</span>${right}</div></div>`;
  if (wiz.step === 1) {
    const hasCode = aiGo();
    openSheet(`
      ${head(`<button class="btn small secondary" data-action="close">Cancelar</button>`)}
      <form id="wizName" class="sheet-in" style="padding:0">
        <h3 class="q">¿Qué planta es?</h3>
        <input name="name" class="big-input" required placeholder="Olivo, limonero, geranio…" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other" value="${esc(wiz.name)}" />
        <p class="muted">${hasCode ? `<span class="ai-mark">✦</span> Con el nombre, la IA propondrá sus cuidados por estación para tu zona.` : (aiOff() ? "La IA está apagada: rellena los cuidados a mano." : "Activa el asistente IA en Ajustes para que proponga los cuidados.")}</p>
      </form>
      ${hasCode ? identifyBlock() : ""}
      <div class="sheet-actions">${wiz.identify?.state === "loading"
        ? `<button class="btn block" type="submit" form="wizName" disabled aria-busy="true"><span class="spinner" aria-hidden="true"></span> Mirando la foto…</button>`
        : `<button class="btn block" type="submit" form="wizName">Siguiente</button>`}</div>`);
    setTimeout(() => $("wizName")?.elements.name.focus(), 50);
    return;
  }
  const zones = [...new Set([...state.data.plants.map((p) => p.zone), wiz.zone].filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  // While the AI is answering, the fields it fills (and Guardar) wait; the place choices stay free.
  const busy = wiz.ai === "loading";
  const lock = busy ? "disabled" : "";
  // Two mutually exclusive options → one segmented control per question.
  const segmented = (key, label, options, hint = "") => `
    <div class="seg-label" id="seg-${key}">${label}</div>
    <div class="seg" role="radiogroup" aria-labelledby="seg-${key}">
      ${options.map(([value, icon, text]) => `<button type="button" role="radio" aria-checked="${wiz[key] === value}" data-action="wiz-set" data-key="${key}" data-value="${value}">${ICONS[icon] ?? ""}${text}</button>`).join("")}
    </div>${hint ? `<div class="seg-hint">${hint}</div>` : ""}`;
  const aiLine = {
    loading: `<span class="ai-step"><span class="spinner" aria-hidden="true"></span><span id="wizAiStep">${AI_STEPS[wiz.aiStep ?? 0]}</span>…</span>`,
    done: `<span class="muted">${esc(wiz.species || "Especie sin identificar")}</span><span class="ai-pill">✦ Rellenado con IA · revisa los datos</span>`,
    error: `<span class="muted">${esc(wiz.aiError)}</span>`,
    notplant: `<span class="ai-warn">«${esc(wiz.name)}» no parece una planta.</span><span class="muted small">${esc(wiz.aiError.replace(/^No parece el nombre de una planta\. /, ""))}</span>
      <button type="button" class="btn small secondary" data-action="wiz-back" style="align-self:flex-start;margin-top:6px">Cambiar el nombre</button>`,
    idle: `<span class="muted">Cuidados a mano: ajústalos abajo.</span>`,
  }[wiz.ai];
  openSheet(`
    ${head(`<button class="btn small secondary" data-action="wiz-back">Atrás</button>`)}
    <section class="card ai-card ${wiz.ai} ${wiz.ai === "loading" || wiz.ai === "done" ? "ai-halo" : ""}" id="wizStep2">
      ${draftPhoto ? `<img class="thumb" src="${draftPhoto}" alt="" />` : `<span class="thumb placeholder">${ICONS.sprout}</span>`}
      <div class="body"><div class="name">${esc(wiz.name)}</div>${aiLine}</div>
    </section>
    ${wiz.ai === "done" ? speciesCheck() : ""}
    <h3 class="q">Nombre propio <span class="muted small">(opcional)</span></h3>
    <input id="wizNick" class="big-input" data-1p-ignore data-lpignore="true" data-form-type="other" placeholder="Para distinguirla: «${esc(wiz.name)} del patio»…" autocomplete="off" value="${esc(wiz.nick ?? "")}" />
    ${wiz.care?.confidence === "baja" ? `<p class="ai-status warn">⚠️ La IA no está segura de qué planta es. Revisa los días o vuelve atrás y prueba con otro nombre.</p>` : ""}
    <h3 class="q">¿Dónde está?</h3>
    <div class="chips">
      ${zones.map((z) => `<button type="button" class="chip ${!wiz.newZone && wiz.zone === z ? "on" : ""}" data-action="wiz-zone" data-zone="${esc(z)}">${esc(z)}</button>`).join("")}
      <button type="button" class="chip ${wiz.newZone ? "on" : ""}" data-action="wiz-new-zone">+ Nueva zona</button>
    </div>
    ${wiz.newZone ? `<input id="wizZone" class="big-input" placeholder="Terraza sur, jardín delantero…" autocomplete="off" value="${esc(wiz.zone)}" />` : ""}
    <h3 class="q">Tu sitio <span class="muted small">(lo ves tú)</span></h3>
    ${segmented("inPot", "Plantada en", [[true, "pot", "Maceta"], [false, "ground", "Suelo"]])}
    ${segmented("rainReaches", "La lluvia", [[true, "rain", "Le llega"], [false, "umbrella", "A cubierto"]])}
    ${segmented("sun", "Sol que recibe", SUN_CHOICES, "El sol que le da el sitio donde está.")}
    ${segmented("size", "Tamaño que tiene ahora", SIZE_CHOICES, SIZE_HINT)}
    <h3 class="q">Sobre esta planta ${wiz.ai === "done" ? `<span class="ai-pill sp-pill">✦ propuesto por la IA</span>` : ""}</h3>
    <section class="card sp-card">
      ${wiz.spOpen ? `<div class="sp-edit-open">
        ${segmented("sunNeed", "¿Cuánta luz le gusta?", SUN_NEED_CHOICES, LIGHT_HINT)}
        <button type="button" class="switch-row" role="switch" aria-checked="${wiz.sunSensitive && !busy}" data-action="wiz-set" data-key="sunSensitive" ${lock}>
          <span>${ICONS.sun}<span>Se le queman las hojas con el sol fuerte<small class="sub">${SP_SUN_SUB}</small></span></span><span class="switch" aria-hidden="true"></span>
        </button>
        <button type="button" class="switch-row" role="switch" aria-checked="${wiz.frostSensitive && !busy}" data-action="wiz-set" data-key="frostSensitive" ${lock}>
          <span>${ICONS.snow}<span>Sensible a las heladas<small class="sub">${SP_FROST_SUB}</small></span></span><span class="switch" aria-hidden="true"></span>
        </button>
        <button type="button" class="btn small secondary sp-done" data-action="wiz-sp-toggle">Hecho</button>
      </div>` : busy ? `<p class="muted small" style="margin:0">La IA está mirando qué luz le gusta y si aguanta el frío…</p>`
      : wiz.ai === "done" || wiz.sunNeed || wiz.sunSensitive || wiz.frostSensitive ? `${speciesFacts(wiz)}
        <p class="muted small">No hace falta tocarlo. Si no lo sabes, déjalo así.</p>
        <button type="button" class="btn small secondary" data-action="wiz-sp-toggle">Cambiar</button>`
      : `<b>Aún no tenemos estos datos.</b>
        <p class="muted small">Ponlos tú si los sabes, o déjalos así: la IA los propondrá cuando pueda.</p>
        <button type="button" class="btn small secondary" data-action="wiz-sp-toggle">Rellenar a mano</button>`}
    </section>
    <button type="button" class="switch-row" role="switch" aria-checked="${wiz.autoWater}" data-action="wiz-set" data-key="autoWater">
      <span>${ICONS.drip}Riego automático</span><span class="switch" aria-hidden="true"></span>
    </button>
    <section class="card care-block">
      <h3>Cuidados${wiz.ai === "done" ? ` propuestos <span class="ai-mark">✦</span>` : ""}</h3>
      ${seasonTable(wiz.seasons, { busy, aiCells: wiz.ai === "done" ? new Set(ALL_CELLS.filter((c) => !wiz.touched[c])) : undefined })}
      ${wiz.ai === "done" ? tipsList(wiz.tips) : ""}
      ${wiz.ai === "done" && wiz.notes ? `
      <div class="ai-notes ${wiz.notesOpen ? "open" : ""}">
        <p>${esc(wiz.notes)}</p>
        <button type="button" class="more" data-action="wiz-notes" aria-expanded="${Boolean(wiz.notesOpen)}">${wiz.notesOpen ? "Ver menos" : "Ver más"}</button>
      </div>` : ""}
    </section>
    ${store.get("mj_last_place", null) ? `<p class="muted small">Zona y opciones como en la última planta que añadiste.</p>` : ""}
    ${wiz.ai === "done" && wiz.care ? ratingCard({ kind: "care", name: wiz.name, input: { name: wiz.name, place: here().name }, output: wiz.care, caseId: wiz.care.caseId, rerender: renderWizard }) : ""}
    <h3 class="q">Foto de tu planta <span class="muted small">(opcional)</span></h3>
    <div class="photo-pick"><span id="photoPreview">${draftPhoto ? `<img class="thumb" src="${draftPhoto}" alt="" />` : `<span class="thumb placeholder">${ICONS.camera}</span>`}</span>
      <div style="display:grid;gap:8px;min-width:0">
        <span class="muted small">${draftPhoto && wiz.photoFromId ? "Es la foto con la que la reconociste." : "Para encontrarla de un vistazo en tu lista."}</span>
        <div class="row" style="gap:8px"><label class="btn small secondary">${draftPhoto ? "Cambiar foto" : "Añadir foto"}<input type="file" id="photoInput" accept="image/*" hidden /></label>${draftPhoto ? `<button type="button" class="btn small secondary" data-action="wiz-photo-remove">Quitar</button>` : ""}</div>
      </div></div>
    <div class="sheet-actions">${busy
      ? `<button class="btn block" data-action="wiz-save" disabled aria-busy="true"><span class="spinner" aria-hidden="true"></span> Esperando a la IA…</button>`
      : `<button class="btn block" data-action="wiz-save">Guardar planta</button>`}</div>`);
  if (wiz.newZone) setTimeout(() => $("wizZone")?.focus(), 50);
}

// What the AI card says while waiting: it advances every couple of seconds.
const AI_STEPS = ["Identificando la planta", "Calculando el riego por estación", "Revisando el abonado", "Escribiendo consejos"];

// Fills the alta from a care sheet (the AI's, or one that came with a shared plant), keeping what the user touched.
function applyCareToWizard(current, care) {
  current.care = care;
  current.ai = "done";
  current.species = care.species;
  for (const k of SEASONS) for (const kind of ["water", "feed"]) {
    if (!current.touched[`${k}.${kind}`]) current.seasons[k][kind] = care.seasons[k][kind];
  }
  if (!current.touched.frostSensitive) current.frostSensitive = care.frostSensitive;
  if (!current.touched.sunNeed) current.sunNeed = care.sunNeed ?? "";
  if (!current.touched.sunSensitive) current.sunSensitive = Boolean(care.sunSensitive);
  current.notes = care.notes;
  current.tips = care.tips;
  current.feedTypes = care.feedTypes;
}

async function wizLookup() {
  const current = wiz;
  current.ai = "loading";
  current.aiStep = 0;
  renderWizard();
  const ticker = setInterval(() => {
    current.aiStep = Math.min(current.aiStep + 1, AI_STEPS.length - 1);
    const el = $("wizAiStep");
    if (el && wiz === current) el.textContent = AI_STEPS[current.aiStep];
  }, 2200);
  try {
    const care = await requestCare(current.query ?? current.name);
    applyCareToWizard(current, care);
    current.refPhoto = null;
    current.checked = false;
    refPhoto(care.species).then((ph) => { current.refPhoto = ph; if (wiz === current && $("wizStep2")) renderWizard(); });

  } catch (err) {
    current.ai = err.message === "not_plant" ? "notplant" : "error";
    current.aiError = aiErrorText(err.message);
  }
  clearInterval(ticker);
  // Redraw only if this draft's step 2 is still what the sheet shows.
  if (wiz === current && $("wizStep2")) renderWizard();
}

function wizSave() {
  if (wiz.ai === "loading") return;
  track(`${wiz.ai === "done" ? "plant_add_ai" : "plant_add_manual"}|${String(wiz.name ?? "").slice(0, 60).replace(/\|/g, " ")}`);
  const zone = wiz.zone.trim();
  const plant = {
    id: uid(), created: localToday(), name: wiz.name, nick: ($("wizNick")?.value ?? wiz.nick ?? "").trim(), species: wiz.species, zone, refPhoto: wiz.refPhoto ?? undefined,
    seasons: wiz.seasons, rainReaches: wiz.rainReaches, inPot: wiz.inPot,
    frostSensitive: wiz.frostSensitive, autoWater: wiz.autoWater, notes: wiz.notes, tips: wiz.tips, feedTypes: wiz.feedTypes, photo: draftPhoto,
  };
  if (wiz.ai === "done" && wiz.care) { plant.ai = aiSnapshot(wiz.care); plant.minTemp = wiz.care.minTemp ?? null; plant.info = infoFields(wiz.care); }
  if (wiz.sunNeed || wiz.sunSensitive) { plant.sunNeed = wiz.sunNeed || "partial"; plant.sunSensitive = wiz.sunSensitive; }
  plant.sun = wiz.sun || "";
  plant.size = wiz.size || "";
  // With the AI, the calendar (version 4) arrives in the background; by hand, nothing to fetch.
  plant.careVersion = wiz.ai === "done" ? 3 : CARE_VERSION;
  withCurrentIntervals(plant);
  store.set("mj_last_place", { zone, inPot: wiz.inPot, rainReaches: wiz.rainReaches });
  // A plant that came shared brings its calendar: no need to ask the AI for it.
  const sharedCal = wiz.sharedCalendar?.tasks?.length ? wiz.sharedCalendar : null;
  if (sharedCal) { applyCalendar(plant, sharedCal); plant.careVersion = CARE_VERSION; }
  state.data.plants.push(plant);
  save();
  render();
  const askCalendar = wiz.ai === "done" && !sharedCal;
  wiz = null;
  plantSheet(plant.id);
  if (askCalendar) fetchCalendarFor(plant.id);
}

// Saving the access code checks it against the backend so the user sees at once whether it works.
let codeStatus = null;
async function saveCode(code) {
  store.set("mj_ai_code", code);
  if (!code) { codeStatus = { kind: "warn", text: "Escribe o pega el código antes de guardar." }; return render(); }
  codeStatus = { kind: "", text: "Comprobando…" };
  render();
  try {
    const res = await fetch(`${API}/check`, { headers: { "X-Access-Code": code } });
    codeStatus = res.ok
      ? { kind: "ok", text: "Código correcto. La IA ya puede proponer los cuidados de tus plantas." }
      : { kind: "warn", text: "Código incorrecto. Revisa que esté completo, sin espacios." };
  } catch {
    codeStatus = { kind: "warn", text: "Guardado, pero no se ha podido comprobar: sin conexión." };
  }
  render();
}

// ---------- Actions ----------
function addLog(plantId, type, note = "") {
  state.data.log.push({ id: uid(), plantId, type, date: localToday(), time: new Date().toTimeString().slice(0, 5), note });
  save();
}

const actions = {
  "new-plant": newPlantWizard,
  "wiz-back": () => { wiz.step = 1; renderWizard(); },
  "wiz-photo-remove": () => { wiz.nick = $("wizNick")?.value ?? wiz.nick; if ($("wizZone")) wiz.zone = $("wizZone").value; draftPhoto = null; wiz.photoFromId = false; renderWizard(); },
  "wiz-alt": (d) => { wiz.nick = $("wizNick")?.value ?? wiz.nick; wiz.query = altQuery(wiz.care.alternatives[+d.i]); wiz.showAlts = false; wizLookup(); },
  "wiz-id-cancel": () => { wiz.identify = null; renderWizard(); },
  "wiz-id-pick": (d) => {
    const id = wiz.identify;
    const c = id?.candidates?.[+d.i];
    if (!c) return;
    draftPhoto = id.photo;
    Object.assign(wiz, { photoFromId: true, name: c.commonName, query: altQuery(c), identify: null, care: null, step: 2 });
    if (aiGo()) wizLookup(); else renderWizard();
  },
  "wiz-species-ok": () => { wiz.nick = $("wizNick")?.value ?? wiz.nick; wiz.checked = true; wiz.showAlts = false; renderWizard(); },
  "wiz-species-no": () => {
    wiz.nick = $("wizNick")?.value ?? wiz.nick;
    if (!wiz.care?.alternatives?.length) return actions["wiz-back"]();
    wiz.showAlts = true;
    renderWizard();
    wiz.care.alternatives.forEach((a, i) => refPhoto(a.species).then((ph) => { (wiz.altPhotos ??= {})[i] = ph; if ($("wizStep2")) renderWizard(); }));
  },
  "dup-plant": (d) => (plantLimitHit() ? premiumSheet("plants") : dupSheet(d.id)),
  "dup-save": (d) => {
    const src = plantById(d.id);
    if (!src) return;
    const copy = structuredClone(src);
    Object.assign(copy, { id: uid(), created: localToday(), nick: $("dupNick").value.trim(), zone: $("dupZone").value.trim() });
    if (!$("dupPhoto").checked) delete copy.photo;
    state.data.plants.push(copy);
    track("plant_duplicate");
    save();
    render();
    plantSheet(copy.id);
  },
  "wiz-zone": (d) => { wiz.zone = d.zone; wiz.newZone = false; renderWizard(); },
  "wiz-new-zone": () => { wiz.newZone = true; wiz.zone = ""; renderWizard(); },
  "wiz-set": (d) => {
    wiz[d.key] = ["sun", "size", "sunNeed"].includes(d.key) ? d.value : ["frostSensitive", "autoWater", "sunSensitive"].includes(d.key) ? !wiz[d.key] : d.value === "true";
    if (d.key === "sunNeed" && d.value === "") delete wiz.touched.sunNeed; // «No lo sé»: the AI may still fill it
    else wiz.touched[d.key] = true;
    renderWizard();
  },
  "wiz-sp-toggle": () => { wiz.spOpen = !wiz.spOpen; renderWizard(); },
  "wiz-save": wizSave,
  "wiz-notes": () => { wiz.notesOpen = !wiz.notesOpen; renderWizard(); },
  "edit-plant": (d) => plantForm(d.id),
  "plant-refresh": (d) => refreshPlantAi(d.id),
  "open-premium": () => premiumSheet(""),
  "premium-intent": (d) => premiumIntent(d.c),
  "premium-buy": (d) => premiumBuy(d.c),
  "invite-open": () => { inviteUi = { code: "", email: premiumUi.email || "", error: "", done: false, busy: false }; inviteSheet(); },
  "invite-go": () => inviteGo(),
  "invite-leave": () => inviteLeave(),
  "invite-edit": (d) => { const c = usageInvites?.codes.find((x) => x.code === d.code); if (!c) return; inviteEdit = { code: c.code, label: c.label, maxUses: c.max_uses, days: c.access_days ?? "", active: Boolean(c.active), uses: c.uses, error: "", busy: false }; inviteEditSheet(); },
  "invite-edit-active": (d) => { inviteEditRead(); inviteEdit.active = d.on === "1"; inviteEditSheet(); },
  "invite-edit-save": () => inviteEditSave(),
  "invite-new": () => inviteNew(),
  "invite-revoke": (d) => inviteRevoke(d.code, d.email),
  "premium-portal": () => premiumPortal(),
  "open-feedback": () => { fb = null; feedbackSheet(); },
  "admin-push": async (d) => {
    const on = d.on === "1";
    adminPushMsg = "";
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (on) {
        if (!("PushManager" in window) || !("Notification" in window)) throw new Error("No se pueden recibir avisos en este navegador.");
        if ((await Notification.requestPermission()) !== "granted") throw new Error("No se han concedido los permisos de avisos.");
        const key = Uint8Array.from(atob(VAPID_PUBLIC.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
        sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      if (!sub) throw new Error("Sin suscripción en este dispositivo.");
      const res = await fetch(`${API}/push/admin`, { method: "POST", headers: aiHeaders(), body: JSON.stringify({ sub: sub.toJSON(), on }) });
      if (!res.ok) throw new Error("No se ha podido guardar en el servidor.");
      store.set("mj_admin_push", on);
      adminPushMsg = on ? "Avisos activados en este dispositivo." : "Avisos desactivados en este dispositivo.";
    } catch (err) { adminPushMsg = err.message || "No se ha podido activar."; }
    usageSheet();
  },
  "fb-type": (d) => { fbRead(); fb.type = d.t; fb.state = "idle"; feedbackSheet(); },
  "fb-send": () => feedbackSend(),
  "fb-status": async (d) => {
    try { await fetch(`${API}/feedback/status`, { method: "POST", headers: aiHeaders(), body: JSON.stringify({ id: Number(d.id), status: d.s }) }); } catch {}
    loadFeedback();
  },
  "usage-mine": async (d) => {
    const on = d.on === "1";
    try { await fetch(`${API}/internal`, { method: "POST", headers: aiHeaders(), body: JSON.stringify({ on }) }); } catch {}
    loadUsage();
  },
  "usage-label": async (d) => {
    const name = prompt("Nombre para esta persona (vacío para quitarlo):", d.name ?? "");
    if (name === null) return;
    try { await fetch(`${API}/usage/label`, { method: "POST", headers: aiHeaders(), body: JSON.stringify({ id: d.id, label: name }) }); } catch {}
    loadUsage();
  },
  "plant-place": (d) => askPlantPlace(d.id),
  "topics-mine": () => { topicsMine = !topicsMine; usageSheet(); },
  "topics-range": (d) => { topicsAll = d.all === "true"; usageSheet(); },
  "topics-csv": () => download(`florvia-plantas-pedidas-${localToday()}.csv`, `\uFEFF${topicsCsv()}`, "text/csv"),
  "pf-photo": () => { plantUi.big = !plantUi.big; plantSheet(plantUi.id); },
  "pf-month": () => { plantUi.monthAll = !plantUi.monthAll; plantSheet(plantUi.id); },
  "diag-open": (d) => { diag = { id: d.id, symptoms: [], note: "", photo: null, state: "idle", saved: false }; if (!me) loadMe(); diagSheet(); },
  "dg-sym": (d) => { diagRead(); diag.symptoms = diag.symptoms.includes(d.k) ? diag.symptoms.filter((x) => x !== d.k) : [...diag.symptoms, d.k]; diagSheet(); },
  "dg-nophoto": () => { diagRead(); diag.photo = null; diagSheet(); },
  "check-update": () => { if (updateCheck.state === "new") location.reload(); else checkUpdate(); },
  "dg-go": () => diagGo(),
  "dg-back": () => { diag.state = "idle"; diag.res = null; diag.saved = false; diagSheet(); },
  "dg-dropphoto": () => { diag.photo = null; diag.state = "idle"; diag.res = null; diag.saved = false; diagSheet(); setTimeout(() => $("dgNote")?.focus(), 60); },
  "dg-save": () => {
    const r = diag?.res;
    if (!r?.causes?.length || diag.saved) return;
    addLog(diag.id, "note", `Diagnóstico IA: ${r.causes[0].title}${r.causes[0].action ? ` — ${r.causes[0].action}` : ""}`.slice(0, 280));
    diag.saved = true;
    diagSheet();
  },
  "suggest-open": (d) => suggestOpen(d.zone),
  "sg-zone": (d) => { suggestRead(); suggest.zone = d.other ? null : d.zone; suggest.state = "idle"; suggestSheet(); },
  "sg-sun": (d) => { suggestRead(); suggest.siteSun = suggest.siteSun === d.sun ? "" : d.sun; suggestSheet(); },
  "sg-pref": (d) => { suggestRead(); suggest.prefs = suggest.prefs.includes(d.p) ? suggest.prefs.filter((x) => x !== d.p) : [...suggest.prefs, d.p]; suggestSheet(); },
  "sg-go": () => suggestGo(),
  "sg-back": () => { suggest.state = "idle"; suggestSheet(); },
  "sg-open": (d) => { const p = suggest?.res?.picks?.[+d.i]; if (p) exploreLookup(p.species, p.commonName); },
  "explore-place": () => askExplorePlace(),
  "open-plant": (d) => { if (confirmDiscard()) plantSheet(d.id); },
  close: leaveSheet,
  "retry-weather": loadWeather,
  "open-place": placeSheet,
  "keep-madrid": () => setLoc({ ...DEFAULT_LOC }),
  "coords-save": () => {
    const c = parseCoords($("placeCoords").value);
    if (!c) { const e = $("placeCoordsErr"); e.textContent = "No entiendo esas coordenadas. Escribe latitud y longitud, por ejemplo 36.7213, -4.4214."; e.hidden = false; return; }
    setLoc({ name: $("placeCoordName").value.trim().slice(0, 40) || `${c.lat.toFixed(3)}, ${c.lon.toFixed(3)}`, ...c });
  },
  "zone-open": (d) => zoneSheet(d.zone ?? ""),
  "welcome-install": installSheet,
  "welcome-hide": () => { store.set("mj_welcome", "off"); render(); },
  "open-ai": () => aiSheet(),
  "ai-toggle": () => { store.set("mj_ai_off", !aiOff()); render(); },
  "open-upgrades": () => upgradesSheet(),
  "open-usage": () => { usage = null; usageSheet(); loadUsage(); },
  noop: () => {},
  log: (d) => {
    let note = "";
    if (d.type === "note" || d.type === "treat") {
      note = prompt(d.type === "note" ? "Nota" : "¿Qué tratamiento? (opcional)") ?? null;
      if (note === null || (d.type === "note" && !note.trim())) return;
    }
    addLog(d.id, d.type, note.trim());
    if (d.reopen) plantUi.flash = { type: d.type, at: Date.now() };
    if (d.type === "water") track("water_done");
    if (d.type === "feed") track("feed_done");
    render();
    if (d.reopen) plantSheet(d.id);
  },
  "skip-rain": (d) => { addLog(d.id, "water", "Lluvia"); track("water_skip_rain"); render(); },
  "undo-log": (d) => { state.data.log = state.data.log.filter((e) => e.id !== d.log); save(); render(); },
  "task-toggle": (d) => {
    if (d.refs) return toggleTasks(d.refs.split(","));
    const p = plantById(d.id);
    const task = p?.yearTasks?.[+d.i];
    if (!task) return;
    const ref = `${p.id}:${d.i}`;
    const w = taskWindow(task.months, localToday());
    const doneLogs = state.data.log.filter((e) => e.type === "task" && e.ref === ref && w && e.date >= w.start);
    if (doneLogs.length) state.data.log = state.data.log.filter((e) => !doneLogs.includes(e));
    else { state.data.log.push({ id: uid(), plantId: p.id, type: "task", ref, date: localToday(), time: new Date().toTimeString().slice(0, 5), note: task.title }); track("task_done"); }
    save();
    render();
    if (d.reopen) plantSheet(p.id);
  },
  "zone-sun": (d) => {
    const z = { ...zoneSun() };
    if (z[d.zone] === d.sun) delete z[d.zone]; else z[d.zone] = d.sun;
    state.data.zoneSun = z;
    save();
    render();
    // Inside the zone sheet only the buttons change, so what is being typed there isn't lost.
    const form = $("zoneForm");
    if (form && form.dataset.zone === d.zone) form.querySelectorAll('[data-action="zone-sun"]').forEach((b) => b.setAttribute("aria-checked", String(z[d.zone] === b.dataset.sun)));
  },
  "zone-auto": (d) => {
    const paused = pausedZones().includes(d.zone);
    state.data.pausedZones = paused ? pausedZones().filter((z) => z !== d.zone) : [...pausedZones(), d.zone];
    save();
    render();
    const form = $("zoneForm");
    if (form && form.dataset.zone === d.zone) form.querySelector('[data-action="zone-auto"]')?.setAttribute("aria-checked", String(!pausedZones().includes(d.zone)));
  },
  "task-skip": (d) => {
    const p = plantById(d.id);
    const task = p?.yearTasks?.[+d.i];
    if (!task || !confirm(`¿Quitar «${task.title}» de ${plantLabel(p)}? No volverá a aparecer (puedes recuperarla en su ficha, en el calendario del año).`)) return;
    task.off = true;
    p.skippedTasks = [...(p.skippedTasks ?? []), task.title];
    save();
    render();
    if (d.reopen) plantSheet(p.id);
  },
  "task-restore": (d) => {
    const p = plantById(d.id);
    if (!p) return;
    for (const t of p.yearTasks ?? []) delete t.off;
    p.skippedTasks = [];
    save();
    render();
    plantSheet(p.id);
  },
  "open-sync": () => syncSheet(),
  "open-push": () => pushSheet(),
  "push-on": async () => {
    pushSheet("Activando…");
    try {
      if (!syncKey()) {
        for (const item of [...state.data.plants, ...state.data.log]) item._at ??= Date.now();
        store.set("mj_sync", { key: newKey() });
        await refreshUsageId();
        await pushNow();
      }
      if ((await Notification.requestPermission()) !== "granted") return pushSheet("Sin permiso no se pueden enviar avisos. Puedes darlo en los ajustes del móvil, en Notificaciones.");
      await subscribePush();
      store.set("mj_push", true);
      render();
      pushSheet("Aviso diario activado.");
    } catch (err) { pushSheet(`No se ha podido activar (${err.message}).`); }
  },
  "push-test": async () => {
    pushSheet("Enviando…");
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      const r = await fetch(`${API}/push/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub?.endpoint }) }).then((x) => x.json());
      pushSheet(r.sent ? "Enviado: debería llegarte en unos segundos." : "No se ha podido enviar. Prueba a desactivar y activar el aviso.");
    } catch { pushSheet("No se ha podido enviar."); }
  },
  "push-off": async () => {
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) {
        await fetch(`${API}/push/unsubscribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
        await sub.unsubscribe();
      }
    } catch {}
    store.set("mj_push", false);
    render();
    pushSheet();
  },
  "sync-on": async () => {
    activateSync(newKey());
    await refreshUsageId();
    syncSheet("Activando…");
    await pushNow();
    syncSheet();
  },
  "sync-have-key": () => syncSheet(null, true),
  "sync-enter-key": () => {
    const key = parseKey($("syncKeyInput")?.value);
    if (!key) return syncSheet("Esa clave no es válida: son 16 letras y números.", true);
    joinViaGoogle = false;
    joinSheet(key);
  },
  "sync-copy": async () => { await navigator.clipboard?.writeText(formatKey(syncKey())).catch(() => {}); syncSheet("Clave copiada."); },
  "sync-share": async () => {
    const url = gardenLink(syncKey());
    if (navigator.share) await navigator.share({ title: "Florvia", text: "Únete a mi jardín en Florvia:", url }).catch(() => {});
    else { await navigator.clipboard?.writeText(url).catch(() => {}); syncSheet("Enlace copiado."); }
  },
  "sync-off": () => {
    if (!confirm("¿Dejar de sincronizar en este móvil? Tus plantas se quedan aquí, pero los cambios ya no llegarán a los otros móviles.")) return;
    localStorage.removeItem("mj_sync");
    refreshUsageId();
    render();
    syncSheet();
  },
  "sync-join": async (d) => {
    const remote = joinRemote;
    if (!remote) return;
    store.set("mj_sync", { key: d.key, ...(joinViaGoogle ? { google: true } : {}) });
    joinViaGoogle = false;
    await refreshUsageId();
    if ($("joinReplace")?.checked) {
      store.set("mj_backup_before_join", state.data);
      state.data = { ...state.data, ...gardenDoc(remote) };
      state.data.plants.forEach(scrubPlant);
      syncHashes = hashesOf(state.data);
      store.set("mj_data", state.data);
    } else {
      for (const item of [...state.data.plants, ...state.data.log]) item._at ??= Date.now();
      applyRemote(remote);
    }
    closeSheet();
    render();
    await pushNow();
  },
  "add-menu": () => openSheet(`<div class="sheet-head"><h2>Añadir</h2><button class="btn small secondary" data-action="close">Cerrar</button></div>
    <button type="button" class="menu-row" data-action="new-plant"><span class="menu-ic add">${ICONS.plus}</span><span><b>Añadir planta</b><small>Guardarla en tu jardín</small></span></button>
    <button type="button" class="menu-row" data-action="explore-open"><span class="menu-ic explore">${ICONS.search}</span><span><b>Explorar una planta</b><small>Ver si encaja, sin añadirla</small></span></button>
    <button type="button" class="menu-row" data-action="suggest-open"><span class="menu-ic suggest">${ICONS.sparkle}</span><span><b>Qué planto aquí</b><small>Ideas de plantas para un sitio</small></span></button>`),
  "explore-open": () => { explore = { state: "idle" }; exploreSheet(); },
  "explore-again": () => { explore = { state: "idle" }; exploreSheet(); },
  "explore-recent": (d) => { const r = d.w !== undefined ? wishlist()[+d.w] : recentExplore()[+d.i]; if (r) exploreLookup(r.query, r.name); },
  "wish-toggle": () => {
    const e = explore;
    if (!e?.care) return;
    const list = wishlist();
    const has = list.some((w) => w.species === e.care.species);
    store.set("mj_wishlist", has ? list.filter((w) => w.species !== e.care.species) : [{ query: e.query ?? altQuery(e.care), name: e.care.commonName || e.name, species: e.care.species, verdict: e.report.verdict, at: localToday() }, ...list]);
    $("wishBtn").innerHTML = wishLabel(e.care.species);
  },
  "wish-del": (d) => { store.set("mj_wishlist", wishlist().filter((_, i) => i !== +d.i)); exploreSheet(); },
  "explore-alt": (d) => { const a = explore?.care?.alternatives?.[+d.i]; if (a) exploreLookup(altQuery(a), a.commonName); },
  "explore-pick": (d) => { const c = explore?.candidates?.[+d.i]; if (c) exploreLookup(altQuery(c), c.commonName, explore.photo); },
  "delete-server": async () => {
    if (!confirm("Se borrará de nuestro servidor tu jardín sincronizado, el aviso diario y los enlaces que has compartido. Tus plantas siguen en este móvil. Otros móviles que usen la misma clave dejarán de sincronizar.\n\n¿Borrar?")) return;
    toast("Borrando…");
    const calls = [fetch(`${API}/usage/delete`, { method: "POST", headers: aiHeaders() })]; // the usage counts tied to this phone and garden
    const key = syncKey();
    if (key) calls.push(fetch(`${API}/garden/${key}`, { method: "DELETE" }));
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) { calls.push(fetch(`${API}/push/unsubscribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) })); await sub.unsubscribe(); }
    } catch {}
    for (const sh of store.get("mj_shares", [])) calls.push(fetch(`${API}/share/${sh.id}`, { method: "DELETE" }));
    const results = await Promise.allSettled(calls);
    if (results.some((r) => r.status === "rejected" || !r.value.ok)) return toast("No se ha podido borrar todo. Prueba otra vez.");
    for (const k of ["mj_sync", "mj_shares"]) localStorage.removeItem(k);
    store.set("mj_device", crypto.randomUUID()); // a new anonymous id from the next time the app opens
    store.set("mj_events", []);
    store.set("mj_push", false);
    clearTimeout(pushTimer);
    refreshUsageId();
    render();
    toast("Datos borrados del servidor");
  },
  "open-share": () => { gardenShare = null; shareGardenSheet(); },
  "share-garden-create": async () => {
    shareGardenSheet(null, true);
    try {
      const plants = state.data.plants.map((p) => Object.fromEntries(SHARE_PLANT_KEYS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]])));
      const { id, expires } = await createShare({ kind: "garden", plants, zoneSun: zoneSun() });
      gardenShare = { link: shareLink("garden", id), expires };
      shareGardenSheet();
    } catch (err) { shareGardenSheet(shareErrorText(err)); }
  },
  "share-garden-copy": async () => { await navigator.clipboard?.writeText(gardenShare.link).catch(() => {}); toast("Enlace copiado"); },
  "share-garden-send": () => shareOut(gardenShare.link, "Mira mi jardín en Florvia"),
  "view-plant": (d) => viewPlantSheet(+d.i),
  "view-back": () => viewGardenSheet(),
  "plant-share": async (d) => {
    const p = plantById(d.id);
    if (!p) return;
    toast("Preparando el enlace…");
    try {
      // The care sheet of this plant, as a fixed copy. Notes only if they are the AI's; history, nickname and exact location stay on the phone.
      const care = {
        commonName: p.name, species: p.species || p.name,
        seasons: p.seasons, feedTypes: p.feedTypes ?? {}, tips: p.tips ?? {},
        frostSensitive: Boolean(p.frostSensitive), sunNeed: p.sunNeed || "sun", sunSensitive: Boolean(p.sunSensitive), minTemp: p.minTemp ?? null,
        climateFit: "ok", climateNote: "", ...(p.info ?? {}),
        buyTips: [], alternatives: [], notes: isAiValue(p, "notes") ? p.notes : "",
      };
      const calendar = (p.yearTasks ?? []).length ? { tasks: p.yearTasks.filter((t) => !t.off), risks: p.risks ?? [] } : null;
      const { id } = await createShare({ kind: "plant", care, calendar, refPhoto: p.refPhoto ?? null, photo: p.photo ?? null, place: here().name });
      await shareOut(shareLink("planta", id), `Mira mi ${p.name} en Florvia`);
    } catch (err) { toast(shareErrorText(err)); }
  },
  "explore-share": async () => {
    const e = explore;
    if (!e?.care) return;
    toast("Preparando el enlace…");
    try {
      const { id } = await createShare({ kind: "plant", care: e.care, calendar: e.calendar ?? null, refPhoto: e.refPhoto ?? null, photo: e.photo ?? null, place: e.shared?.place ?? here().name });
      await shareOut(shareLink("planta", id), `Mira esta planta: ${e.care.commonName || e.name}`);
    } catch (err) { toast(shareErrorText(err)); }
  },
  "explore-add": () => {
    const e = explore;
    if (!e?.care) return;
    newPlantWizard();
    draftPhoto = e.photo ?? null;
    if (e.shared) {
      // The sheet came with the link: fill the alta from it, no AI.
      Object.assign(wiz, { name: e.name, step: 2, refPhoto: e.refPhoto ?? null, checked: true, sharedCalendar: e.calendar ?? null });
      applyCareToWizard(wiz, e.care);
      return renderWizard();
    }
    Object.assign(wiz, { name: e.name, query: e.query, step: 2 });
    if (aiGo()) wizLookup(); else renderWizard();
  },
  "plants-view": (d) => { store.set("mj_plants_view", d.view); render(); },
  "toggle-week-tasks": () => { weekAll = !weekAll; render(); },
  "toggle-done": () => { doneOpen = !doneOpen; render(); },
  "toggle-rain-skip": () => { rainSkipOpen = !rainSkipOpen; render(); },
  "rate-up": (d) => rateSend(d.key, 1),
  "rate-down": (d) => { rateUi[d.key].step = "why"; rateCtxs[d.key].rerender(); },
  "rate-reason": (d) => {
    const ui = rateUi[d.key];
    ui.note = $("rateNote")?.value ?? ui.note;
    ui.reasons = ui.reasons.includes(d.k) ? ui.reasons.filter((x) => x !== d.k) : [...ui.reasons, d.k];
    rateCtxs[d.key].rerender();
  },
  "rate-send": (d) => rateSend(d.key, 0),
  "rate-cancel": (d) => { const ctx = rateCtxs[d.key]; delete rateUi[d.key]; ctx.rerender(); },
  "case-open": (d) => openCase(d.id),
  "analyses-load": () => loadAnalyses(true),
  "analyses-more": () => loadAnalyses(false),
  "analyses-kind": (d) => { analyses.kind = d.kind; loadAnalyses(true); },
  "analyses-bad": () => { analyses.bad = !analyses.bad; loadAnalyses(true); },
  "analyses-mine": () => { analyses.mine = !analyses.mine; loadAnalyses(true); },
  "case-status": async (d) => {
    if (caseView?.id === d.id) { caseView.status = d.status; caseSheet(); }
    await fetch(`${API}/case/status`, { method: "POST", headers: aiHeaders(), body: JSON.stringify({ id: d.id, status: d.status }) }).catch(() => {});
    loadUsage();
  },
  "chart-range": (d) => { chartRange = d.range === "24h" ? "24h" : "30d"; usageSheet(); },
  "notify-toggle": async (d) => {
    const on = !usage?.notify?.[d.kind];
    if (usage?.notify) usage.notify[d.kind] = on; // optimistic
    usageSheet();
    try {
      const res = await fetch(`${API}/notify`, { method: "POST", headers: aiHeaders(), body: JSON.stringify({ kind: d.kind, on }) });
      if (!res.ok) throw new Error();
      usage.notify = (await res.json()).notify;
    } catch { if (usage?.notify) usage.notify[d.kind] = !on; }
    usageSheet();
  },
  "toggle-week": () => { weekOpen = !weekOpen; render(); },
  "del-log": (d) => {
    state.data.log = state.data.log.filter((e) => e.id !== d.log);
    save(); render(); plantSheet(d.id);
  },
  "del-plant": (d) => {
    const p = plantById(d.id);
    if (!confirm(`¿Eliminar «${plantLabel(p)}» y todo su historial?`)) return;
    formDirty = false;
    state.data.plants = state.data.plants.filter((x) => x.id !== d.id);
    state.data.log = state.data.log.filter((e) => e.plantId !== d.id);
    save(); closeSheet(); render();
  },
  locate: () => {
    if (!navigator.geolocation) return alert("Este navegador no permite obtener la ubicación.");
    navigator.geolocation.getCurrentPosition(
      (pos) => setLoc({ name: "Mi ubicación", lat: +pos.coords.latitude.toFixed(2), lon: +pos.coords.longitude.toFixed(2) }),
      () => alert("No se ha podido obtener tu ubicación. Busca tu ciudad."),
      { timeout: 10000, maximumAge: 3600000 },
    );
  },
  "pick-place": (d) => {
    const r = JSON.parse($("placeResults").dataset.results)[+d.i];
    setLoc({ name: r.name, lat: r.lat, lon: r.lon });
  },
  "export-ics": () => download("mi-jardin.ics", buildICS(state.data.plants, state.data.log, localToday(), here().lat), "text/calendar"),
  "export-json": () => download(`mi-jardin-${localToday()}.json`, JSON.stringify(state.data), "application/json"),
  "import-json": () => $("importFile").click(),
  "ai-fill": () => aiFill(),
  "sp-toggle": () => {
    const card = $("speciesCard");
    if (!card) return;
    if (card.classList.contains("open")) { refreshSpeciesCard(); card.classList.remove("open"); } else card.classList.add("open");
  },
  "edit-zone": (d, el) => {
    $("editZone").value = d.zone;
    $("editZone").hidden = true;
    $("zoneChips").querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === el));
    formDirty = true;
  },
  "edit-new-zone": (d, el) => {
    $("editZone").value = "";
    $("editZone").hidden = false;
    $("zoneChips").querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === el));
    $("editZone").focus();
    formDirty = true;
  },
  "edit-alt": (d) => aiFill(altQuery(JSON.parse($("plantForm").dataset.alternatives)[+d.i])),
  "upgrade-plants": () => { if (!upgrade?.running) upgradePlants(); },
  "upgrade-later": () => { store.set("mj_upgrade_later", CARE_VERSION); render(); },
  "upgrade-close": () => { upgrade = null; render(); },
};

document.addEventListener("click", (e) => {
  const tab = e.target.closest(".tabbar button");
  if (tab) { state.tab = tab.dataset.tab; render(); return; }
  if (e.target.closest("#placeBtn")) return placeSheet();
  const el = e.target.closest("[data-action]");
  if (el && actions[el.dataset.action]) {
    e.preventDefault();
    if (!wiz && el.dataset.action.startsWith("wiz-")) return; // a button left over from a closed «Nueva planta»
    actions[el.dataset.action](el.dataset, el);
  }
});

document.addEventListener("input", (e) => {
  if (e.target.id === "wizNick" && wiz) wiz.nick = e.target.value;
  if (e.target.classList?.contains("autogrow")) autogrow(e.target);
  if (e.target.closest("#plantForm")) formDirty = true;
  e.target.closest(".st-cell")?.classList.remove("ai");
  if (!wiz) return;
  if (e.target.id === "wizZone") wiz.zone = e.target.value;
  const { season, kind } = e.target.dataset ?? {};
  if (season && kind) {
    wiz.seasons[season][kind] = Math.max(kind === "water" ? 1 : 0, parseInt(e.target.value, 10) || 0);
    wiz.touched[`${season}.${kind}`] = true;
  }
});

document.addEventListener("change", async (e) => {
  if (e.target.closest("#plantForm")) formDirty = true;
  if (e.target.id === "exploreCam" && e.target.files[0]) {
    const file = e.target.files[0];
    e.target.value = "";
    return exploreFromFile(file);
  }
  if (e.target.id === "dgPhotoInput" && e.target.files[0] && diag) {
    const file = e.target.files[0];
    e.target.value = "";
    diagRead();
    diag.photo = await shrinkPhoto(file, 900).catch(() => null) ?? diag.photo;
    return diagSheet();
  }
  if (e.target.id === "idPhotoInput" && e.target.files[0] && wiz) {
    const file = e.target.files[0];
    e.target.value = "";
    return identifyFromFile(file);
  }
  if (e.target.id === "photoInput" && e.target.files[0]) {
    const picked = await shrinkPhoto(e.target.files[0]).catch(() => null);
    if (!picked) return;
    draftPhoto = picked;
    if (wiz?.step === 2) {
      wiz.photoFromId = false;
      wiz.nick = $("wizNick")?.value ?? wiz.nick;
      if ($("wizZone")) wiz.zone = $("wizZone").value;
      renderWizard();
    } else $("photoPreview").innerHTML = `<img class="thumb" src="${draftPhoto}" alt="" />`;
  }
  if (e.target.classList.contains("tile-photo") && e.target.files[0]) {
    const p = plantById(e.target.dataset.id);
    const photo = await shrinkPhoto(e.target.files[0]).catch(() => null);
    if (p && photo) { p.photo = photo; save(); render(); }
  }
  if (e.target.id === "importFile" && e.target.files[0]) {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (!Array.isArray(data.plants) || !Array.isArray(data.log)) throw new Error("formato");
      if (!confirm(`Importar ${data.plants.length} plantas? Sustituye lo que hay ahora en este dispositivo.`)) return;
      data.plants.forEach(scrubPlant);
      state.data = data; save(); render();
    } catch { alert("Ese archivo no es una copia de Florvia."); }
    e.target.value = "";
  }
});

document.addEventListener("submit", (e) => {
  if (e.target.id === "zoneForm") {
    e.preventDefault();
    saveZoneInfo(e.target);
    return;
  }
  if (e.target.id === "aiCodeForm") {
    e.preventDefault();
    saveCode(new FormData(e.target).get("code").trim());
    return;
  }
  if (e.target.id === "exploreForm") {
    e.preventDefault();
    const name = new FormData(e.target).get("name").trim();
    if (name) exploreLookup(name);
    return;
  }
  if (e.target.id === "wizName") {
    e.preventDefault();
    if (!wiz) return; // the wizard was closed but its old form is still in the page (e.g. «Intro» on a keyboard that kept the focus)
    if (wiz.identify?.state === "loading") return;
    const name = new FormData(e.target).get("name").trim();
    if (!name) return;
    const changed = name !== wiz.name;
    wiz.name = name;
    if (changed) wiz.query = null;
    wiz.step = 2;
    if (changed || wiz.ai === "error" || wiz.ai === "notplant") {
      wiz.care = null;
      if (aiGo()) return wizLookup();
      wiz.ai = "idle";
    }
    renderWizard();
    return;
  }
  if (e.target.id !== "plantForm") return;
  formDirty = false;
  e.preventDefault();
  const f = new FormData(e.target);
  const id = e.target.dataset.id;
  const fields = {
    name: f.get("name").trim(),
    nick: (f.get("nick") ?? "").trim(),
    species: f.get("species").trim(),
    zone: f.get("zone").trim(),
    seasons: readSeasonTable(f),
    rainReaches: f.get("rainReaches") === "true",
    inPot: f.get("inPot") === "true",
    frostSensitive: f.has("frostSensitive"),
    autoWater: f.has("autoWater"),
    sun: f.get("sun") ?? "",
    size: f.get("size") ?? "",
    notes: f.get("notes").trim(),
    ...(f.get("sunNeed") || f.has("sunSensitive") ? { sunNeed: f.get("sunNeed") || "partial", sunSensitive: f.has("sunSensitive") } : { sunNeed: "", sunSensitive: false }),
    photo: draftPhoto,
  };
  withCurrentIntervals(fields);
  if (e.target.dataset.aiFilled) fields.careVersion = Math.max(3, Math.min(careVersionOf(plantById(id) ?? {}), CARE_VERSION));
  if (e.target.dataset.aiSnapshot) fields.ai = JSON.parse(e.target.dataset.aiSnapshot);
  if (e.target.dataset.sunFields) Object.assign(fields, JSON.parse(e.target.dataset.sunFields));
  if (e.target.dataset.info) fields.info = JSON.parse(e.target.dataset.info);
  if (e.target.dataset.tips && e.target.dataset.tips !== "null") fields.tips = JSON.parse(e.target.dataset.tips);
  if (e.target.dataset.feedTypes && e.target.dataset.feedTypes !== "null") fields.feedTypes = JSON.parse(e.target.dataset.feedTypes);
  if (id) Object.assign(plantById(id), fields);
  else state.data.plants.push({ id: uid(), created: localToday(), ...fields });
  save();
  render();
  const savedId = id || state.data.plants.at(-1).id;
  plantSheet(savedId);
  if (e.target.dataset.aiFilled) fetchCalendarFor(savedId);
});

// ---------- Usage (anonymous counts) ----------
// Event names only (no plant names, notes or location) plus a random id per install, batched and
// sent to the Worker on start, after a few seconds of activity and when the app goes to the
// background. See «Uso de la app» in Ajustes (only with the access code).
const deviceId = store.get("mj_device", null) ?? (() => { const id = crypto.randomUUID(); store.set("mj_device", id); return id; })();
let eventQueue = store.get("mj_events", []);
let flushTimer = null;
function track(name) {
  eventQueue.push(name);
  store.set("mj_events", eventQueue);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushEvents, 5000);
}
function flushEvents() {
  if (!eventQueue.length) return;
  const batch = eventQueue.splice(0, 50);
  store.set("mj_events", eventQueue);
  // text/plain keeps it a "simple" request (no CORS preflight); keepalive lets it finish on close.
  fetch(`${API}/event`, { method: "POST", keepalive: true, headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ device: deviceId, garden: usageId?.startsWith("g:") ? usageId : "", ref: store.get("mj_ref", ""), events: batch }) })
    .catch(() => { eventQueue = batch.concat(eventQueue); store.set("mj_events", eventQueue); });
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { flushEvents(); if (pushTimer) pushNow(); }
  else { pullNow(); if (weatherAt && Date.now() - weatherAt > 30 * 60000) refreshWeather(); }
});

// ---------- Start ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
render();
refreshUsageId();
loadFeedback();
// A shared-garden link (#jardin=KEY) opens the join sheet; otherwise bring the synced garden down.
// Links from the blog: ?ref=<page> (first touch is remembered for the usage report), #anadir=<plant> starts adding it
// and #explorar[=<plant>] opens Explorar.
{
  const ref = new URLSearchParams(location.search).get("ref");
  if (ref && /^[a-z0-9-]{1,60}$/.test(ref) && !store.get("mj_ref", "")) store.set("mj_ref", ref);
  const hash = new URLSearchParams(location.hash.slice(1));
  const linked = parseKey(hash.get("jardin"));
  const sharedId = hash.get("ver") ?? hash.get("planta");
  const caseLink = /^[A-Za-z0-9]{6,20}$/.test(hash.get("caso") ?? "") ? hash.get("caso") : "";
  const demoSlug = /^[a-z0-9-]{2,30}$/.test(hash.get("ejemplo") ?? "") ? hash.get("ejemplo") : "";
  const addName = hash.get("anadir");
  if (demoSlug && !(sharedId || linked)) {
    history.replaceState(null, "", location.pathname + location.search);
    pullNow();
    setTimeout(() => openDemo(demoSlug), 400);
  } else
  if (caseLink && !(sharedId || linked)) {
    history.replaceState(null, "", location.pathname + location.search);
    pullNow();
    setTimeout(() => openCase(caseLink), 600);
  } else
  if (addName && addName.length <= 60 && !(sharedId || linked)) {
    history.replaceState(null, "", location.pathname);
    pullNow();
    setTimeout(() => {
      newPlantWizard();
      if (!wiz) return;
      Object.assign(wiz, { name: addName.trim(), query: null, step: 2 });
      if (aiGo()) wizLookup(); else renderWizard();
    }, 600);
  } else if (hash.has("explorar") && !(sharedId || linked)) {
    const name = (hash.get("explorar") ?? "").trim().slice(0, 60);
    history.replaceState(null, "", location.pathname);
    pullNow();
    setTimeout(() => { if (name && aiGo()) exploreLookup(name); else { explore = { state: "idle" }; exploreSheet(); } }, 600);
  } else
  if (sharedId && /^[a-z0-9]{10}$/.test(sharedId)) {
    history.replaceState(null, "", location.pathname + location.search);
    openShared(sharedId);
    pullNow();
  } else if (linked) {
    history.replaceState(null, "", location.pathname + location.search);
    if (linked === syncKey()) pullNow();
    else joinSheet(linked);
  } else pullNow();
}
// Back from the payment page (success_url ?premium=ok): the plan changes when Polar's webhook arrives, so look again a few times.
if (new URLSearchParams(location.search).get("premium") === "ok") {
  history.replaceState(null, "", location.pathname + location.hash);
  premiumUi.thanks = true;
  setTimeout(() => { loadMe(); premiumSheet("", true); }, 800);
  [4000, 9000, 18000].forEach((ms) => setTimeout(loadMe, ms));
}
loadWeather();
// One «open» per half hour at most, so switching apps back and forth doesn't inflate it.
if (Date.now() - store.get("mj_last_open", 0) > 30 * 60000) { store.set("mj_last_open", Date.now()); track("app_open"); }
setTimeout(flushEvents, 1500);
