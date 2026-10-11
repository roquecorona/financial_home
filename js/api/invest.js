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

  const INVEST_IN = "a.type IN ('ira','hsa','401k','403b','brokerage','529')";
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
    // v3 (documented divergence): kids' 529s are left out of the household figures unless asked for with kids529=1 or
    // named by the type/account filter. They are summarized separately in `kids_529`.
    const isKids = (a) => a.type === '529';
    const askKids = H.first(q, 'kids529') === '1' || types.includes('529') || allacc.some((a) => isKids(a) && ids.includes(a.account_id));
    const sel = allacc.filter((a) => (!types.length || types.includes(a.type)) && (!ids.length || ids.includes(a.account_id))
      && (askKids || !isKids(a)));
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
      // v3: money we deposited ourselves and 529 gifts (app.py had these under unspecified)
      ytd_personal: csum(ytd0, null, ['personal']), t12_personal: csum(t12, null, ['personal']), all_personal: csum(null, null, ['personal']),
      ytd_gift: csum(ytd0, null, ['gift']), t12_gift: csum(t12, null, ['gift']), all_gift: csum(null, null, ['gift']),
    };
    const ours_t12 = (contrib.t12_employee || 0) + (contrib.t12_unspecified || 0) + (contrib.t12_personal || 0) + (contrib.t12_gift || 0);
    let first_flow = null;
    for (const f of allf) if (f[2] === 'contribution' && (first_flow === null || f[0] < first_flow)) first_flow = f[0];
    const cover_days = first_flow ? dnum(t) - dnum(first_flow > t12 ? first_flow : t12) : 0;
    const cover_months = cover_days ? Math.max(1.0, cover_days / 30.4375) : 0;
    contrib.t12_months_covered = round1(Math.min(12.0, cover_months));
    contrib.avg_month_employee = cover_months ? r2(ours_t12 / cover_months) : 0;
    contrib.avg_month_employer = cover_months ? r2((contrib.t12_employer || 0) / cover_months) : 0;
    // v3: one-off lump sums (e.g. $130K of house-sale proceeds) would make the forecast assume that much every month.
    const LUMP = 10000;
    const lumps = allf.filter((f) => f[2] === 'contribution' && f[0] >= t12 && f[1] >= LUMP && f[3] !== 'employer');
    contrib.lumps_t12 = lumps.map((f) => ({ date: f[0], amount: r2(f[1]) }));
    contrib.avg_month_employee_regular = cover_months
      ? r2((ours_t12 - h().pysum(lumps.map((f) => f[1]))) / cover_months) : 0;
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
          flow_rows.push({ date: f[0], account: acctname[aid] ?? null, account_id: aid, amount: r2(f[1]), kind: f[2], source: f[3], ...(f[4] === 'split' ? { split: true } : {}) });
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
    // v3: where each selected account's history starts. An account whose first valuation comes after the first month of
    // the series makes the stacked chart step up; when no tracked account sent that money (a matching transfer out within
    // a month), its earlier history is simply missing (e.g. the AWS 403(b) before it moved to Voya).
    const history = {};
    const m0 = rows.length ? rows[0].month : null;
    const xfers = [];
    const allFlows = H.inv_flows(allacc.map((a) => a.account_id));
    for (const aid of Object.keys(allFlows)) for (const f of allFlows[aid]) if (f[2] === 'transfer' && f[1] < 0) xfers.push([aid, f[0], f[1]]);
    for (const a of sel) {
      const v = (eng.vals || {})[a.account_id] || [];
      if (!v.length) continue;
      const [fd, fv] = v[0];
      const late = m0 !== null && H.month_of(fd) > m0 && Math.abs(fv) >= 1000;
      let from = null;
      if (late) {
        const near = xfers.filter(([aid, d, amt]) => aid !== a.account_id && Math.abs(dnum(d) - dnum(fd)) <= 31
          && Math.abs(-amt - fv) <= 0.1 * Math.abs(fv));
        if (near.length) from = near[0][0];
      }
      history[a.account_id] = {
        first_date: fd, first_value: r2(fv), last_date: v[v.length - 1][0], late_start: late,
        continues_from: from, continues_from_label: from ? (allacc.find((x) => x.account_id === from) || {}).label || null : null,
        missing_before: late && !from,
      };
    }
    // v3: months whose value rests on an estimated balance (balances.source='estimate', e.g. a 403(b) back-cast from
    // contributions): {aid: ['YYYY-MM', ...]}. The chart draws those stretches dashed and says "estimated".
    const estimated = {};
    for (const a of sel) {
      const est = new Set(Q("SELECT as_of FROM balances WHERE account_id=? AND source='estimate'", [a.account_id]).map((x) => x.as_of));
      if (!est.size) continue;
      const real = new Set(Q("SELECT as_of FROM balances WHERE account_id=? AND COALESCE(source,'')!='estimate'", [a.account_id]).map((x) => x.as_of));
      const v = ((eng.vals || {})[a.account_id] || []).map((x) => x[0]);
      const ms = [];
      for (const r of rows) {
        let i = -1;
        for (let k = 0; k < v.length && v[k] <= r.date; k++) i = k;
        if (i >= 0 && est.has(v[i]) && !real.has(v[i])) ms.push(r.month);
      }
      if (ms.length) estimated[a.account_id] = ms;
    }
    let kids_529 = null;
    const kidsAccts = allacc.filter(isKids);
    if (kidsAccts.length) {
      const kf = H.inv_flows(kidsAccts.map((a) => a.account_id));
      const ks = (aid, since) => r2(h().pysum((kf[aid] || []).filter((f) => f[2] === 'contribution' && (since === null || f[0] >= since)).map((f) => f[1])));
      const list = kidsAccts.map((a) => ({
        account_id: a.account_id, label: a.label, balance: a.balance, as_of: a.as_of, included_in_totals: a.included,
        contributed_ytd: ks(a.account_id, ytd0), contributed_t12: ks(a.account_id, t12), contributed_all: ks(a.account_id, null),
      }));
      for (const k of list) k.growth = k.balance === null || k.balance === undefined ? null : r2(k.balance - k.contributed_all);
      kids_529 = {
        included: askKids, total: r2(h().pysum(list.map((k) => k.balance || 0))), accounts: list,
        contributed_ytd: r2(h().pysum(list.map((k) => k.contributed_ytd))), contributed_all: r2(h().pysum(list.map((k) => k.contributed_all))),
      };
    }
    return {
      kids_529, history, estimated,
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
    // itemized property sheets (a property with its own bank account, e.g. a co-owned one): one type per expense kind
    lawn: 'Lawn care', hvac: 'AC / HVAC', appliance: 'Appliances', plumbing: 'Plumbing', electrical: 'Electrical',
    repairs: 'Repairs & maintenance', cleaning: 'Cleaning & turnover', locksmith: 'Locksmith', insurance: 'Insurance',
    property_tax: 'Property tax', utilities: 'Utilities', fees: 'Fees & filings', other_expense: 'Other',
  };
  // ledger rows outside the P&L: security deposits held for tenants, and money paid out to the owners (a payout, or a
  // personal charge made from the property's account that counts against that owner's share)
  const LEDGER_DEPOSIT = new Set(['deposit_in', 'deposit_refund']);
  const LEDGER_OWNER = new Set(['owner_distribution', 'owner_draw']);

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
      if (LEDGER_DEPOSIT.has(typ) || LEDGER_OWNER.has(typ)) { sheet_months.add(r.month); continue; }
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
            AND a.type NOT IN ('ira','hsa','401k','403b','brokerage','529')`, [ent])) {
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

  // ---- v3 property additions (ownership share, a property's own bank account, owner distributions, sales).
  // All additive: on a database without the new columns every property is 100% ours and nothing changes.
  const NOT_PROPERTY_TAG = 'not-property-specific';
  const PROPERTY_COLS = ['ownership_pct', 'sale_date', 'sale_price', 'sale_proceeds', 'value_as_of', 'value_source'];
  // our share of a property (properties.ownership_pct is a percent; NULL / missing = 100%)
  function property_share(p) {
    const v = p ? p.ownership_pct : null;
    return v === null || v === undefined || v === '' ? 1 : Number(v) / 100;
  }
  // our share of value and equity, plus the property's own bank accounts (entity = the property's, kept out of totals)
  function property_extras(p) {
    const H = h();
    const share = property_share(p);
    const ex = { share, our_value: p.est_value ? r2(p.est_value * share) : null,
      our_equity: p.equity !== null && p.equity !== undefined ? r2(p.equity * share) : null };
    ex.bank_accounts = p.entity ? H.linked_accounts('a.entity=? AND COALESCE(a.include_in_totals,1)=0', [p.entity])
      .map((a) => ({ account_id: a.account_id, label: a.label, institution: a.institution, last4: a.last4, balance: a.balance, as_of: a.as_of })) : [];
    ex.bank_balance = ex.bank_accounts.length ? r2(H.pysum(ex.bank_accounts.map((a) => a.balance || 0))) : null;
    return ex;
  }
  // owner distributions: the property's sheet ledger (owner_distribution / owner_draw rows, with the months each payment
  // covers) plus bank payouts (Transfer / Owner distribution) the ledger has not reconciled (property_ledger.txn_id).
  // Per partner per year, the payments, and per partner the months covered, gaps and months not yet paid.
  function ledger_rows(p) {
    const names = [...new Set([p.ledger_name || p.name, p.name])].filter((x) => x);
    return Q(`SELECT * FROM property_ledger WHERE property IN (${names.map(() => '?').join(',')}) ORDER BY month, entry_id`, names);
  }
  function property_distributions(p, led = null) {
    const H = h();
    const ent = p.entity || p.name;
    const hasCov = db().columns('property_ledger').includes('covers');
    led = led || (hasCov ? ledger_rows(p) : []);
    const linked = new Set(led.filter((r) => r.txn_id).map((r) => r.txn_id));
    const pays = [];
    for (const r of led) {
      if (!LEDGER_OWNER.has(r.type)) continue;
      pays.push({ date: r.date || H.month_end(r.month), person: r.person || 'Unassigned', amount: r2(Math.abs(r.amount || 0)),
        kind: r.type === 'owner_draw' ? 'draw' : 'distribution', covers: (r.covers || '').split(',').filter(Boolean),
        source: r.txn_id ? 'both' : 'sheet', txn_id: r.txn_id || null, description: r.description, flagged: r.flagged || null });
    }
    for (const t of Q(`SELECT t.txn_id, t.posted_date, t.amount, t.description, COALESCE(t.person,'Unassigned') AS person FROM transactions t
        WHERE t.entity=? AND t.subcategory='Owner distribution' AND t.posted_date IS NOT NULL ORDER BY t.posted_date`, [ent])) {
      if (linked.has(t.txn_id)) continue;
      pays.push({ date: t.posted_date, person: t.person, amount: r2(-t.amount), kind: 'distribution', covers: [], source: 'bank',
        txn_id: t.txn_id, description: H.merchant_of(t.description), flagged: null });
    }
    pays.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const partners = [...new Set(pays.map((x) => x.person))].sort();
    const years = [...new Set(pays.map((x) => x.date.slice(0, 4)))].sort().reverse();
    const rows = years.map((y) => {
      const by = {};
      for (const x of pays.filter((z) => z.date.startsWith(y))) by[x.person] = r2((by[x.person] || 0) + x.amount);
      return { year: y, by, total: r2(Object.values(by).reduce((a, b) => a + b, 0)) };
    });
    const last = {}, total = {};
    for (const x of pays) {
      if (!last[x.person] || x.date > last[x.person]) last[x.person] = x.date;
      total[x.person] = r2((total[x.person] || 0) + x.amount);
    }
    const out = { partners, years, rows, last, total };
    if (!pays.some((x) => x.covers.length)) return out;
    // coverage: which months each partner has been paid for. A partner with no payment in the 120 days before the latest
    // payout has stopped; the others are owed every month after the last one covered, through this month.
    const latest = pays.reduce((a, x) => (x.date > a ? x.date : a), '');
    // the monthly rate: the latest payment that pays new months (a payment re-covering a paid month is flagged 'again')
    const rated = pays.find((x) => x.kind === 'distribution' && x.covers.length && !/again/.test(x.flagged || ''));
    const rate = rated ? r2(rated.amount / rated.covers.length) : null;
    const now = H.this_month();
    out.coverage = partners.filter((who) => pays.some((x) => x.person === who && x.covers.length)).map((who) => {
      const mine = pays.filter((x) => x.person === who);
      const cov = [...new Set(mine.flatMap((x) => x.covers))].sort();
      const first = cov[0], thru = cov[cov.length - 1];
      const gaps = [];
      for (let m = first; m < thru; m = H.add_months(m, 1)) if (!cov.includes(m)) gaps.push(m);
      const stopped = (Date.parse(latest) - Date.parse(last[who])) / 864e5 > 120;
      const behind = [];
      if (!stopped) for (let m = H.add_months(thru, 1); m <= now; m = H.add_months(m, 1)) behind.push(m);
      return {
        person: who, first, covered_through: thru, months_covered: cov.length, gaps, behind, stopped,
        owed_estimate: rate && (behind.length + gaps.length) ? r2(rate * (behind.length + gaps.length)) : 0,
        unallocated: r2(H.pysum(mine.filter((x) => x.kind === 'distribution' && !x.covers.length).map((x) => x.amount))),
        draws: r2(H.pysum(mine.filter((x) => x.kind === 'draw').map((x) => x.amount))),
        batches: mine.filter((x) => x.covers.length > 1).length, payments: mine.length,
      };
    });
    out.rate = rate;
    out.payments = pays.slice(0, 200);
    return out;
  }

  // month-by-month cash flow of a property with its own account, like its sheet: income, operating expenses, security
  // deposits (in - refunded), owner payouts, net, and the account's ending balance. The balance rolls forward from the
  // sheet's opening balance (sheet_cash_balances of the property's accounts); a month whose sheet balance differs from the
  // rolled one is flagged and the rolled (bank-consistent) figure carries on. Expense totals by category per year too.
  function property_cashflow(p, led) {
    const H = h();
    if (!led.some((r) => LEDGER_OWNER.has(r.type))) return null;
    const ent = p.entity || p.name;
    const pnl = property_pnl(p, null);
    const months = {};
    const M = (m) => months[m] || (months[m] = { month: m, income: 0, expenses: 0, debt: 0, deposits: 0, take_home: 0, sources: new Set(), flags: [] });
    for (const mm of pnl.months) {
      const x = M(mm.month);
      x.income += mm.income; x.expenses += mm.expense; x.debt += mm.debt;
      for (const s of mm.sources) x.sources.add(s);
    }
    const linked = new Set(led.filter((r) => r.txn_id).map((r) => r.txn_id));
    for (const r of led) {
      const typ = (r.type || '').toLowerCase();
      if (LEDGER_DEPOSIT.has(typ)) M(r.month).deposits += typ === 'deposit_in' ? Math.abs(r.amount || 0) : -Math.abs(r.amount || 0);
      else if (LEDGER_OWNER.has(typ)) M(r.month).take_home += Math.abs(r.amount || 0);
      if (r.flagged) M(r.month).flags.push({ type: typ, category: LEDGER_CATS[typ] || (LEDGER_OWNER.has(typ) ? 'Owners' : LEDGER_DEPOSIT.has(typ) ? 'Deposit' : typ),
        date: r.date, amount: r2(Math.abs(r.amount || 0)), description: r.description, person: r.person || null, flag: r.flagged });
      if (LEDGER_DEPOSIT.has(typ) || LEDGER_OWNER.has(typ)) M(r.month).sources.add('sheet');
    }
    for (const t of Q(`SELECT txn_id, posted_date, amount FROM transactions WHERE entity=? AND subcategory='Owner distribution'
        AND posted_date IS NOT NULL`, [ent])) {
      if (linked.has(t.txn_id)) continue;
      const x = M(t.posted_date.slice(0, 7));
      x.take_home += -t.amount; x.sources.add('bank');
    }
    const accts = p.entity ? Q('SELECT account_id FROM accounts WHERE entity=? AND COALESCE(include_in_totals,1)=0', [p.entity]).map((r) => r.account_id) : [];
    const sheet = {};
    if (accts.length) {
      for (const r of Q(`SELECT month, SUM(balance) AS b FROM sheet_cash_balances WHERE account IN (${accts.map(() => '?').join(',')})
          GROUP BY month, source ORDER BY month, source`, accts)) if (!(r.month in sheet)) sheet[r.month] = r.b;
    }
    const keys = Object.keys(months).sort();
    let prev = keys.length && sheet[H.add_months(keys[0], -1)] !== undefined ? sheet[H.add_months(keys[0], -1)] : null;
    const rows = keys.map((k) => {
      const x = months[k];
      for (const f of ['income', 'expenses', 'debt', 'deposits', 'take_home']) x[f] = r2(x[f]);
      x.net = r2(x.income + x.deposits - x.expenses - x.debt - x.take_home);
      x.start = prev === null ? null : r2(prev);
      x.end = prev === null ? (sheet[k] ?? null) : r2(prev + x.net);
      x.sheet_balance = sheet[k] ?? null;
      x.sheet_differs = x.sheet_balance !== null && x.end !== null && Math.abs(x.end - x.sheet_balance) >= 1;
      prev = x.sheet_balance !== null && !x.sheet_differs ? x.sheet_balance : x.end;
      x.sources = [...x.sources].sort();
      return x;
    });
    // the latest month against the account's own latest balance (bank)
    const bal = (p.bank_accounts || []).filter((a) => a.balance !== null && a.balance !== undefined && a.as_of);
    const asOf = bal.reduce((a, x) => (x.as_of > a ? x.as_of : a), '');
    const lastRow = rows[rows.length - 1];
    const bank_check = bal.length && lastRow && asOf.slice(0, 7) === lastRow.month && lastRow.end !== null
      ? { as_of: asOf, balance: r2(H.pysum(bal.map((a) => a.balance))), rolled: lastRow.end } : null;
    if (bank_check) bank_check.differs = Math.abs(bank_check.balance - bank_check.rolled) >= 1;
    // operating expenses by category per year
    const ys = [...new Set(pnl.lines.map((l) => l.month.slice(0, 4)))].sort();
    const cat = new Map();
    // bank subcategories that name the same thing as a sheet category
    const SAME = { 'Lawn & cleaning': 'Lawn care', 'Utilities & services': 'Utilities', 'Insurance & escrow': 'Insurance' };
    for (const l of pnl.lines) {
      if (l.kind !== 'expense') continue;
      const name = SAME[l.category] || l.category;
      const c = cat.get(name) || {};
      c[l.month.slice(0, 4)] = (c[l.month.slice(0, 4)] || 0) + l.amount;
      cat.set(name, c);
    }
    const by_cat = [...cat.entries()].map(([name, by]) => {
      for (const y of Object.keys(by)) by[y] = r2(by[y]);
      return { name, by, total: r2(Object.values(by).reduce((a, b) => a + b, 0)) };
    }).sort((a, b) => b.total - a.total || (a.name < b.name ? -1 : 1));
    const yearTotals = {};
    for (const y of ys) yearTotals[y] = r2(H.pysum(by_cat.map((c) => c.by[y] || 0)));
    return { months: rows, bank_check, expenses_by_year: { years: ys, categories: by_cat, totals: yearTotals },
      sheet_through: Object.keys(sheet).sort().pop() || null };
  }

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
      if (property_share(p) !== 1 || db().columns('properties').includes('ownership_pct')) Object.assign(p, property_extras(p));
      out.push(p);
    }
    // the rental-business band covers the rentals that are wholly ours; a co-owned property (ownership_pct < 100) has
    // its own account and partners, so it is reported on its own page
    const biz_props = out.filter((p) => p.kind === 'rental' && property_share(p) === 1);
    const rentals = biz_props.filter((p) => p.status !== 'sold');
    const sumk = (k) => r2(H.pysum(biz_props.map((p) => p.kpis[k])));
    const biz = { income: sumk('income'), expenses: sumk('expenses'), debt_service: sumk('debt_service') };
    biz.noi = r2(biz.income - biz.expenses);
    biz.cash_flow = r2(biz.noi - biz.debt_service);
    const [w, args] = H.txn_where({ start: `${year}-01-01`, end: `${year}-12-31`, entity: 'rental business' });
    const notProp = `(',' || COALESCE(t.tags,'') || ',') LIKE '%,${NOT_PROPERTY_TAG},%'`;
    const unassigned = Q(`SELECT ${H.TXN_COLS} FROM transactions t JOIN accounts a USING(account_id) WHERE ${w.join(' AND ')} AND t.is_transfer=0
        AND NOT ${notProp} ORDER BY t.posted_date DESC LIMIT 60`, args);
    const not_property = one(`SELECT COUNT(*) FROM transactions t JOIN accounts a USING(account_id) WHERE ${w.join(' AND ')} AND t.is_transfer=0
        AND ${notProp}`, args);
    const ys = new Set([todayS().slice(0, 4)]);
    for (const r of Q('SELECT DISTINCT substr(month,1,4) AS y FROM property_ledger')) ys.add(r.y);
    for (const r of Q('SELECT DISTINCT substr(posted_date,1,4) AS y FROM transactions WHERE posted_date IS NOT NULL')) ys.add(r.y);
    const years = [...ys].sort().reverse();
    return {
      properties: out, business: biz, year, years, rentals: rentals.length, unassigned,
      accounts: Q(LOAN_ACCTS_SQL),
      ...(not_property ? { not_property } : {}),
      ...(out.some((p) => property_share(p) !== 1) ? { co_owned: out.filter((p) => property_share(p) !== 1).map((p) => p.name) } : {}),
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
    const out = { property: p, pnl, year, loans: loan_hist, notes, accounts: Q(LOAN_ACCTS_SQL) };
    Object.assign(p, property_extras(p));
    if (p.bank_accounts.length) {
      const ids = p.bank_accounts.map((a) => a.account_id);
      const yw = year ? ' AND t.posted_date>=? AND t.posted_date<=?' : '';
      out.bank_txns = Q(`SELECT ${H.TXN_COLS} FROM transactions t JOIN accounts a USING(account_id)
          WHERE t.account_id IN (${ids.map(() => '?').join(',')})${yw} ORDER BY t.posted_date DESC, t.txn_id LIMIT 300`,
      [...ids, ...(year ? [`${year}-01-01`, `${year}-12-31`] : [])]);
    }
    const led = db().columns('property_ledger').includes('covers') ? ledger_rows(p) : [];
    const dist = property_distributions(p, led);
    if (dist.rows.length) out.distributions = dist;
    const cf = led.length ? property_cashflow(p, led) : null;
    if (cf) {
      if (year) cf.months = cf.months.filter((m) => m.month.startsWith(year));
      out.cashflow = cf;
    }
    return out;
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
    // v3 columns (ownership share, sale, value source): written only when sent and present in this database
    const cols = db().columns('properties');
    const has = (k) => Object.prototype.hasOwnProperty.call(b, k) && cols.includes(k);
    if (has('ownership_pct')) {
      const v = H.v_num(b.ownership_pct, 'ownership_pct', false, 0.01, 100);
      vals.ownership_pct = v === null || v === 100 ? null : v;
    }
    if (has('sale_date')) vals.sale_date = H.v_date(b.sale_date, 'sale_date');
    if (has('sale_price')) vals.sale_price = H.v_num(b.sale_price, 'sale_price', false, 0);
    if (has('sale_proceeds')) vals.sale_proceeds = H.v_num(b.sale_proceeds, 'sale_proceeds', false, -1e9, 1e9);
    if (has('value_source')) vals.value_source = H.v_str(b.value_source, 'value_source', false, 300);
    if (has('value_as_of')) vals.value_as_of = H.v_date(b.value_as_of, 'value_as_of');
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
  Object.assign(G.H, { latest_holdings, asset_class_of, property_pnl, mortgage_balance, property_share, property_extras, property_distributions, property_cashflow });
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
