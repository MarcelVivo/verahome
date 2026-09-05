/* Isolated browser acceptance of the actual property-create page and scripts.
   No server, real authentication, live data or external network is used.

   Run: node tests/property-create-browser.cjs
   Optional: PLAYWRIGHT_MODULE=/path/to/playwright-core
             PC_BROWSERS=chromium,webkit PC_WIDTHS=320,393,1440
             PC_SCREENSHOT=/private/tmp/verahome-property-create-mobile.png
   Browser launch may require the environment's sandbox escalation.
   Kept outside *.test.cjs so Node unit tests need no Playwright installation. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

function playwrightModule() {
  for (const name of [process.env.PLAYWRIGHT_MODULE, 'playwright-core'].filter(Boolean)) {
    try { return require(name); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Set PLAYWRIGHT_MODULE to an existing playwright-core installation. No packages are installed by this fixture.');
}
const playwright = playwrightModule();
const root = path.resolve(__dirname, '..');
const origin = 'https://vera-property-fixture.test';
const entryPath = '/portal/admin/property-create.html';
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const existingProperty = { id: uuid(80), label: 'Bestehende Liegenschaft', street: 'Altweg 8', zip: '5000', city: 'Aarau', visibility: 'public', property_type: 'mietobjekt', archived_at: null };

function database(options = {}) {
  const state = {
    rows: { properties: structuredClone(options.properties || []), units: structuredClone(options.units || []) },
    calls: [], faults: [], authCalls: 0, supportsPropertyType: options.supportsPropertyType !== false,
  };
  state.query = async request => {
    const { table, operation, payload, filters = [], single, columns, limit, range } = request;
    assert.ok(['properties', 'units'].includes(table), `Unexpected fixture table: ${table}`);
    assert.ok(['select', 'insert'].includes(operation), `Unexpected write type: ${operation}`);
    state.calls.push(structuredClone(request));
    const faultIndex = state.faults.findIndex(fault => fault.table === table && fault.operation === operation);
    const fault = faultIndex < 0 ? null : state.faults.splice(faultIndex, 1)[0].kind;
    if (fault === 'error-before') return { data: null, error: { message: 'Simulierter Datenbankfehler' } };
    if (fault === 'throw-before') throw new Error('Simulierte unterbrochene Verbindung');
    if (operation === 'select') {
      if (!state.supportsPropertyType && table === 'properties' && columns && columns.includes('property_type')) {
        return { data: null, error: { code: '42703', message: 'column properties.property_type does not exist' } };
      }
      let rows = state.rows[table].filter(row => filters.every(filter => {
        if (filter.type === 'eq') return row[filter.field] === filter.value;
        if (filter.type === 'in') return filter.value.includes(row[filter.field]);
        if (filter.type === 'is') return filter.value === null ? row[filter.field] == null : row[filter.field] === filter.value;
        throw new Error(`Unexpected fixture filter: ${filter.type}`);
      }));
      if (range) rows = rows.slice(range[0], range[1] + 1);
      if (limit != null) rows = rows.slice(0, limit);
      return { data: structuredClone(single ? rows[0] || null : rows), error: null };
    }
    const rows = Array.isArray(payload) ? payload : [payload];
    if (rows.some(row => state.rows[table].some(saved => row.id === saved.id))) {
      return { data: null, error: { code: '23505', message: 'duplicate key' } };
    }
    if (table === 'units' && rows.some(row => !state.rows.properties.some(property => property.id === row.property_id))) {
      return { data: null, error: { code: '23503', message: 'foreign key' } };
    }
    state.rows[table].push(...structuredClone(rows));
    if (state.onCommitted) await state.onCommitted(table);
    if (fault === 'commit-then-unreadable') {
      state.faults.unshift({ table, operation: 'select', kind: 'throw-before' });
      throw new Error('Simulierter Antwortverlust nach Commit');
    }
    if (fault === 'commit-response-loss') throw new Error('Simulierter Antwortverlust nach Commit');
    return { data: null, error: null };
  };
  return state;
}

function browserFixture(config) {
  const profile = { id: config.adminId, category: 'admin', email: 'fixture-admin@example.invalid', first_name: 'Test', last_name: 'Admin', status: 'active' };
  window.__pcFixture = { authCalls: 0, profile, session: { user: { id: profile.id }, access_token: 'fixture-token' }, clients: [] };
  const client = {
    auth: { onAuthStateChange(callback) {
      window.__pcFixture.authCallback = callback;
      return { data: { subscription: { unsubscribe() {} } } };
    } },
    from(table) {
      const request = { table, operation: 'select', filters: [] };
      const query = {
        select(columns) { request.columns = columns; return query; },
        eq(field, value) { request.filters.push({ type: 'eq', field, value }); return query; },
        in(field, value) { request.filters.push({ type: 'in', field, value }); return query; },
        is(field, value) { request.filters.push({ type: 'is', field, value }); return query; },
        order() { return query; },
        range(from, to) { request.range = [from, to]; return query; },
        limit(value) { request.limit = value; return query; },
        insert(payload) { request.operation = 'insert'; request.payload = payload; return query; },
        maybeSingle() { request.single = true; return window.__pcFixtureQuery(request); },
        single() { request.single = true; return window.__pcFixtureQuery(request); },
        then(resolve, reject) { return window.__pcFixtureQuery(request).then(resolve, reject); },
      };
      return query;
    },
  };
  window.VeraPortal = {
    async requireAdmin() { window.__pcFixture.authCalls++; return config.unauthorized ? null : { profile }; },
    getClient() { return client; },
    async getProfile() { return config.unauthorized ? null : window.__pcFixture.profile; },
    async getSession() { return config.unauthorized ? null : window.__pcFixture.session; },
  };
  window.VERA_SUPABASE_CONFIG = { url: 'https://fixture-database.example.invalid', anonKey: 'fixture-public-key' };
  window.supabase = { createClient(_url, _key, options) {
    window.__pcFixture.clients.push(options);
    return client;
  } };
  window.__pcFixture.switchAccount = function (id) {
    window.__pcFixture.session = { user: { id }, access_token: 'fixture-other-token' };
    window.__pcFixture.authCallback('SIGNED_IN', window.__pcFixture.session);
  };
  if (config.storageFailure) {
    for (const method of ['getItem', 'setItem', 'removeItem']) {
      Storage.prototype[method] = function () { throw new DOMException('Fixture storage blocked', 'SecurityError'); };
    }
  }
}

async function fixture(browser, width, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const state = database(options);
  const pageErrors = [], blocked = [];
  await context.exposeBinding('__pcFixtureQuery', async (_source, request) => state.query(request));
  await context.addInitScript(browserFixture, { adminId: uuid(1), unauthorized: !!options.unauthorized, storageFailure: !!options.storageFailure });
  const emptyScripts = new Set(['/public/js/portal-auth.js', '/public/js/supabase-config.js', '/public/js/pwa.js']);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { blocked.push(url.href); await route.abort('blockedbyclient'); return; }
    if (emptyScripts.has(url.pathname)) { await route.fulfill({ contentType: 'application/javascript', body: '/* Auth and network stubbed by fixture. */' }); return; }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep)) { await route.abort(); return; }
    try {
      const contentType = ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' })[path.extname(file)] || 'application/octet-stream';
      await route.fulfill({ contentType, body: await fs.readFile(file) });
    } catch (error) {
      await route.fulfill({ status: 404, body: `Missing local fixture asset: ${url.pathname}` });
    }
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  page.setDefaultTimeout(8000);
  await page.goto(origin + entryPath + (options.search || ''), { waitUntil: 'load' });
  if (!options.unauthorized) await page.locator('#pcWorkspace').waitFor({ state: 'visible' });
  return {
    page, state, blocked,
    async close() { await context.close(); assert.deepEqual(pageErrors, [], 'No unhandled browser errors'); },
  };
}

