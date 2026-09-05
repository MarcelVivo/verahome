const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'portal/admin/properties.html'), 'utf8');
const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(script => script.includes('function attachExistingArchiveDocument('));
const plain = value => JSON.parse(JSON.stringify(value));
const property = { id: 'property-new', label: 'New house' };
const unit = { id: 'unit-new', property_id: property.id, label: 'New flat' };
const initialGrants = [
  { file_id: 'file', profile_id: 'former-tenant', created_by: 'original-admin', needs_confirmation: true, confirmed_at: '2026-01-02T12:00:00Z' },
  { file_id: 'file', profile_id: 'other-reader', created_by: 'original-admin', needs_confirmation: false, confirmed_at: null }
];

function fixture(options = {}) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', disabled: false, dataset: {},
      classList: { add() {}, remove() {} }
    });
    return elements.get(id);
  }
  const state = {
    file: { id: 'file', property_id: 'property-old', unit_id: 'unit-old', folder_id: 'folder-old', is_private_admin: true },
    grants: plain(initialGrants), writes: [], notices: []
  };
  const client = {
    rpc: async (name, args) => {
      if (name === 'document_privacy_ready') return { data: options.ready !== false, error: null };
      // Model the real replacement RPC so a return to the old handlers would
      // delete existing recipients and fail the observable-state assertions.
      assert.equal(name, 'replace_document_readers');
      state.writes.push({ kind: 'replace', args: plain(args) });
      if (options.shareError) return { error: { message: 'Grant refused' } };
      state.grants = state.grants.filter(grant => args.p_profile_ids.includes(grant.profile_id));
      for (const id of args.p_profile_ids) {
        if (!state.grants.some(grant => grant.profile_id === id)) state.grants.push({ file_id: args.p_file_id, profile_id: id });
      }
      return { error: null };
    },
    from(table) {
      if (table === 'document_files') return {
        update(payload) { return { eq: async (column, id) => {
          assert.equal(column, 'id');
          assert.equal(id, 'file');
          state.writes.push({ kind: 'file', payload: plain(payload) });
          if (options.fileError) return { error: { message: 'Filing refused' } };
          Object.assign(state.file, plain(payload));
          if (options.concurrentGrant && !state.grants.some(grant => grant.profile_id === 'concurrent-reader')) {
            state.grants.push({ file_id: 'file', profile_id: 'concurrent-reader', needs_confirmation: true, confirmed_at: null });
          }
          return { error: null };
        } }; }
      };
      assert.equal(table, 'document_shares');
      return { upsert: async (payload, settings) => {
        state.writes.push({ kind: 'grant', payload: plain(payload) });
        if (options.shareError) return { error: { message: 'Grant refused' } };
        assert.equal(settings.onConflict, 'file_id,profile_id');
        const current = state.grants.find(grant => grant.file_id === payload.file_id && grant.profile_id === payload.profile_id);
        if (!current) state.grants.push(plain(payload));
        else if (!settings.ignoreDuplicates) Object.assign(current, plain(payload));
        return { error: null };
      } };
    },
    functions: { invoke: async (name, payload) => {
      state.notices.push({ name, ...plain(payload) });
      return { data: {}, error: null };
    } }
  };
  const window = {};
  const context = vm.createContext({
    window, document: { getElementById: element },
    VeraPortal: { requireAdmin: async () => null },
    VeraDashboard: { escapeHtml: String, formatDate: String },
    fetch: () => { throw new Error('External requests forbidden in isolated assignment tests'); }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'public/js/document-access.js'), 'utf8'), context);
  context.VeraDocumentAccess = window.VeraDocumentAccess;
  // Expose the actual closure handlers only inside the test VM. Only folder
  // setup and unrelated post-save rendering are stubbed; mutations, readiness,
  // validation and notification logic run from the production page unchanged.
  const instrumented = source.replace(/\}\)\(\);\s*$/, `
    window.assignmentTest = {
      attachExistingArchiveDocument, linkExistingUnitDocument,
      linkExistingPropertyDocument, attachNewRecordDocuments,
      archiveRecipientOptionsHtml,
      configure(value, property, unit) {
        client = value; profile = { id: 'current-admin' };
        allProperties = [property]; allUnits = [unit]; supportsArchiveCategory = true;
        selectedPropertyId = property.id; selectedUnitId = null; selectedDetailId = 'miet_verwaltung';
        ensureObjectDocumentFolder = async () => ({ id: 'folder-new' });
        loadAll = async () => {}; renderAllColumns = () => {};
        loadUnitLinkedDocs = () => {}; loadPropertyDocs = () => {};
      },
      tenantArchive(unit) { selectedUnitId = unit.id; selectedDetailId = 'unit_mieter'; },
      setTenancies(rows) { allTenancies = rows; }
    };
  })();`);
  assert.notEqual(instrumented, source);
  vm.runInContext(instrumented, context, { filename: 'properties.html' });
  const api = window.assignmentTest;
  api.configure(client, property, unit);
  const event = { preventDefault() {}, currentTarget: { querySelector: () => element('submit') } };
  return {
    api, state, element,
    async run(kind, recipient = '') {
      if (kind === 'archive' || kind === 'tenant-archive') {
        if (kind === 'tenant-archive') api.tenantArchive(unit);
        element('archiveExistingDoc').value = 'file';
        element('archiveExistingRecipient').value = recipient;
        await api.attachExistingArchiveDocument(event);
      } else if (kind === 'unit') {
        element('unitExistingDocSelect-' + unit.id).value = 'file';
        element('unitExistingDocRecipient-' + unit.id).value = recipient;
        await api.linkExistingUnitDocument(unit);
      } else if (kind === 'property') {
        element('docExistingSelect-' + property.id).value = 'file';
        element('docExistingCategory-' + property.id).value = 'verwaltung';
        await api.linkExistingPropertyDocument(event, property.id);
      } else {
        const result = await api.attachNewRecordDocuments({
          property, propertyId: property.id,
          unitId: kind === 'new-unit' ? unit.id : null,
          archiveCategory: kind === 'new-unit' ? 'unit_unterhalt' : 'miet_verwaltung', existingIds: ['file']
        });
        return plain(result);
      }
    },
    status(kind) { return element(kind === 'unit' ? 'unitAssignmentStatus-' + unit.id : 'archiveExistingStatus').textContent; }
  };
}

