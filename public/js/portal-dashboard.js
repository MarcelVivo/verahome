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

  /* Reihenfolge in der Sidebar: (1) taegliches Geschaeft ganz oben,
     (2) Verwaltung/Stammdaten (nur Admin), (3) wiederkehrende Services
     zuunterst. Tickets ist bewusst kein Sidebar-Eintrag mehr, sondern
     ein eigener Schnellzugriff-Button oben rechts (siehe
     renderAdminQuickbar) — Julia braucht ihn haeufig genug, dass ein
     Klick weniger Weg spart. */
  var NAV_GROUPS = [
    { label: null, items: [
      { key: "dashboard", href: "/portal/dashboard.html", label: "Übersicht" },
      { key: "termine", href: "/portal/admin/termine.html", label: "Termine", roles: ["admin"] },
      { key: "my-appointments", href: "/portal/my-appointments.html", label: "Terminkalender", roles: ["handwerker", "hauswart"] },
      { key: "calendar", href: "/portal/calendar.html", label: "Kalender", roles: ["mieter", "eigentuemer", "partner", "firma", "aemter"] },
      { key: "documents", href: "/portal/documents.html", label: "Dokumente" },
      { key: "messages", href: "/portal/messages.html", label: "Nachrichten" }
    ]}
  ];
  var ADMIN_NAV_GROUP = { label: "Verwaltung", items: [
    { key: "admin-properties", href: "/portal/admin/properties.html", label: "Objekte" },
    { key: "admin-users", href: "/portal/admin/users.html", label: "Kontakte" },
    { key: "admin-tenancies", href: "/portal/admin/tenancies.html", label: "Mietverhältnisse" },
    { key: "admin-ownerships", href: "/portal/admin/ownerships.html", label: "Eigentümerschaften" },
    { key: "admin-jobs", href: "/portal/admin/jobs.html", label: "Aufträge" },
    { key: "admin-utility-statements", href: "/portal/admin/utility-statements.html", label: "Nebenkosten" }
  ]};
  var SERVICES_NAV_GROUP = { label: "Services", items: [
    { key: "meldungen", href: "/portal/meldungen.html", label: "Meldungen" },
    { key: "invoices", href: "/portal/invoices.html", label: "Buchhaltung" },
    { key: "rapporte", href: "/portal/rapporte.html", label: "Rapporte", roles: ["hauswart", "admin"] },
    { key: "waschplan", href: "/portal/waschplan.html", label: "Waschpläne" }
  ]};
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

  function formatDate(iso) {
    return iso ? new Date(iso).toLocaleDateString("de-CH") : "–";
  }

  function formatDateTime(iso) {
    return iso ? new Date(iso).toLocaleString("de-CH") : "–";
  }

  function categoryLabel(c) {
    return CATEGORY_LABELS[c] || c;
  }

  function canIssueInvoices(profile) {
    return INVOICE_ISSUER_CATEGORIES.indexOf(profile.category) > -1;
  }

  function renderNavGroup(group, activeKey, category) {
    var itemsHtml = group.items.filter(function (item) {
      return !item.roles || item.roles.indexOf(category) > -1;
    }).map(function (item) {
      var inner = item.label;
      if (BADGE_SECTIONS.indexOf(item.key) > -1) {
        inner =
          '<span class="dash-nav-label">' + item.label + "</span>" +
          '<span class="dash-nav-badge" data-badge-for="' + item.key + '" hidden></span>';
      }
      return (
        '<a class="dash-nav-link' + (item.key === activeKey ? " active" : "") + '" data-nav-key="' +
        item.key + '" href="' + item.href + '">' + inner + "</a>"
      );
    }).join("");
    return (group.label ? '<span class="dash-nav-section-label">' + group.label + "</span>" : "") + itemsHtml;
  }

  var badgePollTimerId = null;

  /* Renders fetched counts into the sidebar's badge spans. Sections
     with 0 (or missing from the response) get hidden; others show the
     count, capped at "99+" so a badge can never visually break the
     nav row. */
  function applyBadges(counts) {
    BADGE_SECTIONS.forEach(function (section) {
      var badgeEl = document.querySelector('.dash-nav-badge[data-badge-for="' + section + '"]');
      if (!badgeEl) return;
      var n = (counts && counts[section]) || 0;
      if (n > 0) {
        badgeEl.textContent = n > 99 ? "99+" : String(n);
        badgeEl.hidden = false;
      } else {
        badgeEl.textContent = "";
        badgeEl.hidden = true;
      }
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
        if (SEEN_TRACKED_SECTIONS.indexOf(activeKey) > -1) {
          await VeraPortal.markSectionSeen(activeKey);
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
      .or("first_name.ilike." + pattern + ",last_name.ilike." + pattern + ",email.ilike." + pattern)
      .limit(5);
    results.users = (usersRes.data || []).map(function (p) {
      var name = p.first_name + " " + p.last_name;
      return { label: name, meta: categoryLabel(p.category) + " · " + p.email, href: "/portal/admin/users.html?q=" + encodeURIComponent(name) };
    });

    var propsRes = await client.from("properties")
      .select("id, label, street, city")
      .or("label.ilike." + pattern + ",street.ilike." + pattern + ",city.ilike." + pattern)
      .limit(5);
    results.properties = (propsRes.data || []).map(function (p) {
      return { label: p.label, meta: [p.street, p.city].filter(Boolean).join(", "), href: "/portal/admin/properties.html?q=" + encodeURIComponent(p.label) };
    });

    var tenanciesRes = await client.from("tenancies")
      .select("id, status, tenant:profiles!tenant_profile_id!inner(first_name, last_name)")
      .or("first_name.ilike." + pattern + ",last_name.ilike." + pattern, { foreignTable: "tenant" })
      .limit(5);
    results.tenancies = (tenanciesRes.data || []).map(function (t) {
      var name = t.tenant ? (t.tenant.first_name + " " + t.tenant.last_name) : "Unbekannt";
      return { label: name, meta: t.status, href: "/portal/admin/tenancies.html?q=" + encodeURIComponent(name) };
    });

    var invByNumberRes = await client.from("invoices")
      .select("id, invoice_number, status")
      .ilike("invoice_number", pattern)
      .limit(5);
    var invByRecipientRes = await client.from("invoices")
      .select("id, invoice_number, status, recipient:profiles!recipient_profile_id!inner(first_name, last_name)")
      .or("first_name.ilike." + pattern + ",last_name.ilike." + pattern, { foreignTable: "recipient" })
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

  /* Icon-Set nur für die untere Tab-Leiste auf Mobile (siehe
     renderBottomTabBar) — deckt exakt die Keys ab, die in
     NAV_GROUPS[0] vorkommen können, plus "mehr" für den Sheet-Toggle.
     Gleicher Stroke-Stil wie TICKETS_ICON_SVG, damit es zusammenpasst. */
  var TABBAR_ICON_SVG = {
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    termine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    "my-appointments": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    documents: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/></svg>',
    messages: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H8l-4 4V5Z"/></svg>',
    mehr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>'
  };

  /* Untere Tab-Leiste (nur sichtbar ≤900px, siehe portal-dashboard.css)
     — zeigt exakt die Items aus NAV_GROUPS[0] ("tägliches Geschäft"),
     rollen-gefiltert wie renderNavGroup, plus einen "Mehr"-Tab. Da pro
     Rolle max. eines von termine/my-appointments/calendar sichtbar ist,
     sind es für jede Rolle höchstens 4 Items + Mehr — passt immer in
     eine Tab-Leiste, ohne Kürzen. "Mehr" öffnet die bestehende
     #dashSidebar (bei ≤900px per CSS zum Bottom-Sheet umgestylt) statt
     eine zweite Nav-Darstellung zu pflegen. */
  function renderBottomTabBar(activeKey, profile) {
    var existing = document.getElementById("dashTabbar");
    if (existing) existing.remove();

    var items = NAV_GROUPS[0].items.filter(function (item) {
      return !item.roles || item.roles.indexOf(profile.category) > -1;
    });

    var bar = document.createElement("nav");
    bar.id = "dashTabbar";
    bar.className = "dash-tabbar";
    bar.setAttribute("aria-label", "Hauptnavigation");
    bar.innerHTML = items.map(function (item) {
      return '<a class="dash-tab' + (item.key === activeKey ? " active" : "") + '" href="' + item.href + '">' +
        (TABBAR_ICON_SVG[item.key] || "") +
        '<span>' + escapeHtml(item.label) + "</span>" +
      "</a>";
    }).join("") +
      '<button type="button" class="dash-tab" id="dashTabMore">' + TABBAR_ICON_SVG.mehr + "<span>Mehr</span></button>";

    document.body.appendChild(bar);

    var backdrop = document.getElementById("dashSidebarBackdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = "dashSidebarBackdrop";
      document.body.appendChild(backdrop);
    }

    function closeSheet() {
      document.getElementById("dashSidebar").classList.remove("mobile-open");
      backdrop.classList.remove("show");
    }
    function toggleSheet() {
      document.getElementById("dashSidebar").classList.toggle("mobile-open");
      backdrop.classList.toggle("show");
    }

    document.getElementById("dashTabMore").addEventListener("click", toggleSheet);
    backdrop.addEventListener("click", closeSheet);
  }

  function renderAdminQuickbar(profile) {
    if (profile.category !== "admin") return;
    if (document.getElementById("dashAdminQuickbar")) return;

    var bar = document.createElement("div");
    bar.id = "dashAdminQuickbar";
    bar.innerHTML =
      '<div class="admin-quickbar-search">' +
        '<input type="text" id="adminGlobalSearch" placeholder="Alles durchsuchen (Kontakte, Objekte, Mietverhältnisse, Rechnungen, Termine) …" autocomplete="off">' +
        '<div class="admin-quickbar-results" id="adminGlobalSearchResults" hidden></div>' +
      "</div>" +
      '<a class="admin-quickbar-tickets" href="/portal/admin/tickets.html" aria-label="Tickets">' +
        TICKETS_ICON_SVG +
        '<span class="dash-nav-badge admin-quickbar-badge" data-badge-for="tickets" hidden></span>' +
      "</a>";
    document.body.appendChild(bar);
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

  function renderSidebar(activeKey, profile) {
    var el = document.getElementById("dashSidebar");
    if (!el) return;

    var linksHtml = NAV_GROUPS.map(function (group) {
      return renderNavGroup(group, activeKey, profile.category);
    }).join("");

    if (profile.category === "admin") {
      linksHtml += renderNavGroup(ADMIN_NAV_GROUP, activeKey, profile.category);
    }

    linksHtml += renderNavGroup(SERVICES_NAV_GROUP, activeKey, profile.category);

    el.innerHTML =
      '<div class="dash-sidebar-header">' +
      '<p class="dash-sidebar-name">' + escapeHtml(profile.first_name) + "</p>" +
      '<span class="status-badge ' + profile.status + '">' + escapeHtml(categoryLabel(profile.category)) + "</span>" +
      '<button type="button" class="dash-sidebar-close" id="dashSidebarClose" aria-label="Schliessen">✕</button>' +
      "</div>" +
      '<nav class="dash-nav">' + linksHtml + "</nav>" +
      '<button type="button" class="dash-logout-btn" id="dashLogoutBtn">Ausloggen</button>';

    document.getElementById("dashLogoutBtn").addEventListener("click", function () {
      VeraPortal.signOut().then(function () {
        window.location.href = "/portal/login.html";
      });
    });
    document.getElementById("dashSidebarClose").addEventListener("click", function () {
      el.classList.remove("mobile-open");
      var backdrop = document.getElementById("dashSidebarBackdrop");
      if (backdrop) backdrop.classList.remove("show");
    });

    refreshBadges(activeKey);
    renderAdminQuickbar(profile);
    renderBottomTabBar(activeKey, profile);
    renderTopLogoutButton();
  }

  /* Ausloggen zusätzlich oben rechtsbündig auf der Seite (Desktop) --
     die Sidebar behält ihren Button trotzdem (dort per CSS auf Mobile
     beschränkt, wo diese obere Leiste ausgeblendet ist und die
     Sidebar zum Bottom-Sheet wird). Für ALLE Rollen, nicht nur Admin
     -- anders als renderAdminQuickbar, das nur Admin sieht. */
  function renderTopLogoutButton() {
    if (document.getElementById("dashLogoutTop")) return;
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
    document.body.appendChild(btn);
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
    renderSidebar(activeKey, profile);
    return { session: session, profile: profile };
  }

  return {
    init: init,
    renderSidebar: renderSidebar,
    escapeHtml: escapeHtml,
    matchesSearch: matchesSearch,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    categoryLabel: categoryLabel,
    canIssueInvoices: canIssueInvoices,
    applyQueryParamSearch: applyQueryParamSearch
  };
})();
