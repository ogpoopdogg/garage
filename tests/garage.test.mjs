import test from 'node:test';
import assert from 'node:assert';
// Helpers in garage-core.js. Run with: node --test tests/garage.test.mjs
import {
  defaultCategories, sortCategories, garageVehicles, reportList, oilList, shiftVehicle,
  itemGroups, serviceList, searchGarage, cleanItem, cleanService, cleanLink,
  addMonths, daysBetween, currentKm, reminderState, reminderList, serviceDue, cleanReminder, nextReminder, cleanOdo,
  stamps, trashList, trashExpired, restoreWrites, toCsv, csvRows, TRASH_DAYS
} from '../garage-core.js';
import { editKeys, editWas, editList, editDrops, withEdit, ITEM_KEYS, SERVICE_KEYS, PROBLEM_KEYS, EDITS_MAX } from '../garage-core.js';
import { problemMarks, problemUnread, oilMarks, mergeShifts, matchesAll, problemWords, monthWeeks, rangePick, dayOf } from '../garage-core.js';
import { categoryFields, cleanFields, fieldsText, fieldNames, entryFields, entryTitle, hasContent } from '../garage-core.js';

// The time clock's vanKey (timeclock/tc-core.js): "Van 12", "van12" and "12" are the same vehicle
const vanKey = name => String(name || '').toLowerCase().replace(/\b(?:van|vehicle)(?=\b|\d)/g, '').replace(/[^a-z0-9]/g, '');

test('starting categories, sorted by their order', () => {
  const cats = sortCategories(defaultCategories());
  assert.deepStrictEqual(cats.map(c => c.name), ['Lights', 'Fluids', 'Tires', 'Filters', 'Wipers', 'Battery', 'Plate / VIN', 'Notes']);
  assert.deepStrictEqual(sortCategories({ b: { name: 'B', order: 1 }, a: { name: 'A', order: 0 }, x: { name: '  ' } }).map(c => c.id), ['a', 'b']);
});

test('vehicles: by name only; the time clock\'s vans, ones added here, and ones with entries; removed ones hidden', () => {
  const clock = [{ id: 'van_a', name: 'Van 12' }, { id: 'van_b', name: '12' }, { id: 'van_c', name: '3' }, { id: 'van_d', name: '5' }];
  const stored = {
    7: { name: 'Van 7', items: { i: { cat: 'lights', label: 'Headlight' } } },
    9: { name: 'Van 9' },
    14: { name: '14', listed: true },
    5: { name: '5', removed: true, items: { i: { cat: 'lights', label: 'x' } } },
    12: { name: 'Van 12', listed: true }
  };
  assert.deepStrictEqual(garageVehicles(clock, stored, vanKey), [
    { key: '3', name: '3', inClock: true, listed: false },
    { key: '12', name: 'Van 12', inClock: true, listed: true },
    { key: '14', name: '14', inClock: false, listed: true },
    { key: '7', name: 'Van 7', inClock: false, listed: false }
  ]);
});

test('problems: open first, then newest; fixed ones stay in the list', () => {
  const r = reportList({
    a: { at: 1, text: 'old open', status: 'open', vehicleId: 'gps1', vehicleName: 'Van 12' },
    b: { at: 5, text: 'fixed', status: 'fixed', vehicleName: 'Van 3' },
    c: { at: 3, text: 'new open', status: 'open', vehicleId: 'gps1', vehicleName: '12' },
    d: { at: 9, status: 'open' }
  }, vanKey);
  // the GPS unit (gps1) says nothing about the vehicle: only the name counts
  assert.deepStrictEqual(r.map(x => [x.id, x.vkey]), [['c', '12'], ['a', '12'], ['b', '3']]);
});

