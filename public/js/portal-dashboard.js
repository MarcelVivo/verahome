/* Vera Portal — shared dashboard shell (sidebar + small helpers).
   Load order on every dashboard page:
   1) https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2
   2) /public/js/supabase-config.js
   3) /public/js/portal-auth.js
   4) /public/js/portal-dashboard.js  (this file)
   5) the page's own inline script
*/
window.VeraDashboard = (function () {
  "use strict";
  var PORTAL_OWNER_EMAIL = "kontakt@marcelspahr.ch";

  /* Schlanke Hauptnavigation: Objekt/Dokument/Kontakt als zentrale
     Arbeitsachsen. Spezialseiten wie Mietverhältnisse, Eigentümer,
     Waschpläne, Rapporte, Nebenkosten und Aufträge bleiben technisch
     erreichbar, sind aber nicht mehr eigene Hauptregister. Sie werden
     kontextbezogen aus Objekten/Buchhaltung/Admin geöffnet. */
  var NAV_GROUPS = [
    { label: null, items: [
      { key: "dashboard", href: "/portal/dashboard.html", label: "Übersicht" },
      { key: "admin-properties", href: "/portal/admin/properties.html", label: "Objekte", roles: ["admin"] },
      { key: "owner-report", href: "/portal/owner-report.html", label: "Objekte", roles: ["eigentuemer"] },
      { key: "documents", href: "/portal/documents.html", label: "Dokumente" },
      { key: "admin-users", href: "/portal/admin/users.html", label: "Kontakte", roles: ["admin"] },
      { key: "termine", href: "/portal/admin/termine.html", label: "Termine", roles: ["admin"] },
      { key: "my-appointments", href: "/portal/my-appointments.html", label: "Termine", roles: ["handwerker", "hauswart"] },
      { key: "calendar", href: "/portal/calendar.html", label: "Termine", roles: ["mieter", "eigentuemer", "partner", "firma", "aemter"] },
      { key: "messages", href: "/portal/messages.html", label: "Nachrichten" },
      { key: "invoices", href: "/portal/invoices.html", label: "Buchhaltung" },
      { key: "meldungen", href: "/portal/meldungen.html", label: "Anfragen" },
      { key: "admin-archive", href: "/portal/admin/archive.html", label: "Archiv", roles: ["admin"] },
      { key: "admin-audit-log", href: "/portal/admin/audit-log.html", label: "Protokoll", roles: ["admin"] },
      { key: "admin-portal-editor", href: "/portal/admin/portal-editor.html", label: "Admin", roles: ["admin"], portalOwnerOnly: true }
    ]}
  ];
  var ADMIN_NAV_GROUP = { label: "Verknüpfte Bereiche", hiddenFromMainNav: true, items: [
    { key: "admin-tenancies", href: "/portal/admin/tenancies.html", label: "Mietverhältnisse" },
    { key: "admin-ownerships", href: "/portal/admin/ownerships.html", label: "Eigentümerschaften" },
    { key: "admin-jobs", href: "/portal/admin/jobs.html", label: "Aufträge" },
    { key: "admin-utility-statements", href: "/portal/admin/utility-statements.html", label: "Nebenkosten" },
    { key: "admin-homepage-content", href: "/portal/admin/homepage-content.html", label: "Homepage editieren" }
  ]};
  var SERVICES_NAV_GROUP = { label: "Verknüpfte Services", hiddenFromMainNav: true, items: [
    { key: "rapporte", href: "/portal/rapporte.html", label: "Rapporte", roles: ["hauswart", "admin"] },
    { key: "waschplan", href: "/portal/waschplan.html", label: "Waschpläne" }
  ]};
  var NAV_ACTIVE_KEY_MAP = {
    "admin-tenancies": "admin-properties",
    "admin-ownerships": "admin-properties",
    "admin-jobs": "admin-properties",
    "rapporte": "admin-properties",
    "waschplan": "admin-properties",
    "admin-utility-statements": "invoices",
    "invoice-detail": "invoices",
    "tickets": "meldungen",
    "admin-homepage-content": "admin-portal-editor"
  };
  /* Nav item keys that get an unread-count badge, and the subset of
     those for which visiting the page should mark the section "seen"
     (messages excluded — it clears itself per-message via
     VeraPortal.markMessageRead(), not via mark_section_seen()). */
  var BADGE_SECTIONS = ["messages", "invoices", "meldungen", "documents", "calendar", "waschplan", "tickets", "rapporte", "termine"];
  var SEEN_TRACKED_SECTIONS = ["invoices", "meldungen", "documents", "calendar", "waschplan", "tickets", "rapporte", "termine"];
  var INVOICE_ISSUER_CATEGORIES = ["admin", "partner", "handwerker", "aemter"];
  var CATEGORY_LABELS = {
    mieter: "Mieter",
    eigentuemer: "Eigentümer",
    partner: "Partner",
    handwerker: "Handwerker",
    hauswart: "Hauswart",
    firma: "Firma",
    aemter: "Ämter",
    admin: "Admin"
  };

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* Gleicher Google-Maps-Embed wie im "Lage"-Bereich der öffentlichen
     Objekt-Seite (objekt.html) und im Kontakt-Bereich der Startseite --
     braucht keinen API-Key (output=embed), daher überall im Portal
     wiederverwendbar, wo eine Adresse angezeigt wird. Ohne Adresse kein
     Markup, damit keine leere Karten-Box entsteht. */
  function mapEmbedHtml(address, title) {
    if (!address) return "";
    return '<div class="map-embed"><iframe src="https://maps.google.com/maps?q=' +
      encodeURIComponent(address) + '&output=embed" width="100%" height="200" loading="lazy" title="Lageplan ' +
      escapeHtml(title || address) + '"></iframe></div>';
  }

  /* Case-insensitive substring match across several raw field values —
     shared by every list page's search box so each one doesn't
     reimplement the same join/lowercase/includes. Null/undefined
     fields are skipped. An empty query always matches (shows all
     rows). */
  function matchesSearch(fields, query) {
    if (!query) return true;
    var haystack = fields.filter(function (f) { return f != null; }).join(" ").toLowerCase();
    return haystack.indexOf(query.toLowerCase()) > -1;
  }

  /* Baut eine minimale .ics-Datei fuer einen einzelnen Termin, damit er
     sich mit einem Klick in Google/Apple/Outlook-Kalender uebernehmen
     laesst. startsAt/endsAt sind ISO-Strings, alles andere optional. */
  function icsEscape(s) {
    return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  }

  function icsDate(iso) {
    return new Date(iso).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  }

  function downloadIcs(event) {
    var lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Vera Home//Vera Portal//DE",
      "BEGIN:VEVENT",
      "UID:" + (event.uid || (Math.random().toString(36).slice(2) + "@verahome.ch")),
      "DTSTAMP:" + icsDate(new Date().toISOString()),
      "DTSTART:" + icsDate(event.startsAt),
      "DTEND:" + icsDate(event.endsAt),
      "SUMMARY:" + icsEscape(event.title),
    ];
    if (event.location) lines.push("LOCATION:" + icsEscape(event.location));
    if (event.description) lines.push("DESCRIPTION:" + icsEscape(event.description));
    lines.push("END:VEVENT", "END:VCALENDAR");

    var blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = (event.title || "Termin").replace(/[^a-z0-9äöüÄÖÜ _-]/gi, "") + ".ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /* Baut eine Excel-kompatible CSV-Datei (Semikolon als Trenner, da
     Excel-DE Kommas als Dezimaltrennzeichen liest) und stoesst den
     Download an. rows ist ein Array von Arrays, header die erste
     Zeile. */
  function csvEscape(v) {
    var s = v == null ? "" : String(v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function downloadCsv(filename, header, rows) {
    var lines = [header].concat(rows).map(function (row) {
      return row.map(csvEscape).join(";");
    });
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function formatDate(iso) {
    return iso ? new Date(iso).toLocaleDateString("de-CH") : "–";
  }

  function formatDateTime(iso) {
    return iso ? new Date(iso).toLocaleString("de-CH") : "–";
  }

  function categoryLabel(c) {
    return CATEGORY_LABELS[c] || c;
  }

  function canIssueInvoices(profile, roles) {
    roles = roles || (profile ? [profile.category] : []);
    return roles.some(function (role) { return INVOICE_ISSUER_CATEGORIES.indexOf(role) > -1; });
  }

  function canManagePortal(profile) {
    return !!profile && String(profile.email || "").toLowerCase() === PORTAL_OWNER_EMAIL;
  }

  /* Eine einzige Quelle fuer die rollenabhaengige Terminroute. So zeigen
     Dock, Dashboard und PWA-Shortcut stets in dasselbe Register: Admin
     verwaltet alle Termine, Handwerker/Hauswart sehen ihren Einsatzplan,
     alle uebrigen Rollen ihren persoenlichen Kalender. */
  function appointmentHref(profile, roles) {
    roles = roles || (profile ? [profile.category] : []);
    if (profile && profile.category === "admin") return "/portal/admin/termine.html";
    if (roles.indexOf("handwerker") > -1 || roles.indexOf("hauswart") > -1) {
      return "/portal/my-appointments.html";
    }
    return "/portal/calendar.html";
  }

  async function logDocumentAccess(bucket, path, action) {
    if (!bucket || !path || !window.VeraPortal) return;
    try {
      var client = VeraPortal.getClient();
      if (!client) return;
      await client.rpc("log_document_access", {
        p_bucket: bucket,
        p_file_path: path,
        p_action: action || "open"
      });
    } catch (e) {
      /* Logging darf das Öffnen nicht blockieren. RLS/Storage bleibt die eigentliche Zugriffskontrolle. */
    }
  }

  async function openSignedDocument(bucket, path, expiresIn) {
    /* iOS blockiert window.open(), sobald davor ein await lag, weil der
       Aufruf dann nicht mehr zum urspruenglichen Tap gehoert. Das leere
       Ziel wird deshalb synchron geoeffnet und nach Erhalt der
       kurzlebigen URL weitergeleitet. Falls der Browser es dennoch
       blockiert, navigieren wir verlaesslich im aktuellen Fenster. */
    var targetWindow = null;
    try {
      targetWindow = window.open("", "_blank");
      if (targetWindow) targetWindow.opener = null;
    } catch (e) {
      targetWindow = null;
    }
    try {
      await logDocumentAccess(bucket, path, "open");
      var res = await VeraPortal.getClient().storage.from(bucket).createSignedUrl(path, expiresIn || 60);
      if (!res.error && res.data && res.data.signedUrl) {
        if (targetWindow) targetWindow.location.replace(res.data.signedUrl);
        else window.location.assign(res.data.signedUrl);
      } else {
        if (targetWindow) targetWindow.close();
        window.alert("Dokument konnte nicht geöffnet werden: " + (res.error ? res.error.message : "Keine signierte URL erhalten."));
      }
      return res;
    } catch (error) {
      if (targetWindow) targetWindow.close();
      window.alert("Dokument konnte nicht geöffnet werden: " + (error.message || error));
      return { error: error };
    }
  }

  function rolesOverlap(itemRoles, roles) {
    return itemRoles.some(function (r) { return roles.indexOf(r) > -1; });
  }

  function navItemVisibleForProfile(item, profile, roles) {
    if (item.portalOwnerOnly && !canManagePortal(profile)) return false;
    return !item.roles || rolesOverlap(item.roles, roles);
  }

  function navActiveKey(activeKey) {
    return NAV_ACTIVE_KEY_MAP[activeKey] || activeKey;
  }

  function renderNavGroup(group, activeKey, roles, profile) {
    var currentKey = navActiveKey(activeKey);
    var itemsHtml = group.items.filter(function (item) {
      return navItemVisibleForProfile(item, profile, roles);
    }).map(function (item) {
      var inner = item.label;
      if (BADGE_SECTIONS.indexOf(item.key) > -1) {
        inner =
          '<span class="dash-nav-label">' + item.label + "</span>" +
          '<span class="dash-nav-badge" data-badge-for="' + item.key + '" hidden></span>';
      }
      return (
        '<a class="dash-nav-link' + (item.key === currentKey ? " active" : "") + '" data-nav-key="' +
        item.key + '" href="' + item.href + '">' + inner + "</a>"
      );
    }).join("");
    return (group.label ? '<span class="dash-nav-section-label">' + group.label + "</span>" : "") + itemsHtml;
  }

  function portalNavDefaults(profile, roles) {
    profile = profile || { category: "admin" };
    roles = roles || [profile.category];
    var items = [];
    NAV_GROUPS.forEach(function (group) {
      group.items.forEach(function (item) {
        if (navItemVisibleForProfile(item, profile, roles)) items.push(Object.assign({ group: group.label || "Hauptnavigation" }, item));
      });
    });
    if (profile.category === "admin" && !ADMIN_NAV_GROUP.hiddenFromMainNav) {
      ADMIN_NAV_GROUP.items.forEach(function (item) { items.push(Object.assign({ group: ADMIN_NAV_GROUP.label }, item)); });
    }
    if (!SERVICES_NAV_GROUP.hiddenFromMainNav) {
      SERVICES_NAV_GROUP.items.forEach(function (item) {
        if (navItemVisibleForProfile(item, profile, roles)) items.push(Object.assign({ group: SERVICES_NAV_GROUP.label }, item));
      });
    }
    return items.map(function (item) {
      return { key: item.key, href: item.href, label: item.label, group: item.group, visible: true };
    });
  }

  function applyPortalUiSettingsToDom(settings) {
    var byKey = {};
    ((settings && settings.navItems) || []).forEach(function (item) { byKey[item.key] = item; });
    window.__veraPortalNavItems = byKey;
    document.querySelectorAll("[data-nav-key]").forEach(function (el) {
      var item = byKey[el.getAttribute("data-nav-key")];
      if (!item) return;
      el.hidden = item.visible === false && !isPortalPreviewEditMode();
      el.classList.toggle("portal-preview-hidden-item", item.visible === false);
      var labelEl = el.querySelector(".dash-nav-label") || el.querySelector("span") || el;
      var label = item.label;
      if (item.key === "meldungen" && label === "Meldungen") label = "Anfragen";
      if (item.key === "admin-portal-editor" && label === "Portal bearbeiten") label = "Admin";
      if (item.key === "my-appointments" && label === "Terminkalender") label = "Termine";
      if (item.key === "calendar" && label === "Kalender") label = "Termine";
      if (item.label && labelEl) labelEl.textContent = label;
    });
  }

  async function loadAndApplyPortalUiSettings() {
    try {
      var client = VeraPortal.getClient();
      var res = await client.from("portal_settings").select("value").eq("key", "portal_ui_settings").maybeSingle();
      if (!res.error && res.data && res.data.value) applyPortalUiSettingsToDom(res.data.value);
      initPortalPreviewEditMode();
    } catch (e) {
      /* Portal bleibt mit Defaults bedienbar. */
      initPortalPreviewEditMode();
    }
  }

  function isPortalPreviewEditMode() {
    return new URLSearchParams(window.location.search).get("adminEdit") === "1";
  }

  function initPortalPreviewEditMode() {
    if (!isPortalPreviewEditMode() || window.__veraPortalPreviewEditReady) return;
    window.__veraPortalPreviewEditReady = true;
    document.documentElement.classList.add("portal-preview-edit-mode");
    document.addEventListener("click", function (e) {
      var nav = e.target.closest("[data-nav-key]");
      if (nav) {
        e.preventDefault();
        e.stopPropagation();
        window.parent.postMessage({
          type: "vera-portal-edit-select",
          target: "nav",
          key: nav.getAttribute("data-nav-key")
        }, window.location.origin);
        return;
      }
      var module = e.target.closest("[data-dashboard-module]");
      if (module) {
        e.preventDefault();
        e.stopPropagation();
        window.parent.postMessage({
          type: "vera-portal-edit-select",
          target: "module",
          key: module.getAttribute("data-dashboard-module")
        }, window.location.origin);
      }
    }, true);
  }

  var badgePollTimerId = null;

  /* Renders fetched counts into the sidebar's badge spans. Sections
     with 0 (or missing from the response) get hidden; others show the
     count, capped at "99+" so a badge can never visually break the
     nav row. */
  function applyBadges(counts) {
    BADGE_SECTIONS.forEach(function (section) {
      var n = (counts && counts[section]) || 0;
      // querySelectorAll, nicht -Selector: der Abschnitt hat jetzt zwei
      // Badge-Stellen im DOM (Desktop-Sidebar + mobile Tab-Leiste),
      // von denen je nach Bildschirmbreite nur eine sichtbar ist --
      // beide müssen trotzdem synchron bleiben.
      document.querySelectorAll('.dash-nav-badge[data-badge-for="' + section + '"]').forEach(function (badgeEl) {
        if (n > 0) {
          badgeEl.textContent = n > 99 ? "99+" : String(n);
          badgeEl.hidden = false;
        } else {
          badgeEl.textContent = "";
          badgeEl.hidden = true;
        }
      });
    });
  }

  /* Starts (or restarts) the sidebar's badge refresh loop: marks the
     currently active section "seen" (if it's one of the tracked ones)
     BEFORE fetching counts, so the just-visited section already reads
     0 on first paint instead of one poll cycle later. Runs once
     immediately, then every 60s for as long as the page stays open —
     this is a static multi-page site, so a full navigation (including
     logout) simply drops the interval along with everything else, no
     manual cleanup needed. Failures here are logged only; a broken
     badge fetch must never break the page around it. */
  function refreshBadges(activeKey) {
    if (badgePollTimerId) {
      clearInterval(badgePollTimerId);
      badgePollTimerId = null;
    }

    async function tick() {
      try {
        var seenKey = activeKey === "my-appointments" ? "termine" : activeKey;
        if (SEEN_TRACKED_SECTIONS.indexOf(seenKey) > -1) {
          await VeraPortal.markSectionSeen(seenKey);
        }
        var counts = await VeraPortal.getUnreadCounts();
        applyBadges(counts);
      } catch (e) {
        console.error("Badge refresh failed", e);
      }
    }

    tick();
    badgePollTimerId = setInterval(tick, 60000);
  }

  /* ============================================================
     ADMIN-SCHNELLZUGRIFF (oben rechts): Tickets-Button + Suchfeld
     über Nutzer/Objekte/Mietverhältnisse/Rechnungen/Termine hinweg.
     Nur für Admin gerendert — alle anderen Rollen sehen ohnehin nur
     ihre eigenen Daten (RLS), eine übergreifende Suche wäre für sie
     nutzlos. Als fixes Element in document.body statt in einer
     Page-spezifischen HTML-Datei, damit es automatisch auf jeder
     Admin-Seite erscheint, ohne jede Datei einzeln anzupassen.
  ============================================================ */
  var GLOBAL_SEARCH_GROUP_LABEL = { users: "Kontakte", properties: "Objekte", tenancies: "Mietverhältnisse", invoices: "Rechnungen" };
  var GLOBAL_SEARCH_GROUP_ORDER = ["users", "properties", "tenancies", "invoices"];

  function globalSearchPattern(q) {
    return "%" + q.replace(/[%,]/g, "") + "%";
  }

  async function runGlobalSearch(q) {
    var client = VeraPortal.getClient();
    var pattern = globalSearchPattern(q);
    var results = { users: [], properties: [], tenancies: [], invoices: [] };

    var usersRes = await client.from("profiles")
      .select("id, first_name, last_name, email, category")
      .neq("category", "admin")
      .is("archived_at", null)
      .or("first_name.ilike." + pattern + ",last_name.ilike." + pattern + ",email.ilike." + pattern)
      .limit(5);
    results.users = (usersRes.data || []).map(function (p) {
      var name = p.first_name + " " + p.last_name;
      return { label: name, meta: categoryLabel(p.category) + " · " + p.email, href: "/portal/admin/users.html?q=" + encodeURIComponent(name) };
    });

    var propsRes = await client.from("properties")
      .select("id, label, street, city")
      .is("archived_at", null)
      .or("label.ilike." + pattern + ",street.ilike." + pattern + ",city.ilike." + pattern)
      .limit(5);
    results.properties = (propsRes.data || []).map(function (p) {
      return { label: p.label, meta: [p.street, p.city].filter(Boolean).join(", "), href: "/portal/admin/properties.html?q=" + encodeURIComponent(p.label) };
    });

    var tenanciesRes = await client.from("tenancies")
      .select("id, status, tenant:profiles!tenant_profile_id!inner(first_name, last_name)")
      .is("archived_at", null)
      .or("first_name.ilike." + pattern + ",last_name.ilike." + pattern, { foreignTable: "tenant" })
      .limit(5);
    results.tenancies = (tenanciesRes.data || []).map(function (t) {
      var name = t.tenant ? (t.tenant.first_name + " " + t.tenant.last_name) : "Unbekannt";
      return { label: name, meta: t.status, href: "/portal/admin/tenancies.html?q=" + encodeURIComponent(name) };
    });

    var invByNumberRes = await client.from("invoices")
      .select("id, invoice_number, status")
      .ilike("invoice_number", pattern)
      .is("archived_at", null)
      .limit(5);
    var invByRecipientRes = await client.from("invoices")
      .select("id, invoice_number, status, recipient:profiles!recipient_profile_id!inner(first_name, last_name)")
      .or("first_name.ilike." + pattern + ",last_name.ilike." + pattern, { foreignTable: "recipient" })
      .is("archived_at", null)
      .limit(5);
    var seenInvIds = {};
    (invByNumberRes.data || []).forEach(function (inv) {
      seenInvIds[inv.id] = true;
      results.invoices.push({ label: inv.invoice_number || "Rechnung", meta: inv.status, href: "/portal/invoices.html?q=" + encodeURIComponent(inv.invoice_number || "") });
    });
    (invByRecipientRes.data || []).forEach(function (inv) {
      if (seenInvIds[inv.id]) return;
      seenInvIds[inv.id] = true;
      var name = inv.recipient ? (inv.recipient.first_name + " " + inv.recipient.last_name) : "";
      results.invoices.push({ label: inv.invoice_number || "Rechnung", meta: name, href: "/portal/invoices.html?q=" + encodeURIComponent(name) });
    });
    results.invoices = results.invoices.slice(0, 5);

    return results;
  }

  function renderGlobalSearchResults(container, results, query) {
    var html = "";
    GLOBAL_SEARCH_GROUP_ORDER.forEach(function (key) {
      if (!results[key].length) return;
      html += '<span class="admin-quickbar-group-label">' + GLOBAL_SEARCH_GROUP_LABEL[key] + "</span>";
      html += results[key].map(function (r) {
        return '<a class="admin-quickbar-result-item" href="' + r.href + '">' +
          escapeHtml(r.label) +
          (r.meta ? '<span class="admin-quickbar-result-meta">' + escapeHtml(r.meta) + "</span>" : "") +
          "</a>";
      }).join("");
    });
    html += '<span class="admin-quickbar-group-label">Termine</span>' +
      '<a class="admin-quickbar-result-item" href="/portal/admin/termine.html?q=' + encodeURIComponent(query) + '">' +
        'In Terminen suchen: "' + escapeHtml(query) + '"' +
      "</a>";
    container.innerHTML = html;
  }

  function initAdminGlobalSearch() {
    var input = document.getElementById("adminGlobalSearch");
    var resultsEl = document.getElementById("adminGlobalSearchResults");
    var debounceId = null;

    input.addEventListener("input", function () {
      var q = input.value.trim();
      if (debounceId) clearTimeout(debounceId);
      if (q.length < 2) { resultsEl.hidden = true; return; }
      debounceId = setTimeout(async function () {
        var results = await runGlobalSearch(q);
        renderGlobalSearchResults(resultsEl, results, q);
        resultsEl.hidden = false;
      }, 300);
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".admin-quickbar-search")) resultsEl.hidden = true;
    });
  }

  var TICKETS_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z"/>' +
    '<path d="M13 6v12" stroke-dasharray="2 2"/>' +
    "</svg>";

  var MOBILE_DOCK_ICONS = {
    dashboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M9.5 20v-6h5v6"/></svg>',
    objects: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V7l8-4 8 4v14"/><path d="M8 10h2m4 0h2m-8 4h2m4 0h2M9 21v-4h6v4"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4m8-4v4M3 10h18"/><path d="M8 14h3m2 0h3m-8 3h3"/></svg>',
    documents: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6m-6 4h6"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>'
  };

  function renderMobileDock(activeKey, profile, roles, openMenu) {
    var oldDock = document.getElementById("dashMobileDock");
    if (oldDock) oldDock.remove();

    var hasRole = function (role) { return roles.indexOf(role) > -1; };
    var objectItem = profile.category === "admin"
      ? { key: "admin-properties", href: "/portal/admin/properties.html", label: "Objekte" }
      : hasRole("eigentuemer")
        ? { key: "owner-report", href: "/portal/owner-report.html", label: "Objekte" }
        : { key: "meldungen", href: "/portal/meldungen.html", label: "Anfragen", badge: "meldungen" };
    var appointmentItem = profile.category === "admin"
      ? { key: "termine", href: appointmentHref(profile, roles), label: "Termine", badge: "termine" }
      : (hasRole("handwerker") || hasRole("hauswart"))
        ? { key: "my-appointments", href: appointmentHref(profile, roles), label: "Termine", badge: "termine" }
        : { key: "calendar", href: appointmentHref(profile, roles), label: "Termine", badge: "calendar" };
    var items = [
      { key: "dashboard", href: "/portal/dashboard.html", label: "Übersicht", icon: "dashboard" },
      Object.assign({ icon: "objects" }, objectItem),
      Object.assign({ icon: "calendar" }, appointmentItem),
      { key: "documents", href: "/portal/documents.html", label: "Dateien", icon: "documents", badge: "documents" }
    ];
    var currentKey = navActiveKey(activeKey);
    var hasPrimaryActive = items.some(function (item) { return navActiveKey(item.key) === currentKey; });

    var dock = document.createElement("nav");
    dock.id = "dashMobileDock";
    dock.className = "dash-mobile-dock";
    dock.setAttribute("aria-label", "Schnellnavigation");
    dock.innerHTML = items.map(function (item) {
      var active = navActiveKey(item.key) === currentKey;
      return '<a class="dash-mobile-dock-item' + (active ? ' active' : '') + '" href="' + item.href + '"' +
        (active ? ' aria-current="page"' : '') + '>' + MOBILE_DOCK_ICONS[item.icon] +
        '<span>' + item.label + '</span>' +
        (item.badge ? '<span class="dash-nav-badge dash-mobile-dock-badge" data-badge-for="' + item.badge + '" hidden></span>' : '') +
      '</a>';
    }).join("") +
      '<button type="button" class="dash-mobile-dock-item' + (!hasPrimaryActive ? ' active' : '') + '" id="dashMobileMore" aria-label="Weitere Bereiche öffnen">' +
        MOBILE_DOCK_ICONS.more + '<span>Mehr</span></button>';
    document.body.appendChild(dock);

    document.getElementById("dashMobileMore").addEventListener("click", function () {
      openMenu(true);
    });
  }

  /* Hamburger-Menü auf Mobile (nur sichtbar ≤900px, siehe
     portal-dashboard.css) -- ersetzt die vorherige untere Tab-Leiste.
     Icon-Button in der schlanken Portal-Kopfzeile (#navbar
     .nav-inner--portal) öffnet ein von rechts einschiebendes Drawer
     mit derselben Nav-Liste wie die Desktop-Sidebar (linksHtml wird
     von renderSidebar() übergeben, nicht zweimal aufgebaut) plus
     Logout am Ende. Gleiche Slide-in-Mechanik und Scroll-Lock-Klasse
     wie das Marketing-Menü (siehe .nav-links in styles.css /
     public/js/nav.js), nur mit Portal-Inhalt. */
  function renderMobileMenu(activeKey, profile, roles, linksHtml) {
    var header = document.querySelector("#navbar .nav-inner--portal");
    if (!header) return;

    var existingToggle = document.getElementById("dashMenuToggle");
    if (existingToggle) existingToggle.remove();
    var existingOverlay = document.getElementById("dashMobileMenuOverlay");
    if (existingOverlay) existingOverlay.remove();
    var existingMenu = document.getElementById("dashMobileMenu");
    if (existingMenu) existingMenu.remove();

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.id = "dashMenuToggle";
    toggle.className = "nav-toggle";
    toggle.setAttribute("aria-label", "Menü öffnen");
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = "<span></span><span></span><span></span>";
    header.appendChild(toggle);

    var overlay = document.createElement("div");
    overlay.id = "dashMobileMenuOverlay";
    overlay.className = "dash-mobile-menu-overlay";

    var roleLabel = roles.map(categoryLabel).join(", ");
    var menu = document.createElement("nav");
    menu.id = "dashMobileMenu";
    menu.className = "dash-mobile-menu";
    menu.setAttribute("aria-label", "Hauptnavigation");
    menu.innerHTML =
      '<div class="dash-mobile-menu-header">' +
      '<button type="button" class="dash-mobile-menu-close" id="dashMobileMenuClose" aria-label="Menü schliessen">×</button>' +
      '<span class="dash-mobile-menu-name">' + escapeHtml(profile.first_name) + "</span>" +
      '<span class="status-badge ' + profile.status + '">' + escapeHtml(roleLabel) + "</span>" +
      "</div>" +
      '<div class="dash-nav">' + linksHtml + "</div>" +
      '<button type="button" class="dash-logout-btn" id="dashMobileMenuLogout">Ausloggen</button>';

    document.body.appendChild(overlay);
    document.body.appendChild(menu);

    function setOpen(open) {
      toggle.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", open);
      overlay.classList.toggle("open", open);
      menu.classList.toggle("open", open);
      document.body.classList.toggle("nav-menu-open", open);
      if (open) {
        var firstLink = menu.querySelector(".dash-nav-link");
        if (firstLink) firstLink.focus();
      } else {
        toggle.focus();
      }
    }

    toggle.addEventListener("click", function () {
      setOpen(!menu.classList.contains("open"));
    });
    overlay.addEventListener("click", function () {
      setOpen(false);
    });
    document.getElementById("dashMobileMenuClose").addEventListener("click", function () {
      setOpen(false);
    });
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menu.classList.contains("open")) setOpen(false);
    });

    document.getElementById("dashMobileMenuLogout").addEventListener("click", function () {
      VeraPortal.signOut().then(function () {
        window.location.href = "/portal/login.html";
      });
    });

    renderMobileDock(activeKey, profile, roles, setOpen);
  }

  function renderAdminQuickbar(profile) {
    if (profile.category !== "admin") return;
    if (document.getElementById("dashAdminQuickbar")) return;
    var actions = ensureTopActions();

    var bar = document.createElement("div");
    bar.id = "dashAdminQuickbar";
    bar.className = "dash-top-search-group";
    bar.innerHTML =
      '<div class="admin-quickbar-search">' +
        '<input type="text" id="adminGlobalSearch" placeholder="Alles durchsuchen (Kontakte, Objekte, Mietverhältnisse, Rechnungen, Termine) …" autocomplete="off">' +
        '<div class="admin-quickbar-results" id="adminGlobalSearchResults" hidden></div>' +
      "</div>" +
      '<a class="admin-quickbar-tickets" href="/portal/admin/tickets.html" aria-label="Tickets">' +
        TICKETS_ICON_SVG +
        '<span class="dash-nav-badge admin-quickbar-badge" data-badge-for="tickets" hidden></span>' +
      "</a>";
    actions.appendChild(bar);
    initAdminGlobalSearch();
  }

  /* Liest ?q= aus der URL (gesetzt vom Admin-Schnellzugriff-Suchfeld
     oben), trägt den Wert in das genannte, bereits vorhandene
     Such-Input der Seite ein und löst dessen normales 'input'-Event
     aus — die Seite filtert dann mit ihrer eigenen, längst bestehenden
     Logik, ganz ohne Sonderfall-Code pro Seite. */
  function applyQueryParamSearch(inputId) {
    var q = new URLSearchParams(window.location.search).get("q");
    if (!q) return;
    var input = document.getElementById(inputId);
    if (!input) return;
    input.value = q;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  var responsiveTableObserver = null;
  var responsiveTableFrame = null;

  /* Tabellen sind auf dem Desktop am schnellsten erfassbar, auf einem
     Telefon werden viele Spalten jedoch unlesbar schmal. Jede Datenzelle
     erhaelt deshalb automatisch die passende Spaltenueberschrift als
     data-label. CSS kann dieselben Zeilen anschliessend als kompakte,
     beschriftete Karten darstellen. Der Observer erfasst auch Tabellen,
     die eine Seite erst nach einem Supabase-Request rendert. */
  function enhanceResponsiveTables(root) {
    (root || document).querySelectorAll(".dash-table").forEach(function (table) {
      var headerRow = Array.prototype.slice.call(table.querySelectorAll("tr")).find(function (row) {
        return row.querySelector("th");
      });
      if (!headerRow) return;
      var labels = Array.prototype.slice.call(headerRow.querySelectorAll("th")).map(function (cell) {
        return cell.textContent.trim();
      });
      headerRow.classList.add("dash-table-header-row");
      table.querySelectorAll("tr").forEach(function (row) {
        if (row.querySelector("th")) return;
        row.classList.add("dash-table-data-row");
        Array.prototype.slice.call(row.children).forEach(function (cell, index) {
          if (cell.tagName !== "TD" || cell.hasAttribute("data-label")) return;
          cell.setAttribute("data-label", labels[index] || "");
        });
      });
      table.classList.add("dash-table-responsive-ready");
    });
  }

  function initResponsiveTables() {
    enhanceResponsiveTables(document);
    if (responsiveTableObserver || !("MutationObserver" in window)) return;
    responsiveTableObserver = new MutationObserver(function () {
      if (responsiveTableFrame) return;
      responsiveTableFrame = requestAnimationFrame(function () {
        responsiveTableFrame = null;
        enhanceResponsiveTables(document);
      });
    });
    responsiveTableObserver.observe(document.body, { childList: true, subtree: true });
  }

  function renderSidebar(activeKey, profile, roles) {
    var el = document.getElementById("dashSidebar");
    if (!el) return;
    roles = roles || [profile.category];

    var linksHtml = NAV_GROUPS.map(function (group) {
      return renderNavGroup(group, activeKey, roles, profile);
    }).join("");

    if (profile.category === "admin" && !ADMIN_NAV_GROUP.hiddenFromMainNav) {
      linksHtml += renderNavGroup(ADMIN_NAV_GROUP, activeKey, roles, profile);
    }

    if (!SERVICES_NAV_GROUP.hiddenFromMainNav) {
      linksHtml += renderNavGroup(SERVICES_NAV_GROUP, activeKey, roles, profile);
    }

    var roleLabel = roles.map(categoryLabel).join(", ");

    el.innerHTML =
      '<div class="dash-sidebar-header">' +
      '<p class="dash-sidebar-name">' + escapeHtml(profile.first_name) + "</p>" +
      '<span class="status-badge ' + profile.status + '">' + escapeHtml(roleLabel) + "</span>" +
      "</div>" +
      '<nav class="dash-nav">' + linksHtml + "</nav>" +
      '<button type="button" class="dash-logout-btn" id="dashLogoutBtn">Ausloggen</button>';

    document.getElementById("dashLogoutBtn").addEventListener("click", function () {
      VeraPortal.signOut().then(function () {
        window.location.href = "/portal/login.html";
      });
    });

    refreshBadges(activeKey);
    renderAdminQuickbar(profile);
    renderMobileMenu(activeKey, profile, roles, linksHtml);
    renderTopLogoutButton();
    if (profile.category === "admin") renderAdminPortalEditorButton(profile);
    loadAndApplyPortalUiSettings();
    initResponsiveTables();
  }

  /* Ausloggen zusätzlich oben rechtsbündig auf der Seite (Desktop) --
     die Sidebar behält ihren Button trotzdem (dort per CSS auf Mobile
     beschränkt, wo diese obere Leiste ausgeblendet ist und die
     Sidebar zum Bottom-Sheet wird). Für ALLE Rollen, nicht nur Admin
     -- anders als renderAdminQuickbar, das nur Admin sieht. */
  function ensureTopActions() {
    var actions = document.getElementById("dashTopActions");
    if (!actions) {
      actions = document.createElement("div");
      actions.id = "dashTopActions";
      actions.className = "dash-top-actions";
      document.body.appendChild(actions);
    }
    return actions;
  }

  function renderTopLogoutButton() {
    if (document.getElementById("dashLogoutTop")) return;
    var actions = ensureTopActions();
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "dashLogoutTop";
    btn.className = "dash-logout-top";
    btn.textContent = "Ausloggen";
    btn.addEventListener("click", function () {
      VeraPortal.signOut().then(function () {
        window.location.href = "/portal/login.html";
      });
    });
    actions.appendChild(btn);
  }

  async function renderAdminEmailModeSwitch(profile) {
    if (!profile || profile.category !== "admin" || document.getElementById("dashEmailModeTop")) return;
    var actions = ensureTopActions();

    var wrap = document.createElement("div");
    wrap.id = "dashEmailModeTop";
    wrap.className = "dash-email-mode-top";
    wrap.innerHTML =
      '<label class="dash-email-mode-switch">' +
      '<input type="checkbox" id="dashEmailModeToggle" aria-label="E-Mail Versand umschalten">' +
      '<span class="dash-email-mode-track" aria-hidden="true"></span>' +
      '<strong id="dashEmailModeLabel">Lädt …</strong>' +
      '</label>' +
      '<p id="dashEmailModeInfo">Aktueller Zustand wird geladen …</p>';
    actions.insertBefore(wrap, document.getElementById("dashLogoutTop"));

    var client = VeraPortal.getClient();
    var toggle = document.getElementById("dashEmailModeToggle");
    var label = document.getElementById("dashEmailModeLabel");
    var info = document.getElementById("dashEmailModeInfo");

    function applyMode(mode) {
      var isLive = mode !== "test";
      toggle.checked = isLive;
      wrap.classList.toggle("is-live", isLive);
      wrap.classList.toggle("is-test", !isLive);
      label.textContent = isLive ? "E-Mail EIN" : "E-Mail AUS";
      info.textContent = isLive
        ? "Ist-Zustand: Live-Versand aktiv. Portal-E-Mails werden versendet."
        : "Ist-Zustand: Testmodus aktiv. Portal-E-Mails werden unterdrückt.";
    }

    async function loadMode() {
      try {
        var res = await client.from("portal_settings").select("value").eq("key", "outbound_email_mode").maybeSingle();
        if (res.error) throw res.error;
        var mode = res.data && res.data.value && res.data.value.mode === "test" ? "test" : "live";
        applyMode(mode);
      } catch (err) {
        toggle.disabled = true;
        label.textContent = "Fehler";
        info.textContent = "E-Mail-Schalter konnte nicht geladen werden. SQL-Migration prüfen.";
      }
    }

    toggle.addEventListener("change", async function () {
      var mode = toggle.checked ? "live" : "test";
      toggle.disabled = true;
      info.textContent = mode === "live" ? "Live-Versand wird aktiviert …" : "Testmodus wird aktiviert …";
      var res = await client.rpc("set_portal_setting", {
        p_key: "outbound_email_mode",
        p_value: { mode: mode }
      });
      toggle.disabled = false;
      if (res.error) {
        toggle.checked = !toggle.checked;
        applyMode(toggle.checked ? "live" : "test");
        info.textContent = "Fehler: " + res.error.message;
        return;
      }
      applyMode(mode);
    });

    loadMode();
  }

  function renderAdminContentEditorButton(profile) {
    if (!profile || profile.category !== "admin" || document.getElementById("dashContentEditorTop")) return;
    var actions = ensureTopActions();
    var link = document.createElement("a");
    link.id = "dashContentEditorTop";
    link.className = "dash-content-editor-top";
    link.href = "/portal/admin/homepage-content.html";
    link.textContent = "Homepage editieren";
    actions.insertBefore(link, document.getElementById("dashEmailModeTop") || document.getElementById("dashLogoutTop"));
  }

  function renderAdminPortalEditorButton(profile) {
    if (!profile || profile.category !== "admin" || !canManagePortal(profile) || document.getElementById("dashPortalEditorTop")) return;
    var actions = ensureTopActions();
    var link = document.createElement("a");
    link.id = "dashPortalEditorTop";
    link.className = "dash-content-editor-top";
    link.href = "/portal/admin/portal-editor.html";
    link.textContent = "Portal bearbeiten";
    actions.insertBefore(link, document.getElementById("dashContentEditorTop") || document.getElementById("dashEmailModeTop") || document.getElementById("dashLogoutTop"));
  }

  /* Call once at the top of every SHARED dashboard page's inline script
     (dashboard/documents/messages/calendar). Handles the auth redirect,
     loads the profile, renders the sidebar, and resolves with
     {session, profile}. Admin-only pages should use
     VeraPortal.requireAdmin() + renderSidebar() directly instead (see
     portal/admin/*.html), since they must redirect non-admins away
     rather than just render a smaller sidebar for them. */
  async function init(activeKey) {
    var session = await VeraPortal.requireAuth();
    if (!session) return null;
    var profile = await VeraPortal.getProfile();
    if (!profile) return null;
    var roles = await fetchOwnRoles(profile);
    renderSidebar(activeKey, profile, roles);
    return { session: session, profile: profile, roles: roles };
  }

  function profileRoles(profile, additionalRoles) {
    var roles = profile.category ? [profile.category] : [];
    (additionalRoles || []).forEach(function (role) {
      if (role && roles.indexOf(role) === -1) roles.push(role);
    });
    return roles;
  }

  /* Die Primaerrolle bleibt neben allen Zusatzrollen erhalten, auch
     wenn profile_role_assignments noch nicht vollstaendig befuellt ist.
     Bei Ladefehlern bleibt die Navigation der Primaerrolle verfuegbar. */
  async function fetchOwnRoles(profile) {
    try {
      var res = await VeraPortal.getClient().from("profile_role_assignments").select("category").eq("profile_id", profile.id);
      return profileRoles(profile, res.error ? [] : (res.data || []).map(function (r) { return r.category; }));
    } catch (e) {
      return profileRoles(profile);
    }
  }

  /* Admin pickers use the union of the primary category and additional
     roles. A contact stays selectable under its primary category even
     if the role-assignment table has not been fully backfilled. */
  function profilesForRoles(profiles, assignments, allowedRoles) {
    var rolesByProfile = Object.create(null);
    (assignments || []).forEach(function (assignment) {
      if (!assignment.profile_id || !assignment.category) return;
      var roles = rolesByProfile[assignment.profile_id] || (rolesByProfile[assignment.profile_id] = []);
      if (roles.indexOf(assignment.category) === -1) roles.push(assignment.category);
    });
    var seen = new Set();
    return (profiles || []).reduce(function (rows, profile) {
      if (!profile.id || profile.archived_at || seen.has(profile.id)) return rows;
      var roles = profileRoles(profile, rolesByProfile[profile.id]);
      if (!roles.some(function (role) { return allowedRoles.indexOf(role) > -1; })) return rows;
      seen.add(profile.id);
      rows.push(Object.assign({}, profile, { roles: roles }));
      return rows;
    }, []);
  }

  async function fetchProfilesForRoles(client, allowedRoles) {
    // Read all pages: the role table can contain several rows per contact.
    async function readRows(makeQuery) {
      var rows = [];
      var pageSize = 500;
      for (var offset = 0; ; offset += pageSize) {
        var result = await makeQuery().range(offset, offset + pageSize - 1);
        if (result.error) return result;
        var page = result.data || [];
        rows = rows.concat(page);
        if (page.length < pageSize) return { data: rows, error: null };
      }
    }
    try {
      var results = await Promise.all([
        readRows(function () {
          return client.from("profiles").select("id, first_name, last_name, member_number, category, archived_at")
            .is("archived_at", null).order("last_name").order("id");
        }),
        readRows(function () {
          return client.from("profile_role_assignments").select("profile_id, category").order("profile_id").order("category");
        })
      ]);
      var error = results[0].error || results[1].error;
      if (error) return { data: [], error: error };
      return { data: profilesForRoles(results[0].data, results[1].data, allowedRoles), error: null };
    } catch (error) {
      return { data: [], error: error };
    }
  }

  return {
    init: init,
    renderSidebar: renderSidebar,
    escapeHtml: escapeHtml,
    mapEmbedHtml: mapEmbedHtml,
    matchesSearch: matchesSearch,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    categoryLabel: categoryLabel,
    canIssueInvoices: canIssueInvoices,
    canManagePortal: canManagePortal,
    appointmentHref: appointmentHref,
    logDocumentAccess: logDocumentAccess,
    openSignedDocument: openSignedDocument,
    applyQueryParamSearch: applyQueryParamSearch,
    downloadIcs: downloadIcs,
    downloadCsv: downloadCsv,
    fetchOwnRoles: fetchOwnRoles,
    profilesForRoles: profilesForRoles,
    fetchProfilesForRoles: fetchProfilesForRoles,
    renderAdminEmailModeSwitch: renderAdminEmailModeSwitch,
    renderAdminContentEditorButton: renderAdminContentEditorButton,
    renderAdminPortalEditorButton: renderAdminPortalEditorButton,
    portalNavDefaults: portalNavDefaults,
    initPortalPreviewEditMode: initPortalPreviewEditMode
  };
})();
