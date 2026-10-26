// Garage helpers with no Firebase in them, so tests/garage.test.mjs can run them in Node.
// garage.html imports the time clock's own helpers (vanKey, manualVans, oilState...) from ../timeclock/tc-core.js
// and passes vanKey in where a vehicle name has to be turned into its key.
//
// Everything is matched by the vehicle's NAME (its key, vanKey(name)), never by a GPS unit: the GPS units move
// from vehicle to vehicle, so they say nothing about which vehicle a record is about.
//
// Database layout (same Firebase project as the time clock, see README):
//   garage/categories/{catId}                    { name, order, fields }  the sections every vehicle has (Lights, Fluids...)
//       fields/{key}                               { name, order, off }  which fields its entries have and what each is
//                                                  called (see categoryFields); no fields: the five built-in ones
//   garage/vehicles/{vkey}                       vkey is vanKey(name), the same key timeclock/oil_last uses
//       name                                       the vehicle's name
//       listed                                     true: added in Garage (it isn't in the time clock's van list)
//       removed                                    true: removed in Garage (hidden even if the time clock lists it)
//       items/{id}                                 { cat, label, value, part, link, note, extra, added, addedBy, at, by }
//                                                  extra/{key}: the category's own fields; at least one field is filled in
//       service/{id}                               { day: "YYYY-MM-DD", what, km, cost, note, added, addedBy, at, by }
//       reminders/{id}                             { what, dueKm, dueDay, everyKm, everyMonths, note, added, addedBy, at, by }
//       odo                                        { km, day, at, by }  the last km reading someone entered
//   garage/trash/{id}                            { at, by, kind, vkey, vname, id, data }  deleted things, kept 30 days
//   garage/history/{vkey}/{id}                   { at, by, text }  what changed on each vehicle ("_all": all vehicles)
//   garage/problem_reads/{reportId}              { at, by }  a problem marked as read: it no longer counts on the tab
//   garage/problem_cleared/{reportId}            { at, by }  a fixed problem taken off the Vehicle checks tab
//   garage/oil_cleared/{ek}/{shiftId}            { at, by }  an oil check taken off the Vehicle checks tab
//   garage/oil_shown/{ek}/{shiftId}              { at, by }  a cleared oil check brought back from search (shows even when older)
//   (added/addedBy: who first saved it and when; at/by: the last change)
// Read from the time clock:
//   timeclock/vans/{id}                          the time clock's vans (Admin → Vehicles → Vehicles without GPS)
//   developer/dispatch_dashboard/drivers         the RouteWatcher vehicles (GPS), when GPS_UNITS_ARE_VEHICLES in garage.html
//   timeclock/van_reports/{id}                   Vehicle Check reports (problems); Garage adds, fixes and reopens them
//   timeclock/shifts/{ek}/{id}/oil               the oil check on each shift; Garage marks a missed one as seen
//   timeclock/oil_plan, timeclock/oil_last       the oil check schedule (edited here) and the last check per vehicle

export const DEFAULT_CATEGORIES = [
    ["lights", "Lights"], ["fluids", "Fluids"], ["tires", "Tires"], ["filters", "Filters"],
    ["wipers", "Wipers"], ["battery", "Battery"], ["plate", "Plate / VIN"], ["notes", "Notes"]
];
export function defaultCategories() {
    const out = {};
    DEFAULT_CATEGORIES.forEach(([id, name], i) => { out[id] = { name: name, order: i }; });
    return out;
}

// The longest text each field takes (database.rules.json checks the same numbers)
export const MAX = { catName: 40, vname: 60, label: 60, value: 200, part: 80, link: 500, note: 500, what: 120, by: 100, problem: 1000, fixNote: 300, history: 300 };
export const KM_MAX = 10000000, COST_MAX = 1000000, EVERY_KM_MAX = 1000000, EVERY_MONTHS_MAX = 120;
export const TRASH_DAYS = 30;                  // deleted things can be put back for this long
export const SOON_DAYS = 14, SOON_KM = 1000;    // a service reminder is "due soon" this close to its date or km
export const HISTORY_ALL = "_all";             // garage/history key for changes that aren't about one vehicle