test('oil checks: by vehicle, missed ones are open until seen, not-due ones left out', () => {
  // A stand-in for tc-core's oilState
  const oilState = s => !s.vehicleId && !s.vans ? 'none' : s.oil && s.oil.due === false ? 'notdue' : s.oil && s.oil.done ? 'checked' : typeof s.out === 'number' ? 'missed' : 'waiting';
  const shifts = { 'matt@ec,com': [
    { id: 's1', in: 100, out: 200, vehicleId: 'g12', vehicleName: '12', oil: { done: true, at: 150 } },
    { id: 's2', in: 300, out: 400, vehicleId: 'g12', vehicleName: '12' },
    { id: 's3', in: 500, out: 600, vehicleId: 'g12', vehicleName: '12', oil: { done: false, at: 600, seenBy: 'justin@ec.com' } },
    { id: 's4', in: 700, out: 800, vehicleId: 'g3', vehicleName: '3', oil: { due: false, at: 700 } },
    { id: 's5', in: 900, shop: true },
    { id: 's0', in: 10, out: 20, vehicleId: 'g12', vehicleName: '12' }
  ], 'dave@ec,com': [
    { id: 'd1', in: 1000, vans: { a: { at: 1000, vehicleId: 'g3', vehicleName: '3' } } }
  ] };
  const o = oilList(shifts, 50, oilState, vanKey);
  assert.deepStrictEqual(o.map(x => [x.s.id, x.state, x.open, x.vkey]), [
    ['d1', 'waiting', false, '3'], ['s3', 'missed', false, '12'], ['s2', 'missed', true, '12'], ['s1', 'checked', false, '12']
  ]);
  assert.deepStrictEqual(shiftVehicle({ vans: { a: { at: 2, vehicleId: 'g3', vehicleName: '3' }, b: { at: 1, vehicleId: 'g9', vehicleName: '9' } } }), { id: 'g3', name: '3' });
});

test('entries grouped by category; a deleted category\'s entries go under Other', () => {
  const cats = sortCategories(defaultCategories()).slice(0, 2);
  const gr = itemGroups({ a: { cat: 'lights', label: 'Tail light' }, b: { cat: 'lights', label: 'Headlight' }, c: { cat: 'gone', label: 'Mirror' } }, cats);
  assert.deepStrictEqual(gr.map(x => [x.cat.name, x.items.map(i => i.label)]), [['Lights', ['Headlight', 'Tail light']], ['Fluids', []], ['Other', ['Mirror']]]);
});

test('service log newest first', () => {
  assert.deepStrictEqual(serviceList({ a: { day: '2026-01-02', what: 'Brakes' }, b: { day: '2026-03-01', what: 'Oil change' }, c: { what: 'no date' } }).map(e => e.id), ['b', 'a']);
});

test('search finds entries on every vehicle; every word has to match', () => {
  const cats = sortCategories(defaultCategories());
  const vehicles = [{ key: '12', name: '12', inClock: true }, { key: '3', name: '3', inClock: true }];
  const stored = {
    12: { items: { a: { cat: 'lights', label: 'Headlight', value: 'H11' }, b: { cat: 'wipers', label: 'Driver wiper', value: '22 in' } }, service: { s: { day: '2026-10-01', what: 'Oil change' } } },
    3: { items: { a: { cat: 'lights', label: 'Headlight', value: '9006' } }, reminders: { r: { what: 'Brake pads', dueKm: 200000 } } }
  };
  assert.deepStrictEqual(searchGarage('h11', vehicles, stored, cats).map(h => h.vehicle.key + ':' + h.entry.id), ['12:a']);
  assert.deepStrictEqual(searchGarage('headlight', vehicles, stored, cats).map(h => h.vehicle.key), ['3', '12']);
  assert.deepStrictEqual(searchGarage('lights van 3', vehicles, stored, cats).map(h => h.vehicle.key), ['3']);
  assert.deepStrictEqual(searchGarage('oil', vehicles, stored, cats).map(h => h.kind), ['service']);
  assert.deepStrictEqual(searchGarage('brake', vehicles, stored, cats).map(h => h.kind), ['reminder']);
  assert.deepStrictEqual(searchGarage('  ', vehicles, stored, cats), []);
});

test('entries: name and category needed; links must be web addresses', () => {
  assert.deepStrictEqual(cleanItem({ cat: 'lights', label: ' Headlight ', value: 'H11', part: '', link: 'partsource.ca/h11', note: '' }),
    { ok: true, value: { cat: 'lights', label: 'Headlight', value: 'H11', link: 'https://partsource.ca/h11' } });
  assert.strictEqual(cleanItem({ cat: 'lights', label: '' }).ok, false);
  assert.strictEqual(cleanItem({ cat: '', label: 'x' }).ok, false);
  assert.strictEqual(cleanItem({ cat: 'lights', label: 'x', link: 'javascript:alert(1)' }).ok, false);
  assert.strictEqual(cleanLink(''), '');
  assert.strictEqual(cleanLink('ftp://x'), null);
});

