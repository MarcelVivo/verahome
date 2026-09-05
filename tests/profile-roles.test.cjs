const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(root, 'public/js/portal-dashboard.js'), 'utf8'), context);
const dashboard = context.window.VeraDashboard;
const plain = value => JSON.parse(JSON.stringify(value));
const ids = profiles => Array.from(profiles, profile => profile.id);

const profiles = [
  { id: 'anna', first_name: 'Anna', last_name: 'A', category: 'eigentuemer', member_number: 'EI-1' },
  { id: 'bea', first_name: 'Bea', last_name: 'B', category: 'mieter', member_number: 'MI-1' },
  { id: 'carl', first_name: 'Carl', last_name: 'C', category: 'firma', member_number: 'FI-1' },
  { id: 'dora', first_name: 'Dora', last_name: 'D', category: 'hauswart', member_number: 'HW-1' },
  { id: 'archived', first_name: 'Old', last_name: 'E', category: 'mieter', archived_at: '2026-01-01' }
];
const assignments = [
  { profile_id: 'anna', category: 'mieter' },
  { profile_id: 'bea', category: 'eigentuemer' },
  { profile_id: 'carl', category: 'handwerker' },
  { profile_id: 'carl', category: 'partner' },
  { profile_id: 'carl', category: 'handwerker' },
  { profile_id: 'archived', category: 'eigentuemer' },
  { profile_id: 'missing', category: 'mieter' }
];

// Supabase-shaped read client; no network or writes. Filters, ordering and
// ranges act on fixtures so the tests exercise the complete loading path.
function readClient(tables, failures = {}) {
  return {
    from(table) {
      let rows = [...(tables[table] || [])];
      const ordering = [];
      const query = {
        select() { return this; },
        is(column, value) { rows = rows.filter(row => (row[column] ?? null) === value); return this; },
        eq(column, value) { rows = rows.filter(row => row[column] === value); return this; },
        order(column) { ordering.push(column); return this; },
        then(resolve, reject) { return result().then(resolve, reject); },
        range(start, end) { return result(start, end); }
      };
      async function result(start = 0, end = rows.length) {
        if (failures[table] instanceof Error) throw failures[table];
        if (failures[table]) return { data: null, error: failures[table] };
        rows.sort((a, b) => {
          for (const column of ordering) {
            const order = String(a[column] ?? '').localeCompare(String(b[column] ?? ''));
            if (order) return order;
          }
          return 0;
        });
        return { data: rows.slice(start, end + 1), error: null };
      }
      return query;
    }
  };
}

test('primary and additional roles both qualify even when backfill is incomplete', () => {
  assert.deepEqual(ids(dashboard.profilesForRoles(profiles, assignments, ['mieter'])), ['anna', 'bea']);
  assert.deepEqual(ids(dashboard.profilesForRoles(profiles, assignments, ['eigentuemer'])), ['anna', 'bea']);
  assert.deepEqual(ids(dashboard.profilesForRoles(profiles, [], ['hauswart'])), ['dora']);
});

test('own roles preserve primary admin/owner alongside additional tenant access', async () => {
  context.VeraPortal = { getClient: () => readClient({ profile_role_assignments: [
    { profile_id: 'self', category: 'mieter' },
    { profile_id: 'self', category: 'mieter' },
    { profile_id: 'someone-else', category: 'handwerker' }
  ] }) };
  assert.deepEqual(plain(await dashboard.fetchOwnRoles({ id: 'self', category: 'admin' })), ['admin', 'mieter']);
  assert.deepEqual(plain(await dashboard.fetchOwnRoles({ id: 'self', category: 'eigentuemer' })), ['eigentuemer', 'mieter']);
});

test('own roles fall back to the primary role on missing assignments or failed reads', async () => {
  for (const failure of [undefined, { message: 'Role table unavailable' }, new Error('Offline')]) {
    context.VeraPortal = { getClient: () => readClient({}, { profile_role_assignments: failure }) };
    assert.deepEqual(plain(await dashboard.fetchOwnRoles({ id: 'self', category: 'eigentuemer' })), ['eigentuemer']);
  }
});

test('several matching roles produce one contact without mutating source data', () => {
  const before = JSON.stringify({ profiles, assignments });
  const found = dashboard.profilesForRoles([...profiles, profiles[2]], assignments, ['partner', 'handwerker', 'hauswart']);
  assert.deepEqual(ids(found), ['carl', 'dora']);
  assert.deepEqual(plain(found[0].roles), ['firma', 'handwerker', 'partner']);
  assert.equal(JSON.stringify({ profiles, assignments }), before);
});

