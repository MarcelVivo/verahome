const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/property-create-core.js'), 'utf8'), sandbox);
const core = sandbox.window.VeraPropertyCreateCore;
const clone = value => JSON.parse(JSON.stringify(value));
const uuid = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');

function input(overrides = {}) {
  return {
    property: { id: uuid(1), label: 'Hauptstrasse 39', street: 'Hauptstrasse 39', zip: '5070', city: 'Frick', property_type: 'mietobjekt' },
    units: [
      { id: uuid(2), label: 'Wohnung EG', unit_type: 'wohnung', rooms: '3.5', living_area_m2: '80.50', floor: ' EG ' },
      { id: uuid(3), label: 'Studio OG', unit_type: 'studio', rooms: 1, living_area_m2: 25 }
    ],
    supportsPropertyType: true,
    existingProperty: false,
    ...overrides
  };
}

// A minimal table API mock: each array insert is atomic, with hooks for
// failure before commit, response loss after commit, and read failures.
function database(seed = {}) {
  const rows = { properties: clone(seed.properties || []), units: clone(seed.units || []) };
  const calls = [];
  const faults = [];
  const client = {
    rows, calls,
    fault(table, operation, kind) { faults.push({ table, operation, kind }); },
    from(table) {
      let operation, payload, filter = () => true;
      const query = {
        select() { operation = 'select'; return query; },
        eq(key, value) { filter = row => row[key] === value; return query; },
        in(key, values) { filter = row => values.includes(row[key]); return query; },
        maybeSingle() { return execute(true); },
        insert(value) { operation = 'insert'; payload = clone(value); return query; },
        then(resolve, reject) { return execute(false).then(resolve, reject); }
      };
      async function execute(single) {
        calls.push({ table, operation, payload });
        const faultIndex = faults.findIndex(fault => fault.table === table && fault.operation === operation);
        const fault = faultIndex === -1 ? null : faults.splice(faultIndex, 1)[0].kind;
        if (fault === 'throw-before') throw new Error('Netzverbindung unterbrochen');
        if (fault === 'error-before') return { data: null, error: { message: 'Datenbankfehler' } };
        if (fault === 'malformed') return { error: null };
        if (operation === 'select') {
          const selected = clone(rows[table].filter(filter));
          return { data: single ? selected[0] || null : selected, error: null };
        }
        const incoming = Array.isArray(payload) ? payload : [payload];
        if (incoming.some(row => rows[table].some(existing => existing.id === row.id))) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        if (table === 'units' && incoming.some(row => !rows.properties.some(property => property.id === row.property_id))) {
          return { data: null, error: { code: '23503', message: 'foreign key' } };
        }
        rows[table].push(...clone(incoming));
        if (client.afterInsert) client.afterInsert(table);
        if (fault === 'archive-parent-after') rows.properties[0].archived_at = '2026-09-01';
        if (fault === 'read-fails-after') client.fault(table, 'select', 'throw-before');
        if (fault === 'throw-after') throw new Error('Antwort verloren');
        if (fault === 'error-after') return { data: null, error: { message: 'Antwort verloren' } };
        return { data: null, error: null };
      }
      return query;
    }
  };
  return client;
}

test('plan uses stable IDs, private defaults and normalized optional/numeric fields', () => {
  const source = input();
  const plan = clone(core.createPlan(source));
  assert.equal(plan.version, 1);
  assert.equal(plan.property.visibility, 'private');
  assert.deepEqual(plan.units.map(unit => unit.visibility), ['private', 'private']);
  assert.equal(plan.units[0].property_id, uuid(1));
  assert.equal(plan.units[0].rooms, 3.5);
  assert.equal(plan.units[0].living_area_m2, 80.5);
  assert.equal(plan.units[0].floor, 'EG');
  assert.equal(plan.units[1].floor, null);
  source.units[0].label = 'changed';
  assert.equal(plan.units[0].label, 'Wohnung EG');
});

