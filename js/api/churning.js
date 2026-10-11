/* Financial Home v3 — Card applications, sign-up bonuses and manufactured spending (no app.py counterpart).
   GET /api/churning?person=Roque|Jennifer   (blank = both)
   Reads the laptop-owned card_applications / ms_log / bank_bonuses tables (scripts/import_churn_sheets.py builds them from
   the Google Drive "Credit Cards" and "Bank Bonuses" sheets and cross-checks every row against the credit reports and the
   app), plus credit_tradelines / credit_inquiries (Credit Karma), accounts, card_settings and transactions.
   The sheets are the household's own notes: each row carries crossref_status (corroborated | conflicting | uncorroborated)
   and the page shows it. Everything is computed here; nothing is written.
   Response: { person, people, as_of, has, five24, apps, family, timeline, progress, fees, ms, bank, crossref }. */
'use strict';
(function (g) {
  const H = (g.H = g.H || {});
  const API = (g.API = g.API || {});
  API.get = API.get || {};
  const DB = () => g.DB;

  const PEOPLE = ['Roque', 'Jennifer'];
  const BUSINESS_RE = /\bbusiness\b|\bink\b|\bspark\b|\bbiz\b|simplycash/i;
  const hasTable = (t) => !!DB().one("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", [t]);
  const r2 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
  const toDate = (s) => {
    if (!s) return null;
    const t = String(s);
    const full = t.length >= 10 ? t.slice(0, 10) : t.length === 7 ? t + '-15' : t.length === 4 ? t + '-07-01' : null;
    const d = full ? new Date(full + 'T12:00:00Z') : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  };
  const iso = (d) => d.toISOString().slice(0, 10);
  const addMonths = (s, k) => {
    const d = toDate(s); if (!d) return null;
    const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + k);
    d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
    return iso(d);
  };
  const addDays = (s, k) => { const d = toDate(s); if (!d) return null; d.setUTCDate(d.getUTCDate() + k); return iso(d); };
  const days = (a, b) => { const x = toDate(a), y = toDate(b); return x && y ? Math.round((y - x) / 86400000) : null; };
  const ISSUER = { amex: 'American Express', citi: 'Citi', bofa: 'Bank of America', chase: 'Chase', barclays: 'Barclays',
    capitalone: 'Capital One', usbank: 'U.S. Bank', synchrony: 'Synchrony', discover: 'Discover', wellsfargo: 'Wells Fargo',
    td: 'TD Bank', popular: 'Banco Popular' };
  const CK_ISSUER = [['JPMCB', 'chase'], ['CITI', 'citi'], ['CBNA', 'citi'], ['AMEX', 'amex'], ['AMERICAN EXPRESS', 'amex'],
    ['BK OF AMER', 'bofa'], ['BANK OF AMERICA', 'bofa'], ['BRCLYS', 'barclays'], ['BARCLAYS', 'barclays'], ['US BANK', 'usbank'],
    ['U.S. BANK', 'usbank'], ['US BANCORP', 'usbank'], ['CAPITAL ONE', 'capitalone'], ['DISCOVER', 'discover'], ['BP-VISA', 'popular'],
    ['BANCO POPULAR', 'popular'], ['TD BANK', 'td'], ['WFBNA CARD', 'wellsfargo'], ['WELLS FARGO CARD', 'wellsfargo'], ['SYNCB', 'synchrony']];
  const ckIssuer = (t) => {
    if (t.issuer && ISSUER[t.issuer]) return t.issuer;
    const c = String(t.creditor || '').toUpperCase();
    const hit = CK_ISSUER.find(([k]) => c.includes(k));
    return hit ? hit[1] : (t.issuer || c.toLowerCase());
  };
  const issuerName = (k, fallback) => ISSUER[k] || fallback || 'Unknown';

  /* One row per account per person (bureau copies merged), cards only, bureau data only. */
  function ckCards() {
    if (!hasTable('credit_tradelines')) return [];
    const rows = DB().Q("SELECT * FROM credit_tradelines WHERE kind='card' AND COALESCE(source,'') <> 'app'");
    const m = new Map();
    for (const t of rows) {
      const k = t.person + '|' + (t.group_key || t.tradeline_id);
      const e = m.get(k);
      if (!e) { m.set(k, { ...t, key: t.group_key || t.tradeline_id }); continue; }
      if (t.opened && (!e.opened || t.opened < e.opened)) e.opened = t.opened;
      if (t.closed && (!e.closed || t.closed > e.closed)) e.closed = t.closed;
      e.credit_limit = e.credit_limit || t.credit_limit;
      e.account_id = e.account_id || t.account_id;
      if (t.responsibility === 'authorized user') e.responsibility = 'authorized user';
      if (t.status === 'open') e.status = e.status || 'open';
    }
    return [...m.values()].map((t) => ({ ...t, iss: ckIssuer(t) }));
  }

  function accountLabels() {
    const m = new Map();
    for (const a of DB().Q('SELECT account_id, display_name, name, last4, holder, status FROM accounts')) m.set(a.account_id, a);
    return m;
  }
  const label = (a) => (a ? a.display_name || a.name : null);

  API.get['/api/churning'] = (q) => {
    const DBx = DB();
    const today = H.today_s ? H.today_s() : DBx.today();
    const want = (q.person || '').trim();
    const person = want === 'Jenny' ? 'Jennifer' : (PEOPLE.includes(want) ? want : '');
    const people = person ? [person] : PEOPLE.slice();
    const inP = (p) => people.includes(p);
    const ready = hasTable('card_applications');
    const all = ready ? DBx.Q('SELECT * FROM card_applications') : [];
    const msAll = hasTable('ms_log') ? DBx.Q('SELECT * FROM ms_log') : [];
    const bankAll = hasTable('bank_bonuses') ? DBx.Q('SELECT * FROM bank_bonuses') : [];
    const labels = accountLabels();
    const cs = new Map((hasTable('card_settings') ? DBx.Q('SELECT card_key, opened_date, annual_fee, closed_date, detail_sources FROM card_settings') : []).map((r) => [r.card_key, r]));
    const ck = ckCards();
    const inq = hasTable('credit_inquiries') ? DBx.Q("SELECT person, date, creditor, issuer, bureau FROM credit_inquiries WHERE COALESCE(type,'hard')='hard'") : [];

    // ---- applications (household; family members are counted, not listed)
    const household = all.filter((a) => a.player_group === 'household');
    const apps = household.filter((a) => inP(a.person)).map((a) => {
      const acct = a.account_id ? labels.get(a.account_id) : null;
      return {
        app_id: a.app_id, person: a.person, issuer: a.issuer, issuer_key: a.issuer_key, card: a.card, reward_program: a.reward_program,
        applied: a.applied_date, approved: a.approved_date, status: a.status, last4: a.last4, pc_card: a.pc_card, pc_last4: a.pc_last4,
        credit_limit: a.credit_limit, bonus: a.signup_bonus, bonus_points: a.bonus_points, min_spend: a.min_spend, min_spend_text: a.min_spend_text,
        deadline: a.spend_deadline, deadline_estimated: !!a.spend_deadline_estimated, bonus_earned: a.bonus_earned === null ? null : !!a.bonus_earned,
        bonus_earned_date: a.bonus_earned_date, annual_fee: a.annual_fee, closed: a.closed_date, downgraded: a.downgraded_date,
        notes: a.notes, source: a.source, crossref: a.crossref_status || 'uncorroborated', crossref_detail: a.crossref_detail,
        account_id: a.account_id, account_label: label(acct), ck_opened: a.ck_opened, ck_closed: a.ck_closed, ck_limit: a.ck_limit,
        business: BUSINESS_RE.test(a.card || ''), date: a.approved_date || a.applied_date,
      };
    }).sort((x, y) => String(y.date || '').localeCompare(String(x.date || '')) || String(y.app_id).localeCompare(String(x.app_id)));
    const fam = all.filter((a) => a.player_group !== 'household');

    // ---- 5/24: personal cards opened in the last 24 months (Credit Karma, authorized-user cards included as Chase counts
    // them) plus approved personal cards from the sheet that no report lists yet
    const five24 = {};
    const since = addMonths(today, -24);
    const matched = new Set(household.map((a) => a.tradeline_group).filter(Boolean));
    for (const p of people) {
      const cards = ck.filter((t) => t.person === p && t.opened && t.opened > since).map((t) => ({
        name: label(labels.get(t.account_id)) || issuerName(t.iss, t.creditor), issuer: issuerName(t.iss, t.creditor), opened: t.opened,
        drops: addMonths(t.opened, 24), source: 'credit report', au: t.responsibility === 'authorized user',
        in_sheet: matched.has(t.key), account_id: t.account_id || null }));
      for (const a of household) {
        if (a.person !== p || a.tradeline_group || /declined/i.test(a.status || '') || BUSINESS_RE.test(a.card || '')) continue;
        const d = a.approved_date || a.applied_date;
        if (d && d > since) cards.push({ name: a.card, issuer: a.issuer, opened: d, drops: addMonths(d, 24), source: 'sheet', au: false, in_sheet: true, account_id: a.account_id });
      }
      cards.sort((x, y) => x.opened.localeCompare(y.opened));
      const n = cards.length;
      five24[p] = { count: n, under: n < 5, cards, next_drop: cards.length ? cards[0].drops : null,
        slot_opens: n >= 5 ? cards[n - 5].drops : null, has_report: ck.some((t) => t.person === p) };
    }

    // ---- timeline: applications, hard inquiries and new card accounts, per person
    const tl = [];
    for (const a of apps) {
      if (!a.date) continue;
      const declined = /declined/i.test(a.status || '');
      tl.push({ person: a.person, lane: 'apps', date: a.date, tone: declined ? 'declined' : a.crossref === 'conflicting' ? 'conflict' : 'approved',
        label: `${a.card} · ${a.status || ''}`, app_id: a.app_id });
    }
    for (const x of inq.filter((x) => inP(x.person))) tl.push({ person: x.person, lane: 'inquiries', date: x.date, tone: 'inquiry', label: `${x.creditor} (${x.bureau})` });
    for (const t of ck.filter((t) => inP(t.person) && t.opened)) {
      tl.push({ person: t.person, lane: 'opened', date: t.opened, tone: t.responsibility === 'authorized user' ? 'au' : matched.has(t.key) ? 'matched' : 'unmatched',
        label: `${label(labels.get(t.account_id)) || issuerName(t.iss, t.creditor)} opened${t.closed ? ', closed ' + t.closed : ''}${matched.has(t.key) ? '' : ' · not in the sheet'}` });
    }
    // de-duplicate inquiries reported by both bureaus on the same day
    const seen = new Set();
    const timeline = tl.filter((e) => { const k = [e.person, e.lane, e.date, e.label.split(' (')[0]].join('|'); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((x, y) => x.date.localeCompare(y.date));

    // ---- sign-up bonus progress: cards opened in the last 12 months (sheet or report), spend in the app from opening to the deadline
    const spendOn = (aid, a, b) => (aid ? -(DBx.one(`SELECT COALESCE(SUM(amount),0) FROM transactions WHERE account_id=? AND posted_date BETWEEN ? AND ?
      AND amount < 0 AND COALESCE(category,'') <> 'Transfer'`, [aid, a, b]) || 0) : null);
    const progress = [];
    const cutoff = addMonths(today, -12);
    const coveredAcct = new Set();
    for (const a of apps) {
      if (!a.date || a.date < cutoff || /declined/i.test(a.status || '')) continue;
      const opened = a.ck_opened || a.approved || a.applied;
      const deadline = a.deadline || addDays(opened, 90);
      const spent = a.account_id ? r2(spendOn(a.account_id, opened, deadline)) : null;
      if (a.account_id) coveredAcct.add(a.account_id);
      progress.push(prog({ person: a.person, card: a.account_label || a.card, opened, min_spend: a.min_spend, deadline, deadline_estimated: a.deadline_estimated || !a.deadline,
        spent, bonus: a.bonus, earned: a.bonus_earned, source: 'sheet', account_id: a.account_id, app_id: a.app_id, crossref: a.crossref }));
    }
    for (const t of ck) {
      if (!inP(t.person) || !t.opened || t.opened < cutoff || matched.has(t.key) || t.responsibility === 'authorized user') continue;
      if (t.account_id && coveredAcct.has(t.account_id)) continue;
      const deadline = addDays(t.opened, 90);
      progress.push(prog({ person: t.person, card: label(labels.get(t.account_id)) || issuerName(t.iss, t.creditor), opened: t.opened, min_spend: null, deadline,
        deadline_estimated: true, spent: t.account_id ? r2(spendOn(t.account_id, t.opened, deadline)) : null, bonus: null, earned: null,
        source: 'credit report', account_id: t.account_id || null, app_id: null, crossref: 'not in the sheet' }));
      if (t.account_id) coveredAcct.add(t.account_id);
    }
    function prog(o) {
      const left = days(today, o.deadline);
      const pct = o.min_spend && o.spent !== null ? Math.min(1, o.spent / o.min_spend) : null;
      let state = 'unknown';
      if (o.earned === true || (pct !== null && pct >= 1)) state = 'met';
      else if (left !== null && left < 0) state = o.min_spend ? 'missed' : 'ended';
      else if (pct !== null) {
        const total = Math.max(1, days(o.opened, o.deadline) || 90), gone = Math.max(0, days(o.opened, today) || 0);
        state = pct >= Math.min(1, gone / total) ? 'on_track' : 'behind';
      } else if (left !== null && left >= 0) state = 'open';
      return { ...o, days_left: left, pct: pct === null ? null : Math.round(pct * 1000) / 1000, need: o.min_spend && o.spent !== null ? r2(Math.max(0, o.min_spend - o.spent)) : null, state };
    }
    progress.sort((x, y) => String(y.opened).localeCompare(String(x.opened)));

    // ---- annual fees: open cards with a fee (card_settings first, then the sheet), next anniversary of the open date
    const fees = [];
    const feeSeen = new Set();
    const nextAnniv = (opened) => {
      const d = toDate(opened); if (!d) return null;
      const md = String(opened).length >= 10 ? opened.slice(5, 10) : (String(opened).length === 7 ? opened.slice(5, 7) + '-01' : null);
      if (!md) return null;
      let y = +today.slice(0, 4);
      let cand = `${y}-${md}`;
      if (!toDate(cand)) cand = `${y}-${md.slice(0, 2)}-28`;
      if (cand < today) cand = `${y + 1}-${cand.slice(5)}`;
      return cand;
    };
    for (const [aid, s] of cs) {
      const acct = labels.get(aid);
      if (!acct || !(s.annual_fee > 0) || acct.status === 'closed' || s.closed_date || !inP(acct.holder === 'Joint' ? people[0] : acct.holder)) continue;
      const app = household.find((a) => a.account_id === aid);
      const opened = s.opened_date || (app && (app.approved_date || app.applied_date));
      fees.push({ account_id: aid, card: label(acct), person: acct.holder, fee: s.annual_fee, opened, next: nextAnniv(opened), days: days(today, nextAnniv(opened)),
        source: 'card details' });
      feeSeen.add(aid);
    }
    for (const a of household) {
      if (!inP(a.person) || !(a.annual_fee > 0) || !/^(open|product change)$/i.test(a.status || '') || a.closed_date || feeSeen.has(a.account_id)) continue;
      if (a.ck_closed || a.downgraded_date || /product change/i.test(a.status || '')) continue; // downgrades go to no-fee versions
      const opened = a.ck_opened || a.approved_date || a.applied_date;
      // the same card already listed from its account details (a sheet row without a last4 that the import couldn't link)
      if (!a.account_id && fees.some((f) => f.person === a.person && f.opened && Math.abs(days(f.opened, opened) ?? 999) <= 31)) continue;
      fees.push({ account_id: a.account_id, card: label(labels.get(a.account_id)) || a.card, person: a.person, fee: a.annual_fee, opened, next: nextAnniv(opened),
        days: days(today, nextAnniv(opened)), source: 'sheet' + (a.downgraded_date ? ' (downgraded; may have no fee now)' : '') });
      if (a.account_id) feeSeen.add(a.account_id);
    }
    fees.sort((x, y) => String(x.next || '9999').localeCompare(String(y.next || '9999')));

    // ---- manufactured spending
    const msRows = msAll.filter((m) => m.status !== 'candidate' && m.status !== 'refunded' && !/cash-out/i.test(m.method || ''));
    const ownMs = person ? msRows.filter((m) => m.person === person) : msRows;
    const sum = (list) => r2(list.reduce((s, m) => s + (m.amount || 0), 0));
    const group = (list, key) => {
      const mm = new Map();
      for (const m of list) { const k = key(m); if (!mm.has(k)) mm.set(k, []); mm.get(k).push(m); }
      return [...mm.entries()].map(([k, l]) => ({ key: k, amount: sum(l), n: l.length, fees: r2(l.reduce((s, m) => s + (m.fee || 0), 0)) }));
    };
    const ms = {
      total: sum(ownMs), n: ownMs.length, fees: r2(ownMs.reduce((s, m) => s + (m.fee || 0), 0)),
      household: sum(ownMs.filter((m) => PEOPLE.includes(m.person))), family: sum(ownMs.filter((m) => m.person && !PEOPLE.includes(m.person))),
      corroborated: msAll.filter((m) => m.crossref_status === 'corroborated').length,
      by_year: group(ownMs.filter((m) => m.date), (m) => m.date.slice(0, 4)).sort((a, b) => a.key.localeCompare(b.key)),
      by_method: group(ownMs, (m) => m.method || 'Other').sort((a, b) => b.amount - a.amount),
      cashouts: msAll.filter((m) => /cash-out/i.test(m.method || '')).map(pickMs),
      linked: msAll.filter((m) => m.txn_id && m.crossref_status === 'corroborated').map(pickMs),
      candidates: msAll.filter((m) => m.status === 'candidate' && (!person || m.person === person)).map(pickMs),
      tax: msAll.filter((m) => /tax payment/i.test(m.method || '') && (!person || !m.person || m.person === person)).map(pickMs).sort((a, b) => String(b.date).localeCompare(String(a.date))),
      recent: ownMs.filter((m) => m.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12).map(pickMs),
    };
    function pickMs(m) {
      return { ms_id: m.ms_id, date: m.date, person: m.person, method: m.method, card: m.card, amount: m.amount, fee: m.fee, liquidation: m.liquidation_account,
        status: m.status, crossref: m.crossref_status, detail: m.crossref_detail, txn_id: m.txn_id, notes: m.notes };
    }

    // ---- bank bonuses
    const bankRows = bankAll.filter((b) => !person || b.person === person).map((b) => ({
      bonus_id: b.bonus_id, bank: b.bank, person: b.person, amount: b.bonus_amount, applied: b.applied_date, opened: b.opened_date, status: b.status,
      received: b.bonus_received, requirements: b.requirements, account_type: b.account_type, crossref: b.crossref_status, detail: b.crossref_detail,
      household: PEOPLE.includes(b.person) }))
      .sort((a, b) => String(b.applied || '').localeCompare(String(a.applied || '')));
    const got = bankRows.filter((b) => /^yes$/i.test(b.received || ''));
    const bank = { rows: bankRows, earned: r2(got.reduce((s, b) => s + (b.amount || 0), 0)), earned_n: got.length };

    // ---- cross-reference summary
    const counts = { corroborated: 0, conflicting: 0, uncorroborated: 0 };
    for (const a of apps) counts[a.crossref] = (counts[a.crossref] || 0) + 1;
    const conflicts = apps.filter((a) => a.crossref === 'conflicting').map((a) => ({ app_id: a.app_id, person: a.person, card: a.card, date: a.date,
      detail: (() => { const t = a.crossref_detail || ''; const i = t.indexOf('CONFLICT: '); return i < 0 ? '' : t.slice(i + 10).split('; CONFLICT: ').join('; '); })() }));
    const gaps = ck.filter((t) => inP(t.person) && t.opened && t.opened >= '2015-01-01' && !matched.has(t.key) && t.responsibility !== 'authorized user' && t.iss !== 'synchrony')
      .map((t) => ({ person: t.person, name: label(labels.get(t.account_id)) || issuerName(t.iss, t.creditor), opened: t.opened, closed: t.closed, limit: t.credit_limit }))
      .sort((a, b) => b.opened.localeCompare(a.opened));

    const approved = apps.filter((a) => !/declined/i.test(a.status || ''));
    return {
      person: person || '', people: PEOPLE.slice(), as_of: today,
      has: { apps: apps.length > 0, ms: msAll.length > 0, bank: bankAll.length > 0, report: ck.length > 0 },
      totals: { apps: apps.length, approved: approved.length, declined: apps.length - approved.length,
        open: approved.filter((a) => /^(open|product change)$/i.test(a.status || '') && !a.ck_closed).length,
        bonus_points: approved.filter((a) => a.bonus_earned).reduce((s, a) => s + (a.bonus_points || 0), 0),
        first: apps.map((a) => a.date).filter(Boolean).sort()[0] || null, last: apps.map((a) => a.date).filter(Boolean).sort().pop() || null },
      five24, apps, family: { apps: fam.length, people: new Set(fam.map((a) => a.person)).size },
      timeline, progress, fees, ms, bank, crossref: { counts, conflicts, gaps },
    };
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