export function sortCategories(cats) {
    return Object.entries(cats || {})
        .filter(([, c]) => c && String(c.name || "").trim())
        .map(([id, c]) => ({ id: id, name: String(c.name).trim(), order: typeof c.order === "number" ? c.order : 999, fields: categoryFields(c) }))
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

// ---------- A category's fields ----------
// The five fields every entry could always have. A category can turn each off and give it its own name, and add its
// own text fields (key "x" + an id, saved in the entry's extra/{key}).
export const BUILTIN_FIELDS = [
    { key: "label", name: "What", max: MAX.label, placeholder: "Headlight" },
    { key: "value", name: "Type or size", max: MAX.value, placeholder: "H11" },
    { key: "part", name: "Part number", max: MAX.part, placeholder: "Optional" },
    { key: "link", name: "Where to buy (link)", max: MAX.link, placeholder: "Optional, https://…", link: true, wide: true },
    { key: "note", name: "Note", max: MAX.note, placeholder: "Optional", long: true, wide: true }
];
export const EXTRA_MAX = 200, FIELDS_MAX = 20;
export const isExtraKey = k => /^x[A-Za-z0-9_-]{1,30}$/.test(k);
const builtin = k => BUILTIN_FIELDS.find(f => f.key === k);

// A category's fields in order, the ones turned off too: [{ key, name, on, extra, max, placeholder, link, long, wide }].
// A category saved before fields existed (or the "Other" group) has the five built-in ones, all on.
export function categoryFields(cat) {
    const raw = cat && cat.fields && typeof cat.fields === "object" ? cat.fields : null;
    if (!raw) return BUILTIN_FIELDS.map(f => Object.assign({}, f, { on: true, extra: false }));
    const list = BUILTIN_FIELDS.map((f, i) => {
        const r = raw[f.key];
        const name = r && String(r.name || "").trim();
        return Object.assign({}, f, { name: name || f.name, on: !!r && !r.off, extra: false, order: r && typeof r.order === "number" ? r.order : 100 + i, placeholder: !name || name === f.name ? f.placeholder : "" });
    });
    for (const [k, r] of Object.entries(raw)) {
        const name = r && String(r.name || "").trim();
        if (isExtraKey(k) && name) list.push({ key: k, name: name, on: !r.off, extra: true, max: EXTRA_MAX, placeholder: "", order: typeof r.order === "number" ? r.order : 999 });
    }
    return list.sort((a, b) => a.order - b.order).map(f => { delete f.order; return f; });
}

// The fields from the category editor ([{ key, name, on }], in order) ready to save as garage/categories/{id}/fields:
// { ok: true, value } or { ok: false, error }
export function cleanFields(rows) {
    const value = {};
    let on = 0;
    const names = new Set();
    for (const [i, f] of (rows || []).entries()) {
        const b = builtin(f.key);
        if (!b && !isExtraKey(f.key)) continue;
        const name = trim(f.name, MAX.catName) || (b ? b.name : "");
        if (!name) { if (f.on) return { ok: false, error: "Give each field you check a name." }; continue; }
        if (f.on) {
            if (names.has(name.toLowerCase())) return { ok: false, error: "Two fields are called " + name + ". Give each one its own name." };
            names.add(name.toLowerCase()); on++;
        }
        value[f.key] = { name: name, order: i };
        if (!f.on) value[f.key].off = true;
    }
    if (!on) return { ok: false, error: "Check at least one field." };
    if (Object.keys(value).length > FIELDS_MAX) return { ok: false, error: "A category can have " + FIELDS_MAX + " fields at most." };
    return { ok: true, value: value };
}

// What a category's fields come to, for the Changes list: "Model number, Note"
export const fieldsText = fields => fields.filter(f => f.on).map(f => f.name).join(", ");

// Every field name any category gives a key, so an entry's own fields still have a name after it moves category.
export function fieldNames(cats) {
    const out = {};
    for (const c of cats || []) for (const f of c.fields || []) if (f.extra && !out[f.key]) out[f.key] = f.name;
    return out;
}

// The fields an entry shows, in its category's order, with its text: the category's fields that are on, plus any
// other field the entry has something in (so nothing saved is ever hidden). [{ ...field, text }]
export function entryFields(it, cat, names) {
    const fields = cat && cat.fields ? cat.fields : categoryFields(null);
    const text = f => String((f.extra ? (it && it.extra || {})[f.key] : it && it[f.key]) || "");
    const out = fields.filter(f => f.on || text(f)).map(f => Object.assign({}, f, { text: text(f) }));
    for (const [k, v] of Object.entries((it && it.extra) || {}))
        if (v && !out.some(f => f.key === k)) out.push({ key: k, name: (names && names[k]) || "Other field", on: false, extra: true, max: EXTRA_MAX, placeholder: "", text: String(v) });
    return out;
}

const hasText = v => v !== undefined && v !== null && String(v).trim() !== "";
export const hasContent = it => !!(it && (["label", "value", "part", "link", "note"].some(k => hasText(it[k])) || Object.values(it.extra || {}).some(hasText)));
// What an entry is called in lists and the Changes list: its name, or else the first thing filled in
export function entryTitle(it) {
    if (!it) return "";
    for (const k of ["label", "value", "part"]) if (hasText(it[k])) return String(it[k]);
    const x = Object.values(it.extra || {}).find(hasText);
    return x ? String(x) : hasText(it.note) ? String(it.note).slice(0, 60) : hasText(it.link) ? String(it.link) : "";
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
const byKey = (a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }) || byName(a, b);
export const hasData = s => !!(s && (s.items || s.service || s.reminders || s.odo));

// Every vehicle Garage shows, one per key:
//   the time clock's vehicles (clock: [{ name }], the vans in Admin → Vehicles → Vehicles without GPS),
//   plus the ones added in Garage (listed), plus any that still have something saved here,
//   minus the ones removed in Garage.
// [{ key, name, inClock, listed }]. A vehicle with neither inClock nor listed only has old entries (it left the list).
export function garageVehicles(clock, stored, keyOf) {
    const map = new Map();
    stored = stored || {};
    for (const v of clock || []) {
        const key = keyOf(v.name);
        if (!key || map.has(key) || (stored[key] && stored[key].removed)) continue;
        map.set(key, { key: key, name: String(v.name).trim(), inClock: true, listed: !!(stored[key] && stored[key].listed) });
    }
    for (const [key, s] of Object.entries(stored)) {
        if (map.has(key) || !s || s.removed || !(s.listed || hasData(s))) continue;
        map.set(key, { key: key, name: String(s.name || key), inClock: false, listed: !!s.listed });
    }
    // In key order, so "Van 12" sorts between "3" and "14"
    const shown = v => v.inClock || v.listed;
    return Array.from(map.values()).sort((a, b) => shown(b) - shown(a) || byKey(a, b));
}

// Vehicle Check reports as a list: open ones first, then the newest. Fixed ones stay in the list.
// vkey: the vehicle the report names (by its name only).
export function reportList(reports, keyOf) {
    return Object.entries(reports || {})
        .filter(([, r]) => r && r.text)
        .map(([id, r]) => Object.assign({ id: id, vkey: keyOf(r.vehicleName || "") }, r))
        .sort((a, b) => (b.status === "open") - (a.status === "open") || (b.at || 0) - (a.at || 0));
}

// The vehicle a shift's oil check is about: the shift's vehicle, or the last one in its van history
export function shiftVehicle(s) {
    if (s.vehicleName || s.vehicleId) return { id: s.vehicleId || "", name: s.vehicleName || "" };
    const last = Object.values(s.vans || {}).filter(v => v && v.vehicleName && typeof v.at === "number").sort((a, b) => a.at - b.at).pop();
    return last ? { id: last.vehicleId || "", name: last.vehicleName } : { id: "", name: "" };
}

// Why a shift that's over has no oil check (the same wording the admin panel used)
export function oilMissWhy(s) {
    if (s.oil && s.oil.done === false) return "Said at punch out they didn't check it";
    if (typeof s.outTap !== "number" && (s.src === "admin" || s.edited)) return "Punched out by the office, so they weren't asked";
    return "Didn't answer at punch out";
}

// Oil checks from shifts: [{ ek, s, state, open, vkey, vname }], newest first. state is oilState() from tc-core:
// "checked" | "waiting" (on the clock, not checked yet) | "missed"; "none" and "notdue" are left out.
// open: a missed check nobody has marked as seen yet.
export function oilList(shiftsByEk, since, oilState, keyOf) {
    const out = [];
    for (const [ek, list] of Object.entries(shiftsByEk || {})) {
        for (const s of list || []) {
            if (!s || typeof s.in !== "number" || s.in < since) continue;
            const st = oilState(s);
            if (st === "none" || st === "notdue") continue;
            const v = shiftVehicle(s);
            out.push({ ek: ek, s: s, state: st, open: st === "missed" && !(s.oil && s.oil.seenBy), vkey: keyOf(v.name), vname: v.name });
        }
    }
    return out.sort((a, b) => (b.state === "waiting") - (a.state === "waiting") || b.s.in - a.s.in);
}

// ---------- The Vehicle checks tab: read, cleared and search ----------
// Problems with read (marked as read, so it no longer counts on the tab) and cleared (taken off the tab).
// Only a fixed problem can be cleared: a reopened one shows again even if its cleared mark is still there.
export function problemMarks(list, reads, cleared) {
    return list.map(r => Object.assign({}, r, { read: !!(reads && reads[r.id]), cleared: r.status !== "open" && !!(cleared && cleared[r.id]) }));
}
// The ones that count on the tab: open and not read yet
export const problemUnread = r => r.status === "open" && !r.read;
// Oil checks (oilList() output) with cleared, and shown (brought back from search)
export function oilMarks(list, cleared, shown) {
    const has = (m, o) => !!(m && m[o.ek] && m[o.ek][o.s.id]);
    return list.map(o => Object.assign({}, o, { cleared: has(cleared, o), shown: has(shown, o) }));
}
// Shifts by employee from several places, each shift once (the first one found wins)
export function mergeShifts(...maps) {
    const out = {};
    for (const m of maps) for (const [ek, list] of Object.entries(m || {})) {
        const have = new Set((out[ek] || []).map(s => s.id));
        out[ek] = (out[ek] || []).concat((list || []).filter(s => s && !have.has(s.id)));
    }
    return out;
}
// Every word typed has to be in one of the texts
export function matchesAll(q, texts) {
    const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
    const hay = texts.filter(t => t !== undefined && t !== null && t !== "").join(" ").toLowerCase();
    return words.every(w => hay.includes(w));
}
export const problemWords = r => [r.text, r.vehicleName, r.vehicleName ? "van " + r.vehicleName : "", r.name, r.fixNote, r.by, r.status === "open" ? "open" : "fixed"];

// ---------- The date range calendar ----------
const pad2 = n => String(n).padStart(2, "0");
export const dayOf = (y, m, d) => y + "-" + pad2(m + 1) + "-" + pad2(d); // m: 0 is January
// A month's weeks, Monday first, with null before the 1st and after the last day
export function monthWeeks(y, m) {
    const lead = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;
    const n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const cells = Array(lead).fill(null);
    for (let d = 1; d <= n; d++) cells.push(dayOf(y, m, d));
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
}
// Tapping a day: the first tap picks the start, the second the end (an earlier day swaps them), a third starts again
export function rangePick(range, day) {
    const from = range && range.from, to = range && range.to;
    if (!from || to) return { from: day, to: "" };
    return day < from ? { from: day, to: from } : { from: from, to: day };
}

// A vehicle's entries grouped by category, in category order. Entries whose category was deleted go under "Other".
export function itemGroups(items, cats) {
    const list = Object.entries(items || {}).filter(([, it]) => hasContent(it)).map(([id, it]) => Object.assign({ id: id }, it))
        .sort((a, b) => entryTitle(a).localeCompare(entryTitle(b), undefined, { numeric: true, sensitivity: "base" }));
    const known = new Set(cats.map(c => c.id));
    const groups = cats.map(c => ({ cat: c, items: list.filter(it => it.cat === c.id) }));
    const other = list.filter(it => !known.has(it.cat));
    if (other.length) groups.push({ cat: { id: "", name: "Other" }, items: other });
    return groups;
}

// Service log, newest day first
export function serviceList(service) {
    return Object.entries(service || {}).filter(([, e]) => e && e.what && e.day).map(([id, e]) => Object.assign({ id: id }, e))
        .sort((a, b) => b.day.localeCompare(a.day) || (b.at || 0) - (a.at || 0));
}

// Search every vehicle's entries, service log and reminders. Every word must appear somewhere in the entry (or the
// vehicle or category name). [{ vehicle, kind: "item" | "service" | "reminder", catName, entry }]
export function searchGarage(q, vehicles, stored, cats) {
    const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const catName = id => (cats.find(c => c.id === id) || { name: "Other" }).name;
    const hit = text => words.every(w => text.toLowerCase().includes(w));
    const out = [];
    for (const v of vehicles) {
        const s = stored && stored[v.key];
        if (!s) continue;
        for (const [id, it] of Object.entries(s.items || {})) {
            if (!hasContent(it)) continue;
            const cn = catName(it.cat);
            if (hit([v.name, "van " + v.name, cn, it.label, it.value, it.part, it.note].concat(Object.values(it.extra || {})).filter(Boolean).join(" "))) out.push({ vehicle: v, kind: "item", catName: cn, entry: Object.assign({ id: id }, it) });
        }
        for (const [id, e] of Object.entries(s.service || {})) {
            if (!e || !e.what) continue;
            if (hit([v.name, "van " + v.name, "service", e.what, e.note, e.day].filter(Boolean).join(" "))) out.push({ vehicle: v, kind: "service", catName: "Service log", entry: Object.assign({ id: id }, e) });
        }
        for (const [id, r] of Object.entries(s.reminders || {})) {
            if (!r || !r.what) continue;
            if (hit([v.name, "van " + v.name, "reminder due", r.what, r.note, r.dueDay].filter(Boolean).join(" "))) out.push({ vehicle: v, kind: "reminder", catName: "Service due", entry: Object.assign({ id: id }, r) });
        }
    }
    return out.sort((a, b) => byName(a.vehicle, b.vehicle) || a.catName.localeCompare(b.catName));
}

// ---------- Dates ("YYYY-MM-DD" day keys, as the time clock's dayKey() makes them) ----------
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayUtc = k => { const [y, m, d] = k.split("-").map(Number); return Date.UTC(y, m - 1, d); };
export function daysBetween(from, to) { return Math.round((dayUtc(to) - dayUtc(from)) / 86400000); }
// n months after a day; the 31st becomes the last day of a shorter month
export function addMonths(key, n) {
    const [y, m, d] = key.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    return t.getUTCFullYear() + "-" + String(t.getUTCMonth() + 1).padStart(2, "0") + "-" + String(Math.min(d, last)).padStart(2, "0");
}

// ---------- Km and service reminders ----------
// The vehicle's km as far as we know: the larger of the last reading entered and the km on the service log
export function currentKm(s) {
    let km = s && s.odo && typeof s.odo.km === "number" ? s.odo.km : null;
    for (const e of Object.values((s && s.service) || {})) if (e && typeof e.km === "number" && (km === null || e.km > km)) km = e.km;
    return km;
}

// How a reminder stands: { state: "overdue" | "soon" | "ok", kmLeft, daysLeft } (kmLeft null when the km isn't known)
export function reminderState(r, km, today) {
    const kmLeft = typeof r.dueKm === "number" && typeof km === "number" ? r.dueKm - km : null;
    const daysLeft = typeof r.dueDay === "string" && DAY_RE.test(r.dueDay) ? daysBetween(today, r.dueDay) : null;
    const state = (kmLeft !== null && kmLeft <= 0) || (daysLeft !== null && daysLeft <= 0) ? "overdue"
        : (kmLeft !== null && kmLeft <= SOON_KM) || (daysLeft !== null && daysLeft <= SOON_DAYS) ? "soon" : "ok";
    return { state: state, kmLeft: kmLeft, daysLeft: daysLeft };
}
const STATE_ORDER = { overdue: 0, soon: 1, ok: 2 };
// A vehicle's reminders, the most urgent first: [{ id, ...reminder, st: reminderState }]
export function reminderList(reminders, km, today) {
    return Object.entries(reminders || {}).filter(([, r]) => r && r.what).map(([id, r]) => Object.assign({ id: id }, r, { st: reminderState(r, km, today) }))
        .sort((a, b) => STATE_ORDER[a.st.state] - STATE_ORDER[b.st.state] || (a.dueDay || "9").localeCompare(b.dueDay || "9") || (a.dueKm || 0) - (b.dueKm || 0));
}
// The most urgent state of a vehicle's reminders ("overdue", "soon", or "" when nothing is due)
export function serviceDue(s, today) {
    const list = reminderList(s && s.reminders, currentKm(s), today);
    return list.length && list[0].st.state !== "ok" ? list[0].st.state : "";
}

// A number from a form box ("182,500", "$89.99"): undefined when empty, "bad" when it isn't a number in range
function num(v, max, min) {
    const s = String(v === null || v === undefined ? "" : v).replace(/[$,\s]/g, "");
    if (!s) return undefined;
    const n = Number(s);
    return Number.isFinite(n) && n >= (min || 0) && n <= max ? n : "bad";
}

// A reminder from the form, ready to save. km: the vehicle's km now (null if unknown), today: a day key.
// It needs a km or a date it's due at, or how often it repeats (then the first one is counted from now).
export function cleanReminder(raw, km, today) {
    const what = trim(raw.what, MAX.what);
    if (!what) return { ok: false, error: "Say what's due, for example Oil change." };
    const dueKm = num(raw.dueKm, KM_MAX), everyKm = num(raw.everyKm, EVERY_KM_MAX, 1), everyMonths = num(raw.everyMonths, EVERY_MONTHS_MAX, 1);
    const dueDay = String(raw.dueDay || "");
    if (dueKm === "bad") return { ok: false, error: "The km it's due at should be a number, for example 190000." };
    if (everyKm === "bad") return { ok: false, error: "Every … km should be a number, for example 8000." };
    if (everyMonths === "bad" || (everyMonths !== undefined && !Number.isInteger(everyMonths))) return { ok: false, error: "Every … months should be a whole number from 1 to 120." };
    if (dueDay && !DAY_RE.test(dueDay)) return { ok: false, error: "Pick the date it's due." };
    const value = { what: what };
    if (dueKm !== undefined) value.dueKm = Math.round(dueKm);
    if (dueDay) value.dueDay = dueDay;
    if (everyKm !== undefined) value.everyKm = Math.round(everyKm);
    if (everyMonths !== undefined) value.everyMonths = everyMonths;
    if (value.dueKm === undefined && value.everyKm !== undefined) {
        if (typeof km !== "number" && value.dueDay === undefined && value.everyMonths === undefined) return { ok: false, error: "Enter the km it's due at, or update the vehicle's km first." };
        if (typeof km === "number") value.dueKm = km + value.everyKm;
    }
    if (value.dueDay === undefined && value.everyMonths !== undefined) value.dueDay = addMonths(today, value.everyMonths);
    if (value.dueKm === undefined && value.dueDay === undefined) return { ok: false, error: "Enter the km or the date it's due, or how often it repeats." };
    const note = trim(raw.note, MAX.note);
    if (note) value.note = note;
    return { ok: true, value: value };
}

// The next time a repeating reminder is due after it's done at doneKm (may be undefined) on doneDay.
// null: it doesn't repeat, so it's finished.
export function nextReminder(r, doneKm, doneDay) {
    if (!r.everyKm && !r.everyMonths) return null;
    const next = {};
    if (r.everyKm) {
        const from = typeof doneKm === "number" ? doneKm : typeof r.dueKm === "number" ? r.dueKm : null;
        if (from !== null) next.dueKm = from + r.everyKm;
    }
    if (r.everyMonths) next.dueDay = addMonths(doneDay, r.everyMonths);
    if (next.dueKm === undefined && next.dueDay === undefined) return null;
    return next;
}

export function cleanOdo(raw) {
    const km = num(raw.km, KM_MAX);
    if (km === undefined || km === "bad") return { ok: false, error: "Enter the km on the dash, for example 182500." };
    return { ok: true, value: { km: Math.round(km) } };
}

export function cleanProblem(raw) {
    const text = trim(raw.text, MAX.problem);
    if (!text) return { ok: false, error: "Say what's wrong, for example Passenger headlight out." };
    return { ok: true, value: { text: text } };
}

export function cleanVehicleName(raw) {
    const name = trim(raw, MAX.vname);
    if (!name) return { ok: false, error: "Give it a name, for example 14." };
    return { ok: true, value: name };
}

// ---------- Who saved it and when ----------
// The fields to save with an entry: who first added it is kept when it's edited, and at/by are the last change.
// Older entries only have at/by, which was when they were added.
export function stamps(old, who, ts) {
    const added = old ? (old.added !== undefined ? old.added : old.at) : ts;
    const addedBy = old ? (old.addedBy !== undefined ? old.addedBy : old.by) : who;
    const out = { at: ts, by: who };
    if (added !== undefined) out.added = added;
    if (addedBy !== undefined) out.addedBy = addedBy;
    return out;
}

// ---------- Edit history ----------
// Each edit to an entry or a problem keeps { at, by, was }: who edited it, when, and what each changed field said
// before ("" when it was empty). The newest EDITS_MAX are kept.
export const EDITS_MAX = 20;
export const ITEM_KEYS = ["label", "value", "part", "link", "note"];
export const SERVICE_KEYS = ["day", "what", "km", "cost", "note"];
export const REMINDER_KEYS = ["what", "dueKm", "dueDay", "everyKm", "everyMonths", "note"];
export const PROBLEM_KEYS = ["text", "fixNote"];
const fieldOf = (e, k) => {
    const v = e ? (isExtraKey(k) ? (e.extra || {})[k] : e[k]) : undefined;
    return v === undefined || v === null ? "" : v;
};
// An entry's keys to compare: the given ones plus any own field (x…) either version has
export function editKeys(old, next, keys) {
    const out = keys.slice();
    for (const e of [old, next]) for (const k of Object.keys((e && e.extra) || {})) if (isExtraKey(k) && !out.includes(k)) out.push(k);
    return out;
}
// { field: what it was } for each field that's different now; {} when nothing changed
export function editWas(old, next, keys) {
    const was = {};
    for (const k of keys) {
        const a = fieldOf(old, k), b = fieldOf(next, k);
        if (a !== b) was[k] = a;
    }
    return was;
}
// Newest first: [{ id, at, by, was }]. An edit still being saved (no number yet) counts as the newest.
export function editList(edits) {
    const t = e => typeof e.at === "number" ? e.at : Infinity;
    return Object.entries(edits || {}).filter(([, e]) => e && e.was && typeof e.was === "object" && Object.keys(e.was).length)
        .map(([id, e]) => ({ id: id, at: e.at, by: e.by || "", was: e.was })).sort((a, b) => t(b) - t(a));
}
// The ids of the oldest edits to delete so there's room for one more
export function editDrops(edits, max) {
    const list = editList(edits);
    return list.length < (max || EDITS_MAX) ? [] : list.slice((max || EDITS_MAX) - 1).map(e => e.id);
}
// The edits to save with an edited entry: the old ones (minus the oldest past EDITS_MAX) and the new one.
// null when nothing changed, so the entry keeps what it had.
export function withEdit(old, was, id, who, ts) {
    const kept = Object.assign({}, (old && old.edits) || {});
    if (!Object.keys(was).length) return Object.keys(kept).length ? kept : null;
    for (const d of editDrops(kept)) delete kept[d];
    kept[id] = { at: ts, by: who, was: was };
    return kept;
}

// ---------- Trash ----------
// Newest first: [{ tid, at, by, kind, vkey, vname, id, data }] (tid: its id in the trash, id: its id before)
export function trashList(trash) {
    return Object.entries(trash || {}).filter(([, t]) => t && t.kind && typeof t.at === "number")
        .map(([tid, t]) => Object.assign({}, t, { tid: tid })).sort((a, b) => b.at - a.at);
}
// The trash older than TRASH_DAYS, to delete for good
export function trashExpired(trash, now) {
    return trashList(trash).filter(t => t.at < now - TRASH_DAYS * 86400000).map(t => t.tid);
}
// The database writes that put a trashed thing back (paths under garage/vehicles/{vkey}), or null if it can't be
export function restoreWrites(t, vehiclesPath) {
    const base = vehiclesPath + "/" + t.vkey;
    const sect = { item: "items", service: "service", reminder: "reminders" }[t.kind];
    if (sect) return t.id && t.data ? { [base + "/" + sect + "/" + t.id]: t.data } : null;
    if (t.kind !== "vehicle") return null;
    const d = t.data || {}, u = { [base + "/removed"]: null, [base + "/name"]: String(d.name || t.vname || t.vkey).slice(0, MAX.vname) };
    if (d.listed) u[base + "/listed"] = true;
    if (d.odo) u[base + "/odo"] = d.odo;
    for (const s of ["items", "service", "reminders"]) for (const [id, v] of Object.entries(d[s] || {})) u[base + "/" + s + "/" + id] = v;
    return u;
}

// ---------- Spreadsheet export ----------
// Text a spreadsheet would otherwise run as a formula gets a ' in front
const cell = v => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-?\d+(\.\d+)?$/.test(s))) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export function toCsv(rows) { return rows.map(r => r.map(cell).join(",")).join("\r\n") + "\r\n"; }

