/* Investments + properties API: ported 1:1 from app_v2/app.py (latest_holdings .. del_property_entry).
   Classic script (no bundler); registers helpers on H and handlers on API.get/post/del. Loads in Node for tests. */
(function () {
  'use strict';
  const G = globalThis;
  G.H = G.H || {};
  G.API = G.API || {};
  G.API.get = G.API.get || {};
  G.API.post = G.API.post || {};
  G.API.del = G.API.del || {};
  // Late-bound accessors: H/DB may be (re)populated after this file loads.
  const h = () => G.H;
  const db = () => G.DB;

  const INVEST_IN = "a.type IN ('ira','hsa','401k','403b','brokerage')";
  const ASSET_CLASSES = ['US stock', 'Intl stock', 'Bonds', 'Cash', 'Real estate', 'Other'];

  // ---------------------------------------------------------------- small local utilities (date math, rounding)
  function r2(x) { return h().r2(x); }
  function Q(sql, args) { return db().Q(sql, args || []); }
  function one(sql, args) { return db().one(sql, args || []); }
  function row(sql, args) { return db().row(sql, args || []); }
  function todayS() { return db().today(); }
  function dnum(iso) { // days since epoch for 'YYYY-MM-DD'
    const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  }
  function addDays(iso, n) { return new Date((dnum(iso) + n) * 86400000).toISOString().slice(0, 10); }
  function round1(x) { // Python round(x, 1): nearest on the exact binary value, ties to even
    if (typeof h().pyround === 'function') return h().pyround(x, 1);
    const y = x * 10;
    if (Number.isInteger(y * 2) && !Number.isInteger(y)) { const f = Math.floor(y); return (f % 2 === 0 ? f : f + 1) / 10; }
    return Number(x.toFixed(1));
  }
  function err(code, msg) { return new (h().ApiError)(code, msg); }
  function nowS() {
    if (typeof h().now_s === 'function') return h().now_s();
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  async function insertId(table, rowObj) {
    const rs = await db().insert(table, rowObj);
    const r = Array.isArray(rs) ? rs[0] : rs;
    return r ? r.id : null;
  }

  // ---------------------------------------------------------------- investments
  function asset_class_of(amap, symbol, desc) {
    const sym = (symbol || '').toUpperCase(), d = (desc || '').toLowerCase();
    for (const r of amap) {
      const p = (r.pattern || '').trim();
      if (!p) continue;
      if (r.match === 'symbol' && p.toUpperCase() === sym) return r.asset_class;
      if (r.match === 'description' && d.includes(p.toLowerCase())) return r.asset_class;
    }
    return 'Other';
  }

  function latest_holdings(ids) {
    const out = [];
    const amap = Q('SELECT * FROM asset_class_map ORDER BY priority, id');
    for (const aid of ids) {
      const mx = one('SELECT MAX(as_of) FROM holdings WHERE account_id=?', [aid]);
      if (!mx) continue;
      for (const hh of Q('SELECT * FROM holdings WHERE account_id=? AND as_of=? ORDER BY market_value DESC', [aid, mx])) {
        hh.asset_class = asset_class_of(amap, hh.symbol, hh.description);
        hh.ticker = /^[A-Z]{1,6}$/.test(hh.symbol || '') ? hh.symbol : null;
        hh.cost_basis = hh.cost_basis ? hh.cost_basis : null;
        hh.unrealized = hh.cost_basis ? r2(hh.market_value - hh.cost_basis) : null;
        out.push(hh);
      }
    }
    return out;
  }

  function api_investments(q) {
    const H = h();
    const allacc = H.linked_accounts(INVEST_IN);
    const types = (H.first(q, 'types') || '').split(',').filter((x) => x);
    const ids = (H.first(q, 'accounts') || '').split(',').filter((x) => x);
    const sel = allacc.filter((a) => (!types.length || types.includes(a.type)) && (!ids.length || ids.includes(a.account_id)));
    const s = H.v_date(H.first(q, 'start'), 'start') || '1900-01-01';
    const e = H.v_date(H.first(q, 'end'), 'end') || todayS();
    const eng = H.inv_engine(sel, s, e);
    const rows = eng.months;
    const s_eff = (rows.length && s < rows[0].date) ? H.month_bounds(rows[0].month)[0] : s;
    const stats = rows.length ? H.period_stats(rows, s_eff, e) : null;
    const flows = eng.flows || {};
    const t = todayS();
    const ytd0 = `${t.slice(0, 4)}-01-01`;
    const t12 = addDays(t, -365);
    const allf = [];
    for (const k of Object.keys(flows)) for (const f of flows[k]) allf.push(f);

    const csum = (since = null, until = null, src = null, kind = 'contribution') => {
      const vs = [];
      for (const f of allf) {
        if (f[2] === kind && (since === null || f[0] >= since) && (until === null || f[0] <= until) &&
            (src === null || src.includes(f[3]))) vs.push(f[1]);
      }
      return r2(h().pysum(vs));
    };
    const contrib = {
      ytd: csum(ytd0), t12: csum(t12), all: csum(), period: csum(s_eff, e),
      ytd_employee: csum(ytd0, null, ['employee']), ytd_employer: csum(ytd0, null, ['employer']),
      ytd_unspecified: csum(ytd0, null, ['unspecified', 'snapshot']),
      t12_employee: csum(t12, null, ['employee']), t12_employer: csum(t12, null, ['employer']),
      t12_unspecified: csum(t12, null, ['unspecified', 'snapshot']),
      all_employee: csum(null, null, ['employee']), all_employer: csum(null, null, ['employer']),
      all_unspecified: csum(null, null, ['unspecified', 'snapshot']),
    };
    let first_flow = null;
    for (const f of allf) if (f[2] === 'contribution' && (first_flow === null || f[0] < first_flow)) first_flow = f[0];
    const cover_days = first_flow ? dnum(t) - dnum(first_flow > t12 ? first_flow : t12) : 0;
    const cover_months = cover_days ? Math.max(1.0, cover_days / 30.4375) : 0;
    contrib.t12_months_covered = round1(Math.min(12.0, cover_months));
    contrib.avg_month_employee = cover_months ? r2(((contrib.t12_employee || 0) + (contrib.t12_unspecified || 0)) / cover_months) : 0;
    contrib.avg_month_employer = cover_months ? r2((contrib.t12_employer || 0) / cover_months) : 0;
    const divs = { ytd: csum(ytd0, null, null, 'dividend'), period: csum(s_eff, e, null, 'dividend'), all: csum(null, null, null, 'dividend') };
    const fees = {
      ytd: r2(-(csum(ytd0, null, null, 'fee') || 0)), period: r2(-(csum(s_eff, e, null, 'fee') || 0)),
      all: r2(-(csum(null, null, null, 'fee') || 0)),
    };
    const holdings = latest_holdings(sel.map((a) => a.account_id));
    const covered = {};
    for (const hh of holdings) covered[hh.account_id] = (covered[hh.account_id] || 0) + (hh.market_value || 0);
    for (const a of sel) {
      const bal = a.balance || 0;
      const gap = bal - (covered[a.account_id] || 0);
      if (Math.abs(gap) > Math.max(1.0, 0.01 * Math.abs(bal))) {
        holdings.push({
          account_id: a.account_id, symbol: null, ticker: null, description: `${a.label} (no holdings detail)`,
          market_value: r2(gap), asset_class: 'Other', cost_basis: null, unrealized: null, quantity: null, price: null, as_of: a.as_of,
        });
      }
    }
    const acctname = {};
    for (const a of allacc) acctname[a.account_id] = a.label;
    for (const hh of holdings) hh.account = acctname[hh.account_id] ?? null;
    const by_class = {};
    for (const hh of holdings) by_class[hh.asset_class] = (by_class[hh.asset_class] || 0) + (hh.market_value || 0);
    const total_value = h().pysum(sel.map((a) => a.balance || 0));
    const flow_rows = [];
    for (const aid of Object.keys(flows)) {
      for (const f of flows[aid]) {
        if (s_eff <= f[0] && f[0] <= e) {
          flow_rows.push({ date: f[0], account: acctname[aid] ?? null, account_id: aid, amount: r2(f[1]), kind: f[2], source: f[3] });
        }
      }
    }
    flow_rows.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0)); // stable, like sorted(reverse=True)
    const snaps = Q(`SELECT s.*, COALESCE(a.display_name,a.name) AS account FROM manual_snapshots s JOIN accounts a USING(account_id)
        ORDER BY s.as_of DESC`);
    const series = rows.map((r) => ({
      month: r.month, date: r.date, total: r.total, by_account: r.by_account, net_flow: r.net_flow,
      contributions: r.contributions, gain: r.gain, ret: r.ret, has_valuation: r.has_valuation, start: r.start,
    }));
    const by_class_sorted = {};
    Object.keys(by_class).map((k, i) => [k, by_class[k], i])
      .sort((x, y) => (y[1] - x[1]) || (x[2] - y[2]))
      .forEach(([k, v]) => { by_class_sorted[k] = r2(v); });
    return {
      accounts: allacc, selected: sel.map((a) => a.account_id), start: s_eff, end: e, total_value: r2(total_value),
      stats, contributions: contrib, dividends: divs, fees, series,
      allocation: { by_class: by_class_sorted }, holdings,
      flows: flow_rows.slice(0, 400), snapshots: snaps, asset_map: Q('SELECT * FROM asset_class_map ORDER BY priority, id'),
      scenarios: Q('SELECT * FROM forecast_scenarios ORDER BY created_at DESC'),
    };
  }

  // ---------------------------------------------------------------- properties
  const LEDGER_CATS = {
    rent: 'Rent', rent_section8: 'Rent (Section 8)', rent_tenant: 'Rent (tenant)', other_income: 'Other income',
    mortgage: 'Mortgage', hoa: 'HOA',
  };

  function property_pnl(p, year = null) {
    const H = h();
    const ent = p.entity || p.name;
    const ledger_name = p.ledger_name || p.name;
    const names = [...new Set([ledger_name, p.name])].filter((x) => x);
    const lines = [];
    const ph = names.map(() => '?').join(',');
    const sheet_months = new Set();
    for (const r of Q(`SELECT * FROM property_ledger WHERE property IN (${ph})`, names)) {
      const typ = (r.type || '').toLowerCase();
      const kind = (typ.startsWith('rent') || typ === 'other_income') ? 'income' : typ === 'mortgage' ? 'debt' : 'expense';
      const cat = Object.prototype.hasOwnProperty.call(LEDGER_CATS, typ) ? LEDGER_CATS[typ] : 'Repairs & other';
      const date = (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) ? r.date : H.month_end(r.month);
      sheet_months.add(r.month);
      lines.push({
        month: r.month, date, kind, category: cat, amount: r2(Math.abs(r.amount || 0)),
        description: r.description || cat, source: 'sheet', ref: r.entry_id, flagged: r.flagged,
      });
    }
    for (const r of Q(`SELECT t.txn_id, t.posted_date, t.amount, t.description, t.category, t.subcategory FROM transactions t
            JOIN accounts a USING(account_id) WHERE t.entity=? AND t.is_transfer=0 AND t.pending=0 AND t.posted_date IS NOT NULL
            AND a.type NOT IN ('ira','hsa','401k','403b','brokerage')`, [ent])) {
      const m = r.posted_date.slice(0, 7);
      if (sheet_months.has(m)) continue;
      const sub = r.subcategory || r.category || 'Other';
      const kind = r.amount > 0 ? 'income' : /mortgage|pool loan|heloc/i.test(sub) ? 'debt' : 'expense';
      lines.push({
        month: m, date: r.posted_date, kind, category: sub, amount: r2(Math.abs(r.amount)),
        description: H.merchant_of(r.description), source: 'bank', ref: r.txn_id,
      });
    }
    for (const r of Q('SELECT * FROM property_entries WHERE property_id=?', [p.id])) {
      const kind = ['income', 'expense', 'debt'].includes(r.type) ? r.type : 'expense';
      lines.push({
        month: (r.date || todayS()).slice(0, 7), date: r.date, kind, category: r.category || 'Other',
        amount: r2(Math.abs(r.amount || 0)), description: r.description || r.category, source: 'manual', ref: r.id,
        created_by: r.created_by, notes: r.notes, receipt_url: r.receipt_url,
      });
    }
    lines.sort((x, y) => { const a = x.date || '', b = y.date || ''; return a < b ? 1 : a > b ? -1 : 0; });
    const years = [...new Set(lines.map((ln) => ln.month.slice(0, 4)))].sort().reverse();
    const sel = lines.filter((ln) => !year || ln.month.startsWith(year));
    const months = {};
    for (const ln of sel) {
      let mm = months[ln.month];
      if (!mm) mm = months[ln.month] = { month: ln.month, income: 0.0, expense: 0.0, debt: 0.0, sources: new Set() };
      mm[ln.kind] += ln.amount;
      mm.sources.add(ln.source);
    }
    const mrows = [];
    for (const k of Object.keys(months).sort()) {
      const mm = months[k];
      mm.noi = r2(mm.income - mm.expense);
      mm.cash_flow = r2(mm.income - mm.expense - mm.debt);
      mm.sources = [...mm.sources].sort();
      for (const f of ['income', 'expense', 'debt']) mm[f] = r2(mm[f]);
      mrows.push(mm);
    }
    const cats = new Map();
    for (const ln of sel) if (ln.kind === 'expense') cats.set(ln.category, (cats.get(ln.category) || 0) + ln.amount);
    const ksum = (kind) => H.pysum(sel.filter((ln) => ln.kind === kind).map((ln) => ln.amount));
    const inc = ksum('income'), exp = ksum('expense'), debt = ksum('debt');
    const nmonths = mrows.length || 1;
    const noi = inc - exp;
    const cf = noi - debt;
    const kp = { income: r2(inc), expenses: r2(exp), debt_service: r2(debt), noi: r2(noi), cash_flow: r2(cf), months: mrows.length };
    const ann_noi = noi / nmonths * 12;
    kp.cap_rate = p.est_value ? ann_noi / p.est_value : null;
    kp.cash_on_cash = p.cash_invested ? (cf / nmonths * 12) / p.cash_invested : null;
    const categories = [...cats.entries()].map(([k, v], i) => [k, v, i])
      .sort((x, y) => (y[1] - x[1]) || (x[2] - y[2]))
      .map(([k, v]) => ({ name: k, total: r2(v) }));
    return { lines: sel, months: mrows, categories, kpis: kp, years };
  }

  function mortgage_balance(p) {
    if (p.mortgage_account_id) {
      const b = row('SELECT balance, as_of FROM balances WHERE account_id=? ORDER BY as_of DESC LIMIT 1', [p.mortgage_account_id]);
      if (b) return [Math.abs(b.balance || 0), b.as_of];
    }
    const ent = p.entity;
    if (ent) {
      const m = row("SELECT * FROM manual_accounts WHERE kind='debt' AND type='mortgage' AND entity=? AND status='open' LIMIT 1", [ent]);
      if (m) {
        const [v, d] = h().manual_value(m, todayS());
        if (v !== null && v !== undefined) return [Math.abs(v), d];
      }
    }
    return [null, null];
  }

  const LOAN_ACCTS_SQL = "SELECT account_id, COALESCE(display_name,name) AS name FROM accounts WHERE type IN ('mortgage','loan','heloc')";

  function api_properties(q) {
    const H = h();
    const year = H.first(q, 'year') || todayS().slice(0, 4);
    const out = [];
    for (const p of Q("SELECT * FROM properties ORDER BY CASE status WHEN 'sold' THEN 2 WHEN 'primary residence' THEN 0 ELSE 1 END, name")) {
      const pnl = property_pnl(p, year);
      p.kpis = pnl.kpis;
      p.spark = pnl.months.map((m) => ({ month: m.month, cash_flow: m.cash_flow }));
      [p.mortgage_balance, p.mortgage_as_of] = mortgage_balance(p);
      p.equity = p.est_value ? r2(p.est_value - (p.mortgage_balance || 0)) : null;
      p.note_count = one("SELECT COUNT(*) FROM notes WHERE target_type='property' AND target_id=?", [String(p.id)]);
      out.push(p);
    }
    const rentals = out.filter((p) => p.kind === 'rental' && p.status !== 'sold');
    const sumk = (k) => r2(H.pysum(out.filter((p) => p.kind === 'rental').map((p) => p.kpis[k])));
    const biz = { income: sumk('income'), expenses: sumk('expenses'), debt_service: sumk('debt_service') };
    biz.noi = r2(biz.income - biz.expenses);
    biz.cash_flow = r2(biz.noi - biz.debt_service);
    const [w, args] = H.txn_where({ start: `${year}-01-01`, end: `${year}-12-31`, entity: 'rental business' });
    const unassigned = Q(`SELECT ${H.TXN_COLS} FROM transactions t JOIN accounts a USING(account_id) WHERE ${w.join(' AND ')} AND t.is_transfer=0
        ORDER BY t.posted_date DESC LIMIT 60`, args);
    const ys = new Set([todayS().slice(0, 4)]);
    for (const r of Q('SELECT DISTINCT substr(month,1,4) AS y FROM property_ledger')) ys.add(r.y);
    for (const r of Q('SELECT DISTINCT substr(posted_date,1,4) AS y FROM transactions WHERE posted_date IS NOT NULL')) ys.add(r.y);
    const years = [...ys].sort().reverse();
    return {
      properties: out, business: biz, year, years, rentals: rentals.length, unassigned,
      accounts: Q(LOAN_ACCTS_SQL),
    };
  }

  function api_property(q) {
    const H = h();
    const pid = H.v_int(H.first(q, 'id'), 'id', true);
    const p = row('SELECT * FROM properties WHERE id=?', [pid]);
    if (!p) throw err(404, 'No such property');
    const year = H.first(q, 'year') || '';
    const pnl = property_pnl(p, year || null);
    [p.mortgage_balance, p.mortgage_as_of] = mortgage_balance(p);
    p.equity = p.est_value ? r2(p.est_value - (p.mortgage_balance || 0)) : null;
    const loan_hist = [];
    if (p.entity) {
      for (const m of Q("SELECT * FROM manual_accounts WHERE kind='debt' AND entity=?", [p.entity])) {
        loan_hist.push({ name: m.name, points: H.manual_points(m).map((pt) => ({ date: pt[0], balance: pt[1] })) });
      }
    }
    if (p.mortgage_account_id) {
      const lb = Q('SELECT month, balance FROM loan_balances WHERE loan LIKE ? ORDER BY month', ['%' + (p.entity || p.name) + '%']);
      if (lb.length) loan_hist.push({ name: 'Mortgage (sheet)', points: lb.map((r) => ({ date: H.month_end(r.month), balance: r.balance })) });
    }
    const notes = Q("SELECT * FROM notes WHERE target_type='property' AND target_id=? ORDER BY pinned DESC, created_at DESC", [String(pid)]);
    return { property: p, pnl, year, loans: loan_hist, notes, accounts: Q(LOAN_ACCTS_SQL) };
  }

  // ---------------------------------------------------------------- writes
  async function post_snapshot(b) {
    const H = h();
    const aid = H.v_str(b.account_id, 'account_id', true);
    const a = row('SELECT type FROM accounts WHERE account_id=?', [aid]);
    if (!a) throw err(400, 'Unknown account');
    const vals = {
      account_id: aid, as_of: H.v_date(b.as_of, 'as_of', true),
      balance: H.v_num(b.balance, 'balance', true, -1e10, 1e10),
      contributions_ytd: H.v_num(b.contributions_ytd, 'contributions_ytd', false, -1e9, 1e9),
      note: H.v_str(b.note, 'note', false, 500),
    };
    let sid = H.v_int(b.id, 'id');
    if (sid) await db().update('manual_snapshots', { id: sid }, vals);
    else sid = await insertId('manual_snapshots', Object.assign(vals, { created_by: db().user }));
    return { ok: true, id: sid };
  }

  async function del_snapshot(q) {
    const H = h();
    await db().remove('manual_snapshots', { id: H.v_int(H.first(q, 'id'), 'id', true) });
    return { ok: true };
  }

  async function post_asset_class(b) {
    const H = h();
    const vals = {
      pattern: H.v_str(b.pattern, 'pattern', true, 120),
      match: H.v_str(b.match, 'match', false, 500, ['symbol', 'description']) || 'symbol',
      asset_class: H.v_str(b.asset_class, 'asset_class', true, 500, ASSET_CLASSES),
      priority: H.v_int(b.priority, 'priority') || 20,
    };
    let rid = H.v_int(b.id, 'id');
    if (rid) await db().update('asset_class_map', { id: rid }, vals);
    else rid = await insertId('asset_class_map', Object.assign(vals, { created_by: db().user }));
    return { ok: true, id: rid };
  }

  async function del_asset_class(q) {
    const H = h();
    await db().remove('asset_class_map', { id: H.v_int(H.first(q, 'id'), 'id', true) });
    return { ok: true };
  }

  async function post_scenario(b) {
    const H = h();
    const name = H.v_str(b.name, 'name', true, 80);
    const params = b.params;
    if (params === null || typeof params !== 'object' || Array.isArray(params)) throw err(400, 'params must be an object');
    const clean = {};
    for (const k of Object.keys(params)) {
      const v = params[k];
      if (!/^[a-zA-Z_]{1,40}$/.test(String(k))) continue;
      if (typeof v === 'number' && Number.isFinite(v)) clean[k] = v;
      else if (typeof v === 'boolean') clean[k] = v;
      else if (typeof v === 'string' && [...v].length <= 80) clean[k] = v;
    }
    const pj = H.pyjson(clean);
    let sid = H.v_int(b.id, 'id');
    if (sid) await db().update('forecast_scenarios', { id: sid }, { name, params_json: pj });
    else sid = await insertId('forecast_scenarios', { name, params_json: pj, created_by: db().user, created_at: nowS() });
    return { ok: true, id: sid };
  }

  async function del_scenario(q) {
    const H = h();
    await db().remove('forecast_scenarios', { id: H.v_int(H.first(q, 'id'), 'id', true) });
    return { ok: true };
  }

  async function post_property(b) {
    const H = h();
    const name = H.v_str(b.name, 'name', true, 120);
    const status = H.v_str(b.status, 'status', false, 500, ['rented', 'vacant', 'primary residence', 'sold', 'other']) || 'rented';
    const vals = {
      name, address: H.v_str(b.address, 'address', false, 200), purchase_date: H.v_date(b.purchase_date, 'purchase_date'),
      purchase_price: H.v_num(b.purchase_price, 'purchase_price', false, 0), est_value: H.v_num(b.est_value, 'est_value', false, 0),
      mortgage_account_id: H.v_str(b.mortgage_account_id, 'mortgage_account_id', false, 80),
      rate: H.v_num(b.rate, 'rate', false, 0, 100), rent: H.v_num(b.rent, 'rent', false, 0), tenant: H.v_str(b.tenant, 'tenant', false, 120),
      lease_end: H.v_date(b.lease_end, 'lease_end'), status, notes: H.v_str(b.notes, 'notes', false, 2000),
      entity: H.v_str(b.entity, 'entity', false, 120) || name, cash_invested: H.v_num(b.cash_invested, 'cash_invested', false, 0),
      kind: status === 'primary residence' ? 'primary' : 'rental',
    };
    let pid = H.v_int(b.id, 'id');
    if (pid) await db().update('properties', { id: pid }, vals);
    else {
      vals.ledger_name = name;
      pid = await insertId('properties', vals);
    }
    return { ok: true, id: pid };
  }

  async function post_property_entry(b) {
    const H = h();
    const pid = H.v_int(b.property_id, 'property_id', true);
    if (!row('SELECT 1 AS x FROM properties WHERE id=?', [pid])) throw err(400, 'Unknown property');
    const url = H.v_str(b.receipt_url, 'receipt_url', false, 500);
    if (url && !/^(https?:\/\/|file:|[A-Za-z]:\\|\\\\)/.test(url)) throw err(400, 'receipt_url must be a web link or a file path');
    const vals = {
      property_id: pid, date: H.v_date(b.date, 'date', true),
      type: H.v_str(b.type, 'type', true, 500, ['income', 'expense', 'debt']),
      category: H.v_str(b.category, 'category', false, 120), amount: H.v_num(b.amount, 'amount', true, 0, 1e8),
      description: H.v_str(b.description, 'description', false, 300), notes: H.v_str(b.notes, 'notes', false, 2000), receipt_url: url,
    };
    let eid = H.v_int(b.id, 'id');
    if (eid) await db().update('property_entries', { id: eid }, vals);
    else eid = await insertId('property_entries', Object.assign(vals, { created_by: db().user, created_at: nowS() }));
    return { ok: true, id: eid };
  }

  async function del_property_entry(q) {
    const H = h();
    await db().remove('property_entries', { id: H.v_int(H.first(q, 'id'), 'id', true) });
    return { ok: true };
  }

  // ---------------------------------------------------------------- registration
  Object.assign(G.H, { latest_holdings, asset_class_of, property_pnl, mortgage_balance });
  Object.assign(G.API.get, {
    '/api/investments': api_investments, '/api/properties': api_properties, '/api/property': api_property,
  });
  Object.assign(G.API.post, {
    '/api/snapshot': post_snapshot, '/api/asset_class': post_asset_class, '/api/scenario': post_scenario,
    '/api/property': post_property, '/api/property_entry': post_property_entry,
  });
  Object.assign(G.API.del, {
    '/api/snapshot': del_snapshot, '/api/asset_class': del_asset_class, '/api/scenario': del_scenario,
    '/api/property_entry': del_property_entry,
  });
})();
