import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Garage loads the time clock's code (../timeclock/tc-core.js) when the page opens, so a change in the timeclock repo
// can break Garage without anything changing here. This checks the time clock's current tc-core.js still has
// everything garage.html uses, and that the helpers Garage relies on still work the same way.
// Run with: node --test tests/timeclock.test.mjs   (TC_CORE=../timeclock/tc-core.js checks a local copy instead)
// GitHub runs it on every push and every day.

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'garage.html'), 'utf8');
const SOURCES = ['https://app.eandccourier.ca/timeclock/tc-core.js', 'https://raw.githubusercontent.com/ogpoopdogg/timeclock/main/tc-core.js'];

async function load() {
  if (process.env.TC_CORE) return [{ from: process.env.TC_CORE, src: fs.readFileSync(process.env.TC_CORE, 'utf8') }];
  const out = [];
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) out.push({ from: url, src: await res.text() });
      else console.log(url + ': ' + res.status);
    } catch (e) { console.log(url + ': ' + e.message); }
  }
  return out;
}
const copies = await load();

// The names garage.html takes from tc-core.js: const { ... } = core;
function usedNames() {
  const m = html.match(/const\s*\{([^}]*)\}\s*=\s*core;/);
  assert.ok(m, 'garage.html no longer has "const { ... } = core;"');
  return m[1].split(',').map(s => s.trim()).filter(Boolean);
}

// tc-core.js with Firebase replaced by stand-ins, so it runs in Node
async function importCore(src) {
  const stub = 'const __stub = new Proxy(function () {}, { get: (t, k) => k === "then" ? undefined : __stub, apply: () => __stub, construct: () => __stub });\n';
  const code = stub + src.replace(/^import\s*\{([^}]*)\}\s*from\s*["'][^"']+["'];?\s*$/gm, (all, names) => 'const {' + names + '} = __stub;');
  assert.ok(!/^\s*import\s/m.test(code), 'tc-core.js has an import Garage\'s check doesn\'t know how to stand in for');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-core-'));
  const file = path.join(dir, 'tc-core.mjs');
  fs.writeFileSync(file, code);
  return import(pathToFileURL(file).href);
}

test('the time clock\'s tc-core.js could be downloaded', () => {
  assert.ok(copies.length, 'Couldn\'t download tc-core.js from ' + SOURCES.join(' or '));
});

for (const { from, src } of copies) {
  test('tc-core.js (' + from + ') has every name garage.html uses', () => {
    const missing = usedNames().filter(n => !new RegExp('export\\s+(?:const|let|var|async\\s+function|function|class)\\s+' + n + '\\b').test(src));
    assert.deepStrictEqual(missing, [], 'tc-core.js no longer has: ' + missing.join(', '));
  });

  test('tc-core.js (' + from + ') helpers work the way Garage expects', async () => {
    const c = await importCore(src);
    assert.strictEqual(c.vanKey('Van 12'), '12');
    assert.strictEqual(c.vanKey('vehicle 7'), '7');
    assert.strictEqual(c.vanKey('12'), '12');
    assert.strictEqual(c.emailKey('Matt.B@ec.com'), 'matt,b@ec,com');
    assert.deepStrictEqual(c.vehicleList(null, { van_a: { name: '14' }, van_b: { name: '3' }, x: { name: 'not a van' } }).map(v => v.name), ['3', '14']);
    for (const k of ['vans', 'vanReports', 'shifts', 'oilPlan', 'oilLast', 'employees', 'gps']) assert.strictEqual(typeof c.P[k], 'string', 'P.' + k);
    assert.strictEqual(c.isAdminEmail('Justin@ec.com'), true);
    assert.strictEqual(c.oilState({ in: 1 }), 'none');
    assert.strictEqual(c.oilState({ in: 1, out: 2, vehicleId: 'van_a', oil: { done: true } }), 'checked');
    assert.strictEqual(c.oilState({ in: 1, out: 2, vehicleId: 'van_a' }), 'missed');
    assert.strictEqual(c.oilState({ in: 1, vehicleId: 'van_a' }), 'waiting');
    assert.deepStrictEqual(c.cleanOilPlan({ mode: 'every', every: 3 }), { mode: 'every', every: 3 });
    assert.strictEqual(c.oilPlanFor({ vehicles: { 12: { mode: 'never' } } }, 'Van 12').mode, 'never');
    assert.strictEqual(typeof c.oilNextDue, 'function');
    assert.match(c.dayKey(Date.UTC(2026, 9, 18, 18)), /^2026-10-18$/);
    // Optional: the Firebase version Garage loads the rest of Firebase in (garage.html uses 12.19.0 without it)
    if (c.FIREBASE_SDK !== undefined) assert.match(c.FIREBASE_SDK, /^https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/$/);
  });
}
