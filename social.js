/* ============================================================
   SOCIAL — friends + chat + activity feed
   Использует Firestore коллекции:
   - userEmails/{lowercase_email}   → { uid, name }
   - friends/{uid}                  → { sent: {targetUid: {ts, email}},
                                        received: {fromUid: {ts, email, name}},
                                        accepted: [{ uid, email, name, ts }] }
   - chats/{chatId}                 → { memberUids: [a, b], lastMsg, lastTs }
       chats/{chatId}/messages/{mid} → { fromUid, text, ts }
   - activities/{uid}               → { items: [{type, ts, text, payload}], shareEnabled: bool }
   ============================================================ */
(function () {
  'use strict';

  const Social = {
    cfg: null,
    state: {
      friends: { sent: {}, received: {}, accepted: [] },
      activeChat: null,    // {chatId, otherUid, otherName, unsub, messages: []}
      friendsUnsub: null,
      myActivities: null
    },

    init(cfg) {
      this.cfg = Object.assign({
        getDb: () => null,
        getUser: () => null
      }, cfg);
    },

    // ─── EMAIL → UID mapping ───────────────────────────────────
    async _registerMyEmail() {
      const db = this.cfg.getDb();
      const user = this.cfg.getUser();
      if (!db || !user?.email) return;
      const key = user.email.trim().toLowerCase();
      try {
        await db.collection('userEmails').doc(key).set({
          uid: user.uid,
          name: user.displayName || user.email,
          photoURL: user.photoURL || '',
          updatedAt: Date.now()
        });
      } catch (e) { console.warn('register email failed', e); }
    },

    async _lookupEmail(email) {
      const db = this.cfg.getDb();
      if (!db) return null;
      const key = email.trim().toLowerCase();
      try {
        const doc = await db.collection('userEmails').doc(key).get();
        if (doc.exists) return doc.data();
      } catch (e) {}
      return null;
    },

    // ─── FRIENDS ───────────────────────────────────────────────
    async loadFriends() {
      const db = this.cfg.getDb();
      const user = this.cfg.getUser();
      if (!db || !user) return;
      await this._registerMyEmail();
      const ref = db.collection('friends').doc(user.uid);
      if (this.state.friendsUnsub) this.state.friendsUnsub();
      this.state.friendsUnsub = ref.onSnapshot(doc => {
        if (doc.exists) {
          const d = doc.data();
          this.state.friends = {
            sent: d.sent || {},
            received: d.received || {},
            accepted: Array.isArray(d.accepted) ? d.accepted : []
          };
        } else {
          this.state.friends = { sent: {}, received: {}, accepted: [] };
        }
        if (this.cfg.onFriendsChange) this.cfg.onFriendsChange();
      }, err => console.warn('friends subscribe', err));
    },

    async sendFriendRequest(email) {
      const db = this.cfg.getDb();
      const user = this.cfg.getUser();
      if (!db || !user) throw new Error('Не залогинен');
      if (email.trim().toLowerCase() === user.email.toLowerCase()) throw new Error('Это твой email');
      const target = await this._lookupEmail(email);
      if (!target || !target.uid) throw new Error('Пользователь не найден. Он должен войти в дашборд хотя бы раз.');
      if (this.state.friends.accepted.find(f => f.uid === target.uid)) throw new Error('Уже в друзьях');
      const targetRef = db.collection('friends').doc(target.uid);
      const myRef = db.collection('friends').doc(user.uid);
      // Сохраняем в обе стороны
      await Promise.all([
        targetRef.set({
          received: { [user.uid]: { ts: Date.now(), email: user.email, name: user.displayName || user.email, photoURL: user.photoURL || '' } }
        }, { merge: true }),
        myRef.set({
          sent: { [target.uid]: { ts: Date.now(), email: target.email || email, name: target.name || '' } }
        }, { merge: true })
      ]);
      return target;
    },

    async acceptFriendRequest(fromUid) {
      const db = this.cfg.getDb();
      const user = this.cfg.getUser();
      if (!db || !user) return;
      const req = this.state.friends.received[fromUid];
      if (!req) return;
      const me = { uid: user.uid, email: user.email, name: user.displayName || user.email, photoURL: user.photoURL || '', ts: Date.now() };
      const them = { uid: fromUid, email: req.email, name: req.name, photoURL: req.photoURL || '', ts: Date.now() };
      const myRef = db.collection('friends').doc(user.uid);
      const theirRef = db.collection('friends').doc(fromUid);
      const myAccepted = [...this.state.friends.accepted.filter(f => f.uid !== fromUid), them];
      // У них в accepted — мы. Читаем их doc и приписываем.
      let theirAccepted = [];
      try {
        const td = await theirRef.get();
        if (td.exists) theirAccepted = (td.data().accepted || []).filter(f => f.uid !== user.uid);
      } catch (e) {}
      theirAccepted.push(me);

      await Promise.all([
        myRef.set({ accepted: myAccepted, received: { [fromUid]: firebase.firestore.FieldValue.delete() } }, { merge: true }),
        theirRef.set({ accepted: theirAccepted, sent: { [user.uid]: firebase.firestore.FieldValue.delete() } }, { merge: true })
      ]);
    },

    async declineFriendRequest(fromUid) {
      const db = this.cfg.getDb();
      const user = this.cfg.getUser();
      if (!db || !user) return;
      await db.collection('friends').doc(user.uid).set({
        received: { [fromUid]: firebase.firestore.FieldValue.delete() }
      }, { merge: true });
    },

    async removeFriend(uid) {
      const db = this.cfg.getDb();
      const user = this.cfg.getUser();
      if (!db || !user) return;
      const myAccepted = this.state.friends.accepted.filter(f => f.uid !== uid);
      await db.collection('friends').doc(user.uid).set({ accepted: myAccepted }, { merge: true });
      try {
        const td = await db.collection('friends').doc(uid).get();
        if (td.exists) {
          const theirAccepted = (td.data().accepted || []).filter(f => f.uid !== user.uid);
          await db.collection('friends').doc(uid).set({ accepted: theirAccepted }, { merge: true });
        }
      } catch (e) {}
    },

    // ─── CHAT ──────────────────────────────────────────────────
    _chatIdWith(otherUid) {
      const user = this.cfg.getUser();
      return [user.uid, otherUid].sort().join('_');
    },

    async openChatWith(otherUid, otherName) {
      const db = this.cfg.getDb();
      const user = this.cfg.getUser();
      if (!db || !user) return null;
      const chatId = this._chatIdWith(otherUid);
      const chatRef = db.collection('chats').doc(chatId);
      // Гарантируем, что чат существует
      try {
        await chatRef.set({
          memberUids: [user.uid, otherUid].sort(),
          updatedAt: Date.now()
        }, { merge: true });
      } catch (e) { console.warn('chat ensure', e); }

      // Закрываем предыдущий слушатель
      if (this.state.activeChat?.unsub) this.state.activeChat.unsub();
      const ac = { chatId, otherUid, otherName, messages: [], unsub: null };
      this.state.activeChat = ac;

      ac.unsub = chatRef.collection('messages').orderBy('ts', 'asc').limit(50).onSnapshot(snap => {
        ac.messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (this.cfg.onChatUpdate) this.cfg.onChatUpdate(ac);
      });
      return ac;
    },

    async sendChatMessage(text) {
      const db = this.cfg.getDb();
      const user = this.cfg.getUser();
      if (!db || !user || !this.state.activeChat) return;
      const ac = this.state.activeChat;
      const msg = { fromUid: user.uid, text: text.trim(), ts: Date.now() };
      if (!msg.text) return;
      await db.collection('chats').doc(ac.chatId).collection('messages').add(msg);
      await db.collection('chats').doc(ac.chatId).set({
        lastMsg: msg.text.slice(0, 60),
        lastTs: msg.ts,
        memberUids: [user.uid, ac.otherUid].sort()
      }, { merge: true });
    },

    closeChat() {
      if (this.state.activeChat?.unsub) this.state.activeChat.unsub();
      this.state.activeChat = null;
    },

    // ─── ACTIVITY FEED ─────────────────────────────────────────
    async publishActivity(type, text, payload) {
      const db = this.cfg.getDb();
      const user = this.cfg.getUser();
      if (!db || !user) return;
      const ref = db.collection('activities').doc(user.uid);
      try {
        const doc = await ref.get();
        const cur = doc.exists ? doc.data() : { items: [], shareEnabled: true };
        if (cur.shareEnabled === false) return; // юзер выключил шеринг
        cur.items = (cur.items || []);
        cur.items.unshift({
          type, text, payload: payload || {}, ts: Date.now(),
          author: { uid: user.uid, name: user.displayName || user.email, photoURL: user.photoURL || '' }
        });
        cur.items = cur.items.slice(0, 50); // последние 50
        await ref.set(cur, { merge: true });
      } catch (e) { console.warn('publishActivity', e); }
    },

    async setShareEnabled(on) {
      const db = this.cfg.getDb();
      const user = this.cfg.getUser();
      if (!db || !user) return;
      await db.collection('activities').doc(user.uid).set({ shareEnabled: !!on }, { merge: true });
    },

    async fetchFriendsFeed() {
      const db = this.cfg.getDb();
      if (!db) return [];
      const friends = this.state.friends.accepted || [];
      if (!friends.length) return [];
      const results = await Promise.all(friends.map(async f => {
        try {
          const doc = await db.collection('activities').doc(f.uid).get();
          if (!doc.exists) return [];
          const d = doc.data();
          if (d.shareEnabled === false) return [];
          return (d.items || []).map(it => ({ ...it, _friend: f }));
        } catch (e) { return []; }
      }));
      const all = results.flat().sort((a,b) => (b.ts||0) - (a.ts||0));
      return all.slice(0, 40);
    }
  };

  window.Social = Social;
})();
