/* Financial Home v3 — Credit (no app.py counterpart).
   GET /api/credit?person=Roque|Jennifer   (blank = both)
   Reads the laptop-owned credit_* tables (scripts/import_credit_report.py: Credit Karma / bureau reports, factor snapshots)
   plus the app's own cards: live balances and limits (current utilization) and Jenny's monthly sheet (card_statements:
   statement balance and limit per card per month = utilization history). Everything is computed here; nothing is written.
   Response: { person, people, has, as_of, scores, current, factors, summary, utilization, accounts, age, inquiries,
               actions, reports }. See the field comments below. */
'use strict';
(function (g) {
  const H = (g.H = g.H || {});
  const API = (g.API = g.API || {});
  API.get = API.get || {};
  const DB = () => g.DB;

  const PEOPLE = ['Roque', 'Jennifer'];
  const ISSUER_NAMES = {
    amex: 'American Express', citi: 'Citi', bofa: 'Bank of America', chase: 'Chase', barclays: 'Barclays', capitalone: 'Capital One',
    usbank: 'U.S. Bank', synchrony: 'Synchrony', discover: 'Discover', wellsfargo: 'Wells Fargo', td: 'TD Bank', honda: 'Honda Financial',
    nissan: 'Nissan', loancare: 'LoanCare', rocket: 'Rocket Mortgage', sccu: 'Space Coast CU', firstflcu: 'First Florida CU',
    affirm: 'Affirm', penfed: 'PenFed', fnbo: 'FNBO', comenity: 'Comenity', tcf: 'TCF Bank', popular: 'Banco Popular',
    consumerscu: 'Consumers Co-op CU', studentloan: 'Student loan', bankservices: 'Bank Services', macys: "Macy's",
  };
  const KIND_LABEL = { card: 'Credit card', auto: 'Auto loan', mortgage: 'Mortgage', heloc: 'Home equity', student: 'Student loan', loan: 'Loan', other: 'Other' };
  // Credit Karma's factor names, the label we show, and how much each one weighs
  const FACTORS = [
    ['PAYMENT_HISTORY', 'Payment history', 'High'], ['CREDIT_CARD_UTILIZATION', 'Card utilization', 'High'],
    ['DEROGATORY_MARKS', 'Derogatory marks', 'High'], ['CREDIT_HISTORY_AGE', 'Age of credit history', 'Medium'],
    ['TOTAL_ACCOUNTS', 'Total accounts', 'Low'], ['HARD_INQUIRIES', 'Hard inquiries', 'Low'],
  ];

  const hasTable = (t) => !!DB().one("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", [t]);
  const r2 = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);
  const r4 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const toDate = (s) => {
    if (!s) return null;
    const t = String(s);
    const full = t.length >= 10 ? t.slice(0, 10) : t.length === 7 ? t + '-15' : t.length === 4 ? t + '-07-01' : null;
    if (!full) return null;
    const d = new Date(full + 'T12:00:00Z');
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const addMonthsIso = (s, k) => {
    const d = toDate(s); if (!d) return null;
    const day = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + k);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return iso(d);
  };
  const monthsBetween = (a, b) => {
    const x = toDate(a), y = toDate(b);
    if (!x || !y) return null;
    return (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + (y.getUTCMonth() - x.getUTCMonth()) + (y.getUTCDate() - x.getUTCDate()) / 30.44;
  };
  const daysBetween = (a, b) => { const x = toDate(a), y = toDate(b); return x && y ? Math.round((y - x) / 86400000) : null; };
  const short = (p) => (p === 'Jennifer' ? 'Jenny' : p);
  const issuerName = (k, fallback) => ISSUER_NAMES[k] || (fallback ? String(fallback).replace(/\b([A-Z])([A-Z]+)\b/g, (m, a, b) => a + b.toLowerCase()) : 'Unknown');

  /* CK-style grading, used when no Credit Karma rating is on file (marked estimated). */
  const grade = {
    PAYMENT_HISTORY: (v) => (v === null ? null : v >= 1 ? 'EXCELLENT' : v >= 0.99 ? 'GOOD' : v >= 0.98 ? 'FAIR' : 'NEEDS_WORK'),
    CREDIT_CARD_UTILIZATION: (v) => (v === null ? null : v < 0.1 ? 'EXCELLENT' : v < 0.3 ? 'GOOD' : v < 0.5 ? 'FAIR' : 'NEEDS_WORK'),
    DEROGATORY_MARKS: (v) => (v === null ? null : v === 0 ? 'EXCELLENT' : v === 1 ? 'FAIR' : 'NEEDS_WORK'),
    CREDIT_HISTORY_AGE: (v) => (v === null ? null : v >= 9 * 12 ? 'EXCELLENT' : v >= 7 * 12 ? 'GOOD' : v >= 5 * 12 ? 'FAIR' : 'NEEDS_WORK'),
    TOTAL_ACCOUNTS: (v) => (v === null ? null : v >= 21 ? 'EXCELLENT' : v >= 11 ? 'GOOD' : v >= 6 ? 'FAIR' : 'NEEDS_WORK'),
    HARD_INQUIRIES: (v) => (v === null ? null : v === 0 ? 'EXCELLENT' : v <= 2 ? 'GOOD' : v <= 4 ? 'FAIR' : 'NEEDS_WORK'),
  };

  /* One account per group (the same account on several bureaus), newest report wins; bureaus listed. */
  function dedupeTradelines(rows) {
    const groups = new Map();
    for (const t of rows) {
      const k = t.person + '|' + (t.group_key || t.tradeline_id);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    const out = [];
    for (const list of groups.values()) {
      list.sort((a, b) => String(b.as_of || '').localeCompare(String(a.as_of || '')) || ((b.payment_grid ? 1 : 0) - (a.payment_grid ? 1 : 0)));
      const t = { ...list[0] };
      t.bureaus = [...new Set(list.map((x) => x.bureau).filter(Boolean))].sort();
      t.account_id = list.map((x) => x.account_id).find(Boolean) || null;
      for (const f of ['credit_limit', 'high_balance', 'opened', 'closed', 'payment_grid', 'remarks', 'responsibility', 'monthly_payment', 'term_months', 'last_payment']) {
        if (t[f] === null || t[f] === undefined) { const v = list.map((x) => x[f]).find((x) => x !== null && x !== undefined); if (v !== undefined) t[f] = v; }
      }
      // late counts and payment status: the worst any bureau reports
      for (const f of ['late_30', 'late_60', 'late_90']) t[f] = Math.max(0, ...list.map((x) => x[f] || 0));
      const lateRow = list.find((x) => /late|past due|delinquen|charge|collection/i.test(x.payment_status || ''));
      if (lateRow) t.payment_status = lateRow.payment_status;
      t.on_time_pct = list.map((x) => x.on_time_pct).filter((x) => x !== null && x !== undefined).sort((a, b) => a - b)[0] ?? null;
      t.rows = list.length;
      out.push(t);
    }
    return out;
  }

  function gridStats(t) {
    let on = 0, late = 0, unknown = 0;
    const lateMonths = [];
    if (t.payment_grid) {
      try {
        const gobj = JSON.parse(t.payment_grid);
        for (const [y, s] of Object.entries(gobj)) {
          [...s].forEach((c, i) => {
            if (c === 'C') on++;
            else if (c === 'U') unknown++;
            else if (c === 'L' || c === 'D') { late++; lateMonths.push({ month: `${y}-${String(i + 1).padStart(2, '0')}`, status: c === 'L' ? 'late' : 'derogatory' }); }
          });
        }
      } catch (e) { /* ignore a bad grid */ }
    }
    return { on, late, unknown, lateMonths };
  }

  function accountLabels() {
    const m = new Map();
    for (const a of DB().Q('SELECT account_id, display_name, name, last4, holder, type, status FROM accounts')) m.set(a.account_id, a);
    return m;
  }

  /* ---------------------------------------------------------------- utilization */
  const BUSINESS_RE = /\bbusiness\b|\bink\b|\bspark\b|\bbiz\b/i;
  function utilization(people, today, reported) {
    const DBx = DB();
    // current: open cards in the app, owed = −balance, limit from the account details (settings, then the sheet)
    const cards = [];
    const accts = H.linked_accounts ? H.linked_accounts("a.type IN ('credit_card','store_card')") : [];
    for (const a of accts) {
      if (a.status === 'closed' || a.status === 'shares_balance' || a.status === 'hidden') continue;
      const holder = a.holder;
      // a joint card is on both reports; an unconfirmed one only counts in the household view
      if (!(people.includes(holder) || holder === 'Joint' || (holder === 'Unconfirmed' && people.length > 1))) continue;
      let limit = null;
      try { const d = H.account_details ? H.account_details(a) : null; limit = d && d.credit_limit ? d.credit_limit.v : null; } catch (e) { limit = null; }
      const owed = a.balance === null || a.balance === undefined ? null : Math.max(0, -a.balance);
      // business cards (Ink, Spark, "Business") don't report to personal credit files: shown, but left out of the totals
      const business = BUSINESS_RE.test(a.label || '') && !(reported && reported.has(a.account_id));
      cards.push({ account_id: a.account_id, label: a.label, last4: a.last4 || null, holder, balance: r2(owed), limit: limit ? Number(limit) : null,
        pct: limit && owed !== null ? r4(owed / limit) : null, as_of: a.as_of || null, business, on_report: !!(reported && reported.has(a.account_id)) });
    }
    // history from Jenny's sheet: statement balance / limit by month and holder (cards with a limit)
    const hist = [];
    const perCard = new Map();
    if (hasTable('card_statements')) {
      const rows = DBx.Q(`SELECT month, holder, last4, card, credit_limit, statement_due FROM card_statements
        WHERE credit_limit > 0 ORDER BY month`);
      const byMonth = new Map();
      for (const r of rows) {
        if (BUSINESS_RE.test(r.card || '')) continue;
        if (!byMonth.has(r.month)) byMonth.set(r.month, {});
        const m = byMonth.get(r.month);
        const h = r.holder || 'Other';
        m[h] = m[h] || { bal: 0, lim: 0 };
        m[h].bal += Math.max(0, r.statement_due || 0); m[h].lim += r.credit_limit;
        const key = h + '|' + (r.last4 || r.card);
        if (!perCard.has(key)) perCard.set(key, []);
        perCard.get(key).push({ month: r.month, pct: r4(Math.max(0, r.statement_due || 0) / r.credit_limit), balance: r2(r.statement_due), limit: r.credit_limit });
      }
      for (const [month, m] of byMonth) {
        const row = { month };
        let bal = 0, lim = 0;
        for (const p of PEOPLE) {
          if (m[p]) { row[p] = r4(m[p].bal / m[p].lim); if (people.includes(p)) { bal += m[p].bal; lim += m[p].lim; } }
        }
        row.overall = lim ? r4(bal / lim) : null;
        row.balance = r2(bal); row.limit = r2(lim);
        hist.push(row);
      }
    }
    for (const c of cards) {
      const key = c.holder + '|' + c.last4;
      const s = perCard.get(key) || [];
      c.trend = s.slice(-12);
      if (c.limit === null && s.length) { c.limit = s[s.length - 1].limit; c.pct = c.balance !== null ? r4(c.balance / c.limit) : null; c.limit_source = 'sheet'; }
    }
    const withLim = cards.filter((c) => c.limit && c.balance !== null && !c.business);
    const tot = (list) => {
      const bal = list.reduce((s, c) => s + c.balance, 0), lim = list.reduce((s, c) => s + c.limit, 0);
      return { balance: r2(bal), limit: r2(lim), pct: lim ? r4(bal / lim) : null, cards: list.length };
    };
    const byPerson = {};
    for (const p of people) byPerson[p] = tot(withLim.filter((c) => c.holder === p || c.holder === 'Joint'));
    cards.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || (b.balance || 0) - (a.balance || 0));
    return { current: { overall: tot(withLim), by_person: byPerson, as_of: withLim.map((c) => c.as_of).filter(Boolean).sort().pop() || null },
      cards, history: hist.filter((h) => h.overall !== null) };
  }

  /* ---------------------------------------------------------------- main handler */
  API.get['/api/credit'] = (q) => {
    const DBx = DB();
    const today = H.today_s ? H.today_s() : DBx.today();
    const want = (q.person || '').trim();
    const person = want === 'Jenny' ? 'Jennifer' : (PEOPLE.includes(want) ? want : '');
    const people = person ? [person] : PEOPLE.slice();
    const inP = (p) => people.includes(p) || (p === 'Joint');
    const ready = hasTable('credit_tradelines');
    const sel = (sql, args = []) => (ready ? DBx.Q(sql, args) : []);

    const scoresAll = sel('SELECT person, date, bureau, model, score, source FROM credit_scores ORDER BY date, bureau');
    const scores = scoresAll.filter((s) => inP(s.person));
    const tlAll = sel('SELECT * FROM credit_tradelines');
    const tl = tlAll.filter((t) => inP(t.person));
    const inqAll = sel('SELECT * FROM credit_inquiries ORDER BY date DESC');
    const factorsAll = sel('SELECT * FROM credit_factors ORDER BY date');
    const reports = sel('SELECT report_id, person, bureau, report_date, source, file_path, parsed, score, score_model, n_accounts, n_inquiries, imported_at, notes FROM credit_reports ORDER BY report_date DESC, person, bureau')
      .filter((r) => inP(r.person)).map((r) => ({ ...r, file_path: undefined, file: r.file_path ? String(r.file_path).split('/').pop() : null }));
    const labels = accountLabels();
    // the same card on both files (joint or authorized user): the other person's copy gets the app account too
    const linkKey = (t) => [t.issuer, t.opened, t.credit_limit || '', t.kind].join('|');
    const linkedBy = new Map(tlAll.filter((t) => t.account_id && t.source !== 'app').map((t) => [linkKey(t), t.account_id]));
    for (const t of tl) if (!t.account_id && t.source !== 'app' && linkedBy.has(linkKey(t))) t.account_id = linkedBy.get(linkKey(t));

    // ---- current scores: latest per person + bureau + model, with the change since the one before
    const current = [];
    const series = new Map();
    for (const s of scores) {
      const k = [s.person, s.bureau, s.model].join('|');
      if (!series.has(k)) series.set(k, []);
      series.get(k).push(s);
    }
    for (const [k, list] of series) {
      const [p, bureau, model] = k.split('|');
      const last = list[list.length - 1], prev = list.length > 1 ? list[list.length - 2] : null;
      current.push({ person: p, bureau, model, score: last.score, date: last.date, source: last.source,
        prev_score: prev ? prev.score : null, prev_date: prev ? prev.date : null, change: prev ? last.score - prev.score : null });
    }
    current.sort((a, b) => PEOPLE.indexOf(a.person) - PEOPLE.indexOf(b.person) || String(a.bureau).localeCompare(String(b.bureau)));

    // ---- accounts (one per bureau group)
    const bureauTl = tl.filter((t) => t.source !== 'app');
    const accounts = dedupeTradelines(tl).map((t) => {
      const a = t.account_id ? labels.get(t.account_id) : null;
      const st = gridStats(t);
      const closed = t.status === 'closed';
      const end = closed ? (t.closed || t.as_of || null) : today;
      const name = issuerName(t.issuer, t.creditor);
      return {
        key: t.group_key || t.tradeline_id, person: t.person, creditor: t.creditor, issuer: t.issuer, name,
        app_label: a ? (a.display_name || a.name) : null, account_id: t.account_id, kind: t.kind || 'other',
        kind_label: KIND_LABEL[t.kind] || 'Other', account_type: t.account_type, opened: t.opened, closed: closed ? (t.closed || null) : null,
        end, status: closed ? 'closed' : 'open', credit_limit: t.credit_limit > 0 ? t.credit_limit : null, high_balance: t.high_balance,
        balance: t.balance, monthly_payment: t.monthly_payment, past_due: t.past_due, as_of: t.as_of, payment_status: t.payment_status,
        worst_status: t.worst_status, on_time_pct: t.on_time_pct, late: { d30: t.late_30 || 0, d60: t.late_60 || 0, d90: t.late_90 || 0 },
        late_months: st.lateMonths, grid: t.payment_grid ? JSON.parse(t.payment_grid) : null, responsibility: t.responsibility,
        remarks: t.remarks, term_months: t.term_months, last_payment: t.last_payment, bureaus: t.bureaus, source: t.source,
        utilization: t.kind === 'card' && !closed && t.credit_limit > 0 && t.balance !== null ? r4(t.balance / t.credit_limit) : null,
        age_months: t.opened ? r2(monthsBetween(t.opened, today)) : null,
        derogatory: /late|past due|delinquen|charge.?off|collection|repossess|foreclos/i.test(t.payment_status || '') || (t.late_30 || 0) + (t.late_60 || 0) + (t.late_90 || 0) > 0 || st.late > 0,
      };
    }).sort((a, b) => String(a.opened || '9999').localeCompare(String(b.opened || '9999')));

    // ---- per person summary: what the bureaus see (bureau accounts only; app-only rows aren't on a report)
    const summary = {};
    for (const p of people) {
      const acc = accounts.filter((a) => a.person === p && a.source !== 'app');
      const open = acc.filter((a) => a.status === 'open');
      const ages = acc.filter((a) => a.age_months !== null).map((a) => a.age_months);
      const agesOpen = open.filter((a) => a.age_months !== null).map((a) => a.age_months);
      const revolving = open.filter((a) => a.kind === 'card' && a.credit_limit && a.balance !== null);
      const bal = revolving.reduce((s, a) => s + a.balance, 0), lim = revolving.reduce((s, a) => s + a.credit_limit, 0);
      let on = 0, late = 0;
      for (const a of acc) { if (a.grid) { const s = gridStats({ payment_grid: JSON.stringify(a.grid) }); on += s.on; late += s.late; } }
      const inq = inqAll.filter((x) => x.person === p && (x.type || 'hard') === 'hard');
      const uniq = new Map();
      for (const x of inq) { const k = (x.issuer || x.creditor) + '|' + x.date; if (!uniq.has(k)) uniq.set(k, x); }
      const in12 = [...uniq.values()].filter((x) => daysBetween(x.date, today) <= 365).length;
      const in24 = [...uniq.values()].filter((x) => daysBetween(x.date, today) <= 730).length;
      const oldestOpen = open.filter((a) => a.opened).sort((a, b) => a.opened.localeCompare(b.opened))[0] || null;
      const newCards24 = acc.filter((a) => a.kind === 'card' && a.opened && daysBetween(a.opened, today) <= 730);
      summary[p] = {
        accounts: acc.length, open: open.length, closed: acc.length - open.length,
        avg_age_months: ages.length ? r2(ages.reduce((s, v) => s + v, 0) / ages.length) : null,
        avg_age_open_months: agesOpen.length ? r2(agesOpen.reduce((s, v) => s + v, 0) / agesOpen.length) : null,
        oldest: acc.filter((a) => a.opened).sort((a, b) => a.opened.localeCompare(b.opened))[0]?.opened || null,
        oldest_open: oldestOpen ? { name: oldestOpen.name, app_label: oldestOpen.app_label, opened: oldestOpen.opened, kind: oldestOpen.kind, responsibility: oldestOpen.responsibility } : null,
        newest: acc.filter((a) => a.opened).sort((a, b) => b.opened.localeCompare(a.opened))[0]?.opened || null,
        revolving: { balance: r2(bal), limit: r2(lim), pct: lim ? r4(bal / lim) : null, cards: revolving.length },
        on_time: on + late ? r4(on / (on + late)) : (acc.length ? 1 : null),
        derogatory: acc.filter((a) => a.derogatory).length,
        inquiries_12m: in12, inquiries_24m: in24,
        new_cards_24m: newCards24.length,
        five24_next_drop: newCards24.map((a) => addMonthsIso(a.opened, 24)).sort()[0] || null,
        report_date: reports.filter((r) => r.person === p).map((r) => r.report_date).sort().pop() || null,
        has_bureau: acc.length > 0,
      };
    }

    // ---- factors: Credit Karma's latest snapshot per person when there is one; otherwise estimated from the report
    const factors = [];
    for (const p of people) {
      const own = factorsAll.filter((f) => f.person === p);
      const lastDate = own.map((f) => f.date).sort().pop();
      const ck = new Map(own.filter((f) => f.date === lastDate).map((f) => [f.factor, f]));
      const s = summary[p];
      const val = {
        PAYMENT_HISTORY: s.has_bureau ? s.on_time : null,
        CREDIT_CARD_UTILIZATION: s.has_bureau ? s.revolving.pct : null,
        DEROGATORY_MARKS: s.has_bureau ? s.derogatory : null,
        CREDIT_HISTORY_AGE: s.has_bureau ? s.avg_age_open_months : null,
        TOTAL_ACCOUNTS: s.has_bureau ? s.accounts : null,
        HARD_INQUIRIES: s.has_bureau ? s.inquiries_24m : null,
      };
      for (const [key, label, impact] of FACTORS) {
        const f = ck.get(key);
        const v = val[key];
        const est = grade[key](v === undefined ? null : v);
        if (!f && v === null) continue;
        factors.push({ person: p, factor: key, label, impact: f ? fmtImpact(f.impact) : impact, rating: f ? f.rating : est, estimated: !f,
          value: v, value_kind: { PAYMENT_HISTORY: 'pct', CREDIT_CARD_UTILIZATION: 'pct', CREDIT_HISTORY_AGE: 'months' }[key] || 'count',
          source: f ? f.source : 'report', date: f ? f.date : s.report_date, bureau: f ? f.bureau : null, model: f ? f.model : null, band: f ? f.score_band : null });
      }
    }

    // ---- inquiries: one row per creditor + date (bureaus merged), last 24 months first
    const inqMap = new Map();
    for (const x of inqAll.filter((x) => inP(x.person))) {
      const k = [x.person, x.issuer || x.creditor, x.date, x.type || 'hard'].join('|');
      if (!inqMap.has(k)) inqMap.set(k, { person: x.person, date: x.date, creditor: x.creditor, name: issuerName(x.issuer, x.creditor), type: x.type || 'hard', bureaus: [], category: x.category });
      const e = inqMap.get(k);
      if (x.bureau && !e.bureaus.includes(x.bureau)) e.bureaus.push(x.bureau);
    }
    const inquiries = [...inqMap.values()].map((x) => {
      const drops = addMonthsIso(x.date, 24), stops = addMonthsIso(x.date, 12);
      return { ...x, bureaus: x.bureaus.sort(), drops_off: drops, stops_counting: stops, days_to_drop: daysBetween(today, drops),
        days_to_stop: daysBetween(today, stops), active: daysBetween(today, drops) > 0, counts: daysBetween(today, stops) > 0 };
    }).sort((a, b) => b.date.localeCompare(a.date));

    const util = utilization(people, today, new Set(tlAll.filter((t) => t.account_id && t.source !== 'app').map((t) => t.account_id)));
    const age = {};
    for (const p of people) age[p] = { avg_months: summary[p].avg_age_months, avg_open_months: summary[p].avg_age_open_months, oldest: summary[p].oldest, newest: summary[p].newest };

    const out = {
      person: person || '', people: PEOPLE.slice(), as_of: today,
      has: { scores: scores.length > 0, accounts: accounts.some((a) => a.source !== 'app'), app_accounts: accounts.some((a) => a.source === 'app'),
        inquiries: inquiries.length > 0, factors: factorsAll.some((f) => inP(f.person)), reports: reports.length > 0,
        by_person: Object.fromEntries(people.map((p) => [p, { scores: scores.some((s) => s.person === p), report: summary[p].has_bureau, factors: factorsAll.some((f) => f.person === p) }])) },
      scores, current, factors, summary, utilization: util, accounts, age, inquiries, reports,
    };
    out.actions = actions(out, people, today);
    return out;
  };

  function fmtImpact(s) { const t = String(s || '').toLowerCase(); return t ? t[0].toUpperCase() + t.slice(1) : null; }

  /* ---------------------------------------------------------------- "Improve your score": concrete, computed actions */
  function actions(d, people, today) {
    const out = [];
    const money = (v) => '$' + Math.round(v).toLocaleString('en-US');
    const pct = (v) => Math.round(v * 100) + '%';
    const who = (p) => (people.length > 1 ? short(p) + ': ' : '');
    const dt = (x) => { if (!x) return ''; const t = String(x); return t.length >= 10 ? `${t.slice(5, 7)}.${t.slice(8, 10)}.${t.slice(0, 4)}` : t.length === 7 ? `${t.slice(5, 7)}.${t.slice(0, 4)}` : t; };
    // 1. anything reported late right now
    for (const a of d.accounts) {
      if (a.status !== 'open' || a.source === 'app') continue;
      if (/late|past due|delinquen/i.test(a.payment_status || '') || (a.past_due || 0) > 0) {
        out.push({ priority: 1, kind: 'late', person: a.person, tone: 'crit',
          title: `${who(a.person)}${a.app_label || a.name} is reported ${String(a.payment_status || 'past due').toLowerCase()}`,
          detail: `As of ${a.as_of ? dt(a.as_of) : 'the last report'}${a.past_due ? `, ${money(a.past_due)} past due` : ''}. Pay at least the minimum now so it doesn't reach 60 days; once current, ask the issuer for a goodwill removal of the late mark. Payment history is the biggest factor.`,
          account: a.key });
      }
    }
    // 2. cards above 30% (live balances); 3. overall above 10%
    const cards = d.utilization.cards.filter((c) => c.limit && c.balance !== null && !c.business);
    for (const c of cards) {
      if (c.pct >= 0.3) {
        const target = Math.floor(c.limit * 0.29);
        out.push({ priority: c.pct >= 0.8 ? 2 : 3, kind: 'card_util', person: c.holder, tone: c.pct >= 0.8 ? 'crit' : 'warn',
          title: `${who(c.holder)}Pay ${c.label} under 30%`,
          detail: `${money(c.balance)} of a ${money(c.limit)} limit (${pct(c.pct)}). Paying ${money(c.balance - target)} before the statement closes brings it to 29%; under 10% (${money(Math.max(0, c.balance - c.limit * 0.09))}) is better.`,
          account_id: c.account_id, amount: r2(c.balance - target) });
      }
    }
    // cards the app doesn't track, as the bureaus last saw them
    const tracked = new Set(d.utilization.cards.map((c) => c.account_id));
    for (const a of d.accounts) {
      if (a.source === 'app' || a.status !== 'open' || a.kind !== 'card' || a.utilization === null || a.utilization < 0.3) continue;
      if (a.account_id && tracked.has(a.account_id)) continue;
      out.push({ priority: a.utilization >= 0.8 ? 2 : 3, kind: 'card_util', person: a.person, tone: a.utilization >= 0.8 ? 'crit' : 'warn',
        title: `${who(a.person)}Pay ${a.app_label || a.name} under 30%`,
        detail: `Reported ${money(a.balance)} of a ${money(a.credit_limit)} limit (${pct(a.utilization)}) on ${dt(a.as_of)}. Paying ${money(a.balance - Math.floor(a.credit_limit * 0.29))} before the statement closes brings it to 29%.`,
        account: a.key, amount: r2(a.balance - Math.floor(a.credit_limit * 0.29)) });
    }
    for (const p of people) {
      const u = d.utilization.current.by_person[p];
      if (u && u.pct !== null && u.pct >= 0.1) {
        const need = u.balance - u.limit * 0.09;
        out.push({ priority: u.pct >= 0.3 ? 2 : 4, kind: 'overall_util', person: p, tone: u.pct >= 0.3 ? 'warn' : 'info',
          title: `${who(p)}Overall utilization is ${pct(u.pct)}`,
          detail: `${money(u.balance)} owed across ${u.cards} cards with ${money(u.limit)} of limits. Scores are best under 10%: paying ${money(need)} down before statements close gets there. Only the statement balance is reported, so paying early works even if you pay in full each month.`,
          amount: r2(need) });
      }
    }
    // 4. hard inquiries: when they stop counting / drop off
    for (const p of people) {
      const s = d.summary[p];
      const list = d.inquiries.filter((x) => x.person === p && x.type === 'hard' && x.active);
      if (!list.length) continue;
      const next = list.filter((x) => x.counts).sort((a, b) => a.stops_counting.localeCompare(b.stops_counting))[0];
      const nextDrop = list.sort((a, b) => a.drops_off.localeCompare(b.drops_off))[0];
      out.push({ priority: s.inquiries_12m >= 3 ? 4 : 6, kind: 'inquiries', person: p, tone: s.inquiries_12m >= 3 ? 'warn' : 'info',
        title: `${who(p)}${s.inquiries_12m} hard ${s.inquiries_12m === 1 ? 'inquiry' : 'inquiries'} in the last 12 months, ${s.inquiries_24m} in 24`,
        detail: `${next ? `The ${next.name} inquiry (${dt(next.date)}) stops counting for FICO on ${dt(next.stops_counting)}. ` : ''}${nextDrop ? `The next to drop off the report is ${nextDrop.name} on ${dt(nextDrop.drops_off)}. ` : ''}Holding off on new applications until then lets the score recover.` });
    }
    // 5. oldest open account to keep; 6. new accounts / 5-24
    for (const p of people) {
      const s = d.summary[p];
      if (s.oldest_open) {
        const yrs = Math.floor(monthsBetween(s.oldest_open.opened, today) / 12);
        out.push({ priority: 5, kind: 'keep_open', person: p, tone: 'info',
          title: `${who(p)}Keep ${s.oldest_open.app_label || s.oldest_open.name}${s.oldest_open.responsibility === 'authorized user' ? ' (authorized user)' : ''} open`,
          detail: `Opened ${dt(s.oldest_open.opened)}, it's the oldest open account (${yrs} years). Closing it would shorten the history age of open accounts (now ${(s.avg_age_open_months / 12).toFixed(1)} years). Put a small charge on it every few months so the issuer doesn't close it for inactivity.` });
      }
      if (s.new_cards_24m >= 3) {
        out.push({ priority: 6, kind: 'new_accounts', person: p, tone: 'info',
          title: `${who(p)}${s.new_cards_24m} new card accounts in 24 months`,
          detail: `New accounts lower the average age (all accounts ${(s.avg_age_months / 12).toFixed(1)} years, open accounts ${(s.avg_age_open_months / 12).toFixed(1)}). For Chase's 5/24 rule this counts as ${s.new_cards_24m}/24${s.five24_next_drop ? `; the oldest of them ages out on ${dt(s.five24_next_drop)}` : ''}.` });
      }
    }
    // 7. factors Credit Karma rates Fair / Needs work that the actions above don't already cover
    const covered = new Set(out.map((a) => a.person + '|' + ({ card_util: 'CREDIT_CARD_UTILIZATION', overall_util: 'CREDIT_CARD_UTILIZATION', inquiries: 'HARD_INQUIRIES', keep_open: 'CREDIT_HISTORY_AGE', new_accounts: 'CREDIT_HISTORY_AGE', late: 'PAYMENT_HISTORY' }[a.kind] || a.kind)));
    for (const f of d.factors) {
      if (f.estimated || !['FAIR', 'POOR', 'NEEDS_WORK', 'VERY_POOR'].includes(f.rating) || covered.has(f.person + '|' + f.factor)) continue;
      out.push({ priority: 7, kind: 'factor', person: f.person, tone: 'info', title: `${who(f.person)}${f.label} is rated ${String(f.rating).toLowerCase().replace('_', ' ')}`,
        detail: `${f.impact} impact, per Credit Karma on ${dt(f.date)}.` });
    }
    out.sort((a, b) => a.priority - b.priority);
    return out;
  }

  Object.assign(H, { credit_dedupe: dedupeTradelines, credit_add_months: addMonthsIso });
})(typeof globalThis !== 'undefined' ? globalThis : this);
