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

  // Built-in categories. Ids are fixed so every device and viewer agrees on them,
  // even before the owner's first save writes them to the database.
  const DEFAULT_CATEGORIES = [
    { id: 'food', name: 'Food', color: 1 },
    { id: 'fuel', name: 'Fuel', color: 2 },
    { id: 'stay', name: 'Stay', color: 3 },
    { id: 'transport', name: 'Transport', color: 4 },
    { id: 'activities', name: 'Activities', color: 5 },
    { id: 'shopping', name: 'Shopping', color: 6 },
    { id: 'other', name: 'Other', color: 7 },
  ];
  const defaultCategories = () => DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  // Older saves have no categories: they get the built-in set, and their
  // expenses (which have no category) show as Uncategorized until edited.
  const readCategories = (list) => {
    const valid = (Array.isArray(list) ? list : []).filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string');
    return valid.length ? valid : defaultCategories();
  };

  const defaults = () => ({ tripName: 'My Trip', members: [], expenses: [], categories: defaultCategories() });

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (raw && Array.isArray(raw.members) && Array.isArray(raw.expenses)) {
        return {
          tripName: typeof raw.tripName === 'string' && raw.tripName ? raw.tripName : 'My Trip',
          members: raw.members,
          expenses: raw.expenses,
          categories: readCategories(raw.categories),
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
      remote.ref.set({ tripName: state.tripName, members: state.members, expenses: state.expenses, categories: state.categories })
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
            el('span', { class: 'row-sub', text: [prettyDate(e.date), categoryOf(e).name].filter(Boolean).join(' · ') })
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
    renderInsights();
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
    fillExpenseSelects(expense);
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

    let category = $('#expenseCategory').value;
    if (category === NEW_CATEGORY) {
      const name = $('#newCategoryName').value.trim();
      if (!name) return fail(error, 'Enter a name for the new category.');
      category = ensureCategory(name).id;
    }
    const paidBy = $('#expensePaidBy').value || '';
    lastCategory = category;

    if (editingExpenseId) {
      const e = state.expenses.find((x) => x.id === editingExpenseId);
      if (e) { e.title = title; e.amount = amount; e.date = date; e.category = category; e.paidBy = paidBy; }
    } else {
      state.expenses.push({ id: uid(), title, amount, date, category, paidBy });
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

  /* ---------- Expense management: categories, payers, insights ---------- */

  const NEW_CATEGORY = '__new';
  const UNCATEGORIZED = { id: '', name: 'Uncategorized', color: 0 };
  const FUND_NAME = 'Trip fund';
  const MAX_SLICES = 8; // the chart palette has eight colours; smaller slices fold into "More"

  let lastCategory = null;
  let selectedCategory = null; // null = all; '' = uncategorized; otherwise a category id

  const categoryById = (id) => state.categories.find((c) => c.id === id);
  const categoryOf = (expense) => categoryById(expense.category) || UNCATEGORIZED;
  const memberById = (id) => state.members.find((m) => m.id === id);
  const payerName = (expense) => {
    if (!expense.paidBy) return FUND_NAME;
    const m = memberById(expense.paidBy);
    return m ? m.name : 'Removed member';
  };
  const swatch = (color) => 'var(--cat-' + (Number(color) || 0) + ')';
  const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);
  const pctText = (p) => (p > 0 && p < 1 ? '<1%' : Math.round(p) + '%');
  const toPaise = (n) => Math.round((Number(n) || 0) * 100);

  function nextColor() {
    const used = new Set(state.categories.map((c) => Number(c.color)));
    for (let k = 1; k <= 8; k++) if (!used.has(k)) return k;
    return (state.categories.length % 8) + 1;
  }

  // Returns the existing category with this name (any case), or creates it.
  function ensureCategory(name) {
    const existing = state.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const category = { id: uid(), name, color: nextColor() };
    state.categories.push(category);
    return category;
  }

  function fillExpenseSelects(expense) {
    const catSelect = $('#expenseCategory');
    catSelect.replaceChildren();
    for (const c of state.categories) catSelect.append(el('option', { value: c.id, text: c.name }));
    const current = expense ? categoryOf(expense) : null;
    if (expense && current === UNCATEGORIZED) catSelect.append(el('option', { value: expense.category || '', text: 'Uncategorized' }));
    catSelect.append(el('option', { value: NEW_CATEGORY, text: '+ New category…' }));

    let value;
    if (expense) value = current === UNCATEGORIZED ? (expense.category || '') : current.id;
    else value = (lastCategory && categoryById(lastCategory)) ? lastCategory : (state.categories[0] ? state.categories[0].id : NEW_CATEGORY);
    catSelect.value = value;

    const paidSelect = $('#expensePaidBy');
    paidSelect.replaceChildren(el('option', { value: '', text: FUND_NAME + ' (pool)' }));
    for (const m of state.members) paidSelect.append(el('option', { value: m.id, text: m.name }));
    if (expense && expense.paidBy && !memberById(expense.paidBy)) {
      paidSelect.append(el('option', { value: expense.paidBy, text: 'Removed member' }));
    }
    paidSelect.value = expense ? (expense.paidBy || '') : '';

    $('#newCategoryName').value = '';
    syncNewCategoryField();
  }

  function syncNewCategoryField() {
    const isNew = $('#expenseCategory').value === NEW_CATEGORY;
    $('#newCategoryField').hidden = !isNew;
  }
  $('#expenseCategory').addEventListener('change', () => {
    syncNewCategoryField();
    if ($('#expenseCategory').value === NEW_CATEGORY) $('#newCategoryName').focus();
  });

  /* ----- Calculations ----- */

  // Spend per category, largest first. Colour stays with the category, not its rank.
  function categoryTotals() {
    const map = new Map();
    for (const e of state.expenses) {
      const c = categoryOf(e);
      const key = c === UNCATEGORIZED ? '' : c.id;
      const t = map.get(key) || { id: key, cat: c, total: 0, count: 0 };
      t.total += Number(e.amount) || 0;
      t.count += 1;
      map.set(key, t);
    }
    return [...map.values()].filter((t) => t.total > 0).sort((a, b) => b.total - a.total);
  }

  function chartSlices(totals) {
    if (totals.length <= MAX_SLICES) return totals;
    const head = totals.slice(0, MAX_SLICES - 1);
    const rest = totals.slice(MAX_SLICES - 1);
    head.push({
      id: null, more: true, cat: { name: rest.length + ' more', color: 0 },
      total: rest.reduce((s, t) => s + t.total, 0), count: rest.reduce((s, t) => s + t.count, 0),
    });
    return head;
  }

  // Equal split of all expenses. A member's balance is what they put in
  // (contribution + expenses they paid themselves) minus their fair share.
  function memberBalances() {
    const total = sum(state.expenses);
    const n = state.members.length;
    const fair = n ? total / n : 0;
    // Split in whole paise so the balances add up exactly; leftover paise go to the first members.
    const totalPaise = state.expenses.reduce((s, e) => s + toPaise(e.amount), 0);
    const base = n ? Math.floor(totalPaise / n) : 0;
    const extra = n ? totalPaise - base * n : 0;
    const rows = state.members.map((m, i) => {
      const contributed = Number(m.amount) || 0;
      const paidPaise = state.expenses.filter((e) => e.paidBy === m.id).reduce((s, e) => s + toPaise(e.amount), 0);
      const fairPaise = base + (i < extra ? 1 : 0);
      return {
        member: m, contributed, paid: paidPaise / 100, fair: fairPaise / 100,
        net: (toPaise(contributed) + paidPaise - fairPaise) / 100,
      };
    });
    return { rows, fair, total };
  }

  // Fewest transfers that settle everyone. Money left in the trip fund is paid
  // out from it; a fund that is short is topped up by those who owe.
  function settlements(rows) {
    const parties = rows.map((r) => ({ name: r.member.name, net: toPaise(r.net) }));
    const memberNet = parties.reduce((s, p) => s + p.net, 0);
    if (memberNet !== 0) parties.push({ name: FUND_NAME, net: -memberNet, fund: true });

    const creditors = parties.filter((p) => p.net > 0).sort((a, b) => b.net - a.net);
    const debtors = parties.filter((p) => p.net < 0).map((p) => ({ ...p, net: -p.net })).sort((a, b) => b.net - a.net);
    const transfers = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const amount = Math.min(debtors[i].net, creditors[j].net);
      if (amount > 0) transfers.push({ from: debtors[i], to: creditors[j], amount: amount / 100 });
      debtors[i].net -= amount;
      creditors[j].net -= amount;
      if (debtors[i].net === 0) i++;
      if (creditors[j].net === 0) j++;
    }
    return transfers;
  }

  /* ----- Doughnut chart ----- */

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };

  function drawDonut(host, slices, total, onPick) {
    host.replaceChildren();
    const R = 76, STROKE = 26, C = 2 * Math.PI * R;
    const root = svg('svg', { viewBox: '0 0 200 200', role: 'group', 'aria-label': 'Spending by category' });
    root.append(svg('circle', { cx: 100, cy: 100, r: R, fill: 'none', stroke: 'var(--border)', 'stroke-width': STROKE }));

    const center = el('div', { class: 'donut-center' });
    const centerLabel = el('span', { class: 'donut-label' });
    const centerValue = el('strong', { class: 'donut-value' });
    const centerSub = el('span', { class: 'donut-sub' });
    center.append(centerLabel, centerValue, centerSub);

    const selected = slices.find((s) => !s.more && s.id === selectedCategory);
    const showCenter = (s) => {
      if (s) {
        centerLabel.textContent = s.cat.name;
        centerValue.textContent = money(s.total);
        centerSub.textContent = pctText(pct(s.total, total)) + ' · ' + s.count + (s.count === 1 ? ' expense' : ' expenses');
      } else {
        centerLabel.textContent = 'Total spent';
        centerValue.textContent = money(total);
        centerSub.textContent = slices.length ? slices.length + (slices.length === 1 ? ' category' : ' categories') : 'No expenses yet';
      }
    };
    showCenter(selected);

    const gap = slices.length > 1 ? 2 : 0; // 2px surface gap between segments
    let start = 0;
    for (const s of slices) {
      const frac = total > 0 ? s.total / total : 0;
      const len = Math.max(frac * C - gap, 0.5);
      const seg = svg('circle', {
        cx: 100, cy: 100, r: R, fill: 'none',
        stroke: swatch(s.cat.color), 'stroke-width': STROKE,
        'stroke-dasharray': len + ' ' + (C - len),
        'stroke-dashoffset': String(-start * C),
        class: 'donut-seg' + (selected && selected !== s ? ' is-dim' : '') + (selected === s ? ' is-active' : ''),
        tabindex: s.more ? '-1' : '0',
        role: s.more ? 'img' : 'button',
        'aria-label': s.cat.name + ', ' + money(s.total) + ', ' + pctText(pct(s.total, total)),
      });
      seg.addEventListener('pointerenter', () => showCenter(s));
      seg.addEventListener('pointerleave', () => showCenter(selected));
      seg.addEventListener('focus', () => showCenter(s));
      seg.addEventListener('blur', () => showCenter(selected));
      if (!s.more) {
        seg.addEventListener('click', () => onPick(s.id));
        seg.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onPick(s.id); }
        });
      }
      root.append(seg);
      start += frac;
    }
    host.append(root, center);
  }

  function drawLegend(list, slices, total, onPick, limit) {
    list.replaceChildren();
    if (!slices.length) {
      list.append(el('li', { class: 'legend-empty', text: 'Add expenses to see where the money goes.' }));
      return;
    }
    const shown = limit ? slices.slice(0, limit) : slices;
    for (const s of shown) {
      const active = !s.more && s.id === selectedCategory;
      const item = el('button', {
        class: 'legend-item' + (active ? ' is-active' : ''), type: 'button',
        'aria-pressed': String(active),
        onclick: () => onPick(s.more ? null : s.id),
      },
        el('span', { class: 'legend-dot', style: 'background:' + swatch(s.cat.color) }),
        el('span', { class: 'legend-name', text: s.cat.name }),
        el('span', { class: 'legend-amount', text: money(s.total) }),
        el('span', { class: 'legend-pct', text: pctText(pct(s.total, total)) })
      );
      list.append(el('li', {}, item));
    }
    if (limit && slices.length > limit) {
      list.append(el('li', {}, el('a', { class: 'legend-more', href: '#details', text: '+ ' + (slices.length - limit) + ' more' })));
    }
  }

  /* ----- Details page ----- */

  function pickFromHome(id) {
    selectedCategory = id;
    if (location.hash === '#details') render();
    else location.hash = 'details';
  }

  function pickOnDetails(id) {
    selectedCategory = selectedCategory === id ? null : id;
    render();
    if (selectedCategory !== null && window.matchMedia('(max-width: 720px)').matches) {
      $('#historyCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderInsights() {
    const totals = categoryTotals();
    const total = sum(state.expenses);
    if (selectedCategory !== null && !totals.some((t) => t.id === selectedCategory)) selectedCategory = null;
    const slices = chartSlices(totals);

    drawDonut($('#miniDonut'), slices, total, pickFromHome);
    drawLegend($('#miniLegend'), slices, total, pickFromHome, 4);
    drawDonut($('#fullDonut'), slices, total, pickOnDetails);
    drawLegend($('#fullLegend'), totals, total, pickOnDetails, 0);
    $('#categoryCount').textContent = String(state.categories.length);

    renderHistory(totals);
    renderBalances();
  }

  function renderHistory(totals) {
    const chips = $('#historyFilters');
    chips.replaceChildren();
    const chip = (label, id, color) => {
      const active = selectedCategory === id;
      const b = el('button', {
        class: 'chip' + (active ? ' is-active' : ''), type: 'button', 'aria-pressed': String(active),
        onclick: () => { selectedCategory = id; render(); },
      });
      if (color !== undefined) b.append(el('span', { class: 'legend-dot', style: 'background:' + swatch(color) }));
      b.append(document.createTextNode(label));
      return b;
    };
    chips.append(chip('All', null));
    for (const t of totals) chips.append(chip(t.cat.name + ' (' + t.count + ')', t.id, t.cat.color));
    chips.hidden = !state.expenses.length;

    const list = $('#historyList');
    list.replaceChildren();
    const filtered = state.expenses
      .filter((e) => selectedCategory === null || (categoryOf(e) === UNCATEGORIZED ? '' : categoryOf(e).id) === selectedCategory)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    $('#historyCount').textContent = String(filtered.length);

    if (!filtered.length) {
      list.append(el('li', { class: 'empty', text: state.expenses.length ? 'No expenses in this category.' : 'No expenses yet. Add the first one as you spend.' }));
    }
    for (const e of filtered) {
      const c = categoryOf(e);
      list.append(
        el('li', { class: 'row' },
          el('span', { class: 'cat-mark', style: 'background:' + swatch(c.color), 'aria-hidden': 'true' }),
          el('div', { class: 'row-main' },
            el('span', { class: 'row-title', text: e.title }),
            el('span', { class: 'row-sub', text: [prettyDate(e.date), c.name, 'Paid by ' + payerName(e)].filter(Boolean).join(' · ') })
          ),
          el('span', { class: 'row-amount', text: money(Number(e.amount) || 0) }),
          el('div', { class: 'row-actions' },
            iconButton('Edit ' + e.title, ICON_EDIT, () => openExpenseDialog(e)),
            iconButton('Remove ' + e.title, ICON_TRASH, () => removeExpense(e.id))
          )
        )
      );
    }

    const shownTotal = sum(filtered);
    const totalRow = $('#historyTotal');
    totalRow.replaceChildren(
      el('span', { text: selectedCategory === null ? 'All expenses' : (filtered[0] ? categoryOf(filtered[0]).name : '') }),
      el('strong', { text: money(shownTotal) })
    );
    totalRow.hidden = !filtered.length;
  }

  function renderBalances() {
    const { rows, fair, total } = memberBalances();
    $('#fairShareNote').textContent = rows.length && total > 0 ? 'Fair share ' + money(fair) + ' each' : '';

    const body = $('#balanceRows');
    body.replaceChildren();
    if (!rows.length) {
      body.append(el('tr', {}, el('td', { class: 'empty', colspan: '5', text: 'Add members to see contributions and balances.' })));
    }
    for (const r of rows) {
      const paise = toPaise(r.net);
      const status = paise > 0 ? 'Gets back ' + money(paise / 100) : paise < 0 ? 'Owes ' + money(-paise / 100) : 'Settled';
      body.append(
        el('tr', {},
          el('th', { scope: 'row' },
            el('span', { class: 'member-cell' },
              el('span', { class: 'avatar', 'aria-hidden': 'true', text: (r.member.name.trim()[0] || '?') }),
              el('span', { class: 'row-title', text: r.member.name })
            )
          ),
          el('td', { 'data-label': 'Contributed', text: money(r.contributed) }),
          el('td', { 'data-label': 'Paid for expenses', text: money(r.paid) }),
          el('td', { 'data-label': 'Fair share', text: money(r.fair) }),
          el('td', { 'data-label': 'Balance', class: 'bal' + (paise < 0 ? ' is-owes' : ''), text: status })
        )
      );
    }

    const list = $('#settleList');
    list.replaceChildren();
    const transfers = rows.length ? settlements(rows) : [];
    if (!transfers.length) {
      list.append(el('li', { class: 'empty', text: rows.length ? 'Everyone is settled up.' : 'Add members to see who pays whom.' }));
    }
    for (const t of transfers) {
      const sub = t.from.fund ? 'Refund from the trip fund' : t.to.fund ? 'Top up the trip fund' : 'Direct payment';
      list.append(
        el('li', { class: 'row' },
          el('div', { class: 'row-main' },
            el('span', { class: 'row-title', text: t.from.name + ' → ' + t.to.name }),
            el('span', { class: 'row-sub', text: sub })
          ),
          el('span', { class: 'row-amount', text: money(t.amount) })
        )
      );
    }
  }

  /* ----- Category manager ----- */

  const categoryDialog = $('#categoryDialog');
  const categoryForm = $('#categoryForm');
  let editingCategoryId = null;

  function resetCategoryForm() {
    editingCategoryId = null;
    categoryForm.reset();
    $('#categoryFormLabel').textContent = 'New category';
    $('#categorySubmit').textContent = 'Add';
    $('#categoryCancelEdit').hidden = true;
    $('#categoryError').hidden = true;
  }

  function renderCategoryList() {
    const list = $('#categoryList');
    list.replaceChildren();
    if (!state.categories.length) {
      list.append(el('li', { class: 'empty', text: 'No categories. Add one above.' }));
      return;
    }
    for (const c of state.categories) {
      const used = state.expenses.filter((e) => e.category === c.id);
      list.append(
        el('li', { class: 'row' },
          el('span', { class: 'cat-mark', style: 'background:' + swatch(c.color), 'aria-hidden': 'true' }),
          el('div', { class: 'row-main' },
            el('span', { class: 'row-title', text: c.name }),
            el('span', { class: 'row-sub', text: used.length + (used.length === 1 ? ' expense · ' : ' expenses · ') + money(sum(used)) })
          ),
          el('div', { class: 'row-actions' },
            iconButton('Rename ' + c.name, ICON_EDIT, () => {
              editingCategoryId = c.id;
              $('#categoryName').value = c.name;
              $('#categoryFormLabel').textContent = 'Rename category';
              $('#categorySubmit').textContent = 'Save';
              $('#categoryCancelEdit').hidden = false;
              $('#categoryError').hidden = true;
              $('#categoryName').focus();
            }),
            iconButton('Delete ' + c.name, ICON_TRASH, () => removeCategory(c.id))
          )
        )
      );
    }
  }

  function removeCategory(id) {
    const index = state.categories.findIndex((c) => c.id === id);
    if (index < 0) return;
    const [removed] = state.categories.splice(index, 1);
    if (editingCategoryId === id) resetCategoryForm();
    save();
    render();
    renderCategoryList();
    // Expenses keep their category id, so Undo reconnects them.
    showToast(removed.name + ' deleted', () => {
      state.categories.splice(Math.min(index, state.categories.length), 0, removed);
      save();
      render();
      renderCategoryList();
    });
  }

  categoryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('#categoryName').value.trim();
    const error = $('#categoryError');
    if (!name) return fail(error, 'Enter a category name.');
    const clash = state.categories.find((c) => c.name.toLowerCase() === name.toLowerCase() && c.id !== editingCategoryId);
    if (clash) return fail(error, 'A category with this name already exists.');

    if (editingCategoryId) {
      const c = categoryById(editingCategoryId);
      if (c) c.name = name;
    } else {
      state.categories.push({ id: uid(), name, color: nextColor() });
    }
    resetCategoryForm();
    save();
    render();
    renderCategoryList();
  });

  $('#categoryCancelEdit').addEventListener('click', resetCategoryForm);

  $('#manageCategoriesBtn').addEventListener('click', () => {
    resetCategoryForm();
    renderCategoryList();
    categoryDialog.showModal();
  });

  $('#historyAddBtn').addEventListener('click', () => openExpenseDialog(null));

  /* ----- Page routing: #details shows the full breakdown ----- */

  function route() {
    const details = location.hash === '#details';
    document.body.dataset.page = details ? 'details' : 'home';
    $('#detailsPage').hidden = !details;
    $('#detailsHead').hidden = !details;
    document.title = (details ? 'Details · ' : '') + state.tripName + ' · Trip Calculator';
    window.scrollTo(0, 0);
  }

  $('#backBtn').addEventListener('click', (event) => {
    event.preventDefault();
    selectedCategory = null;
    location.hash = '';
    render();
  });

  /* ---------- Shared UI wiring ---------- */

  function fail(node, message) {
    node.textContent = message;
    node.hidden = false;
    return false;
  }

  for (const dialog of [memberDialog, expenseDialog, categoryDialog]) {
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

  window.addEventListener('hashchange', () => { route(); render(); });
  route();
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
          categories: readCategories(asList(v.categories)),
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
