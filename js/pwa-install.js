// pwa-install.js — registers the service worker, shows "Get as PWA" when
// installable, or "Open App" when already installed.

(function () {
  const DISMISS_KEY = 'pwa-banner-dismissed';
  let deferredPrompt = null;

  // --- Register service worker ---
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
    });
  }

  // Running inside the installed app already? Nothing to show.
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  if (isStandalone) return;
  if (sessionStorage.getItem(DISMISS_KEY) === '1') return;

  // iOS (any browser: Safari, Chrome, etc. — they're all WebKit under the hood
  // and share the same lack of beforeinstallprompt support)
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // --- Shared banner shell ---
  function createBanner({ text, sub, btnLabel, onBtnClick }) {
    const banner = document.createElement('div');
    banner.className = 'pwa-banner';
    banner.id = 'pwaBanner';
    banner.innerHTML = `
      <img src="img/logo.jpg" alt="" class="pwa-banner-icon">
      <span class="pwa-banner-text">
        ${text}
        <span class="pwa-banner-sub">${sub}</span>
      </span>
      <button class="pwa-banner-btn" id="pwaActionBtn">${btnLabel}</button>
      <button class="pwa-banner-close" id="pwaCloseBtn" aria-label="Dismiss">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    document.body.appendChild(banner);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => banner.classList.add('show'));
    });

    document.getElementById('pwaCloseBtn').addEventListener('click', () => {
      dismissBanner(banner);
    });

    document.getElementById('pwaActionBtn').addEventListener('click', () => {
      onBtnClick(banner);
    });

    return banner;
  }

  function buildInstallBanner() {
    createBanner({
      text: 'Get as web app',
      sub: 'Install for offline access',
      btnLabel: 'Install',
      onBtnClick: async (banner) => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        dismissBanner(banner);
        if (outcome === 'accepted') {
          console.log('PWA installed');
        }
      }
    });
  }

  function buildOpenBanner() {
    createBanner({
      text: 'Already installed',
      sub: 'Tap \u22ee \u2192 Open in app (or check your app drawer)',
      btnLabel: 'Got it',
      onBtnClick: (banner) => {
        // There's no web API that can force Android to hand off to the
        // separately-installed WebAPK from inside an existing browser tab —
        // that hand-off only happens when Android intercepts a link tap
        // from outside the browser (deliberate OS security boundary).
        // So this is just a dismiss, not an action button.
        dismissBanner(banner);
      }
    });
  }

  function buildIOSBanner() {
    createBanner({
      text: 'Get as web app',
      sub: '1. Share \u2192 2. View More \u2192 3. Add to Home Screen',
      btnLabel: 'Got it',
      onBtnClick: (banner) => {
        // No JS action can open the browser's own toolbar Share sheet —
        // that's the only sheet with "Add to Home Screen" on iOS. This
        // button is just a friendly dismiss once the person has read it.
        dismissBanner(banner);
      }
    });
  }

  function dismissBanner(banner) {
    banner.classList.remove('show');
    sessionStorage.setItem(DISMISS_KEY, '1');
    setTimeout(() => banner.remove(), 500);
  }

  // --- Decide which banner (if any) to show ---
  async function init() {
    // iOS: no beforeinstallprompt, no getInstalledRelatedApps — just show
    // instructions pointing at the browser's own toolbar Share icon.
    if (isIOS) {
      buildIOSBanner();
      return;
    }

    // Check if this PWA is already installed (Chrome/Edge on Android + desktop).
    // Requires the self-referencing "related_applications" entry in manifest.json.
    if ('getInstalledRelatedApps' in navigator) {
      try {
        const relatedApps = await navigator.getInstalledRelatedApps();
        if (relatedApps.length > 0) {
          buildOpenBanner();
          return; // don't also listen for beforeinstallprompt
        }
      } catch (err) {
        console.warn('getInstalledRelatedApps failed:', err);
      }
    }

    // Not detected as installed (or detection unsupported) — offer install.
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredPrompt = event;
      buildInstallBanner();
    });
  }

  init();

  // If the app gets installed during this visit, clean up
  window.addEventListener('appinstalled', () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    const existing = document.getElementById('pwaBanner');
    if (existing) existing.remove();
  });
})();
