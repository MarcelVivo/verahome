/* Vera Portal — repeatable property/unit creation using existing table APIs.
   The caller persists the plan before calling savePlan. Every retry must use
   that same plan: a request timeout does not mean its insert was rolled back. */
(function (root) {
  "use strict";

  var UNIT_TYPES = [
    { value: "wohnung", label: "Wohnung" },
    { value: "studio", label: "Studio" },
    { value: "zimmer", label: "Zimmer" },
    { value: "gewerbe", label: "Gewerbe" },
    { value: "garage", label: "Garage" },
    { value: "parkplatz", label: "Parkplatz" },
    { value: "lager", label: "Lager / Hobbyraum" },
    { value: "sonstiges", label: "Sonstige Einheit" },
    { value: "maisonette", label: "Maisonette" },
    { value: "attika", label: "Attikawohnung" },
    { value: "penthouse", label: "Penthouse" },
    { value: "triplex", label: "Triplex" },
    { value: "dachwohnung", label: "Dachwohnung" },
    { value: "etagenwohnung", label: "Etagenwohnung" },
    { value: "loft", label: "Loft" },
    { value: "einliegerwohnung", label: "Einliegerwohnung" },
    { value: "zimmer_moebliert", label: "Möbliertes Zimmer" },
    { value: "wohnung_moebliert", label: "Möblierte Wohnung" },
    { value: "tiefgaragenplatz", label: "Tiefgaragenplatz" },
    { value: "aussenparkplatz", label: "Aussenparkplatz" },
    { value: "hobbyraum", label: "Hobbyraum" },
    { value: "gastronomie", label: "Gastronomie" }
  ];
  var allowedTypes = UNIT_TYPES.map(function (type) { return type.value; });
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var propertyFields = ["label", "street", "zip", "city", "visibility"];
  var unitFields = ["property_id", "unit_type", "label", "floor", "rooms", "living_area_m2", "visibility"];

  function fail(message, code, cause) {
    var error = new Error(message);
    error.code = code || "INVALID_PLAN";
    if (cause) error.originalError = cause;
    return error;
  }

  function text(value, label, required) {
    if (value == null) value = "";
    if (typeof value !== "string") throw fail(label + ": Bitte einen Text angeben.");
    value = value.trim();
    if (required && !value) throw fail(label + " fehlt.");
    return value || null;
  }

  function id(value, label) {
    if (typeof value !== "string" || !UUID.test(value)) throw fail(label + ": Ungültige Zuordnungs-ID.");
    return value.toLowerCase();
  }

  function positiveNumber(value, label, decimals, max) {
    if (value == null || (typeof value === "string" && !value.trim())) return null;
    if (typeof value !== "number" && typeof value !== "string") throw fail(label + ": Ungültige Zahl.");
    if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim())) throw fail(label + ": Bitte eine positive Zahl angeben.");
    var number = Number(value);
    if (!Number.isFinite(number) || number <= 0 || number > max) throw fail(label + ": Bitte eine positive Zahl bis " + max + " angeben.");
    var rounded = Number(number.toFixed(decimals));
    if (rounded <= 0 || Math.abs(number - rounded) > 1e-9) throw fail(label + ": Höchstens " + decimals + " Nachkommastellen angeben.");
    return rounded;
  }

  function createPlan(input) {
    if (!input || !input.property || !Array.isArray(input.units)) throw fail("Liegenschaft und Einheiten fehlen.");
    if (input.units.length > 100) throw fail("Bitte höchstens 100 Einheiten auf einmal erfassen.");
    var existing = input.existingProperty === true;
    var property = input.property;
    var propertyId = id(property.id, "Liegenschaft");
    var propertyType = text(property.property_type, "Verwaltungsart", false) || "mietobjekt";
    if (["mietobjekt", "stweg"].indexOf(propertyType) === -1) throw fail("Unbekannte Verwaltungsart: " + propertyType + ".");
    if (!existing && propertyType === "stweg" && input.supportsPropertyType !== true) {
      throw fail("STWEG kann noch nicht gespeichert werden: Die Datenbank unterstützt die Verwaltungsart nicht. Der Entwurf bleibt erhalten.", "PROPERTY_TYPE_UNAVAILABLE");
    }
    var payload = {
      id: propertyId,
      label: text(property.label, "Bezeichnung der Liegenschaft", true),
      street: text(property.street, "Strasse", false),
      zip: text(property.zip, "PLZ", false),
      city: text(property.city, "Ort", false),
      visibility: "private"
    };
    if (input.supportsPropertyType === true) payload.property_type = propertyType;
    var ids = Object.create(null);
    ids[propertyId] = true;
    var units = input.units.map(function (unit, index) {
      if (!unit || typeof unit !== "object") throw fail("Einheit " + (index + 1) + " ist ungültig.");
      var unitId = id(unit.id, "Einheit " + (index + 1));
      if (ids[unitId]) throw fail("Eine Zuordnungs-ID wird mehrfach verwendet.");
      ids[unitId] = true;
      var type = text(unit.unit_type, "Einheitstyp", true);
      if (allowedTypes.indexOf(type) === -1) throw fail("Unbekannter oder nicht zulässiger Einheitstyp: " + type + ". Bestehende Typen werden nicht umgedeutet.");
      return {
        id: unitId,
        property_id: propertyId,
        unit_type: type,
        label: text(unit.label, "Bezeichnung der Einheit " + (index + 1), true),
        floor: text(unit.floor, "Stockwerk", false),
        rooms: positiveNumber(unit.rooms, "Zimmerzahl", 1, 999.9),
        living_area_m2: positiveNumber(unit.living_area_m2, "Fläche", 2, 999999.99),
        visibility: "private"
      };
    });
    return { version: 1, existingProperty: existing, property: payload, units: units };
  }

  function validatePlan(plan) {
    if (!plan || plan.version !== 1 || typeof plan.existingProperty !== "boolean" || !plan.property || !Array.isArray(plan.units)) {
      throw fail("Dieser gespeicherte Entwurf ist ungültig oder hat eine unbekannte Version.");
    }
    if (plan.property.visibility !== "private" || plan.units.some(function (unit) {
      return !unit || unit.visibility !== "private" || unit.property_id !== plan.property.id;
    })) throw fail("Der Entwurf enthält eine widersprüchliche Objektzuordnung oder Veröffentlichung.");
    // Copy and validate all writable fields before the first async operation.
    return createPlan({
      property: plan.property,
      units: plan.units,
      existingProperty: plan.existingProperty,
      supportsPropertyType: Object.prototype.hasOwnProperty.call(plan.property, "property_type")
    });
  }

  function comparable(value, field) {
    if (value == null || value === "") return null;
    if (field === "rooms" || field === "living_area_m2") return Number(value);
    return typeof value === "string" ? value.trim() || null : value;
  }

  function assertRow(row, expected, fields, label) {
    if (row.archived_at) throw fail(label + " wurde inzwischen archiviert. Bitte den bestehenden Datensatz prüfen.", "RECORD_CONFLICT");
    if (row.id !== expected.id || fields.some(function (field) {
      return comparable(row[field], field) !== comparable(expected[field], field);
    })) throw fail(label + " wurde bereits mit abweichenden Daten gespeichert. Bitte den bestehenden Datensatz prüfen; es wurde nichts überschrieben.", "RECORD_CONFLICT");
  }

  function detail(error) {
    return error && error.message ? " " + error.message : "";
  }

  async function readProperty(client, plan, assertActive) {
    var fields = "id,label,street,zip,city,visibility,archived_at";
    if (Object.prototype.hasOwnProperty.call(plan.property, "property_type")) fields += ",property_type";
    // Keep the account guard outside request-error handling. An account
    // change must stop the flow, not be treated as a recoverable network error.
    await assertActive();
    try {
      var result = await client.from("properties").select(fields).eq("id", plan.property.id).maybeSingle();
      if (result.error) throw result.error;
      if (result.data !== null && (!result.data || typeof result.data !== "object" || Array.isArray(result.data))) {
        throw new Error("Ungültige Antwort der Datenbank.");
      }
      return result.data;
    } catch (error) {
      throw fail("Speicherstand der Liegenschaft konnte nicht geprüft werden. Bitte mit demselben Entwurf erneut prüfen." + detail(error), "READ_UNCERTAIN", error);
    }
  }

  async function readUnits(client, plan, assertActive) {
    if (!plan.units.length) return [];
    await assertActive();
    try {
      var result = await client.from("units")
        .select("id,property_id,unit_type,label,floor,rooms,living_area_m2,visibility,archived_at")
        .in("id", plan.units.map(function (unit) { return unit.id; }));
      if (result.error) throw result.error;
      if (!Array.isArray(result.data)) throw new Error("Ungültige Antwort der Datenbank.");
      return result.data;
    } catch (error) {
      throw fail("Speicherstand der Einheiten konnte nicht geprüft werden. Bitte mit demselben Entwurf erneut prüfen." + detail(error), "READ_UNCERTAIN", error);
    }
  }

  function checkUnits(rows, plan) {
    var byId = Object.create(null);
    var expected = Object.create(null);
    plan.units.forEach(function (unit) { expected[unit.id] = unit; });
    rows.forEach(function (row) {
      if (!row || !expected[row.id] || byId[row.id]) throw fail("Die Einheiten-Antwort passt nicht zum Entwurf.", "RECORD_CONFLICT");
      assertRow(row, expected[row.id], unitFields, "Einheit „" + expected[row.id].label + "“");
      byId[row.id] = row;
    });
    return plan.units.filter(function (unit) { return !byId[unit.id]; });
  }

  async function insertOnce(client, table, payload, assertActive) {
    await assertActive();
    try {
      var result = await client.from(table).insert(payload);
      return result.error || null;
    } catch (error) {
      return error;
    }
  }

  async function savePlan(client, suppliedPlan, options) {
    var plan = validatePlan(suppliedPlan);
    var propertySaved = false;
    var savedUnits = 0;
    async function assertActive() {
      if (options && typeof options.assertActive === "function") await options.assertActive();
    }
    function progress() {
      if (options && typeof options.onProgress === "function") {
        try {
          options.onProgress({ propertySaved: propertySaved, savedUnits: savedUnits, totalUnits: plan.units.length });
        } catch (ignored) { /* A rendering error must not change the save result. */ }
      }
    }
    progress();
    var property = await readProperty(client, plan, assertActive);
    if (!property && plan.existingProperty) throw fail("Die gewählte Liegenschaft ist nicht mehr vorhanden oder nicht zugänglich. Es wurde keine neue Liegenschaft angelegt.", "PROPERTY_MISSING");
    var compareFields = propertyFields.slice();
    if (Object.prototype.hasOwnProperty.call(plan.property, "property_type")) compareFields.push("property_type");
    function checkProperty(row) {
      // Existing properties may be public or have changed labels; never write
      // their payload or reinterpret their existing metadata in this flow.
      assertRow(row, plan.property, plan.existingProperty ? [] : compareFields, "Liegenschaft");
    }
    if (property) checkProperty(property);
    // Detect conflicting unit IDs before creating a new parent property.
    var missing = checkUnits(await readUnits(client, plan, assertActive), plan);
    savedUnits = plan.units.length - missing.length;
    propertySaved = !!property;
    progress();

    if (!property) {
      var propertyError = await insertOnce(client, "properties", plan.property, assertActive);
      property = await readProperty(client, plan, assertActive);
      if (!property) throw fail("Die Liegenschaft ist noch nicht gespeichert. Der Entwurf bleibt erhalten." + detail(propertyError), "PROPERTY_NOT_SAVED", propertyError);
      checkProperty(property);
      propertySaved = true;
      progress();
    }

    if (missing.length) {
      var unitError = await insertOnce(client, "units", missing, assertActive);
      missing = checkUnits(await readUnits(client, plan, assertActive), plan);
      savedUnits = plan.units.length - missing.length;
      progress();
      if (missing.length) throw fail("Liegenschaft gespeichert; " + savedUnits + " von " + plan.units.length + " Einheiten gespeichert. Bitte mit demselben Entwurf fortsetzen." + detail(unitError), "UNITS_INCOMPLETE", unitError);
    }
    // There is no cross-table transaction here. Recheck the parent before
    // reporting success in case another admin archived it during the save.
    property = await readProperty(client, plan, assertActive);
    if (!property) throw fail("Die Liegenschaft ist inzwischen nicht mehr vorhanden oder nicht zugänglich. Bitte den Speicherstand prüfen.", "PROPERTY_MISSING");
    checkProperty(property);
    await assertActive();
    return { propertyId: plan.property.id, unitIds: plan.units.map(function (unit) { return unit.id; }) };
  }

  root.VeraPropertyCreateCore = { UNIT_TYPES: UNIT_TYPES, createPlan: createPlan, savePlan: savePlan };
})(typeof window !== "undefined" ? window : globalThis);
