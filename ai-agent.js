/* ============================================================
   AI AGENT — shared module for FOCUS / WALLET / PASSWORD / ORBIT
   ----------------------------------------------------------------
   Common key in Firestore settings/{uid}.aiKey. Detects provider
   by key prefix. Free-form chat with app-specific system prompt
   and live context (passed via config.getContext()).
   ============================================================ */
(function () {
  'use strict';

  const SETTINGS_COLLECTION = 'settings';
  const LEGACY_LOCAL_KEY = 'shared_ai_key'; // fallback when offline / pre-login

  // ─── PROVIDER DETECTION ─────────────────────────────────────
  function detectProvider(key) {
    if (!key) return null;
    const k = key.trim();
    if (k.startsWith('gsk_')) return 'groq';
    if (k.startsWith('sk-or-')) return 'openrouter';
    if (k.startsWith('AIza')) return 'gemini';
    if (k.startsWith('sk-') && k.length >= 30 && k.length <= 60 && !k.startsWith('sk-proj-')) return 'deepseek';
    if (/^[A-Za-z0-9]{32}$/.test(k)) return 'mistral';
    return null;
  }

  function providerLabel(p) {
    return { groq: 'Groq', openrouter: 'OpenRouter', gemini: 'Gemini', deepseek: 'DeepSeek', mistral: 'Mistral' }[p] || p;
  }

  // ─── API CALLS ──────────────────────────────────────────────
  async function callGroq(key, messages) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages, temperature: 0.85, max_tokens: 700 })
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${res.status}`); }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim();
  }

  async function callGemini(key, messages) {
    const sys = messages.find(m => m.role === 'system')?.content || '';
    const dialog = messages.filter(m => m.role !== 'system');
    const contents = dialog.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    const body = { contents, generationConfig: { temperature: 0.85, maxOutputTokens: 700 } };
    if (sys) body.systemInstruction = { parts: [{ text: sys }] };
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${res.status}`); }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  }

  async function callOpenRouter(key, messages) {
    const models = [
      'meta-llama/llama-3.3-70b-instruct:free',
      'google/gemma-2-9b-it:free',
      'meta-llama/llama-3.1-8b-instruct:free',
      'mistralai/mistral-7b-instruct:free'
    ];
    let lastErr = '';
    for (const model of models) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + key,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://zsklnskky.github.io/',
            'X-Title': 'Dashboard'
          },
          body: JSON.stringify({ model, messages, temperature: 0.85, max_tokens: 700 })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) {
          lastErr = `${model.split('/')[1]}: ${data.error?.message || 'HTTP ' + res.status}`;
          continue;
        }
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return text;
        lastErr = `${model.split('/')[1]}: empty`;
      } catch (e) {
        lastErr = `${model.split('/')[1]}: ${e.message}`;
      }
    }
    throw new Error(lastErr || 'Все free-модели недоступны');
  }

  async function callDeepSeek(key, messages) {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-chat', messages, temperature: 0.85, max_tokens: 700 })
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${res.status}`); }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim();
  }

  async function callMistral(key, messages) {
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'mistral-small-latest', messages, temperature: 0.85, max_tokens: 700 })
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || e.error?.message || `HTTP ${res.status}`); }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim();
  }

  async function callAI(key, messages) {
    const provider = detectProvider(key);
    if (!provider) throw new Error('Неизвестный формат ключа');
    if (provider === 'groq') return await callGroq(key, messages);
    if (provider === 'openrouter') return await callOpenRouter(key, messages);
    if (provider === 'gemini') return await callGemini(key, messages);
    if (provider === 'deepseek') return await callDeepSeek(key, messages);
    if (provider === 'mistral') return await callMistral(key, messages);
  }

  // ─── HTML escape ────────────────────────────────────────────
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ─── Лёгкий markdown → HTML: **bold**, *italic*, `code`, переносы, списки ──
  function mdRender(text) {
    let s = esc(text);
    // **жирный** → <strong>
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    // *курсив* → <em> (только если рядом не звёздочка)
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    // `code` → <code>
    s = s.replace(/`([^`\n]+)`/g, '<code style="background:rgba(0,0,0,.25);padding:1px 5px;border-radius:5px;font-size:.92em">$1</code>');
    // [link](url) → <a>
    s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:underline">$1</a>');
    // - пункт списка в начале строки → • пункт
    s = s.replace(/(^|\n)[-*]\s+/g, '$1• ');
    // переносы строк
    s = s.replace(/\n/g, '<br>');
    return s;
  }

  // ─── DOM ────────────────────────────────────────────────────
  const STYLES = `
    .ai-fab { position: fixed; bottom: 22px; right: 22px; z-index: 90; width: 60px; height: 60px; border-radius: 50%; border: none; background: var(--accent, #10B981); color: var(--accent-text, #fff); font-size: 26px; cursor: pointer; box-shadow: 0 8px 24px rgba(0,0,0,.32); transition: transform .2s, box-shadow .2s; display: flex; align-items: center; justify-content: center; }
    .ai-fab:hover { transform: scale(1.08); box-shadow: 0 12px 32px rgba(0,0,0,.42); }
    .ai-fab.hide { display: none; }
    @media (max-width: 768px) { .ai-fab { width: 54px; height: 54px; bottom: 18px; right: 16px; font-size: 22px; } }

    .ai-panel { position: fixed; bottom: 22px; right: 22px; z-index: 91; width: 380px; max-width: calc(100vw - 24px); height: 560px; max-height: calc(100vh - 40px); background: var(--s1, #14233F); border: 1px solid var(--border, #2F4575); border-radius: 22px; box-shadow: 0 20px 60px rgba(0,0,0,.55); display: none; flex-direction: column; overflow: hidden; font-family: var(--font, 'Nunito', sans-serif); }
    .ai-panel.show { display: flex; animation: aiFadeIn .22s ease-out; }
    @keyframes aiFadeIn { from { opacity: 0; transform: translateY(12px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
    @media (max-width: 768px) { .ai-panel { width: calc(100vw - 16px); height: calc(100vh - 80px); right: 8px; bottom: 8px; border-radius: 20px; } }

    .ai-panel-head { padding: 14px 14px 12px; background: linear-gradient(135deg, var(--accent, #10B981), color-mix(in srgb, var(--accent, #10B981) 70%, #000 30%)); color: var(--accent-text, #fff); display: flex; align-items: center; gap: 10px; }
    .ai-panel-head-info { flex: 1; min-width: 0; }
    .ai-panel-head-title { font-weight: 800; font-size: 15px; }
    .ai-panel-head-sub { font-size: 11px; opacity: .82; margin-top: 2px; }
    .ai-panel-head-btn { background: rgba(255,255,255,.18); border: none; color: #fff; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; transition: background .15s; }
    .ai-panel-head-btn:hover { background: rgba(255,255,255,.30); }

    .ai-panel-body { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; background: var(--bg2, #0F1C32); }
    .ai-msg { max-width: 90%; padding: 10px 14px; font-size: 14px; line-height: 1.5; border-radius: 16px; word-wrap: break-word; white-space: pre-wrap; }
    .ai-msg.bot { background: var(--s2, #1C2E50); border: 1px solid var(--border, #2F4575); color: var(--text, #fff); border-radius: 16px 16px 16px 4px; align-self: flex-start; }
    .ai-msg.user { background: var(--accent, #10B981); color: var(--accent-text, #fff); border-radius: 16px 16px 4px 16px; align-self: flex-end; font-weight: 600; }
    .ai-msg.error { background: rgba(248,113,113,.12); border: 1px solid #F87171; color: #F87171; }
    .ai-msg-typing { display: inline-flex; gap: 3px; align-items: center; padding: 4px 0; }
    .ai-msg-typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--accent, #10B981); animation: aiTyping 1.4s infinite; }
    .ai-msg-typing span:nth-child(2) { animation-delay: .2s; }
    .ai-msg-typing span:nth-child(3) { animation-delay: .4s; }
    @keyframes aiTyping { 0%, 100% { opacity: .3; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.2); } }

    .ai-suggest { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 8px; background: var(--bg2, #0F1C32); }
    .ai-suggest-btn { background: var(--s1, #14233F); border: 1px solid var(--border, #2F4575); border-radius: 99px; padding: 7px 13px; font-size: 12px; color: var(--text2, #D3DDF5); cursor: pointer; font-family: inherit; font-weight: 600; transition: all .15s; }
    .ai-suggest-btn:hover { background: var(--accent, #10B981); color: var(--accent-text, #fff); border-color: var(--accent, #10B981); }

    .ai-input-wrap { padding: 12px; border-top: 1px solid var(--border, #2F4575); background: var(--s1, #14233F); display: flex; gap: 8px; align-items: flex-end; }
    .ai-input { flex: 1; background: var(--bg, #0A1525); border: 1px solid var(--border, #2F4575); border-radius: 20px; padding: 10px 14px; font-size: 15px; outline: none; resize: none; color: var(--text, #fff); font-family: inherit; line-height: 1.45; max-height: 100px; min-height: 42px; transition: border-color .12s; }
    .ai-input:focus { border-color: var(--accent, #10B981); }
    .ai-send-btn { background: var(--accent, #10B981); color: var(--accent-text, #fff); border: none; border-radius: 50%; width: 42px; height: 42px; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform .12s, opacity .12s; flex-shrink: 0; }
    .ai-send-btn:hover { transform: scale(1.08); }
    .ai-send-btn:disabled { opacity: .4; cursor: not-allowed; }

    .ai-settings-bg { position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,.6); display: none; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(4px); }
    .ai-settings-bg.show { display: flex; }
    .ai-settings { background: var(--s1, #14233F); border: 1px solid var(--border, #2F4575); border-radius: 22px; max-width: 480px; width: 100%; max-height: 90vh; overflow: auto; font-family: var(--font, 'Nunito', sans-serif); }
    .ai-settings-head { padding: 18px 20px; border-bottom: 1px solid var(--border, #2F4575); display: flex; justify-content: space-between; align-items: center; font-size: 16px; font-weight: 800; color: var(--text, #fff); }
    .ai-settings-body { padding: 18px 20px; color: var(--text2, #D3DDF5); font-size: 14px; line-height: 1.6; }
    .ai-settings-body p { margin-bottom: 14px; }
    .ai-settings-body a { color: var(--accent, #10B981); font-weight: 700; text-decoration: none; }
    .ai-settings-body a:hover { text-decoration: underline; }
    .ai-settings input[type=text] { width: 100%; padding: 11px 14px; background: var(--bg, #0A1525); border: 1px solid var(--border, #2F4575); border-radius: 12px; color: var(--text, #fff); font-family: inherit; font-size: 14px; outline: none; margin-bottom: 12px; box-sizing: border-box; }
    .ai-settings input[type=text]:focus { border-color: var(--accent, #10B981); }
    .ai-settings-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
    .ai-btn-primary, .ai-btn-ghost { padding: 10px 18px; border-radius: 12px; font-family: inherit; font-size: 14px; font-weight: 700; cursor: pointer; transition: all .15s; border: none; }
    .ai-btn-primary { background: var(--accent, #10B981); color: var(--accent-text, #fff); }
    .ai-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(0,0,0,.32); }
    .ai-btn-ghost { background: transparent; color: var(--text2, #D3DDF5); border: 1px solid var(--border, #2F4575); }
    .ai-btn-ghost:hover { background: var(--s2, #1C2E50); }
    .ai-status { margin-top: 12px; padding: 10px 14px; border-radius: 10px; font-size: 13px; font-weight: 600; }
    .ai-status.ok { background: rgba(16,185,129,.14); color: #10B981; border: 1px solid #10B981; }
    .ai-status.err { background: rgba(248,113,113,.12); color: #F87171; border: 1px solid #F87171; }
    .ai-providers-hint { font-size: 12px; color: var(--text3, #93A2C9); margin-top: 6px; }
  `;

  function injectStyles() {
    if (document.getElementById('ai-agent-styles')) return;
    const s = document.createElement('style');
    s.id = 'ai-agent-styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  function buildDom() {
    const wrap = document.createElement('div');
    wrap.id = 'ai-agent-root';
    wrap.innerHTML = `
      <button class="ai-fab" id="ai-fab" title="AI-помощник">💬</button>
      <div class="ai-panel" id="ai-panel">
        <div class="ai-panel-head">
          <div class="ai-panel-head-info">
            <div class="ai-panel-head-title" id="ai-panel-title">AI-помощник</div>
            <div class="ai-panel-head-sub" id="ai-panel-sub">Готов помочь</div>
          </div>
          <button class="ai-panel-head-btn" id="ai-panel-settings" title="Настройки ключа">⚙</button>
          <button class="ai-panel-head-btn" id="ai-panel-close" title="Закрыть">×</button>
        </div>
        <div class="ai-panel-body" id="ai-panel-body"></div>
        <div class="ai-suggest" id="ai-suggest"></div>
        <div class="ai-input-wrap">
          <textarea class="ai-input" id="ai-input" placeholder="Спроси что угодно..." rows="1"></textarea>
          <button class="ai-send-btn" id="ai-send" title="Отправить">→</button>
        </div>
      </div>
      <div class="ai-settings-bg" id="ai-settings-bg">
        <div class="ai-settings">
          <div class="ai-settings-head">
            <span>Ключ AI-помощника</span>
            <button class="ai-panel-head-btn" id="ai-settings-close" style="background:var(--s2);color:var(--text2)">×</button>
          </div>
          <div class="ai-settings-body">
            <p>Ключ нужен один раз — будет работать <b>во всех 4 приложениях</b>. Сохраняется в твоём облаке.</p>
            <p><b>Рекомендую Mistral</b> (бесплатно, работает в РФ/РБ без VPN):
              <a href="https://console.mistral.ai/api-keys" target="_blank" rel="noopener">console.mistral.ai/api-keys</a> → создай аккаунт → «Create new key» → скопируй.
            </p>
            <div style="position:relative">
              <input type="password" id="ai-key-input" placeholder="Вставь сюда API-ключ" autocomplete="off" spellcheck="false" style="padding-right:48px">
              <button type="button" id="ai-key-toggle" title="Показать / скрыть" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:transparent;border:none;color:var(--text3, #93A2C9);font-size:16px;cursor:pointer;padding:6px;border-radius:8px">👁</button>
            </div>
            <div class="ai-providers-hint">Поддерживаются: Mistral · Groq · OpenRouter · DeepSeek · Gemini (определяется автоматически по ключу). <b>Ключ виден только тебе</b> — Firestore-правила запрещают чтение чужим.</div>
            <div class="ai-settings-actions">
              <button class="ai-btn-ghost" id="ai-key-test">🧪 Проверить</button>
              <button class="ai-btn-primary" id="ai-key-save">Сохранить</button>
            </div>
            <div id="ai-key-status"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
  }

  // ─── MODULE ─────────────────────────────────────────────────
  const AIAgent = {
    cfg: null,
    state: {
      open: false,
      messages: [],
      busy: false,
      key: '',
      keyLoaded: false
    },

    init(cfg) {
      this.cfg = Object.assign({
        appKey: 'app',
        appName: 'AI',
        title: 'AI-помощник',
        subtitle: 'Готов помочь',
        greeting: 'Привет! Чем могу помочь?',
        suggestions: [],
        systemPrompt: () => 'Ты — встроенный AI-помощник в личном дашборде. Отвечай кратко, по делу, по-русски.',
        getContext: () => '',
        canOpen: () => true,
        onOpen: null,
        onClose: null,
        // Firebase access
        getDb: () => null,
        getUser: () => null,
        // Имя пользователя для персонализации
        getUserName: null,  // (() => string) — если не задано, возьмём из getUser().displayName
        // Optional action runner: AI can include [[action:NAME|ARG]] tokens
        actionRunner: null
      }, cfg);

      injectStyles();
      buildDom();
      this._wire();
      this._loadKey();
      this._loadLocalHistory();
      this._renderHeader();
    },

    _wire() {
      document.getElementById('ai-fab').onclick = () => this.toggle();
      document.getElementById('ai-panel-close').onclick = () => this.close();
      document.getElementById('ai-panel-settings').onclick = () => this.openSettings();
      document.getElementById('ai-settings-close').onclick = () => this.closeSettings();
      document.getElementById('ai-key-save').onclick = () => this._onSaveKey();
      document.getElementById('ai-key-test').onclick = () => this._onTestKey();

      const input = document.getElementById('ai-input');
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._onSend(); }
      });
      input.addEventListener('input', e => {
        e.target.style.height = 'auto';
        e.target.style.height = Math.min(100, e.target.scrollHeight) + 'px';
      });
      document.getElementById('ai-send').onclick = () => this._onSend();

      document.getElementById('ai-settings-bg').addEventListener('click', e => {
        if (e.target.id === 'ai-settings-bg') this.closeSettings();
      });
    },

    _renderHeader() {
      const t = this.cfg.title || 'AI-помощник';
      const s = this.cfg.subtitle || (this.state.key ? `Подключён: ${providerLabel(detectProvider(this.state.key))}` : 'Введи ключ в настройках');
      document.getElementById('ai-panel-title').textContent = t;
      document.getElementById('ai-panel-sub').textContent = s;
    },

    // Public: re-load key after auth state changes
    async refresh() { await this._loadKey(); },

    // Public: show / hide the FAB (for PASSWORD before unlock)
    setEnabled(on) {
      const fab = document.getElementById('ai-fab');
      if (!fab) return;
      if (on) { fab.style.display = 'flex'; }
      else {
        fab.style.display = 'none';
        if (this.state.open) this.close();
      }
    },

    async _loadKey() {
      const user = this.cfg.getUser();
      const db = this.cfg.getDb();
      if (!user || !db) {
        // Local fallback
        this.state.key = localStorage.getItem(LEGACY_LOCAL_KEY) || '';
        this.state.keyLoaded = true;
        this._renderHeader();
        return;
      }
      try {
        const doc = await db.collection(SETTINGS_COLLECTION).doc(user.uid).get();
        if (doc.exists) {
          this.state.key = doc.data().aiKey || '';
        }
      } catch (e) {
        console.warn('AI key load failed:', e.message);
      }
      // Local fallback if nothing in cloud
      if (!this.state.key) {
        this.state.key = localStorage.getItem(LEGACY_LOCAL_KEY) || '';
        // Heal cloud copy
        if (this.state.key) this._saveKey(this.state.key, false);
      }
      this.state.keyLoaded = true;
      this._renderHeader();
    },

    async _saveKey(key, alsoLocal = true) {
      const user = this.cfg.getUser();
      const db = this.cfg.getDb();
      this.state.key = key;
      if (alsoLocal) localStorage.setItem(LEGACY_LOCAL_KEY, key);
      if (!user || !db) return true;
      try {
        await db.collection(SETTINGS_COLLECTION).doc(user.uid).set({ aiKey: key, updatedAt: Date.now() }, { merge: true });
        return true;
      } catch (e) {
        console.warn('AI key save failed:', e.message);
        return false;
      }
    },

    toggle() { this.state.open ? this.close() : this.open(); },

    open() {
      if (this.cfg.canOpen && !this.cfg.canOpen()) return;
      this.state.open = true;
      document.getElementById('ai-panel').classList.add('show');
      document.getElementById('ai-fab').classList.add('hide');
      this._render();
      this._renderSuggestions();
      setTimeout(() => document.getElementById('ai-input').focus(), 80);
      if (this.cfg.onOpen) this.cfg.onOpen();
    },

    close() {
      this.state.open = false;
      document.getElementById('ai-panel').classList.remove('show');
      document.getElementById('ai-fab').classList.remove('hide');
      if (this.cfg.onClose) this.cfg.onClose();
    },

    openSettings() {
      document.getElementById('ai-settings-bg').classList.add('show');
      const input = document.getElementById('ai-key-input');
      input.value = this.state.key || '';
      input.type = 'password';
      const toggle = document.getElementById('ai-key-toggle');
      if (toggle) {
        toggle.textContent = '👁';
        toggle.onclick = () => {
          input.type = input.type === 'password' ? 'text' : 'password';
          toggle.textContent = input.type === 'password' ? '👁' : '🙈';
        };
      }
      document.getElementById('ai-key-status').innerHTML = '';
      setTimeout(() => input.focus(), 80);
    },

    closeSettings() {
      document.getElementById('ai-settings-bg').classList.remove('show');
    },

    async _onSaveKey() {
      const v = document.getElementById('ai-key-input').value.trim();
      const status = document.getElementById('ai-key-status');
      if (!v) {
        await this._saveKey('');
        status.innerHTML = '<div class="ai-status ok">Ключ удалён.</div>';
        this._renderHeader();
        return;
      }
      const provider = detectProvider(v);
      if (!provider) {
        status.innerHTML = '<div class="ai-status err">Не похоже на валидный API-ключ. Проверь, что скопировал целиком.</div>';
        return;
      }
      const ok = await this._saveKey(v);
      status.innerHTML = ok
        ? `<div class="ai-status ok">Сохранено. Провайдер: ${providerLabel(provider)}.</div>`
        : '<div class="ai-status err">Сохранил локально, но в облако не записалось — проверь сеть/правила.</div>';
      this._renderHeader();
      setTimeout(() => this.closeSettings(), 900);
    },

    async _onTestKey() {
      const v = document.getElementById('ai-key-input').value.trim();
      const status = document.getElementById('ai-key-status');
      if (!v) { status.innerHTML = '<div class="ai-status err">Сначала вставь ключ.</div>'; return; }
      const provider = detectProvider(v);
      if (!provider) { status.innerHTML = '<div class="ai-status err">Не распознан формат ключа.</div>'; return; }
      status.innerHTML = '<div class="ai-status">Проверяю…</div>';
      try {
        const r = await callAI(v, [
          { role: 'system', content: 'You are a test.' },
          { role: 'user', content: 'Ответь ровно одним словом: тест' }
        ]);
        if (r) status.innerHTML = `<div class="ai-status ok">Работает (${providerLabel(provider)}).</div>`;
        else status.innerHTML = '<div class="ai-status err">Пустой ответ.</div>';
      } catch (e) {
        status.innerHTML = `<div class="ai-status err">${esc(e.message)}</div>`;
      }
    },

    _localHistoryKey() {
      return `ai_chat_${this.cfg.appKey}_history`;
    },

    _saveLocalHistory() {
      try { localStorage.setItem(this._localHistoryKey(), JSON.stringify(this.state.messages.slice(-30))); }
      catch (e) {}
    },

    _loadLocalHistory() {
      try {
        const raw = localStorage.getItem(this._localHistoryKey());
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) this.state.messages = arr;
        }
      } catch (e) {}
    },

    clearHistory() {
      this.state.messages = [];
      this._saveLocalHistory();
      this._render();
      this._renderSuggestions();
    },

    _renderSuggestions() {
      const wrap = document.getElementById('ai-suggest');
      const list = (this.cfg.suggestions || []).filter(s => s && s.text);
      if (!list.length || this.state.messages.length > 0) {
        wrap.style.display = 'none';
        wrap.innerHTML = '';
        return;
      }
      wrap.style.display = 'flex';
      wrap.innerHTML = list.map((s, i) => `<button class="ai-suggest-btn" data-idx="${i}">${esc(s.text)}</button>`).join('');
      wrap.querySelectorAll('[data-idx]').forEach(b => {
        b.onclick = () => {
          const s = list[+b.dataset.idx];
          if (typeof s.onClick === 'function') {
            try { s.onClick(); } catch (e) {}
          } else {
            this._send(s.send || s.text);
          }
        };
      });
    },

    // Публичный: программная отправка реплики бота (для AI Weekly Digest и т.п.)
    async runPromptAsBot(prompt, opts = {}) {
      if (!this.state.key) { this.openSettings(); return; }
      this.open();
      this.state.busy = true;
      this._renderSuggestions();
      this._render();
      try {
        const base = this._buildBasePrompt();
        const sys = (typeof this.cfg.systemPrompt === 'function') ? this.cfg.systemPrompt() : this.cfg.systemPrompt;
        const fullSystem = base
          + '\n\n# ДОПОЛНИТЕЛЬНО ПРО ЭТОТ СЕРВИС\n' + (sys || '')
          + (opts.systemAppend ? '\n\n' + opts.systemAppend : '');
        const messages = [
          { role: 'system', content: fullSystem },
          { role: 'user', content: prompt }
        ];
        const reply = await callAI(this.state.key, messages);
        const final = (reply && reply.trim()) ? this._processActions(reply) : '✅ Готово.';
        this.state.messages.push({ role: 'user', text: opts.userLabel || 'Дайджест недели' });
        this.state.messages.push({ role: 'assistant', text: final });
      } catch (e) {
        this.state.messages.push({ role: 'assistant', text: e.message, error: true });
      }
      this.state.busy = false;
      this._render();
      this._saveLocalHistory();
    },

    _render() {
      const body = document.getElementById('ai-panel-body');
      let html = '';
      if (this.state.messages.length === 0) {
        const g = typeof this.cfg.greeting === 'function' ? this.cfg.greeting() : this.cfg.greeting;
        html += `<div class="ai-msg bot">${mdRender(g)}</div>`;
        if (!this.state.key) {
          const isEn = window.I18N && I18N.lang === 'en';
          html += `<div class="ai-msg bot" style="background:linear-gradient(135deg,rgba(16,185,129,.18),rgba(16,185,129,.08));border:1px solid var(--accent);padding:14px;border-radius:14px">
            <div style="font-weight:800;font-size:14px;margin-bottom:6px">${isEn ? '🔑 One-time setup (2 minutes)' : '🔑 Однократная настройка (2 минуты)'}</div>
            <div style="font-size:13px;line-height:1.55;margin-bottom:10px">${isEn
              ? 'Get a free AI key on <b>Mistral</b> (no card, works in RU/BY). Done once — works in all 4 apps.'
              : 'Получи бесплатный AI-ключ на <b>Mistral</b> (без карты, работает в РБ/РФ). Один раз — работает во всех 4 приложениях.'}</div>
            <button id="ai-onb-go" style="background:var(--accent);color:var(--accent-text,#fff);border:none;padding:9px 16px;border-radius:99px;font-weight:800;cursor:pointer;font-family:inherit;font-size:13px">
              ${isEn ? '🚀 Get the key' : '🚀 Получить ключ'}
            </button>
          </div>`;
        }
      }
      this.state.messages.forEach(m => {
        if (m.error) {
          html += `<div class="ai-msg bot error">⚠ ${esc(m.text)}</div>`;
        } else if (m.role === 'user') {
          html += `<div class="ai-msg user">${esc(m.text)}</div>`;
        } else {
          // Бот → рендерим лёгкий markdown (**жирный**, *курсив*, списки, ссылки)
          html += `<div class="ai-msg bot">${mdRender(m.text)}</div>`;
        }
      });
      if (this.state.busy) {
        html += `<div class="ai-msg bot"><div class="ai-msg-typing"><span></span><span></span><span></span></div></div>`;
      }
      body.innerHTML = html;
      body.scrollTop = body.scrollHeight;
      // Подключаем CTA-кнопку онбординга на ключ
      const onbBtn = document.getElementById('ai-onb-go');
      if (onbBtn) onbBtn.onclick = () => this.openSettings();
    },

    _onSend() {
      const ta = document.getElementById('ai-input');
      const v = (ta.value || '').trim();
      if (!v) return;
      ta.value = '';
      ta.style.height = 'auto';
      this._send(v);
    },

    _resolveUserName() {
      try {
        if (typeof this.cfg.getUserName === 'function') {
          const v = this.cfg.getUserName();
          if (v) return v;
        }
        const u = this.cfg.getUser?.();
        if (u?.displayName) return u.displayName.split(/\s+/)[0];
        if (u?.email) return u.email.split('@')[0];
      } catch (e) {}
      return '';
    },

    _resolveLang() {
      if (window.I18N && I18N.lang === 'en') return 'en';
      return 'ru';
    },

    _buildBasePrompt() {
      const name = this._resolveUserName();
      const lang = this._resolveLang();
      if (lang === 'en') {
        return `You are a friendly, warm, conversational AI assistant inside ${this.cfg.appName || 'this'} app — part of the user's personal dashboard.
${name ? `The user's name is **${name}**. Address them by name naturally — not in every reply, but when it feels human (greetings, when the answer feels personal, when wrapping up).` : ''}

## Tone & personality
- Be a real friend, not a corporate bot. Warm, witty, supportive.
- Match the user's energy — if they're casual, be casual; if they're stressed, be calm and reassuring.
- Use a couple of emojis where natural, never spam them.
- Be brief by default (2-5 sentences). Long answers only when the question really needs depth.
- It's OK to disagree, to push back politely if their plan looks off, to suggest something better.

## Small talk
- If the user just says "how's it going / how are you / hi" — chat naturally. Reply something warm and human ("Pretty good — running fast as ever 💨. How about you, ${name || 'friend'}? What's the plan today?"). Don't lecture them about the app.
- You can chit-chat about anything — weather, mood, music, what they're working on — within reason. You're a personal assistant, not just an FAQ bot.

## When relevant, use app context
- You have access to live data from this app (tasks/transactions/contacts/etc). Use it when the question touches it. Quote specifics (names, amounts, dates) instead of generalities.
- If the question is general or off-topic from the app, just answer like a normal helpful AI.

Reply in English.`;
      }
      return `Ты — дружелюбный, тёплый, живой AI-собеседник внутри приложения ${this.cfg.appName || ''} — часть личного дашборда пользователя.
${name ? `Пользователя зовут **${name}**. Обращайся по имени естественно — не в каждом сообщении, а когда это уместно (приветствие, когда ответ личный, в конце мысли). Если уверен в склонении — склоняй (${name}, к ${name}у).` : ''}

## Тон и характер
- Будь настоящим другом, не корпоративным ботом. Тепло, с лёгким юмором, поддержка.
- Подстраивайся под энергию: если человек расслабленный — расслабленно, если переживает — мягко и спокойно.
- Эмодзи можно вставлять уместно (1-3 за ответ), не спамь.
- По умолчанию отвечай коротко (2-5 предложений). Длинно — только когда вопрос реально требует глубины.
- Можно мягко не соглашаться, предлагать альтернативу, если план человека выглядит сомнительно.

## Small talk
- Если человек просто пишет «как дела / привет / че там» — отвечай по-человечески. Без занудства про функционал. Например: «Да норм, бегаю по серверам как обычно 💨. У тебя как, ${name || 'друг'}? Что в планах сегодня?».
- Можно болтать на любые темы в разумных пределах — погода, настроение, музыка, чем занимаешься. Ты живой помощник, а не FAQ.

## Когда уместно — используй контекст приложения
- У тебя есть свежие данные из этого приложения (задачи/транзакции/контакты и т.д.). Опирайся на них, когда вопрос их касается. Цитируй конкретику (названия, суммы, даты) вместо общих фраз.
- Если вопрос общий или не про приложение — отвечай как обычный полезный AI.

Отвечай по-русски.`;
    },

    async _send(userText) {
      if (this.state.busy) return;
      if (!this.state.key) {
        this.openSettings();
        return;
      }
      this.state.messages.push({ role: 'user', text: userText });
      this._renderSuggestions();
      this._render();
      this.state.busy = true;
      this._render();
      try {
        const base = this._buildBasePrompt();
        const sys = (typeof this.cfg.systemPrompt === 'function') ? this.cfg.systemPrompt() : this.cfg.systemPrompt;
        const ctx = (typeof this.cfg.getContext === 'function') ? this.cfg.getContext() : (this.cfg.getContext || '');
        const fullSystem = base
          + '\n\n# ДОПОЛНИТЕЛЬНО ПРО ЭТОТ СЕРВИС\n' + (sys || '')
          + (ctx ? `\n\n# ЖИВЫЕ ДАННЫЕ ЭТОГО ПРИЛОЖЕНИЯ\n${ctx}` : '');
        // Только непустые non-error сообщения уходят в API
        // (иначе Mistral/OpenAI ломаются на "Assistant message must have either content or tool_calls")
        const history = this.state.messages
          .filter(m => !m.error && m.text && String(m.text).trim().length > 0)
          .slice(-12)
          .map(m => ({ role: m.role, content: String(m.text) }));
        const messages = [{ role: 'system', content: fullSystem }, ...history];
        const reply = await callAI(this.state.key, messages);
        if (!reply || !String(reply).trim()) throw new Error('Пустой ответ от AI. Попробуй ещё раз или переформулируй вопрос.');
        const processed = this._processActions(String(reply));
        const final = (processed && processed.trim()) ? processed : '✅ Готово.';
        this.state.messages.push({ role: 'assistant', text: final });
      } catch (e) {
        this.state.messages.push({ role: 'assistant', text: e.message || String(e), error: true });
      }
      this.state.busy = false;
      this._render();
      this._saveLocalHistory();
    },

    _processActions(text) {
      // Pattern: [[action:NAME|ARG]] — runs cfg.actionRunner(NAME, ARG), strips from text
      if (!this.cfg.actionRunner) return text;
      const hasToken = /\[\[action:[^\]]+\]\]/.test(text);
      const stripped = text.replace(/\[\[action:([^\|\]]+)\|?([^\]]*)\]\]/g, (m, name, arg) => {
        try { this.cfg.actionRunner(name.trim(), (arg || '').trim()); } catch (e) {}
        return '';
      }).trim();
      // Если был action-токен но текста рядом нет — отдадим осмысленную реплику
      if (hasToken && !stripped) return '✅ Открыл нужную запись.';
      return stripped || text.trim();
    }
  };

  window.AIAgent = AIAgent;
  window.AIAgent.detectProvider = detectProvider;
  window.AIAgent.providerLabel = providerLabel;
  window.AIAgent.callAI = callAI;
})();