test('invalid IDs, duplicate IDs, labels, types, numerics and oversized drafts are rejected', () => {
  const cases = [
    draft => { draft.property.id = 'invalid'; },
    draft => { draft.units[0].id = draft.property.id; },
    draft => { draft.units[1].id = draft.units[0].id; },
    draft => { draft.units[0].label = ' '; },
    draft => { draft.property.label = ''; },
    draft => { draft.units[0].unit_type = 'villa'; },
    draft => { draft.units[0].unit_type = 'unknown_existing_type'; },
    draft => { draft.units[0].rooms = -1; },
    draft => { draft.units[0].rooms = 0; },
    draft => { draft.units[0].rooms = 2.55; },
    draft => { draft.units[0].living_area_m2 = Infinity; },
    draft => { draft.units[0].living_area_m2 = 0.0000000001; },
    draft => { draft.units[0].living_area_m2 = true; },
    draft => { draft.units = Array.from({ length: 101 }, (_, index) => ({ id: uuid(index + 10), unit_type: 'wohnung', label: 'Wohnung ' + index })); }
  ];
  for (const change of cases) {
    const draft = input();
    change(draft);
    assert.throws(() => core.createPlan(draft));
  }
});

test('type catalogue includes detailed unit types but no houses', () => {
  const values = clone(core.UNIT_TYPES).map(type => type.value);
  assert.deepEqual(values.slice(0, 8), ['wohnung', 'studio', 'zimmer', 'gewerbe', 'garage', 'parkplatz', 'lager', 'sonstiges']);
  for (const type of ['maisonette', 'zimmer_moebliert', 'tiefgaragenplatz', 'gastronomie']) assert.ok(values.includes(type));
  for (const type of ['haus', 'villa', 'einfamilienhaus', 'reihenhaus', 'doppelhaushaelfte']) assert.ok(!values.includes(type));
});

test('unsupported property_type is omitted, but a new STWEG cannot silently become a rental property', () => {
  const draft = input({ supportsPropertyType: false });
  assert.ok(!Object.hasOwn(core.createPlan(draft).property, 'property_type'));
  draft.property.property_type = 'stweg';
  assert.throws(() => core.createPlan(draft), { code: 'PROPERTY_TYPE_UNAVAILABLE' });
});

test('one property and one batch of private units are saved, and repeat is read-only', async () => {
  const db = database();
  const plan = core.createPlan(input());
  const progress = [];
  const result = await core.savePlan(db, plan, { onProgress: event => progress.push(clone(event)) });
  assert.deepEqual(clone(result), { propertyId: uuid(1), unitIds: [uuid(2), uuid(3)] });
  assert.deepEqual(db.calls.filter(call => call.operation === 'insert').map(call => call.table), ['properties', 'units']);
  assert.equal(db.rows.units.length, 2);
  assert.deepEqual(progress.at(-1), { propertySaved: true, savedUnits: 2, totalUnits: 2 });
  db.calls.length = 0;
  await core.savePlan(db, plan);
  assert.ok(db.calls.every(call => call.operation === 'select'));
});

test('response loss after either committed insert is reconciled without duplicate writes', async () => {
  for (const kind of ['throw-after', 'error-after']) {
    const db = database();
    db.fault('properties', 'insert', kind);
    db.fault('units', 'insert', kind);
    await core.savePlan(db, core.createPlan(input()));
    assert.equal(db.rows.properties.length, 1);
    assert.equal(db.rows.units.length, 2);
    assert.equal(db.calls.filter(call => call.operation === 'insert').length, 2);
  }
});

test('network error before first commit leaves no records and the same plan can resume', async () => {
  const db = database();
  const plan = core.createPlan(input());
  db.fault('properties', 'insert', 'throw-before');
  await assert.rejects(core.savePlan(db, plan), { code: 'PROPERTY_NOT_SAVED' });
  assert.equal(db.rows.properties.length, 0);
  assert.equal(db.rows.units.length, 0);
  await core.savePlan(db, plan);
  assert.equal(db.rows.properties[0].id, plan.property.id);
});