async function layout(page, phase) {
  const violations = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const bad = [];
    if (document.documentElement.scrollWidth > viewport + 1) bad.push(`page scrollWidth ${document.documentElement.scrollWidth} > ${viewport}`);
    for (const element of document.querySelectorAll('#main input, #main select, #main button, #main .pc-panel, #main .pc-unit')) {
      if (!element.getClientRects().length) continue;
      const rect = element.getBoundingClientRect();
      if (rect.left < -1 || rect.right > viewport + 1) bad.push(`${element.id || element.tagName} crosses viewport`);
      if (element.tagName === 'BUTTON' && rect.height < 43) bad.push(`${element.id || element.textContent.trim()} has a short touch target`);
    }
    return bad;
  });
  assert.deepEqual(violations, [], `Viewport/control layout at ${phase}`);
}

async function focused(page, selector) {
  assert.equal(await page.locator(selector).evaluate(element => document.activeElement === element), true, `Focus is on ${selector}`);
}

async function address(page) {
  await page.locator('#pcStreet').fill('Hauptstrasse 39');
  await page.locator('#pcZip').fill('5070');
  await page.locator('#pcCity').fill('Frick');
  await page.locator('#pcNext').click();
  await page.locator('#pcStep2').waitFor({ state: 'visible' });
  await focused(page, '#pcStep2 h2');
}

