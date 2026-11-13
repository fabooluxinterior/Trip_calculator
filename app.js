(() => {
  'use strict';

  const STORAGE_KEY = 'trip-calculator:v1';

  const $ = (selector) => document.querySelector(selector);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const todayISO = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };

  const makeCurrency = (digits) => new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const wholeCurrency = makeCurrency(0);
  const preciseCurrency = makeCurrency(2);
  // Whole rupees show without decimals; anything with paise shows both digits.
  const money = (n) => {
    const rounded = Math.round(n * 100) / 100;
    return (Number.isInteger(rounded) ? wholeCurrency : preciseCurrency).format(rounded);
  };

  const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const prettyDate = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? '' : dateFmt.format(d);
  };

  /* ---------- State ---------- */

  const defaults = () => ({ tripName: 'My Trip', members: [], expenses: [] });

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (raw && Array.isArray(raw.members) && Array.isArray(raw.expenses)) {
        return {
          tripName: typeof raw.tripName === 'string' && raw.tripName ? raw.tripName : 'My Trip',
          members: raw.members,
          expenses: raw.expenses,
        };
      }
    } catch (_) { /* fall through to defaults */ }
    return defaults();
  }

  // Set by the live-sync block at the bottom when a Firebase config is present.
  let remote = null;
  let canEdit = true; // local mode is always editable

  function save() {
    if (remote) {
      if (!canEdit) return;
      remote.ref.set({ tripName: state.tripName, members: state.members, expenses: state.expenses })
        .catch(() => showToast('Could not save: this account cannot edit.', null));
      return;
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* storage unavailable */ }
  }

  let state = load();

  /* ---------- DOM helpers ---------- */

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of children) if (child) node.append(child);
    return node;
  }

  const ICON_EDIT =
    '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2.5 13.5h3l7-7a1.4 1.4 0 0 0 0-2l-1-1a1.4 1.4 0 0 0-2 0l-7 7v3Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  const ICON_TRASH =
    '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function iconButton(label, svg, onClick) {
    const btn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': label, title: label, onclick: onClick });
    btn.innerHTML = svg; // static, trusted markup only
    return btn;
  }

  /* ---------- Rendering ---------- */

  const sum = (items) => items.reduce((total, item) => total + (Number(item.amount) || 0), 0);

  function renderSummary() {
    const collected = sum(state.members);
    const spent = sum(state.expenses);
    const remaining = collected - spent;

    $('#statCollected').textContent = money(collected);
    $('#statSpent').textContent = money(spent);
    $('#statRemaining').textContent = money(remaining);

    const primary = $('#statRemaining').closest('.stat');
    const note = $('#statNote');
    const meter = $('#meter');
    const over = remaining < 0;

    primary.classList.toggle('is-negative', over);
    meter.classList.toggle('is-over', over);

    let pct = 0;
    if (collected > 0) pct = Math.min(100, (spent / collected) * 100);
    else if (spent > 0) pct = 100;

    $('#meterFill').style.width = pct + '%';
    meter.setAttribute('aria-valuenow', String(Math.round(pct)));

    if (over) note.textContent = 'Over by ' + money(Math.abs(remaining));
    else if (collected > 0) note.textContent = Math.round(pct) + '% spent';
    else note.textContent = '';
  }

  function renderMembers() {
    const list = $('#memberList');
    list.replaceChildren();
    $('#memberCount').textContent = String(state.members.length);

    if (!state.members.length) {
      list.append(el('li', { class: 'empty', text: 'No members yet. Add the people on this trip.' }));
      return;
    }

    for (const m of state.members) {
      list.append(
        el('li', { class: 'row' },
          el('span', { class: 'avatar', 'aria-hidden': 'true', text: (m.name.trim()[0] || '?') }),
          el('div', { class: 'row-main' },
            el('span', { class: 'row-title', text: m.name }),
            el('span', { class: 'row-sub', text: 'Collected' })
          ),
          el('span', { class: 'row-amount', text: money(Number(m.amount) || 0) }),
          el('div', { class: 'row-actions' },
            iconButton('Edit ' + m.name, ICON_EDIT, () => openMemberDialog(m)),
            iconButton('Remove ' + m.name, ICON_TRASH, () => removeMember(m.id))
          )
        )
      );
    }
  }

  function renderExpenses() {
    const list = $('#expenseList');
    list.replaceChildren();
    $('#expenseCount').textContent = String(state.expenses.length);

    if (!state.expenses.length) {
      list.append(el('li', { class: 'empty', text: 'No expenses yet. Add the first one as you spend.' }));
      return;
    }

    const sorted = [...state.expenses].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    for (const e of sorted) {
      list.append(
        el('li', { class: 'row' },
          el('div', { class: 'row-main' },
            el('span', { class: 'row-title', text: e.title }),
            el('span', { class: 'row-sub', text: prettyDate(e.date) })
          ),
          el('span', { class: 'row-amount', text: money(Number(e.amount) || 0) }),
          el('div', { class: 'row-actions' },
            iconButton('Edit ' + e.title, ICON_EDIT, () => openExpenseDialog(e)),
            iconButton('Remove ' + e.title, ICON_TRASH, () => removeExpense(e.id))
          )
        )
      );
    }
  }

  function render() {
    renderSummary();
    renderMembers();
    renderExpenses();
  }

  /* ---------- Undo toast ---------- */

  let toastTimer = null;
  let undoAction = null;

  function showToast(text, undo) {
    undoAction = undo;
    $('#toastUndo').hidden = !undo;
    $('#toastText').textContent = text;
    $('#toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 5000);
  }

  function hideToast() {
    $('#toast').hidden = true;
    undoAction = null;
    clearTimeout(toastTimer);
  }

  $('#toastUndo').addEventListener('click', () => {
    if (undoAction) undoAction();
    hideToast();
  });

  /* ---------- Members ---------- */

  const memberDialog = $('#memberDialog');
  const memberForm = $('#memberForm');
  let editingMemberId = null;

  function openMemberDialog(member) {
    editingMemberId = member ? member.id : null;
    memberForm.reset();
    $('#memberError').hidden = true;
    $('#memberDialogTitle').textContent = member ? 'Edit Member' : 'Add Member';
    $('#memberSubmit').textContent = member ? 'Save' : 'Add';
    if (member) {
      $('#memberName').value = member.name;
      $('#memberAmount').value = member.amount;
    }
    memberDialog.showModal();
    $('#memberName').focus();
  }

  memberForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('#memberName').value.trim();
    const amountText = $('#memberAmount').value.trim();
    const amount = amountText === '' ? 0 : Number(amountText);
    const error = $('#memberError');

    if (!name) return fail(error, 'Enter a name.');
    if (!Number.isFinite(amount) || amount < 0) return fail(error, 'Enter a valid amount.');

    if (editingMemberId) {
      const m = state.members.find((x) => x.id === editingMemberId);
      if (m) { m.name = name; m.amount = amount; }
    } else {
      state.members.push({ id: uid(), name, amount });
    }
    save();
    render();
    memberDialog.close();
  });

  function removeMember(id) {
    const index = state.members.findIndex((m) => m.id === id);
    if (index < 0) return;
    const [removed] = state.members.splice(index, 1);
    save();
    render();
    showToast(removed.name + ' removed', () => {
      state.members.splice(Math.min(index, state.members.length), 0, removed);
      save();
      render();
    });
  }

  /* ---------- Expenses ---------- */

  const expenseDialog = $('#expenseDialog');
  const expenseForm = $('#expenseForm');
  let editingExpenseId = null;

  function openExpenseDialog(expense) {
    editingExpenseId = expense ? expense.id : null;
    expenseForm.reset();
    $('#expenseError').hidden = true;
    $('#expenseDialogTitle').textContent = expense ? 'Edit Expense' : 'Add Expense';
    $('#expenseSubmit').textContent = expense ? 'Save' : 'Add';
    $('#expenseDate').value = expense ? expense.date : todayISO();
    if (expense) {
      $('#expenseTitle').value = expense.title;
      $('#expenseAmount').value = expense.amount;
    }
    expenseDialog.showModal();
    $('#expenseTitle').focus();
  }

  expenseForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const title = $('#expenseTitle').value.trim();
    const amount = Number($('#expenseAmount').value);
    const date = $('#expenseDate').value || todayISO();
    const error = $('#expenseError');

    if (!title) return fail(error, 'Enter a description.');
    if (!Number.isFinite(amount) || amount <= 0) return fail(error, 'Enter an amount greater than zero.');

    if (editingExpenseId) {
      const e = state.expenses.find((x) => x.id === editingExpenseId);
      if (e) { e.title = title; e.amount = amount; e.date = date; }
    } else {
      state.expenses.push({ id: uid(), title, amount, date });
    }
    save();
    render();
    expenseDialog.close();
  });

  function removeExpense(id) {
    const index = state.expenses.findIndex((e) => e.id === id);
    if (index < 0) return;
    const [removed] = state.expenses.splice(index, 1);
    save();
    render();
    showToast(removed.title + ' removed', () => {
      state.expenses.splice(Math.min(index, state.expenses.length), 0, removed);
      save();
      render();
    });
  }

  /* ---------- Shared UI wiring ---------- */

  function fail(node, message) {
    node.textContent = message;
    node.hidden = false;
    return false;
  }

  for (const dialog of [memberDialog, expenseDialog]) {
    // Clicking the backdrop (the dialog element itself) closes it.
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    dialog.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => dialog.close()));
  }

  $('#addMemberBtn').addEventListener('click', () => openMemberDialog(null));
  $('#addExpenseBtn').addEventListener('click', () => openExpenseDialog(null));

  // Mobile tabs: Members / Expenses
  const columns = $('#columns');
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      columns.dataset.view = tab.dataset.view;
      document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    });
  });

  // Trip name
  const tripName = $('#tripName');
  tripName.value = state.tripName;
  tripName.addEventListener('input', () => {
    state.tripName = tripName.value.trim() || 'My Trip';
    document.title = state.tripName + ' · Trip Calculator';
    save();
  });
  tripName.addEventListener('keydown', (event) => { if (event.key === 'Enter') tripName.blur(); });
  document.title = state.tripName + ' · Trip Calculator';

  render();

  /* ---------- Live sync (optional) ----------
     With a Firebase config in firebase-config.js, everyone who opens the link sees
     updates in real time and cannot edit. Only the signed-in owner can write; the
     database rules (see README) enforce that, the UI just mirrors it. */

  const cfg = window.TRIP_FIREBASE;
  const badge = $('#liveBadge');
  const authBtn = $('#authBtn');
  const asList = (v) => (Array.isArray(v) ? v.filter(Boolean) : v && typeof v === 'object' ? Object.values(v) : []);

  let connected = false;
  let remoteLoaded = false; // true once the first database snapshot has arrived
  let remoteEmpty = true;
  let currentUser = null;
  const localSeed = load(); // the owner's pre-sync data, offered once to an empty database

  function setEditable(on) {
    canEdit = on;
    document.body.classList.toggle('is-viewer', !on);
    tripName.readOnly = !on;
    updateBadge();
  }

  function updateBadge() {
    const status = document.body.dataset.sync;
    badge.hidden = false;
    badge.dataset.status = status;
    badge.textContent =
      status === 'connecting' ? 'Connecting…' :
      status === 'offline' ? 'Offline' :
      canEdit ? 'Live' : 'Live · view only';
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.append(s);
    });
  }

  async function initRemote() {
    state = defaults();
    render();
    setEditable(false);
    document.body.dataset.sync = 'connecting';
    updateBadge();

    try {
      const base = 'https://www.gstatic.com/firebasejs/10.12.2/';
      await loadScript(base + 'firebase-app-compat.js');
      await Promise.all([loadScript(base + 'firebase-database-compat.js'), loadScript(base + 'firebase-auth-compat.js')]);
      const { ownerUid, ...firebaseOptions } = cfg; // ownerUid is ours, not Firebase's
      firebase.initializeApp(firebaseOptions);
    } catch (_) {
      document.body.dataset.sync = 'offline';
      updateBadge();
      return;
    }

    const db = firebase.database();
    const auth = firebase.auth();
    remote = { ref: db.ref('trip') };

    remote.ref.on('value', (snap) => {
      const v = snap.val();
      remoteLoaded = true;
      remoteEmpty = v == null;
      if (v) {
        state = {
          tripName: typeof v.tripName === 'string' && v.tripName ? v.tripName : 'My Trip',
          members: asList(v.members),
          expenses: asList(v.expenses),
        };
      } else if (!canEdit) {
        state = defaults();
      }
      if (document.activeElement !== tripName) tripName.value = state.tripName;
      document.title = state.tripName + ' · Trip Calculator';
      document.body.dataset.sync = 'live';
      updateBadge();
      render();
      seedIfEmpty();
    }, () => {
      document.body.dataset.sync = 'offline';
      updateBadge();
    });

    db.ref('.info/connected').on('value', (snap) => {
      connected = snap.val() === true;
      if (document.body.dataset.sync !== 'connecting') {
        document.body.dataset.sync = connected ? 'live' : 'offline';
        updateBadge();
      }
    });

    authBtn.hidden = false;
    authBtn.addEventListener('click', async () => {
      if (auth.currentUser) { auth.signOut(); return; }
      try {
        await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
      } catch (err) {
        if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment')) {
          auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider());
        }
      }
    });

    auth.onAuthStateChanged((user) => {
      currentUser = user;
      authBtn.textContent = user ? 'Sign out' : 'Sign in to edit';
      // Only the owner gets edit controls. The database rules are what actually block others.
      const isOwner = !!user && (!cfg.ownerUid || user.uid === cfg.ownerUid);
      setEditable(isOwner);
      if (user && !isOwner) showToast('This account is view only.', null);
      if (user && !cfg.ownerUid) console.info('Your Firebase UID (put it in firebase-config.js and the rules):', user.uid);
      seedIfEmpty();
    });
  }

  // First owner sign-in on an empty database: carry over data saved on this device.
  // Waits for the first snapshot so existing cloud data is never overwritten.
  let seeded = false;
  function seedIfEmpty() {
    if (seeded || !remoteLoaded || !remoteEmpty || !currentUser || !canEdit) return;
    if (!localSeed.members.length && !localSeed.expenses.length) return;
    seeded = true;
    state = localSeed;
    render();
    save();
  }

  if (cfg && cfg.databaseURL) initRemote();
})();
