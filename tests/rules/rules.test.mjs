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

test('edit history: on entries, service and reminders, and garage/problem_edits; only the fields each one has', async () => {
  const db = admin();
  const ed = { at: 5, by: 'justin@ec.com', was: { value: 'H11', part: '', xA: 'red' } };
  await assertSucceeds(db.ref('garage/vehicles/12/items/i1').set(Object.assign({}, item, { edits: { '-Nabc_1': ed } })));
  await assertSucceeds(db.ref('garage/vehicles/12/service/s1').set({ day: '2026-10-01', what: 'Oil change', km: 181000, edits: { e1: { at: 5, by: 'justin@ec.com', was: { km: 180000, cost: '' } } } }));
  await assertSucceeds(db.ref('garage/vehicles/12/reminders/r1').set({ what: 'Oil change', dueKm: 190000, edits: { e1: { at: 5, was: { dueKm: 188000, note: 'x' } } } }));
  await assertSucceeds(db.ref('garage/problem_edits/-Nrep_1/e1').set({ at: 5, by: 'desirae@ec.com', was: { text: 'Light out' } }));
  await assertSucceeds(db.ref('garage/problem_edits/-Nrep_1/e2').set({ at: 6, by: 'desirae@ec.com', was: { fixNote: '' } }));
  // fields an entry doesn't have, no "was", nothing in it, too long, or something else saved
  await assertFails(db.ref('garage/vehicles/12/items/i1/edits/e2').set({ at: 5, was: { km: 1 } }));
  await assertFails(db.ref('garage/vehicles/12/service/s1/edits/e2').set({ at: 5, was: { label: 'x' } }));
  await assertFails(db.ref('garage/problem_edits/-Nrep_1/e3').set({ at: 5, was: { status: 'open' } }));
  await assertFails(db.ref('garage/problem_edits/-Nrep_1/e3').set({ at: 5 }));
  await assertFails(db.ref('garage/problem_edits/-Nrep_1/e3').set({ at: 5, was: { text: 'x'.repeat(1001) } }));
  await assertFails(db.ref('garage/problem_edits/-Nrep_1/e3').set({ at: 5, was: { text: 'x' }, why: 'typo' }));
  await assertFails(db.ref('garage/problem_edits/bad id/e3').set({ at: 5, was: { text: 'x' } }));
  await assertFails(as('matt@ec.com').ref('garage/problem_edits/-Nrep_1/e3').set({ at: 5, was: { text: 'x' } }));
  await assertFails(as('matt@ec.com').ref('garage/problem_edits').once('value'));
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

test('read and cleared marks: a problem can only be cleared once it\'s fixed; oil checks by employee and shift', async () => {
  await env.withSecurityRulesDisabled(ctx => ctx.database().ref('timeclock/van_reports').set({
    open1: { at: 1, text: 'Light out', status: 'open' }, fixed1: { at: 1, text: 'Wiper', status: 'fixed' }
  }));
  const db = admin();
  const m = { at: 5, by: 'desirae@ec.com' };
  await assertSucceeds(db.ref('garage/problem_reads/open1').set(m));
  await assertSucceeds(db.ref('garage/problem_cleared/fixed1').set(m));
  await assertFails(db.ref('garage/problem_cleared/open1').set(m));
  await assertFails(db.ref('garage/problem_cleared/nope').set(m));
  await assertSucceeds(db.ref('garage/problem_cleared/fixed1').remove());
  await assertFails(db.ref('garage/problem_reads/open1').set({ by: 'x' }));
  await assertFails(db.ref('garage/problem_reads/open1').set({ at: 5, why: 'x' }));
  await assertFails(db.ref('garage/problem_reads/bad id').set(m));
  await assertSucceeds(db.ref('garage/problem_sent/open1').set(m));
  await assertSucceeds(db.ref('garage/problem_sent/fixed1').set(m));
  await assertFails(db.ref('garage/problem_sent/open1').set({ by: 'x' }));
  await assertFails(db.ref('garage/problem_sent/open1').set({ at: 5, chat: 'x' }));
  await assertSucceeds(db.ref('garage/oil_cleared/matt@ec,com/-Nshift_1').set(m));
  await assertSucceeds(db.ref('garage/oil_shown/matt@ec,com/-Nshift_2').set(m));
  await assertFails(db.ref('garage/oil_cleared/matt@ec,com/-Nshift_1').set({ at: 'today' }));
  await assertFails(db.ref('garage/oil_shown/matt@ec,com').set(true));
  const matt = as('matt@ec.com');
  await assertFails(matt.ref('garage/problem_reads/open1').set(m));
  await assertFails(matt.ref('garage/problem_sent/open1').set(m));
  await assertFails(matt.ref('garage/oil_cleared').once('value'));
});

// Staff: accounts with staff/{uid} true (the same flag the other staff tools check) get the same Garage as the
// admins (Justin, 2026-11-15): vehicle records, problems, categories, vehicles, the Trash. They can read the oil checks
// but only the admins clear them or bring them back (marking them read and the schedule are in the time clock's rules).
const staff = async (email) => {
  const db = as(email);
  await env.withSecurityRulesDisabled(ctx => ctx.database().ref('staff/' + email.replace(/[^a-z]/g, '')).set(true));
  return db;
};
const svc = { day: '2026-11-06', what: 'Oil change', km: 182500, at: 1, by: 'sam@ec.com' };
const rem = { what: 'Oil change', dueKm: 190000, at: 1, by: 'sam@ec.com' };

test('staff can read and change the vehicle records', async () => {
  const db = await staff('sam@ec.com');
  await assertSucceeds(db.ref('garage/categories').once('value'));
  await assertSucceeds(db.ref('garage/vehicles').once('value'));
  await assertSucceeds(db.ref('garage/trash').once('value'));
  await assertSucceeds(db.ref('garage/history/12').once('value'));
  await assertSucceeds(db.ref('garage/vehicles/12/name').set('12'));
  await assertSucceeds(db.ref('garage/vehicles/12/items/i1').set(item));
  await assertSucceeds(db.ref('garage/vehicles/12/items/i1/note').set('left side'));
  await assertSucceeds(db.ref('garage/vehicles/12/service/s1').set(svc));
  await assertSucceeds(db.ref('garage/vehicles/12/reminders/r1').set(rem));
  await assertSucceeds(db.ref('garage/vehicles/12/odo').set({ km: 182600, day: '2026-11-06', at: 1, by: 'sam@ec.com' }));
  await assertSucceeds(db.ref('garage/history/12/h1').set({ at: 1, by: 'sam@ec.com', text: 'Km updated' }));
  await assertSucceeds(db.ref('garage/vehicles/12/items/i1').remove());
  // the same checks as for admins
  await assertFails(db.ref('garage/vehicles/12/items/i2').set(Object.assign({}, item, { link: 'javascript:alert(1)' })));
});

test('staff get the rest of Garage too, the same as the admins', async () => {
  const db = await staff('sam@ec.com');
  await assertSucceeds(db.ref('garage').once('value'));
  for (const p of ['problem_edits', 'problem_reads', 'problem_sent', 'problem_cleared', 'oil_cleared', 'oil_shown']) await assertSucceeds(db.ref('garage/' + p).once('value'));
  await assertSucceeds(db.ref('garage/problem_reads/r1').set({ at: 1, by: 'sam@ec.com' }));
  // clearing and bringing back oil checks stays with the admins
  await assertFails(db.ref('garage/oil_cleared/sam@ec,com/s1').set({ at: 1, by: 'sam@ec.com' }));
  await assertFails(db.ref('garage/oil_shown/sam@ec,com/s1').set({ at: 1, by: 'sam@ec.com' }));
  await assertSucceeds(db.ref('garage/categories/x').set({ name: 'Brakes', order: 1 }));
  await assertSucceeds(db.ref('garage/vehicles/14').set({ name: '14', listed: true }));
  await assertFails(db.ref('garage/vehicles/12/removed').set(true)); // only Justin removes vehicles
  // the same checks as for admins
  await assertFails(db.ref('garage/categories/bad id!').set({ name: 'Brakes' }));
  await assertFails(db.ref('garage/nothing_here').set(true));
});

test('staff and the Trash: the same as the admins, including putting vehicles back and deleting for good', async () => {
  const db = await staff('sam@ec.com');
  const t = { at: 1, by: 'sam@ec.com', kind: 'item', vkey: '12', vname: '12', id: 'i1', data: item };
  await assertSucceeds(db.ref().update({ 'garage/vehicles/12/items/i1': null, 'garage/trash/t1': t }));
  await assertSucceeds(db.ref('garage/trash/t1').remove());
  await env.withSecurityRulesDisabled(ctx => ctx.database().ref('garage/trash/t4').set({ at: 1, by: 'justin@ec.com', kind: 'vehicle', vkey: '14', vname: '14', id: '', data: { name: '14' } }));
  await assertSucceeds(db.ref().update({ 'garage/vehicles/14/name': '14', 'garage/vehicles/14/removed': null, 'garage/trash/t4': null }));
});

test('an account that isn\'t staff (or whose staff flag is off) gets nothing', async () => {
  await env.withSecurityRulesDisabled(ctx => ctx.database().ref('staff/pat').set(false));
  for (const db of [as('pat@ec.com'), as('matt@ec.com')]) {
    await assertFails(db.ref('garage/vehicles').once('value'));
    await assertFails(db.ref('garage/categories').once('value'));
    await assertFails(db.ref('garage/vehicles/12/items/i1').set(item));
    await assertFails(db.ref('garage/history/12/h1').set({ at: 1, by: 'x', text: 'x' }));
  }
});

test('AI marks and check marks on an entry\'s fields: { at, by } per field, staff too', async () => {
  const db = await staff('sam@ec.com');
  const p = 'garage/vehicles/12/items/i1';
  await assertSucceeds(db.ref(p).set(Object.assign({}, item, { ai: { part: { at: 1, by: 'sam@ec.com' }, 'x-Nabc_1': { at: 1 } } })));
  // confirming: the AI mark goes, the check mark comes, in one write
  await assertSucceeds(db.ref().update({ [p + '/ai/part']: null, [p + '/ok/part']: { at: 2, by: 'sam@ec.com' } }));
  await assertSucceeds(db.ref(p + '/ok/label').set({ at: 3 }));
  await assertFails(db.ref(p + '/ai/price').set({ at: 1 }));
  await assertFails(db.ref(p + '/ai/part').set(true));
  await assertFails(db.ref(p + '/ok/part').set({ by: 'sam@ec.com' }));
  await assertFails(db.ref(p + '/ok/part').set({ at: 'today' }));
  await assertFails(db.ref(p + '/ok/part').set({ at: 1, by: 'x'.repeat(101) }));
  await assertFails(db.ref(p + '/ok/part').set({ at: 1, sure: true }));
  const matt = as('matt@ec.com');
  await assertFails(matt.ref(p + '/ok/value').set({ at: 1 }));
});

test('My vehicles (garage_personal/{uid}): only that staff member or admin reads and writes their own', async () => {
  const sam = await staff('sam@ec.com');
  const mine = 'garage_personal/' + 'sam@ec.com'.replace(/[^a-z]/g, '');
  await assertSucceeds(sam.ref().update({ [mine + '/vehicles/civic/name']: 'Civic', [mine + '/vehicles/civic/listed']: true, [mine + '/history/civic/h1']: { at: 1, by: 'sam@ec.com', text: 'Vehicle added to My vehicles' } }));
  await assertSucceeds(sam.ref(mine + '/vehicles/civic/items/i1').set(item));
  await assertSucceeds(sam.ref(mine).once('value'));
  // their own trash: put in, and delete for good
  await assertSucceeds(sam.ref(mine + '/trash/t1').set({ at: 1, by: 'sam@ec.com', kind: 'vehicle', vkey: 'civic', vname: 'Civic', id: '', data: { name: 'Civic' } }));
  await assertSucceeds(sam.ref(mine + '/trash/t1').remove());
  // the same checks as the company vehicles
  await assertFails(sam.ref(mine + '/vehicles/civic/items/i2').set({ label: 'No category' }));
  await assertFails(sam.ref(mine + '/vehicles/BadKey!/name').set('x'));
  await assertFails(sam.ref(mine + '/other').set(true));
  // nobody else's: not other staff, not the admins, not employees, not signed out
  const pat = await staff('pat@ec.com');
  for (const db of [pat, admin(), as('matt@ec.com'), env.unauthenticatedContext().database()]) {
    await assertFails(db.ref(mine).once('value'));
    await assertFails(db.ref(mine + '/vehicles/civic/items/i3').set(item));
  }
  // their own problems: report, mark fixed, edits, read mark; the same checks as van_reports
  await assertSucceeds(sam.ref(mine + '/problems/p1').set({ at: 1, ek: 'sam@ec,com', name: 'Sam', vehicleId: 'garage_civic', vehicleName: 'Civic', text: 'Brake light out', status: 'open' }));
  await assertSucceeds(sam.ref().update({ [mine + '/problems/p1/status']: 'fixed', [mine + '/problems/p1/fixNote']: 'New bulb', [mine + '/problems/p1/by']: 'sam@ec.com', [mine + '/problems/p1/doneAt']: 2 }));
  await assertSucceeds(sam.ref(mine + '/problem_reads/p1').set({ at: 1, by: 'sam@ec.com' }));
  await assertSucceeds(sam.ref(mine + '/problem_edits/p1/e1').set({ at: 1, by: 'sam@ec.com', was: { text: 'Light out' } }));
  await assertFails(sam.ref(mine + '/problems/p2').set({ text: 'No status' }));
  await assertFails(sam.ref(mine + '/problems/p1/status').set('gone'));
  await assertFails(pat.ref(mine + '/problems/p2').set({ at: 1, ek: 'x', vehicleId: 'v', text: 'Not mine', status: 'open' }));
  // an admin has their own section too
  await assertSucceeds(admin().ref('garage_personal/' + 'justin@ec.com'.replace(/[^a-z]/g, '') + '/vehicles/truck/name').set('Truck'));
  // an employee who isn't staff can't have one
  await assertFails(as('matt@ec.com').ref('garage_personal/' + 'matt@ec.com'.replace(/[^a-z]/g, '') + '/vehicles/car/name').set('Car'));
});

test('only justin@ec.com removes a company vehicle (or deletes one); everyone else still changes it and puts it back', async () => {
  const seed = () => env.withSecurityRulesDisabled(ctx => ctx.database().ref('garage/vehicles/12').set({ name: '12', items: { i1: item } }));
  const removal = (by) => ({ 'garage/vehicles/12': { name: '12', removed: true }, 'garage/trash/t1': { at: 1, by: by, kind: 'vehicle', vkey: '12', vname: '12', id: '', data: { name: '12', items: { i1: item } } } });
  await seed();
  const others = [as('desirae@ec.com'), as('celeste@ec.com'), await staff('sam@ec.com')];
  for (const db of others) {
    await assertFails(db.ref().update(removal('x@ec.com')));
    await assertFails(db.ref('garage/vehicles/12/removed').set(true));
    await assertFails(db.ref('garage/vehicles/12').remove());
    await assertFails(db.ref('garage/vehicles').remove());
    await assertFails(db.ref('garage').remove());
    await assertFails(db.ref('garage/trash/t9').set({ at: 1, by: 'x@ec.com', kind: 'vehicle', vkey: '12', vname: '12', id: '', data: { name: '12' } }));
    // but they still change it, add vehicles, delete entries, and use the rest of Garage
    await assertSucceeds(db.ref('garage/vehicles/12/items/i2').set(item));
    await assertSucceeds(db.ref('garage/vehicles/12/listed').set(true));
    await assertSucceeds(db.ref('garage/vehicles/15').set({ name: '15', listed: true }));
    await assertSucceeds(db.ref().update({ 'garage/vehicles/12/items/i2': null, 'garage/trash/t2': { at: 1, by: 'x@ec.com', kind: 'item', vkey: '12', vname: '12', id: 'i2', data: item } }));
    await assertSucceeds(db.ref('garage/trash/t2').remove());
    await assertSucceeds(db.ref('garage/categories/x').set({ name: 'Brakes', order: 1 }));
  }
  // the admins (not staff) still clear oil checks
  await assertSucceeds(as('desirae@ec.com').ref('garage/oil_cleared/sam@ec,com/s1').set({ at: 1, by: 'desirae@ec.com' }));
  await assertSucceeds(as('desirae@ec.com').ref('garage/oil_shown/sam@ec,com/s1').set({ at: 1, by: 'desirae@ec.com' }));
  // Justin removes it; then anyone with Garage can put it back
  await assertSucceeds(admin().ref().update(removal('justin@ec.com')));
  await assertSucceeds(as('desirae@ec.com').ref().update({ 'garage/vehicles/12/removed': null, 'garage/vehicles/12/name': '12', 'garage/vehicles/12/items/i1': item, 'garage/trash/t1': null }));
  await assertSucceeds(admin().ref('garage/vehicles/12').remove());
});
