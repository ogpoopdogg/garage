// Database rules (../../database.rules.json) against the Realtime Database emulator.
// Run from this folder: npm ci, then npm test (it starts the emulator; needs Java 11+).
import test, { before, after, beforeEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

const RULES = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'database.rules.json'), 'utf8');
let env;
const as = (email) => env.authenticatedContext(email.replace(/[^a-z]/g, ''), { email: email }).database();
const admin = () => as('justin@ec.com');

before(async () => {
  const [host, port] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000').split(':');
  env = await initializeTestEnvironment({ projectId: 'demo-garage', database: { rules: RULES, host, port: Number(port) } });
});
after(async () => { if (env) await env.cleanup(); });
beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(ctx => ctx.database().ref('garage/categories/lights').set({ name: 'Lights', order: 0 }));
});

const item = { cat: 'lights', label: 'Headlight', value: 'H11', part: '9008', link: 'https://www.partsource.ca/x', note: 'both sides', at: 1, by: 'justin@ec.com' };

test('each admin can read and write the garage', async () => {
  for (const email of ['justin@ec.com', 'Desirae@ec.com', 'celeste@ec.com']) {
    const db = as(email);
    await assertSucceeds(db.ref('garage').once('value'));
    await assertSucceeds(db.ref('garage/vehicles/12/items/i1').set(item));
  }
});

test('an employee or someone not signed in can\'t read or write the garage', async () => {
  const matt = as('matt@ec.com');
  await assertFails(matt.ref('garage').once('value'));
  await assertFails(matt.ref('garage/vehicles/12/items/i1').set(item));
  await assertFails(matt.ref('garage/categories/x').set({ name: 'Brakes', order: 1 }));
  const anon = env.unauthenticatedContext().database();
  await assertFails(anon.ref('garage/categories').once('value'));
});

test('categories: a name is needed, 40 characters at most, nothing else saved', async () => {
  const db = admin();
  await assertSucceeds(db.ref('garage/categories/-Nabc_1').set({ name: 'Brakes', order: 8 }));
  await assertSucceeds(db.ref('garage/categories/lights/name').set('Bulbs'));
  await assertSucceeds(db.ref('garage/categories/lights/order').set(3));
  await assertFails(db.ref('garage/categories/x').set({ order: 1 }));
  await assertFails(db.ref('garage/categories/x').set({ name: '', order: 1 }));
  await assertFails(db.ref('garage/categories/x').set({ name: 'x'.repeat(41), order: 1 }));
  await assertFails(db.ref('garage/categories/x').set({ name: 'Brakes', color: 'red' }));
});

test('category fields: built-in or own keys, each with a name; entries can have only the category\'s own fields', async () => {
  const db = admin();
  await assertSucceeds(db.ref('garage/categories/m').set({ name: 'Model', order: 1, fields: { label: { name: 'What', order: 0, off: true }, value: { name: 'Model number', order: 1 }, 'x-Nabc_1': { name: 'Colour', order: 2 } } }));
  await assertFails(db.ref('garage/categories/m/fields/price').set({ name: 'Price', order: 3 }));
  await assertFails(db.ref('garage/categories/m/fields/xA').set({ order: 3 }));
  await assertFails(db.ref('garage/categories/m/fields/xA').set({ name: 'x'.repeat(41) }));
  await assertFails(db.ref('garage/categories/m/fields/xA').set({ name: 'A', off: 'yes' }));
  await assertFails(db.ref('garage/categories/m/fields/xA').set({ name: 'A', colour: 'red' }));
  await assertSucceeds(db.ref('garage/vehicles/12/items/i1').set({ cat: 'm', value: 'ABC-123' }));
  await assertSucceeds(db.ref('garage/vehicles/12/items/i2').set({ cat: 'm', extra: { 'x-Nabc_1': 'white' } }));
  await assertFails(db.ref('garage/vehicles/12/items/i3').set({ cat: 'm' }));
  await assertFails(db.ref('garage/vehicles/12/items/i3').set({ cat: 'm', extra: 'white' }));
  await assertFails(db.ref('garage/vehicles/12/items/i3').set({ cat: 'm', extra: { price: '5' } }));
  await assertFails(db.ref('garage/vehicles/12/items/i3').set({ cat: 'm', extra: { xA: 'x'.repeat(201) } }));
});

test('entries: need a category and something filled in; only web links; limits on each field', async () => {
  const db = admin();
  await assertSucceeds(db.ref('garage/vehicles/12/items/i1').set({ cat: 'lights', label: 'Headlight' }));
  await assertFails(db.ref('garage/vehicles/12/items/i2').set({ label: 'Headlight' }));
  await assertFails(db.ref('garage/vehicles/12/items/i2').set({ cat: 'lights', label: '' }));
  await assertFails(db.ref('garage/vehicles/12/items/i2').set({ cat: 'lights' }));
  await assertFails(db.ref('garage/vehicles/12/items/i2').set(Object.assign({}, item, { link: 'javascript:alert(1)' })));
  await assertFails(db.ref('garage/vehicles/12/items/i2').set(Object.assign({}, item, { value: 'x'.repeat(201) })));
  await assertFails(db.ref('garage/vehicles/12/items/i2').set(Object.assign({}, item, { price: 5 })));
  await assertFails(db.ref('garage/vehicles/Van 12/items/i2').set(item));
});

