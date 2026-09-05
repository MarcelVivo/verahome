const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the production helpers and click handler. No duplicate matcher and
// no banking service: database replies and the minimal result-list DOM are fakes.
const html = fs.readFileSync(path.join(__dirname, '../portal/invoices.html'), 'utf8');
const start = html.indexOf('  var camtImportToken = 0;');
const end = html.indexOf('  async function initIssueForm()', start);
assert.ok(start > 0 && end > start, 'CAMT production block exists');
const source = html.slice(start, end);
const invoice = (overrides = {}) => ({ id: 'inv-a', invoice_number: '2026-00001', total: 1000, currency: 'CHF', status: 'offen', archived_at: null, ...overrides });
const payment = (overrides = {}) => ({ amount: 1000, currency: 'CHF', isCredit: true, isBooked: true, isReversal: false, isBatch: false, date: '2026-09-05', remittance: 'Rechnung 2026-00001', structuredReferences: [], ...overrides });
function helpers() { return vm.runInNewContext(source + '\n({matchEntryToInvoice, matchCamtEntries, formatCamtAmount});'); }

test('a matching reference still requires the complete CHF invoice amount', async t => {
  const api = helpers();
  assert.equal(api.matchEntryToInvoice(payment(), [invoice()]).invoice.id, 'inv-a');
  const cases = [
    ['partial payment', { amount: 100 }],
    ['overpayment', { amount: 1000.01 }],
    ['foreign currency', { currency: 'EUR' }],
    ['missing currency', { currency: null }],
    ['missing amount', { amount: null }],
    ['invalid amount', { amount: NaN }],
    ['infinite amount', { amount: Infinity }],
    ['negative amount', { amount: -1000 }],
    ['sub-cent discrepancy', { amount: 1000.001 }],
    ['pending credit', { isBooked: false }],
    ['reversal', { isReversal: true }],
    ['batch credit', { isBatch: true }],
  ];
  for (const [name, overrides] of cases) {
    await t.test(name, () => assert.equal(api.matchEntryToInvoice(payment(overrides), [invoice()]).invoice, null));
  }
  assert.equal(api.matchEntryToInvoice(payment(), [invoice({ currency: 'EUR' })]).invoice, null);
  assert.equal(api.matchEntryToInvoice(payment(), [invoice({ status: 'bezahlt' })]).invoice, null);
  assert.equal(api.matchEntryToInvoice(payment(), [invoice({ archived_at: '2026-09-01' })]).invoice, null);
  assert.equal(api.matchEntryToInvoice(payment({ amount: 10.01 }), [invoice({ total: '10.01' })]).invoice.id, 'inv-a');
});

test('explicit or ambiguous references cannot fall back to an unrelated equal amount', () => {
  const api = helpers();
  const invoices = [invoice(), invoice({ id: 'inv-b', invoice_number: '2026-00002', total: 100 })];
  for (const remittance of ['Rechnung 2026-99999', 'Rechnung 2026-00001 und 2026-00002', 'Rechnung ABC-123', 'Referenz unbekannt', 'Invoice #ABC']) {
    assert.equal(api.matchEntryToInvoice(payment({ remittance }), invoices).invoice, null, remittance);
  }
  // The paid sum matches B, but the customer explicitly named A.
  assert.equal(api.matchEntryToInvoice(payment({ amount: 100 }), invoices).invoice, null);
  assert.equal(api.matchEntryToInvoice(payment({ remittance: '', structuredReferences: ['RF18539007547034'] }), invoices).invoice, null);
  assert.equal(api.matchEntryToInvoice(payment({ remittance: '', structuredReferences: ['2026-00001'] }), invoices).invoice.id, 'inv-a');
  // Repeating one reference in different fields is not a second invoice.
  assert.equal(api.matchEntryToInvoice(payment({ structuredReferences: ['2026-00001'] }), invoices).invoice.id, 'inv-a');
});

test('amount-only proposals require one unique open CHF invoice and retain a warning', () => {
  const api = helpers();
  const noReference = payment({ remittance: 'Miete September' });
  const matched = api.matchEntryToInvoice(noReference, [invoice()]);
  assert.equal(matched.invoice.id, 'inv-a');
  assert.equal(matched.confidence, 'unsicher');
  assert.equal(api.matchEntryToInvoice(noReference, [invoice(), invoice({ id: 'inv-b', invoice_number: '2026-00002' })]).invoice, null);
  assert.equal(api.matchEntryToInvoice(payment({ currency: 'USD', remittance: '' }), [invoice()]).invoice, null);
});

