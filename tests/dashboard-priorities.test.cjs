const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Exercise the actual dashboard logic without authentication or live data.
const html = fs.readFileSync(path.join(__dirname, '../portal/dashboard.html'), 'utf8');
const start = html.indexOf('  function hasPropertyOwner(');
const end = html.indexOf('  function renderDataQualityIssues(', start);
assert.ok(start !== -1 && end > start, 'Dashboard quality functions must exist');
const context = vm.createContext({});
vm.runInContext(html.slice(start, end), context);
const buildIssues = data => JSON.parse(JSON.stringify(context.buildDataQualityIssues(data)));
const emptyData = () => ({
  properties: [], units: [], tenancies: [], ownerships: [], permissions: [],
  documents: [], appliances: [], contacts: [], documentShares: []
});

test('urgent missing-property data remains visible when the dashboard has more than 18 issues', () => {
  const data = emptyData();
  data.properties = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, label: `Haus ${i}` }));
  const issues = buildIssues(data);
  assert.equal(issues.length, 18);
  assert.equal(issues.filter(issue => issue.level === 'high').length, 10);
  assert.ok(issues.slice(0, 10).every(issue => issue.title === 'Keine Einheiten erfasst'));
  assert.ok(issues.slice(10).every(issue => issue.level === 'medium'));
});

test('pending access and unshared tenant files precede optional equipment, with alphabetical ties', () => {
  const data = emptyData();
  data.properties = [{ id: 'p1', label: 'Haus' }];
  data.units = [{ id: 'u1', property_id: 'p1', label: 'Garage', unit_type: 'garage' }];
  data.ownerships = [{ property_id: 'p1' }];
  data.permissions = [{ property_id: 'p1', permission: 'hauswart' }];
  data.documents = [
    { id: 'd1', property_id: 'p1', title: 'Hausregeln' },
    { id: 'd2', unit_id: 'u1', archive_category: 'unit_mieter', title: 'Akte' }
  ];
  data.contacts = [{ first_name: 'Zoe', email: 'zoe@example.invalid', portal_registered_at: null }];
  const issues = buildIssues(data);
  assert.deepEqual(issues.map(issue => issue.title), [
    'Mieterakte ohne Freigabe', 'Registrierung ausstehend', 'Technische Anlagen fehlen'
  ]);
  assert.equal(issues[0].href, '/portal/documents.html?file=d2');
  assert.match(issues[1].href, /zoe%40example.invalid$/);
});

test('complete data produces no quality tasks', () => {
  const data = emptyData();
  data.properties = [{ id: 'p1', label: 'Haus' }];
  data.units = [{ id: 'u1', property_id: 'p1', label: 'Wohnung', unit_type: 'wohnung' }];
  data.tenancies = [{ unit_id: 'u1' }];
  data.ownerships = [{ property_id: 'p1' }];
  data.permissions = [{ property_id: 'p1', permission: 'hauswart' }];
  data.documents = [{ property_id: 'p1' }, { unit_id: 'u1' }];
  data.appliances = [{ property_id: 'p1' }, { unit_id: 'u1' }];
  data.contacts = [{ portal_registered_at: '2026-09-01' }];
  assert.deepEqual(buildIssues(data), []);
});
