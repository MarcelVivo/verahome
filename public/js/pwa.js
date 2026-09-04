/* Registriert den Service Worker und stellt einen verlässlichen
   Installationsweg für Website und Portal bereit. Chromium kann den
   nativen Installationsdialog öffnen; iOS benötigt weiterhin den Weg
   über Safari -> Teilen -> Zum Home-Bildschirm. */
(function () {
  "use strict";

  /* In der nativen Capacitor-Hülle ist die App bereits installiert. */
  if (window.Capacitor) return;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }

  var isPortalPath = location.pathname.indexOf("/portal/") === 0;
  if (isPortalPath) {
    var connectionTimer = null;
    var updateConnectionStatus = function () {
      var banner = document.getElementById("pwaConnectionStatus");
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "pwaConnectionStatus";
        banner.className = "pwa-connection-status";
        banner.setAttribute("role", "status");
        banner.setAttribute("aria-live", "polite");
        document.body.appendChild(banner);
      }
      if (connectionTimer) window.clearTimeout(connectionTimer);
      banner.classList.toggle("offline", !navigator.onLine);
      banner.classList.add("show");
      banner.textContent = navigator.onLine
        ? "Verbindung wiederhergestellt"
        : "Offline – gespeicherte Seiten bleiben verfügbar";
      if (navigator.onLine) {
        connectionTimer = window.setTimeout(function () { banner.classList.remove("show"); }, 2200);
      }
    };
    window.addEventListener("online", updateConnectionStatus);
    window.addEventListener("offline", updateConnectionStatus);
    if (!navigator.onLine) updateConnectionStatus();
  }

  var isStandalone =
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (isStandalone) return;

  var isPortal = isPortalPath;
  var container = isPortal
    ? document.querySelector("#navbar .nav-inner--portal")
    : document.querySelector("#navbar .nav-right");
  if (!container) return;

  var ua = navigator.userAgent || "";
  var isIos = /iphone|ipad|ipod/i.test(ua) ||
    (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  var isAndroid = /android/i.test(ua);
  var isIosSafari = isIos && /safari/i.test(ua) && !/(crios|fxios|edgios|opios)/i.test(ua);
  var deferredPrompt = null;
  var openDialog = null;
  var dialogKeydownHandler = null;

  var DOWNLOAD_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3v11m0 0-4-4m4 4 4-4"/>' +
    '<path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>' +
    "</svg>";

  var icon = document.createElement("button");
  icon.type = "button";
  icon.id = "pwaInstallIcon";
  icon.className = isPortal ? "pwa-install-icon" : "nav-install-btn";
  icon.setAttribute("aria-label", "Vera Home als App installieren");
  icon.setAttribute("aria-haspopup", "dialog");
  icon.title = "App installieren";
  icon.innerHTML = DOWNLOAD_ICON_SVG;

  if (isPortal) {
    container.appendChild(icon);
  } else {
    var portalBtn = container.querySelector(".nav-portal-btn");
    container.insertBefore(icon, portalBtn ? portalBtn.nextSibling : container.firstChild);
  }

  function guideContent() {
    if (isIosSafari) {
      return {
        intro: "Installieren Sie Vera Home direkt auf Ihrem Home-Bildschirm:",
        steps: [
          "Tippen Sie unten in Safari auf das Teilen-Symbol.",
          "Wählen Sie «Zum Home-Bildschirm».",
          "Bestätigen Sie oben rechts mit «Hinzufügen»."
        ]
      };
    }
    if (isIos) {
      return {
        intro: "Die Installation auf iPhone und iPad erfolgt über Safari:",
        steps: [
          "Öffnen Sie diese Seite in Safari.",
          "Tippen Sie auf Teilen und dann auf «Zum Home-Bildschirm».",
          "Bestätigen Sie mit «Hinzufügen»."
        ]
      };
    }
    if (isAndroid) {
      return {
        intro: "Falls der Installationsdialog nicht automatisch erscheint:",
        steps: [
          "Öffnen Sie das Browser-Menü (⋮).",
          "Wählen Sie «App installieren» oder «Zum Startbildschirm hinzufügen».",
          "Bestätigen Sie die Installation."
        ]
      };
    }
    return {
      intro: "Vera Home kann über das Menü Ihres Browsers installiert werden:",
      steps: [
        "Öffnen Sie das Browser-Menü.",
        "Wählen Sie «App installieren» oder «Zum Startbildschirm hinzufügen».",
        "Bestätigen Sie die Installation."
      ]
    };
  }

  function closeInstallGuide() {
    if (!openDialog) return;
    var dialog = openDialog;
    openDialog = null;
    if (dialogKeydownHandler) {
      document.removeEventListener("keydown", dialogKeydownHandler);
      dialogKeydownHandler = null;
    }
    dialog.classList.remove("open");
    window.setTimeout(function () {
      dialog.remove();
      icon.focus();
    }, 220);
  }

  function showInstallGuide() {
    if (openDialog) return;

    var content = guideContent();
    var backdrop = document.createElement("div");
    backdrop.className = "pwa-install-backdrop";
    backdrop.setAttribute("role", "presentation");

    var dialog = document.createElement("section");
    dialog.className = "pwa-install-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "pwaInstallHeading");

    var heading = document.createElement("h2");
    heading.id = "pwaInstallHeading";
    heading.textContent = "Vera Home installieren";

    var intro = document.createElement("p");
    intro.textContent = content.intro;

    var steps = document.createElement("ol");
    content.steps.forEach(function (text) {
      var item = document.createElement("li");
      item.textContent = text;
      steps.appendChild(item);
    });

    var closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "btn btn-primary pwa-install-close";
    closeButton.textContent = "Verstanden";
    closeButton.addEventListener("click", closeInstallGuide);

    dialog.appendChild(heading);
    dialog.appendChild(intro);
    dialog.appendChild(steps);
    dialog.appendChild(closeButton);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    openDialog = backdrop;

    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop) closeInstallGuide();
    });
    dialogKeydownHandler = function (event) {
      if (event.key !== "Escape" || openDialog !== backdrop) return;
      closeInstallGuide();
    };
    document.addEventListener("keydown", dialogKeydownHandler);

    window.requestAnimationFrame(function () {
      backdrop.classList.add("open");
      closeButton.focus();
    });
  }

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferredPrompt = event;
    icon.classList.add("install-ready");
  });

  window.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    closeInstallGuide();
    icon.remove();
  });

  icon.addEventListener("click", async function () {
    if (!deferredPrompt) {
      showInstallGuide();
      return;
    }

    var prompt = deferredPrompt;
    deferredPrompt = null;
    icon.classList.remove("install-ready");
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch (error) {
      showInstallGuide();
    }
  });
})();
