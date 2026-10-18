import test from 'node:test';
import assert from 'node:assert';
// Helpers in garage-core.js. Run with: node --test tests/garage.test.mjs
import {
  defaultCategories, sortCategories, garageVehicles, idToKeyMap, recordKey, reportList, oilList, shiftVehicle,
  itemGroups, serviceList, searchGarage, cleanItem, cleanService, cleanLink
} from '../garage-core.js';

// The time clock's vanKey (timeclock/tc-core.js): "Van 12", "van12" and "12" are the same vehicle
const vanKey = name => String(name || '').toLowerCase().replace(/\b(?:van|vehicle)(?=\b|\d)/g, '').replace(/[^a-z0-9]/g, '');

test('starting categories, sorted by their order', () => {
  const cats = sortCategories(defaultCategories());
  assert.deepStrictEqual(cats.map(c => c.name), ['Lights', 'Fluids', 'Tires', 'Filters', 'Wipers', 'Battery', 'Plate / VIN', 'Notes']);
  assert.deepStrictEqual(sortCategories({ b: { name: 'B', order: 1 }, a: { name: 'A', order: 0 }, x: { name: '  ' } }).map(c => c.id), ['a', 'b']);
});

test('vehicles: one per key, and ones with entries that left the van list stay', () => {
  const list = [{ id: 'g12', name: 'Van 12' }, { id: 'van_x', name: '12' }, { id: 'g3', name: '3' }];
  const stored = { 7: { name: 'Van 7', items: { i: { cat: 'lights', label: 'Headlight' } } }, 9: { name: 'Van 9' } };
  const v = garageVehicles(list, stored, vanKey);
  assert.deepStrictEqual(v, [
    { key: '3', name: '3', ids: ['g3'], inList: true },
    { key: '12', name: 'Van 12', ids: ['g12', 'van_x'], inList: true },
    { key: '7', name: 'Van 7', ids: [], inList: false }
  ]);
  const m = idToKeyMap(v);
  assert.strictEqual(recordKey('van_x', 'whatever', m, vanKey), '12');
  assert.strictEqual(recordKey('gone', 'Van 7', m, vanKey), '7');
});

test('problems: open first, then newest; fixed ones stay in the list', () => {
  const r = reportList({
    a: { at: 1, text: 'old open', status: 'open', vehicleId: 'g12' },
    b: { at: 5, text: 'fixed', status: 'fixed', vehicleName: 'Van 3' },
    c: { at: 3, text: 'new open', status: 'open', vehicleName: '12' },
    d: { at: 9, status: 'open' }
  }, { g12: '12' }, vanKey);
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
  const o = oilList(shifts, 50, oilState, { g12: '12', g3: '3' }, vanKey);
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
  const vehicles = [{ key: '12', name: '12', ids: [], inList: true }, { key: '3', name: '3', ids: [], inList: true }];
  const stored = {
    12: { items: { a: { cat: 'lights', label: 'Headlight', value: 'H11' }, b: { cat: 'wipers', label: 'Driver wiper', value: '22 in' } }, service: { s: { day: '2026-10-01', what: 'Oil change' } } },
    3: { items: { a: { cat: 'lights', label: 'Headlight', value: '9006' } } }
  };
  assert.deepStrictEqual(searchGarage('h11', vehicles, stored, cats).map(h => h.vehicle.key + ':' + h.entry.id), ['12:a']);
  assert.deepStrictEqual(searchGarage('headlight', vehicles, stored, cats).map(h => h.vehicle.key), ['3', '12']);
  assert.deepStrictEqual(searchGarage('lights van 3', vehicles, stored, cats).map(h => h.vehicle.key), ['3']);
  assert.deepStrictEqual(searchGarage('oil', vehicles, stored, cats).map(h => h.kind), ['service']);
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