test('multiple credits for one invoice are all withheld for review', () => {
  const api = helpers();
  const full = payment();
  for (const second of [payment(), payment({ amount: 100 }), payment({ currency: 'EUR' }), payment({ remittance: '' }), payment({ isBatch: true })]) {
    const matches = api.matchCamtEntries([full, second], [invoice()]);
    assert.ok(matches.every(row => row.match.invoice === null));
  }
  const distinct = api.matchCamtEntries([full, payment({ remittance: 'Rechnung 2026-00002', amount: 200 })], [invoice(), invoice({ id: 'inv-b', invoice_number: '2026-00002', total: 200 })]);
  assert.equal(distinct.filter(row => row.match.invoice).length, 2);
});

test('booked rows cannot become fresh amount-only suggestions', () => {
  const api = helpers();
  const entries = [payment({ remittance: '' }), payment({ remittance: 'Rechnung 2026-00002' })];
  const remaining = [invoice({ id: 'inv-b', invoice_number: '2026-00002' })];
  const matches = api.matchCamtEntries(entries, remaining, { 0: '2026-00001' });
  assert.equal(matches[0].match.invoice, null);
  assert.equal(matches[1].match.invoice.id, 'inv-b');
});

test('the bank currency is displayed, including missing and invalid values', () => {
  const api = helpers();
  assert.match(api.formatCamtAmount(payment({ currency: 'EUR', amount: 100 })), /^EUR 100\.00$/);
  assert.match(api.formatCamtAmount(payment({ currency: null })), /^Währung fehlt /);
  assert.equal(api.formatCamtAmount(payment({ amount: null })), 'CHF –');
});

function fakeResultList() {
  return {
    html: '', buttons: [],
    set innerHTML(value) {
      this.html = value;
      this.buttons = [...value.matchAll(/<button[^>]*class="dash-btn-sm confirm-camt-btn"[^>]*data-idx="(\d+)"([^>]*)>/g)].map(match => ({
        idx: match[1], disabled: match[2].includes('disabled'),
        getAttribute(name) { assert.equal(name, 'data-idx'); return this.idx; },
        addEventListener(name, handler) { assert.equal(name, 'click'); this.click = handler; },
      }));
    },
    get innerHTML() { return this.html; },
    querySelectorAll(selector) { assert.equal(selector, '.confirm-camt-btn'); return this.buttons; },
  };
}

async function importFixture({ entries = [payment()], initial = [invoice()], latest = initial, queryError = null, pageCount, markPaid, confirm = true } = {}) {
  const results = fakeResultList();
  const input = { disabled: false };
  const calls = [], alerts = [], confirmations = [], queries = [];
  const context = {
    allInvoicesData: structuredClone(initial),
    renderAllInvoicesTable() {},
    document: { getElementById(id) { return id === 'reconcileResults' ? results : input; } },
    window: { alert(message) { alerts.push(message); }, confirm(message) { confirmations.push(message); return confirm; } },
    VeraDashboard: { escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); } },
    VeraPortal: { async markInvoicePaid(id) { calls.push(id); return markPaid ? markPaid(id) : { data: { id } }; } },
    client: { from(table) {
      assert.equal(table, 'invoices');
      return {
        select(_columns, options) { assert.equal(options.count, 'exact'); return this; },
        eq(field, value) { queries.push([field, value]); return this; },
        is(field, value) { queries.push([field, value]); return this; },
        order(field) { assert.equal(field, 'id'); return this; },
        async range(from, to) {
          queries.push(['range', from, to]);
          return { data: structuredClone(latest.slice(from, to + 1)), count: pageCount ? pageCount(from) : latest.length, error: queryError };
        },
      };
    } },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  // Native XML parsing is checked by the browser fixture; here test only the
  // actual import rendering, refresh and click flow with known parsed entries.
  context.parseCamtEntries = () => structuredClone(entries);
  await context.handleCamtFile({ target: { files: [{ async text() { return '<fixture/>'; } }] } });
  return { results, input, context, calls, alerts, confirmations, queries };
}

test('import UI renders review-only rows without payment controls', async () => {
  const fixture = await importFixture({ entries: [payment({ amount: 100 }), payment({ currency: 'EUR' })] });
  assert.equal(fixture.results.buttons.length, 0);
  assert.match(fixture.results.innerHTML, /EUR 1.?000\.00/);
  assert.match(fixture.results.innerHTML, /Zur Prüfung/);
  assert.equal(fixture.calls.length, 0);
});

