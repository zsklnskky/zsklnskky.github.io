/* ============================================================
   PWA INSTALL BANNER — приглашает поставить дашборд как приложение
   + ONLINE/OFFLINE индикатор (общий для всех аппов).
   ============================================================ */
(function () {
  'use strict';

  const DISMISS_KEY = 'pwa_install_dismissed_until';
  const DAY = 24 * 60 * 60 * 1000;

  // ─── СТИЛИ ─────────────────────────────────────────────────
  const STYLES = `
    .pwa-banner {
      position: fixed; bottom: 18px; left: 18px; right: 96px; z-index: 88;
      max-width: 540px;
      background: var(--s1, #14233F); border: 1px solid var(--border, #2F4575);
      border-left: 4px solid var(--accent, #10B981);
      border-radius: 18px; padding: 13px 16px;
      display: none; align-items: center; gap: 14px;
      box-shadow: 0 12px 30px rgba(0,0,0,.45);
      font-family: var(--font, 'Nunito', sans-serif);
      animation: pwaIn .35s ease-out;
    }
    .pwa-banner.show { display: flex; }
    @keyframes pwaIn { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    .pwa-banner-icon { font-size: 28px; flex-shrink: 0; }
    .pwa-banner-text { flex: 1; min-width: 0; }
    .pwa-banner-title { font-weight: 800; font-size: 14px; color: var(--text, #fff); margin-bottom: 2px; }
    .pwa-banner-sub { font-size: 12px; color: var(--text2, #93A2C9); line-height: 1.4; }
    .pwa-banner-actions { display: flex; gap: 6px; flex-shrink: 0; }
    .pwa-banner-btn {
      background: var(--accent, #10B981); color: var(--accent-text, #fff);
      border: none; padding: 8px 14px; border-radius: 99px;
      font-family: inherit; font-size: 12px; font-weight: 800; cursor: pointer;
      transition: filter .12s, box-shadow .15s;
    }
    .pwa-banner-btn:hover { filter: brightness(1.08); box-shadow: 0 4px 12px rgba(0,0,0,.3); }
    .pwa-banner-x {
      background: transparent; border: none; color: var(--text3, #93A2C9);
      font-size: 18px; cursor: pointer; padding: 4px 8px;
    }
    .pwa-banner-x:hover { color: var(--text, #fff); }

    @media (max-width: 768px) {
      .pwa-banner { left: 10px; right: 10px; bottom: 80px; padding: 11px 13px; gap: 10px; }
      .pwa-banner-icon { font-size: 22px; }
      .pwa-banner-title { font-size: 13px; }
      .pwa-banner-sub { font-size: 11px; }
    }

    .net-pill {
      position: fixed; top: 24px; left: 24px; z-index: 60;
      background: rgba(239,68,68,.15); color: #F87171;
      border: 1px solid #F87171; border-radius: 99px;
      padding: 4px 11px; font-size: 11px; font-weight: 800;
      letter-spacing: .04em; text-transform: uppercase;
      font-family: var(--font, 'Nunito', sans-serif);
      display: none; align-items: center; gap: 6px;
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 14px rgba(0,0,0,.3);
      pointer-events: none;
    }
    .net-pill.show { display: inline-flex; animation: netIn .25s ease-out; }
    @keyframes netIn { from { transform: translateY(-10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    .net-pill::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #F87171; animation: netBlink 1.5s infinite; }
    @keyframes netBlink { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
    @media (max-width: 768px) { .net-pill { top: 14px; left: 14px; } }
  `;

  function injectStyles() {
    if (document.getElementById('pwa-install-styles')) return;
    const s = document.createElement('style');
    s.id = 'pwa-install-styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  function t(ru, en) { return (window.I18N && I18N.lang === 'en') ? en : ru; }

  // ─── INSTALL BANNER ───────────────────────────────────────
  let deferredPrompt = null;
  let dismissedUntil = +(localStorage.getItem(DISMISS_KEY) || 0);

  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }

  function buildBanner() {
    if (document.getElementById('pwa-install-banner')) return;
    injectStyles();
    const b = document.createElement('div');
    b.className = 'pwa-banner';
    b.id = 'pwa-install-banner';
    b.innerHTML = `
      <div class="pwa-banner-icon">📲</div>
      <div class="pwa-banner-text">
        <div class="pwa-banner-title">${t('Установи как приложение', 'Install as app')}</div>
        <div class="pwa-banner-sub">${t('Иконка на главном экране, оффлайн-режим, быстрые ярлыки.', 'Home-screen icon, offline mode, quick shortcuts.')}</div>
      </div>
      <div class="pwa-banner-actions">
        <button class="pwa-banner-btn" id="pwa-install-go">${t('Установить', 'Install')}</button>
        <button class="pwa-banner-x" id="pwa-install-x" title="${t('Позже', 'Later')}">×</button>
      </div>
    `;
    document.body.appendChild(b);
    document.getElementById('pwa-install-go').onclick = doInstall;
    document.getElementById('pwa-install-x').onclick = () => {
      dismiss(7); // на неделю
      hideBanner();
    };
  }

  function showBanner() {
    buildBanner();
    document.getElementById('pwa-install-banner')?.classList.add('show');
  }
  function hideBanner() {
    document.getElementById('pwa-install-banner')?.classList.remove('show');
  }
  function dismiss(days) {
    const until = Date.now() + days * DAY;
    localStorage.setItem(DISMISS_KEY, String(until));
    dismissedUntil = until;
  }

  async function doInstall() {
    if (!deferredPrompt) {
      // Safari / iOS — нет native prompt'а, показываем инструкцию
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (isIOS) {
        alert(t(
          'На iPhone: нажми ↗ (Поделиться) внизу Safari → пролистай вниз → «На экран «Домой»» → «Добавить». Откроется как нативное приложение.',
          'On iPhone: tap ↗ (Share) at the bottom of Safari → scroll down → "Add to Home Screen" → Add. Opens like a native app.'
        ));
      } else {
        alert(t(
          'В адресной строке появится значок установки (или меню браузера → «Установить приложение»).',
          'An install icon will appear in the address bar (or browser menu → "Install app").'
        ));
      }
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    hideBanner();
    if (outcome === 'dismissed') dismiss(7);
  }

  function maybeShowBanner() {
    if (isStandalone()) return;
    if (Date.now() < dismissedUntil) return;
    // На мобильных или когда есть deferredPrompt — показываем активно
    const isMobile = window.innerWidth <= 768;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (deferredPrompt || isIOS || isMobile) {
      showBanner();
    }
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    maybeShowBanner();
  });
  window.addEventListener('appinstalled', () => {
    hideBanner();
    dismiss(365); // больше не показываем
  });

  // Авто-показ на мобильных при загрузке + через 4 сек на десктопе
  if (window.innerWidth <= 768 || /iPad|iPhone|iPod/.test(navigator.userAgent)) {
    document.addEventListener('DOMContentLoaded', () => setTimeout(maybeShowBanner, 1500));
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(maybeShowBanner, 4000));
  }

  // ─── ONLINE/OFFLINE PILL ──────────────────────────────────
  function ensureNetPill() {
    if (document.getElementById('net-pill')) return;
    injectStyles();
    const p = document.createElement('div');
    p.id = 'net-pill';
    p.className = 'net-pill';
    p.textContent = t('Оффлайн', 'Offline');
    document.body.appendChild(p);
  }

  function syncNet() {
    ensureNetPill();
    const p = document.getElementById('net-pill');
    if (!p) return;
    p.textContent = t('Оффлайн', 'Offline');
    if (navigator.onLine) p.classList.remove('show');
    else p.classList.add('show');
  }

  window.addEventListener('online',  syncNet);
  window.addEventListener('offline', syncNet);
  document.addEventListener('DOMContentLoaded', syncNet);

  // Реагируем на смену языка (если будет переключатель)
  document.addEventListener('click', e => {
    if (e.target.closest?.('.lang-switch [data-lang]')) {
      setTimeout(() => {
        const banner = document.getElementById('pwa-install-banner');
        if (banner) {
          banner.querySelector('.pwa-banner-title').textContent = t('Установи как приложение', 'Install as app');
          banner.querySelector('.pwa-banner-sub').textContent = t('Иконка на главном экране, оффлайн-режим, быстрые ярлыки.', 'Home-screen icon, offline mode, quick shortcuts.');
          banner.querySelector('#pwa-install-go').textContent = t('Установить', 'Install');
        }
        syncNet();
      }, 50);
    }
  });
})();
