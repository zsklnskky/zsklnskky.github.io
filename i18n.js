/* ============================================================
   i18n — shared bilingual engine (RU / EN) for the dashboard.
   Storage: localStorage('dashboard_lang') + Firestore settings/{uid}.lang
   Usage:
     I18N.init({ dict: {...}, onChange: () => render() });
     element.textContent = I18N.t('key');
     <span data-i18n="key">fallback</span>           ← auto-applied
     <input data-i18n-ph="key.placeholder">          ← placeholder
     <button data-i18n-title="key.tip">              ← title attr
   ============================================================ */
(function () {
  'use strict';

  const LS_KEY = 'dashboard_lang';
  const SETTINGS_COLLECTION = 'settings';

  const I18N = {
    lang: 'ru',
    dict: {},
    onChange: null,
    getDb: null,
    getUser: null,

    init(opts = {}) {
      this.dict = Object.assign({}, opts.dict || {});
      this.onChange = opts.onChange || null;
      this.getDb = opts.getDb || (() => null);
      this.getUser = opts.getUser || (() => null);
      this.mountTarget = opts.mountTarget || null;  // CSS-селектор; null = плавающий в правом верхнем
      this.lang = (localStorage.getItem(LS_KEY) || opts.defaultLang || 'ru');
      if (this.lang !== 'ru' && this.lang !== 'en') this.lang = 'ru';
      document.documentElement.setAttribute('lang', this.lang);
      this._injectStyles();
      this._mountSwitcher();
      this.apply();
      this._loadCloudLang();
    },

    t(key, fallback) {
      const e = this.dict[key];
      if (!e) return fallback != null ? fallback : key;
      return e[this.lang] || e.ru || fallback || key;
    },

    addDict(extra) {
      Object.assign(this.dict, extra || {});
    },

    setLang(lang, opts = {}) {
      if (lang !== 'ru' && lang !== 'en') return;
      if (this.lang === lang) return;
      this.lang = lang;
      document.documentElement.setAttribute('lang', lang);
      try { localStorage.setItem(LS_KEY, lang); } catch (e) {}
      this._renderSwitcher();
      this.apply();
      if (opts.saveCloud !== false) this._saveCloudLang();
      if (this.onChange) this.onChange(lang);
    },

    apply() {
      const root = document;
      root.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = this.t(key, el.textContent);
      });
      root.querySelectorAll('[data-i18n-html]').forEach(el => {
        const key = el.getAttribute('data-i18n-html');
        el.innerHTML = this.t(key, el.innerHTML);
      });
      root.querySelectorAll('[data-i18n-ph]').forEach(el => {
        const key = el.getAttribute('data-i18n-ph');
        el.setAttribute('placeholder', this.t(key, el.getAttribute('placeholder') || ''));
      });
      root.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        el.setAttribute('title', this.t(key, el.getAttribute('title') || ''));
      });
      root.querySelectorAll('[data-i18n-aria]').forEach(el => {
        const key = el.getAttribute('data-i18n-aria');
        el.setAttribute('aria-label', this.t(key, el.getAttribute('aria-label') || ''));
      });
    },

    async _loadCloudLang() {
      const user = this.getUser?.(); const db = this.getDb?.();
      if (!user || !db) return;
      try {
        const doc = await db.collection(SETTINGS_COLLECTION).doc(user.uid).get();
        if (doc.exists) {
          const cloud = doc.data().lang;
          if ((cloud === 'ru' || cloud === 'en') && cloud !== this.lang) {
            this.setLang(cloud, { saveCloud: false });
          }
        }
      } catch (e) { /* silent */ }
    },

    async _saveCloudLang() {
      const user = this.getUser?.(); const db = this.getDb?.();
      if (!user || !db) return;
      try {
        await db.collection(SETTINGS_COLLECTION).doc(user.uid).set(
          { lang: this.lang, updatedAt: Date.now() },
          { merge: true }
        );
      } catch (e) { /* silent */ }
    },

    refresh() { this._loadCloudLang(); },

    _injectStyles() {
      if (document.getElementById('i18n-styles')) return;
      const s = document.createElement('style');
      s.id = 'i18n-styles';
      s.textContent = `
        .lang-switch { display: inline-flex; background: var(--s1, #14233F); border: 1px solid var(--border, #2F4575); border-radius: 99px; padding: 3px; font-family: var(--font, 'Nunito', sans-serif); }
        .lang-switch.lang-switch-fixed { position: fixed; top: 24px; right: 76px; z-index: 50; }
        .lang-switch.lang-switch-inline { margin-top: 6px; align-self: center; }
        .lang-switch button { background: transparent; border: none; color: var(--text2, #93A2C9); padding: 5px 11px; font-size: 11px; font-weight: 800; letter-spacing: .08em; cursor: pointer; border-radius: 99px; font-family: inherit; text-transform: uppercase; line-height: 1; }
        .lang-switch button.active { background: var(--accent, #10B981); color: var(--accent-text, #fff); }
        .lang-switch button:hover:not(.active) { color: var(--text, #fff); }
        @media (max-width: 768px) {
          .lang-switch.lang-switch-fixed { top: 16px; right: 60px; padding: 2px; }
          .lang-switch button { padding: 4px 9px; font-size: 10px; }
        }
      `;
      document.head.appendChild(s);
    },

    _mountSwitcher() {
      const existing = document.querySelector('.lang-switch');
      if (existing) existing.remove();
      const el = document.createElement('div');
      el.className = 'lang-switch';
      el.innerHTML = `
        <button data-lang="ru">RU</button>
        <button data-lang="en">EN</button>
      `;
      let host = null;
      if (this.mountTarget) {
        host = document.querySelector(this.mountTarget);
        el.classList.add('lang-switch-inline');
      }
      if (!host) {
        host = document.body;
        el.classList.add('lang-switch-fixed');
      }
      host.appendChild(el);
      el.querySelectorAll('[data-lang]').forEach(b => {
        b.onclick = () => this.setLang(b.dataset.lang);
      });
      this._renderSwitcher();
    },

    _renderSwitcher() {
      document.querySelectorAll('.lang-switch [data-lang]').forEach(b => {
        b.classList.toggle('active', b.dataset.lang === this.lang);
      });
    }
  };

  window.I18N = I18N;
})();