test('failed unit batch preserves the property and resumes without recreating it', async () => {
  const db = database();
  const plan = core.createPlan(input());
  db.fault('units', 'insert', 'error-before');
  await assert.rejects(core.savePlan(db, plan), { code: 'UNITS_INCOMPLETE' });
  assert.equal(db.rows.properties.length, 1);
  assert.equal(db.rows.units.length, 0);
  db.calls.length = 0;
  await core.savePlan(db, plan);
  assert.deepEqual(db.calls.filter(call => call.operation === 'insert').map(call => call.table), ['units']);
});

test('unreadable response after commit keeps state uncertain, retry checks existing rows', async () => {
  for (const table of ['properties', 'units']) {
    const db = database();
    const plan = core.createPlan(input());
    db.fault(table, 'insert', 'read-fails-after');
    await assert.rejects(core.savePlan(db, plan), { code: 'READ_UNCERTAIN' });
    await core.savePlan(db, plan);
    assert.equal(db.rows.properties.length, 1);
    assert.equal(db.rows.units.length, 2);
    assert.equal(db.calls.filter(call => call.table === table && call.operation === 'insert').length, 1);
  }
});

test('partial saved subset resumes only missing IDs and accepts equivalent DB numeric strings', async () => {
  const plan = core.createPlan(input());
  const saved = clone(plan.units[0]);
  saved.rooms = '3.5';
  saved.living_area_m2 = '80.50';
  const db = database({ properties: [plan.property], units: [saved] });
  await core.savePlan(db, plan);
  const insert = db.calls.find(call => call.operation === 'insert');
  assert.equal(insert.table, 'units');
  assert.deepEqual(insert.payload.map(unit => unit.id), [uuid(3)]);
});

test('existing properties are never overwritten even when public or renamed', async () => {
  const plan = core.createPlan(input({ existingProperty: true }));
  const existing = { ...clone(plan.property), label: 'Neuer Name', visibility: 'public' };
  const db = database({ properties: [existing] });
  await core.savePlan(db, plan);
  assert.deepEqual(db.rows.properties[0], existing);
  assert.ok(!db.calls.some(call => call.table === 'properties' && call.operation === 'insert'));
});

test('missing selected property, archived records and changed saved fields block writes', async () => {
  const plan = core.createPlan(input());
  const missing = database();
  await assert.rejects(core.savePlan(missing, { ...plan, existingProperty: true }), { code: 'PROPERTY_MISSING' });
  assert.ok(missing.calls.every(call => call.operation === 'select'));
  for (const property of [
    { ...clone(plan.property), archived_at: '2026-09-01' },
    { ...clone(plan.property), city: 'Basel' },
    { ...clone(plan.property), visibility: 'public' }
  ]) {
    const db = database({ properties: [property] });
    await assert.rejects(core.savePlan(db, plan), { code: 'RECORD_CONFLICT' });
    assert.ok(db.calls.every(call => call.operation === 'select'));
  }
  const archivedExisting = database({ properties: [{ ...clone(plan.property), archived_at: '2026-09-01' }] });
  await assert.rejects(core.savePlan(archivedExisting, { ...plan, existingProperty: true }), { code: 'RECORD_CONFLICT' });
});

test('unit ID belonging to another property or archived unit blocks before parent insertion', async () => {
  const plan = core.createPlan(input());
  for (const unit of [
    { ...clone(plan.units[0]), property_id: uuid(99) },
    { ...clone(plan.units[0]), archived_at: '2026-09-01' },
    { ...clone(plan.units[0]), label: 'Changed' }
  ]) {
    const db = database({ units: [unit] });
    await assert.rejects(core.savePlan(db, plan), { code: 'RECORD_CONFLICT' });
    assert.ok(db.calls.every(call => call.operation === 'select'));
  }
});

