/* Financial Home v3: Pay Cards planner + Bills checklist + manual accounts writes.
 * Ported 1:1 from app_v2/app.py: card_key_for, cards_for_month, api_cards, bill_suggestions, api_bills, post_plan,
 * post_card_settings, post_bill, del_bill, post_bill_status, post_budget, post_manual_account, del_manual_account,
 * post_manual_balance, del_manual_balance. Same SQL, same rounding, same response shape.
 * Classic script (no modules); relies on the globals DB, H and API (see ARCHITECTURE.md). */
(function () {
  'use strict';
  const G = typeof globalThis !== 'undefined' ? globalThis : window;
  /* eslint-disable no-undef */
  const _H = () => (typeof H !== 'undefined' ? H : G.H);
  const _DB = () => (typeof DB !== 'undefined' ? DB : G.DB);
  const _API = () => (typeof API !== 'undefined' ? API : G.API);
  /* eslint-enable no-undef */

  // ---- Python-semantics shims ---------------------------------------------------------------------------------------
  // Python truthiness: None/False/0/''/[]/{} are falsy.
  function pyt(v) {
    if (v === null || v === undefined || v === false || v === 0 || v === '' || Number.isNaN(v)) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return true;
  }
  // `a or b` (b normalised: missing -> None)
  function por(a, b) { return pyt(a) ? a : (b === undefined ? null : b); }
  // dict.get(k) -> value or None
  function g(o, k) { return o == null || o[k] === undefined ? null : o[k]; }
  function has(o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); }
  // dt.date.fromisoformat(d) + timedelta(days=n)
  function addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
    return t.toISOString().slice(0, 10);
  }
  // Python str comparison (code points)
  function cmpStr(a, b) {
    if (a === b) return 0;
    const A = Array.from(a == null ? '' : String(a)), B = Array.from(b == null ? '' : String(b));
    const n = Math.min(A.length, B.length);
    for (let i = 0; i < n; i++) {
      const x = A[i].codePointAt(0), y = B[i].codePointAt(0);
      if (x !== y) return x < y ? -1 : 1;
    }
    return A.length === B.length ? 0 : (A.length < B.length ? -1 : 1);
  }
  function pyStr(v) { return v === null || v === undefined ? 'None' : String(v); }
  const sum = (xs) => xs.reduce((s, x) => s + x, 0);
  // sorted(set(...), reverse=True) for month strings
  function monthsDesc(lists) {
    const s = new Set();
    for (const l of lists) for (const x of l) s.add(x);
    return Array.from(s).sort((a, b) => cmpStr(b, a));
  }
  function distinctCol(sql) { return _DB().Q(sql).map((r) => r[Object.keys(r)[0]]); }

  // ---- cards -------------------------------------------------------------------------------------------------------
  function card_key_for(a) {
    return a.account_id;
  }

  function cards_for_month(m) {
    const H = _H(), DB = _DB();
    const plan = new Map();
    for (const r of DB.Q('SELECT * FROM payment_plan WHERE month=?', [m])) plan.set(r.account_id, r);
    const settings = new Map();
    for (const r of DB.Q('SELECT * FROM card_settings')) settings.set(r.card_key, r);
    const sheet_month = DB.one('SELECT MAX(month) FROM card_statements WHERE month<=?', [m]);
    const sheet = pyt(sheet_month) ? DB.Q('SELECT * FROM card_statements WHERE month=?', [sheet_month]) : [];
    const sheet_by4 = new Map();
    for (const r of sheet) if (!sheet_by4.has(r.last4)) sheet_by4.set(r.last4, r);
    const [s, e] = H.month_bounds(m);
    const current = m >= H.this_month();
    const linked = H.linked_accounts("a.type IN ('credit_card','store_card')");
    const ds = H.data_start();
    const out = [];
    const shared_parent = {};
    for (const a of linked) {
      if (a.status === 'shares_balance') continue;
      shared_parent[a.account_id] = a;
    }
    for (const a of linked) {
      const key = a.account_id;
      const st = settings.get(key) || {};
      const p = plan.get(key) || {};
      const sh = sheet_by4.get(a.last4) || {};
      let owed, owed_asof;
      if (current) {
        owed = -(por(a.balance, 0));
        owed_asof = g(a, 'as_of');
      } else {
        const v = new H.BalanceWalker(key, ds).at(H.month_end(m));
        owed = v !== null && v !== undefined ? -v : null;
        owed_asof = v !== null && v !== undefined ? H.month_end(m) : null;
      }
      const same_month_sheet = pyt(sh) && g(sh, 'month') === m;
      const due_day = pyt(g(st, 'due_day')) ? st.due_day
        : (pyt(g(sh, 'due_day')) && /^\d+$/.test(String(sh.due_day)) ? parseInt(String(sh.due_day), 10) : null);
      const paid_txns = DB.Q(`SELECT txn_id, posted_date, amount FROM transactions WHERE account_id=? AND amount>0 AND is_transfer=1
            AND posted_date>=? AND posted_date<? ORDER BY posted_date`, [key, s, e]);
      const row = {
        card_key: key, account_id: key, linked: true, name: por(g(st, 'display_name'), a.label), holder: g(a, 'holder'),
        last4: g(a, 'last4'), institution: g(a, 'institution'), owed: H.r2(owed), owed_asof: owed_asof,
        statement_due: g(p, 'statement_due') !== null ? p.statement_due : (same_month_sheet ? g(sh, 'statement_due') : null),
        min_due: g(p, 'min_due'), due_date: por(g(p, 'due_date'), pyt(due_day) ? H.due_date_in(m, due_day) : null), due_day: due_day,
        planned: pyt(p) ? g(p, 'amount') : (same_month_sheet ? g(sh, 'payment_amount') : null),
        pay_from: por(g(p, 'pay_from'), g(st, 'pay_from')), paid: pyt(g(p, 'paid')), note: g(p, 'note'),
        credit_limit: por(g(st, 'credit_limit'), g(sh, 'credit_limit')), autopay: pyt(g(st, 'autopay')), hidden: pyt(g(st, 'hidden')),
        updated_by: g(p, 'updated_by'), updated_at: g(p, 'updated_at'), paid_this_month: H.r2(sum(paid_txns.map((x) => x.amount))),
        payments: paid_txns, shares_balance: a.status === 'shares_balance', sheet_card: g(sh, 'card'),
      };
      const target = por(row.planned, row.statement_due);
      row.auto_paid = pyt(target) && pyt(row.paid_this_month) && row.paid_this_month >= 0.95 * target;
      if (a.status === 'shares_balance') {
        row.hidden = g(st, 'hidden') === null ? true : pyt(st.hidden);
        row.owed = 0.0;
      }
      out.push(row);
    }
    const linked4 = new Set(linked.map((a) => a.last4));
    for (const r of sheet) {
      if (linked4.has(r.last4)) continue;
      const key = `sheet:${pyStr(r.last4)}`;
      const st = settings.get(key) || {};
      const p = plan.get(key) || {};
      const same = r.month === m;
      const due_day = pyt(g(st, 'due_day')) ? st.due_day
        : (pyt(g(r, 'due_day')) && /^\d+$/.test(String(r.due_day)) ? parseInt(String(r.due_day), 10) : null);
      const owed = g(p, 'owed_override') !== null ? p.owed_override : g(r, 'statement_due');
      out.push({
        card_key: key, account_id: null, linked: false, name: por(g(st, 'display_name'), r.card), holder: g(r, 'holder'),
        last4: g(r, 'last4'), institution: null, owed: H.r2(owed), owed_asof: `sheet ${pyStr(r.month)}`,
        statement_due: g(p, 'statement_due') !== null ? p.statement_due : (same ? g(r, 'statement_due') : null),
        min_due: g(p, 'min_due'), due_date: por(g(p, 'due_date'), pyt(due_day) ? H.due_date_in(m, due_day) : null), due_day: due_day,
        planned: pyt(p) ? g(p, 'amount') : (same ? g(r, 'payment_amount') : null),
        pay_from: por(g(p, 'pay_from'), g(st, 'pay_from')), paid: pyt(p) ? pyt(g(p, 'paid')) : (same ? pyt(g(r, 'posted')) : false),
        note: g(p, 'note'), credit_limit: por(g(st, 'credit_limit'), g(r, 'credit_limit')), autopay: pyt(g(st, 'autopay')),
        hidden: pyt(g(st, 'hidden')), updated_by: g(p, 'updated_by'), updated_at: g(p, 'updated_at'), paid_this_month: null,
        payments: [], shares_balance: false, sheet_card: g(r, 'card'), sheet_month: g(r, 'month'), auto_paid: false,
      });
    }
    const k2 = (c) => (por(c.owed, 0) > 0.005 ? -por(c.owed, 0) : 1);
    out.sort((x, y) => (Number(x.hidden) - Number(y.hidden)) || (k2(x) - k2(y)) || cmpStr(x.name, y.name));
    return out;
  }

  function api_cards(q) {
    const H = _H();
    const m = H.v_month(H.first(q, 'month'));
    const cards = cards_for_month(m);
    // v3 addition: last month's planned amount per card (enables "Same as last month").
    const prev = new Map();
    for (const r of _DB().Q('SELECT account_id, amount FROM payment_plan WHERE month=?', [H.add_months(m, -1)])) prev.set(r.account_id, r.amount);
    for (const c of cards) c.prev_planned = prev.has(c.card_key) ? prev.get(c.card_key) : null;
    const cash = H.linked_accounts("a.type IN ('checking','savings')").slice();
    const vis = cards.filter((c) => !c.hidden);
    const owed = sum(vis.filter((c) => por(c.owed, 0) > 0).map((c) => por(c.owed, 0)));
    const planned = sum(vis.map((c) => por(c.planned, 0)));
    const unpaid_planned = sum(vis.filter((c) => !c.paid).map((c) => por(c.planned, 0)));
    const checking = sum(cash.filter((a) => a.type === 'checking' && pyt(a.included) && a.group === 'cash').map((a) => por(a.balance, 0)));
    const by_from = {};
    for (const c of vis) {
      if (pyt(c.planned) && !c.paid) {
        const k = por(c.pay_from, 'Not chosen');
        by_from[k] = (has(by_from, k) ? by_from[k] : 0) + c.planned;
      }
    }
    const tm = H.this_month();
    const months = monthsDesc([distinctCol('SELECT DISTINCT month FROM payment_plan'),
      distinctCol('SELECT DISTINCT month FROM card_statements'), [tm, H.add_months(tm, 1)]]);
    const notes = _DB().Q("SELECT * FROM notes WHERE target_type='month' AND target_id=? ORDER BY created_at DESC", [m]);
    const bf = {};
    for (const k of Object.keys(by_from)) bf[k] = H.r2(by_from[k]);
    return {
      month: m, cards, cash_accounts: cash, months, notes,
      totals: {
        owed: H.r2(owed), planned: H.r2(planned), unpaid_planned: H.r2(unpaid_planned), checking: H.r2(checking),
        left: H.r2(checking - unpaid_planned), by_from: bf,
        paid_count: vis.filter((c) => c.paid).length, count: vis.length,
      },
    };
  }

  // ---- bills -------------------------------------------------------------------------------------------------------
  function bill_suggestions(b, m, taken) {
    const H = _H();
    if (!pyt(b.amount) || pyt(b.variable)) return [];
    const kws = String(por(b.keyword, '')).split('|').filter((k) => k.trim()).map((k) => k.trim().toLowerCase());
    if (!kws.length) return [];
    let [s, e] = H.month_bounds(m);
    const dd = H.due_date_in(m, b.due_day);
    let s2;
    if (pyt(dd)) { // payments land a little before or after the due date, sometimes in the previous month
      s2 = addDays(dd, -12);
      e = addDays(dd, 10);
    } else {
      s2 = s;
    }
    const amt = Math.abs(b.amount);
    const rs = _DB().Q(`SELECT t.txn_id, t.posted_date, t.amount, t.description, COALESCE(a.display_name,a.name) AS account
        FROM transactions t JOIN accounts a USING(account_id) WHERE t.amount<0 AND t.posted_date>=? AND t.posted_date<?
        AND ABS(-t.amount - ?) <= ? ORDER BY t.posted_date`, [s2, e, amt, amt * 0.05 + 0.01]);
    const out = [];
    for (const r of rs) {
      const d = String(por(r.description, '')).toLowerCase();
      if (kws.some((k) => d.includes(k)) && !taken.has(r.txn_id)) {
        r.delta = H.r2(-r.amount - amt);
        out.push(r);
      }
    }
    out.sort((x, y) => Math.abs(x.delta) - Math.abs(y.delta));
    return out.slice(0, 3);
  }

  function api_bills(q) {
    const H = _H(), DB = _DB();
    const m = H.v_month(H.first(q, 'month'));
    const bills = DB.Q('SELECT * FROM bills WHERE active=1 ORDER BY sort, bill_id');
    const st = new Map();
    for (const r of DB.Q('SELECT * FROM bill_status WHERE month=?', [m])) st.set(r.bill_id, r);
    const taken = new Set();
    for (const r of st.values()) if (pyt(g(r, 'txn_id'))) taken.add(r.txn_id);
    const [s, e] = H.month_bounds(m);
    const t0 = H.today_s();
    const soon = addDays(t0, 5);
    for (const b of bills) {
      b.status = st.has(b.bill_id) ? st.get(b.bill_id) : null;
      b.due_date = H.due_date_in(m, b.due_day);
      const paid = pyt(b.status) && pyt(b.status.paid);
      b.paid = paid;
      b.state = paid ? 'paid' : (pyt(b.due_date) && b.due_date < t0 ? 'overdue'
        : pyt(b.due_date) && b.due_date <= soon ? 'soon' : 'upcoming');
      b.suggestions = paid ? [] : bill_suggestions(b, m, taken);
      b.detected = b.suggestions.length > 0;
      if (b.detected && (b.state === 'overdue' || b.state === 'soon')) b.state = 'detected';
      if (pyt(b.category) && pyt(b.variable)) {
        const wa = H.txn_where({
          start: s, end: addDays(e, -1), kind: 'spending',
          category: b.category, subcategory: por(b.subcategory, ''),
        });
        const w = Array.isArray(wa) ? wa[0] : wa.w, args = Array.isArray(wa) ? wa[1] : wa.args;
        b.spent = H.r2(DB.one(`SELECT COALESCE(-SUM(t.amount),0) FROM transactions t JOIN accounts a USING(account_id) WHERE ${w.join(' AND ')}`, args));
      }
      if (pyt(b.status) && pyt(g(b.status, 'txn_id'))) {
        const t = DB.row('SELECT posted_date, amount, description FROM transactions WHERE txn_id=?', [b.status.txn_id]);
        b.paid_txn = t ? { ...t } : null;
      }
      b.note_count = DB.one("SELECT COUNT(*) FROM notes WHERE target_type='bill' AND target_id=?", [String(b.bill_id)]);
    }
    const total = sum(bills.map((b) => por(b.amount, 0)));
    const paid_total = sum(bills.filter((b) => b.paid).map((b) => por(por(g(b.status || {}, 'amount_paid'), b.amount), 0)));
    const sections = [];
    for (const b of bills) if (!sections.includes(b.section)) sections.push(b.section);
    const sheet = DB.Q('SELECT item, budgeted, spent, marked_paid FROM budget_lines WHERE month=? ORDER BY line_no', [m]);
    const tm = H.this_month();
    const months = monthsDesc([distinctCol('SELECT DISTINCT month FROM bill_status'),
      distinctCol('SELECT DISTINCT month FROM budget_lines'), [tm, H.add_months(tm, 1)]]);
    return {
      month: m, bills, sections, months, sheet,
      totals: {
        count: bills.length, paid: bills.filter((b) => b.paid).length, total: H.r2(total), paid_total: H.r2(paid_total),
        remaining: H.r2(total - paid_total), suggested: bills.filter((b) => pyt(b.suggestions)).length,
      },
    };
  }

  // ---- writes ------------------------------------------------------------------------------------------------------
  // Python runs each handler in one transaction that is rolled back on ApiError, so every validation below happens
  // before the first write (same order, same messages); writes go through DB.* (Supabase first, then local mirror).
  // One payment_plan row after applying body b (only keys present change) on top of the current row `cur`.
  function plan_row(b, m, key, cur) {
    const H = _H(), DB = _DB();
    const vals = {
      amount: g(cur, 'amount'), pay_from: g(cur, 'pay_from'), due_date: g(cur, 'due_date'), paid: por(g(cur, 'paid'), 0),
      note: g(cur, 'note'), statement_due: g(cur, 'statement_due'), min_due: g(cur, 'min_due'), owed_override: g(cur, 'owed_override'),
    };
    for (const k of ['amount', 'statement_due', 'min_due', 'owed_override']) {
      if (has(b, k)) vals[k] = H.v_num(g(b, k), k, false, -1e8, 1e8);
    }
    if (has(b, 'pay_from')) vals.pay_from = H.v_str(g(b, 'pay_from'), 'pay_from', false, 120);
    if (has(b, 'due_date')) vals.due_date = H.v_date(g(b, 'due_date'), 'due_date');
    if (has(b, 'paid')) vals.paid = pyt(g(b, 'paid')) ? 1 : 0;
    if (has(b, 'note')) vals.note = H.v_str(g(b, 'note'), 'note', false, 1000);
    return {
      month: m, account_id: key, amount: vals.amount, pay_from: vals.pay_from, due_date: vals.due_date, paid: vals.paid,
      note: vals.note, statement_due: vals.statement_due, min_due: vals.min_due, owed_override: vals.owed_override,
      updated_at: H.now_s(), updated_by: DB.user,
    };
  }

  async function post_plan(b) {
    const H = _H(), DB = _DB();
    b = b || {};
    const m = H.v_month(g(b, 'month'));
    const key = H.v_str(por(g(b, 'card_key'), g(b, 'account_id')), 'card_key', true, 80);
    const cur = DB.row('SELECT * FROM payment_plan WHERE month=? AND account_id=?', [m, key]) || {};
    await DB.upsert('payment_plan', plan_row(b, m, key, cur), ['month', 'account_id']);
    return { ok: true };
  }

  // v3 addition: many cards in ONE write ("Plan every card" and its Undo). Same per-item semantics as /api/plan;
  // everything is validated before the write, so a bad item changes nothing.
  //   body: { month, items: [{ card_key, amount?, paid?, pay_from?, statement_due?, min_due?, due_date?, note? }] }
  async function post_plan_bulk(b) {
    const H = _H(), DB = _DB();
    b = b || {};
    const m = H.v_month(g(b, 'month'));
    const items = g(b, 'items');
    if (!Array.isArray(items) || !items.length) throw new H.ApiError(400, 'items must be a non-empty list');
    if (items.length > 60) throw new H.ApiError(400, 'At most 60 items at a time');
    const rows = new Map();
    for (const it of items) {
      if (!it || typeof it !== 'object') throw new H.ApiError(400, 'Each item must be an object');
      const key = H.v_str(por(g(it, 'card_key'), g(it, 'account_id')), 'card_key', true, 80);
      const cur = rows.get(key) || DB.row('SELECT * FROM payment_plan WHERE month=? AND account_id=?', [m, key]) || {};
      rows.set(key, plan_row(it, m, key, cur));
    }
    await DB.upsert('payment_plan', [...rows.values()], ['month', 'account_id']);
    return { ok: true, updated: rows.size };
  }

  async function post_card_settings(b) {
    const H = _H(), DB = _DB();
    b = b || {};
    const key = H.v_str(g(b, 'card_key'), 'card_key', true, 80);
    const r = DB.row('SELECT * FROM card_settings WHERE card_key=?', [key]);
    const cur = r ? { ...r } : {};
    for (const k of ['display_name', 'pay_from']) {
      if (has(b, k)) cur[k] = H.v_str(g(b, k), k, false, 120);
    }
    if (has(b, 'due_day')) {
      const d = H.v_int(g(b, 'due_day'), 'due_day');
      if (d !== null && d !== undefined && !(d >= 1 && d <= 31)) throw new H.ApiError(400, 'due_day must be 1-31');
      cur.due_day = d === undefined ? null : d;
    }
    if (has(b, 'credit_limit')) cur.credit_limit = H.v_num(g(b, 'credit_limit'), 'credit_limit', false, 0);
    for (const k of ['autopay', 'hidden']) {
      if (has(b, k)) cur[k] = pyt(g(b, k)) ? 1 : 0;
    }
    await DB.upsert('card_settings', {
      card_key: key, display_name: g(cur, 'display_name'), due_day: g(cur, 'due_day'), pay_from: g(cur, 'pay_from'),
      credit_limit: g(cur, 'credit_limit'), autopay: por(g(cur, 'autopay'), 0), hidden: por(g(cur, 'hidden'), 0),
      updated_by: DB.user, updated_at: H.now_s(),
    }, ['card_key']);
    return { ok: true };
  }

  async function post_bill(b) {
    const H = _H(), DB = _DB();
    b = b || {};
    const item = H.v_str(g(b, 'item'), 'item', true, 200);
    let due = g(b, 'due_day');
    if (due !== null && due !== '') {
      const d = H.v_int(due, 'due_day');
      if (!(d >= 1 && d <= 31)) throw new H.ApiError(400, 'due_day must be 1-31');
      due = String(d);
    } else {
      due = '';
    }
    const vals = {
      item,
      section: por(H.v_str(g(b, 'section'), 'section', false, 80), 'Miscellaneous'),
      due_day: due,
      amount: H.v_num(g(b, 'amount'), 'amount', false, 0, 1e7),
      pay_from: H.v_str(g(b, 'pay_from'), 'pay_from', false, 120),
      variable: pyt(g(b, 'variable')) ? 1 : 0,
      keyword: H.v_str(g(b, 'keyword'), 'keyword', false, 200),
      category: H.v_str(g(b, 'category'), 'category', false, 120),
      subcategory: H.v_str(g(b, 'subcategory'), 'subcategory', false, 120),
      entity: H.v_str(g(b, 'entity'), 'entity', false, 120),
      notes: H.v_str(g(b, 'notes'), 'notes', false, 1000),
      autopay: pyt(g(b, 'autopay')) ? 1 : 0,
      updated_by: DB.user,
    };
    let bid = H.v_int(g(b, 'bill_id'), 'bill_id');
    if (pyt(bid)) {
      await DB.update('bills', { bill_id: bid }, vals);
    } else {
      const rows = await DB.insert('bills', { ...vals, sort: 9999, active: 1 });
      bid = rows && rows[0] ? rows[0].bill_id : null;
    }
    return { ok: true, bill_id: bid };
  }

  async function del_bill(q) {
    const H = _H(), DB = _DB();
    const bid = H.v_int(H.first(q || {}, 'id'), 'id', true);
    await DB.update('bills', { bill_id: bid }, { active: 0, updated_by: DB.user }); // soft delete keeps history
    return { ok: true };
  }

  // One bill_status row for bill_id in month m from body b; `prev` is the existing row (its note is kept).
  function bill_status_row(b, m, prev) {
    const H = _H(), DB = _DB();
    const bid = H.v_int(g(b, 'bill_id'), 'bill_id', true);
    const paid = pyt(g(b, 'paid')) ? 1 : 0;
    const tid = paid ? H.v_str(g(b, 'txn_id'), 'txn_id', false, 200) : null;
    let amt = H.v_num(g(b, 'amount_paid'), 'amount_paid', false, 0);
    if (pyt(tid) && amt === null) {
      const r = DB.row('SELECT amount FROM transactions WHERE txn_id=?', [tid]);
      amt = r ? Math.abs(r.amount) : null;
    }
    const note = H.v_str(g(b, 'note'), 'note', false, 500);
    if (prev === undefined) prev = DB.row('SELECT note FROM bill_status WHERE month=? AND bill_id=?', [m, bid]);
    // ON CONFLICT ... note=COALESCE(excluded.note, bill_status.note)
    return {
      month: m, bill_id: bid, paid, amount_paid: paid ? amt : null,
      note: note !== null ? note : (prev ? g(prev, 'note') : null),
      txn_id: tid, paid_at: paid ? H.now_s() : null, paid_by: paid ? DB.user : null,
    };
  }

  async function post_bill_status(b) {
    const H = _H(), DB = _DB();
    b = b || {};
    const m = H.v_month(g(b, 'month'));
    await DB.upsert('bill_status', bill_status_row(b, m), ['month', 'bill_id']);
    return { ok: true };
  }

  // v3 addition: tick or untick many bills in ONE write ("Mark all paid" and its Undo). Same per-item semantics as
  // /api/bill_status; validated before the write.   body: { month, items: [{ bill_id, paid, txn_id?, amount_paid?, note? }] }
  async function post_bill_status_bulk(b) {
    const H = _H(), DB = _DB();
    b = b || {};
    const m = H.v_month(g(b, 'month'));
    const items = g(b, 'items');
    if (!Array.isArray(items) || !items.length) throw new H.ApiError(400, 'items must be a non-empty list');
    if (items.length > 100) throw new H.ApiError(400, 'At most 100 items at a time');
    const rows = new Map();
    for (const it of items) {
      if (!it || typeof it !== 'object') throw new H.ApiError(400, 'Each item must be an object');
      const bid = H.v_int(g(it, 'bill_id'), 'bill_id', true);
      const r = bill_status_row(it, m, rows.has(bid) ? rows.get(bid) : undefined);
      rows.set(r.bill_id, r);
    }
    await DB.upsert('bill_status', [...rows.values()], ['month', 'bill_id']);
    return { ok: true, updated: rows.size };
  }

  async function post_budget(b) {
    const H = _H(), DB = _DB();
    b = b || {};
    const c = H.v_str(g(b, 'category'), 'category', true, 120);
    const amt = H.v_num(g(b, 'monthly_amount'), 'monthly_amount', false, 0, 1e7);
    if (amt === null) {
      await DB.remove('budget', { category: c });
    } else {
      await DB.upsert('budget', { category: c, monthly_amount: amt }, ['category']);
    }
    return { ok: true };
  }

  const HOLDERS = ['Roque', 'Jennifer', 'Joint', 'Business', 'Unconfirmed'];

  async function post_manual_account(b) {
    const H = _H(), DB = _DB();
    b = b || {};
    const iit = g(b, 'include_in_totals');
    const vals = {
      name: H.v_str(g(b, 'name'), 'name', true, 120),
      kind: por(H.v_str(g(b, 'kind'), 'kind', false, 500, ['asset', 'debt']), 'debt'),
      type: H.v_str(g(b, 'type'), 'type', false, 40),
      holder: H.v_str(g(b, 'holder'), 'holder', false, 500, H.HOLDERS || HOLDERS),
      entity: H.v_str(g(b, 'entity'), 'entity', false, 120),
      include_in_totals: (iit === false || iit === 0 || iit === '0') ? 0 : 1,
      status: por(H.v_str(g(b, 'status'), 'status', false, 500, ['open', 'closed']), 'open'),
      rate: H.v_num(g(b, 'rate'), 'rate', false, 0, 100),
      notes: H.v_str(g(b, 'notes'), 'notes', false, 1000),
    };
    let mid = H.v_int(g(b, 'id'), 'id');
    // validate the balance before any write (Python rolls the whole request back on error)
    const bal = H.v_num(g(b, 'balance'), 'balance', false, -1e10, 1e10);
    const as_of = bal !== null ? por(H.v_date(g(b, 'as_of'), 'as_of'), H.today_s()) : null;
    if (pyt(mid)) {
      await DB.update('manual_accounts', { id: mid }, vals);
    } else {
      vals.created_by = DB.user;
      const rows = await DB.insert('manual_accounts', vals);
      mid = rows && rows[0] ? rows[0].id : null;
    }
    if (bal !== null) {
      await DB.insert('manual_account_balances', {
        manual_account_id: mid, as_of, balance: Math.abs(bal), note: null, created_by: DB.user,
      });
    }
    return { ok: true, id: mid };
  }

  async function del_manual_account(q) {
    const H = _H(), DB = _DB();
    const mid = H.v_int(H.first(q || {}, 'id'), 'id', true);
    const r = DB.row('SELECT sheet_loan FROM manual_accounts WHERE id=?', [mid]);
    if (r && pyt(r.sheet_loan)) {
      // sheet-backed debts would be re-created on demand; close instead of deleting
      await DB.update('manual_accounts', { id: mid }, { status: 'closed', include_in_totals: 0 });
    } else {
      await DB.remove('manual_account_balances', { manual_account_id: mid });
      await DB.remove('manual_accounts', { id: mid });
    }
    return { ok: true };
  }

  async function post_manual_balance(b) {
    const H = _H(), DB = _DB();
    b = b || {};
    const mid = H.v_int(g(b, 'manual_account_id'), 'manual_account_id', true);
    if (!DB.row('SELECT 1 AS x FROM manual_accounts WHERE id=?', [mid])) throw new H.ApiError(400, 'Unknown manual account');
    const vals = {
      manual_account_id: mid, as_of: H.v_date(g(b, 'as_of'), 'as_of', true),
      balance: Math.abs(H.v_num(g(b, 'balance'), 'balance', true, -1e10, 1e10)),
      note: H.v_str(g(b, 'note'), 'note', false, 500),
    };
    let eid = H.v_int(g(b, 'id'), 'id');
    if (pyt(eid)) {
      await DB.update('manual_account_balances', { id: eid }, vals);
    } else {
      const rows = await DB.insert('manual_account_balances', { ...vals, created_by: DB.user });
      eid = rows && rows[0] ? rows[0].id : null;
    }
    return { ok: true, id: eid };
  }

  async function del_manual_balance(q) {
    const H = _H(), DB = _DB();
    await DB.remove('manual_account_balances', { id: H.v_int(H.first(q || {}, 'id'), 'id', true) });
    return { ok: true };
  }

  // ---- registration ------------------------------------------------------------------------------------------------
  const Hh = _H();
  Object.assign(Hh, { card_key_for, cards_for_month, bill_suggestions });
  const A = _API();
  Object.assign(A.get, { '/api/cards': api_cards, '/api/bills': api_bills });
  Object.assign(A.post, {
    '/api/plan': post_plan, '/api/plan/bulk': post_plan_bulk, '/api/bill_status/bulk': post_bill_status_bulk, '/api/card_settings': post_card_settings, '/api/bill': post_bill, '/api/bill_status': post_bill_status,
    '/api/budget': post_budget, '/api/manual_account': post_manual_account, '/api/manual_balance': post_manual_balance,
  });
  Object.assign(A.del, {
    '/api/bill': del_bill, '/api/manual_account': del_manual_account, '/api/manual_balance': del_manual_balance,
  });
  Object.assign(Hh, { api_cards, api_bills, post_plan, post_plan_bulk, post_bill_status_bulk, post_card_settings, post_bill, del_bill, post_bill_status, post_budget,
    post_manual_account, del_manual_account, post_manual_balance, del_manual_balance });
})();
