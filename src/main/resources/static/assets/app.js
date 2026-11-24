/* TicketHub: single-page UI served by Spring Boot (same origin as the REST API).
 * Works on localhost, on the LAN IP (phone) and through ngrok without any change.
 * The JWT is kept in the browser and sent as "Authorization: Bearer <token>" by fetch(). */
(() => {
  'use strict';

  /* ---------- small helpers ---------- */
  const TOKEN_KEY = 'tickethub.token';
  const memory = {};
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return memory[k] || null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { memory[k] = v; } },
    remove(k) { try { localStorage.removeItem(k); } catch (e) { delete memory[k]; } }
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => 'Rs. ' + Number(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = iso => {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  };

  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeJwt(token) {
    try {
      const [h, p] = token.split('.');
      return { header: JSON.parse(b64urlDecode(h)), payload: JSON.parse(b64urlDecode(p)) };
    } catch (e) { return null; }
  }
  function isExpired(token) {
    const j = decodeJwt(token);
    return !j || !j.payload.exp || j.payload.exp * 1000 <= Date.now();
  }

  /* ---------- state ---------- */
  const state = {
    token: null,
    user: null,            // { username, fullName, role }
    tab: 'events',
    authMode: 'login',
    notice: '',
    loading: false,
    keyword: '',
    events: [],
    reservations: [],
    users: [],
    stats: null,
    jwtEdit: '',           // text of the JWT tamper box
    jwtResult: null        // { ok, status, text }
  };

  /* ---------- API (same origin, so it works on localhost, LAN IP and ngrok) ---------- */
  async function api(path, { method = 'GET', body, token = state.token } = {}) {
    const headers = { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
    if (!res.ok) {
      if (res.status === 401 && token === state.token && state.token && !path.startsWith('/api/auth/')) {
        logout('Session expired or token rejected - please log in again.');
      }
      const err = new Error((data && data.message) || ('HTTP ' + res.status));
      err.status = res.status;
      err.details = (data && data.details) || [];
      throw err;
    }
    return data;
  }

  function errorText(e) {
    const extra = e.details && e.details.length ? ' (' + e.details.join('; ') + ')' : '';
    return (e.status ? e.status + ' - ' : '') + e.message + extra;
  }

  /* ---------- toasts, modal ---------- */
  function toast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), type === 'error' ? 6000 : 3500);
  }
  function handleError(e) {
    if (e && e.status === 401 && !state.user) return;      // already logged out
    toast(errorText(e), 'error');
  }

  function closeModal() { $('#modal-root').innerHTML = ''; }

  function openModal({ title, bodyHtml, submitLabel = 'Save', danger = false, onOpen, onSubmit }) {
    const root = $('#modal-root');
    root.innerHTML =
      '<div class="overlay" data-overlay>' +
        '<form class="modal" novalidate role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
          '<h2>' + esc(title) + '</h2>' +
          '<div>' + bodyHtml + '</div>' +
          '<p class="form-error" hidden></p>' +
          '<div class="modal-actions">' +
            '<button type="button" class="btn ghost" data-close>Cancel</button>' +
            '<button type="submit" class="btn ' + (danger ? 'danger' : 'primary') + '">' + esc(submitLabel) + '</button>' +
          '</div>' +
        '</form>' +
      '</div>';
    const form = $('form', root);
    const errEl = $('.form-error', root);
    const submitBtn = $('button[type=submit]', root);

    root.firstElementChild.addEventListener('mousedown', ev => { if (ev.target.hasAttribute('data-overlay')) closeModal(); });
    $('[data-close]', root).addEventListener('click', closeModal);
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      errEl.hidden = true;
      submitBtn.disabled = true;
      try {
        await onSubmit(new FormData(form));
        closeModal();
      } catch (e) {
        errEl.textContent = errorText(e);
        errEl.hidden = false;
        submitBtn.disabled = false;
      }
    });
    if (onOpen) onOpen(form);
    const first = form.querySelector('input, select');
    if (first) first.focus();
  }

  function confirmDialog(title, message, okLabel = 'Yes') {
    return new Promise(resolve => {
      let answered = false;
      openModal({
        title, bodyHtml: '<p>' + esc(message) + '</p>', submitLabel: okLabel, danger: true,
        onSubmit: async () => { answered = true; resolve(true); }
      });
      // resolve(false) when the dialog is dismissed without confirming
      const watcher = new MutationObserver(() => {
        if (!$('#modal-root .modal')) { watcher.disconnect(); if (!answered) resolve(false); }
      });
      watcher.observe($('#modal-root'), { childList: true });
    });
  }

  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeModal(); });

  /* ---------- session ---------- */
  async function doLogin(username, password) {
    const data = await api('/api/auth/login', { method: 'POST', body: { username, password }, token: null });
    state.token = data.token;
    store.set(TOKEN_KEY, data.token);
    state.user = { username: data.username, fullName: data.fullName, role: data.role };
    state.notice = '';
    state.tab = 'events';
    state.jwtEdit = data.token;
    state.jwtResult = null;
    await loadTab();
  }

  function logout(msg) {
    state.token = null;
    state.user = null;
    state.events = []; state.reservations = []; state.users = []; state.stats = null;
    state.notice = msg || '';
    state.jwtResult = null;
    store.remove(TOKEN_KEY);
    closeModal();
    render();
  }

  /* ---------- data loading ---------- */
  async function loadTab() {
    if (!state.user) return;
    state.loading = true;
    render();
    try {
      const role = state.user.role;
      if (state.tab === 'events') {
        state.events = await api('/api/events' + (state.keyword ? '?keyword=' + encodeURIComponent(state.keyword) : ''));
      } else if (state.tab === 'reservations') {
        state.reservations = await api(role === 'CUSTOMER' ? '/api/reservations/my' : '/api/reservations');
      } else if (state.tab === 'users') {
        state.users = await api('/api/admin/users');
      } else if (state.tab === 'stats') {
        state.stats = await api('/api/admin/stats');
      }
    } catch (e) {
      handleError(e);
    } finally {
      state.loading = false;
      render();
    }
  }

  /* ---------- views ---------- */
  function render() {
    const app = $('#app');
    if (!state.user) { app.innerHTML = loginView(); return; }
    app.innerHTML = shellView();
  }

  function loginView() {
    const reg = state.authMode === 'register';
    return '<div class="auth-wrap"><div class="auth-card">' +
      '<div class="logo">🎟️ TicketHub</div>' +
      '<p class="sub">Browse events, book tickets, manage everything.</p>' +
      (state.notice ? '<p class="notice">' + esc(state.notice) + '</p>' : '') +
      '<div class="seg">' +
        '<button type="button" data-action="auth-mode" data-id="login" class="' + (!reg ? 'active' : '') + '">Log in</button>' +
        '<button type="button" data-action="auth-mode" data-id="register" class="' + (reg ? 'active' : '') + '">Register</button>' +
      '</div>' +
      '<form data-form="' + (reg ? 'register' : 'login') + '" novalidate>' +
        '<label>Username<input name="username" autocomplete="username" autocapitalize="none" required></label>' +
        (reg ? '<label>Full name<input name="fullName" autocomplete="name" required></label>' : '') +
        '<label>Password<input name="password" type="password" autocomplete="' + (reg ? 'new-password' : 'current-password') + '" required></label>' +
        '<p class="form-error" id="auth-error" hidden></p>' +
        '<button class="btn primary block" type="submit">' + (reg ? 'Create customer account' : 'Log in') + '</button>' +
      '</form>' +
      (reg
        ? '<p class="lead" style="margin-top:12px">Public registration always creates a CUSTOMER account. Only an ADMIN can create ORGANIZER or ADMIN accounts.</p>'
        : '<div class="demo"><p>Demo accounts: tap to fill the form</p><div class="demo-btns">' +
            '<button type="button" class="btn" data-action="demo" data-id="admin">admin</button>' +
            '<button type="button" class="btn" data-action="demo" data-id="organizer">organizer</button>' +
            '<button type="button" class="btn" data-action="demo" data-id="customer">customer</button>' +
          '</div></div>') +
      '</div></div>';
  }

  function tabsFor(role) {
    const t = [['events', '🎫 Events']];
    t.push(['reservations', role === 'CUSTOMER' ? '🧾 My reservations' : '🧾 Reservations']);
    if (role === 'ADMIN') { t.push(['users', '👥 Users']); t.push(['stats', '📊 Statistics']); }
    t.push(['jwt', '🔑 JWT']);
    return t;
  }

  function shellView() {
    const u = state.user;
    const tabs = tabsFor(u.role).map(([id, label]) =>
      '<button class="tab ' + (state.tab === id ? 'active' : '') + '" data-action="tab" data-id="' + id + '">' + label + '</button>').join('');
    let body;
    if (state.tab === 'jwt') body = jwtView();
    else if (state.loading) body = '<p class="empty">Loading...</p>';
    else if (state.tab === 'events') body = eventsView();
    else if (state.tab === 'reservations') body = reservationsView();
    else if (state.tab === 'users') body = usersView();
    else if (state.tab === 'stats') body = statsView();
    return '<header class="topbar"><div class="brand">🎟️ TicketHub</div>' +
      '<div class="who"><span class="chip">' + esc(u.username) + ' · ' + esc(u.role) + '</span>' +
      '<button class="btn ghost" data-action="logout">Logout</button></div></header>' +
      '<nav class="tabs">' + tabs + '</nav><main class="content">' + body + '</main>';
  }

  /* ----- events ----- */
  function eventsView() {
    const role = state.user.role;
    const staff = role === 'ADMIN' || role === 'ORGANIZER';
    const cards = state.events.map(eventCard).join('');
    return '<div class="toolbar">' +
      '<form data-form="search"><input name="keyword" type="search" placeholder="Search events..." value="' + esc(state.keyword) + '">' +
      '<button class="btn" type="submit">Search</button></form>' +
      (staff ? '<button class="btn primary" data-action="new-event">+ New event</button>' : '') +
      '</div>' +
      (state.events.length ? '<div class="grid">' + cards + '</div>' : '<p class="empty">No events found.</p>');
  }

  function eventCard(e) {
    const role = state.user.role, me = state.user.username;
    const total = e.totalSeats, avail = e.availableSeats, booked = total - avail;
    const pct = total ? Math.round(booked / total * 100) : 0;
    const level = avail === 0 ? 'bad' : (avail <= Math.max(1, Math.floor(total * 0.1)) ? 'warn' : 'ok');
    const id = esc(e.id);
    const actions = [];
    if (role === 'CUSTOMER') {
      actions.push('<button class="btn primary" data-action="book" data-id="' + id + '"' + (avail === 0 ? ' disabled' : '') + '>Book tickets</button>');
    }
    if (role === 'ADMIN' || (role === 'ORGANIZER' && e.organizer === me)) {
      actions.push('<button class="btn" data-action="edit-event" data-id="' + id + '">Edit</button>');
    }
    if (role === 'ADMIN') {
      actions.push('<button class="btn danger-ghost" data-action="delete-event" data-id="' + id + '">Delete</button>');
    }
    return '<article class="card">' +
      '<header><h3>' + esc(e.name) + '</h3><span class="badge ' + level + '">' + (avail === 0 ? 'Sold out' : avail + ' available') + '</span></header>' +
      '<p class="meta">📍 ' + esc(e.venue) + '</p>' +
      '<p class="meta">🕒 ' + esc(fmtDate(e.eventDate)) + '</p>' +
      '<p class="meta">👤 ' + esc(e.organizer) + '</p>' +
      (e.description ? '<p class="desc">' + esc(e.description) + '</p>' : '') +
      '<div class="meter ' + (level === 'ok' ? '' : level) + '" role="progressbar" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + booked + '"><span style="width:' + pct + '%"></span></div>' +
      '<div class="row"><span>' + booked + '/' + total + ' booked</span><strong>' + money(e.ticketPrice) + '</strong></div>' +
      (actions.length ? '<div class="actions">' + actions.join('') + '</div>' : '') +
      '</article>';
  }

  /* ----- reservations ----- */
  function reservationsView() {
    const role = state.user.role;
    const staffView = role !== 'CUSTOMER';
    const title = role === 'CUSTOMER' ? 'My reservations' : (role === 'ADMIN' ? 'All reservations' : 'Reservations for my events');
    const cards = state.reservations.map(r => {
      const confirmed = r.status === 'CONFIRMED';
      const canChange = confirmed && (role === 'CUSTOMER' || role === 'ADMIN');
      const id = esc(r.id);
      return '<article class="card">' +
        '<header><h3>' + esc(r.eventName) + '</h3><span class="badge ' + (confirmed ? 'ok' : 'bad') + '">' + esc(r.status) + '</span></header>' +
        '<p class="meta">🎟️ ' + esc(r.reservationCode) + '</p>' +
        (staffView ? '<p class="meta">👤 ' + esc(r.customer) + '</p>' : '') +
        '<p class="meta">🕒 booked ' + esc(fmtDate(r.createdAt)) + '</p>' +
        '<div class="row"><span>' + r.seats + ' seat' + (r.seats === 1 ? '' : 's') + '</span><strong>' + money(r.totalAmount) + '</strong></div>' +
        (canChange
          ? '<div class="actions"><button class="btn" data-action="edit-res" data-id="' + id + '">Change seats</button>' +
            '<button class="btn danger-ghost" data-action="cancel-res" data-id="' + id + '">Cancel</button></div>'
          : '') +
        '</article>';
    }).join('');
    return '<h2 class="section-title">' + title + '</h2>' +
      (state.reservations.length ? '<div class="grid">' + cards + '</div>' : '<p class="empty">No reservations yet.</p>');
  }

  /* ----- users (admin) ----- */
  function usersView() {
    const cards = state.users.map(u => {
      const id = esc(u.id);
      const self = u.username === state.user.username;
      const cls = u.role === 'ADMIN' ? 'bad' : (u.role === 'ORGANIZER' ? 'info' : 'ok');
      return '<article class="card">' +
        '<header><h3>' + esc(u.username) + (self ? ' <span class="muted">(you)</span>' : '') + '</h3><span class="badge ' + cls + '">' + esc(u.role) + '</span></header>' +
        '<p class="meta">' + esc(u.fullName) + '</p>' +
        '<div class="actions"><button class="btn" data-action="edit-user" data-id="' + id + '">Edit</button>' +
        '<button class="btn danger-ghost" data-action="delete-user" data-id="' + id + '">Delete</button></div>' +
        '</article>';
    }).join('');
    return '<div class="toolbar"><h2 class="section-title" style="flex:1;margin:0;align-self:center">Users</h2>' +
      '<button class="btn primary" data-action="new-user">+ New user</button></div>' +
      (state.users.length ? '<div class="grid">' + cards + '</div>' : '<p class="empty">No users.</p>');
  }

  /* ----- statistics (admin) ----- */
  function statsView() {
    const s = state.stats;
    if (!s) return '<p class="empty">No statistics.</p>';
    const tile = (n, l) => '<div class="stat"><div class="num">' + esc(n) + '</div><div class="lbl">' + esc(l) + '</div></div>';
    return '<h2 class="section-title">System statistics</h2><div class="stats">' +
      tile(s.totalUsers, 'Users') +
      tile(s.totalEvents, 'Events') +
      tile(s.totalReservations, 'Reservations (all)') +
      tile(s.confirmedReservations, 'Confirmed reservations') +
      tile(s.ticketsSold, 'Tickets sold') +
      tile(money(s.revenue), 'Revenue') + '</div>';
  }

  /* ----- JWT inspector ----- */
  function jwtView() {
    const token = state.token || '';
    const parts = token.split('.');
    const j = decodeJwt(token);
    if (!j) return '<p class="empty">No readable token.</p>';
    const p = j.payload;
    const edit = state.jwtEdit || token;
    const r = state.jwtResult;
    return '<h2 class="section-title">JWT inspector</h2><div class="stack">' +
      '<div class="card"><h3>Your token</h3>' +
        '<code class="jwt-raw"><span class="h">' + esc(parts[0]) + '</span>.<span class="p">' + esc(parts[1]) + '</span>.<span class="s">' + esc(parts[2]) + '</span></code>' +
        '<p class="lead">Three Base64URL parts: header . payload . signature. Anyone can read the first two; only the server can create a valid signature.</p></div>' +
      '<div class="two">' +
        '<div class="card"><h3>Header</h3><pre class="pre">' + esc(JSON.stringify(j.header, null, 2)) + '</pre></div>' +
        '<div class="card"><h3>Payload</h3><pre class="pre">' + esc(JSON.stringify(p, null, 2)) + '</pre></div>' +
      '</div>' +
      '<div class="card"><h3>Lifetime</h3>' +
        '<p class="meta">Issued: ' + esc(p.iat ? new Date(p.iat * 1000).toLocaleString() : '-') + '</p>' +
        '<p class="meta">Expires: ' + esc(p.exp ? new Date(p.exp * 1000).toLocaleString() : '-') + '</p>' +
        '<p>Time left: <strong id="jwt-remaining">' + remaining(p.exp) + '</strong></p></div>' +
      '<div class="card"><h3>Tamper lab</h3>' +
        '<p class="lead">Change the token below (or press the button to set your role claim to ROLE_ADMIN) and send it to <code>GET /api/auth/me</code>. The signature no longer matches, so the server must reject it.</p>' +
        '<textarea id="jwt-edit" spellcheck="false">' + esc(edit) + '</textarea>' +
        '<div class="actions">' +
          '<button class="btn" data-action="jwt-tamper">Tamper: role → ADMIN</button>' +
          '<button class="btn primary" data-action="jwt-send">Send to /api/auth/me</button>' +
          '<button class="btn ghost" data-action="jwt-reset">Reset</button>' +
        '</div>' +
        (r ? '<p class="form-error" style="margin-top:12px;' + (r.ok ? 'background:var(--ok-bg);color:var(--ok-fg)' : '') + '">' + esc(r.text) + '</p>' : '') +
      '</div></div>';
  }

  function remaining(exp) {
    if (!exp) return '-';
    const s = Math.floor(exp - Date.now() / 1000);
    if (s <= 0) return 'expired';
    const m = Math.floor(s / 60);
    return m + ' min ' + String(s % 60).padStart(2, '0') + ' s';
  }
  setInterval(() => {
    const el = $('#jwt-remaining');
    if (el && state.token) {
      const j = decodeJwt(state.token);
      if (j) el.textContent = remaining(j.payload.exp);
    }
  }, 1000);

  /* ---------- actions ---------- */
  const handlers = {
    'auth-mode'(id) { state.authMode = id; state.notice = ''; render(); },

    demo(id) {
      const pw = { admin: 'admin123', organizer: 'organizer123', customer: 'customer123' }[id];
      const form = $('form[data-form=login]');
      form.elements.username.value = id;
      form.elements.password.value = pw;
    },

    async tab(id) { state.tab = id; await loadTab(); },

    logout() { logout(''); },

    /* events */
    'new-event'() { eventForm(null); },
    'edit-event'(id) { eventForm(state.events.find(e => e.id === id)); },
    async 'delete-event'(id) {
      const ev = state.events.find(e => e.id === id);
      if (!(await confirmDialog('Delete event', 'Delete "' + ev.name + '"? This cannot be undone.', 'Delete'))) return;
      await api('/api/events/' + id, { method: 'DELETE' });
      toast('Event deleted.', 'success');
      await loadTab();
    },
    book(id) { bookForm(state.events.find(e => e.id === id)); },

    /* reservations */
    'edit-res'(id) { seatsForm(state.reservations.find(r => r.id === id)); },
    async 'cancel-res'(id) {
      const r = state.reservations.find(x => x.id === id);
      if (!(await confirmDialog('Cancel reservation', 'Cancel ' + r.reservationCode + ' (' + r.seats + ' seat(s))? The seats go back to the event.', 'Cancel reservation'))) return;
      await api('/api/reservations/' + id, { method: 'DELETE' });
      toast('Reservation cancelled, seats released.', 'success');
      await loadTab();
    },

    /* users */
    'new-user'() { userForm(null); },
    'edit-user'(id) { userForm(state.users.find(u => u.id === id)); },
    async 'delete-user'(id) {
      const u = state.users.find(x => x.id === id);
      if (!(await confirmDialog('Delete user', 'Delete user "' + u.username + '"?', 'Delete'))) return;
      await api('/api/admin/users/' + id, { method: 'DELETE' });
      toast('User deleted.', 'success');
      await loadTab();
    },

    /* JWT lab */
    'jwt-tamper'() {
      const ta = $('#jwt-edit');
      try {
        const parts = ta.value.trim().split('.');
        const payload = JSON.parse(b64urlDecode(parts[1]));
        payload.roles = ['ROLE_ADMIN'];
        parts[1] = b64urlEncode(JSON.stringify(payload));
        ta.value = parts.join('.');
        state.jwtEdit = ta.value;
        toast('Payload changed (roles = ROLE_ADMIN). Signature left unchanged. Now press Send.', 'info');
      } catch (e) { toast('Cannot tamper: token is not valid any more.', 'error'); }
    },
    'jwt-reset'() { state.jwtEdit = state.token; state.jwtResult = null; render(); },
    async 'jwt-send'() {
      const token = $('#jwt-edit').value.trim();
      state.jwtEdit = token;
      try {
        const me = await api('/api/auth/me', { token });
        state.jwtResult = { ok: true, text: '200 OK - accepted. You are ' + me.username + ' (' + me.role + ').' };
      } catch (e) {
        state.jwtResult = { ok: false, text: errorText(e) };
      }
      render();
    }
  };

  document.addEventListener('click', async ev => {
    const el = ev.target.closest('[data-action]');
    if (!el || !handlers[el.dataset.action]) return;
    try { await handlers[el.dataset.action](el.dataset.id, el); } catch (e) { handleError(e); }
  });

  document.addEventListener('submit', async ev => {
    const form = ev.target.closest('form[data-form]');
    if (!form) return;
    ev.preventDefault();
    const kind = form.dataset.form;
    const fd = new FormData(form);

    if (kind === 'search') {
      state.keyword = String(fd.get('keyword') || '').trim();
      await loadTab();
      return;
    }

    const err = $('#auth-error');
    const show = msg => { err.textContent = msg; err.hidden = false; };
    err.hidden = true;
    const username = String(fd.get('username') || '').trim();
    const password = String(fd.get('password') || '');
    if (!username || !password) { show('Enter your username and password.'); return; }
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      if (kind === 'register') {
        await api('/api/auth/register', { method: 'POST', token: null,
          body: { username, password, fullName: String(fd.get('fullName') || '').trim(), role: 'CUSTOMER' } });
        toast('Account created. Logging you in...', 'success');
      }
      await doLogin(username, password);
    } catch (e) {
      btn.disabled = false;
      show(kind === 'login' && e.status === 401 ? 'Invalid username or password.' : errorText(e));
    }
  });

  /* ---------- forms (modals) ---------- */
  function toLocalInput(iso) { return iso ? String(iso).slice(0, 16) : ''; }

  function eventForm(ev) {
    const edit = !!ev;
    openModal({
      title: edit ? 'Edit event' : 'New event',
      submitLabel: edit ? 'Save changes' : 'Create event',
      bodyHtml:
        '<label>Name<input name="name" value="' + esc(edit ? ev.name : '') + '" required></label>' +
        '<label>Description<input name="description" value="' + esc(edit ? ev.description : '') + '"></label>' +
        '<label>Venue<input name="venue" value="' + esc(edit ? ev.venue : '') + '" required></label>' +
        '<label>Date and time (must be in the future)<input name="eventDate" type="datetime-local" value="' + esc(edit ? toLocalInput(ev.eventDate) : '') + '" required></label>' +
        '<label>Total seats<input name="totalSeats" type="number" min="1" value="' + esc(edit ? ev.totalSeats : 20) + '" required></label>' +
        '<label>Ticket price (Rs.)<input name="ticketPrice" type="number" min="0" step="0.01" value="' + esc(edit ? ev.ticketPrice : 1000) + '" required></label>',
      async onSubmit(fd) {
        let when = String(fd.get('eventDate') || '');
        if (when.length === 16) when += ':00';
        const body = {
          name: String(fd.get('name') || '').trim(),
          description: String(fd.get('description') || '').trim(),
          venue: String(fd.get('venue') || '').trim(),
          eventDate: when || null,
          totalSeats: Number(fd.get('totalSeats')),
          ticketPrice: Number(fd.get('ticketPrice'))
        };
        await api(edit ? '/api/events/' + ev.id : '/api/events', { method: edit ? 'PUT' : 'POST', body });
        toast(edit ? 'Event updated.' : 'Event created.', 'success');
        await loadTab();
      }
    });
  }

  function bookForm(ev) {
    openModal({
      title: 'Book tickets',
      submitLabel: 'Confirm booking',
      bodyHtml:
        '<p><strong>' + esc(ev.name) + '</strong></p>' +
        '<p class="muted" style="margin-bottom:12px">' + ev.availableSeats + ' seats available · ' + money(ev.ticketPrice) + ' per seat</p>' +
        '<label>Number of seats (1-10)<input name="seats" type="number" min="1" max="10" value="1" required></label>' +
        '<p class="total">Total: <strong id="book-total">' + money(ev.ticketPrice) + '</strong></p>',
      onOpen(form) {
        form.elements.seats.addEventListener('input', () => {
          const n = Number(form.elements.seats.value) || 0;
          $('#book-total').textContent = money(n * ev.ticketPrice);
        });
      },
      async onSubmit(fd) {
        const r = await api('/api/reservations', { method: 'POST', body: { eventId: ev.id, seats: Number(fd.get('seats')) } });
        toast('Reserved ' + r.seats + ' seat(s). Code ' + r.reservationCode, 'success');
        await loadTab();
      }
    });
  }

  function seatsForm(r) {
    openModal({
      title: 'Change seats',
      submitLabel: 'Update reservation',
      bodyHtml:
        '<p><strong>' + esc(r.eventName) + '</strong> · ' + esc(r.reservationCode) + '</p>' +
        '<p class="muted" style="margin-bottom:12px">Currently ' + r.seats + ' seat(s), ' + money(r.totalAmount) + '</p>' +
        '<label>New number of seats (1-10)<input name="seats" type="number" min="1" max="10" value="' + esc(r.seats) + '" required></label>',
      async onSubmit(fd) {
        const out = await api('/api/reservations/' + r.id, { method: 'PUT', body: { seats: Number(fd.get('seats')) } });
        toast('Reservation now has ' + out.seats + ' seat(s).', 'success');
        await loadTab();
      }
    });
  }

  function userForm(u) {
    const edit = !!u;
    const roleOptions = ['CUSTOMER', 'ORGANIZER', 'ADMIN'].map(r =>
      '<option value="' + r + '"' + (edit && u.role === r ? ' selected' : '') + '>' + r + '</option>').join('');
    openModal({
      title: edit ? 'Edit user: ' + u.username : 'New user',
      submitLabel: edit ? 'Save changes' : 'Create user',
      bodyHtml:
        (edit ? '' : '<label>Username<input name="username" autocapitalize="none" required></label>') +
        '<label>Full name<input name="fullName" value="' + esc(edit ? u.fullName : '') + '" required></label>' +
        '<label>Role<select name="role">' + roleOptions + '</select></label>' +
        '<label>' + (edit ? 'New password (leave empty to keep)' : 'Password') + '<input name="password" type="password" autocomplete="new-password"' + (edit ? '' : ' required') + '></label>',
      async onSubmit(fd) {
        const password = String(fd.get('password') || '');
        if (edit) {
          const body = { fullName: String(fd.get('fullName') || '').trim(), role: String(fd.get('role')) };
          if (password) body.password = password;
          await api('/api/admin/users/' + u.id, { method: 'PUT', body });
          toast('User updated.', 'success');
        } else {
          await api('/api/auth/register', { method: 'POST', body: {
            username: String(fd.get('username') || '').trim(),
            password,
            fullName: String(fd.get('fullName') || '').trim(),
            role: String(fd.get('role'))
          } });
          toast('User created.', 'success');
        }
        await loadTab();
      }
    });
  }

  /* ---------- start ---------- */
  async function boot() {
    const saved = store.get(TOKEN_KEY);
    if (saved && !isExpired(saved)) {
      state.token = saved;
      try {
        const me = await api('/api/auth/me');
        state.user = { username: me.username, fullName: me.fullName, role: me.role };
        state.jwtEdit = saved;
        await loadTab();
        return;
      } catch (e) { /* token no longer accepted: fall through to login */ }
    }
    store.remove(TOKEN_KEY);
    state.token = null;
    render();
  }
  boot();
})();
