import test from 'node:test';
import assert from 'node:assert';
// Helpers in garage-core.js. Run with: node --test tests/garage.test.mjs
import {
  defaultCategories, sortCategories, garageVehicles, reportList, oilList, shiftVehicle,
  itemGroups, serviceList, searchGarage, cleanItem, cleanService, cleanLink,
  addMonths, daysBetween, currentKm, reminderState, reminderList, serviceDue, cleanReminder, nextReminder, cleanOdo,
  stamps, trashList, trashExpired, restoreWrites, toCsv, csvRows, TRASH_DAYS,
  clockState, clockInUse
} from '../garage-core.js';

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

test('time clock switch: a GPS name is always on, a van in timeclock/vans is on, anything else is off', () => {
  const gps = [{ id: 'gps1', name: 'Van 12' }];
  const vans = [{ id: 'van_a', name: '12' }, { id: 'van_b', name: 'Forklift' }, { id: 'van_c', name: 'forklift' }, { id: 'van_d', name: '3' }];
  assert.deepStrictEqual(clockState('12', gps, vans, vanKey), { state: 'gps', gpsName: 'Van 12', vanIds: ['van_a'] });
  assert.deepStrictEqual(clockState('forklift', gps, vans, vanKey), { state: 'on', gpsName: '', vanIds: ['van_b', 'van_c'] });
  assert.deepStrictEqual(clockState('7', gps, vans, vanKey), { state: 'off', gpsName: '', vanIds: [] });
  assert.deepStrictEqual(clockState('7', null, null, vanKey), { state: 'off', gpsName: '', vanIds: [] });
  assert.strictEqual(clockInUse(['van_b', 'van_c'], { van_c: { name: 'Matt' } }), 'Matt');
  assert.strictEqual(clockInUse(['van_b'], { van_c: { name: 'Matt' } }), '');
  assert.strictEqual(clockInUse(['van_b'], null), '');
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
