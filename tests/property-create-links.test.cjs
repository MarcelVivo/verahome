const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'portal/admin/properties.html'), 'utf8');
const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(script => script.includes('function openCreateModal('));
const decode = value => String(value).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const plain = value => JSON.parse(JSON.stringify(value));

function page(search = '', mobile = false) {
  const elements = new Map();
  const scrolled = [];
  function element(id) {
    if (!elements.has(id)) {
      const node = {
        value: '', files: [], hidden: true, dataset: {}, textContent: '', disabled: false,
        classList: { add() {}, remove() {}, toggle() {} },
        listeners: {},
        addEventListener(event, handler) { this.listeners[event] = handler; },
        reset() {},
        scrollIntoView(options) { scrolled.push({ target: id, options }); },
        querySelector() { return element(`${id}:button`); },
        querySelectorAll() { return []; }
      };
      let innerHTML = '';
      Object.defineProperty(node, 'innerHTML', {
        get: () => innerHTML,
        set(value) {
          innerHTML = value;
          if (value.includes('<option')) {
            const options = [...value.matchAll(/<option\b([^>]*)>/g)];
            const selected = options.find(option => /\bselected\b/.test(option[1])) || options[0];
            if (selected) node.value = decode((selected[1].match(/\bvalue="([^"]*)"/) || [])[1] || '');
          }
        }
      });
      elements.set(id, node);
    }
    return elements.get(id);
  }
  const document = {
    getElementById: element,
    querySelector(selector) {
      const markup = element('objColumns').innerHTML;
      return selector.startsWith('.') && markup.includes(selector.slice(1)) ? element(selector) : null;
    },
    querySelectorAll: () => [],
    addEventListener() {}
  };
  const window = { location: { search, href: `/portal/admin/properties.html${search}` }, matchMedia: () => ({ matches: mobile }), requestAnimationFrame: callback => callback() };
  const context = vm.createContext({ window, document, URLSearchParams, VeraPortal: { requireAdmin: async () => null } });
  vm.runInContext(fs.readFileSync(path.join(root, 'public/js/portal-dashboard.js'), 'utf8'), context);
  context.VeraDashboard = window.VeraDashboard;
  // Expose existing closure functions to this isolated VM only. Production
  // keeps its original IIFE and receives no test globals or rewritten logic.
  const instrumented = source.replace(/\}\)\(\);\s*$/, `
    window.pageTest = {
      init, openCreateModal, openDetailedCreateModal, renderAllColumns,
      applyPropertySelectionParam, applyDetailedCreateParam,
      unitTypeOptionsHtml, unitTypeCardsHtml, unitModalHtml,
      setUnitTypeValue, applyExistingUnitTypeFieldVisibility, saveUnitListingDetails,
      setRecords(properties, units) { allProperties = properties; allUnits = units; },
      state() { return { property: selectedPropertyId, unit: selectedUnitId, detail: selectedDetailType, searches: columnSearchState }; },
      setState(propertyId, unitId, detail) { selectedPropertyId = propertyId; selectedUnitId = unitId; selectedDetailType = detail; },
      setClient(value) { client = value; },
      setLoadAndRender(load, render) { loadAll = load; renderAllColumns = render; }
    };
  })();`);
  assert.notEqual(instrumented, source, 'IIFE test hook inserted');
  vm.runInContext(instrumented, context, { filename: 'properties.html' });
  return { api: window.pageTest, window, element, scrolled };
}

const properties = [
  { id: 'p-first', label: 'A Street' },
  { id: 'p-chosen', label: 'B Street' },
  { id: 'p-archived', label: 'Old Street', archived_at: '2026-01-01' }
];
const units = [
  { id: 'u-first', property_id: 'p-first', label: 'First flat' },
  { id: 'u-chosen', property_id: 'p-chosen', label: 'Chosen flat', unit_type: 'studio' },
  { id: 'u-archived', property_id: 'p-chosen', label: 'Old flat', archived_at: '2026-01-01' }
];

