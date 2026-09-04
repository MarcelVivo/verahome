/* Vera Home / Vera Portal – Service Worker
   Bump CACHE_VERSION on future large asset changes so old caches get
   discarded (see activate handler below). */
const CACHE_VERSION = "vera-pwa-v12";
const STATIC_CACHE = CACHE_VERSION + "-static";
const PAGES_CACHE = CACHE_VERSION + "-pages";

const PRECACHE_URLS = [
  "/offline.html",
  "/portal/login.html",
  "/portal/dashboard.html",
  "/portal/documents.html",
  "/portal/calendar.html",
  "/portal/my-appointments.html",
  "/portal/admin/termine.html",
  "/portal/admin/properties.html",
  "/portal/admin/archive.html",
  "/portal/admin/audit-log.html",
  "/portal/admin/homepage-content.html",
  "/portal/admin/jobs.html",
  "/portal/admin/ownerships.html",
  "/portal/admin/portal-editor.html",
  "/portal/admin/tenancies.html",
  "/portal/admin/tickets.html",
  "/portal/admin/users.html",
  "/portal/admin/utility-statements.html",
  "/portal/invoice-detail.html",
  "/portal/invoices.html",
  "/portal/meldungen.html",
  "/portal/messages.html",
  "/portal/owner-report.html",
  "/portal/rapporte.html",
  "/portal/waschplan.html",
  "/public/manifest-portal.webmanifest",
  "/public/css/styles.css",
  "/public/css/portal.css",
  "/public/css/portal-dashboard.css",
  "/public/js/nav.js",
  "/public/js/portal-auth.js",
  "/public/js/portal-dashboard.js",
  "/public/js/pwa.js",
  "/public/images/icons/icon-192.png",
  "/public/images/icons/icon-512.png",
  "/public/images/logo/logo-gold.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("vera-pwa-") && key !== STATIC_CACHE && key !== PAGES_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGES_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return caches.match("/offline.html");
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || networkPromise;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isSameOrigin(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }

  if (/\.(?:css|js|png|jpg|jpeg|svg|webp|woff2?)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