async function addUnits(page, type = 'wohnung', count = 2) {
  await page.locator('#pcUnitType').selectOption(type);
  await page.locator('#pcUnitCount').fill(String(count));
  await page.locator('#pcAddUnits').click();
  assert.equal(await page.locator('#pcUnitsList .pc-unit').count(), count);
}

async function editFirstUnit(page) {
  const unit = page.locator('#pcUnitsList .pc-unit').first();
  if (!(await unit.getAttribute('open'))) {
    const isOpen = await unit.evaluate(element => element.open);
    if (!isOpen) await unit.locator('summary').click();
  }
  await unit.locator('[data-field="label"]').fill('Wohnung EG links');
  await unit.locator('[data-field="floor"]').fill('EG');
  await unit.locator('[data-field="rooms"]').fill('3.5');
  await unit.locator('[data-field="living_area_m2"]').fill('80.5');
}

async function review(page) {
  await page.locator('#pcNext').click();
  await page.locator('#pcStep3').waitFor({ state: 'visible' });
  await focused(page, '#pcStep3 h2');
  assert.match(await page.locator('#pcReview').innerText(), /Hauptstrasse|Bestehende Liegenschaft/);
  await layout(page, 'review');
}

async function save(page) {
  await page.locator('#pcNext').click();
  await page.locator('#pcSuccess').waitFor({ state: 'visible' });
  await focused(page, '#pcSuccessTitle');
  await layout(page, 'success');
}

