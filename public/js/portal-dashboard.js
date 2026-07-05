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

  /* Reihenfolge in der Sidebar bewusst: (1) taegliches Geschaeft ganz
     oben, mit dem Terminkalender zuoberst, (2) Verwaltung/Stammdaten
     (nur Admin), (3) wiederkehrende Services zuunterst. */
  var NAV_GROUPS = [
    { label: null, items: [
      { key: "termine", href: "/portal/admin/termine.html", label: "Termine", roles: ["admin"] },
      { key: "my-appointments", href: "/portal/my-appointments.html", label: "Terminkalender", roles: ["handwerker", "hauswart"] },
      { key: "dashboard", href: "/portal/dashboard.html", label: "Übersicht" },
      { key: "calendar", href: "/portal/calendar.html", label: "Kalender" },
      { key: "documents", href: "/portal/documents.html", label: "Dokumente" },
      { key: "messages", href: "/portal/messages.html", label: "Nachrichten" }
    ]}
  ];
  var ADMIN_NAV_GROUP = { label: "Verwaltung", items: [
    { key: "admin-users", href: "/portal/admin/users.html", label: "Nutzer" },
    { key: "admin-properties", href: "/portal/admin/properties.html", label: "Objekte" },
    { key: "admin-tenancies", href: "/portal/admin/tenancies.html", label: "Mietverhältnisse" },
    { key: "admin-utility-statements", href: "/portal/admin/utility-statements.html", label: "Nebenkosten" },
    { key: "tickets", href: "/portal/admin/tickets.html", label: "Tickets" }
  ]};
  var SERVICES_NAV_GROUP = { label: "Services", items: [
    { key: "meldungen", href: "/portal/meldungen.html", label: "Meldungen" },
    { key: "invoices", href: "/portal/invoices.html", label: "Rechnungen" },
    { key: "waschplan", href: "/portal/waschplan.html", label: "Waschplan" },
    { key: "rapporte", href: "/portal/rapporte.html", label: "Rapporte", roles: ["hauswart", "admin"] }
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
      "</div>" +
      '<nav class="dash-nav">' + linksHtml + "</nav>" +
      '<button type="button" class="dash-logout-btn" id="dashLogoutBtn">Ausloggen</button>';

    document.getElementById("dashLogoutBtn").addEventListener("click", function () {
      VeraPortal.signOut().then(function () {
        window.location.href = "/portal/login.html";
      });
    });

    refreshBadges(activeKey);
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
    canIssueInvoices: canIssueInvoices
  };
})();
