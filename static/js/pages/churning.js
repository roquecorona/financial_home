/* 08 Credit → Applications: card applications on a timeline next to the credit reports, sign-up bonus progress, 5/24,
   annual-fee dates, manufactured spending and bank bonuses. Data: GET /api/churning (js/api/churning.js) over the tables the
   laptop builds from the Drive "Credit Cards" and "Bank Bonuses" sheets (scripts/import_churn_sheets.py). Read-only.
   The sheets are notes, so every application shows whether a credit report or the app agrees with it. */
'use strict';
F.creditApps = async (root, r, ctl, { person, head, bindHead }) => {
  const { html, raw, fmt, $, $$ } = F;
  const d = await F.get('/api/churning', { person });
  if (!ctl.alive()) return;
  const lsGet = (k, v) => { try { return localStorage.getItem(k) ?? v; } catch { return v; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  const short = (x) => (x === 'Jennifer' ? 'Jenny' : x);
  const both = !person;
  const people = both ? d.people : [person];
  const today = d.as_of;
  const ym = (s) => (s ? (s.length >= 10 ? fmt.date(s, { year: true }) : s.length === 7 ? `${s.slice(5, 7)}.${s.slice(0, 4)}` : s) : '—');
  const money0 = (v) => (v === null || v === undefined ? '—' : fmt.money(v, { cents: false }));
  const XREF = { corroborated: ['Matches', 'good', 'A credit report or the app agrees'], conflicting: ['Conflict', 'crit', 'A credit report or the app disagrees'],
    uncorroborated: ['Sheet only', 'neutral', 'Nothing else on file to check it against'], 'not in the sheet': ['Not in sheet', 'warn', 'On the credit report, not in the sheet'] };
  const xpill = (s, title) => { const [l, t, h] = XREF[s] || XREF.uncorroborated; return html`<span class="pill ${t}" title="${title || h}">${l}</span>`; };
  let range = lsGet('fin.apps.range', '3y');
  let appFilter = lsGet('fin.apps.filter', 'all');
  let appsAll = false;
  let bankAll = false;

  if (!d.has.apps && !d.has.ms && !d.has.bank) {
    F.setHTML(root, html`${head()}<section class="panel" style="margin-top:24px">${F.empty('No card applications yet',
      'They come from the Credit Cards sheet in Google Drive: run import_churn_sheets.py on the laptop, then cloud_sync.py push.')}</section>`);
    bindHead();
    return;
  }

  // ---------- KPI band
  const kpis = [];
  for (const p of people) {
    const f = d.five24[p];
    if (!f) continue;
    kpis.push(F.kpi(`${short(p)} · 5/24`, html`<span class="fig">${f.count}/24</span>`,
      f.count >= 5 ? `Over Chase’s limit · a slot opens ${ym(f.slot_opens)}` : `${5 - f.count} under Chase’s limit${f.next_drop ? ` · next drops ${ym(f.next_drop)}` : ''}`,
      { vcls: f.count >= 5 ? 'alert-text' : '' }));
  }
  kpis.push(F.kpi('Applications', fmt.num(d.totals.apps), `${d.totals.approved} approved · ${d.totals.declined} declined · ${d.totals.first ? d.totals.first.slice(0, 4) : ''}–${d.totals.last ? d.totals.last.slice(0, 4) : ''}`));
  kpis.push(F.kpi('Manufactured spend', money0(d.ms.total), `${d.ms.n} logged · ${money0(d.ms.fees)} in fees`));
  kpis.push(F.kpi('Bank bonuses', money0(d.bank.earned), `${d.bank.earned_n} received`));

  const c = d.crossref.counts;
  F.setHTML(root, html`
    ${head()}
    <section class="band" style="--n:${kpis.length}" aria-label="Summary">${kpis}</section>
    <div class="callout" style="margin-top:16px">${F.icon('info')}<div>From the Credit Cards and Bank Bonuses sheets in Google Drive, checked against the credit reports and the app:
      <b>${c.corroborated || 0}</b> applications match, <b>${c.conflicting || 0}</b> conflict, <b>${c.uncorroborated || 0}</b> have nothing to check against (mostly business cards and declines before 2024).
      ${d.family.apps ? `${d.family.apps} family members’ applications are kept in the data but not listed here.` : ''}</div></div>
    <div class="grid">
      <section class="panel span-7"><div class="panel-head"><h2>Sign-up bonuses</h2><span class="sub">Cards opened in the last 12 months · spend in the app from opening to the deadline</span></div>
        <div class="panel-body flush" id="ch-progress"></div></section>
      <section class="panel span-5"><div class="panel-head"><h2>Annual fees</h2><span class="sub">Next fee on each open card with one</span></div>
        <div class="panel-body flush" id="ch-fees"></div></section>
      <section class="panel span-12"><div class="panel-head"><h2>Timeline</h2><span class="sub">Applications from the sheet next to Credit Karma’s inquiries and new accounts</span>
        <div class="tools"><div class="seg sm" role="group" aria-label="Range">${[['3y', '3 years'], ['all', 'All']].map(([k, l]) => html`<button type="button" data-range="${k}" aria-pressed="${String(range === k)}">${l}</button>`)}</div></div></div>
        <div class="panel-body" id="ch-timeline"></div></section>
      <section class="panel span-6"><div class="panel-head"><h2>5/24</h2><span class="sub">Personal cards opened in the last 24 months · Chase declines at 5</span></div>
        <div class="panel-body flush" id="ch-524"></div></section>
      <section class="panel span-6"><div class="panel-head"><h2>Cross-check</h2><span class="sub">Where the sheet and the reports disagree</span></div>
        <div class="panel-body flush" id="ch-xref"></div></section>
      <section class="panel span-12"><div class="panel-head"><h2>Applications</h2><span class="sub">Newest first · tap a row for the details and the check</span>
        <div class="tools"><div class="seg sm" role="group" aria-label="Applications shown">${[['all', 'All'], ['approved', 'Approved'], ['declined', 'Declined'], ['open', 'Open']].map(([k, l]) => html`<button type="button" data-af="${k}" aria-pressed="${String(appFilter === k)}">${l}</button>`)}</div></div></div>
        <div class="panel-body flush" id="ch-apps"></div></section>
      <section class="panel span-7"><div class="panel-head"><h2>Manufactured spending</h2><span class="sub">Gift cards, Bluebird, Venmo and taxes paid by card, from the sheets</span></div>
        <div class="panel-body" id="ch-ms"></div></section>
      <section class="panel span-5"><div class="panel-head"><h2>Bank bonuses</h2><span class="sub">Checking and savings sign-up bonuses</span></div>
        <div class="panel-body flush" id="ch-bank"></div></section>
    </div>`);
  bindHead();
  drawProgress(); drawFees(); drawTimeline(); draw524(); drawXref(); drawApps(); drawMs(); drawBank();
  $$('[data-range]', root).forEach((b) => (b.onclick = () => { range = b.dataset.range; lsSet('fin.apps.range', range); $$('[data-range]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawTimeline(); }));
  $$('[data-af]', root).forEach((b) => (b.onclick = () => { appFilter = b.dataset.af; lsSet('fin.apps.filter', appFilter); $$('[data-af]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawApps(); }));
  root.addEventListener('click', (e) => {
    const row = e.target.closest('[data-app]');
    if (row && !e.target.closest('a')) openApp(row.dataset.app);
    const tx = e.target.closest('[data-txn]');
    if (tx) F.openTxn(tx.dataset.txn);
  });
  root.addEventListener('keydown', (e) => {
    const row = e.target.closest('[data-app]');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openApp(row.dataset.app); }
  });

  // ---------- pieces
  function drawProgress() {
    const el = $('#ch-progress', root);
    if (!d.progress.length) { F.setHTML(el, F.empty('No new cards in the last 12 months')); return; }
    const STATE = { met: ['Met', 'good'], on_track: ['On track', 'good'], behind: ['Behind', 'warn'], missed: ['Missed', 'crit'], ended: ['Window over', 'neutral'], open: ['Open', 'info'], unknown: ['—', 'neutral'] };
    F.setHTML(el, html`<div class="list">${d.progress.map((p) => {
      const [lbl, tone] = STATE[p.state] || STATE.unknown;
      const noTx = p.account_id && p.spent === 0 && p.earned;
      return html`<div class="list-item ch-prog"><div class="main-col">
        <div class="title">${p.card}${both ? html` <span class="muted">· ${short(p.person)}</span>` : ''}</div>
        <div class="meta wrap">Opened ${ym(p.opened)} · ${p.min_spend ? `${money0(p.min_spend)} by ${ym(p.deadline)}${p.deadline_estimated ? ' (90 days, estimated)' : ''}` : `first 90 days to ${ym(p.deadline)} · bonus terms not in the sheet`}${p.bonus ? ` · ${fmt.num(Number(p.bonus) || 0) !== '0' ? fmt.num(Number(p.bonus)) + ' points' : p.bonus}` : ''}</div>
        ${p.min_spend && p.spent !== null && !noTx ? html`<div class="meter ${p.state === 'behind' || p.state === 'missed' ? 'over' : ''}" style="margin-top:8px" role="img" aria-label="${Math.round((p.pct || 0) * 100)}% of the minimum spend"><div style="width:${raw(String(Math.round((p.pct || 0) * 100)))}%"></div></div>` : ''}
        <div class="tiny muted" style="margin-top:4px">${p.spent === null ? 'Card not in the app, so spend can’t be checked' : noTx ? 'The sheet says the bonus was earned; this card’s transactions aren’t in the app yet' : `${money0(p.spent)} spent in the app${p.need ? ` · ${money0(p.need)} to go` : ''}`}${p.source === 'credit report' ? ' · found on the credit report, not in the sheet' : ''}</div></div>
        <div class="right"><span class="pill ${tone}">${lbl}</span>${p.days_left !== null && p.days_left >= 0 && p.state !== 'met' ? html`<div class="tiny muted" style="margin-top:4px">${p.days_left} days left</div>` : ''}</div></div>`;
    })}</div>`);
  }

  function drawFees() {
    const el = $('#ch-fees', root);
    const list = d.fees.filter((f) => f.next && f.days !== null && f.days <= 366);
    if (!list.length) { F.setHTML(el, F.empty('No annual fees on file')); return; }
    const total = list.reduce((s, f) => s + (f.fee || 0), 0);
    F.setHTML(el, html`<div class="list">${list.map((f) => html`<div class="list-item ${f.days <= 30 ? 'promo-soon' : ''}"><div class="dnum">${f.next.slice(5, 7)}.${f.next.slice(8, 10)}<div class="tiny muted" style="font-family:var(--font);font-weight:500">${f.next.slice(0, 4)}</div></div>
      <div class="main-col"><div class="title">${f.account_id ? raw(`<a href="#/accounts/${encodeURIComponent(f.account_id)}">${F.esc(f.card)}</a>`) : f.card}</div>
        <div class="meta">${both ? short(f.person) + ' · ' : ''}opened ${ym(f.opened)} · ${f.days === 0 ? 'today' : `in ${f.days} days`}${f.source !== 'card details' ? ' · from the sheet' : ''}</div></div>
      <span class="num key">${money0(f.fee)}</span></div>`)}
      <div class="list-item"><div class="main-col"><div class="title muted">Next 12 months</div></div><span class="num key">${money0(total)}</span></div></div>
      <p class="caption" style="padding:0 0 4px">The fee posts on the statement after the account’s anniversary; that’s the time to ask for a retention offer or a no-fee downgrade.</p>`);
  }

  function drawTimeline() {
    const el = $('#ch-timeline', root);
    const start = range === 'all' ? (d.timeline[0] ? d.timeline[0].date.slice(0, 4) + '-01-01' : today) : `${+today.slice(0, 4) - 3}-${today.slice(5, 7)}-01`;
    const evs = d.timeline.filter((e) => e.date >= start);
    if (!evs.length) { F.setHTML(el, F.empty('Nothing in this range')); return; }
    const t0 = Date.parse(start + 'T12:00:00Z'), t1 = Date.parse(today + 'T12:00:00Z');
    const pos = (s) => Math.max(0, Math.min(100, ((Date.parse(s.slice(0, 10) + 'T12:00:00Z') - t0) / (t1 - t0)) * 100));
    const y0 = +start.slice(0, 4), y1 = +today.slice(0, 4);
    const narrow = window.innerWidth <= 760;
    const step = (y1 - y0) > (narrow ? 6 : 12) ? (narrow ? 4 : 2) : 1;
    const years = []; for (let y = y0 + (start.slice(5) === '01-01' ? 0 : 1); y <= y1; y += step) years.push(y);
    const LANES = [['apps', 'Applications', 'sheet'], ['inquiries', 'Hard inquiries', 'Credit Karma'], ['opened', 'New accounts', 'Credit Karma']];
    const rows = [];
    for (const p of people) {
      for (const [lane, l, src] of LANES) {
        const list = evs.filter((e) => e.person === p && e.lane === lane);
        if (lane !== 'apps' && !list.length && !d.has.report) continue;
        rows.push(html`<div class="g-row ch-lane" role="listitem"><div class="g-lbl"><span class="ellipsis">${l}</span><span class="tiny muted">${both ? short(p) + ' · ' : ''}${src} · ${list.length}</span></div>
          <div class="g-track">${years.map((y) => html`<i class="g-grid" style="left:${raw(pos(y + '-01-01').toFixed(2))}%"></i>`)}
            ${list.map((e) => html`<i class="ch-ev ${e.lane} ${e.tone}" style="left:${raw(pos(e.date).toFixed(2))}%" title="${fmt.date(e.date, { year: true })} · ${e.label}" ${e.app_id ? raw(`data-app="${F.esc(e.app_id)}" tabindex="0" role="button"`) : ''}></i>`)}</div></div>`);
      }
    }
    F.setHTML(el, html`<div class="gantt ch-tl" role="list">
      <div class="g-axis" aria-hidden="true"><div class="g-lbl"></div><div class="g-track">${years.map((y) => html`<span style="left:${raw(pos(y + '-01-01').toFixed(2))}%">${y}</span>`)}</div></div>
      ${rows}</div>
      <div class="legend"><span><i class="ch-key approved"></i>Approved</span><span><i class="ch-key declined"></i>Declined</span><span><i class="ch-key conflict"></i>Conflicts with a report</span>
        <span><i class="ch-key inquiry"></i>Inquiry</span><span><i class="ch-key matched"></i>New account in the sheet</span><span><i class="ch-key unmatched"></i>Not in the sheet</span></div>`);
  }

  function draw524() {
    const el = $('#ch-524', root);
    F.setHTML(el, html`${people.map((p) => {
      const f = d.five24[p];
      if (!f) return '';
      return html`<div class="ch-524"><div class="ch-524-head"><b>${short(p)}</b><span class="pill ${f.count >= 5 ? 'crit' : f.count === 4 ? 'warn' : 'good'}">${f.count}/24</span>
        ${f.count >= 5 ? html`<span class="small muted">a slot opens ${ym(f.slot_opens)}</span>` : ''}</div>
        ${f.cards.length ? html`<div class="list">${f.cards.map((x) => html`<div class="list-item"><div class="main-col"><div class="title">${x.account_id ? raw(`<a href="#/accounts/${encodeURIComponent(x.account_id)}">${F.esc(x.name)}</a>`) : x.name}</div>
          <div class="meta">${x.issuer}${x.au ? ' · authorized user' : ''}${x.in_sheet ? '' : ' · not in the sheet'}${x.source === 'sheet' ? ' · sheet only' : ''}</div></div>
          <div class="right small"><div>${ym(x.opened)}</div><div class="tiny muted">drops ${ym(x.drops)}</div></div></div>`)}</div>` : F.empty('None in the last 24 months')}
        ${f.has_report ? '' : html`<p class="caption">No credit report on file, so only the sheet counts.</p>`}</div>`;
    })}<p class="caption" style="padding:8px 0 4px">Counts every personal card on the report, store and authorized-user cards included; most business cards don’t report, so they don’t count.</p>`);
  }

  function drawXref() {
    const el = $('#ch-xref', root);
    const conf = d.crossref.conflicts;
    const gaps = d.crossref.gaps;
    F.setHTML(el, html`${conf.length ? html`<div class="list">${conf.map((x) => html`<div class="list-item clickable" tabindex="0" data-app="${x.app_id}"><div class="main-col">
        <div class="title">${x.card}${both ? html` <span class="muted">· ${short(x.person)}</span>` : ''}</div><div class="meta wrap">${ym(x.date)} · ${x.detail}</div></div></div>`)}</div>`
      : F.empty('No conflicts', 'Everything that can be checked agrees.')}
      ${gaps.length ? html`<details class="disclosure" style="margin-top:8px"><summary><span class="label">On a report, not in the sheet</span> <span class="small muted">${gaps.length} cards</span></summary>
        <div class="list">${gaps.map((g) => html`<div class="list-item"><div class="main-col"><div class="title">${g.name}${both ? html` <span class="muted">· ${short(g.person)}</span>` : ''}</div>
          <div class="meta">Opened ${ym(g.opened)}${g.closed ? ` · closed ${ym(g.closed)}` : ' · open'}${g.limit ? ` · ${money0(g.limit)} limit` : ''}</div></div></div>`)}</div></details>` : ''}`);
  }

  function drawApps() {
    const el = $('#ch-apps', root);
    const list = d.apps.filter((a) => appFilter === 'all' || (appFilter === 'declined' ? /declined/i.test(a.status || '') : appFilter === 'open' ? /^(open|product change)$/i.test(a.status || '') && !a.ck_closed : !/declined/i.test(a.status || '')));
    if (!list.length) { F.setHTML(el, F.empty('No applications')); return; }
    const shown = appsAll ? list : list.slice(0, 25);
    F.setHTML(el, html`<div class="table-wrap"><table class="t ch-apps"><thead><tr><th>Card</th>${both ? html`<th>Who</th>` : ''}<th>Date</th><th>Status</th><th class="num">Bonus</th><th class="num hide-sm">Min. spend</th><th>Check</th></tr></thead>
      <tbody>${shown.map((a) => html`<tr class="clickable" tabindex="0" data-app="${a.app_id}">
        <td><div class="ellipsis"><b>${a.account_label || a.card}</b></div><div class="tiny muted ellipsis">${a.issuer}${a.last4 ? ' · ' + a.last4 : ''}${a.business ? ' · business' : ''}</div></td>
        ${both ? html`<td data-label="Who">${short(a.person)}</td>` : ''}<td data-label="Date" class="nowrap">${ym(a.date)}</td>
        <td data-label=""><span class="pill ${/declined/i.test(a.status || '') ? 'neutral' : /open|product/i.test(a.status || '') ? 'info' : 'neutral'}">${a.status || '—'}</span></td>
        <td class="num" data-label="Bonus">${a.bonus_points ? fmt.num(a.bonus_points) : a.bonus || '—'}${a.bonus_earned ? html` <span class="pos" title="Bonus earned per the sheet">✓</span>` : ''}</td>
        <td class="num hide-sm">${a.min_spend ? money0(a.min_spend) : '—'}</td>
        <td data-label="">${xpill(a.crossref)}</td></tr>`)}</tbody></table></div>
      ${list.length > 25 ? html`<button type="button" class="btn sm ghost" data-apps-all style="margin:8px 0">${appsAll ? 'Show the newest 25' : `Show all ${list.length}`}</button>` : ''}`);
    const b = $('[data-apps-all]', el); if (b) b.onclick = () => { appsAll = !appsAll; drawApps(); };
  }

  function drawMs() {
    const el = $('#ch-ms', root);
    const ms = d.ms;
    if (!ms.n && !ms.tax.length) { F.setHTML(el, F.empty('No manufactured spending logged')); return; }
    const years = ms.by_year.map((y) => ({ label: y.key, value: y.amount, key: y.key, n: y.n }));
    const methods = ms.by_method.filter((m) => m.amount > 0).map((m) => ({ label: m.key, value: m.amount, key: m.key, n: m.n }));
    F.setHTML(el, html`<div class="grid-2">
        <div><h3 class="h-sub">By year</h3>${F.hbars(years, { sub: (i) => `${i.n}` })}</div>
        <div><h3 class="h-sub">By method</h3>${F.hbars(methods, { sub: (i) => `${i.n}` })}</div></div>
      <p class="caption">${both ? `${money0(ms.household)} on Roque’s and Jenny’s cards, ${money0(ms.family)} on family members’ cards. ` : ''}${ms.corroborated} entries are matched to a deposit or charge in the app; the rest predate the app’s history.</p>
      ${ms.tax.length ? html`<h3 class="h-sub" style="margin-top:16px">Taxes paid by card</h3><div class="list">${ms.tax.map((t) => html`<div class="list-item ${t.txn_id ? 'clickable' : ''}" ${t.txn_id ? raw(`data-txn="${F.esc(t.txn_id)}" tabindex="0"`) : ''}>
          <div class="main-col"><div class="title">${t.card}</div><div class="meta wrap">${ym(t.date)} · ${t.txn_id ? 'the charge is in the app (tap to open it)' : 'this card’s transactions for that date aren’t in the app'}</div></div><span class="num key">${money0(t.amount)}</span></div>`)}</div>` : ''}
      ${ms.candidates.length ? html`<div class="callout warn" style="margin-top:16px">${F.icon('info')}<div><b>${ms.candidates.length} charges look like gift-card purchases</b> during a sign-up bonus window.
          They are still counted as spending; open one to re-tag it if it was manufactured spend.
          <div class="list" style="margin-top:6px">${ms.candidates.map((t) => html`<div class="list-item clickable" data-txn="${t.txn_id}" tabindex="0"><div class="main-col"><div class="title">${t.card}</div><div class="meta">${ym(t.date)} · ${t.notes || ''}</div></div><span class="num">${money0(t.amount)}</span></div>`)}</div></div></div>` : ''}
      ${ms.cashouts.length || ms.linked.length ? html`<details class="disclosure" style="margin-top:12px"><summary><span class="label">Matched in the app</span> <span class="small muted">${new Set([...ms.linked, ...ms.cashouts].map((x) => x.txn_id)).size} transactions tagged Transfer · Manufactured spending</span></summary>
        <div class="list">${[...new Map([...ms.linked, ...ms.cashouts].filter((x) => !/tax/i.test(x.method || '')).map((x) => [x.txn_id, x])).values()].map((t) => html`<div class="list-item clickable" data-txn="${t.txn_id}" tabindex="0"><div class="main-col"><div class="title">${t.method}${t.card ? ' · ' + t.card : ''}</div><div class="meta wrap">${ym(t.date)} · ${t.detail || ''}</div></div><span class="num">${money0(t.amount)}</span></div>`)}</div></details>` : ''}`);
    $$('[data-txn]', el).forEach((x) => x.addEventListener('keydown', (e) => { if (e.key === 'Enter') F.openTxn(x.dataset.txn); }));
  }

  function drawBank() {
    const el = $('#ch-bank', root);
    const list = d.bank.rows.filter((b) => b.household || !both);
    if (!list.length) { F.setHTML(el, F.empty('No bank bonuses logged')); return; }
    const showB = bankAll ? list : list.slice(0, 8);
    F.setHTML(el, html`<div class="list">${showB.map((b) => html`<div class="list-item"><div class="main-col"><div class="title">${b.bank}${both ? html` <span class="muted">· ${short(b.person)}</span>` : ''}</div>
        <div class="meta wrap">${ym(b.applied)}${b.account_type ? ' · ' + b.account_type : ''} · ${b.status || ''}${b.crossref === 'corroborated' ? ' · transfers found in the app' : ''}</div></div>
        <div class="right"><div class="num key">${money0(b.amount)}</div><div class="tiny ${/^yes$/i.test(b.received || '') ? 'pos' : 'muted'}">${/^yes$/i.test(b.received || '') ? 'Received' : /pending/i.test(b.received || '') ? 'Pending' : 'Not received'}</div></div></div>`)}</div>
      ${list.length > 8 ? html`<button type="button" class="btn sm ghost" data-bank-all style="margin:8px 0">${bankAll ? 'Show the newest 8' : `Show all ${list.length}`}</button>` : ''}`);
    const bb = $('[data-bank-all]', el); if (bb) bb.onclick = () => { bankAll = !bankAll; drawBank(); };
  }

  function openApp(id) {
    const a = d.apps.find((x) => x.app_id === id);
    if (!a) return;
    const kv = (k, v) => (v === null || v === undefined || v === '' ? '' : html`<dt>${k}</dt><dd>${v}</dd>`);
    const checks = (a.crossref_detail || '').split('; ').filter(Boolean);
    F.drawer((el, close) => {
      F.setHTML(el, html`<div class="drawer-head"><div style="flex:1;min-width:0"><div class="small muted">${short(a.person)} · ${a.issuer}${a.reward_program ? ' · ' + a.reward_program : ''}</div>
          <h2 style="margin-top:4px">${a.card}</h2><div class="row wrap small" style="margin-top:6px"><span class="pill neutral">${a.status || '—'}</span>${xpill(a.crossref)}
          ${a.account_id ? raw(`<a href="#/accounts/${encodeURIComponent(a.account_id)}">Open in Accounts</a>`) : ''}</div></div>
          <button class="icon-btn" data-x aria-label="Close">${F.icon('x')}</button></div>
        <div class="drawer-body">
          <section><h3>From the sheet</h3><dl class="kv">${kv('Applied', ym(a.applied))}${kv('Approved', a.approved ? ym(a.approved) : '')}${kv('Last 4', a.last4)}${kv('Credit limit', a.credit_limit ? money0(a.credit_limit) : '')}
            ${kv('Sign-up bonus', a.bonus)}${kv('Minimum spend', a.min_spend_text || (a.min_spend ? money0(a.min_spend) : ''))}${kv('Spend deadline', a.deadline ? ym(a.deadline) + (a.deadline_estimated ? ' (90 days, estimated)' : '') : '')}
            ${kv('Bonus earned', a.bonus_earned === null ? '' : a.bonus_earned ? 'Yes' + (a.bonus_earned_date ? ' · ' + ym(a.bonus_earned_date) : '') : 'No')}${kv('Annual fee', a.annual_fee ? money0(a.annual_fee) : '')}
            ${kv('Closed', a.closed ? ym(a.closed) : '')}${kv('Downgraded', a.downgraded ? ym(a.downgraded) : '')}${kv('Product change', a.pc_card)}</dl></section>
          <section><h3>Check</h3>${checks.length ? html`<ul class="small ch-checks">${checks.map((x) => html`<li class="${x.startsWith('CONFLICT') ? 'alert-text' : ''}">${x.replace(/^CONFLICT: /, 'Conflict: ')}</li>`)}</ul>` : html`<p class="small muted">Nothing to check against.</p>`}</section>
          ${a.notes ? html`<section><h3>Notes</h3><p class="small ink2" style="white-space:pre-line">${a.notes.replace(/ \/ /g, '\n')}</p></section>` : ''}
          <p class="tiny muted">${a.source.replace(/^drive:/, 'Google Drive · ')}</p>
        </div>`);
      $('[data-x]', el).onclick = close;
    }, { label: a.card });
  }
};
