// pwa-install.js — registers the service worker + shows a small "Get as PWA" banner

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

  // Already installed / running standalone? Never show the banner.
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  if (isStandalone) return;
  if (sessionStorage.getItem(DISMISS_KEY) === '1') return;

  // --- Build the banner markup ---
  function buildBanner() {
    const banner = document.createElement('div');
    banner.className = 'pwa-banner';
    banner.id = 'pwaBanner';
    banner.innerHTML = `
      <img src="img/logo.jpg" alt="" class="pwa-banner-icon">
      <span class="pwa-banner-text">
        Get as PWA
        <span class="pwa-banner-sub">Install for offline access</span>
      </span>
      <button class="pwa-banner-btn" id="pwaInstallBtn">Install</button>
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

    document.getElementById('pwaInstallBtn').addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      dismissBanner(banner);
      if (outcome === 'accepted') {
        console.log('PWA installed');
      }
    });

    return banner;
  }

  function dismissBanner(banner) {
    banner.classList.remove('show');
    sessionStorage.setItem(DISMISS_KEY, '1');
    setTimeout(() => banner.remove(), 500);
  }

  // Chrome/Edge/Android: fires when the browser decides the site is installable
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    buildBanner();
  });

  // If the app gets installed, clean up
  window.addEventListener('appinstalled', () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    const existing = document.getElementById('pwaBanner');
    if (existing) existing.remove();
  });
})();
