/* ============================================================
   AI QUICK CAPTURE — единая кнопка «записать что угодно»
   Юзер пишет/говорит фразу → AI решает в какой апп оно идёт,
   вытаскивает структурированные поля → превью → confirm → Firestore.
   ============================================================ */
(function () {
  'use strict';

  const STYLES = `
    .qc-fab {
      position: fixed; bottom: 22px; right: 168px; z-index: 88;
      width: 60px; height: 60px; border-radius: 50%;
      border: none; cursor: pointer; font-size: 26px;
      background: linear-gradient(135deg, #FBBF24 0%, #F59E0B 100%);
      color: #1f1408;
      box-shadow: 0 8px 22px rgba(245,158,11,.45);
      display: flex; align-items: center; justify-content: center;
      transition: filter .15s, box-shadow .18s, transform .15s;
      font-family: var(--font, 'Nunito', sans-serif);
    }
    .qc-fab:hover { filter: brightness(1.06); box-shadow: 0 10px 28px rgba(245,158,11,.55); transform: translateY(-1px); }
    .qc-fab.hide { display: none; }
    @media (max-width: 768px) { .qc-fab { right: 142px; width: 54px; height: 54px; font-size: 22px; bottom: 18px; } }

    .qc-modal-bg {
      position: fixed; inset: 0; z-index: 200;
      background: rgba(0,0,0,.65);
      backdrop-filter: blur(6px);
      display: none; align-items: center; justify-content: center;
      padding: 20px;
    }
    .qc-modal-bg.show { display: flex; animation: qcFade .2s ease-out; }
    @keyframes qcFade { from { opacity: 0; } to { opacity: 1; } }

    .qc-modal {
      background: var(--s1, #14233F); border: 1px solid var(--border, #2F4575);
      border-radius: 24px; max-width: 560px; width: 100%;
      box-shadow: 0 30px 80px rgba(0,0,0,.6);
      overflow: hidden; font-family: var(--font, 'Nunito', sans-serif);
      animation: qcPop .25s ease-out;
    }
    @keyframes qcPop { from { opacity: 0; transform: translateY(20px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }

    .qc-head {
      padding: 16px 20px;
      background: linear-gradient(135deg, #FBBF24, #F59E0B);
      color: #1f1408; display: flex; justify-content: space-between; align-items: center;
    }
    .qc-title { font-weight: 800; font-size: 16px; }
    .qc-sub { font-size: 11px; opacity: .78; margin-top: 2px; }
    .qc-close {
      background: rgba(0,0,0,.18); border: none; color: #1f1408;
      width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 18px;
    }

    .qc-body { padding: 18px 20px; }
    .qc-input {
      width: 100%; box-sizing: border-box;
      background: var(--bg, #0A1525); border: 1.5px solid var(--border, #2F4575);
      border-radius: 16px; padding: 14px 16px;
      color: var(--text, #fff); font-family: inherit; font-size: 15px;
      outline: none; resize: vertical; min-height: 100px;
      transition: border-color .15s;
    }
    .qc-input:focus { border-color: var(--accent, #F59E0B); }

    .qc-examples { margin-top: 12px; font-size: 12px; color: var(--text3, #93A2C9); line-height: 1.55; }
    .qc-examples b { color: var(--text2, #D3DDF5); }

    .qc-actions { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; justify-content: flex-end; }
    .qc-btn {
      background: var(--accent, #F59E0B); color: #1f1408; border: none;
      padding: 11px 22px; border-radius: 12px; font-family: inherit;
      font-weight: 800; font-size: 14px; cursor: pointer;
      transition: filter .15s, box-shadow .15s;
    }
    .qc-btn:hover { filter: brightness(1.06); box-shadow: 0 4px 14px rgba(245,158,11,.45); }
    .qc-btn:disabled { opacity: .5; cursor: not-allowed; }
    .qc-btn-ghost {
      background: transparent; color: var(--text2, #93A2C9);
      border: 1px solid var(--border, #2F4575);
    }
    .qc-btn-ghost:hover { background: var(--s2, #1C2E50); color: var(--text, #fff); }

    .qc-preview {
      background: var(--s2, #1C2E50); border: 1px solid var(--border, #2F4575);
      border-radius: 16px; padding: 14px 16px; margin-top: 14px;
    }
    .qc-preview-app {
      display: inline-block; padding: 3px 10px; border-radius: 99px;
      font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
      margin-bottom: 8px;
    }
    .qc-preview-app.focus    { background: #3B82F6; color: #fff; }
    .qc-preview-app.wallet   { background: #0284C7; color: #fff; }
    .qc-preview-app.orbit    { background: #DB2777; color: #fff; }
    .qc-preview-app.unknown  { background: #6B7280; color: #fff; }
    .qc-preview-line {
      display: flex; gap: 8px; padding: 4px 0;
      font-size: 14px; color: var(--text, #fff);
    }
    .qc-preview-key { color: var(--text3, #93A2C9); min-width: 80px; font-family: var(--mono, inherit); font-size: 12px; }
    .qc-preview-val { color: var(--text, #fff); font-weight: 600; flex: 1; }

    .qc-state-loading { color: var(--text2, #93A2C9); font-size: 13px; padding: 16px 0; text-align: center; }
    .qc-state-error { color: #F87171; font-size: 13px; padding: 12px; border: 1px solid #F87171; border-radius: 10px; background: rgba(248,113,113,.08); margin-top: 12px; }
    .qc-state-ok { color: #10B981; font-size: 13px; padding: 12px; border: 1px solid #10B981; border-radius: 10px; background: rgba(16,185,129,.08); margin-top: 12px; font-weight: 700; text-align: center; }

    .qc-photo-row {
      display: flex; gap: 10px; margin-top: 12px; align-items: stretch;
    }
    .qc-photo-btn {
      background: transparent; border: 1.5px dashed var(--border, #2F4575);
      color: var(--text2, #93A2C9); padding: 10px 14px;
      border-radius: 12px; font-family: inherit; font-size: 13px;
      cursor: pointer; flex: 1;
      transition: border-color .15s, color .15s, background .15s;
      display: flex; align-items: center; justify-content: center; gap: 6px;
    }
    .qc-photo-btn:hover { border-color: #F59E0B; color: #F59E0B; background: rgba(245,158,11,.05); }
    .qc-photo-preview {
      position: relative; max-width: 100%; margin-top: 12px;
      border: 1.5px solid var(--accent, #F59E0B); border-radius: 14px; overflow: hidden;
      display: none;
    }
    .qc-photo-preview.show { display: block; }
    .qc-photo-preview img { display: block; width: 100%; max-height: 200px; object-fit: cover; }
    .qc-photo-remove {
      position: absolute; top: 8px; right: 8px;
      background: rgba(0,0,0,.65); border: none; color: #fff;
      width: 28px; height: 28px; border-radius: 50%; cursor: pointer;
      font-size: 16px; display: flex; align-items: center; justify-content: center;
    }
    .qc-photo-badge {
      position: absolute; bottom: 8px; left: 8px;
      background: rgba(0,0,0,.7); color: #fff;
      padding: 3px 9px; border-radius: 99px; font-size: 10px;
      font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
    }
  `;

  function injectStyles() {
    if (document.getElementById('qc-styles')) return;
    const s = document.createElement('style');
    s.id = 'qc-styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  function tt(ru, en) { return (window.I18N && I18N.lang === 'en') ? en : ru; }

  const QC = {
    cfg: null,
    state: { busy: false, parsed: null, error: null, ok: null },

    init(cfg) {
      this.cfg = Object.assign({
        getDb: () => null,
        getUser: () => null,
        getAIKey: () => (window.AIAgent?.state?.key || '')
      }, cfg);
      injectStyles();
      this._mountFab();
      this._mountModal();
    },

    _mountFab() {
      if (document.getElementById('qc-fab')) return;
      const b = document.createElement('button');
      b.id = 'qc-fab';
      b.className = 'qc-fab';
      b.title = tt('Quick Capture — записать что угодно', 'Quick Capture — log anything');
      b.textContent = '✨';
      b.onclick = () => this.open();
      document.body.appendChild(b);
    },

    _mountModal() {
      if (document.getElementById('qc-modal-bg')) return;
      const bg = document.createElement('div');
      bg.id = 'qc-modal-bg';
      bg.className = 'qc-modal-bg';
      bg.innerHTML = `
        <div class="qc-modal" id="qc-modal">
          <div class="qc-head">
            <div>
              <div class="qc-title">${tt('✨ Quick Capture','✨ Quick Capture')}</div>
              <div class="qc-sub">${tt('Опиши что угодно — AI разложит по приложениям','Describe anything — AI routes it to the right app')}</div>
            </div>
            <button class="qc-close" id="qc-close">×</button>
          </div>
          <div class="qc-body">
            <textarea class="qc-input" id="qc-input" placeholder="${esc(tt('Например: «купил кофе за 5 руб», «Маша Иванова дизайнер 1995-05-12», «доделать презентацию к четвергу»...', 'For example: "bought coffee for 5", "Maria Smith designer 1995-05-12", "finish presentation by Thursday"...'))}" rows="4"></textarea>
            <div class="qc-photo-row" id="qc-photo-row">
              <button class="qc-photo-btn" id="qc-photo-btn" type="button">📸 ${tt('Прикрепить фото (визитка, чек, афиша)','Attach photo (card, receipt, poster)')}</button>
            </div>
            <input type="file" id="qc-photo-input" accept="image/*" capture="environment" hidden>
            <div class="qc-photo-preview" id="qc-photo-preview">
              <img id="qc-photo-img" alt="">
              <span class="qc-photo-badge">📸 ${tt('AI Vision','AI Vision')}</span>
              <button class="qc-photo-remove" id="qc-photo-remove" type="button" title="${tt('Убрать','Remove')}">×</button>
            </div>
            <div class="qc-examples">
              <b>${tt('Что я понимаю:','I understand:')}</b><br>
              💸 <b>${tt('Траты/доходы','Expenses/income')}</b> — ${tt('«купил X за Y», «получил зарплату 3000»','"bought X for Y", "got salary 3000"')}<br>
              ✅ <b>${tt('Задачи','Tasks')}</b> — ${tt('«доделать X», «позвонить Y до пятницы»','"finish X", "call Y by Friday"')}<br>
              👤 <b>${tt('Контакты','Contacts')}</b> — ${tt('«Имя Фамилия, ДР, профессия, заметки»','"Name Surname, birthday, role, notes"')}<br>
              📝 <b>${tt('Заметки','Notes')}</b> — ${tt('«идея: X», «запомни Y»','"idea: X", "remember Y"')}
            </div>
            <div id="qc-output"></div>
            <div class="qc-actions" id="qc-actions">
              <button class="qc-btn-ghost qc-btn" id="qc-cancel">${tt('Отмена','Cancel')}</button>
              <button class="qc-btn" id="qc-parse">${tt('🤖 Разобрать','🤖 Parse')}</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(bg);
      document.getElementById('qc-close').onclick = () => this.close();
      document.getElementById('qc-cancel').onclick = () => this.close();
      document.getElementById('qc-parse').onclick = () => this._onParse();
      bg.addEventListener('click', e => { if (e.target === bg) this.close(); });
      // Enter (Ctrl/Cmd+Enter) → parse
      document.getElementById('qc-input').addEventListener('keydown', e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); this._onParse(); }
      });

      // Photo input
      const photoBtn = document.getElementById('qc-photo-btn');
      const photoInput = document.getElementById('qc-photo-input');
      const photoPreview = document.getElementById('qc-photo-preview');
      const photoImg = document.getElementById('qc-photo-img');
      const photoRemove = document.getElementById('qc-photo-remove');
      photoBtn.onclick = () => photoInput.click();
      photoInput.addEventListener('change', async e => {
        const f = e.target.files?.[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = ev => {
          this.state.photoDataUrl = ev.target.result;
          photoImg.src = this.state.photoDataUrl;
          photoPreview.classList.add('show');
        };
        reader.readAsDataURL(f);
        e.target.value = '';
      });
      photoRemove.onclick = () => {
        this.state.photoDataUrl = null;
        photoPreview.classList.remove('show');
      };
    },

    open() {
      this.state = { busy: false, parsed: null, error: null, ok: null, photoDataUrl: null };
      this._render();
      document.getElementById('qc-modal-bg').classList.add('show');
      // Сбрасываем фото-превью при открытии
      const pp = document.getElementById('qc-photo-preview');
      if (pp) pp.classList.remove('show');
      setTimeout(() => document.getElementById('qc-input')?.focus(), 80);
    },
    close() {
      document.getElementById('qc-modal-bg').classList.remove('show');
      this.state.photoDataUrl = null;
      const pp = document.getElementById('qc-photo-preview');
      if (pp) pp.classList.remove('show');
    },

    async _onParse() {
      const input = document.getElementById('qc-input').value.trim();
      const photo = this.state.photoDataUrl;
      if (!input && !photo) {
        this.state.error = tt('Введи текст или прикрепи фото','Type something or attach a photo');
        this._render();
        return;
      }
      const key = this.cfg.getAIKey();
      if (!key) {
        this.state.error = tt('Нужен AI-ключ. Нажми 💬 → шестерёнку.','AI key required. Tap 💬 → gear.');
        this._render();
        if (window.AIAgent) AIAgent.openSettings();
        return;
      }
      this.state.busy = true; this.state.error = null; this.state.parsed = null;
      this._render();
      try {
        const parsed = photo
          ? await this._classifyWithVision(input, photo, key)
          : await this._classifyWithAI(input, key);
        this.state.parsed = parsed;
      } catch (e) {
        this.state.error = e.message;
      }
      this.state.busy = false;
      this._render();
    },

    _buildClassifyPrompt(input, withPhoto) {
      return `Ты — роутер для личного дашборда. ${withPhoto ? 'Тебе дали фото + опциональный комментарий.' : 'Пользователь пишет короткую фразу.'} Реши тип записи и извлеки поля.

${withPhoto ? `На фото может быть:
- чек / счёт → "transaction" (вытащи сумму, валюту, продавца как note, дату)
- визитка / контакт → "contact" (имя, профессия, телефон/email → notes, адрес → location)
- афиша / приглашение / постер события → "task" (title с названием события, dueDate с датой)
- скриншот переписки / экрана → "note" (краткое содержание в content)
- произведение, книга, фильм → "note" с упоминанием

` : ''}ВХОДНАЯ ФРАЗА: """${input || '(пусто, ориентируйся на фото)'}"""

ТИПЫ:
1) "task" — задача. Поля: title, dueDate (YYYY-MM-DD или null)
2) "transaction" — трата/доход. Поля: type ("expense"|"income"), amount, currency ("BYN"|"USD"|"EUR"), note, categoryHint
3) "contact" — контакт. Поля: name, birthday (YYYY-MM-DD или null), occupation, location, notes
4) "note" — заметка. Поля: content
5) "unknown" — не получается классифицировать