test('click revalidates the invoice and refuses stale or changed proposals', async t => {
  const cases = [
    ['no longer open', []],
    ['amount changed', [invoice({ total: 1200 })]],
    ['currency changed', [invoice({ currency: 'EUR' })]],
    ['reference now points elsewhere', [invoice({ id: 'replacement' })]],
  ];
  for (const [name, latest] of cases) {
    await t.test(name, async () => {
      const fixture = await importFixture({ latest });
      assert.equal(fixture.results.buttons.length, 1);
      await fixture.results.buttons[0].click();
      assert.equal(fixture.calls.length, 0);
      assert.match(fixture.alerts[0], /nicht mehr eindeutig/);
      assert.ok(fixture.queries.some(([field, value]) => field === 'status' && value === 'offen'));
      assert.equal(fixture.input.disabled, false);
    });
  }
});

test('a refresh failure cannot invoke mark-paid', async () => {
  const fixture = await importFixture({ queryError: { message: 'offline' } });
  await fixture.results.buttons[0].click();
  assert.equal(fixture.calls.length, 0);
  assert.match(fixture.alerts[0], /erneut geprüft/);
  assert.equal(fixture.input.disabled, false);
});

test('amount-only click can be declined after current-data verification', async () => {
  const fixture = await importFixture({ entries: [payment({ remittance: '' })], confirm: false });
  await fixture.results.buttons[0].click();
  assert.equal(fixture.confirmations.length, 1);
  assert.equal(fixture.calls.length, 0);
});

test('a newly ambiguous amount-only match is withheld on click', async () => {
  const fixture = await importFixture({ entries: [payment({ remittance: '' })], latest: [invoice(), invoice({ id: 'inv-b', invoice_number: '2026-00002' })] });
  await fixture.results.buttons[0].click();
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.results.buttons.length, 0);
});

test('amount matching includes invoices beyond the first database page', async () => {
  const latest = [invoice(), ...Array.from({ length: 499 }, (_, idx) => invoice({ id: `filler-${idx}`, invoice_number: `2025-${String(idx).padStart(5, '0')}`, total: idx + 1 })), invoice({ id: 'inv-z', invoice_number: '2026-00002' })];
  const fixture = await importFixture({ entries: [payment({ remittance: '' })], latest });
  await fixture.results.buttons[0].click();
  assert.ok(fixture.queries.some(([method, offset]) => method === 'range' && offset === 500));
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.results.buttons.length, 0);
});

test('an incomplete or changing database page count blocks payment confirmation', async t => {
  await t.test('missing total count', async () => {
    const fixture = await importFixture({ pageCount: () => null });
    await fixture.results.buttons[0].click();
    assert.equal(fixture.calls.length, 0);
    assert.match(fixture.alerts[0], /unvollständig/);
  });
  await t.test('count changes between pages', async () => {
    const latest = Array.from({ length: 501 }, (_, idx) => invoice({ id: `inv-${idx}`, invoice_number: idx === 0 ? '2026-00001' : `2025-${String(idx).padStart(5, '0')}`, total: idx === 0 ? 1000 : idx }));
    const fixture = await importFixture({ latest, pageCount: from => from === 0 ? 501 : 500 });
    await fixture.results.buttons[0].click();
    assert.equal(fixture.calls.length, 0);
    assert.match(fixture.alerts[0], /während der Prüfung geändert/);
  });
});

test('success locks concurrent clicks and removes stale controls for that invoice', async () => {
  let finishPayment;
  const fixture = await importFixture({ markPaid: () => new Promise(resolve => { finishPayment = resolve; }) });
  const oldButton = fixture.results.buttons[0];
  const firstClick = oldButton.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.input.disabled, true);
  assert.ok(fixture.results.buttons.every(button => button.disabled));
  await oldButton.click();
  assert.deepEqual(fixture.calls, ['inv-a']);
  finishPayment({ data: { id: 'inv-a' } });
  await firstClick;
  assert.equal(fixture.context.allInvoicesData[0].status, 'bezahlt');
  assert.equal(fixture.results.buttons.length, 0);
  assert.match(fixture.results.innerHTML, /✓ Gebucht/);
  assert.equal(fixture.input.disabled, false);
  await oldButton.click();
  assert.deepEqual(fixture.calls, ['inv-a']);
});

test('a server rejection stays unbooked and permits a later revalidation', async () => {
  const fixture = await importFixture({ markPaid: () => ({ error: { message: 'bereits bezahlt' } }) });
  await fixture.results.buttons[0].click();
  assert.equal(fixture.context.allInvoicesData[0].status, 'offen');
  assert.doesNotMatch(fixture.results.innerHTML, /✓ Gebucht/);
  assert.match(fixture.alerts[0], /bereits bezahlt/);
  assert.equal(fixture.input.disabled, false);
});