export const CSV_HEAD = ["Vehicle", "Section", "Category", "What", "Type or size", "Part #", "Link", "Date", "Km", "Cost", "Status", "Note", "Added by", "Last changed by", "Other fields"];
// Every vehicle's info, service log, reminders and problems as spreadsheet rows (the header row first).
// fmtTs turns a time into text; problems: reportList() output.
export function csvRows(vehicles, stored, cats, problems, fmtTs) {
    const rows = [CSV_HEAD];
    const catName = id => (cats.find(c => c.id === id) || { name: "Other" }).name;
    const names = fieldNames(cats);
    // The category's own fields, "Model number: 1234; Colour: white"
    const extras = it => entryFields(it, cats.find(c => c.id === it.cat), names).filter(f => f.extra && f.text).map(f => f.name + ": " + f.text).join("; ");
    const ts = v => typeof v === "number" ? fmtTs(v) : "";
    for (const v of vehicles) {
        const s = stored[v.key] || {};
        for (const gr of itemGroups(s.items, cats)) for (const it of gr.items)
            rows.push([v.name, "Info", catName(it.cat), it.label, it.value, it.part, it.link, "", "", "", "", it.note, it.addedBy || it.by, it.by, extras(it)]);
        for (const e of serviceList(s.service))
            rows.push([v.name, "Service", "", e.what, "", "", "", e.day, e.km, e.cost, "Done", e.note, e.addedBy || e.by, e.by, ""]);
        for (const r of Object.values(s.reminders || {})) if (r && r.what)
            rows.push([v.name, "Reminder", "", r.what, [r.everyKm ? "every " + r.everyKm + " km" : "", r.everyMonths ? "every " + r.everyMonths + " months" : ""].filter(Boolean).join(", "),
                "", "", r.dueDay, r.dueKm, "", "Due", r.note, r.addedBy || r.by, r.by, ""]);
        for (const p of problems.filter(p => p.vkey === v.key))
            rows.push([v.name, "Problem", "", p.text, "", "", "", ts(p.at), "", "", p.status === "open" ? "Open" : "Fixed" + (p.fixNote ? ": " + p.fixNote : ""), "", p.name || "", p.by || "", ""]);
    }
    return rows;
}

