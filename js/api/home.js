/* Home / accounts / transactions API: ported 1:1 from app_v2/app.py (balance_totals .. post_account).
   Same SQL, same rounding, same response shape. Helpers come from H (helpers.js and other groups' files). */
(function () {
  'use strict';
  const G = globalThis;
  const H = G.H || (G.H = {});
  const API = G.API || (G.API = {});
  API.get = API.get || {};
  API.post = API.post || {};
  API.del = API.del || {};
  const DB = () => G.DB;

  const INVEST_TYPES = ['ira', 'hsa', '401k', '403b', 'brokerage', '529'];

  // ---- small local utilities (date math on ISO strings, Python-compatible formatting) ----
  const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
  const pyTrue = (v) => !(v === null || v === undefined || v === false || v === 0 || v === '' ||
    (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0));
  function addDays(iso, k) {
    const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
    d.setUTCDate(d.getUTCDate() + k);
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) { // (b - a).days
    const ua = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
    const ub = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
    return Math.round((ub - ua) / 86400000);
  }
  const daysInMonth = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
  const todayS = () => (H.today_s ? H.today_s() : DB().today());
  const thisMonth = () => (H.this_month ? H.this_month() : todayS().slice(0, 7));
  const getk = (o, k, dflt) => (o instanceof Map ? (o.has(k) ? o.get(k) : dflt) : (has(o, k) ? o[k] : dflt));
  // Python f"{x:,.Nf}" (d = 0 or 2): round half-even on the exact binary value, then group thousands
  function pyFmt(x, digits) {
    const ax = Math.abs(x);
    let s;
    if (digits === 0) {
      const f = Math.floor(ax), fr = ax - f;
      s = String(fr > 0.5 ? f + 1 : fr < 0.5 ? f : (f % 2 === 0 ? f : f + 1));
    } else {
      s = ax.toFixed(digits);
      if (digits === 2 && Number.isInteger(ax * 8) && !Number.isInteger(ax * 4)) { // exact tie (k/8, k odd)
        let n = Math.floor(ax * 100);
        if (n % 2) n += 1;
        s = (n / 100).toFixed(2);
      }
    }
    let [ip, fp] = s.split('.');
    ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (x < 0 ? '-' : '') + ip + (fp ? '.' + fp : '');
  }
  // urllib.parse.quote (safe='/')
  const pyQuote = (s) => encodeURIComponent(String(s))
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%2F/g, '/');
  const hexToken = (n) => {
    const b = new Uint8Array(n);
    G.crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  };

  // our ownership share of a property row (properties.ownership_pct, percent; NULL or missing = 100%)
  const propShare = (p) => (p.ownership_pct === null || p.ownership_pct === undefined || p.ownership_pct === '' ? 1 : Number(p.ownership_pct) / 100);
  const COALESCE_STATUS = (p) => p.status || '';

  // ---- helpers ----
  H.balance_totals = function (include_re = true) {
    const accts = H.linked_accounts();
    const man = H.manual_accounts();
    const t = { cash: 0.0, cards: 0.0, investments: 0.0, loans: 0.0, other_assets: 0.0, real_estate: 0.0 };
    for (const a of accts) {
      if (!a.included || a.balance == null) continue;
      const g = a.group;
      if (g === 'cash') t.cash += a.balance;
      else if (g === 'cards') t.cards += -a.balance;
      else if (g === 'investments') t.investments += a.balance;
      else if (g === 'loans') t.loans += a.balance < 0 ? -a.balance : a.balance;
      else t.other_assets += a.balance;
    }
    for (const m of man) {
      if (!pyTrue(m.include_in_totals) || m.balance == null) continue;
      if (m.kind === 'debt') t.loans += Math.abs(m.balance);
      else t.other_assets += m.balance;
    }
    if (include_re) {
      // our share of each property we still own (ownership_pct NULL = 100%)
      for (const p of DB().Q("SELECT * FROM properties WHERE est_value IS NOT NULL AND COALESCE(status,'') != 'sold'")) {
        t.real_estate += p.est_value * propShare(p);
      }
    }
    t.assets = t.cash + t.investments + t.other_assets + t.real_estate;
    t.liabilities = t.cards + t.loans;
    t.net_worth = t.assets - t.liabilities;
    const out = {};
    for (const k of Object.keys(t)) out[k] = H.r2(t[k]);
    return [out, accts, man];
  };

  H.networth_series = function (months) {
    const db = DB();
    const accts = H.linked_accounts().filter((a) => a.included);
    const ds = H.data_start();
    const walkers = {}, inv = {};
    const inv_accts = accts.filter((a) => a.group === 'investments');
    const flows = H.inv_flows(inv_accts.map((a) => a.account_id));
    for (const a of accts) {
      if (a.group === 'investments') inv[a.account_id] = H.inv_valuations(a.account_id);
      else walkers[a.account_id] = new H.BalanceWalker(a.account_id, ds);
    }
    const mans = db.Q('SELECT * FROM manual_accounts').filter((m) => pyTrue(m.include_in_totals) || m.status === 'closed');
    const mpts = new Map(mans.map((m) => [m.id, H.manual_points(m)]));
    // real estate at a date: our share of what we owned then. A sold property counts (at its sale price) only before
    // its sale_date; without a sale_date it is simply left out, as before.
    const props = db.Q('SELECT * FROM properties');
    const re_at = (d) => H.pysum(props.filter((p) => (COALESCE_STATUS(p) !== 'sold' ? p.est_value != null
      : !!p.sale_date && d < p.sale_date && (p.sale_price ?? p.est_value) != null))
      .map((p) => (COALESCE_STATUS(p) !== 'sold' ? p.est_value : (p.sale_price ?? p.est_value)) * propShare(p)));
    const material = {};
    for (const a of accts) {
      const aid = a.account_id;
      let vals = (inv[aid] || []).map((x) => x[1]);
      if (!vals.length) vals = db.Q('SELECT balance FROM balances WHERE account_id=?', [aid]).map((r) => r.balance);
      material[aid] = vals.some((v) => Math.abs(v || 0) >= 1);
    }
    const out = [];
    const t = todayS();
    for (const m of months) {
      const me = H.month_end(m);
      const d = me < t ? me : t;
      let assets = 0.0, liab = 0.0, cash = 0.0, cards = 0.0, invest = 0.0, loans = 0.0;
      const missing = [];
      const valued = new Set();
      for (const a of accts) {
        const aid = a.account_id;
        let v;
        if (a.group === 'investments') v = H.inv_value_at(inv[aid], getk(flows, aid, []), d)[0];
        else v = walkers[aid].at(d);
        if (v == null) {
          if (has(material, aid) ? material[aid] : true) missing.push(a.label);
          continue;
        }
        valued.add(aid);
        const g = a.group;
        if (g === 'cash') cash += v;
        else if (g === 'cards') cards += -v;
        else if (g === 'investments') invest += v;
        else if (g === 'loans') loans += Math.abs(v);
        else assets += v;
      }
      for (const ma of mans) {
        // a hand-tracked debt now covered by a synced account ("[synced:<account_id>]" in its notes) only fills months
        // the synced account has no value for, so the two are never counted together
        const rep = /\[synced:([\w.-]+)\]/.exec(ma.notes || '');
        if (rep && valued.has(rep[1])) continue;
        const v = H.manual_value(ma, d, mpts.get(ma.id))[0];
        if (v == null) {
          if (pyTrue(ma.include_in_totals)) missing.push(ma.name);
          continue;
        }
        if (ma.kind === 'debt') loans += Math.abs(v);
        else assets += v;
      }
      const re_val = re_at(d);
      assets += cash + invest + re_val;
      liab = cards + loans;
      out.push({ month: m, date: d, cash: H.r2(cash), cards: H.r2(cards), investments: H.r2(invest), loans: H.r2(loans),
        real_estate: H.r2(re_val), assets: H.r2(assets), liabilities: H.r2(liab), net_worth: H.r2(assets - liab),
        missing, complete: !missing.length });
    }
    return out;
  };

  H.month_flow = function (m) {
    const [s, e] = H.month_bounds(m);
    const inc = DB().one(`SELECT COALESCE(SUM(t.amount),0) FROM transactions t JOIN accounts a USING(account_id) WHERE ${H.INCOME_SQL} AND t.posted_date>=? AND t.posted_date<?`, [s, e]);
    const sp = DB().one(`SELECT COALESCE(-SUM(t.amount),0) FROM transactions t JOIN accounts a USING(account_id) WHERE ${H.SPEND_SQL} AND t.posted_date>=? AND t.posted_date<?`, [s, e]);
    return [H.r2(inc), H.r2(sp)];
  };

  H.daily_cumulative_spend = function (m) {
    const [s, e] = H.month_bounds(m);
    const rs = DB().Q(`SELECT t.posted_date AS d, -SUM(t.amount) AS v FROM transactions t JOIN accounts a USING(account_id)
        WHERE ${H.SPEND_SQL} AND t.posted_date>=? AND t.posted_date<? GROUP BY 1 ORDER BY 1`, [s, e]);
    const days = daysInMonth(m);
    const by = new Map(rs.map((r) => [parseInt(r.d.slice(8, 10), 10), r.v]));
    const out = [];
    let c = 0.0;
    let lim = days;
    if (m === thisMonth()) lim = parseInt(todayS().slice(8, 10), 10);
    for (let d = 1; d <= days; d++) {
      c += by.has(d) ? by.get(d) : 0;
      out.push(d <= lim ? H.r2(c) : null);
    }
    return out;
  };

  H.due_date_in = function (m, due_day) {
    // Python: int(str(due_day).strip()); a float like 15.0 stringifies to '15.0' and fails -> None
    if (due_day === null || due_day === undefined || typeof due_day === 'boolean') return null;
    const s = String(due_day).trim();
    if (!/^[+-]?\d+$/.test(s)) return null;
    const d = parseInt(s, 10);
    if (!(d >= 1 && d <= 31)) return null;
    return m + '-' + String(Math.min(d, daysInMonth(m))).padStart(2, '0');
  };

  H.upcoming_items = function (days = 14) {
    const db = DB();
    const t0 = todayS();
    const t1 = addDays(t0, days);
    const items = [];
    const months = [...new Set([t0.slice(0, 7), t1.slice(0, 7)])].sort();
    const tm = thisMonth();
    for (const m of months) {
      const st = new Map(db.Q('SELECT * FROM bill_status WHERE month=?', [m]).map((r) => [r.bill_id, r]));
      const taken = new Set([...st.values()].filter((r) => pyTrue(r.txn_id)).map((r) => r.txn_id));
      for (const b of db.Q('SELECT * FROM bills WHERE active=1')) {
        const dd = H.due_date_in(m, b.due_day);
        if (!dd) continue;
        const s0 = st.get(b.bill_id) || {};
        if (!pyTrue(s0.paid) && pyTrue(H.bill_suggestions(b, m, taken))) continue; // a matching payment already went out
        if ((t0 <= dd && dd <= t1) || (dd < t0 && m === tm && !pyTrue(s0.paid))) {
          const s = st.get(b.bill_id) || {};
          items.push({ kind: 'bill', id: b.bill_id, name: b.item, date: dd, amount: b.amount, pay_from: b.pay_from,
            paid: pyTrue(s.paid), overdue: dd < t0 && !pyTrue(s.paid), month: m });
        }
      }
      for (const c of H.cards_for_month(m)) {
        if (pyTrue(c.hidden) || !pyTrue(c.due_date) || pyTrue(c.auto_paid)) continue;
        const dd = c.due_date;
        const owed = c.statement_due != null ? c.statement_due : c.owed;
        if (!pyTrue(owed) || owed <= 0.005) continue;
        if ((t0 <= dd && dd <= t1) || (dd < t0 && m === tm && !pyTrue(c.paid))) {
          items.push({ kind: 'card', id: c.card_key, name: c.name, date: dd, amount: c.planned != null ? c.planned : owed,
            pay_from: c.pay_from, paid: c.paid, overdue: dd < t0 && !pyTrue(c.paid), month: m,
            account_id: c.account_id === undefined ? null : c.account_id });
        }
      }
    }
    items.sort((x, y) => (Number(pyTrue(x.paid)) - Number(pyTrue(y.paid))) || (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    return items;
  };

  H.alerts = function () {
    const db = DB();
    const out = [];
    const t = todayS();
    const since = addDays(t, -90);
    const n = db.one(`SELECT COUNT(*) FROM transactions t JOIN accounts a USING(account_id) WHERE t.posted_date>=? AND t.is_transfer=0
        AND (t.category IS NULL OR t.category IN ('','Uncategorized')) AND a.type NOT IN ('ira','hsa','401k','403b','brokerage','529')`, [since]);
    if (n) {
      out.push({ level: 'warning', kind: 'uncategorized', title: `${n} transaction${n !== 1 ? 's need' : ' needs'} a category`,
        detail: 'From the last 90 days', link: '#/spending?category=__none__&preset=all' });
    }
    const rev = db.one("SELECT COUNT(*) FROM transactions WHERE subcategory LIKE '%(review)%' AND posted_date>=? AND COALESCE(tags,'') NOT LIKE '%manual%'", [since]);
    if (rev) {
      out.push({ level: 'info', kind: 'review', title: `${rev} Zelle payment${rev !== 1 ? 's' : ''} to review`,
        detail: 'Sent to a person; add who/why so they land in the right category', link: '#/spending?q=zelle&preset=3m' });
    }
    const m = thisMonth();
    const [s, e] = H.month_bounds(m);
    const budgets = new Map(db.Q('SELECT * FROM budget WHERE monthly_amount IS NOT NULL').map((r) => [r.category, r.monthly_amount]));
    if (budgets.size) {
      for (const r of db.Q(`SELECT t.category, -SUM(t.amount) AS spent FROM transactions t JOIN accounts a USING(account_id)
                WHERE ${H.SPEND_SQL} AND t.posted_date>=? AND t.posted_date<? GROUP BY 1`, [s, e])) {
        const b = budgets.get(r.category);
        if (b && r.spent > b) {
          out.push({ level: 'serious', kind: 'budget', title: `${r.category} is over budget`,
            detail: `$${pyFmt(r.spent, 0)} spent of $${pyFmt(b, 0)} this month`,
            link: `#/spending?category=${pyQuote(r.category)}&preset=this_month` });
        }
      }
    }
    const stale = db.Q(`SELECT COALESCE(a.display_name,a.name) AS name, MAX(b.as_of) AS last FROM accounts a LEFT JOIN balances b USING(account_id)
        WHERE a.simplefin_id IS NOT NULL AND COALESCE(a.status,'open') != 'closed' GROUP BY a.account_id`);
    const cutoff = addDays(t, -2);
    const st = stale.filter((x) => !x.last || x.last < cutoff);
    if (st.length) {
      out.push({ level: 'warning', kind: 'stale', title: `${st.length} account${st.length !== 1 ? 's' : ''} not synced in 2+ days`,
        detail: st.slice(0, 3).map((x) => x.name).join(', ') + (st.length > 3 ? '…' : ''), link: '#/settings?tab=data' });
    }
    const thrRaw = H.setting('large_txn_threshold', '1000');
    const thr = parseFloat(pyTrue(thrRaw) ? thrRaw : 1000);
    const big = db.Q(`SELECT t.txn_id, t.amount, t.description, t.posted_date FROM transactions t JOIN accounts a USING(account_id)
        WHERE t.posted_date>=? AND t.is_transfer=0 AND ABS(t.amount)>=? AND a.type NOT IN ('ira','hsa','401k','403b','brokerage','529')
        ORDER BY t.posted_date DESC LIMIT 5`, [addDays(t, -7), thr]);
    for (const b of big) {
      out.push({ level: 'info', kind: 'large', title: `Large ${b.amount > 0 ? 'deposit' : 'charge'}: $${pyFmt(Math.abs(b.amount), 2)}`,
        detail: `${H.merchant_of(b.description)} · ${b.posted_date}`, txn_id: b.txn_id });
    }
    const has_orders = db.one('SELECT COUNT(*) FROM orders');
    const s60 = addDays(t, -60);
    if (has_orders) {
      const un = db.one(`SELECT COUNT(*) FROM transactions t JOIN accounts a USING(account_id) WHERE t.amount<0 AND t.posted_date>=?
            AND ((${H.RETAILER_SQL.amazon}) OR (${H.RETAILER_SQL.target}))
            AND NOT EXISTS (SELECT 1 FROM order_links l WHERE l.txn_id=t.txn_id)`, [s60]);
      if (un) {
        out.push({ level: 'info', kind: 'orders', title: `${un} Amazon/Target charges without an order`,
          detail: 'Last 60 days · link them to see what was bought', link: '#/orders?tab=charges' });
      }
    } else {
      out.push({ level: 'info', kind: 'orders', title: 'No Amazon or Target orders imported yet',
        detail: 'Import the Amazon and Target order history to see what each charge bought', link: '#/orders' });
    }
    // v3: card promo (0% APR) periods ending within 45 days go first, then everything else; a one-line summary of the
    // promos running longer goes last (H.promo_alerts lives in cards.js)
    if (typeof H.promo_alerts === 'function') {
      const pa = H.promo_alerts();
      out.unshift(...pa.filter((a) => a.kind === 'promo'));
      out.push(...pa.filter((a) => a.kind !== 'promo'));
    }
    return out;
  };

  // Net worth by month from the first month with data (at most 36 months back) through month m.
  H.networth_recent = function (m) {
    const db = DB();
    const ds = H.data_start();
    let m0 = ds ? H.month_of(ds) : m;
    const firsts = [db.one('SELECT MIN(as_of) FROM manual_snapshots'), db.one('SELECT MIN(month) FROM loan_balances')];
    for (const f of firsts) if (f && f.slice(0, 7) < m0) m0 = f.slice(0, 7);
    const lo = H.add_months(m, -36);
    if (lo > m0) m0 = lo;
    return H.networth_series(H.month_range(m0, m));
  };

  // ---- GET handlers ----
  function api_home(q) {
    const db = DB();
    const [totals, accts, man] = H.balance_totals();
    const m = thisMonth();
    const lm = H.add_months(m, -1);
    const [inc, sp] = H.month_flow(m);
    const [linc, lsp] = H.month_flow(lm);
    const ds = H.data_start();
    const nw = H.networth_recent(m);
    const flow6 = [];
    for (let k = 5; k >= 0; k--) {
      const mm = H.add_months(m, -k);
      const [i, s] = H.month_flow(mm);
      flow6.push({ month: mm, income: i, spending: s });
    }
    const recent = db.Q(`SELECT ${H.TXN_COLS} FROM transactions t JOIN accounts a USING(account_id)
        WHERE a.type NOT IN ('ira','hsa','401k','403b','brokerage','529') ORDER BY t.posted_date IS NULL DESC, t.posted_date DESC, t.created_at DESC LIMIT 10`);
    const last_sync = db.one("SELECT MAX(as_of) FROM balances WHERE source='simplefin'");
    const last_import = db.one('SELECT MAX(imported_at) FROM imports');
    const pinned = db.Q("SELECT * FROM notes WHERE pinned=1 AND (target_type IS NULL OR target_type IN ('', 'month', 'general')) ORDER BY updated_at DESC, created_at DESC LIMIT 3");
    return { totals, month: m, last_month: lm, income: inc, spending: sp, last_income: linc, last_spending: lsp,
      pace: { this: H.daily_cumulative_spend(m), last: H.daily_cumulative_spend(lm) },
      networth: nw, flow: flow6, upcoming: H.upcoming_items(), alerts: H.alerts(), recent,
      last_sync, last_import, data_start: ds, pinned_notes: pinned, accounts_count: accts.length + man.length };
  }

  function api_accounts(q) {
    const db = DB();
    const [totals, accts, man] = H.balance_totals();
    const t = todayS();
    const cutoff = addDays(t, -2);
    for (const a of accts) {
      a.stale = !!(a.as_of && a.as_of < cutoff && a.balance_source !== 'manual snapshot');
      a.first_txn = db.one('SELECT MIN(posted_date) FROM transactions WHERE account_id=?', [a.account_id]);
      a.note_count = db.one("SELECT COUNT(*) FROM notes WHERE target_type='account' AND target_id=?", [a.account_id]);
      a.spark = [];
    }
    // v3: details (opened, limit, APR, due day, promo…) for the list's chips; see H.account_details in cards.js
    if (typeof H.account_details === 'function') {
      const st = H.settings_by_account();
      for (const a of accts) a.details = H.account_details(a, st.get(a.account_id) || {});
    }
    const ds = H.data_start();
    const days = [];
    for (let k = 29; k >= 0; k--) days.push(addDays(t, -k));
    for (const a of accts) {
      if (['cash', 'cards', 'loans'].includes(a.group)) {
        const w = new H.BalanceWalker(a.account_id, ds);
        a.spark = days.map((d) => H.r2(w.at(d)));
      }
    }
    // v3 addition: the net worth trend lives on Accounts (Home links here instead of repeating it).
    return { totals, accounts: accts, manual: man, networth: H.networth_recent(thisMonth()) };
  }

  function api_account(q) {
    const db = DB();
    const aid = H.v_str(H.first(q, 'id'), 'id', true);
    const rs = H.linked_accounts('a.account_id=?', [aid]);
    if (!rs.length) throw new H.ApiError(404, 'No such account');
    const a = rs[0];
    const ds = H.data_start();
    const first_tx = db.one('SELECT MIN(posted_date) FROM transactions WHERE account_id=?', [aid]);
    const t = todayS();
    let hist = [];
    if (a.group === 'investments') {
      const vals = H.inv_valuations(aid);
      const flows = getk(H.inv_flows([aid]), aid, []);
      hist = vals.map(([d, v, s]) => ({ date: d, balance: H.r2(v), source: s }));
      const eng = H.inv_engine([a], '1900-01-01', t);
      a.contributions_all = H.r2(H.pysum(flows.filter((f) => f[2] === 'contribution').map((f) => f[1])));
      a.monthly_values = eng.months.map((r) => ({ month: r.month, value: r.total }));
      a.snapshots = db.Q('SELECT * FROM manual_snapshots WHERE account_id=? ORDER BY as_of DESC', [aid]);
      a.holdings = H.latest_holdings([aid]);
    } else {
      const w = new H.BalanceWalker(aid, ds);
      const start = w.start || t;
      const n = daysBetween(start, t);
      const step = n <= 400 ? 1 : 7;
      for (let k = 0; k <= n; k += step) {
        const d = addDays(start, k);
        const v = w.at(d);
        if (v != null) hist.push({ date: d, balance: H.r2(v) });
      }
      if (hist.length && hist[hist.length - 1].date !== t) {
        const v = w.at(t);
        if (v != null) hist.push({ date: t, balance: H.r2(v) });
      }
    }
    const monthly = db.Q(`SELECT substr(posted_date,1,7) AS month, ROUND(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END),2) AS money_in,
        ROUND(-SUM(CASE WHEN amount<0 THEN amount ELSE 0 END),2) AS money_out, COUNT(*) AS n FROM transactions
        WHERE account_id=? AND posted_date IS NOT NULL GROUP BY 1 ORDER BY 1`, [aid]);
    const cats = db.Q(`SELECT COALESCE(category,'Uncategorized') AS category, ROUND(-SUM(amount),2) AS total, COUNT(*) n FROM transactions
        WHERE account_id=? AND amount<0 AND is_transfer=0 GROUP BY 1 HAVING total>0 ORDER BY 2 DESC`, [aid]);
    const notes = db.Q("SELECT * FROM notes WHERE target_type='account' AND target_id=? ORDER BY pinned DESC, created_at DESC", [aid]);
    const counts = db.row('SELECT COUNT(*) AS n, MIN(posted_date) AS lo, MAX(posted_date) AS hi FROM transactions WHERE account_id=?', [aid]);
    if (typeof H.account_details === 'function') a.details = H.account_details(a); // v3: opened, limit, APR, due day, promo…
    return { account: a, history: hist, monthly, categories: cats, notes, data_since: first_tx,
      txn_count: counts.n, first: counts.lo, last: counts.hi, reconstructed: a.group !== 'investments' };
  }

  function api_transactions(q) {
    const db = DB();
    const [w, args] = H.txn_where(q);
    const sk = H.first(q, 'sort', 'date');
    const sort = has(H.SORTS, sk) ? H.SORTS[sk] : 't.posted_date';
    const direction = H.first(q, 'dir') === 'asc' ? 'ASC' : 'DESC';
    const lim = Math.max(1, Math.min(Math.trunc(H.v_num(H.first(q, 'limit'), 'limit') || 200), 1000));
    const off = Math.max(0, Math.trunc(H.v_num(H.first(q, 'offset'), 'offset') || 0));
    const where = w.join(' AND ');
    const agg = db.row(`SELECT COUNT(*) AS n, COALESCE(SUM(t.amount),0) AS net, COALESCE(SUM(CASE WHEN t.amount<0 THEN -t.amount END),0) AS out_,
        COALESCE(SUM(CASE WHEN t.amount>0 THEN t.amount END),0) AS into_ FROM transactions t JOIN accounts a USING(account_id) WHERE ${where}`, args);
    const nulls = sort === 't.posted_date' && direction === 'DESC' ? 't.posted_date IS NULL DESC, ' : '';
    const rows = db.Q(`SELECT ${H.TXN_COLS} FROM transactions t JOIN accounts a USING(account_id) WHERE ${where}
        ORDER BY ${nulls}${sort} ${direction}, t.txn_id LIMIT ? OFFSET ?`, args.concat([lim, off]));
    return { transactions: rows, total: agg.n, net: H.r2(agg.net), out: H.r2(agg.out_), into: H.r2(agg.into_), limit: lim, offset: off };
  }

  function api_txn(q) {
    const db = DB();
    const tid = H.v_str(H.first(q, 'id'), 'id', true);
    const rs = db.Q(`SELECT ${H.TXN_COLS}, t.memo, t.check_number, t.source_ref, t.created_at, t.updated_by, t.updated_at, t.import_id FROM transactions t JOIN accounts a USING(account_id) WHERE t.txn_id=?`, [tid]);
    if (!rs.length) throw new H.ApiError(404, 'No such transaction');
    const t = rs[0];
    t.notes_list = db.Q("SELECT * FROM notes WHERE target_type='transaction' AND target_id=? ORDER BY pinned DESC, created_at DESC", [tid]);
    const oids = db.Q(`SELECT l.order_id FROM order_links l WHERE l.txn_id=? AND NOT EXISTS
        (SELECT 1 FROM order_link_rejects r WHERE r.txn_id=l.txn_id AND r.order_id=l.order_id)`, [tid]).map((r) => r.order_id);
    t.orders = oids.map((o) => H.order_detail(o));
    const desc = t.description || '';
    const retailer = /amazon|amzn/i.test(desc) ? 'amazon' : /^target/i.test(desc) ? 'target' : null;
    t.retailer = retailer;
    t.order_candidates = [];
    if (retailer && t.posted_date) {
      const d = t.posted_date;
      t.order_candidates = db.Q(`SELECT o.order_id, o.order_date, o.total, o.url, o.retailer,
            (SELECT COUNT(*) FROM order_items i WHERE i.order_id=o.order_id) AS items,
            (SELECT title FROM order_items i WHERE i.order_id=o.order_id ORDER BY line_no LIMIT 1) AS first_item
            FROM orders o WHERE o.retailer=? AND o.order_date BETWEEN ? AND ? ORDER BY ABS(o.total - ?) LIMIT 8`,
      [retailer, addDays(d, -35), addDays(d, 3), -t.amount]);
      for (const c of t.order_candidates) c.label = H.order_label(c);
    }
    t.similar = db.Q(`SELECT t.txn_id, t.posted_date, t.amount, t.category, t.subcategory FROM transactions t JOIN accounts a USING(account_id)
        WHERE merchant_of(t.description)=? AND t.txn_id != ? ORDER BY t.posted_date DESC LIMIT 6`, [t.merchant_name, tid]);
    return t;
  }

  // ---- writes ----
  async function post_txn(b) {
    const db = DB();
    const tid = H.v_str(b.txn_id, 'txn_id', true);
    const cur = db.row('SELECT * FROM transactions WHERE txn_id=?', [tid]);
    if (!cur) throw new H.ApiError(404, 'No such transaction');
    const fields = {};
    for (const k of ['category', 'subcategory', 'entity', 'notes', 'person']) {
      if (has(b, k)) fields[k] = H.v_str(b[k], k, false, k === 'notes' ? 2000 : 120);
    }
    if (has(b, 'tags')) {
      const tags = String(pyTrue(b.tags) ? b.tags : '').split(',').map((x) => x.trim()).filter((x) => x);
      fields.tags = [...new Set(tags)].sort().join(',');
    }
    if (has(b, 'is_transfer')) fields.is_transfer = pyTrue(b.is_transfer) ? 1 : 0;
    else if (has(fields, 'category')) fields.is_transfer = ['Transfer', 'Investments'].includes(fields.category) ? 1 : 0;
    fields.tags = H.add_tag(has(fields, 'tags') ? fields.tags : cur.tags, 'manual');
    fields.updated_by = DB().user;
    fields.updated_at = H.now_s();
    await db.update('transactions', { txn_id: tid }, fields);
    return { ok: true };
  }

  async function post_txn_bulk(b) {
    const db = DB();
    const ids = pyTrue(b.ids) ? b.ids : [];
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000) throw new H.ApiError(400, 'ids must be a list of 1-1000 transaction ids');
    const fields = {};
    for (const k of ['category', 'subcategory', 'entity', 'person']) {
      if (has(b, k)) fields[k] = H.v_str(b[k], k, false, 120);
    }
    if (!Object.keys(fields).length) throw new H.ApiError(400, 'Nothing to change');
    if (has(fields, 'category')) fields.is_transfer = ['Transfer', 'Investments'].includes(fields.category) ? 1 : 0;
    let n = 0;
    for (const raw of ids) {
      const tid = String(raw);
      const cur = db.row('SELECT tags FROM transactions WHERE txn_id=?', [tid]);
      if (!cur) continue;
      const f = Object.assign({}, fields, { tags: H.add_tag(cur.tags, 'manual'), updated_by: DB().user, updated_at: H.now_s() });
      await db.update('transactions', { txn_id: tid }, f);
      n += 1;
    }
    return { ok: true, updated: n };
  }

  async function post_manual_txn(b) {
    const db = DB();
    const aid = H.v_str(b.account_id, 'account_id', true);
    if (!db.row('SELECT 1 AS x FROM accounts WHERE account_id=?', [aid])) throw new H.ApiError(400, 'Unknown account');
    const date = H.v_date(b.date, 'date', true);
    const amt = H.v_num(b.amount, 'amount', true, -1e9, 1e9);
    const desc = H.v_str(b.description, 'description', true, 300);
    const cat = H.v_str(b.category, 'category', false, 120);
    const vals = {
      account_id: aid, posted_date: date, amount: amt, description: desc, category: cat,
      subcategory: H.v_str(b.subcategory, 'subcategory', false, 120),
      entity: H.v_str(b.entity, 'entity', false, 120) || 'household',
      notes: H.v_str(b.notes, 'notes', false, 2000),
      is_transfer: ['Transfer', 'Investments'].includes(cat) ? 1 : 0,
      updated_by: DB().user, updated_at: H.now_s(),
    };
    let tid = b.txn_id;
    if (pyTrue(tid)) {
      const r = db.row('SELECT source FROM transactions WHERE txn_id=?', [tid]);
      if (!r || r.source !== 'manual') throw new H.ApiError(400, 'Only manual transactions can be edited here');
      await db.update('transactions', { txn_id: tid }, vals);
    } else {
      tid = 'manual:' + hexToken(8);
      await db.insert('transactions', Object.assign({}, vals,
        { txn_id: tid, transacted_date: date, source: 'manual', tags: 'manual', pending: 0 }));
    }
    return { ok: true, txn_id: tid };
  }

  async function del_manual_txn(q, body) {
    const db = DB();
    const tid = H.v_str(H.first(q, 'id'), 'id', true);
    const r = db.row('SELECT source FROM transactions WHERE txn_id=?', [tid]);
    if (!r) throw new H.ApiError(404, 'No such transaction');
    if (r.source !== 'manual') throw new H.ApiError(400, 'Only manual transactions can be deleted; synced ones come back on the next sync');
    await db.remove('transactions', { txn_id: tid });
    await db.remove('notes', { target_type: 'transaction', target_id: tid });
    return { ok: true };
  }

  async function post_account(b) {
    const db = DB();
    const aid = H.v_str(b.account_id, 'account_id', true);
    if (!db.row('SELECT 1 AS x FROM accounts WHERE account_id=?', [aid])) throw new H.ApiError(404, 'No such account');
    const f = {};
    if (has(b, 'display_name')) f.display_name = H.v_str(b.display_name, 'display_name', false, 120);
    if (has(b, 'holder')) f.holder = H.v_str(b.holder, 'holder', false, 500, H.HOLDERS);
    if (has(b, 'type')) f.type = H.v_str(b.type, 'type', false, 500, H.ACCOUNT_TYPES);
    if (has(b, 'entity')) f.entity = H.v_str(b.entity, 'entity', false, 120);
    if (has(b, 'include_in_totals')) f.include_in_totals = b.include_in_totals == null ? null : (pyTrue(b.include_in_totals) ? 1 : 0);
    if (!Object.keys(f).length) throw new H.ApiError(400, 'Nothing to change');
    if (['holder', 'type', 'entity'].some((k) => has(f, k))) f.meta_locked = 1;
    await db.update('accounts', { account_id: aid }, f);
    return { ok: true };
  }

  API.get['/api/home'] = api_home;
  API.get['/api/accounts'] = api_accounts;
  API.get['/api/account'] = api_account;
  API.get['/api/transactions'] = api_transactions;
  API.get['/api/txn'] = api_txn;
  API.post['/api/txn'] = post_txn;
  API.post['/api/txn/bulk'] = post_txn_bulk;
  API.post['/api/txn/manual'] = post_manual_txn;
  API.del['/api/txn/manual'] = del_manual_txn;
  API.post['/api/account'] = post_account;
})();