test('invalid persisted plan never sends a request and caller mutation cannot alter running save', async () => {
  const plan = clone(core.createPlan(input()));
  for (const change of [draft => { draft.version = 9; }, draft => { draft.units[0].visibility = 'public'; }, draft => { draft.units[0].property_id = uuid(90); }]) {
    const invalid = clone(plan);
    change(invalid);
    const db = database();
    await assert.rejects(core.savePlan(db, invalid));
    assert.equal(db.calls.length, 0);
  }
  const db = database();
  const save = core.savePlan(db, plan, { onProgress: () => { throw new Error('UI error'); } });
  plan.units[0].label = 'Changed after save started';
  await save;
  assert.equal(db.rows.units[0].label, 'Wohnung EG');
});

test('failure to read before saving never becomes permission to insert', async () => {
  for (const table of ['properties', 'units']) {
    const db = database();
    db.fault(table, 'select', 'throw-before');
    await assert.rejects(core.savePlan(db, core.createPlan(input())), { code: 'READ_UNCERTAIN' });
    assert.ok(db.calls.every(call => call.operation === 'select'));
  }
});

test('malformed property response never becomes permission to insert', async () => {
  const db = database();
  db.fault('properties', 'select', 'malformed');
  await assert.rejects(core.savePlan(db, core.createPlan(input())), { code: 'READ_UNCERTAIN' });
  assert.ok(db.calls.every(call => call.operation === 'select'));
});

test('parent archived during unit creation is not reported as a completed save', async () => {
  const db = database();
  db.fault('units', 'insert', 'archive-parent-after');
  await assert.rejects(core.savePlan(db, core.createPlan(input())), { code: 'RECORD_CONFLICT' });
  assert.equal(db.rows.properties.length, 1);
  assert.equal(db.rows.units.length, 2);
});

test('synchronous account guard runs before every request and stops before any request when changed', async () => {
  const db = database();
  const accountError = Object.assign(new Error('Account changed'), { code: 'ACCOUNT_CHANGED' });
  await assert.rejects(core.savePlan(db, core.createPlan(input()), { assertActive() { throw accountError; } }), error => error === accountError);
  assert.equal(db.calls.length, 0);

  let checks = 0;
  await core.savePlan(db, core.createPlan(input()), { assertActive() { checks++; } });
  assert.equal(checks, db.calls.length + 1, 'each request plus the final result has an account check');
});

test('account switch after property commit stops reconciliation and units, even after lost response', async () => {
  for (const lostResponse of [false, true]) {
    const db = database();
    const plan = core.createPlan(input());
    let account = 'original';
    const requestAccounts = [];
    const guard = () => {
      if (account !== 'original') throw Object.assign(new Error('Account changed'), { code: 'ACCOUNT_CHANGED' });
      requestAccounts.push(account);
    };
    db.afterInsert = table => { if (table === 'properties') account = 'other'; };
    if (lostResponse) db.fault('properties', 'insert', 'throw-after');
    await assert.rejects(core.savePlan(db, plan, { assertActive: guard }), { code: 'ACCOUNT_CHANGED' });
    assert.deepEqual(db.calls.map(call => call.table + ':' + call.operation), ['properties:select', 'units:select', 'properties:insert']);
    assert.equal(db.rows.properties.length, 1);
    assert.equal(db.rows.units.length, 0);
    assert.ok(requestAccounts.every(value => value === 'original'));
    // Re-authentication to the original account resumes the same plan.
    account = 'original';
    db.afterInsert = null;
    await core.savePlan(db, plan, { assertActive: guard });
    assert.equal(db.rows.properties.length, 1);
    assert.equal(db.rows.units.length, 2);
  }
});

test('asynchronous account guard stops after unit commit and is not swallowed as a request error', async () => {
  const db = database();
  let active = true;
  const accountError = Object.assign(new Error('Account changed asynchronously'), { code: 'ACCOUNT_CHANGED' });
  db.afterInsert = table => { if (table === 'units') active = false; };
  db.fault('units', 'insert', 'error-after');
  await assert.rejects(core.savePlan(db, core.createPlan(input()), {
    async assertActive() {
      await Promise.resolve();
      if (!active) throw accountError;
    }
  }), error => error === accountError);
  assert.equal(db.rows.units.length, 2);
  assert.equal(db.calls.at(-1).table, 'units');
  assert.equal(db.calls.at(-1).operation, 'insert');
});