const trim = (v, n) => String(v === null || v === undefined ? "" : v).trim().slice(0, n);

// Only plain web links are saved (no javascript: or other schemes). "" when it's empty, null when it isn't a link.
export function cleanLink(v) {
    let s = trim(v, MAX.link);
    if (!s) return "";
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
    try {
        const u = new URL(s);
        if (u.protocol !== "https:" && u.protocol !== "http:") return null;
        return u.href.length <= MAX.link ? u.href : null;
    } catch (e) { return null; }
}

// An entry from the form, ready to save: { ok: true, value } or { ok: false, error }
// raw: { cat, label, value, part, link, note, extra: { key: text } }. fields: the fields the form showed (entryFields);
// when the category has its "What" field on, that one has to be filled in, otherwise any one field will do.
export function cleanItem(raw, fields) {
    if (!raw.cat) return { ok: false, error: "Pick a category." };
    const labelField = fields ? fields.find(f => f.key === "label" && f.on) : builtin("label");
    const label = trim(raw.label, MAX.label);
    if (labelField && !label) return { ok: false, error: labelField.name === "What" ? "Give it a name, for example Headlight." : "Fill in " + labelField.name + "." };
    const link = cleanLink(raw.link);
    const linkName = (fields && fields.find(f => f.key === "link") || { name: "The link" }).name;
    if (link === null) return { ok: false, error: (linkName === "Where to buy (link)" ? "The link" : linkName) + " should be a web address, for example https://www.partsource.ca/…" };
    const value = { cat: String(raw.cat).slice(0, 40) };
    const v = trim(raw.value, MAX.value), part = trim(raw.part, MAX.part), note = trim(raw.note, MAX.note);
    if (label) value.label = label;
    if (v) value.value = v;
    if (part) value.part = part;
    if (link) value.link = link;
    if (note) value.note = note;
    const extra = {};
    for (const [k, x] of Object.entries(raw.extra || {})) { const t = trim(x, EXTRA_MAX); if (isExtraKey(k) && t) extra[k] = t; }
    if (Object.keys(extra).length) value.extra = extra;
    if (!hasContent(value)) return { ok: false, error: "Fill in at least one field." };
    return { ok: true, value: value };
}