test('normal creation dispatches to the wizard with the exact property and raw type', () => {
  const { api, window } = page();
  api.openCreateModal('objekte', 'ignored');
  assert.equal(window.location.href, '/portal/admin/property-create.html');
  for (const [key, expectedType] of [['unit-for-property', 'wohnung'], ['studio', 'studio'], ['tiefgaragenplatz', 'tiefgaragenplatz']]) {
    api.openCreateModal(key, 'p-chosen');
    const url = new URL(window.location.href, 'https://example.test');
    assert.equal(url.pathname, '/portal/admin/property-create.html');
    assert.equal(url.searchParams.get('property'), 'p-chosen');
    assert.equal(url.searchParams.get('type'), expectedType);
  }
  api.openCreateModal('loft & atelier', 'property&other=bad');
  const url = new URL(window.location.href, 'https://example.test');
  assert.equal(url.searchParams.get('property'), 'property&other=bad');
  assert.equal(url.searchParams.get('type'), 'loft & atelier');
  assert.equal(url.searchParams.has('other'), false);
  assert.match(html, /href="\/portal\/admin\/property-create\.html">Liegenschaft erfassen<\/a>/);
});

test('return URLs select the named property/unit and clear stale detail/search context', () => {
  const { api } = page('?property=p-chosen&unit=u-chosen&q=another');
  api.setRecords(properties, units);
  api.setState('p-first', 'u-first', 'document');
  api.applyPropertySelectionParam();
  assert.deepEqual(plain(api.state()), { property: 'p-chosen', unit: 'u-chosen', detail: null, searches: { objekte: '', units: '' } });
});

test('property-only, mismatched-unit and archived-unit links never select an unrelated unit', () => {
  for (const query of ['?property=p-chosen', '?property=p-chosen&unit=u-first', '?property=p-chosen&unit=u-archived']) {
    const { api } = page(query);
    api.setRecords(properties, units);
    api.setState('p-first', 'u-first', 'document');
    api.applyPropertySelectionParam();
    assert.equal(api.state().property, 'p-chosen');
    assert.equal(api.state().unit, null);
  }
  for (const propertyId of ['p-archived', 'missing']) {
    const { api } = page(`?property=${propertyId}&unit=u-chosen`);
    api.setRecords(properties, units);
    api.applyPropertySelectionParam();
    assert.equal(api.state().property, null);
    assert.equal(api.state().unit, null);
  }
});

test('detailed creation parameters open preserved forms without redirecting to the wizard', () => {
  for (const mode of ['property', 'unit']) {
    const fixture = page(`?create=${mode}&property=p-chosen&type=studio`);
    fixture.api.setRecords(properties, units);
    const originalHref = fixture.window.location.href;
    fixture.api.applyPropertySelectionParam();
    fixture.api.applyDetailedCreateParam();
    assert.equal(fixture.window.location.href, originalHref);
    assert.equal(fixture.element(mode === 'property' ? 'newPropertyModalBackdrop' : 'newUnitModalBackdrop').hidden, false);
    if (mode === 'unit') {
      assert.equal(fixture.element('u_property').value, 'p-chosen');
      assert.equal(fixture.element('u_type').value, 'studio');
      assert.equal(fixture.element('u_label').value, 'Studio');
    }
  }
  const fixture = page('?create=unit&property=p-archived');
  fixture.api.setRecords(properties, units);
  fixture.api.applyDetailedCreateParam();
  assert.equal(fixture.element('newUnitModalBackdrop').hidden, true);
});

test('real initialization waits for records, selects the return target, then opens the detailed form', async () => {
  const fixture = page('?property=p-chosen&unit=u-chosen&create=unit&type=studio');
  let finishLoading;
  const loaded = new Promise(resolve => { finishLoading = resolve; });
  const rendered = [];
  fixture.api.setLoadAndRender(async () => {
    await loaded;
    fixture.api.setRecords(properties, units);
  }, () => rendered.push(plain(fixture.api.state())));
  fixture.api.init();
  assert.equal(fixture.api.state().property, null);
  assert.equal(fixture.element('newUnitModalBackdrop').hidden, true);
  finishLoading();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].property, 'p-chosen');
  assert.equal(rendered[0].unit, 'u-chosen');
  assert.equal(fixture.element('u_property').value, 'p-chosen');
  assert.equal(fixture.element('newUnitModalBackdrop').hidden, false);
  assert.match(fixture.window.location.href, /^\/portal\/admin\/properties\.html/);
});

