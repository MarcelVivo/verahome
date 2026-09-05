/* Short, resumable capture flow. Drafts are scoped to the signed-in admin
   and this tab; no tenant data or files are stored in the draft. */
(function () {
  'use strict';
  var core = window.VeraPropertyCreateCore;
  var client, profile, state, draftKey;
  var supportsPropertyType = false;
  var busy = false;
  var completed = false;
  var storageFailed = false;
  var accountBlocked = false;
  var existingLabels = [];
  var params = new URLSearchParams(window.location.search);
  var propertyId = params.get('property') || '';
  var requestedType = params.get('type') || 'wohnung';
  var uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var residentialTypes = ['wohnung', 'studio', 'zimmer', 'maisonette', 'attika', 'penthouse', 'triplex', 'dachwohnung', 'etagenwohnung', 'loft', 'einliegerwohnung', 'zimmer_moebliert', 'wohnung_moebliert'];
  var parkingTypes = ['garage', 'parkplatz', 'tiefgaragenplatz', 'aussenparkplatz'];
  function el(id) { return document.getElementById(id); }
  function escape(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]; }); }
  function newId() { return window.crypto.randomUUID(); }
  function typeLabel(type) { var found = core.UNIT_TYPES.find(function (row) { return row.value === type; }); return found ? found.label : type; }
  function typeOptions(type) {
    return core.UNIT_TYPES.map(function (row, index) {
      return (index === 8 ? '<optgroup label="Weitere Arten">' : '') + '<option value="' + row.value + '"' + (type === row.value ? ' selected' : '') + '>' + escape(row.label) + '</option>' + (index === core.UNIT_TYPES.length - 1 && index >= 8 ? '</optgroup>' : '');
    }).join('');
  }
  function propertyUrl() { return '/portal/admin/properties.html?property=' + encodeURIComponent(state.property.id); }
  function blockAccount() {
    accountBlocked = true;
    el('pcWorkspace').hidden = true;
    el('pcSuccess').hidden = true;
    el('pcLoading').hidden = true;
    el('pcLoadError').hidden = false;
    el('pcLoadErrorText').textContent = 'Die Anmeldung hat sich geändert. Bitte mit demselben Verwaltungskonto erneut anmelden und neu laden. Der zugehörige Entwurf bleibt erhalten.';
  }
  function assertAccount() {
    if (accountBlocked) throw new Error('Die Anmeldung hat sich geändert. Die Erfassung wurde angehalten.');
  }
  function sessionClient(session) {
    assertAccount();
    if (!session || !session.user || session.user.id !== profile.id || !session.access_token) {
      blockAccount();
      assertAccount();
    }
    // Bind all requests in this attempt to one checked user, even if another
    // tab changes the main Supabase session between two database operations.
    var token = session.access_token;
    return window.supabase.createClient(window.VERA_SUPABASE_CONFIG.url, window.VERA_SUPABASE_CONFIG.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'vera-capture-request-' + newId() },
      global: { fetch: function (url, options) {
        assertAccount();
        var requestOptions = Object.assign({}, options);
        var headers = new Headers(requestOptions.headers);
        headers.set('Authorization', 'Bearer ' + token);
        requestOptions.headers = headers;
        return window.fetch(url, requestOptions);
      } }
    });
  }
  function refreshAdvancedLink() {
    var dirty = state.units.length > 0 || (!propertyId && (state.property.label || state.property.street || state.property.zip || state.property.city || state.property.property_type !== 'mietobjekt'));
    el('pcAdvanced').parentElement.hidden = !!state.plan || !!dirty;
    if (propertyId) el('pcAdvanced').href = '/portal/admin/properties.html?create=unit&property=' + encodeURIComponent(propertyId) + '&type=' + encodeURIComponent(state.bulkType);
  }
  function clearError() { el('pcFormError').hidden = true; el('pcFormError').textContent = ''; }
  function showError(message, focus) {
    el('pcFormError').textContent = message;
    el('pcFormError').hidden = false;
    if (focus) {
      focus.setAttribute('aria-invalid', 'true');
      var details = focus.closest('details');
      if (details) details.open = true;
      focus.focus();
      focus.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  }
  function persist() {
    if (!state || completed) return true;
    refreshAdvancedLink();
    state.updatedAt = new Date().toISOString();
    try {
      var serialized = JSON.stringify(state);
      window.sessionStorage.setItem(draftKey, serialized);
      if (window.sessionStorage.getItem(draftKey) !== serialized) throw new Error('Storage verification failed');
      storageFailed = false;
      el('pcDraftStatus').textContent = state.plan ? 'Erfassung für eine sichere Wiederaufnahme gesichert.' : 'Entwurf in diesem Tab gesichert.';
      return true;
    } catch (error) {
      storageFailed = true;
      el('pcDraftStatus').textContent = 'Entwurf konnte in diesem Tab nicht gesichert werden.';
      return false;
    }
  }
  function readDraft() {
    var raw = window.sessionStorage.getItem(draftKey);
    if (!raw) return null;
    var draft;
    try { draft = JSON.parse(raw); } catch (error) { throw new Error('Der gespeicherte Entwurf kann nicht gelesen werden. Bitte die Objektübersicht öffnen und den Speicherstand prüfen.'); }
    if (!draft || draft.version !== 1 || draft.ownerId !== profile.id || draft.contextId !== propertyId || !draft.property || !uuidPattern.test(draft.property.id) || !Array.isArray(draft.units) || draft.units.length > 100 || draft.units.some(function (unit) { return !unit || !uuidPattern.test(unit.id); })) {
      throw new Error('Der gespeicherte Entwurf passt nicht zu dieser Erfassung. Bitte den Speicherstand in der Objektübersicht prüfen.');
    }
    if (draft.plan && (!draft.plan.property || draft.plan.property.id !== draft.property.id || draft.plan.existingProperty !== !!propertyId)) throw new Error('Der gespeicherte Erfassungsplan ist widersprüchlich. Bitte den Speicherstand in der Objektübersicht prüfen.');
    draft.step = draft.plan ? 3 : Math.max(propertyId ? 2 : 1, Math.min(3, Number(draft.step) || 1));
    return draft;
  }
  async function propertyTypeAvailable() {
    var response = await client.from('properties').select('property_type').limit(1);
    if (!response.error) return true;
    var error = response.error;
    if (['42703', 'PGRST204'].indexOf(error.code) >= 0 && /property_type/.test(error.message || '')) return false;
    throw new Error('Die Liegenschaftsdaten konnten nicht geprüft werden. Bitte die Verbindung prüfen und erneut laden.');
  }
  async function loadExisting() {
    var response = await client.from('properties').select('*').eq('id', propertyId).is('archived_at', null).maybeSingle();
    if (response.error) throw new Error('Die Liegenschaft konnte nicht geladen werden. Bitte erneut versuchen.');
    if (!response.data) throw new Error('Diese Liegenschaft ist nicht mehr verfügbar oder nicht zugänglich. Bitte in der Objektübersicht eine Liegenschaft auswählen.');
    existingLabels = [];
    for (var offset = 0; ; offset += 500) {
      var units = await client.from('units').select('id,label').eq('property_id', propertyId).is('archived_at', null).order('id').range(offset, offset + 499);
      if (units.error) throw new Error('Die vorhandenen Einheiten konnten nicht geladen werden. Bitte erneut versuchen.');
      existingLabels = existingLabels.concat((units.data || []).map(function (unit) { return unit.label; }));
      if ((units.data || []).length < 500) break;
    }
    return response.data;
  }
  function makeState(property) {
    return {
      version: 1, ownerId: profile.id, contextId: propertyId,
      property: property ? { id: property.id, label: property.label, street: property.street || '', zip: property.zip || '', city: property.city || '', property_type: property.property_type || 'mietobjekt' }
        : { id: newId(), label: '', street: '', zip: '', city: '', property_type: 'mietobjekt' },
      units: [], step: propertyId ? 2 : 1, labelManual: false, plan: null,
      bulkType: core.UNIT_TYPES.some(function (row) { return row.value === requestedType; }) ? requestedType : 'wohnung', bulkCount: '1'
    };
  }
  function fillPropertyInputs() {
    el('pcStreet').value = state.property.street || '';
    el('pcZip').value = state.property.zip || '';
    el('pcCity').value = state.property.city || '';
    el('pcPropertyLabel').value = state.property.label || '';
    document.querySelectorAll('[name=property_type]').forEach(function (input) { input.checked = input.value === state.property.property_type; });
    if (state.labelManual) el('pcLabelDetails').open = true;
    el('pcAddressPreview').textContent = state.property.label || 'Die Bezeichnung wird aus der Adresse gebildet.';
    el('pcUnitType').innerHTML = typeOptions(state.bulkType);
    el('pcUnitCount').value = state.bulkCount || '1';
  }
  function captureProperty() {
    if (propertyId || state.plan) return;
    state.property.street = el('pcStreet').value;
    state.property.zip = el('pcZip').value;
    state.property.city = el('pcCity').value;
    var selected = document.querySelector('[name=property_type]:checked');
    state.property.property_type = selected ? selected.value : 'mietobjekt';
    if (!state.labelManual) el('pcPropertyLabel').value = [state.property.street.trim(), state.property.city.trim()].filter(Boolean).join(', ');
    state.property.label = el('pcPropertyLabel').value;
    el('pcAddressPreview').textContent = state.property.label || 'Die Bezeichnung wird aus der Adresse gebildet.';
  }
  function unitMeta(unit) {
    return [typeLabel(unit.unit_type), unit.floor, unit.rooms ? unit.rooms + ' Zimmer' : '', unit.living_area_m2 ? unit.living_area_m2 + ' m²' : ''].filter(Boolean).join(' · ');
  }
  function unitHtml(unit, index) {
    var rooms = residentialTypes.indexOf(unit.unit_type) >= 0;
    var area = parkingTypes.indexOf(unit.unit_type) < 0;
    return '<details class="pc-unit" data-unit-id="' + unit.id + '"><summary><span class="pc-unit-index">' + (index + 1) + '</span><span class="pc-unit-name"><strong>' + escape(unit.label || 'Bezeichnung ergänzen') + '</strong><small>' + escape(unitMeta(unit)) + '</small></span></summary>' +
      '<div class="pc-unit-fields"><label for="label-' + unit.id + '">Bezeichnung</label><input id="label-' + unit.id + '" data-field="label" maxlength="200" value="' + escape(unit.label) + '">' +
      '<div class="pc-unit-type-row"><label for="type-' + unit.id + '">Art</label><select id="type-' + unit.id + '" data-field="unit_type">' + typeOptions(unit.unit_type) + '</select></div>' +
      '<label for="floor-' + unit.id + '">Stockwerk / Lage <span class="pc-hint">(optional)</span></label><input id="floor-' + unit.id + '" data-field="floor" maxlength="100" value="' + escape(unit.floor) + '" placeholder="z. B. EG links">' +
      '<div class="pc-address-row"' + (!area && !rooms ? ' hidden' : '') + '><div' + (!rooms ? ' hidden' : '') + '><label for="rooms-' + unit.id + '">Zimmer</label><input id="rooms-' + unit.id + '" data-field="rooms" type="number" min="0.1" max="999.9" step="0.1" inputmode="decimal" placeholder="z. B. 3.5" value="' + escape(unit.rooms) + '"></div>' +
      '<div' + (!area ? ' hidden' : '') + '><label for="area-' + unit.id + '">Fläche m²</label><input id="area-' + unit.id + '" data-field="living_area_m2" type="number" min="0.01" max="999999.99" step="0.01" inputmode="decimal" placeholder="optional" value="' + escape(unit.living_area_m2) + '"></div></div>' +
      '<div class="pc-unit-actions"><button type="button" class="pc-text-button" data-copy-unit="' + unit.id + '">Kopieren</button><button type="button" class="pc-text-button" data-remove-unit="' + unit.id + '">Entfernen</button></div></div></details>';
  }
  function renderUnits(openIds) {
    el('pcUnitsList').innerHTML = state.units.map(unitHtml).join('');
    (openIds || []).forEach(function (id) { var details = el('pcUnitsList').querySelector('[data-unit-id="' + id + '"]'); if (details) details.open = true; });
    el('pcUnitsHeading').textContent = state.units.length ? state.units.length + (state.units.length === 1 ? ' Einheit' : ' Einheiten') : 'Noch keine Einheiten';
    el('pcEmptyHint').hidden = !!state.units.length || !!propertyId;
  }
  function proposedName(type) {
    var names = existingLabels.concat(state.units.map(function (unit) { return unit.label; })).map(function (name) { return String(name).trim().toLocaleLowerCase('de-CH'); });
    var prefix = typeLabel(type);
    var number = 1;
    while (names.indexOf((prefix + ' ' + number).toLocaleLowerCase('de-CH')) >= 0) number++;
    return prefix + ' ' + number;
  }
  function addUnits() {
    if (busy || state.plan) return;
    clearError();
    var count = Number(el('pcUnitCount').value);
    if (!Number.isInteger(count) || count < 1 || count > 100 || state.units.length + count > 100) return showError('Bitte eine ganze Anzahl angeben. Pro Erfassung sind bis zu 100 Einheiten möglich.', el('pcUnitCount'));
    var type = el('pcUnitType').value;
    var openIds = Array.from(el('pcUnitsList').querySelectorAll('details[open]')).map(function (node) { return node.dataset.unitId; });
    for (var index = 0; index < count; index++) state.units.push({ id: newId(), unit_type: type, label: proposedName(type), floor: '', rooms: '', living_area_m2: '' });
    state.bulkType = type;
    state.bulkCount = el('pcUnitCount').value;
    persist();
    renderUnits(openIds);
    el('pcUnitsHeading').setAttribute('tabindex', '-1');
    el('pcUnitsHeading').focus({ preventScroll: true });
  }
  function planFromState() {
    return core.createPlan({ property: state.property, units: state.units, existingProperty: !!propertyId, supportsPropertyType: supportsPropertyType });
  }
  function validateProperty() {
    captureProperty();
    if (!String(state.property.label || '').trim()) { showError('Bitte eine Adresse oder eine eigene Bezeichnung angeben.', el('pcStreet')); return false; }
    if (!propertyId && state.property.property_type === 'stweg' && !supportsPropertyType) { showError('Stockwerkeigentum ist noch nicht eingerichtet. Der Entwurf bleibt erhalten.'); return false; }
    return true;
  }
  function validateUnits() {
    if (propertyId && !state.units.length) { showError('Bitte mindestens eine neue Einheit hinzufügen.', el('pcUnitCount')); return false; }
    for (var i = 0; i < state.units.length; i++) {
      var unit = state.units[i];
      if (!String(unit.label || '').trim()) { showError('Bitte eine Bezeichnung für Einheit ' + (i + 1) + ' angeben.', el('label-' + unit.id)); return false; }
      for (var field of ['rooms', 'living_area_m2']) {
        var input = el((field === 'rooms' ? 'rooms-' : 'area-') + unit.id);
        if (input && !input.validity.valid) { showError('Bitte die ' + (field === 'rooms' ? 'Zimmerzahl' : 'Fläche') + ' von „' + unit.label + '“ prüfen.', input); return false; }
      }
    }
    try { planFromState(); return true; } catch (error) { showError(error.message); return false; }
  }
  function renderReview() {
    var property = state.plan ? state.plan.property : state.property;
    var units = state.plan ? state.plan.units : state.units;
    var address = [property.street, [property.zip, property.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    var type = property.property_type === 'stweg' ? 'Stockwerkeigentum' : 'Mietliegenschaft';
    el('pcReview').innerHTML = '<div class="pc-review-property"><h3>' + escape(property.label) + '</h3><p>' + escape(address) + '</p><p>' + type + (propertyId ? ' · Bereits erfasst' : ' · Neue Liegenschaft') + '</p></div>' +
      '<strong>' + units.length + (units.length === 1 ? ' neue Einheit' : ' neue Einheiten') + '</strong>' +
      (units.length ? '<ul class="pc-review-list">' + units.map(function (unit, index) { return '<li><span class="pc-unit-index">' + (index + 1) + '</span><div><strong>' + escape(unit.label) + '</strong><small>' + escape(unitMeta(unit)) + '</small></div></li>'; }).join('') + '</ul>' : '<p class="pc-hint">Die Einheiten können Sie später ergänzen.</p>');
  }
  function showStep(step, focus) {
    state.step = step;
    [1, 2, 3].forEach(function (number) { el('pcStep' + number).hidden = step !== number; });
    el('pcSteps').querySelectorAll('[data-step]').forEach(function (button) {
      var number = Number(button.dataset.step);
      if (number === step) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
      button.disabled = busy || !!state.plan || (propertyId && number === 1) || number > step;
    });
    el('pcPropertyContext').textContent = state.property.label;
    el('pcBack').hidden = step === (propertyId ? 2 : 1) || !!state.plan;
    el('pcNext').textContent = state.plan ? 'Speicherstand prüfen und fortsetzen' : step === 1 ? 'Weiter zu den Einheiten →' : step === 2 ? 'Angaben prüfen →' : 'Intern speichern';
    el('pcNext').disabled = busy;
    el('pcDiscard').hidden = !!state.plan;
    refreshAdvancedLink();
    if (step === 3) renderReview();
    persist();
    if (focus) {
      var heading = el('pcStep' + step).querySelector('h2');
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
  }
  function showSuccess(result) {
    completed = true;
    // Keep the confirmed plan if clearing the draft fails: a later revisit
    // will reconcile the same IDs instead of creating another property.
    try { window.sessionStorage.removeItem(draftKey); } catch (ignored) {}
    el('pcWorkspace').hidden = true;
    el('pcSuccess').hidden = false;
    el('pcSuccessTitle').textContent = propertyId ? 'Die Einheiten sind erfasst.' : 'Die Liegenschaft ist erfasst.';
    el('pcSuccessSummary').textContent = state.plan.property.label + ' · ' + result.unitIds.length + (result.unitIds.length === 1 ? ' neue Einheit' : ' neue Einheiten');
    el('pcOpenProperty').href = propertyUrl();
    el('pcCreatedUnits').innerHTML = state.plan.units.map(function (unit) { return '<a href="' + propertyUrl() + '&unit=' + encodeURIComponent(unit.id) + '">' + escape(unit.label) + ' öffnen <span aria-hidden="true">→</span></a>'; }).join('');
    el('pcSuccessTitle').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  async function save() {
    if (busy || completed || accountBlocked) return;
    clearError();
    var hadPlan = !!state.plan;
    if (!state.plan) {
      try { state.plan = planFromState(); } catch (error) { showError(error.message); return; }
    }
    if (!persist()) {
      // No network writes unless the fixed IDs and payload are recoverable.
      if (!hadPlan) state.plan = null;
      showError('Speichern ist noch nicht möglich: Der Entwurf konnte nicht im Tab gesichert werden. Bitte den Browser-Speicher zulassen und erneut versuchen.');
      return;
    }
    busy = true;
    showStep(3, false);
    el('pcNext').textContent = 'Wird gespeichert …';
    el('pcSaveProgress').hidden = false;
    el('pcSaveProgress').textContent = 'Speicherstand wird geprüft …';
    try {
      var current = await VeraPortal.getProfile();
      if (!current || current.id !== profile.id || current.category !== 'admin' || current.status !== 'active') { blockAccount(); assertAccount(); }
      var writeClient = sessionClient(await VeraPortal.getSession());
      var result = await core.savePlan(writeClient, state.plan, { assertActive: assertAccount, onProgress: function (progress) {
        el('pcSaveProgress').textContent = progress.propertySaved ? 'Liegenschaft vorhanden · ' + progress.savedUnits + ' von ' + progress.totalUnits + ' Einheiten bestätigt.' : 'Liegenschaft wird geprüft und angelegt …';
      } });
      showSuccess(result);
    } catch (error) {
      showError(error.message || 'Der Speicherstand konnte nicht bestätigt werden. Bitte dieselbe Erfassung erneut prüfen.');
    } finally {
      busy = false;
      if (!completed && !accountBlocked) showStep(3, false);
    }
  }
  function bindEvents() {
    el('pcForm').addEventListener('submit', function (event) {
      event.preventDefault();
      if (busy || completed || accountBlocked) return;
      clearError();
      if (state.step === 1) { if (validateProperty()) showStep(2, true); }
      else if (state.step === 2) { if (validateUnits()) showStep(3, true); }
      else save();
    });
    el('pcForm').addEventListener('input', function (event) {
      if (busy || state.plan) return;
      event.target.removeAttribute('aria-invalid');
      if (event.target.id === 'pcPropertyLabel') state.labelManual = !!event.target.value;
      if (el('pcStep1').contains(event.target)) captureProperty();
      if (event.target.id === 'pcUnitCount') state.bulkCount = event.target.value;
      var row = event.target.closest('[data-unit-id]');
      if (row && event.target.dataset.field) {
        var unit = state.units.find(function (item) { return item.id === row.dataset.unitId; });
        if (unit) {
          unit[event.target.dataset.field] = event.target.value;
          row.querySelector('summary strong').textContent = unit.label || 'Bezeichnung ergänzen';
          row.querySelector('summary small').textContent = unitMeta(unit);
        }
      }
      persist();
    });
    el('pcForm').addEventListener('change', function (event) {
      if (busy || state.plan) return;
      if (event.target.name === 'property_type') captureProperty();
      if (event.target.id === 'pcUnitType') state.bulkType = event.target.value;
      if (event.target.dataset.field === 'unit_type') {
        var row = event.target.closest('[data-unit-id]');
        var unit = state.units.find(function (item) { return item.id === row.dataset.unitId; });
        unit.unit_type = event.target.value;
        if (residentialTypes.indexOf(unit.unit_type) < 0) unit.rooms = '';
        if (parkingTypes.indexOf(unit.unit_type) >= 0) unit.living_area_m2 = '';
        var openIds = Array.from(el('pcUnitsList').querySelectorAll('details[open]')).map(function (node) { return node.dataset.unitId; });
        renderUnits(openIds);
        el('type-' + unit.id).focus({ preventScroll: true });
      }
      persist();
    });
    el('pcBack').addEventListener('click', function () { if (!busy && !state.plan) { clearError(); showStep(Math.max(propertyId ? 2 : 1, state.step - 1), true); } });
    el('pcSteps').addEventListener('click', function (event) {
      var button = event.target.closest('[data-step]');
      if (!button || button.disabled || busy || state.plan) return;
      clearError();
      showStep(Number(button.dataset.step), true);
    });
    el('pcAddUnits').addEventListener('click', addUnits);
    el('pcUnitCount').addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); addUnits(); } });
    el('pcUnitsList').addEventListener('click', function (event) {
      if (busy || state.plan) return;
      var remove = event.target.closest('[data-remove-unit]');
      var copy = event.target.closest('[data-copy-unit]');
      if (!remove && !copy) return;
      var openIds = Array.from(el('pcUnitsList').querySelectorAll('details[open]')).map(function (node) { return node.dataset.unitId; });
      if (remove) state.units = state.units.filter(function (unit) { return unit.id !== remove.dataset.removeUnit; });
      if (copy) {
        if (state.units.length >= 100) { showError('Pro Erfassung sind bis zu 100 Einheiten möglich.'); return; }
        var original = state.units.find(function (unit) { return unit.id === copy.dataset.copyUnit; });
        var duplicate = Object.assign({}, original, { id: newId(), label: proposedName(original.unit_type) });
        state.units.push(duplicate);
        openIds.push(duplicate.id);
      }
      persist();
      renderUnits(openIds);
    });
    el('pcDiscard').addEventListener('click', function () {
      if (busy || state.plan || !window.confirm('Diesen noch nicht gespeicherten Entwurf verwerfen?')) return;
      state = makeState(propertyId ? state.property : null);
      el('pcLabelDetails').open = false;
      fillPropertyInputs();
      renderUnits();
      clearError();
      showStep(state.step, true);
    });
    el('pcStartAgain').addEventListener('click', function () { window.location.href = '/portal/admin/property-create.html'; });
    document.addEventListener('click', function (event) {
      if (busy && event.target.closest('a')) { event.preventDefault(); showError('Die Speicherung läuft. Bitte kurz warten, bis der Speicherstand bestätigt ist.'); }
    });
    window.addEventListener('pagehide', function () { persist(); });
    window.addEventListener('beforeunload', function (event) {
      if (busy || (storageFailed && !completed)) { event.preventDefault(); event.returnValue = ''; }
    });
  }
  async function init() {
    try {
      if (propertyId && !uuidPattern.test(propertyId)) throw new Error('Der Link zur Liegenschaft ist ungültig. Bitte eine Liegenschaft in der Objektübersicht auswählen.');
      var ctx = await VeraPortal.requireAdmin();
      if (!ctx) return;
      profile = ctx.profile;
      if (profile.category !== 'admin' || profile.status !== 'active') throw new Error('Für die Erfassung ist ein aktiver Verwaltungszugang erforderlich.');
      var authClient = VeraPortal.getClient();
      authClient.auth.onAuthStateChange(function (event, session) {
        if (!session || !session.user || session.user.id !== profile.id) blockAccount();
      });
      client = sessionClient(await VeraPortal.getSession());
      draftKey = 'vera:property-create:v1:' + profile.id + ':' + (propertyId || 'new');
      try { state = readDraft(); } catch (error) {
        if (error.name === 'SecurityError') storageFailed = true; else throw error;
      }
      supportsPropertyType = await propertyTypeAvailable();
      var existing = propertyId ? await loadExisting() : null;
      assertAccount();
      state = state || makeState(existing);
      if (propertyId) {
        el('pcTitle').textContent = 'Einheiten hinzufügen';
        el('pcLead').textContent = 'Neue Einheiten für „' + existing.label + '“ erfassen und gemeinsam prüfen.';
        el('pcExit').href = '/portal/admin/properties.html?property=' + encodeURIComponent(propertyId);
        el('pcAdvanced').href = '/portal/admin/properties.html?create=unit&property=' + encodeURIComponent(propertyId) + '&type=' + encodeURIComponent(state.bulkType);
      }
      el('pcStweg').disabled = !supportsPropertyType;
      el('pcTypeHint').hidden = supportsPropertyType;
      fillPropertyInputs();
      renderUnits();
      bindEvents();
      el('pcLoading').hidden = true;
      el('pcWorkspace').hidden = false;
      showStep(state.step, false);
      if (state.plan) {
        el('pcSaveProgress').hidden = false;
        el('pcSaveProgress').textContent = 'Diese Erfassung wurde bereits begonnen. Beim Fortsetzen wird zuerst geprüft, was schon gespeichert ist.';
      }
    } catch (error) {
      el('pcLoading').hidden = true;
      el('pcLoadError').hidden = false;
      el('pcLoadErrorText').textContent = error.message || 'Die Erfassung konnte nicht geladen werden. Bitte erneut versuchen.';
    }
  }
  el('pcReload').addEventListener('click', function () { window.location.reload(); });
  init();
})();
