// Garage helpers with no Firebase in them, so tests/garage.test.mjs can run them in Node.
// garage.html imports the time clock's own helpers (vanKey, vehicleList, oilState...) from ../timeclock/tc-core.js
// and passes vanKey in where a vehicle name has to be turned into its key.
//
// Database layout (same Firebase project as the time clock, see README):
//   garage/categories/{catId}                    { name, order }  the sections every vehicle has (Lights, Fluids...)
//   garage/vehicles/{vkey}                       vkey is vanKey(name), the same key timeclock/oil_last uses
//       name                                       the vehicle's name when something was last saved for it
//       items/{id}                                 { cat, label, value, part, link, note, at, by }
//       service/{id}                               { day: "YYYY-MM-DD", what, km, cost, note, at, by }
// Read from the time clock:
//   timeclock/van_reports/{id}                   Vehicle Check reports (problems); Garage marks them fixed
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
export const MAX = { catName: 40, vname: 60, label: 60, value: 200, part: 80, link: 500, note: 500, what: 120, by: 100 };
export const KM_MAX = 10000000, COST_MAX = 1000000;

export function sortCategories(cats) {
    return Object.entries(cats || {})
        .filter(([, c]) => c && String(c.name || "").trim())
        .map(([id, c]) => ({ id: id, name: String(c.name).trim(), order: typeof c.order === "number" ? c.order : 999 }))
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

// Every vehicle Garage shows: the ones drivers can pick (list = vehicleList() from tc-core, GPS units and vans
// without GPS), one per key, plus any vehicle that has Garage entries but isn't in that list any more, so nothing
// saved for it is lost. { key, name, ids: [vehicle ids with that key], inList }
export function garageVehicles(list, stored, keyOf) {
    const map = new Map();
    for (const v of list || []) {
        const key = keyOf(v.name);
        if (!key) continue;
        const g = map.get(key);
        if (g) g.ids.push(v.id);
        else map.set(key, { key: key, name: v.name, ids: [v.id], inList: true });
    }
    for (const [key, s] of Object.entries(stored || {})) {
        if (!map.has(key) && s && (s.items || s.service)) map.set(key, { key: key, name: String(s.name || key), ids: [], inList: false });
    }
    return Array.from(map.values()).sort((a, b) => b.inList - a.inList || byName(a, b));
}

// The vehicle key a time clock record belongs to: by the vehicle id when it's one we know, else by its name
export function recordKey(vehicleId, vehicleName, idToKey, keyOf) {
    return (vehicleId && idToKey[vehicleId]) || keyOf(vehicleName || "") || "";
}
export function idToKeyMap(vehicles) {
    const m = {};
    for (const v of vehicles) for (const id of v.ids) m[id] = v.key;
    return m;
}

// Vehicle Check reports as a list: open ones first, then the newest. Fixed ones stay in the list.
export function reportList(reports, idToKey, keyOf) {
    return Object.entries(reports || {})
        .filter(([, r]) => r && r.text)
        .map(([id, r]) => Object.assign({ id: id, vkey: recordKey(r.vehicleId, r.vehicleName, idToKey, keyOf) }, r))
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

// Oil checks from shifts: [{ ek, s, state, open, vkey }], newest first. state is oilState() from tc-core:
// "checked" | "waiting" (on the clock, not checked yet) | "missed"; "none" and "notdue" are left out.
// open: a missed check nobody has marked as seen yet.
export function oilList(shiftsByEk, since, oilState, idToKey, keyOf) {
    const out = [];
    for (const [ek, list] of Object.entries(shiftsByEk || {})) {
        for (const s of list || []) {
            if (!s || typeof s.in !== "number" || s.in < since) continue;
            const st = oilState(s);
            if (st === "none" || st === "notdue") continue;
            const v = shiftVehicle(s);
            out.push({ ek: ek, s: s, state: st, open: st === "missed" && !(s.oil && s.oil.seenBy), vkey: recordKey(v.id, v.name, idToKey, keyOf), vname: v.name });
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

// Search every vehicle's entries and service log. Every word must appear somewhere in the entry (or the vehicle or
// category name). [{ vehicle, kind: "item" | "service", catName, entry }]
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
    }
    return out.sort((a, b) => byName(a.vehicle, b.vehicle) || a.catName.localeCompare(b.catName));
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw.day || ""))) return { ok: false, error: "Pick the date it was done." };
    if (!what) return { ok: false, error: "Say what was done, for example Oil change." };
    const value = { day: raw.day, what: what };
    const num = (v, max, label) => {
        const s = String(v === null || v === undefined ? "" : v).replace(/[$,\s]/g, "");
        if (!s) return undefined;
        const n = Number(s);
        if (!Number.isFinite(n) || n < 0 || n > max) return label;
        return n;
    };
    const km = num(raw.km, KM_MAX, "km"), cost = num(raw.cost, COST_MAX, "cost");
    if (km === "km") return { ok: false, error: "The km should be a number, for example 182500." };
    if (cost === "cost") return { ok: false, error: "The cost should be a number, for example 89.99." };
    if (km !== undefined) value.km = Math.round(km);
    if (cost !== undefined) value.cost = Math.round(cost * 100) / 100;
    const note = trim(raw.note, MAX.note);
    if (note) value.note = note;
    return { ok: true, value: value };
}

export function fmtKm(n) { return Math.round(n).toLocaleString("en-CA") + " km"; }
export function fmtMoney(n) { return "$" + Number(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
