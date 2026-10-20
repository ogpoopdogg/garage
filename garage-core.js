// Garage helpers with no Firebase in them, so tests/garage.test.mjs can run them in Node.
// garage.html imports the time clock's own helpers (vanKey, manualVans, oilState...) from ../timeclock/tc-core.js
// and passes vanKey in where a vehicle name has to be turned into its key.
//
// Everything is matched by the vehicle's NAME (its key, vanKey(name)), never by a GPS unit: the GPS units move
// from vehicle to vehicle, so they say nothing about which vehicle a record is about.
//
// Database layout (same Firebase project as the time clock, see README):
//   garage/categories/{catId}                    { name, order }  the sections every vehicle has (Lights, Fluids...)
//   garage/vehicles/{vkey}                       vkey is vanKey(name), the same key timeclock/oil_last uses
//       name                                       the vehicle's name
//       listed                                     true: added in Garage (it isn't in the time clock's van list)
//       removed                                    true: removed in Garage (hidden even if the time clock lists it)
//       items/{id}                                 { cat, label, value, part, link, note, added, addedBy, at, by }
//       service/{id}                               { day: "YYYY-MM-DD", what, km, cost, note, added, addedBy, at, by }
//       reminders/{id}                             { what, dueKm, dueDay, everyKm, everyMonths, note, added, addedBy, at, by }
//       odo                                        { km, day, at, by }  the last km reading someone entered
//   garage/trash/{id}                            { at, by, kind, vkey, vname, id, data }  deleted things, kept 30 days
//   garage/history/{vkey}/{id}                   { at, by, text }  what changed on each vehicle ("_all": all vehicles)
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
        .map(([id, c]) => ({ id: id, name: String(c.name).trim(), order: typeof c.order === "number" ? c.order : 999 }))
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
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

// Whether drivers can pick a vehicle on the time clock (the vehicle's "Time clock" switch):
//   "gps": a GPS unit in RouteWatcher has its name, so drivers can always pick it (the switch can't turn it off)
//   "on":  it's in the time clock's vans (timeclock/vans); vanIds are those entries, turning it off removes them
//   "off": drivers can't pick it; turning it on adds it to timeclock/vans
// gps and vans are tc-core's gpsList() and manualVans(): [{ id, name }].
export const CLOCK_NAME_MAX = 40; // the longest name timeclock/vans takes (the time clock's database rules)
export function clockState(key, gps, vans, keyOf) {
    const g = (gps || []).find(x => keyOf(x.name) === key);
    const vanIds = (vans || []).filter(x => keyOf(x.name) === key).map(x => x.id);
    return { state: g ? "gps" : vanIds.length ? "on" : "off", gpsName: g ? g.name : "", vanIds: vanIds };
}
// Why the switch can't be turned off right now: someone has the vehicle on their shift (timeclock/vehicle_claims/{vanId}).
// Returns the person's name, or "" when nobody has it.
export function clockInUse(vanIds, claims) {
    for (const id of vanIds || []) {
        const c = claims && claims[id];
        if (c) return String(c.name || c.nickname || c.email || "Someone");
    }
    return "";
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

// A vehicle's entries grouped by category, in category order. Entries whose category was deleted go under "Other".
export function itemGroups(items, cats) {
    const list = Object.entries(items || {}).filter(([, it]) => it && it.label).map(([id, it]) => Object.assign({ id: id }, it))
        .sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true, sensitivity: "base" }));
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
            if (!it || !it.label) continue;
            const cn = catName(it.cat);
            if (hit([v.name, "van " + v.name, cn, it.label, it.value, it.part, it.note].filter(Boolean).join(" "))) out.push({ vehicle: v, kind: "item", catName: cn, entry: Object.assign({ id: id }, it) });
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

export const CSV_HEAD = ["Vehicle", "Section", "Category", "What", "Type or size", "Part #", "Link", "Date", "Km", "Cost", "Status", "Note", "Added by", "Last changed by"];
// Every vehicle's info, service log, reminders and problems as spreadsheet rows (the header row first).
// fmtTs turns a time into text; problems: reportList() output.
export function csvRows(vehicles, stored, cats, problems, fmtTs) {
    const rows = [CSV_HEAD];
    const catName = id => (cats.find(c => c.id === id) || { name: "Other" }).name;
    const ts = v => typeof v === "number" ? fmtTs(v) : "";
    for (const v of vehicles) {
        const s = stored[v.key] || {};
        for (const gr of itemGroups(s.items, cats)) for (const it of gr.items)
            rows.push([v.name, "Info", catName(it.cat), it.label, it.value, it.part, it.link, "", "", "", "", it.note, it.addedBy || it.by, it.by]);
        for (const e of serviceList(s.service))
            rows.push([v.name, "Service", "", e.what, "", "", "", e.day, e.km, e.cost, "Done", e.note, e.addedBy || e.by, e.by]);
        for (const r of Object.values(s.reminders || {})) if (r && r.what)
            rows.push([v.name, "Reminder", "", r.what, [r.everyKm ? "every " + r.everyKm + " km" : "", r.everyMonths ? "every " + r.everyMonths + " months" : ""].filter(Boolean).join(", "),
                "", "", r.dueDay, r.dueKm, "", "Due", r.note, r.addedBy || r.by, r.by]);
        for (const p of problems.filter(p => p.vkey === v.key))
            rows.push([v.name, "Problem", "", p.text, "", "", "", ts(p.at), "", "", p.status === "open" ? "Open" : "Fixed" + (p.fixNote ? ": " + p.fixNote : ""), "", p.name || "", p.by || ""]);
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
export function cleanItem(raw) {
    const label = trim(raw.label, MAX.label);
    if (!label) return { ok: false, error: "Give it a name, for example Headlight." };
    if (!raw.cat) return { ok: false, error: "Pick a category." };
    const link = cleanLink(raw.link);
    if (link === null) return { ok: false, error: "The link should be a web address, for example https://www.partsource.ca/…" };
    const value = { cat: String(raw.cat).slice(0, 40), label: label };
    const v = trim(raw.value, MAX.value), part = trim(raw.part, MAX.part), note = trim(raw.note, MAX.note);
    if (v) value.value = v;
    if (part) value.part = part;
    if (link) value.link = link;
    if (note) value.note = note;
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