test('archived contacts and role rows without a contact never become selectable', () => {
  const found = dashboard.profilesForRoles(profiles, assignments, ['mieter', 'eigentuemer']);
  assert.deepEqual(ids(found), ['anna', 'bea']);
  assert.deepEqual(ids(dashboard.profilesForRoles([], assignments, ['mieter'])), []);
  assert.deepEqual(ids(dashboard.profilesForRoles(profiles, assignments, [])), []);
});

test('loader returns primary and secondary contacts in name order', async () => {
  const result = await dashboard.fetchProfilesForRoles(readClient({ profiles: [...profiles].reverse(), profile_role_assignments: assignments }), ['mieter']);
  assert.equal(result.error, null);
  assert.deepEqual(ids(result.data), ['anna', 'bea']);
});

test('contacts and secondary roles beyond the first database page are included', async () => {
  const manyProfiles = Array.from({ length: 1001 }, (_, index) => ({ id: `p${String(index).padStart(4, '0')}`, last_name: String(index).padStart(4, '0'), category: 'firma' }));
  const manyRoles = manyProfiles.map(profile => ({ profile_id: profile.id, category: 'eigentuemer' }));
  manyRoles[manyRoles.length - 1].category = 'mieter';
  const result = await dashboard.fetchProfilesForRoles(readClient({ profiles: manyProfiles, profile_role_assignments: manyRoles }), ['mieter']);
  assert.equal(result.error, null);
  assert.deepEqual(ids(result.data), ['p1000']);
});

test('database and network errors cannot silently create an incomplete role picker', async t => {
  for (const [table, failure] of [
    ['profiles', { message: 'Profiles unavailable' }],
    ['profile_role_assignments', { message: 'Role table unavailable' }],
    ['profile_role_assignments', new Error('Network unavailable')]
  ]) {
    await t.test(`${table}: ${failure.message}`, async () => {
      const result = await dashboard.fetchProfilesForRoles(readClient({ profiles, profile_role_assignments: assignments }, { [table]: failure }), ['mieter']);
      assert.equal(result.error.message, failure.message);
      assert.deepEqual(ids(result.data), []);
    });
  }
});

async function renderPagePicker(file, failures = {}) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { innerHTML: '', addEventListener() {} });
      return elements.get(id);
    }
  };
  const client = readClient({ profiles, profile_role_assignments: assignments }, failures);
  const pageContext = vm.createContext({
    document,
    window: {},
    VeraPortal: { requireAdmin: async () => ({ profile: { id: 'admin' } }), getClient: () => client },
    VeraDashboard: { ...dashboard, renderSidebar() {}, applyQueryParamSearch() {} }
  });
  const html = fs.readFileSync(path.join(root, 'portal/admin', file), 'utf8');
  const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(source => source.includes('VeraPortal.requireAdmin()'));
  assert.ok(script, `Admin script found in ${file}`);
  vm.runInContext(script, pageContext, { filename: file });
  await new Promise(resolve => setImmediate(resolve));
  return elements;
}

test('all three real page initializers render the expected eligible contacts', async t => {
  for (const [file, pickerId, expected] of [
    ['tenancies.html', 't_tenant', ['anna', 'bea']],
    ['ownerships.html', 'o_owner', ['anna', 'bea']],
    ['jobs.html', 'j_profile', ['carl', 'dora']]
  ]) {
    await t.test(file, async () => {
      const elements = await renderPagePicker(file);
      const html = elements.get(pickerId).innerHTML;
      const optionIds = [...html.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
      assert.deepEqual(optionIds, expected);
      if (file === 'jobs.html') {
        assert.match(html, /Handwerker, Partner/);
        assert.doesNotMatch(html, /– Firma/);
      }
    });
  }
});

test('a failed role load is visible in each page instead of looking like no contacts', async t => {
  for (const [file, pickerId] of [['tenancies.html', 't_tenant'], ['ownerships.html', 'o_owner'], ['jobs.html', 'j_profile']]) {
    await t.test(file, async () => {
      const elements = await renderPagePicker(file, { profile_role_assignments: { message: 'Offline' } });
      assert.match(elements.get(pickerId).innerHTML, /Kontakte konnten nicht geladen werden/);
      assert.doesNotMatch(elements.get(pickerId).innerHTML, /value="[^"]+"/);
    });
  }
});
