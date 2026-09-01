/* Registriert den Service Worker und zeigt im Portal ein dauerhaftes
   Install-Icon oben links in der Kopfzeile (nur mobil, siehe
   .pwa-install-icon in portal.css) statt eines wegklickbaren Banners --
   immer verfügbar, aber nicht aufdringlich. Läuft innerhalb der
   Capacitor-iOS-Hülle absichtlich nicht (dort gibt es keinen Browser-
   Chrome zu "installieren" und ein SW im nativen WebView-Kontext bringt
   nur Risiko ohne Nutzen). */
(function () {
  if (window.Capacitor) return;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }

  var isPortal = location.pathname.indexOf("/portal/") === 0;
  if (!isPortal) return;

  var isStandalone =
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (isStandalone) return;

  var header = document.querySelector("#navbar .nav-inner--portal");
  if (!header) return;

  var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var deferredPrompt = null;

  var DOWNLOAD_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 3v11m0 0-4-4m4 4 4-4"/>' +
    '<path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>' +
    "</svg>";

  var icon = document.createElement("button");
  icon.type = "button";
  icon.id = "pwaInstallIcon";
  icon.className = "pwa-install-icon";
  icon.setAttribute("aria-label", "App installieren");
  icon.innerHTML = DOWNLOAD_ICON_SVG;
  header.appendChild(icon);

  function showTip(text) {
    var existing = document.getElementById("pwaInstallTip");
    if (existing) existing.remove();
    var tip = document.createElement("div");
    tip.id = "pwaInstallTip";
    tip.className = "pwa-install-tip";
    tip.textContent = text;
    document.body.appendChild(tip);
    window.setTimeout(function () {
      tip.classList.add("open");
    }, 10);
    function close() {
      tip.classList.remove("open");
      window.setTimeout(function () {
        tip.remove();
      }, 250);
      document.removeEventListener("click", onOutsideClick, true);
    }
    function onOutsideClick(e) {
      if (e.target !== icon && !tip.contains(e.target)) close();
    }
    window.setTimeout(function () {
      document.addEventListener("click", onOutsideClick, true);
    }, 10);
    window.setTimeout(close, 6000);
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
  });

  icon.addEventListener("click", function () {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt = null;
      return;
    }
    if (isIos) {
      showTip('Zum Home-Bildschirm hinzufügen: Teilen-Symbol → „Zum Home-Bildschirm“.');
      return;
    }
    showTip("App über das Browser-Menü zum Home-Bildschirm hinzufügen.");
  });
})();