test('service entries: date and what; km and cost as numbers', () => {
  assert.deepStrictEqual(cleanService({ day: '2026-10-18', what: 'Oil change', km: '182,500', cost: '$89.999', note: '' }),
    { ok: true, value: { day: '2026-10-18', what: 'Oil change', km: 182500, cost: 90 } });
  assert.strictEqual(cleanService({ day: '', what: 'x' }).ok, false);
  assert.strictEqual(cleanService({ day: '2026-10-18', what: '' }).ok, false);
  assert.strictEqual(cleanService({ day: '2026-10-18', what: 'x', km: 'lots' }).ok, false);
  assert.strictEqual(cleanService({ day: '2026-10-18', what: 'x', cost: '-5' }).ok, false);
});

test('dates: months ahead keep the day, or the last day of a shorter month', () => {
  assert.strictEqual(addMonths('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(addMonths('2026-10-18', 6), '2027-04-18');
  assert.strictEqual(addMonths('2026-12-05', 1), '2027-01-05');
  assert.strictEqual(daysBetween('2026-10-18', '2026-11-01'), 14);
  assert.strictEqual(daysBetween('2026-03-01', '2026-02-27'), -2);
});

test('km: the larger of the reading entered and the service log', () => {
  assert.strictEqual(currentKm({}), null);
  assert.strictEqual(currentKm({ odo: { km: 180000 }, service: { a: { km: 182500 }, b: { km: 100 } } }), 182500);
  assert.strictEqual(currentKm({ odo: { km: 190000 }, service: { a: { km: 182500 } } }), 190000);
});

test('reminders: overdue, due soon (1000 km or 14 days), or fine; most urgent first', () => {
  assert.strictEqual(reminderState({ dueKm: 190000 }, 190500, '2026-10-18').state, 'overdue');
  assert.strictEqual(reminderState({ dueKm: 190000 }, 189200, '2026-10-18').state, 'soon');
  assert.strictEqual(reminderState({ dueKm: 190000 }, 180000, '2026-10-18').state, 'ok');
  assert.strictEqual(reminderState({ dueKm: 190000 }, null, '2026-10-18').state, 'ok');
  assert.strictEqual(reminderState({ dueDay: '2026-10-18' }, null, '2026-10-18').state, 'overdue');
  assert.strictEqual(reminderState({ dueDay: '2026-11-01' }, null, '2026-10-18').state, 'soon');
  assert.strictEqual(reminderState({ dueDay: '2026-11-02', dueKm: 190000 }, 189999, '2026-10-18').state, 'soon');
  const list = reminderList({ a: { what: 'Tires', dueDay: '2027-05-01' }, b: { what: 'Oil', dueKm: 182000 }, c: { what: 'Wipers', dueDay: '2026-10-25' } }, 182500, '2026-10-18');
  assert.deepStrictEqual(list.map(r => [r.id, r.st.state]), [['b', 'overdue'], ['c', 'soon'], ['a', 'ok']]);
  assert.strictEqual(serviceDue({ service: { s: { km: 182500 } }, reminders: { b: { what: 'Oil', dueKm: 182000 } } }, '2026-10-18'), 'overdue');
  assert.strictEqual(serviceDue({}, '2026-10-18'), '');
});

test('reminders from the form: a km or a date, or how often; the first one counted from now', () => {
  const t = '2026-10-18';
  assert.deepStrictEqual(cleanReminder({ what: 'Oil change', dueKm: '190,000' }, 182500, t), { ok: true, value: { what: 'Oil change', dueKm: 190000 } });
  assert.deepStrictEqual(cleanReminder({ what: 'Oil change', everyKm: '8000', everyMonths: '6' }, 182500, t),
    { ok: true, value: { what: 'Oil change', everyKm: 8000, everyMonths: 6, dueKm: 190500, dueDay: '2027-04-18' } });
  assert.strictEqual(cleanReminder({ what: 'Oil change', everyKm: '8000' }, null, t).ok, false); // km unknown
  assert.strictEqual(cleanReminder({ what: 'Oil change' }, 1, t).ok, false);
  assert.strictEqual(cleanReminder({ what: '', dueKm: '1' }, 1, t).ok, false);
  assert.strictEqual(cleanReminder({ what: 'x', everyMonths: '1.5' }, 1, t).ok, false);
  assert.strictEqual(cleanReminder({ what: 'x', dueDay: '18/10/2026' }, 1, t).ok, false);
});

test('a done reminder moves to the next time, or is finished', () => {
  assert.deepStrictEqual(nextReminder({ dueKm: 190000, everyKm: 8000 }, 189000, '2026-10-18'), { dueKm: 197000 });
  assert.deepStrictEqual(nextReminder({ dueKm: 190000, everyKm: 8000 }, undefined, '2026-10-18'), { dueKm: 198000 });
  assert.deepStrictEqual(nextReminder({ dueDay: '2026-10-01', everyMonths: 6, everyKm: 8000 }, 189000, '2026-10-18'), { dueKm: 197000, dueDay: '2027-04-18' });
  assert.strictEqual(nextReminder({ dueKm: 190000 }, 189000, '2026-10-18'), null);
  assert.strictEqual(cleanOdo({ km: '182,500' }).value.km, 182500);
  assert.strictEqual(cleanOdo({ km: '' }).ok, false);
});

test('editing keeps who added it; the last change is at/by', () => {
  assert.deepStrictEqual(stamps(null, 'justin@ec.com', 5), { at: 5, by: 'justin@ec.com', added: 5, addedBy: 'justin@ec.com' });
  assert.deepStrictEqual(stamps({ added: 1, addedBy: 'celeste@ec.com', at: 3, by: 'x' }, 'justin@ec.com', 5), { at: 5, by: 'justin@ec.com', added: 1, addedBy: 'celeste@ec.com' });
  // older entries only had at/by: that was when they were added
  assert.deepStrictEqual(stamps({ at: 2, by: 'desirae@ec.com' }, 'justin@ec.com', 5), { at: 5, by: 'justin@ec.com', added: 2, addedBy: 'desirae@ec.com' });
});

test('edit history: what each changed field said before, who edited it and when; the newest 20 are kept', () => {
  const old = { cat: 'lights', label: 'Headlight', value: 'H11', note: 'both sides', extra: { xA: 'red' }, at: 1, by: 'celeste@ec.com' };
  const next = { cat: 'lights', label: 'Headlight', value: 'H11B', part: '9008', extra: { xA: 'red', xB: 'LED' }, at: 2, by: 'justin@ec.com' };
  const keys = editKeys(old, next, ['cat'].concat(ITEM_KEYS));
  assert.deepStrictEqual(keys, ['cat', 'label', 'value', 'part', 'link', 'note', 'xA', 'xB']);
  // empty before: "", and at/by/added aren't fields
  assert.deepStrictEqual(editWas(old, next, keys), { value: 'H11', part: '', note: 'both sides', xB: '' });
  assert.deepStrictEqual(editWas(old, Object.assign({}, old, { at: 9 }), keys), {});
  assert.deepStrictEqual(editWas({ day: '2026-10-01', what: 'Oil', km: 180000 }, { day: '2026-10-01', what: 'Oil', km: 181000, cost: 90 }, SERVICE_KEYS), { km: 180000, cost: '' });
  assert.deepStrictEqual(editWas({ text: 'Light out', status: 'open' }, { text: 'Left light out' }, PROBLEM_KEYS), { text: 'Light out' });

  // newest first; one still being saved (a server time, not a number yet) is the newest; empty ones are left out
  assert.deepStrictEqual(editList({ a: { at: 1, by: 'x', was: { note: 'a' } }, b: { at: { '.sv': 'timestamp' }, was: { note: 'b' } }, c: { at: 3, was: { note: 'c' } }, d: { at: 4, was: {} } }).map(e => e.id), ['b', 'c', 'a']);
  assert.deepStrictEqual(editList(undefined), []);

  // saved with the entry: old edits kept, the new one added; nothing changed keeps what it had
  assert.deepStrictEqual(withEdit({ edits: { e1: { at: 1, by: 'x', was: { note: '' } } } }, { note: 'n' }, 'e2', 'justin@ec.com', 5),
    { e1: { at: 1, by: 'x', was: { note: '' } }, e2: { at: 5, by: 'justin@ec.com', was: { note: 'n' } } });
  assert.strictEqual(withEdit({}, {}, 'e1', 'j', 5), null);
  assert.deepStrictEqual(withEdit({ edits: { e1: { at: 1, was: { note: '' } } } }, {}, 'e2', 'j', 5), { e1: { at: 1, was: { note: '' } } });
  const many = {};
  for (let i = 0; i < EDITS_MAX; i++) many['e' + String(i).padStart(2, '0')] = { at: i, was: { note: String(i) } };
  assert.deepStrictEqual(editDrops(many), ['e00']);
  const kept = withEdit({ edits: many }, { note: 'new' }, 'new', 'j', 100);
  assert.strictEqual(Object.keys(kept).length, EDITS_MAX);
  assert.ok(!kept.e00 && kept.e01 && kept.new);
  assert.deepStrictEqual(editDrops({ a: { at: 1, was: { text: 'x' } } }), []);
});

test('trash: newest first, gone after 30 days, and put back where it was', () => {
  const day = 86400000, now = 100 * day;
  const trash = {
    a: { at: now - day, kind: 'item', vkey: '12', id: 'i1', data: { cat: 'lights', label: 'Headlight' } },
    b: { at: now - (TRASH_DAYS + 1) * day, kind: 'service', vkey: '12', id: 's1', data: { day: '2026-01-01', what: 'Oil' } },
    c: { at: now - 2 * day, kind: 'vehicle', vkey: '14', vname: '14', id: '', data: { name: '14', listed: true, items: { i: { cat: 'x', label: 'y' } }, odo: { km: 5 } } }
  };
  assert.deepStrictEqual(trashList(trash).map(t => t.tid), ['a', 'c', 'b']);
  assert.deepStrictEqual(trashExpired(trash, now), ['b']);
  assert.deepStrictEqual(restoreWrites(trash.a, 'garage/vehicles'), { 'garage/vehicles/12/items/i1': { cat: 'lights', label: 'Headlight' } });
  assert.deepStrictEqual(restoreWrites(trash.c, 'garage/vehicles'), {
    'garage/vehicles/14/removed': null, 'garage/vehicles/14/name': '14', 'garage/vehicles/14/listed': true,
    'garage/vehicles/14/odo': { km: 5 }, 'garage/vehicles/14/items/i': { cat: 'x', label: 'y' }
  });
  assert.strictEqual(restoreWrites({ kind: 'item', vkey: '12' }, 'garage/vehicles'), null);
});

test('spreadsheet: quotes where needed, and text that looks like a formula is made plain text', () => {
  assert.strictEqual(toCsv([['a', 'b,c', 'say "hi"', '=SUM(A1)', '-5W30', -12, 3.5, null]]), 'a,"b,c","say ""hi""",\'=SUM(A1),\'-5W30,-12,3.5,\r\n');
  const cats = sortCategories(defaultCategories());
  const rows = csvRows([{ key: '12', name: '12' }], { 12: {
    items: { a: { cat: 'lights', label: 'Headlight', value: 'H11', by: 'justin@ec.com' } },
    service: { s: { day: '2026-10-01', what: 'Oil change', km: 182500, cost: 89.99 } },
    reminders: { r: { what: 'Oil change', dueKm: 190500, everyKm: 8000 } }
  } }, cats, [{ vkey: '12', text: 'Light out', status: 'fixed', fixNote: 'bulb', at: 7, name: 'Matt' }], ts => 'T' + ts);
  assert.deepStrictEqual(rows.slice(1).map(r => [r[1], r[3]]), [['Info', 'Headlight'], ['Service', 'Oil change'], ['Reminder', 'Oil change'], ['Problem', 'Light out']]);
  assert.strictEqual(rows[4][10], 'Fixed: bulb');
  assert.ok(rows.every(r => r.length === rows[0].length));
});

test('category fields: old categories have all five; a category can keep only the ones it wants, renamed, and add its own', () => {
  assert.deepStrictEqual(categoryFields({ name: 'Lights' }).map(f => [f.key, f.name, f.on]),
    [['label', 'What', true], ['value', 'Type or size', true], ['part', 'Part number', true], ['link', 'Where to buy (link)', true], ['note', 'Note', true]]);
  const only = cleanFields([{ key: 'label', name: '', on: false }, { key: 'value', name: ' Model number ', on: true }, { key: 'part', on: false }, { key: 'link', on: false }, { key: 'note', on: false }]);
  assert.strictEqual(only.ok, true);
  assert.deepStrictEqual(only.value.value, { name: 'Model number', order: 1 });
  assert.deepStrictEqual(only.value.label, { name: 'What', order: 0, off: true });
  const cats = sortCategories({ m: { name: 'Model', order: 0, fields: only.value } });
  assert.strictEqual(fieldsText(cats[0].fields), 'Model number');
  // its own fields, in the order given
  const own = cleanFields([{ key: 'xA1', name: 'Colour', on: true }, { key: 'label', name: 'Item', on: true }, { key: 'bad key', name: 'x', on: true }]);
  assert.deepStrictEqual(categoryFields({ fields: own.value }).filter(f => f.on).map(f => f.key + ':' + f.name), ['xA1:Colour', 'label:Item']);
  assert.strictEqual(cleanFields([{ key: 'label', name: 'x', on: false }]).ok, false);
  assert.strictEqual(cleanFields([{ key: 'xA', name: '', on: true }]).ok, false);
  assert.strictEqual(cleanFields([{ key: 'label', name: 'Size', on: true }, { key: 'value', name: 'size', on: true }]).ok, false);
});

test('entries in a category with only a Model number field', () => {
  const cats = sortCategories({ m: { name: 'Model', order: 0, fields: { label: { name: 'What', order: 0, off: true }, value: { name: 'Model number', order: 1 }, xC: { name: 'Colour', order: 2 } } } });
  const fields = cats[0].fields;
  const shown = entryFields({}, cats[0], fieldNames(cats));
  assert.deepStrictEqual(shown.map(f => f.name), ['Model number', 'Colour']);
  assert.deepStrictEqual(cleanItem({ cat: 'm', value: ' ABC-123 ', extra: { xC: 'white', 'bad key': 'x' } }, shown), { ok: true, value: { cat: 'm', value: 'ABC-123', extra: { xC: 'white' } } });
  assert.strictEqual(cleanItem({ cat: 'm', value: ' ' }, shown).ok, false);
  // a field the category no longer uses still shows while the entry has something in it
  assert.deepStrictEqual(entryFields({ label: 'Old', value: '1' }, cats[0], {}).map(f => f.key), ['label', 'value', 'xC']);
  assert.deepStrictEqual(entryFields({ extra: { xGone: 'z' } }, cats[0], { xGone: 'Size' }).map(f => f.name), ['Model number', 'Colour', 'Size']);
  assert.strictEqual(entryTitle({ value: 'ABC-123' }), 'ABC-123');
  assert.strictEqual(entryTitle({ extra: { xC: 'white' } }), 'white');
  assert.strictEqual(hasContent({ cat: 'm' }), false);
  const gr = itemGroups({ a: { cat: 'm', value: 'B2' }, b: { cat: 'm', label: 'A1' }, c: { cat: 'm' } }, cats);
  assert.deepStrictEqual(gr[0].items.map(i => i.id), ['b', 'a']);
  const vehicles = [{ key: '12', name: '12' }];
  assert.strictEqual(searchGarage('white', vehicles, { 12: { items: { a: { cat: 'm', extra: { xC: 'white' } } } } }, cats).length, 1);
  const rows = csvRows(vehicles, { 12: { items: { a: { cat: 'm', value: 'B2', extra: { xC: 'white' } } } } }, cats, [], String);
  assert.strictEqual(rows[1][rows[0].indexOf('Other fields')], 'Colour: white');
  assert.ok(fields.length === 6);
});

test('Vehicle checks: read and cleared problems; only a fixed one counts as cleared', () => {
  const list = reportList({ a: { at: 1, text: 'Light out', status: 'open', vehicleName: '12' }, b: { at: 2, text: 'Wiper', status: 'fixed', vehicleName: '3' }, c: { at: 3, text: 'Mirror', status: 'open' } }, vanKey);
  const m = problemMarks(list, { a: { at: 5 } }, { b: { at: 6 }, c: { at: 6 } });
  assert.deepStrictEqual(m.map(r => [r.id, r.read, r.cleared, problemUnread(r)]), [['c', false, false, true], ['a', true, false, false], ['b', false, true, false]]);
  assert.ok(matchesAll('van 12 light', problemWords(m[1])));
  assert.ok(!matchesAll('light 3', problemWords(m[1])));
  assert.ok(matchesAll('', []));
});

test('Vehicle checks: cleared and brought-back oil checks; shifts merged once each', () => {
  const s = { id: 's1', in: 100 };
  const o = oilMarks([{ ek: 'matt@ec,com', s: s }, { ek: 'dave@ec,com', s: { id: 's1', in: 100 } }], { 'matt@ec,com': { s1: { at: 1 } } }, { 'dave@ec,com': { s1: { at: 2 } } });
  assert.deepStrictEqual(o.map(x => [x.ek, x.cleared, x.shown]), [['matt@ec,com', true, false], ['dave@ec,com', false, true]]);
  const merged = mergeShifts({ a: [s] }, { a: [{ id: 's1', in: 1 }, { id: 's2', in: 2 }], b: [{ id: 's3', in: 3 }] });
  assert.deepStrictEqual(Object.fromEntries(Object.entries(merged).map(([k, l]) => [k, l.map(x => x.id + ':' + x.in)])), { a: ['s1:100', 's2:2'], b: ['s3:3'] });
});

test('calendar: weeks start on Monday; first tap starts, second ends, an earlier day swaps', () => {
  const w = monthWeeks(2026, 9); // October 2026 starts on a Thursday
  assert.deepStrictEqual(w[0], [null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  assert.strictEqual(w[w.length - 1].filter(Boolean).pop(), '2026-10-31');
  assert.strictEqual(monthWeeks(2024, 1).flat().filter(Boolean).length, 29);
  assert.strictEqual(dayOf(2026, 0, 5), '2026-01-05');
  let r = rangePick({ from: '', to: '' }, '2026-10-10');
  assert.deepStrictEqual(r, { from: '2026-10-10', to: '' });
  assert.deepStrictEqual(rangePick(r, '2026-10-20'), { from: '2026-10-10', to: '2026-10-20' });
  assert.deepStrictEqual(rangePick(r, '2026-09-01'), { from: '2026-09-01', to: '2026-10-10' });
  assert.deepStrictEqual(rangePick({ from: '2026-10-10', to: '2026-10-20' }, '2026-10-15'), { from: '2026-10-15', to: '' });
});

import { VEHICLE_CAT_ID, VEHICLE_CAT_FIELDS, vehicleCat, vehicleSummary, isPlate, aiParts, aiText, AI_TARGETS } from '../garage-core.js';

test('Ask AI: the Vehicle category has year, make, model, trim and engine as its own fields, which the rules take', () => {
  const f = categoryFields({ fields: VEHICLE_CAT_FIELDS });
  assert.deepStrictEqual(f.filter(x => x.on).map(x => x.name), ['Year', 'Make', 'Model', 'Trim', 'Engine', 'Note']);
  assert.ok(f.filter(x => x.on && x.key !== 'note').every(x => x.extra));
  assert.ok(Object.keys(VEHICLE_CAT_FIELDS).every(k => /^(label|value|part|link|note|x[A-Za-z0-9_-]{1,30})$/.test(k)));
  assert.ok(cleanFields(f.map(x => ({ key: x.key, name: x.name, on: x.on }))).ok);
  // an entry with only the year filled in is fine (the What field is off)
  assert.ok(cleanItem({ cat: VEHICLE_CAT_ID, extra: { xyear: '2019' } }, entryFields({}, { fields: f }, {})).ok);
});

test('Ask AI: the Vehicle category is found by id, or by a name someone gave it; the summary reads like a car', () => {
  const cats = sortCategories({ lights: { name: 'Lights', order: 0 }, [VEHICLE_CAT_ID]: { name: 'Vehicle', order: -1, fields: VEHICLE_CAT_FIELDS } });
  assert.strictEqual(vehicleCat(cats).id, VEHICLE_CAT_ID);
  assert.strictEqual(vehicleCat(sortCategories({ a: { name: 'Vehicle info', order: 0 } })).id, 'a');
  assert.strictEqual(vehicleCat(sortCategories({ a: { name: 'Lights', order: 0 } })), null);
  const s = { items: { a: { cat: VEHICLE_CAT_ID, extra: { xyear: '2019', xmake: 'Ford', xmodel: 'Transit 250', xengine: '3.7L V6' } } } };
  assert.strictEqual(vehicleSummary(s, cats), '2019 Ford Transit 250');
  assert.strictEqual(vehicleSummary({}, cats), '');
});

test('Ask AI: the plate is not the VIN', () => {
  for (const t of ['Plate', 'Licence plate', 'license', 'Plates']) assert.ok(isPlate(t), t);
  for (const t of ['VIN', 'Plate / VIN', 'Headlight', 'Template', '']) assert.ok(!isPlate(t), t);
});

test('Ask AI: the text has the question, the checked parts, the VIN, no plate and no names', () => {
  const cats = sortCategories({
    [VEHICLE_CAT_ID]: { name: 'Vehicle', order: -1, fields: VEHICLE_CAT_FIELDS },
    lights: { name: 'Lights', order: 0 }, plate: { name: 'Plate / VIN', order: 1 }
  });
  const s = {
    odo: { km: 182400, day: '2026-10-20' },
    items: {
      v: { cat: VEHICLE_CAT_ID, extra: { xyear: '2019', xmake: 'Ford', xmodel: 'Transit' } },
      h: { cat: 'lights', label: 'Headlight', value: 'H11', part: 'H11LL', note: 'Both sides\nsame' },
      p: { cat: 'plate', label: 'Plate', value: 'ABCD 123' },
      n: { cat: 'plate', label: 'VIN', value: '1FTYR2CM5KKA12345' },
      o: { cat: 'gone', label: 'Old thing' }
    },
    service: { a: { day: '2026-09-10', what: 'Oil change', km: 175000, cost: 89.99, by: 'justin@x.ca' } },
    reminders: { r: { what: 'Oil change', dueKm: 183000, everyKm: 8000 } }
  };
  const problems = [
    { id: '1', status: 'open', at: 1, text: 'Brakes squeal', name: 'Matt Driver' },
    { id: '2', status: 'fixed', at: 2, doneAt: 3, text: 'Wiper torn', fixNote: 'New blade', by: 'desirae@x.ca' }
  ];
  const oils = [{ state: 'checked' }, { state: 'checked' }, { state: 'missed' }];
  const base = { question: 'Why do the brakes squeal?', name: 'Van 3', s, cats, problems, oils, oilLast: { at: 9 }, oilDays: 30, today: '2026-10-26', day: t => '2026-10-0' + t };
  const parts = aiParts(cats, true, problems);
  assert.deepStrictEqual(parts.filter(p => p.group).map(p => [p.key, p.group, p.name]), [['p:1', 'open', 'Brakes squeal'], ['p:2', 'fixed', 'Wiper torn']]);
  const all = new Set(parts.filter(p => p.on).map(p => p.key));
  const t = aiText(Object.assign({ pick: all }, base));
  assert.ok(t.startsWith('Why do the brakes squeal?\n'));
  for (const want of ['VEHICLE: Van 3', 'VEHICLE\n- Year: 2019; Make: Ford; Model: Transit', 'Km: 182,400 km (read on 2026-10-20)', '- Headlight: H11; Part number: H11LL; Note: Both sides same',
    '- VIN: 1FTYR2CM5KKA12345', 'OTHER', 'OPEN PROBLEMS', '- 2026-10-01: Brakes squeal', '- 2026-10-02: Wiper torn | fixed 2026-10-03: New blade',
    '- 2026-09-10: Oil change; 175,000 km; $89.99', 'Oil change, due at 183,000 km (600 km to go); every 8,000 km; due soon',
    '- Last checked 2026-10-09', '- Last 30 days: checked on 2 shifts, not checked on 1']) assert.ok(t.includes(want), want + '\n' + t);
  for (const no of ['ABCD 123', 'Matt', 'desirae', 'justin']) assert.ok(!t.includes(no), no);
  assert.ok(aiText(Object.assign({}, base, { pick: new Set(all).add('plate') })).includes('Plate: ABCD 123'));
  // only what's checked
  const few = aiText(Object.assign({}, base, { question: '', pick: new Set(['c:plate']) }));
  assert.ok(few.includes('VIN: 1FTYR2CM5KKA12345'));
  for (const no of ['Km:', 'Headlight', 'Year: 2019', 'PROBLEMS', 'SERVICE', 'OIL', 'OTHER']) assert.ok(!few.includes(no), no);
  assert.ok(few.startsWith("Tell me what's useful"));
  // one problem on its own
  const one = aiText(Object.assign({}, base, { pick: new Set(['p:2']) }));
  assert.ok(one.includes('FIXED PROBLEMS') && one.includes('Wiper torn') && !one.includes('Brakes') && !one.includes('OPEN PROBLEMS'));
  assert.deepStrictEqual(AI_TARGETS.map(x => x.name), ['Gemini', 'ChatGPT', 'Claude']);
});
