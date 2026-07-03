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

  var NAV_GROUPS = [
    { label: null, items: [
      { key: "dashboard", href: "/portal/dashboard.html", label: "Übersicht" },
      { key: "documents", href: "/portal/documents.html", label: "Dokumente" },
      { key: "messages", href: "/portal/messages.html", label: "Nachrichten" },
      { key: "calendar", href: "/portal/calendar.html", label: "Kalender" }
    ]},
    { label: "Services", items: [
      { key: "meldungen", href: "/portal/meldungen.html", label: "Meldungen" },
      { key: "invoices", href: "/portal/invoices.html", label: "Rechnungen" },
      { key: "waschplan", href: "/portal/waschplan.html", label: "Waschplan" }
    ]}
  ];
  var ADMIN_NAV_GROUP = { label: "Verwaltung", items: [
    { key: "admin-users", href: "/portal/admin/users.html", label: "Nutzer" },
    { key: "admin-properties", href: "/portal/admin/properties.html", label: "Objekte" },
    { key: "admin-tenancies", href: "/portal/admin/tenancies.html", label: "Mietverhältnisse" },
    { key: "admin-utility-statements", href: "/portal/admin/utility-statements.html", label: "Nebenkosten" }
  ]};
  var INVOICE_ISSUER_CATEGORIES = ["admin", "partner", "handwerker", "aemter"];
  var CATEGORY_LABELS = {
    mieter: "Mieter",
    eigentuemer: "Eigentümer",
    partner: "Partner",
    handwerker: "Handwerker",
    firma: "Firma",
    aemter: "Ämter",
    admin: "Admin"
  };

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
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

  function renderNavGroup(group, activeKey) {
    var itemsHtml = group.items.map(function (item) {
      return (
        '<a class="dash-nav-link' + (item.key === activeKey ? " active" : "") + '" href="' +
        item.href + '">' + item.label + "</a>"
      );
    }).join("");
    return (group.label ? '<span class="dash-nav-section-label">' + group.label + "</span>" : "") + itemsHtml;
  }

  function renderSidebar(activeKey, profile) {
    var el = document.getElementById("dashSidebar");
    if (!el) return;

    var linksHtml = NAV_GROUPS.map(function (group) {
      return renderNavGroup(group, activeKey);
    }).join("");

    if (profile.category === "admin") {
      linksHtml += renderNavGroup(ADMIN_NAV_GROUP, activeKey);
    }

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
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    categoryLabel: categoryLabel,
    canIssueInvoices: canIssueInvoices
  };
})();