export function cleanService(raw) {
    const what = trim(raw.what, MAX.what);
    if (!DAY_RE.test(String(raw.day || ""))) return { ok: false, error: "Pick the date it was done." };
    if (!what) return { ok: false, error: "Say what was done, for example Oil change." };
    const value = { day: raw.day, what: what };
    const km = num(raw.km, KM_MAX), cost = num(raw.cost, COST_MAX);
    if (km === "bad") return { ok: false, error: "The km should be a number, for example 182500." };
    if (cost === "bad") return { ok: false, error: "The cost should be a number, for example 89.99." };
    if (km !== undefined) value.km = Math.round(km);
    if (cost !== undefined) value.cost = Math.round(cost * 100) / 100;
    const note = trim(raw.note, MAX.note);
    if (note) value.note = note;
    return { ok: true, value: value };
}

export function fmtKm(n) { return Math.round(n).toLocaleString("en-CA") + " km"; }
export function fmtMoney(n) { return "$" + Number(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ---------- Ask AI ----------
// The Vehicle category: year, make, model, trim and engine, as the category's own fields (like any field added in
// the category window), so each vehicle has one entry in it. Garage adds it the first time someone asks for it.
export const VEHICLE_CAT_ID = "vehicle";
export const VEHICLE_CAT_FIELDS = {
    xyear: { name: "Year", order: 0 }, xmake: { name: "Make", order: 1 }, xmodel: { name: "Model", order: 2 },
    xtrim: { name: "Trim", order: 3 }, xengine: { name: "Engine", order: 4 },
    label: { name: "What", order: 5, off: true }, value: { name: "Type or size", order: 6, off: true },
    part: { name: "Part number", order: 7, off: true }, link: { name: "Where to buy (link)", order: 8, off: true },
    note: { name: "Note", order: 9 }
};
// The Vehicle category in sortCategories() output: the one Garage added, or one someone already called Vehicle
export const vehicleCat = cats => (cats || []).find(c => c.id === VEHICLE_CAT_ID) || (cats || []).find(c => /^vehicle( info| details)?$/i.test(c.name)) || null;
// "2019 Ford Transit 250 XLT", from the vehicle's entries in the Vehicle category ("" when nothing's saved)
export function vehicleSummary(s, cats) {
    const cat = vehicleCat(cats);
    if (!cat) return "";
    const got = {};
    for (const it of Object.values((s && s.items) || {})) {
        if (!it || it.cat !== cat.id) continue;
        for (const f of entryFields(it, cat, fieldNames(cats))) if (f.text && !got[f.name.toLowerCase()]) got[f.name.toLowerCase()] = f.text.trim();
    }
    return ["year", "make", "model", "trim"].map(k => got[k]).filter(Boolean).join(" ");
}

// The licence plate (not the VIN) is only sent when it's checked: an entry called Plate, or a field called Plate
const PLATE_RE = /\b(plates?|licen[cs]e)\b/i, VIN_RE = /\bvin\b/i;
export const isPlate = t => PLATE_RE.test(String(t || "")) && !VIN_RE.test(String(t || ""));

// The parts that can be sent, in order: [{ key, name, on, group, at }] (on: checked to start with). "c:" + id is a
// category, "c:" alone the Other group (entries whose category was deleted), there when other is true. Each problem
// (problems: reportList() for this vehicle) is "p:" + its id, with group "open" or "fixed" and at (when reported).
export function aiParts(cats, other, problems) {
    const prob = (list, group) => list.map(p => ({ key: "p:" + p.id, name: String(p.text).replace(/\s+/g, " "), on: true, group: group, at: p.at }));
    const ps = problems || [];
    return [{ key: "km", name: "Km", on: true }]
        .concat((cats || []).map(c => ({ key: "c:" + c.id, name: c.name, on: true })), other ? [{ key: "c:", name: "Other", on: true }] : [])
        .concat([{ key: "plate", name: "Licence plate", on: false }],
            prob(ps.filter(p => p.status === "open"), "open"), prob(ps.filter(p => p.status !== "open"), "fixed"),
            [{ key: "service", name: "Service log", on: true }, { key: "reminders", name: "Service due", on: true }, { key: "oil", name: "Oil checks", on: true }]);
}
// The two groups the problems are in
export const AI_GROUPS = { open: "Open problems", fixed: "Fixed problems" };

// Questions to start from
export const AI_QUESTIONS = [
    { name: "Diagnose problems", text: "What could be causing the open problems below, and what should we check first?" },
    { name: "Maintenance due", text: "What maintenance should this vehicle have at its current km, and is anything overdue going by the service log?" },
    { name: "Part numbers", text: "Find the right part numbers for this vehicle (bulbs, filters, wiper blades, battery) and say where they're usually sold in Canada." },
    { name: "Recalls and common issues", text: "What are the common problems and any recalls for this vehicle? Use the VIN if it's below." },
    { name: "Repair or replace", text: "Going by its age, km and repair history, is this vehicle worth repairing or close to the point of replacing?" }
];

// Where the text goes. None of them fills its box from a link for this much text, so it's copied and pasted.
export const AI_TARGETS = [
    { key: "gemini", name: "Gemini", url: "https://gemini.google.com/app" },
    { key: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/" },
    { key: "claude", name: "Claude", url: "https://claude.ai/new" }
];

// The question and the checked parts of a vehicle's records, as text to paste into an AI chat.
// o: { question, name, s (garage/vehicles/{key}), cats, problems (reportList() for this vehicle), oils (oilList() for
// this vehicle), oilLast ({ at } or null), oilDays, today (day key), day (time → day key), pick (Set of aiParts keys) }.
// People's names aren't sent.
export function aiText(o) {
    const pick = k => o.pick.has(k), s = o.s || {}, out = [];
    const day = t => typeof t === "number" ? o.day(t) : "";
    const section = (title, lines) => { if (lines.length) out.push("", title, ...lines); };
    out.push(String(o.question || "").trim() || "Tell me what's useful to know about this vehicle.");
    out.push("", "Below are our fleet records for this vehicle. Use them in your answer, look up anything else you need " +
        "(for example from the VIN), and say clearly when something is a guess.");
    out.push("", "VEHICLE: " + o.name, "Today: " + o.today);
    if (pick("km")) {
        const km = currentKm(s);
        out.push("Km: " + (km === null ? "not known" : fmtKm(km) + (s.odo && s.odo.km === km ? " (read on " + (s.odo.day || day(s.odo.at)) + ")" : " (from the service log)")));
    }
    const names = fieldNames(o.cats);
    for (const gr of itemGroups(s.items, o.cats)) {
        if (!pick("c:" + gr.cat.id)) continue;
        const lines = [];
        for (const it of gr.items) {
            let fs = entryFields(it, gr.cat.id ? gr.cat : null, names).filter(f => f.text.trim());
            const lab = fs.find(f => f.key === "label");
            if (!pick("plate")) {
                if (isPlate(lab ? lab.text : entryTitle(it))) continue;
                fs = fs.filter(f => !isPlate(f.name));
            }
            if (!fs.length) continue;
            const val = fs.find(f => f.key === "value");
            const head = lab ? lab.text + (val ? ": " + val.text : "") : "";
            const rest = fs.filter(f => !lab || (f !== lab && f !== val)).map(f => f.name + ": " + f.text.replace(/\s+/g, " "));
            lines.push("- " + [head].concat(rest).filter(Boolean).join("; "));
        }
        section(gr.cat.name.toUpperCase(), lines);
    }
    const probs = (o.problems || []).filter(p => pick("p:" + p.id));
    section("OPEN PROBLEMS (reported by drivers or the office)", probs.filter(p => p.status === "open").map(p => "- " + day(p.at) + ": " + p.text.replace(/\s+/g, " ")));
    section("FIXED PROBLEMS", probs.filter(p => p.status !== "open").map(p => "- " + day(p.at) + ": " + p.text.replace(/\s+/g, " ") +
        " | fixed" + (p.doneAt ? " " + day(p.doneAt) : "") + (p.fixNote ? ": " + p.fixNote.replace(/\s+/g, " ") : "")));
    if (pick("service")) section("SERVICE LOG (newest first)", serviceList(s.service).map(e => "- " + [e.day + ": " + e.what,
        typeof e.km === "number" ? fmtKm(e.km) : "", typeof e.cost === "number" ? fmtMoney(e.cost) : "", e.note ? e.note.replace(/\s+/g, " ") : ""].filter(Boolean).join("; ")));
    if (pick("reminders")) section("SERVICE DUE", reminderList(s.reminders, currentKm(s), o.today).map(r => {
        const st = r.st, due = [];
        if (typeof r.dueKm === "number") due.push("at " + fmtKm(r.dueKm) + (st.kmLeft === null ? "" : st.kmLeft < 0 ? " (" + fmtKm(-st.kmLeft) + " overdue)" : " (" + fmtKm(st.kmLeft) + " to go)"));
        if (r.dueDay) due.push("on " + r.dueDay);
        const every = [r.everyKm ? "every " + fmtKm(r.everyKm) : "", r.everyMonths ? "every " + r.everyMonths + (r.everyMonths === 1 ? " month" : " months") : ""].filter(Boolean).join(" or ");
        return "- " + [r.what + (due.length ? ", due " + due.join(" or ") : ""), every, st.state === "overdue" ? "OVERDUE" : st.state === "soon" ? "due soon" : "", r.note ? r.note.replace(/\s+/g, " ") : ""].filter(Boolean).join("; ");
    }));
    if (pick("oil")) {
        const done = (o.oils || []).filter(x => x.state === "checked").length, missed = (o.oils || []).filter(x => x.state === "missed").length;
        const lines = [];
        if (o.oilLast && typeof o.oilLast.at === "number") lines.push("- Last checked " + day(o.oilLast.at));
        if (done || missed) lines.push("- Last " + o.oilDays + " days: checked on " + done + (done === 1 ? " shift" : " shifts") + ", not checked on " + missed);
        section("OIL LEVEL CHECKS (drivers are asked on the time clock to check the oil)", lines);
    }
    return out.join("\n");
}