for (const kind of ['archive', 'property', 'new-property', 'new-unit']) {
  test(kind + ': filing without an additional recipient leaves all grants and confirmations intact', async () => {
    const f = fixture();
    const result = await f.run(kind);
    assert.equal(f.state.file.property_id, property.id);
    assert.equal(f.state.file.folder_id, 'folder-new');
    assert.equal(f.state.file.unit_id, kind === 'new-unit' ? unit.id : null);
    assert.equal(f.state.file.is_private_admin, true);
    assert.deepEqual(f.state.grants, initialGrants);
    assert.deepEqual(f.state.writes.map(write => write.kind), ['file']);
    assert.deepEqual(f.state.notices, []);
    if (result) assert.deepEqual(result, { uploaded: 0, linked: 1, errors: [] });
  });
}

for (const kind of ['archive', 'tenant-archive', 'unit']) {
  test(kind + ': explicitly adding a reader preserves prior and concurrently added grants', async () => {
    const f = fixture({ concurrentGrant: true });
    await f.run(kind, 'new-reader');
    assert.deepEqual(f.state.grants.slice(0, 2), initialGrants);
    assert.deepEqual(f.state.grants.map(grant => grant.profile_id), ['former-tenant', 'other-reader', 'concurrent-reader', 'new-reader']);
    assert.equal(f.state.file.property_id, property.id);
    assert.equal(f.state.file.unit_id, kind === 'archive' ? null : unit.id);
    assert.deepEqual(f.state.notices, [{ name: 'notify-document-share', body: { fileIds: ['file'], profileIds: ['new-reader'] } }]);
  });

  test(kind + ': selecting an existing reader repeatedly preserves confirmation and grant author', async () => {
    const f = fixture();
    await f.run(kind, 'former-tenant');
    await f.run(kind, 'former-tenant');
    assert.deepEqual(f.state.grants, initialGrants);
    assert.equal(f.state.file.folder_id, 'folder-new');
    assert.equal(f.state.writes.some(write => write.kind === 'replace'), false);
  });

  test(kind + ': a failed additional grant retains old readers and reports the partial result', async () => {
    const f = fixture({ shareError: true });
    await f.run(kind, 'new-reader');
    assert.deepEqual(f.state.grants, initialGrants);
    assert.equal(f.state.file.folder_id, 'folder-new');
    assert.match(f.status(kind), /Freigabe.*fehlgeschlagen: Grant refused/);
    assert.deepEqual(f.state.notices, []);
    assert.equal(f.element(kind === 'unit' ? 'unitExistingDocLink-' + unit.id : 'submit').disabled, false);
  });

  test(kind + ': a failed filing change neither grants access nor sends a notification', async () => {
    const f = fixture({ fileError: true });
    await f.run(kind, 'new-reader');
    assert.deepEqual(f.state.grants, initialGrants);
    assert.equal(f.state.file.folder_id, 'folder-old');
    assert.deepEqual(f.state.writes.map(write => write.kind), ['file']);
    assert.match(f.status(kind), /Filing refused/);
    assert.deepEqual(f.state.notices, []);
  });
}

for (const kind of ['archive', 'tenant-archive', 'unit', 'property', 'new-property', 'new-unit']) {
  test(kind + ': missing server readiness blocks every filing and grant mutation', async () => {
    const f = fixture({ ready: false });
    const result = await f.run(kind, 'new-reader');
    assert.deepEqual(f.state.writes, []);
    assert.deepEqual(f.state.grants, initialGrants);
    assert.deepEqual(f.state.notices, []);
    if (result) assert.equal(result.errors.length, 1);
  });
}

test('existing tenant document selector requires an explicit recipient choice, even with one tenant', () => {
  const f = fixture();
  f.api.setTenancies([{ unit_id: unit.id, tenant_profile_id: 'former-tenant', status: 'active' }]);
  const options = f.api.archiveRecipientOptionsHtml(property, unit, { tenant: true }, true);
  assert.doesNotMatch(options, /\bselected\b/);
  assert.match(options, /Person für zusätzliche Freigabe wählen/);
});