const scenarios = {
  async 'new property with edited private units'(f, meta) {
    const { page, state } = f;
    await layout(page, 'address');
    assert.equal(await page.locator('#pcAdvanced').isVisible(), true);
    await address(page);
    assert.equal(await page.locator('#pcAdvanced').isVisible(), false);
    await addUnits(page);
    await editFirstUnit(page);
    await layout(page, 'editable units');
    if (process.env.PC_SCREENSHOT && meta.browserName === 'webkit' && meta.width === 393) {
      await page.evaluate(() => {
        document.activeElement.blur();
        window.scrollTo({ top: 0, behavior: 'instant' });
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      await page.screenshot({ path: process.env.PC_SCREENSHOT, fullPage: false });
    }
    await review(page);
    assert.match(await page.locator('#pcReview').innerText(), /Wohnung EG links/);
    assert.equal(await page.evaluate(() => {
      const stored = Object.keys(sessionStorage).map(key => sessionStorage.getItem(key)).join(' ');
      return stored.includes('access_token') || stored.includes('fixture-token');
    }), false, 'Draft storage contains no auth token');
    await save(page);
    assert.equal(state.rows.properties.length, 1);
    assert.equal(state.rows.units.length, 2);
    const property = state.rows.properties[0];
    assert.equal(property.visibility, 'private');
    assert.equal(property.street, 'Hauptstrasse 39');
    assert.ok(state.rows.units.every(unit => unit.property_id === property.id && unit.visibility === 'private'));
    assert.equal(state.rows.units[0].label, 'Wohnung EG links');
    assert.equal(state.rows.units[0].rooms, 3.5);
    assert.equal(state.rows.units[0].living_area_m2, 80.5);
    assert.match(await page.locator('#pcOpenProperty').getAttribute('href'), new RegExp(property.id));
    const binding = await page.evaluate(async () => {
      const clients = window.__pcFixture.clients;
      const options = clients[clients.length - 1];
      const originalFetch = window.fetch;
      let capturedTokenMatches = false;
      window.__pcFixture.session.access_token = 'fixture-refreshed-token';
      window.fetch = async (_url, request) => {
        capturedTokenMatches = request.headers.get('Authorization') === 'Bearer fixture-token';
        return new Response('fixture-only');
      };
      try { await options.global.fetch('/fixture-no-network', { headers: { Authorization: 'Bearer supplied-other-token' } }); }
      finally { window.fetch = originalFetch; }
      return { count: clients.length, privateClient: options.auth.persistSession === false && options.auth.autoRefreshToken === false && options.auth.detectSessionInUrl === false, separateKey: clients[0].auth.storageKey !== options.auth.storageKey, capturedTokenMatches };
    });
    assert.ok(binding.count >= 2 && binding.privateClient && binding.separateKey && binding.capturedTokenMatches, 'Requests retain their checked session without persisting or refreshing it');
  },
  async 'property without units'(f) {
    await address(f.page);
    await review(f.page);
    await save(f.page);
    assert.equal(f.state.rows.properties.length, 1);
    assert.equal(f.state.rows.units.length, 0);
    assert.equal(f.state.calls.filter(call => call.table === 'units' && call.operation === 'insert').length, 0);
  },
  async 'existing property receives garages without rewriting parent'(f) {
    await f.page.locator('#pcStep2').waitFor({ state: 'visible' });
    assert.equal(await f.page.locator('#pcUnitType').inputValue(), 'garage');
    await f.page.locator('#pcUnitType').selectOption('parkplatz');
    assert.match(await f.page.locator('#pcAdvanced').getAttribute('href'), /type=parkplatz/);
    await addUnits(f.page, 'garage', 2);
    await review(f.page);
    await save(f.page);
    assert.deepEqual(f.state.rows.properties, [existingProperty]);
    assert.ok(f.state.rows.units.every(unit => unit.property_id === existingProperty.id && unit.unit_type === 'garage' && unit.visibility === 'private'));
    assert.equal(f.state.calls.filter(call => call.table === 'properties' && call.operation === 'insert').length, 0);
  },
  async 'back reload and discard preserve then clear the unsaved draft'(f) {
    const { page, state } = f;
    await address(page);
    await addUnits(page, 'wohnung', 1);
    await editFirstUnit(page);
    await review(page);
    await page.locator('#pcBack').click();
    await page.locator('#pcStep2').waitFor({ state: 'visible' });
    await focused(page, '#pcStep2 h2');
    assert.equal(await page.locator('#pcUnitsList [data-field="label"]').inputValue(), 'Wohnung EG links');
    await page.reload({ waitUntil: 'load' });
    await page.locator('#pcWorkspace').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#pcUnitsList [data-field="label"]').inputValue(), 'Wohnung EG links');
    await page.locator('#pcDiscard').click();
    await page.locator('#pcStep1').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#pcStreet').inputValue(), '');
    assert.equal(await page.locator('#pcUnitsList .pc-unit').count(), 0);
    assert.equal(state.calls.filter(call => call.operation === 'insert').length, 0);
  },
  async 'lost commit response and reload retry do not duplicate records'(f) {
    const { page, state } = f;
    await address(page);
    await addUnits(page);
    await review(page);
    state.faults.push({ table: 'properties', operation: 'insert', kind: 'commit-then-unreadable' });
    await page.locator('#pcNext').click();
    await page.locator('#pcFormError').waitFor({ state: 'visible' });
    assert.equal(state.rows.properties.length, 1);
    const propertyId = state.rows.properties[0].id;
    await page.reload({ waitUntil: 'load' });
    await page.locator('#pcWorkspace').waitFor({ state: 'visible' });
    await page.locator('#pcStep3').waitFor({ state: 'visible' });
    await save(page);
    assert.equal(state.rows.properties.length, 1);
    assert.equal(state.rows.units.length, 2);
    assert.ok(state.rows.units.every(unit => unit.property_id === propertyId));
    assert.equal(state.calls.filter(call => call.table === 'properties' && call.operation === 'insert').length, 1);
  },
  async 'unit save failure resumes the same property and unit IDs'(f) {
    const { page, state } = f;
    await address(page);
    await addUnits(page);
    await review(page);
    state.faults.push({ table: 'units', operation: 'insert', kind: 'error-before' });
    await page.locator('#pcNext').click();
    await page.locator('#pcFormError').waitFor({ state: 'visible' });
    assert.equal(state.rows.properties.length, 1);
    assert.equal(state.rows.units.length, 0);
    const firstUnits = state.calls.find(call => call.table === 'units' && call.operation === 'insert').payload;
    await save(page);
    assert.equal(state.rows.properties.length, 1);
    assert.equal(state.rows.units.length, 2);
    assert.deepEqual(state.rows.units.map(unit => unit.id), firstUnits.map(unit => unit.id));
    assert.equal(state.calls.filter(call => call.table === 'properties' && call.operation === 'insert').length, 1);
  },
  async 'unauthorized visitor cannot open workspace or access records'(f) {
    await f.page.waitForFunction(() => window.__pcFixture.authCalls > 0);
    assert.equal(await f.page.locator('#pcWorkspace').isVisible(), false);
    assert.equal(f.state.calls.length, 0);
  },
  async 'blocked browser storage reports a visible draft warning'(f) {
    await layout(f.page, 'blocked storage');
    assert.match(await f.page.locator('#pcDraftStatus').innerText(), /nicht|blockiert|Browser|nur/i);
    await address(f.page);
    await review(f.page);
    await f.page.locator('#pcNext').click();
    await f.page.locator('#pcFormError').waitFor({ state: 'visible' });
    assert.match(await f.page.locator('#pcFormError').innerText(), /Speicher|gesichert/);
    assert.equal(await f.page.locator('#pcSuccess').isVisible(), false);
    await f.page.locator('#pcBack').click();
    await f.page.locator('#pcBack').click();
    await f.page.locator('#pcStreet').fill('Weiter editierbar 7');
    assert.match(await f.page.locator('#pcAddressPreview').innerText(), /Weiter editierbar 7/);
    assert.equal(f.state.calls.filter(call => call.operation === 'insert').length, 0);
  },
  async 'admin authorization is checked again immediately before saving'(f) {
    await address(f.page);
    await review(f.page);
    await f.page.evaluate(() => { window.__pcFixture.profile.category = 'mieter'; });
    await f.page.locator('#pcNext').click();
    await f.page.locator('#pcLoadError').waitFor({ state: 'visible' });
    assert.match(await f.page.locator('#pcLoadError').innerText(), /Verwaltungskonto|anmelden/);
    assert.equal(f.state.calls.filter(call => call.operation === 'insert').length, 0);
  },
  async 'account switch while editing blocks the workspace without writes'(f) {
    await address(f.page);
    await addUnits(f.page, 'wohnung', 1);
    await f.page.evaluate(otherId => window.__pcFixture.switchAccount(otherId), uuid(2));
    await f.page.locator('#pcLoadError').waitFor({ state: 'visible' });
    const blockedFetch = await f.page.evaluate(async () => {
      const options = window.__pcFixture.clients[0];
      const originalFetch = window.fetch;
      let called = false, rejected = false;
      window.fetch = async () => { called = true; return new Response('fixture-only'); };
      try { await options.global.fetch('/fixture-no-network', { headers: { Authorization: 'Bearer supplied-other-token' } }); }
      catch (error) { rejected = true; }
      finally { window.fetch = originalFetch; }
      return rejected && !called;
    });
    assert.equal(blockedFetch, true, 'Previously bound fetch throws before any request after an account switch');
    assert.equal(await f.page.locator('#pcWorkspace').isVisible(), false);
    assert.equal(f.state.calls.filter(call => call.operation === 'insert').length, 0);
  },
  async 'account switch after parent commit prevents subsequent unit writes'(f) {
    const { page, state } = f;
    await address(page);
    await addUnits(page);
    await review(page);
    state.onCommitted = async table => {
      if (table === 'properties') await page.evaluate(otherId => window.__pcFixture.switchAccount(otherId), uuid(2));
    };
    await page.locator('#pcNext').click();
    await page.locator('#pcLoadError').waitFor({ state: 'visible' });
    // Wait for the in-flight save to reach its error handler, not just for
    // the immediate auth callback to hide the workspace.
    await page.waitForFunction(() => document.getElementById('pcFormError').textContent.length > 0);
    assert.equal(await page.locator('#pcWorkspace').isVisible(), false);
    assert.equal(await page.locator('#pcSuccess').isVisible(), false);
    assert.equal(state.rows.properties.length, 1);
    assert.equal(state.rows.units.length, 0);
    assert.equal(state.calls.filter(call => call.table === 'units' && call.operation === 'insert').length, 0);
  },
};

(async () => {
  await fs.access(path.join(root, 'public/js/property-create.js'));
  const browserNames = (process.env.PC_BROWSERS || 'chromium,webkit').split(',');
  const widths = (process.env.PC_WIDTHS || '320,393,1440').split(',').map(Number);
  let passed = 0;
  for (const browserName of browserNames) {
    const browser = await playwright[browserName].launch({ headless: true });
    try {
      for (const width of widths) {
        for (const [name, run] of Object.entries(scenarios)) {
          const options = name.startsWith('existing') ? { properties: [existingProperty], search: `?property=${existingProperty.id}&type=garage` }
            : name.startsWith('unauthorized') ? { unauthorized: true }
              : name.startsWith('blocked') ? { storageFailure: true } : {};
          const f = await fixture(browser, width, options);
          try {
            await run(f, { browserName, width });
            await f.close();
            passed++;
            console.log(`PASS ${browserName} ${width}px — ${name}`);
          } catch (error) {
            console.error(`FAIL ${browserName} ${width}px — ${name}\n${error.stack}`);
            await f.page.screenshot({ path: '/private/tmp/verahome-property-create-failure.png', fullPage: true }).catch(() => {});
            await f.close().catch(() => {});
            throw error;
          }
        }
      }
    } finally { await browser.close(); }
  }
  console.log(JSON.stringify({ passed, browsers: browserNames, widths, liveRequests: 0 }));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
