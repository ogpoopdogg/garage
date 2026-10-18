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

test('entries: need a category and a name; only web links; limits on each field', async () => {
  const db = admin();
  await assertSucceeds(db.ref('garage/vehicles/12/items/i1').set({ cat: 'lights', label: 'Headlight' }));
  await assertFails(db.ref('garage/vehicles/12/items/i2').set({ label: 'Headlight' }));
  await assertFails(db.ref('garage/vehicles/12/items/i2').set({ cat: 'lights', label: '' }));
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
