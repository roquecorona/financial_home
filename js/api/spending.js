/* Financial Home — spending, orders and notes API (ported 1:1 from app_v2/app.py).
   api_spending, order_detail, order_label, match_status, api_orders, api_order,
   api_notes, note_target, post_note, del_note, post_order_link, post_order_item. */
'use strict';
(function (g) {
  const H = (g.H = g.H || {});
  const API = (g.API = g.API || {});
  API.get = API.get || {};
  API.post = API.post || {};
  API.del = API.del || {};
  const DB = () => g.DB;

  // ---------------------------------------------------------------------------------------------- small local utils
  // ISO date <-> day number (UTC, no DST issues)
  const dnum = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  };
  const diso = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
  const addDays = (s, k) => diso(dnum(s) + k);
  const daysBetween = (a, b) => dnum(b) - dnum(a); // (b - a).days
  const smax = (a, b) => (a > b ? a : b);
  const smin = (a, b) => (a < b ? a : b);
  const nn = (x) => (x === undefined ? null : x);
  const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
  // Python truthiness for JSON values
  const truthy = (v) => {
    if (Array.isArray(v)) return v.length > 0;
    if (v && typeof v === 'object') return Object.keys(v).length > 0;
    return !!v;
  };
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const nowS = () => {
    if (typeof H.now_s === 'function') return H.now_s();
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const todayS = () => DB().today();
  // Python str.title()
  const pyTitle = (s) => {
    let out = '', prevCased = false;
    for (const ch of s) {
      const lo = ch.toLowerCase(), up = ch.toUpperCase();
      const cased = lo !== up;
      out += cased ? (prevCased ? lo : up) : ch;
      prevCased = cased;
    }
    return out;
  };
  // urllib.parse.quote(s) with safe='/'
  const pyQuote = (s) => encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%2F/g, '/');
  // f'{x:,.2f}' (round-half-even on the exact binary value, like Python)
  const fmtMoney = (x) => {
    let s = x.toFixed(2);
    const exact = Math.abs(x) < 1e21 ? Math.abs(x).toFixed(100) : null;
    if (exact) {
      const frac = exact.split('.')[1];
      if (frac[2] === '5' && /^0*$/.test(frac.slice(3))) { // exact tie: round half to even
        const lastKept = +frac[1];
        if (lastKept % 2 === 0) { // Python rounds down here; toFixed rounded up
          const [ip] = exact.split('.');
          s = (x < 0 ? '-' : '') + ip + '.' + frac.slice(0, 2);
        }
      }
    }
    const neg = s[0] === '-';
    if (neg) s = s.slice(1);
    const [ip, fp] = s.split('.');
    return (neg ? '-' : '') + ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + fp;
  };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const validIso = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    return d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  };
  const J = 'FROM transactions t JOIN accounts a USING(account_id)';

  // ---------------------------------------------------------------------------------------------- orders
  function order_label(o) {
    const id = o.order_id || '';
    const i = id.indexOf(':');
    const num = i < 0 ? id : id.slice(i + 1);
    return `${pyTitle(o.retailer || '')} #${num}`;
  }

  function match_status(o) {
    if (!o.links || !o.links.length) return 'unmatched';
    if (o.total !== null && o.total !== undefined && Math.abs((o.linked_total || 0) - o.total) < 0.02) return 'matched';
    return 'partial';
  }

  function order_detail(oid) {
    const db = DB();
    const o = db.row('SELECT * FROM orders WHERE order_id=?', [oid]);
    if (!o) return null;
    o.items = db.Q('SELECT * FROM order_items WHERE order_id=? ORDER BY line_no', [oid]);
    o.links = db.Q(`SELECT l.method, l.confidence, ${H.TXN_COLS} FROM order_links l JOIN transactions t ON t.txn_id=l.txn_id
        JOIN accounts a USING(account_id) WHERE l.order_id=? AND NOT EXISTS (SELECT 1 FROM order_link_rejects r WHERE r.txn_id=l.txn_id AND r.order_id=l.order_id)
        ORDER BY t.posted_date`, [oid]);
    o.linked_total = H.r2(H.pysum(o.links.map((x) => -x.amount)));
    o.match = match_status(o);
    o.notes = db.Q("SELECT * FROM notes WHERE target_type='order' AND target_id=? ORDER BY created_at DESC", [oid]);
    o.label = order_label(o);
    return o;
  }

  // Match status of many orders in one query (same rule as match_status on order_detail, without loading every order).
  function order_matches(where = '1=1', args = []) {
    const rows = DB().Q(`SELECT o.order_id, o.total, o.order_date, COUNT(x.txn_id) AS n, COALESCE(SUM(-x.amount),0) AS linked
        FROM orders o LEFT JOIN (SELECT l.order_id, t.txn_id, t.amount FROM order_links l JOIN transactions t ON t.txn_id=l.txn_id
          JOIN accounts a USING(account_id) WHERE NOT EXISTS (SELECT 1 FROM order_link_rejects r WHERE r.txn_id=l.txn_id AND r.order_id=l.order_id)) x
          ON x.order_id=o.order_id WHERE ${where} GROUP BY o.order_id ORDER BY o.order_date DESC`, args);
    for (const r of rows) r.match = r.n ? match_status({ links: [1], total: r.total, linked_total: H.r2(r.linked) }) : 'unmatched';
    return rows;
  }

  function api_orders(q) {
    const db = DB();
    const w = ['1=1'], args = [];
    const s = H.v_date(H.first(q, 'start'), 'start'), e = H.v_date(H.first(q, 'end'), 'end');
    if (s) { w.push('o.order_date>=?'); args.push(s); }
    if (e) { w.push('o.order_date<=?'); args.push(e); }
    const r = H.first(q, 'retailer');
    if (r === 'amazon' || r === 'target') { w.push('o.retailer=?'); args.push(r); }
    const text = H.first(q, 'q');
    if (text) {
      const like = '%' + text + '%';
      w.push('(o.order_id LIKE ? OR EXISTS (SELECT 1 FROM order_items i WHERE i.order_id=o.order_id AND (i.title LIKE ? OR i.sku LIKE ?)))');
      args.push(like, like, like);
    }
    const status = H.first(q, 'status');
    const okStatus = status === 'matched' || status === 'partial' || status === 'unmatched';
    // v3 addition: paging. Without limit/offset the result is exactly app.py's (newest 300, status filtered after the limit).
    const paged = H.first(q, 'limit') !== null || H.first(q, 'offset') !== null;
    let orders, filtered, keep = null;
    if (paged) {
      const limit = Math.min(500, Math.max(1, H.v_int(H.first(q, 'limit'), 'limit') || 300));
      const offset = Math.max(0, H.v_int(H.first(q, 'offset'), 'offset') || 0);
      let all = order_matches(w.join(' AND '), args);
      if (okStatus) all = all.filter((o) => o.match === status);
      filtered = all.length;
      if (okStatus) keep = new Set(all.map((o) => o.order_id));
      orders = all.slice(offset, offset + limit).map((o) => order_detail(o.order_id));
    } else {
      const ids = db.Q(`SELECT o.order_id FROM orders o WHERE ${w.join(' AND ')} ORDER BY o.order_date DESC LIMIT 300`, args).map((x) => x.order_id);
      orders = ids.map((oid) => order_detail(oid));
      if (okStatus) orders = orders.filter((o) => o.match === status);
      filtered = null;
    }
    const s60 = s || addDays(todayS(), -90);
    const charges = db.Q(`SELECT ${H.TXN_COLS} FROM transactions t JOIN accounts a USING(account_id) WHERE t.amount<0 AND t.posted_date>=?
        AND ((${H.RETAILER_SQL.amazon}) OR (${H.RETAILER_SQL.target}))
        AND NOT EXISTS (SELECT 1 FROM order_links l WHERE l.txn_id=t.txn_id AND NOT EXISTS (SELECT 1 FROM order_link_rejects x WHERE x.txn_id=l.txn_id AND x.order_id=l.order_id))
        ORDER BY t.posted_date DESC LIMIT 200`, [s60]);
    const counts = { total: db.one('SELECT COUNT(*) FROM orders'), items: db.one('SELECT COUNT(*) FROM order_items') };
    const allo = order_matches().slice(0, 1000);
    counts.matched = allo.filter((o) => o.match === 'matched').length;
    counts.partial = allo.filter((o) => o.match === 'partial').length;
    counts.unmatched = allo.filter((o) => o.match === 'unmatched').length;
    counts.unmatched_charges = charges.length;
    counts.filtered = filtered === null ? orders.length : filtered;
    const spend = new Map();
    const addItem = (it) => { const k = it.category || 'Not set'; spend.set(k, (spend.has(k) ? spend.get(k) : 0) + (it.item_total || (it.unit_price || 0) * (it.quantity || 1))); };
    if (paged) {
      // every order matching the filters, not just this page
      for (const it of db.Q(`SELECT i.* FROM order_items i JOIN orders o ON o.order_id=i.order_id WHERE ${w.join(' AND ')}`, args)) if (!keep || keep.has(it.order_id)) addItem(it);
    } else for (const o of orders) for (const it of o.items) addItem(it);
    const item_categories = [...spend.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k, total: H.r2(v) }));
    return { orders, unmatched_charges: charges, counts, item_categories };
  }

  function api_order(q) {
    const o = order_detail(H.v_str(H.first(q, 'id'), 'id', true));
    if (!o) throw new H.ApiError(404, 'No such order');
    return o;
  }

  // ---------------------------------------------------------------------------------------------- notes
  function note_target(tt, ti) {
    const db = DB();
    if (tt === 'transaction') {
      const r = db.row('SELECT posted_date, amount, description FROM transactions WHERE txn_id=?', [ti]);
      return [r ? `${H.merchant_of(r.description)} · $${fmtMoney(Math.abs(r.amount))} · ${r.posted_date || 'pending'}` : 'Transaction', `#/txn/${ti}`];
    }
    if (tt === 'account') {
      const r = db.Q('SELECT COALESCE(display_name,name) AS v FROM accounts WHERE account_id=?', [ti]);
      return [r.length ? r[0].v : 'Account', `#/accounts/${ti}`];
    }
    if (tt === 'property') {
      const r = db.Q('SELECT name FROM properties WHERE id=?', [ti]);
      return [r.length ? r[0].name : 'Property', `#/properties/${ti}`];
    }
    if (tt === 'order') return [pyTitle(ti.split(':').join(' #')), `#/orders?id=${pyQuote(ti)}`];
    if (tt === 'bill') {
      const r = db.Q('SELECT item FROM bills WHERE bill_id=?', [ti]);
      return [r.length ? r[0].item : 'Bill', '#/bills'];
    }
    if (tt === 'month') {
      const d = ti + '-01';
      if (validIso(d)) return [`${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`, `#/notes?month=${ti}`];
      return [ti, '#/notes'];
    }
    return [tt, '#/notes'];
  }

  function api_notes(q) {
    const db = DB();
    const w = ['1=1'], args = [];
    const tt = H.first(q, 'target_type');
    if (tt) { w.push('n.target_type=?'); args.push(tt); }
    const ti = H.first(q, 'target_id');
    if (ti) { w.push('n.target_id=?'); args.push(ti); }
    const text = H.first(q, 'q');
    if (text) { w.push('n.body LIKE ?'); args.push('%' + text + '%'); }
    const au = H.first(q, 'author');
    if (au) { w.push('n.author=?'); args.push(au); }
    const rows = db.Q(`SELECT n.* FROM notes n WHERE ${w.join(' AND ')} ORDER BY n.pinned DESC, COALESCE(n.updated_at, n.created_at) DESC LIMIT 500`, args);
    for (const n of rows) [n.target_label, n.link] = note_target(n.target_type, n.target_id);
    return { notes: rows };
  }

  async function post_note(b) {
    b = b || {};
    const db = DB();
    const tt = H.v_str(b.target_type, 'target_type', true, 500,
      ['transaction', 'account', 'property', 'order', 'month', 'bill', 'general', 'manual_account']);
    const ti = H.v_str(b.target_id, 'target_id', true, 200);
    if (tt === 'month' && !/^\d{4}-\d{2}$/.test(ti)) throw new H.ApiError(400, 'month notes need a target_id like 2026-10');
    let nid = H.v_int(b.id, 'id');
    if (nid && (b.body === undefined || b.body === null) && has(b, 'pinned')) {
      await db.update('notes', { id: nid }, { pinned: truthy(b.pinned) ? 1 : 0, updated_at: nowS() });
      return { ok: true, id: nid };
    }
    const body = H.v_str(b.body, 'body', true, 5000);
    if (nid) {
      const patch = { body };
      if (has(b, 'pinned')) patch.pinned = truthy(b.pinned) ? 1 : 0;
      patch.updated_at = nowS();
      await db.update('notes', { id: nid }, patch);
    } else {
      const rows = await db.insert('notes', { target_type: tt, target_id: ti, body, author: (db.user || null), created_at: nowS(), pinned: truthy(b.pinned) ? 1 : 0 });
      const r = Array.isArray(rows) ? rows[0] : rows;
      nid = r ? r.id : null;
    }
    return { ok: true, id: nid };
  }

  async function del_note(q) {
    const nid = H.v_int(H.first(q, 'id'), 'id', true);
    await DB().remove('notes', { id: nid });
    return { ok: true };
  }

  async function post_order_link(b) {
    b = b || {};
    const db = DB();
    const tid = H.v_str(b.txn_id, 'txn_id', true, 200);
    const oid = H.v_str(b.order_id, 'order_id', true, 200);
    if (!db.row('SELECT 1 AS x FROM transactions WHERE txn_id=?', [tid]) || !db.row('SELECT 1 AS x FROM orders WHERE order_id=?', [oid])) {
      throw new H.ApiError(404, 'Unknown transaction or order');
    }
    // INSERT OR REPLACE = delete the old row, then insert (the row moves to the end, like SQLite's REPLACE).
    if (b.action === 'unlink') {
      await db.remove('order_links', { txn_id: tid, order_id: oid });
      await db.remove('order_link_rejects', { txn_id: tid, order_id: oid });
      await db.upsert('order_link_rejects', { txn_id: tid, order_id: oid, created_by: (db.user || null), created_at: nowS() }, ['txn_id', 'order_id']);
    } else {
      await db.remove('order_link_rejects', { txn_id: tid, order_id: oid });
      await db.remove('order_links', { txn_id: tid, order_id: oid });
      await db.upsert('order_links', { txn_id: tid, order_id: oid, method: 'manual', confidence: 1.0, created_at: nowS() }, ['txn_id', 'order_id']);
    }
    return { ok: true };
  }

  async function post_order_item(b) {
    b = b || {};
    const oid = H.v_str(b.order_id, 'order_id', true);
    const ln = H.v_int(b.line_no, 'line_no', true);
    const f = {};
    for (const k of ['category', 'subcategory', 'entity', 'person']) {
      if (has(b, k)) f[k] = H.v_str(b[k], k, false, 120);
    }
    if (!Object.keys(f).length) throw new H.ApiError(400, 'Nothing to change');
    await DB().update('order_items', { order_id: oid, line_no: ln }, f);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------------------------- spending
  function api_spending(q) {
    const db = DB();
    const s = H.v_date(H.first(q, 'start'), 'start') || (H.data_start() || todayS());
    const e = H.v_date(H.first(q, 'end'), 'end') || todayS();
    if (s > e) throw new H.ApiError(400, 'start must be before end');
    const base_q = {};
    for (const k of Object.keys(q || {})) if (k === 'holder' || k === 'entity' || k === 'account') base_q[k] = q[k];
    const tw = (extra) => H.txn_where(Object.assign({}, base_q, extra));
    const [w, args] = tw({ start: s, end: e, kind: 'spending' });
    const where = w.join(' AND ');
    const total = db.one(`SELECT COALESCE(-SUM(t.amount),0) ${J} WHERE ${where}`, args) || 0;
    const count = db.one(`SELECT COUNT(*) ${J} WHERE ${where}`, args);
    const ds = H.data_start() || s;
    const cov_s = smax(s, ds);
    const cov_e = smin(e, todayS());
    const cov_days = Math.max(0, daysBetween(cov_s, cov_e) + 1);
    const months_cov = cov_days ? cov_days / 30.4375 : 0;
    const length = daysBetween(s, e) + 1;
    const ps = addDays(s, -length);
    const pe = addDays(s, -1);
    const [pw, pargs] = tw({ start: ps, end: pe, kind: 'spending' });
    const prior = db.one(`SELECT COALESCE(-SUM(t.amount),0) ${J} WHERE ${pw.join(' AND ')}`, pargs) || 0;
    const prior_cov = pe >= ds ? Math.max(0, daysBetween(smax(ps, ds), pe) + 1) : 0;
    const prior_ok = prior_cov >= 0.9 * length;
    const [iw, iargs] = tw({ start: s, end: e, kind: 'income' });
    const income = db.one(`SELECT COALESCE(SUM(t.amount),0) ${J} WHERE ${iw.join(' AND ')}`, iargs) || 0;
    const cats = db.Q(`SELECT COALESCE(t.category,'Uncategorized') AS category, -SUM(t.amount) AS total, COUNT(*) AS n
        ${J} WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`, args);
    const pcats = new Map();
    for (const r of db.Q(`SELECT COALESCE(t.category,'Uncategorized') AS category, -SUM(t.amount) AS total
        ${J} WHERE ${pw.join(' AND ')} GROUP BY 1`, pargs)) pcats.set(r.category, r.total);
    const budgets = new Map();
    for (const r of db.Q('SELECT * FROM budget')) budgets.set(r.category, r.monthly_amount);
    for (const c of cats) {
      c.total = H.r2(c.total);
      c.share = total ? c.total / total : 0;
      c.prior = prior_ok ? H.r2(nn(pcats.get(c.category))) : null;
      c.budget_monthly = nn(budgets.get(c.category));
      c.avg_month = months_cov >= 1 ? H.r2(c.total / months_cov) : null;
    }
    const months = H.month_range(H.month_of(s), H.month_of(e));
    const mrows = db.Q(`SELECT substr(t.posted_date,1,7) AS month, COALESCE(t.category,'Uncategorized') AS category, -SUM(t.amount) AS total
        ${J} WHERE ${where} GROUP BY 1,2`, args);
    const monthly = {};
    for (const m of months) monthly[m] = {};
    for (const r of mrows) (monthly[r.month] = monthly[r.month] || {})[r.category] = H.r2(r.total);
    const magg = new Map();
    for (const r of db.Q(`SELECT merchant_of(t.description) AS merchant, COALESCE(t.category,'Uncategorized') AS category, -SUM(t.amount) AS total,
            COUNT(*) AS n, MAX(t.posted_date) AS last ${J} WHERE ${where} GROUP BY 1,2`, args)) {
      let x = magg.get(r.merchant);
      if (!x) { x = { merchant: r.merchant, total: 0.0, n: 0, last: '', category: r.category, _best: -1e18 }; magg.set(r.merchant, x); }
      x.total += r.total;
      x.n += r.n;
      x.last = smax(x.last, r.last || '');
      if (r.total > x._best) { x._best = r.total; x.category = r.category; }
    }
    const merchants = [...magg.values()].sort((a, b) => b.total - a.total).slice(0, 25);
    for (const x of merchants) { delete x._best; x.total = H.r2(x.total); }
    const by_holder = db.Q(`SELECT COALESCE(a.holder,'Unconfirmed') AS name, ROUND(-SUM(t.amount),2) AS total, COUNT(*) AS n ${J} WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`, args);
    const by_entity = db.Q(`SELECT COALESCE(t.entity,'household') AS name, ROUND(-SUM(t.amount),2) AS total, COUNT(*) AS n ${J} WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`, args);
    const by_account = db.Q(`SELECT t.account_id, COALESCE(a.display_name,a.name) AS name, ROUND(-SUM(t.amount),2) AS total, COUNT(*) AS n ${J} WHERE ${where} GROUP BY 1 ORDER BY 3 DESC`, args);
    let detail = null;
    const cat = H.first(q, 'category');
    if (cat) {
      const [cw, cargs] = tw({ start: s, end: e, kind: 'spending', category: cat });
      const cwhere = cw.join(' AND ');
      detail = {
        category: cat,
        total: H.r2(db.one(`SELECT COALESCE(-SUM(t.amount),0) ${J} WHERE ${cwhere}`, cargs)),
        subcategories: db.Q(`SELECT COALESCE(t.subcategory,'(none)') AS name, ROUND(-SUM(t.amount),2) AS total, COUNT(*) AS n
                ${J} WHERE ${cwhere} GROUP BY 1 ORDER BY 2 DESC`, cargs),
        merchants: db.Q(`SELECT merchant_of(t.description) AS merchant, ROUND(-SUM(t.amount),2) AS total, COUNT(*) AS n,
                MAX(t.posted_date) AS last ${J} WHERE ${cwhere} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, cargs),
        monthly: months.map((m) => ({ month: m, total: has(monthly[m] || {}, cat) ? monthly[m][cat] : 0 })),
      };
    }
    const budget_rows = [];
    const nmonths = Math.max(months_cov, 0);
    const allcats = new Map();
    for (const c of cats) allcats.set(c.category, c.total);
    const ac = (k) => (allcats.has(k) ? allcats.get(k) : 0);
    for (const [bc, amt] of budgets) {
      if (amt === null || amt === undefined) continue;
      budget_rows.push({ category: bc, monthly: amt, period_budget: H.r2(amt * nmonths), actual: H.r2(ac(bc)),
        avg_month: nmonths ? H.r2(ac(bc) / nmonths) : null });
    }
    return {
      start: s, end: e, total: H.r2(total), count, income: H.r2(income), months_covered: H.r2(months_cov),
      avg_month: months_cov >= 0.5 ? H.r2(total / months_cov) : null,
      prior: { start: ps, end: pe, total: H.r2(prior), ok: prior_ok },
      change: prior_ok && prior ? (total - prior) / prior : null, categories: cats, months, monthly,
      merchants, by_holder, by_entity, by_account, detail, budgets: budget_rows, data_start: ds, cat_slots: H.cat_slots(),
    };
  }

  // ---------------------------------------------------------------------------------------------- registration
  Object.assign(H, { order_detail, order_label, match_status, note_target });
  API.get['/api/spending'] = api_spending;
  API.get['/api/orders'] = api_orders;
  API.get['/api/order'] = api_order;
  API.get['/api/notes'] = api_notes;
  API.post['/api/note'] = post_note;
  API.post['/api/order_link'] = post_order_link;
  API.post['/api/order_item'] = post_order_item;
  API.del['/api/note'] = del_note;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { api_spending, order_detail, order_label, match_status, api_orders, api_order, api_notes, note_target,
      post_note, del_note, post_order_link, post_order_item };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
