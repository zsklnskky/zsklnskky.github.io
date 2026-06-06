/* ============================================================
   VOICE NOTES — голосовой ввод через Web Speech API (бесплатно)
   Кнопка-микрофон рядом с AI-FAB. Распознанный текст уходит
   в чат AI (или в коллбэк onResult, если задан).
   ============================================================ */
(function () {
  'use strict';

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const SUPPORTED = !!SR;

  const STYLES = `
    .voice-fab {
      position: fixed; bottom: 22px; right: 96px; z-index: 89;
      width: 52px; height: 52px; border-radius: 50%;
      border: 1px solid var(--border, #2F4575);
      background: var(--s1, #14233F);
      color: var(--text, #fff);
      font-size: 20px; cursor: pointer;
      box-shadow: 0 6px 18px rgba(0,0,0,.32);
      transition: filter .15s, box-shadow .18s, background .15s;
      display: flex; align-items: center; justify-content: center;
    }
    .voice-fab:hover { filter: brightness(1.1); }
    .voice-fab.recording {
      background: #DC2626; color: #fff; border-color: #DC2626;
      box-shadow: 0 0 0 0 rgba(220,38,38,.7);
      animation: voicePulse 1.4s infinite;
    }
    @keyframes voicePulse {
      0%   { box-shadow: 0 0 0 0 rgba(220,38,38,.7); }
      70%  { box-shadow: 0 0 0 16px rgba(220,38,38,0); }
      100% { box-shadow: 0 0 0 0 rgba(220,38,38,0); }
    }
    .voice-fab.hide { display: none; }
    @media (max-width: 768px) {
      .voice-fab { right: 84px; width: 46px; height: 46px; font-size: 18px; bottom: 18px; }
    }
    .voice-toast {
      position: fixed; bottom: 90px; right: 22px; z-index: 95;
      background: var(--s2, #1C2E50);
      border: 1px solid var(--border, #2F4575);
      border-radius: 14px; padding: 10px 14px;
      font-size: 13px; color: var(--text, #fff);
      max-width: 340px;
      font-family: var(--font, 'Nunito', sans-serif);
      box-shadow: 0 8px 24px rgba(0,0,0,.4);
      transform: translateY(20px); opacity: 0;
      transition: transform .2s, opacity .2s;
      pointer-events: none;
    }
    .voice-toast.show { transform: translateY(0); opacity: 1; }
  `;

  function injectStyles() {
    if (document.getElementById('voice-styles')) return;
    const s = document.createElement('style');
    s.id = 'voice-styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  const VoiceNotes = {
    cfg: null,
    rec: null,
    recording: false,
    toastTimer: null,

    init(cfg) {
      if (!SUPPORTED) { console.warn('Web Speech API не поддерживается этим браузером'); return; }
      this.cfg = Object.assign({
        lang: () => (window.I18N && I18N.lang === 'en' ? 'en-US' : 'ru-RU'),
        onResult: null,   // (text) => void
        onError: null
      }, cfg || {});
      injectStyles();
      this._mountFab();
      this._mountToast();
    },

    _mountFab() {
      if (document.getElementById('voice-fab')) return;
      const b = document.createElement('button');
      b.id = 'voice-fab';
      b.className = 'voice-fab';
      b.title = 'Голосовой ввод';
      b.textContent = '🎙';
      b.onclick = () => this.toggle();
      document.body.appendChild(b);
    },

    _mountToast() {
      if (document.getElementById('voice-toast')) return;
      const t = document.createElement('div');
      t.id = 'voice-toast';
      t.className = 'voice-toast';
      document.body.appendChild(t);
    },

    _showToast(text, ms = 2200) {
      const t = document.getElementById('voice-toast');
      if (!t) return;
      t.textContent = text;
      t.classList.add('show');
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
    },

    toggle() { this.recording ? this.stop() : this.start(); },

    start() {
      if (!SUPPORTED || this.recording) return;
      try {
        this.rec = new SR();
        this.rec.lang = this.cfg.lang();
        this.rec.continuous = false;
        this.rec.interimResults = false;
        this.rec.maxAlternatives = 1;

        this.rec.onstart = () => {
          this.recording = true;
          document.getElementById('voice-fab')?.classList.add('recording');
          this._showToast(this.cfg.lang().startsWith('en') ? '🎙 Listening…' : '🎙 Слушаю…', 30000);
        };
        this.rec.onresult = (e) => {
          const text = e.results?.[0]?.[0]?.transcript || '';
          if (text) this._handleResult(text);
        };
        this.rec.onerror = (e) => {
          this.recording = false;
          document.getElementById('voice-fab')?.classList.remove('recording');
          const msg = e.error === 'not-allowed'
            ? '🎙 Дай разрешение на микрофон в браузере'
            : '🎙 Ошибка: ' + e.error;
          this._showToast(msg, 3500);
          if (this.cfg.onError) this.cfg.onError(e);
        };
        this.rec.onend = () => {
          this.recording = false;
          document.getElementById('voice-fab')?.classList.remove('recording');
        };

        this.rec.start();
      } catch (e) {
        this._showToast('🎙 Не удалось запустить распознавание', 3000);
      }
    },

    stop() {
      try { if (this.rec) this.rec.stop(); } catch (e) {}
      this.recording = false;
      document.getElementById('voice-fab')?.classList.remove('recording');
    },

    _handleResult(text) {
      this._showToast('✓ "' + text.slice(0, 60) + (text.length > 60 ? '…' : '') + '"', 2400);
      // 1) Если задан кастомный коллбэк — отдаём ему
      if (this.cfg.onResult) {
        try { this.cfg.onResult(text); } catch (e) {}
        return;
      }
      // 2) По умолчанию — вставляем в инпут AI-чата
      const input = document.getElementById('ai-input');
      if (input) {
        const cur = input.value || '';
        input.value = cur ? (cur.replace(/\s+$/, '') + ' ' + text) : text;
        input.dispatchEvent(new Event('input'));
        if (window.AIAgent && !window.AIAgent.state?.open) AIAgent.open();
        setTimeout(() => input.focus(), 50);
      }
    },

    setEnabled(on) {
      const b = document.getElementById('voice-fab');
      if (b) b.style.display = on ? 'flex' : 'none';
    }
  };

  window.VoiceNotes = VoiceNotes;
})();
