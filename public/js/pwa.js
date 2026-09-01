/* Registriert den Service Worker und zeigt im Portal einen dezenten,
   dauerhaft wegklickbaren "Zum Home-Bildschirm hinzufügen"-Hinweis.
   Läuft innerhalb der Capacitor-iOS-Hülle absichtlich nicht (dort gibt
   es keinen Browser-Chrome zu "installieren" und ein SW im nativen
   WebView-Kontext bringt nur Risiko ohne Nutzen). */
(function () {
  if (window.Capacitor) return;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }

  var isPortal = location.pathname.indexOf("/portal/") === 0;
  if (!isPortal) return;

  var DISMISS_KEY = "vera-portal-install-dismissed";
  if (localStorage.getItem(DISMISS_KEY)) return;

  var isStandalone =
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (isStandalone) return;

  var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var deferredPrompt = null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    var banner = document.getElementById("pwaInstallBanner");
    if (banner) banner.remove();
  }

  function showBanner(onInstallClick) {
    if (document.getElementById("pwaInstallBanner")) return;
    var banner = document.createElement("div");
    banner.id = "pwaInstallBanner";
    banner.className = "pwa-install-banner";
    banner.innerHTML =
      '<span class="pwa-install-banner-text"></span>' +
      '<button type="button" class="pwa-install-banner-action">Installieren</button>' +
      '<button type="button" class="pwa-install-banner-dismiss" aria-label="Schliessen">&times;</button>';
    banner.querySelector(".pwa-install-banner-text").textContent = onInstallClick
      ? "Vera Portal zum Home-Bildschirm hinzufügen für schnelleren Zugriff."
      : "Zum Home-Bildschirm hinzufügen: Teilen-Symbol → „Zum Home-Bildschirm“.";
    var actionBtn = banner.querySelector(".pwa-install-banner-action");
    if (onInstallClick) {
      actionBtn.addEventListener("click", function () {
        onInstallClick();
        dismiss();
      });
    } else {
      actionBtn.remove();
    }
    banner.querySelector(".pwa-install-banner-dismiss").addEventListener("click", dismiss);
    document.body.appendChild(banner);
  }

  if (isIos) {
    showBanner(null);
    return;
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    showBanner(function () {
      deferredPrompt.prompt();
    });
  });
})();