test('mobile return links reveal the selected existing pane after rendering', async t => {
  for (const [query, expectedTarget] of [
    ['?property=p-chosen', '.obj-pane-units'],
    ['?property=p-chosen&unit=u-chosen', '.obj-pane-detail'],
    ['?property=missing', null],
    ['?property=p-archived', null],
    ['?property=p-chosen&unit=missing', null],
    ['?property=p-chosen&unit=u-first', null],
    ['?property=p-chosen&unit=u-archived', null],
    ['?property=p-chosen&create=property', null],
    ['?property=p-chosen&unit=u-chosen&create=unit&type=studio', null]
  ]) {
    await t.test(query, async () => {
      const fixture = page(query, true);
      fixture.api.setLoadAndRender(async () => fixture.api.setRecords(properties, units), () => fixture.api.renderAllColumns());
      fixture.api.init();
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(fixture.scrolled.map(scroll => scroll.target), expectedTarget ? [expectedTarget] : []);
      if (expectedTarget === '.obj-pane-detail') assert.match(fixture.element('objColumns').innerHTML, /<h2>Chosen flat<\/h2>/);
      if (expectedTarget === '.obj-pane-units') assert.match(fixture.element('objColumns').innerHTML, /<strong>2\. Objekte \/ Einheiten<\/strong><span>B Street<\/span>/);
    });
  }
});

test('desktop return links preserve the overview without forced scrolling', async () => {
  const fixture = page('?property=p-chosen&unit=u-chosen');
  fixture.api.setLoadAndRender(async () => fixture.api.setRecords(properties, units), () => fixture.api.renderAllColumns());
  fixture.api.init();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.api.state().unit, 'u-chosen');
  assert.deepEqual(fixture.scrolled, []);
});

function fillRenderedForm(markup, element) {
  for (const match of markup.matchAll(/<input\b([^>]*)>/g)) {
    const id = (match[1].match(/\bid="([^"]+)"/) || [])[1];
    if (id) element(id).value = decode((match[1].match(/\bvalue="([^"]*)"/) || [])[1] || '');
  }
  for (const match of markup.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) element(match[1]).innerHTML = match[2];
  for (const match of markup.matchAll(/<textarea\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) element(match[1]).value = decode(match[2]);
}

test('opening and saving existing subtype units preserves the exact type and hidden field values', async t => {
  for (const rawType of ['studio', 'maisonette', 'aussenparkplatz', 'future_special_type']) {
    await t.test(rawType, async () => {
      const { api, element } = page();
      let update;
      api.setClient({ from(table) {
        assert.equal(table, 'units');
        return { update(payload) { update = plain(payload); return { eq: async () => ({ error: null }) }; } };
      } });
      api.setLoadAndRender(async () => {}, () => {});
      const unit = { id: 'u-save', label: 'Existing unit', unit_type: rawType, visibility: 'private', rooms: 2.5, living_area_m2: 42, rent_chf: 1000, extra_costs_chf: 100 };
      const markup = api.unitModalHtml(unit);
      fillRenderedForm(markup, element);
      api.applyExistingUnitTypeFieldVisibility(unit.id, rawType, false);
      assert.equal(element('unitType-u-save').value, rawType);
      const selected = [...api.unitTypeOptionsHtml(rawType).matchAll(/<option\b[^>]*\bselected/g)];
      assert.equal(selected.length, 1);
      await api.saveUnitListingDetails({ preventDefault() {}, currentTarget: { querySelector: () => element('submit') } }, unit.id);
      assert.equal(update.unit_type, rawType);
      assert.equal(update.rooms, 2.5);
      assert.equal(update.living_area_m2, 42);
      assert.equal(update.extra_costs_chf, 100);
      assert.equal(element('unitListingStatus-u-save').textContent, 'Einheit gespeichert.');
    });
  }
});

test('explicit type changes use grouped field rules without rewriting the selected raw value', () => {
  const { api, element } = page();
  element('unitType-u').innerHTML = api.unitTypeOptionsHtml('tiefgaragenplatz');
  element('unitArea-u').value = '42';
  element('unitRooms-u').value = '2';
  api.setUnitTypeValue('unitType-u', 'tiefgaragenplatz', true);
  assert.equal(element('unitType-u').value, 'tiefgaragenplatz');
  assert.equal(element('unitAreaWrap-u').hidden, true);
  assert.equal(element('unitArea-u').value, '');
  assert.equal(element('unitRooms-u').value, '');
  api.setUnitTypeValue('unitType-u', 'wohnung', true);
  assert.equal(element('unitType-u').value, 'wohnung');
  assert.equal(element('unitAreaWrap-u').hidden, false);
});

test('unknown raw subtype text is escaped in preserved options and cards', () => {
  const { api } = page();
  const type = '"><img src=x>';
  for (const markup of [api.unitTypeOptionsHtml(type), api.unitTypeCardsHtml(type, 'unitType-u', true)]) {
    assert.doesNotMatch(markup, /<img/);
    assert.match(markup, /&quot;&gt;&lt;img/);
  }
});