test('service log: date and what were done; km and cost are numbers in range', async () => {
  const db = admin();
  const e = { day: '2026-10-18', what: 'Oil change', km: 182500, cost: 89.99, note: 'Quick Lube', at: 1, by: 'justin@ec.com' };
  await assertSucceeds(db.ref('garage/vehicles/12/service/s1').set(e));
  await assertSucceeds(db.ref('garage/vehicles/12/name').set('Van 12'));
  await assertFails(db.ref('garage/vehicles/12/service/s2').set(Object.assign({}, e, { day: '18/10/2026' })));
  await assertFails(db.ref('garage/vehicles/12/service/s2').set(Object.assign({}, e, { what: '' })));
  await assertFails(db.ref('garage/vehicles/12/service/s2').set(Object.assign({}, e, { km: -1 })));
  await assertFails(db.ref('garage/vehicles/12/service/s2').set(Object.assign({}, e, { cost: '89' })));
  await assertFails(db.ref('garage/vehicles/12/other').set(1));
  await assertFails(db.ref('garage/other').set(1));
});

test('who added an entry, and vehicles added or removed in Garage', async () => {
  const db = admin();
  await assertSucceeds(db.ref('garage/vehicles/12/items/i1').set(Object.assign({}, item, { added: 1, addedBy: 'celeste@ec.com' })));
  await assertSucceeds(db.ref('garage/vehicles/12/service/s1').set({ day: '2026-10-18', what: 'Oil change', added: 1, addedBy: 'celeste@ec.com', at: 2, by: 'justin@ec.com' }));
  await assertSucceeds(db.ref('garage/vehicles/14').set({ name: '14', listed: true }));
  await assertSucceeds(db.ref('garage/vehicles/5').set({ name: '5', removed: true }));
  await assertFails(db.ref('garage/vehicles/14/listed').set('yes'));
  await assertFails(db.ref('garage/vehicles/12/items/i1/added').set('today'));
});

test('service reminders: what, and a km or a date it is due', async () => {
  const db = admin();
  const r = { what: 'Oil change', dueKm: 190500, dueDay: '2027-04-18', everyKm: 8000, everyMonths: 6, note: 'synthetic', added: 1, addedBy: 'justin@ec.com', at: 1, by: 'justin@ec.com' };
  await assertSucceeds(db.ref('garage/vehicles/12/reminders/r1').set(r));
  await assertSucceeds(db.ref('garage/vehicles/12/reminders/r2').set({ what: 'Tires', dueDay: '2027-05-01' }));
  // marking it done moves it on (a km reminder can drop its date)
  await assertSucceeds(db.ref().update({ 'garage/vehicles/12/reminders/r1/dueKm': 198500, 'garage/vehicles/12/reminders/r1/dueDay': null }));
  await assertFails(db.ref('garage/vehicles/12/reminders/r3').set({ what: 'Tires' }));
  await assertFails(db.ref('garage/vehicles/12/reminders/r3').set({ what: '', dueKm: 1 }));
  await assertFails(db.ref('garage/vehicles/12/reminders/r3').set(Object.assign({}, r, { everyMonths: 1.5 })));
  await assertFails(db.ref('garage/vehicles/12/reminders/r3').set(Object.assign({}, r, { everyKm: 0 })));
  await assertFails(db.ref('garage/vehicles/12/reminders/r3').set(Object.assign({}, r, { dueDay: 'soon' })));
  await assertFails(db.ref('garage/vehicles/12/reminders/r3').set(Object.assign({}, r, { color: 'red' })));
});

test('km reading', async () => {
  const db = admin();
  await assertSucceeds(db.ref('garage/vehicles/12/odo').set({ km: 182500, day: '2026-10-18', at: 1, by: 'justin@ec.com' }));
  await assertFails(db.ref('garage/vehicles/12/odo').set({ day: '2026-10-18' }));
  await assertFails(db.ref('garage/vehicles/12/odo').set({ km: -5 }));
  await assertFails(db.ref('garage/vehicles/12/odo').set({ km: 5, where: 'dash' }));
});

test('trash and the change history: admins only, and only what Garage saves', async () => {
  const db = admin();
  const t = { at: 1, by: 'justin@ec.com', kind: 'item', vkey: '12', vname: '12', id: 'i1', data: { cat: 'lights', label: 'Headlight' } };
  await assertSucceeds(db.ref('garage/trash/t1').set(t));
  await assertSucceeds(db.ref('garage/trash/t2').set(Object.assign({}, t, { kind: 'vehicle', id: '', data: { name: '12', items: { a: { cat: 'x', label: 'y' } } } })));
  await assertSucceeds(db.ref('garage/trash/t1').remove());
  await assertFails(db.ref('garage/trash/t3').set(Object.assign({}, t, { kind: 'car' })));
  await assertFails(db.ref('garage/trash/t3').set(Object.assign({}, t, { data: null })));
  await assertFails(db.ref('garage/trash/t3').set(Object.assign({}, t, { vkey: 'Van 12' })));
  await assertSucceeds(db.ref('garage/history/12/h1').set({ at: 1, by: 'justin@ec.com', text: 'Added Lights: Headlight H11' }));
  await assertSucceeds(db.ref('garage/history/_all/h1').set({ at: 1, by: 'justin@ec.com', text: 'Category Brakes added' }));
  await assertFails(db.ref('garage/history/12/h2').set({ at: 1, text: '' }));
  await assertFails(db.ref('garage/history/12/h2').set({ at: 1, text: 'x'.repeat(301) }));
  await assertFails(db.ref('garage/history/Van 12/h2').set({ at: 1, text: 'x' }));
  const matt = as('matt@ec.com');
  await assertFails(matt.ref('garage/trash').once('value'));
  await assertFails(matt.ref('garage/history/12/h3').set({ at: 1, text: 'x' }));
});
