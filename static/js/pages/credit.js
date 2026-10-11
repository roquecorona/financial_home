/* 08 Credit — scores over time, what drives them, every account on the reports, inquiries and what to do next.
   Data: GET /api/credit (js/api/credit.js) over the credit_* tables the laptop fills from Credit Karma and bureau
   reports, plus the app's own card balances and Jenny's sheet for utilization. Read-only. */
'use strict';
F.pages.credit = async (root, r, ctl) => {
  const { html, raw, fmt, icon, $, $$ } = F;
  const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  const p = Object.assign({ person: lsGet('fin.credit.person', '') }, r.params);
  const person = ['Roque', 'Jennifer'].includes(p.person) ? p.person : '';
  const d = await F.get('/api/credit', { person });
  if (!ctl.alive()) return;
  const short = (x) => (x === 'Jennifer' ? 'Jenny' : x);
  const both = !person;
  const people = both ? d.people : [person];
  const today = d.as_of;
  let tlMode = lsGet('fin.credit.tl', 'all');
  let tlAll = false;
  const yrs = (m) => (m === null || m === undefined ? '—' : (m / 12).toFixed(1));
  const ym = (s) => (s ? (s.length >= 10 ? fmt.date(s, { year: true }) : s.length === 7 ? `${s.slice(5, 7)}.${s.slice(0, 4)}` : s) : '—');
  const pctTxt = (v, dgt = 0) => (v === null || v === undefined ? '—' : fmt.pct(v, dgt));
  const BUREAU_SHORT = { TransUnion: 'TU', Equifax: 'EQ', Experian: 'EX' };
  const RATING = { EXCELLENT: ['Excellent', 'good'], VERY_GOOD: ['Very good', 'good'], GOOD: ['Good', 'good'], FAIR: ['Fair', 'warn'], POOR: ['Poor', 'crit'], NEEDS_WORK: ['Needs work', 'crit'], VERY_POOR: ['Very poor', 'crit'] };
  const band = (score, model) => {
    const v = /vantage/i.test(model || '');
    const cuts = v ? [[781, 'Excellent'], [661, 'Good'], [601, 'Fair'], [500, 'Poor'], [0, 'Very poor']] : [[800, 'Exceptional'], [740, 'Very good'], [670, 'Good'], [580, 'Fair'], [0, 'Poor']];
    return cuts.find(([c]) => score >= c)[1];
  };
  const seriesColor = (i) => F.css(`--s${(i % 8) + 1}`);
  const seriesVar = (i) => `var(--s${(i % 8) + 1})`;
  const setPerson = (x) => { lsSet('fin.credit.person', x); F.go('#/credit' + (x ? '?person=' + x : '')); };
  const hasReport = d.has.accounts || d.has.scores;

  // ---------- KPI band
  const kpis = [];
  for (const c of d.current.slice(0, both ? 4 : 3)) {
    const ch = c.change;
    const sub = html`${band(c.score, c.model)} · ${c.model || 'Score'} · ${ym(c.date)}${ch !== null ? html` · <span class="delta ${ch > 0 ? 'good' : ch < 0 ? 'bad' : 'flat'}">${ch > 0 ? '↑' : ch < 0 ? '↓' : ''}${Math.abs(ch)}</span> since ${ym(c.prev_date)}` : ''}`;
    kpis.push(F.kpi(both ? `${short(c.person)} · ${c.bureau}` : c.bureau, html`<span class="fig">${c.score}</span>`, sub));
  }
  const uNow = d.utilization.current;
  const uCur = both ? uNow.overall : uNow.by_person[person];
  kpis.push(F.kpi('Card utilization', uCur && uCur.pct !== null ? pctTxt(uCur.pct, uCur.pct < 0.1 ? 1 : 0) : '—',
    uCur && uCur.limit ? `${fmt.money(uCur.balance, { cents: false })} of ${fmt.money(uCur.limit, { compact: true })} · today` : 'Needs card limits', { vcls: uCur && uCur.pct !== null && uCur.pct < 0.1 ? 'accent' : '' }));
  if (!both) {
    const s = d.summary[person];
    kpis.push(F.kpi('Average age', s.has_bureau ? `${yrs(s.avg_age_open_months)} yrs` : '—', s.has_bureau ? `Open accounts · ${yrs(s.avg_age_months)} yrs all` : 'Needs a report'));
    if (kpis.length < 6) kpis.push(F.kpi('Hard inquiries', s.has_bureau ? String(s.inquiries_12m) : '—', s.has_bureau ? `12 months · ${s.inquiries_24m} in 24` : 'Needs a report'));
  }

  // ---------- add-data guide (empty states and the Reports section)
  const howTo = html`<ol class="steps small">
      <li><b>Credit Karma</b> (TransUnion, Equifax, free): sign in at creditkarma.com in Chrome and ask Claude to “update my credit” — it reads the scores, accounts and inquiries (read-only). Or open Credit → a bureau → Credit report → Print, save as PDF.</li>
      <li><b>AnnualCreditReport.com</b> (all three bureaus, free weekly): request each report, download the PDF.</li>
      <li>Put the files in <b>raw/credit/roque</b> or <b>raw/credit/jennifer</b> in the Finances folder (or send them to Claude from a phone), then run <b>import_credit_report.py</b> and <b>cloud_sync.py push</b>.</li></ol>`;

  if (!hasReport && !d.has.factors) {
    F.setHTML(root, html`${head()}
      <div class="grid">
        <section class="span-7">${F.secHead('No credit reports yet')}${F.empty(both ? 'Add a report for Roque or Jenny' : `Add a report for ${short(person)}`,
          html`Scores, factors, the full account history and inquiries come from credit reports. Utilization below uses the cards in the app.${howTo}`)}</section>
        <section class="panel span-5" id="cr-util-mini"></section></div>`);
    bindHead();
    utilSection($('#cr-util-mini', root), true);
    return;
  }

  F.setHTML(root, html`
    ${head()}
    <section class="band" style="--n:${kpis.length}" aria-label="Scores">${kpis}</section>
    ${d.has.by_person && people.some((x) => !d.has.by_person[x].report) ? html`<div class="callout" style="margin-top:16px">${icon('info')}<div>No credit report on file for ${people.filter((x) => !d.has.by_person[x].report).map(short).join(' and ')} yet. ${raw('<a href="#cr-reports">How to add one</a>')}.</div></div>` : ''}
    <div class="grid">
      <div class="span-8 stack">
      <section class="panel"><div class="panel-head"><h2>Score history</h2><span class="sub">${d.scores.length} score${d.scores.length === 1 ? '' : 's'} on file · ${[...new Set(d.scores.map((s) => s.model))].join(', ') || 'none yet'}</span></div>
        <div class="panel-body">${d.scores.length ? html`<div class="chart h-260" id="cr-score-chart"></div><div id="cr-score-legend"></div>
          ${new Set(d.scores.map((s) => s.date)).size < 2 ? html`<p class="caption">One date so far. Each new report or Credit Karma check adds a point, so the line builds from here.</p>` : ''}` : F.empty('No scores yet', 'Scores come with each report.')}</div></section>
      <section class="panel"><div class="panel-head"><h2>Credit factors</h2><span class="sub">${d.factors.some((f) => !f.estimated) ? 'Credit Karma’s ratings; “est.” = estimated from the report' : 'Estimated from the report, Credit Karma style'}</span></div>
        <div class="panel-body flush">${factorTable()}</div></section>
      </div>
      <section class="panel span-4"><div class="panel-head"><h2>Improve your score</h2><span class="sub">Computed from the reports and today’s balances</span></div>
        <div class="panel-body flush" id="cr-actions"></div></section>
      <section class="panel span-12" id="cr-util"></section>
      <section class="panel span-12"><div class="panel-head"><h2>Account history</h2><span class="sub">${ageLine()}</span>
        <div class="tools"><div class="seg sm" role="group" aria-label="Accounts shown"><button type="button" data-tl="all" aria-pressed="${String(tlMode === 'all')}">All</button><button type="button" data-tl="open" aria-pressed="${String(tlMode === 'open')}">Open</button></div></div></div>
        <div class="panel-body" id="cr-timeline"></div></section>
      <section class="panel span-12"><div class="panel-head"><h2>Open accounts</h2><span class="sub">As the bureaus last reported them · tap a row for payment history</span></div>
        <div class="panel-body flush">${acctTable(d.accounts.filter((a) => a.status === 'open'), 'open')}</div></section>
      <section class="panel span-12"><details class="disclosure"><summary><span class="label">Closed accounts</span> <span class="small muted">${d.accounts.filter((a) => a.status === 'closed').length} · they stay on a report up to 10 years and still count toward age</span></summary>
        <div class="panel-body flush">${acctTable(d.accounts.filter((a) => a.status === 'closed'), 'closed')}</div></details></section>
      <section class="panel span-6"><div class="panel-head"><h2>Hard inquiries</h2><span class="sub">Last 24 months · FICO counts them for 12, reports show them for 24</span></div>
        <div class="panel-body flush">${inquiryList()}</div></section>
      <section class="panel span-6" id="cr-reports"><div class="panel-head"><h2>Reports on file</h2><span class="sub">Where these numbers come from</span></div>
        <div class="panel-body flush">${reportList()}<details class="disclosure" style="margin-top:12px"><summary class="small">How to add or refresh a report</summary><div class="panel-body" style="padding-top:4px">${howTo}</div></details></div></section>
    </div>`);
  bindHead();
  drawScores();
  drawActions();
  utilSection($('#cr-util', root), false);
  drawTimeline();
  $$('[data-tl]', root).forEach((b) => (b.onclick = () => { tlMode = b.dataset.tl; lsSet('fin.credit.tl', tlMode); $$('[data-tl]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawTimeline(); }));
  root.addEventListener('click', (e) => {
    const row = e.target.closest('[data-acct]');
    if (row && !e.target.closest('a')) openAccount(row.dataset.acct);
  });
  root.addEventListener('keydown', (e) => {
    const row = e.target.closest('[data-acct]');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openAccount(row.dataset.acct); }
  });

  // ---------- pieces
  function head() {
    return F.head({ title: 'Credit', lede: 'Scores over time, what moves them and every account on the credit reports — with the next steps that help most.',
      actions: html`<div class="seg" role="group" aria-label="Person">${[['', 'Both'], ['Roque', 'Roque'], ['Jennifer', 'Jenny']].map(([k, l]) => html`<button type="button" data-person="${k}" aria-pressed="${String(person === k)}">${l}</button>`)}</div>` });
  }
  function bindHead() { $$('[data-person]', root).forEach((b) => (b.onclick = () => setPerson(b.dataset.person))); }

  function ageLine() {
    return people.filter((x) => d.summary[x].has_bureau).map((x) => {
      const s = d.summary[x];
      return `${both ? short(x) + ': ' : ''}average age ${yrs(s.avg_age_months)} yrs (open ${yrs(s.avg_age_open_months)}) · ${s.open} open, ${s.closed} closed · oldest ${ym(s.oldest)}`;
    }).join('  ·  ') || 'Accounts from the app until a report is added';
  }

  function drawScores() {
    const el = $('#cr-score-chart', root);
    if (!el || !F.hasCharts) return;
    const dates = [...new Set(d.scores.map((s) => s.date))].sort();
    const keys = [...new Set(d.scores.map((s) => [s.person, s.bureau, s.model].join('|')))];
    const vals = d.scores.map((s) => s.score);
    const lo = Math.max(300, Math.floor((Math.min(...vals) - 30) / 10) * 10), hi = Math.min(850, Math.ceil((Math.max(...vals) + 30) / 10) * 10);
    const ds = keys.map((k, i) => {
      const [pp, b, m] = k.split('|');
      const label = `${both ? short(pp) + ' · ' : ''}${b}${new Set(d.scores.map((s) => s.model)).size > 1 ? ' · ' + m : ''}`;
      return F.lineDs(label, dates.map((dt) => { const s = d.scores.find((x) => x.date === dt && [x.person, x.bureau, x.model].join('|') === k); return s ? s.score : null; }), seriesColor(i),
        { pointRadius: 4, pointHoverRadius: 6, borderDash: pp === 'Jennifer' && both ? [6, 4] : undefined });
    });
    const opts = F.chartOpts({ money: false, yMin: lo, tooltipTitle: (items) => items.length ? fmt.date(dates[items[0].dataIndex], { year: true }) : '' });
    opts.scales.y.max = hi; opts.scales.y.ticks.callback = (v) => v;
    opts.plugins.tooltip.callbacks.label = (ctx) => (ctx.parsed.y === null ? null : ` ${ctx.dataset.label}  ${ctx.parsed.y}`);
    opts.scales.x.offset = true;
    F.chart(el, { type: 'line', data: { labels: dates.map((x) => fmt.date(x, { year: true })), datasets: ds }, options: opts, aria: 'Credit scores by date' });
    F.setHTML($('#cr-score-legend', root), F.legend(ds.map((x, i) => ({ label: x.label, color: seriesColor(i), type: x.borderDash ? 'dash' : 'line' }))));
  }

  function drawActions() {
    const el = $('#cr-actions', root);
    const list = d.actions;
    let all = false;
    const draw = () => {
      const show = all ? list : list.slice(0, 5);
      F.setHTML(el, list.length ? html`<ol class="cr-actions">${show.map((a) => html`<li class="${a.tone}"><b>${a.title}</b><p>${a.detail}</p>${a.account ? html`<button type="button" class="linkbtn" data-acct="${a.account}">See the account</button>` : ''}</li>`)}</ol>
        ${list.length > 5 ? html`<button type="button" class="btn sm ghost" data-more-actions>${all ? 'Show fewer' : `Show all ${list.length}`}</button>` : ''}`
        : F.empty('Nothing to fix right now', 'No late payments, cards are under 30% and inquiries are few. Keep paying in full and on time.'));
      const b = $('[data-more-actions]', el); if (b) b.onclick = () => { all = !all; draw(); };
    };
    draw();
  }

  function factorTable() {
    if (!d.factors.length) return F.empty('No factors yet', 'They come with a report or a Credit Karma check.');
    const keys = [...new Set(d.factors.map((f) => f.factor))];
    const cols = people.filter((x) => d.factors.some((f) => f.person === x));
    const val = (f) => {
      if (f.value === null || f.value === undefined) return '';
      if (f.value_kind === 'pct') return pctTxt(f.value, f.factor === 'PAYMENT_HISTORY' && f.value < 1 ? 1 : 0);
      if (f.value_kind === 'months') return `${yrs(f.value)} yrs`;
      return fmt.num(f.value);
    };
    const cell = (f) => {
      if (!f) return html`<span class="muted">—</span>`;
      const [lbl, tone] = RATING[f.rating] || [fmt.label(String(f.rating || '').toLowerCase()), 'neutral'];
      return html`<span class="cr-fval"><b>${val(f)}</b> <span class="pill ${tone}" title="${f.estimated ? 'Estimated from the report with Credit Karma’s grading' : `Credit Karma, ${f.date}${f.model ? ' · ' + f.model : ''}`}">${lbl}${f.estimated ? ' · est.' : ''}</span></span>`;
    };
    return html`<div class="table-wrap"><table class="t cr-factors"><thead><tr><th>Factor</th>${cols.map((c) => html`<th>${cols.length > 1 ? short(c) : 'Now'}</th>`)}</tr></thead><tbody>
      ${keys.map((k) => {
        const any = d.factors.find((f) => f.factor === k);
        return html`<tr><td><div>${any.label}</div><div class="tiny muted">${any.impact} impact</div></td>${cols.map((c) => html`<td data-label="${cols.length > 1 ? short(c) : ''}">${cell(d.factors.find((f) => f.factor === k && f.person === c))}</td>`)}</tr>`;
      })}</tbody></table></div>`;
  }

  function utilSection(el, mini) {
    const u = d.utilization;
    const cards = u.cards;
    const hist = u.history.slice(-36);
    const meter = (v) => html`<div class="meter ${v >= 0.3 ? 'over' : ''}" role="img" aria-label="${pctTxt(v)} used"><div style="width:${raw(String(Math.min(100, Math.round((v || 0) * 100))))}%"></div></div>`;
    const spark = (c) => (c.trend && c.trend.length > 1 ? F.spark(c.trend.map((t) => t.pct), { color: c.pct >= 0.3 ? 'var(--alert)' : 'var(--ink)', w: 84, h: 22 }) : '');
    const personal = cards.filter((c) => !c.business), biz = cards.filter((c) => c.business);
    const row = (c) => html`<tr class="${c.business ? 'muted' : ''}"><td><div class="ellipsis">${c.label}</div>${both ? html`<div class="tiny muted">${short(c.holder)}</div>` : ''}</td>
      <td class="num" data-label="Owed">${c.balance === null ? '—' : fmt.amt(c.balance, { cents: false })}</td><td class="num" data-label="Limit">${c.limit ? fmt.amt(c.limit, { cents: false }) : '—'}</td>
      <td class="key num">${c.pct === null ? '—' : pctTxt(c.pct, c.pct < 0.1 && c.pct > 0 ? 1 : 0)}</td><td class="hide-sm" style="width:120px">${c.pct === null ? '' : meter(c.pct)}</td><td class="hide-sm right">${spark(c)}</td></tr>`;
    F.setHTML(el, html`<div class="panel-head"><h2>Utilization</h2><span class="sub">Card balances ÷ limits. Today from the bank sync; the trend from statement balances on Jenny’s sheet${biz.length ? '; business cards don’t count' : ''}</span></div>
      <div class="panel-body">${hist.length > 1 ? html`<div class="chart ${mini ? 'h-220' : 'h-220'}" id="cr-util-chart"></div><div id="cr-util-legend"></div>` : ''}
        ${!cards.length ? F.empty('No cards with balances yet') : html`<div class="table-wrap" style="margin-top:14px"><table class="t"><thead><tr><th>Card</th><th class="num">Owed</th><th class="num">Limit</th><th class="num">Used</th><th class="hide-sm"></th><th class="hide-sm right">12 months</th></tr></thead>
          <tbody>${personal.map(row)}${biz.length ? html`<tr class="cr-sep"><td colspan="6" class="tiny muted">Business cards · not on personal credit reports</td></tr>${biz.map(row)}` : ''}</tbody></table></div>`}</div>`);
    const ch = $('#cr-util-chart', el);
    if (ch && F.hasCharts) {
      const labels = hist.map((h) => h.month);
      const ds = [];
      const ppl = people.filter((x) => hist.some((h) => h[x] !== undefined && h[x] !== null));
      ppl.forEach((x, i) => ds.push(F.lineDs(short(x), hist.map((h) => h[x] ?? null), seriesColor(i), { borderDash: x === 'Jennifer' && both ? [6, 4] : undefined })));
      const ref = (v, lbl) => F.lineDs(lbl, labels.map(() => v), F.css('--faint'), { borderWidth: 1, borderDash: [2, 3], pointRadius: 0, pointHoverRadius: 0 });
      ds.push(ref(0.3, '30%'), ref(0.1, '10%'));
      const opts = F.chartOpts({ money: false, beginAtZero: true, tooltipTitle: (it) => (it.length ? fmt.month(labels[it[0].dataIndex]) : '') });
      opts.scales.y.ticks.callback = (v) => Math.round(v * 100) + '%';
      opts.scales.x.ticks.callback = function (v) { const m = labels[v]; return m && m.endsWith('-01') ? m.slice(0, 4) : (m && hist.length <= 14 ? fmt.month(m, { only: true }) : ''); };
      opts.plugins.tooltip.callbacks.label = (c) => (c.dataset.label.endsWith('%') || c.parsed.y === null ? null : ` ${c.dataset.label}  ${pctTxt(c.parsed.y, 1)}`);
      F.chart(ch, { type: 'line', data: { labels, datasets: ds }, options: opts, aria: 'Card utilization by month' });
      F.setHTML($('#cr-util-legend', el), F.legend([...ppl.map((x, i) => ({ label: short(x), color: seriesColor(i), type: x === 'Jennifer' && both ? 'dash' : 'line' })), { label: '30% and 10% marks', color: F.css('--faint'), type: 'dash' }]));
    }
  }

  function drawTimeline() {
    const el = $('#cr-timeline', root);
    const list = d.accounts.filter((a) => a.opened && (tlMode === 'all' || a.status === 'open'));
    if (!list.length) { F.setHTML(el, F.empty('No accounts with an open date yet')); return; }
    const start = Math.floor(+list[0].opened.slice(0, 4));
    const t0 = Date.UTC(start, 0, 1), t1 = Date.parse(today + 'T12:00:00Z');
    const pos = (s) => { const t = Date.parse((s.length === 7 ? s + '-15' : s.length === 4 ? s + '-07-01' : s.slice(0, 10)) + 'T12:00:00Z'); return Math.max(0, Math.min(100, ((t - t0) / (t1 - t0)) * 100)); };
    const years = [];
    const span = new Date(t1).getUTCFullYear() - start;
    const narrow = window.innerWidth <= 760;
    const step = narrow ? (span > 15 ? 5 : span > 6 ? 2 : 1) : (span > 12 ? 2 : 1);
    for (let y = start; y <= new Date(t1).getUTCFullYear(); y += step) years.push(y);
    const shown = tlAll ? list : list.slice(0, 40);
    const avgOpen = people.map((x) => d.summary[x]).filter((s) => s && s.avg_age_open_months);
    F.setHTML(el, html`<div class="gantt" role="list">
      <div class="g-axis" aria-hidden="true"><div class="g-lbl"></div><div class="g-track">${years.map((y) => html`<span style="left:${raw(pos(String(y) + '-01-01').toFixed(2))}%">${y}</span>`)}</div></div>
      ${shown.map((a) => {
        const l = pos(a.opened), rr = pos(a.end || today);
        const au = a.responsibility === 'authorized user';
        return html`<div class="g-row" role="listitem" tabindex="0" data-acct="${a.key}" aria-label="${a.name}${a.app_label ? ' ' + a.app_label : ''}, opened ${a.opened}${a.status === 'closed' ? ', closed ' + (a.closed || '') : ', open'}">
          <div class="g-lbl"><span class="ellipsis">${a.app_label || a.name}</span><span class="tiny muted">${both ? short(a.person) + ' · ' : ''}${a.kind_label}${au ? ' · AU' : ''}${a.source === 'app' ? ' · app' : ''}</span></div>
          <div class="g-track">${years.map((y) => html`<i class="g-grid" style="left:${raw(pos(String(y) + '-01-01').toFixed(2))}%"></i>`)}
            <div class="g-bar ${a.status} ${au ? 'au' : ''} ${a.derogatory ? 'bad' : ''}" style="left:${raw(l.toFixed(2))}%;width:${raw(Math.max(0.6, rr - l).toFixed(2))}%" title="${a.opened} → ${a.status === 'closed' ? a.closed || 'closed' : 'open'}"></div></div></div>`;
      })}</div>
      <div class="legend"><span><i style="background:var(--ink)"></i>Open</span><span><i style="background:var(--s-other)"></i>Closed</span><span><i style="background:var(--ink);opacity:.45"></i>Authorized user</span><span><i style="background:var(--alert)"></i>Late or derogatory</span>
        ${avgOpen.length ? html`<span class="muted">Ordered by open date</span>` : ''}</div>
      ${list.length > 40 ? html`<button type="button" class="btn sm ghost" data-tl-all style="margin-top:8px">${tlAll ? 'Show the first 40' : `Show all ${list.length}`}</button>` : ''}`);
    const b = $('[data-tl-all]', el); if (b) b.onclick = () => { tlAll = !tlAll; drawTimeline(); };
  }

  function acctTable(list, mode) {
    if (!list.length) return F.empty(mode === 'open' ? 'No open accounts on file' : 'No closed accounts on file');
    return html`<div class="table-wrap"><table class="t cr-accts"><thead><tr><th>Account</th>${both ? html`<th>Who</th>` : ''}<th>Type</th><th>Opened</th>${mode === 'closed' ? html`<th>Closed</th>` : ''}
      <th class="num">${mode === 'open' ? 'Limit' : 'Limit / high'}</th>${mode === 'open' ? html`<th class="num">Balance</th><th class="num">Used</th>` : ''}<th>${mode === 'open' ? 'Status' : 'Remarks'}</th><th class="hide-sm">Bureaus</th></tr></thead>
      <tbody>${list.slice().sort((a, b) => (mode === 'open' ? String(a.opened).localeCompare(String(b.opened)) : String(b.closed || '').localeCompare(String(a.closed || '')))).map((a) => html`<tr class="clickable" tabindex="0" data-acct="${a.key}">
        <td><div class="ellipsis"><b>${a.app_label || a.name}</b></div><div class="tiny muted ellipsis">${subLine(a)}</div></td>
        ${both ? html`<td data-label="Who">${short(a.person)}</td>` : ''}<td data-label="Type">${a.kind_label}</td><td data-label="Opened" class="nowrap">${ym(a.opened)}</td>${mode === 'closed' ? html`<td data-label="Closed" class="nowrap">${ym(a.closed)}</td>` : ''}
        <td class="num" data-label="${a.credit_limit ? 'Limit' : 'Original'}">${a.credit_limit ? fmt.amt(a.credit_limit, { cents: false }) : a.high_balance ? html`<span class="muted" title="Highest balance or original amount">${fmt.amt(a.high_balance, { cents: false })}</span>` : '—'}</td>
        ${mode === 'open' ? html`<td class="num key">${a.balance === null || a.balance === undefined ? '—' : fmt.amt(a.balance, { cents: false })}</td><td class="num ${a.utilization >= 0.3 ? 'alert-text' : ''}" data-label="Used">${a.utilization === null ? '—' : pctTxt(a.utilization)}</td>` : ''}
        <td data-label="">${mode === 'open' ? statusPill(a) : html`<span class="small ink2">${a.remarks || '—'}</span>`}</td><td class="hide-sm small muted">${a.source === 'app' ? 'App only' : a.bureaus.map((b) => BUREAU_SHORT[b] || b).join(' · ')}</td></tr>`)}</tbody></table></div>`;
  }
  function subLine(a) {
    const parts = [];
    if (a.app_label) parts.push(a.name);
    if (a.creditor && !parts.concat([a.app_label || a.name]).some((x) => x && x.toLowerCase() === a.creditor.toLowerCase())) parts.push(a.creditor);
    if (a.responsibility && a.responsibility !== 'individual') parts.push(a.responsibility);
    return parts.join(' · ');
  }
  function statusPill(a) {
    if (a.source === 'app') return html`<span class="pill neutral" title="${a.remarks || ''}">Not on a report</span>`;
    if (/late|past due|delinquen|charge|collection/i.test(a.payment_status || '')) return html`<span class="pill crit">${a.payment_status}</span>`;
    if (a.derogatory) return html`<span class="pill warn" title="Current now; late before">Late in the past</span>`;
    return html`<span class="pill good">${/good standing/i.test(a.payment_status || '') ? 'Current' : a.payment_status || 'Current'}</span>`;
  }

  function inquiryList() {
    const list = d.inquiries.filter((x) => x.active);
    if (!list.length) return F.empty('No hard inquiries in the last 24 months', hasReport ? '' : 'They come with a report.');
    return html`<div class="list">${list.map((x) => html`<div class="list-item"><div class="dnum">${fmt.date(x.date, { year: false })}<div class="tiny muted" style="font-family:var(--font);font-weight:500">${x.date.slice(0, 4)}</div></div>
      <div class="main-col"><div class="title">${x.name}${both ? html` <span class="muted">· ${short(x.person)}</span>` : ''}</div>
        <div class="meta wrap">${x.counts ? `Counts for FICO until ${ym(x.stops_counting)} · ` : 'No longer counts for FICO · '}drops off ${ym(x.drops_off)} (${x.days_to_drop} days)</div></div>
      <span class="small muted nowrap">${x.bureaus.map((b) => BUREAU_SHORT[b] || b).join(' · ')}</span></div>`)}</div>`;
  }

  function reportList() {
    if (!d.reports.length) return F.empty('No reports yet');
    return html`<div class="list">${d.reports.map((rp) => html`<div class="list-item"><div class="main-col"><div class="title">${both ? short(rp.person) + ' · ' : ''}${rp.bureau} · ${rp.source === 'creditkarma' ? 'Credit Karma' : rp.source === 'bureau' ? 'Bureau report' : fmt.label(rp.source)}</div>
      <div class="meta wrap">${ym(rp.report_date)} · ${rp.score ? `${rp.score} ${rp.score_model || ''} · ` : ''}${rp.n_accounts} accounts · ${rp.n_inquiries} inquiries${rp.parsed ? '' : ' · couldn’t be read'}</div></div></div>`)}
      ${d.factors.some((f) => !f.estimated) ? html`<div class="list-item"><div class="main-col"><div class="title">Credit Karma factors</div><div class="meta">${[...new Set(d.factors.filter((f) => !f.estimated).map((f) => `${short(f.person)} ${ym(f.date)}`))].join(' · ')}</div></div></div>` : ''}</div>`;
  }

  function openAccount(key) {
    const a = d.accounts.find((x) => x.key === key);
    if (!a) return;
    const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
    const CELL = { C: ['ok', 'On time'], L: ['late', 'Late'], D: ['derog', 'Derogatory'], U: ['unk', 'No data'], '-': ['none', ''] };
    const grid = a.grid ? Object.keys(a.grid).sort().reverse() : [];
    const kv = (k, v) => (v === null || v === undefined || v === '' ? '' : html`<dt>${k}</dt><dd>${v}</dd>`);
    F.drawer((el, close) => {
      F.setHTML(el, html`<div class="drawer-head"><div style="flex:1;min-width:0"><div class="small muted">${short(a.person)} · ${a.kind_label}${a.bureaus.length ? ' · ' + a.bureaus.join(', ') : ''}</div>
          <h2 style="margin-top:4px">${a.app_label || a.name}</h2><div class="row wrap small" style="margin-top:6px">${a.status === 'open' ? statusPill(a) : html`<span class="pill neutral">Closed ${ym(a.closed)}</span>`}
          ${a.account_id ? html`<a href="#/accounts/${encodeURIComponent(a.account_id)}">Open in Accounts</a>` : ''}</div></div>
          <button class="icon-btn" data-x aria-label="Close">${icon('x')}</button></div>
        <div class="drawer-body">
          <section><h3>Details</h3><dl class="kv">${kv('Reported as', a.creditor)}${kv('Account type', a.account_type)}${kv('Opened', ym(a.opened))}${kv('Closed', a.closed ? ym(a.closed) : '')}${kv('Age', a.age_months !== null ? `${yrs(a.age_months)} years` : '')}
            ${kv('Credit limit', a.credit_limit ? fmt.money(a.credit_limit, { cents: false }) : '')}${kv('Highest balance', a.high_balance ? fmt.money(a.high_balance, { cents: false }) : '')}${kv('Balance', a.balance !== null && a.balance !== undefined ? fmt.money(a.balance, { cents: false }) + (a.as_of ? ` on ${ym(a.as_of)}` : '') : '')}
            ${kv('Utilization', a.utilization !== null ? pctTxt(a.utilization) : '')}${kv('Monthly payment', a.monthly_payment ? fmt.money(a.monthly_payment, { cents: false }) : '')}${kv('Term', a.term_months ? `${a.term_months} months` : '')}
            ${kv('Responsibility', a.responsibility ? fmt.label(a.responsibility) : '')}${kv('Payment status', a.payment_status)}${kv('Worst status', a.worst_status)}${kv('Late 30/60/90', `${a.late.d30}/${a.late.d60}/${a.late.d90}`)}
            ${kv('On time', a.on_time_pct !== null && a.on_time_pct !== undefined ? `${a.on_time_pct}% of payments` : '')}${kv('Last payment', a.last_payment ? ym(a.last_payment) : '')}${kv('Remarks', a.remarks)}</dl></section>
          ${grid.length ? html`<section><h3>Payment history</h3><div class="pgrid" role="table" aria-label="Payment history by month">
              <div class="pg-row pg-head" role="row"><span role="columnheader"></span>${MONTHS.map((m) => html`<span role="columnheader">${m}</span>`)}</div>
              ${grid.map((y) => html`<div class="pg-row" role="row"><span role="rowheader">${y}</span>${[...a.grid[y]].map((c, i) => html`<i role="cell" class="${CELL[c] ? CELL[c][0] : 'none'}" title="${MONTHS[i]} ${y}: ${CELL[c] ? CELL[c][1] : ''}" aria-label="${CELL[c] ? CELL[c][1] || 'No entry' : ''}"></i>`)}</div>`)}</div>
            <div class="legend"><span><i class="pg ok"></i>On time</span><span><i class="pg late"></i>Late</span><span><i class="pg derog"></i>Derogatory</span><span><i class="pg unk"></i>No data</span></div></section>`
            : a.source === 'app' ? html`<section><p class="small ink2">${a.remarks || 'Tracked in the app only.'} It isn’t on a credit report on file${a.remarks && /business/i.test(a.remarks) ? '' : ' yet; it will be matched when the next report lists it'}.</p></section>` : ''}
        </div>`);
      $('[data-x]', el).onclick = close;
    }, { label: a.app_label || a.name });
  }
};