Верни СТРОГО JSON, без markdown, без преамбулы:
{ "type": "...", "fields": {...}, "summary": "одной строкой что записываем" }`;
    },

    async _classifyWithAI(input, key) {
      const prompt = this._buildClassifyPrompt(input, false);
      const provider = window.AIAgent.detectProvider(key);
      if (!provider) throw new Error('Unknown key format');
      const reply = await window.AIAgent.callAI(key, [
        { role: 'system', content: 'You are a precise JSON-only classification API. Return only valid JSON.' },
        { role: 'user', content: prompt }
      ]);
      return this._parseJsonReply(reply);
    },

    async _classifyWithVision(input, dataUrl, key) {
      // Mistral Vision (pixtral) — единственный из наших провайдеров с vision
      const provider = window.AIAgent.detectProvider(key);
      if (provider !== 'mistral') {
        throw new Error(tt(
          'Фото-распознавание работает только на Mistral-ключе. У тебя другой провайдер.',
          'Photo recognition works only with a Mistral key. You have a different provider.'
        ));
      }
      const prompt = this._buildClassifyPrompt(input, true);
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'pixtral-12b-2409',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: dataUrl }
            ]
          }],
          temperature: 0.2,
          max_tokens: 600
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error?.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      return this._parseJsonReply(text);
    },

    _parseJsonReply(reply) {
      if (!reply) throw new Error('Empty response');
      const clean = String(reply).replace(/^[\s\S]*?(\{[\s\S]+\})[\s\S]*$/, '$1');
      try { return JSON.parse(clean); }
      catch (e) { throw new Error('AI вернул не-JSON: ' + String(reply).slice(0, 120)); }
    },

    async _saveParsed() {
      const db = this.cfg.getDb();
      const user = this.cfg.getUser();
      if (!db || !user) { this.state.error = 'Не залогинен'; this._render(); return; }
      const p = this.state.parsed;
      if (!p || p.type === 'unknown') return;

      this.state.busy = true; this._render();
      try {
        if (p.type === 'task') {
          await this._appendToFocus(db, user, p.fields);
        } else if (p.type === 'transaction') {
          await this._appendToWallet(db, user, p.fields);
        } else if (p.type === 'contact') {
          await this._appendToOrbit(db, user, p.fields);
        } else if (p.type === 'note') {
          await this._appendToFocusNote(db, user, p.fields);
        }
        this.state.ok = p.summary || tt('Сохранено','Saved');
        this.state.parsed = null;
        document.getElementById('qc-input').value = '';
      } catch (e) {
        this.state.error = e.message;
      }
      this.state.busy = false;
      this._render();
      // Автозакрытие через 1.6с
      setTimeout(() => {
        if (this.state.ok) this.close();
      }, 1600);
    },

    async _appendToFocus(db, user, f) {
      const ref = db.collection('users').doc(user.uid);
      const doc = await ref.get();
      const data = doc.exists ? doc.data() : { state: {} };
      const state = data.state || {};
      if (!Array.isArray(state.projects) || !state.projects.length) {
        state.projects = [{ id: Date.now(), workspaceId: 1, name: '📥 Inbox', icon: '📥', tasks: [] }];
      }
      const target = state.projects[0];
      target.tasks = target.tasks || [];
      target.tasks.unshift({
        id: Date.now() + Math.floor(Math.random()*1000),
        text: f.title || 'Без названия',
        status: 'plan',
        priority: null,
        dueDate: f.dueDate || null,
        tags: [],
        links: [],
        subtasks: [],
        notes: '',
        createdAt: Date.now(),
        completedAt: null
      });
      await ref.set({ state, updatedAt: Date.now() }, { merge: true });
    },

    async _appendToFocusNote(db, user, f) {
      const ref = db.collection('users').doc(user.uid);
      const doc = await ref.get();
      const data = doc.exists ? doc.data() : { state: {} };
      const state = data.state || {};
      if (!Array.isArray(state.notesPages) || !state.notesPages.length) {
        state.notesPages = [{ id: Date.now(), content: '' }];
      }
      const page = state.notesPages[0];
      const stamp = new Date().toISOString().slice(0,10);
      page.content = (page.content ? page.content + '\n\n' : '') + `[${stamp}] ${f.content || ''}`;
      await ref.set({ state, updatedAt: Date.now() }, { merge: true });
    },

    async _appendToWallet(db, user, f) {
      const ref = db.collection('wallets').doc(user.uid);
      const doc = await ref.get();
      const data = doc.exists ? doc.data() : { state: {} };
      const state = data.state || {};
      if (!Array.isArray(state.transactions)) state.transactions = [];
      if (!Array.isArray(state.categories)) state.categories = [];
      // Найти/назначить категорию по hint
      let cat = (state.categories || []).find(c =>
        c.type === (f.type === 'income' ? 'income' : 'expense') &&
        c.name.toLowerCase().includes((f.categoryHint || '').toLowerCase())
      );
      if (!cat) {
        cat = (state.categories || []).find(c => c.type === (f.type === 'income' ? 'income' : 'expense'))
          || { id: 'other', name: 'Прочее', icon: '📦', type: f.type === 'income' ? 'income' : 'expense' };
      }
      state.transactions.unshift({
        id: Date.now() + Math.floor(Math.random()*1000),
        amount: parseFloat(f.amount) || 0,
        currency: f.currency || state.currency || 'BYN',
        type: f.type === 'income' ? 'income' : 'expense',
        categoryId: cat.id,
        date: new Date().toISOString(),
        note: f.note || ''
      });
      await ref.set({ state, updatedAt: Date.now() }, { merge: true });
    },

    async _appendToOrbit(db, user, f) {
      const ref = db.collection('orbits').doc(user.uid);
      const doc = await ref.get();
      const data = doc.exists ? doc.data() : { state: {} };
      const state = data.state || {};
      if (!Array.isArray(state.contacts)) state.contacts = [];
      state.contacts.unshift({
        id: 'c_' + Date.now() + '_' + Math.floor(Math.random()*999),
        name: f.name || 'Без имени',
        birthday: f.birthday || '',
        occupation: f.occupation || '',
        location: f.location || '',
        notes: f.notes || '',
        circle: 'friend',
        interests: [],
        createdAt: Date.now()
      });
      await ref.set({ state, updatedAt: Date.now() }, { merge: true });
    },

    _render() {
      const out = document.getElementById('qc-output');
      const actions = document.getElementById('qc-actions');
      if (!out) return;
      if (this.state.busy) {
        out.innerHTML = `<div class="qc-state-loading">🤖 ${tt('Думаю...','Thinking...')}</div>`;
        actions.innerHTML = `<button class="qc-btn-ghost qc-btn" disabled>${tt('Отмена','Cancel')}</button>`;
        return;
      }
      if (this.state.ok) {
        out.innerHTML = `<div class="qc-state-ok">✓ ${esc(this.state.ok)}</div>`;
        actions.innerHTML = '';
        return;
      }
      if (this.state.error) {
        out.innerHTML = `<div class="qc-state-error">⚠ ${esc(this.state.error)}</div>`;
      } else {
        out.innerHTML = '';
      }
      if (this.state.parsed) {
        const p = this.state.parsed;
        const labels = { task: ['✅', 'FOCUS', 'focus'], transaction: ['💸', 'WALLET', 'wallet'], contact: ['👤', 'ORBIT', 'orbit'], note: ['📝', 'FOCUS · заметка', 'focus'], unknown: ['❔', 'Не понял', 'unknown'] };
        const [ic, lab, cls] = labels[p.type] || labels.unknown;
        const fieldRows = Object.entries(p.fields || {}).filter(([_, v]) => v != null && v !== '').map(([k, v]) => `
          <div class="qc-preview-line">
            <div class="qc-preview-key">${esc(k)}</div>
            <div class="qc-preview-val">${esc(String(v))}</div>
          </div>
        `).join('');
        out.innerHTML += `<div class="qc-preview">
          <div class="qc-preview-app ${cls}">${ic} ${esc(lab)}</div>
          ${fieldRows || '<div class="qc-state-error">' + tt('Не получилось разобрать. Перефразируй.','Could not parse. Rephrase.') + '</div>'}
        </div>`;
        actions.innerHTML = p.type === 'unknown'
          ? `<button class="qc-btn-ghost qc-btn" id="qc-cancel">${tt('Отмена','Cancel')}</button>
             <button class="qc-btn" id="qc-parse">${tt('🤖 Попробовать снова','🤖 Retry')}</button>`
          : `<button class="qc-btn-ghost qc-btn" id="qc-cancel">${tt('Отмена','Cancel')}</button>
             <button class="qc-btn" id="qc-save">✅ ${tt('Сохранить','Save')}</button>`;
        const cancelBtn = document.getElementById('qc-cancel');
        const saveBtn = document.getElementById('qc-save');
        const parseBtn = document.getElementById('qc-parse');
        if (cancelBtn) cancelBtn.onclick = () => this.close();
        if (saveBtn)   saveBtn.onclick = () => this._saveParsed();
        if (parseBtn)  parseBtn.onclick = () => this._onParse();
      } else {
        actions.innerHTML = `<button class="qc-btn-ghost qc-btn" id="qc-cancel">${tt('Отмена','Cancel')}</button>
                             <button class="qc-btn" id="qc-parse">${tt('🤖 Разобрать','🤖 Parse')}</button>`;
        document.getElementById('qc-cancel').onclick = () => this.close();
        document.getElementById('qc-parse').onclick = () => this._onParse();
      }
    }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  window.QuickCapture = QC;
})();
