/* Investments: history, contributions, returns, allocation, holdings, snapshots, forecast & scenarios. */
'use strict';
F.pages.investments = async (root, r, ctl) => {
  const { html, raw, fmt, icon, $, $$ } = F;
  const p = Object.assign({ period: 'all' }, r.params);
  const pFocus = p.focus; delete p.focus;
  const t = F.todayISO(), y = +t.slice(0, 4);
  const PERIODS = [['ytd', 'Year to date'], ['1y', '1 year'], ['3y', '3 years'], ['5y', '5 years'], ['all', 'All'], ['custom', 'Custom']];
  const start = { ytd: `${y}-01-01`, '1y': F.addDays(t, -365), '3y': F.addDays(t, -1095), '5y': F.addDays(t, -1826), all: '', custom: p.start || '' }[p.period] ?? '';
  const end = p.period === 'custom' && p.end ? p.end : t;
  const d = await F.get('/api/investments', { types: p.types, accounts: p.accounts, start, end });
  if (!ctl.alive()) return;
  const setP = (patch) => F.go('#/investments?' + new URLSearchParams(Object.entries({ ...p, ...patch }).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString());
  const types = [...new Set(d.accounts.map((a) => a.type))];
  const selTypes = (p.types || '').split(',').filter(Boolean);
  const selAccts = new Set(d.selected);
  const color = (aid) => { const i = d.accounts.findIndex((a) => a.account_id === aid); return i >= 0 && i < 8 ? F.css(`--s${i + 1}`) : F.css('--s-other'); };
  const colorVar = (aid) => { const i = d.accounts.findIndex((a) => a.account_id === aid); return i >= 0 && i < 8 ? `var(--s${i + 1})` : 'var(--s-other)'; };
  const st = d.stats || {};
  const c = d.contributions;
  const TYPE = (x) => F.typeLabel(x);
  const classColor = { 'US stock': 'var(--s1)', 'Intl stock': 'var(--s3)', Bonds: 'var(--s7)', Cash: 'var(--s4)', 'Real estate': 'var(--s5)', Other: 'var(--s-other)' };
  const classTotal = Object.values(d.allocation.by_class).reduce((s, v) => s + v, 0) || 1;
  const holdings = [...d.holdings].sort((a, b) => (b.market_value || 0) - (a.market_value || 0));
  const periodLabel = st.start_date ? `${fmt.date(F.addDays(st.start_date, 1), { year: true })} – ${fmt.date(st.end_date, { year: true })}` : '';
  const hasCost = holdings.some((h) => h.cost_basis);
  const hasHistory = d.series.filter((m) => !start || m.month >= start.slice(0, 7)).length >= 2;
  const pctOrDash = (v) => (v === null || v === undefined ? '—' : fmt.pct(v, 1, true));

  // ---------- forecast defaults ----------
  const fcDefaults = {
    start: Math.round(d.total_value || 0), monthly: Math.round(c.avg_month_employee || 0), employer: Math.round(c.avg_month_employer || 0), growth: 3,
    ret: 7, vol: 15, infl: 2.5, real: false, horizonYear: y + 25, targetYear: y + 20, target: Math.round(((d.total_value || 0) * 3) / 50000) * 50000 || 1000000, paths: 2000,
  };
  let fc = { ...fcDefaults };
  try { const saved = JSON.parse(localStorage.getItem('fin.fc') || 'null'); if (saved && saved._for === (p.accounts || p.types || 'all')) fc = { ...fcDefaults, ...saved, start: fcDefaults.start }; } catch { /* ignore */ }
  let compare = new Set();

  F.setHTML(root, html`
    ${F.head({ title: 'Investments', lede: 'What we’ve put in, what the market added, and where it’s heading — across retirement, HSA and brokerage accounts.',
      actions: html`<a class="btn" href="#/investments?${new URLSearchParams({ ...r.params, focus: 'forecast' }).toString()}" data-jump-fc>Forecast</a><button type="button" class="btn primary" data-add-snap>${icon('plus')}Add a past balance</button>` })}
    <div class="filters">
      <div class="chips" role="group" aria-label="Account types">${types.map((x) => html`<button class="chip" data-type="${x}" aria-pressed="${String(selTypes.includes(x))}">${TYPE(x)}</button>`)}</div>
      <details class="pick" id="acct-pick"><summary class="btn sm">${selAccts.size === d.accounts.length ? 'All accounts' : `${selAccts.size} of ${d.accounts.length} accounts`} <span aria-hidden="true">▾</span></summary>
        <div class="popover pick-body">
          ${d.accounts.map((a) => html`<label class="check" style="padding:5px 0;display:flex"><input type="checkbox" value="${a.account_id}" ${selAccts.has(a.account_id) ? raw('checked') : ''}><i class="dot" style="background:${raw(colorVar(a.account_id))}"></i><span class="ellipsis" style="flex:1">${a.label}</span><span class="small muted">${fmt.amt(a.balance, { cents: false })}</span></label>`)}
          <div class="row" style="margin-top:8px"><button class="btn sm primary" data-apply-accts>Show these</button><button class="btn sm ghost" data-all-accts>All</button></div></div></details>
      <div class="seg" role="group" aria-label="Period">${PERIODS.map(([k, l]) => html`<button type="button" data-period="${k}" aria-pressed="${String(k === p.period)}">${l}</button>`)}</div>
      ${p.period === 'custom' ? html`<input type="date" class="input sm" data-cs="start" value="${p.start || ''}" aria-label="From"><input type="date" class="input sm" data-cs="end" value="${p.end || t}" aria-label="To">` : ''}
    </div>
    <section class="band" style="--n:6" aria-label="Performance">
      ${F.kpi('Value now', F.kpiMoney(d.total_value), `${selAccts.size} account${selAccts.size === 1 ? '' : 's'}`, { vcls: 'accent' })}
      ${F.kpi('Contributed', F.kpiMoney(c.period), 'In this period')}
      ${F.kpi('Market gain', st.market_gain !== null && st.market_gain !== undefined ? F.kpiMoney(st.market_gain) : '—', 'Value change minus contributions')}
      ${F.kpi('Time-weighted', pctOrDash(st.twr), st.twr_annualized !== null && st.twr_annualized !== undefined ? `${fmt.pct(st.twr_annualized, 1)} a year` : st.twr !== null && st.twr !== undefined ? 'Cumulative, under a year' : 'Needs 2+ valuations')}
      ${F.kpi('XIRR', pctOrDash(st.xirr), 'Money-weighted, a year')}
      ${F.kpi('Dividends · fees', html`${fmt.amt(d.dividends.period, { cents: false })}<span class="of"> · ${fmt.amt(d.fees.period)}</span>`, 'Where the sync reports them', { vcls: 'sm' })}
    </section>
    ${hasHistory && !st.enough_history ? html`<div class="callout warn" style="margin-top:16px">${icon('info')}<div>Returns need at least two valuations in this period. Pick a longer period or add past statement balances with <b>Add a past balance</b>.</div></div>` : ''}
    ${(d.snapshots || []).some((s) => (s.note || '').includes('TEST DATA')) ? html`<div class="callout warn" style="margin-top:12px">${icon('alert')}<div>Some snapshots are marked TEST DATA. Delete them in the Past balances table once real statements are entered.</div></div>` : ''}
    <div class="grid">
      ${hasHistory ? html`<section class="panel span-8"><div class="panel-head"><h2>Value over time</h2><span class="sub">${periodLabel || 'Month-end values'} · stacked by account</span></div>
        <div class="panel-body"><div class="chart h-300" id="val-chart"></div><div id="val-legend"></div></div></section>` : html`<section class="span-8">${F.secHead('Value over time')}${F.empty('Charts appear once there are two valuations', html`Value over time, growth versus contributions and market gain by month need at least two dated balances per account. The bank sync adds one a day from now on; to see further back, add each account’s balance from an old statement (for example every December 31).`, html`<button type="button" class="btn primary" data-add-snap>${icon('plus')}Add a past balance</button>`)}</section>`}
      <section class="panel span-4"><div class="panel-head"><h2>Contributions</h2><span class="sub">Employee vs employer where the description says</span></div>
        <div class="panel-body flush"><div class="table-wrap"><table class="t"><thead><tr><th>Who</th><th class="num">Year to date</th><th class="num">12 months</th><th class="num">All time</th></tr></thead><tbody>
          <tr><td>Employee</td><td class="num" data-label="YTD">${fmt.amt(c.ytd_employee, { cents: false })}</td><td class="num" data-label="12 mo">${fmt.amt(c.t12_employee, { cents: false })}</td><td class="num key">${fmt.amt(c.all_employee, { cents: false })}</td></tr>
          <tr><td>Employer</td><td class="num" data-label="YTD">${fmt.amt(c.ytd_employer, { cents: false })}</td><td class="num" data-label="12 mo">${fmt.amt(c.t12_employer, { cents: false })}</td><td class="num key">${fmt.amt(c.all_employer, { cents: false })}</td></tr>
          <tr><td title="The 403(b) and snapshot-derived contributions don't say who paid">Not specified</td><td class="num" data-label="YTD">${fmt.amt(c.ytd_unspecified, { cents: false })}</td><td class="num" data-label="12 mo">${fmt.amt(c.t12_unspecified, { cents: false })}</td><td class="num key">${fmt.amt(c.all_unspecified, { cents: false })}</td></tr></tbody>
          <tfoot><tr><td>Total</td><td class="num" data-label="YTD">${fmt.amt(c.ytd, { cents: false })}</td><td class="num" data-label="12 mo">${fmt.amt(c.t12, { cents: false })}</td><td class="num key">${fmt.amt(c.all, { cents: false })}</td></tr></tfoot></table></div>
          <div class="panel-body" style="padding-top:6px"><p class="small ink2">Averaging <b>${fmt.money((c.avg_month_employee || 0) + (c.avg_month_employer || 0), { cents: false })}</b> a month over the last ${fmt.num(c.t12_months_covered, 1)} months on record. The 12-month figure covers only months with data.</p></div></div></section>
      ${hasHistory ? html`<section class="panel span-8"><div class="panel-head"><h2>What we put in versus what it’s worth</h2><span class="sub">The gap is market growth</span></div>
        <div class="panel-body"><div class="chart h-260" id="cg-chart"></div>${F.legend([{ label: 'Value', color: F.css('--accent') }, { label: 'Starting value + net contributions', color: F.css('--ink'), type: 'dash' }])}</div></section>
      <section class="panel span-4"><div class="panel-head"><h2>Market gain by month</h2></div><div class="panel-body"><div class="chart h-260" id="gain-chart"></div></div></section>` : ''}
      <section class="panel span-12"><div class="panel-head"><h2>Allocation by asset class</h2><div class="tools"><button class="btn sm ghost" data-edit-map>${icon('edit')}Edit mapping</button></div></div>
        <div class="panel-body"><div class="strip" role="img" aria-label="Asset class split">${Object.entries(d.allocation.by_class).map(([k, v]) => html`<div style="flex:${Math.max(v, 0)};background:${raw(classColor[k] || 'var(--s-other)')}" title="${k} ${fmt.pct(v / classTotal, 0)}"></div>`)}</div>
          <div class="list" style="margin-top:10px">${Object.entries(d.allocation.by_class).map(([k, v]) => html`<div class="row" style="padding:7px 0;border-top:1px solid var(--line-2)"><i class="dot" style="background:${raw(classColor[k] || 'var(--s-other)')}"></i><span style="flex:1">${k}</span><span class="num muted" style="width:56px;text-align:right">${fmt.pct(v / classTotal, 1)}</span><b class="num" style="width:110px;text-align:right">${fmt.amt(v, { cents: false })}</b></div>`)}</div>
          ${d.allocation.by_class.Other ? html`<p class="caption">“Other” covers holdings no mapping rule matched and accounts that only report a total.</p>` : ''}</div></section>
      <section class="panel span-12"><div class="panel-head"><h2>Holdings</h2><span class="sub">${hasCost ? 'Cost basis shows only when the institution reports it' : 'The institutions don’t report cost basis for these'}</span></div>
        <div class="panel-body flush"><div class="table-wrap"><table class="t"><thead><tr><th>Holding</th><th class="hide-sm">Account</th><th>Asset class</th><th class="num">Shares</th><th class="num">Price</th><th class="num">Value</th>${hasCost ? html`<th class="num">Cost basis</th><th class="num">Unrealized</th>` : ''}</tr></thead>
          <tbody>${holdings.map((h) => html`<tr><td>${h.ticker ? html`<b>${h.ticker}</b> ` : ''}<span class="${h.ticker ? 'muted' : ''}">${h.description}</span></td><td class="hide-sm">${h.account}</td><td><span class="row" style="gap:6px"><i class="dot" style="background:${raw(classColor[h.asset_class] || 'var(--s-other)')}"></i>${h.asset_class}</span></td>
            <td class="num" data-label="Shares">${h.quantity !== null && h.quantity !== undefined ? fmt.num(h.quantity, 3) : '—'}</td><td class="num" data-label="Price">${h.price ? fmt.amt(h.price) : '—'}</td><td class="num key">${fmt.amt(h.market_value)}</td>
            ${hasCost ? html`<td class="num" data-label="Cost">${h.cost_basis ? fmt.amt(h.cost_basis) : '—'}</td><td class="num ${h.unrealized > 0 ? 'pos' : ''}" data-label="Gain">${h.unrealized !== null && h.unrealized !== undefined ? fmt.amt(h.unrealized, { sign: true }) : '—'}</td>` : ''}</tr>`)}</tbody></table></div></div></section>
      <section class="panel span-12" id="forecast"></section>
      <section class="panel span-7"><div class="panel-head"><h2>Past balances</h2><span class="sub">Statement values you enter fill in history before the sync started</span><div class="tools"><button class="btn sm" data-add-snap>${icon('plus')}Add</button></div></div>
        <div class="panel-body flush"><div class="table-wrap" style="max-height:420px;overflow-y:auto"><table class="t"><thead><tr><th>Date</th><th>Account</th><th class="num">Balance</th><th class="num hide-sm">Contributions YTD</th><th class="hide-sm">Note</th><th></th></tr></thead>
          <tbody>${(d.snapshots || []).map((s) => html`<tr><td class="nowrap">${fmt.date(s.as_of, { year: true })}</td><td>${s.account}</td><td class="num key">${fmt.amt(s.balance)}</td><td class="num hide-sm">${s.contributions_ytd !== null ? fmt.money(s.contributions_ytd, { cents: false }) : '—'}</td>
            <td class="hide-sm small muted"><div class="ellipsis" style="max-width:220px" title="${s.note || ''}">${s.note || ''}</div></td><td class="right"><button class="btn xs ghost" data-edit-snap="${s.id}">Edit</button></td></tr>`)}</tbody></table>
          ${(d.snapshots || []).length ? '' : F.empty('No past balances yet', 'Add a value from an old statement — for example each December 31 — to extend the history.')}</div></div></section>
      <section class="panel span-5"><div class="panel-head"><h2>Contributions and withdrawals</h2><span class="sub">In this period</span></div>
        <div class="panel-body flush"><div class="list" style="max-height:420px;overflow-y:auto">${d.flows.filter((f) => f.kind === 'contribution' || f.kind === 'withdrawal').slice(0, 120).map((f) => html`<div class="list-item">
          <div class="main-col"><div class="title">${f.kind === 'withdrawal' ? 'Withdrawal' : f.source === 'employer' ? 'Employer contribution' : f.source === 'employee' ? 'Our contribution' : f.source === 'snapshot' ? 'Contributions (from snapshots)' : 'Contribution'}</div><div class="meta">${fmt.date(f.date, { year: true })} · ${f.account}</div></div>
          <span class="amount">${F.amtCell(f.amount)}</span></div>`)}</div>
          ${d.flows.some((f) => f.kind === 'contribution' || f.kind === 'withdrawal') ? '' : F.empty('Nothing in this period')}</div></section>
      <section class="panel span-12"><details class="disclosure method"><summary>How these numbers are calculated</summary><div class="panel-body" style="padding-top:0">${methodology()}</div></details></section>
    </div>`);

  // ---------- filter handlers ----------
  $$('[data-type]', root).forEach((b) => (b.onclick = () => {
    const s = new Set(selTypes); s.has(b.dataset.type) ? s.delete(b.dataset.type) : s.add(b.dataset.type);
    setP({ types: [...s].join(','), accounts: '' });
  }));
  $$('[data-period]', root).forEach((b) => (b.onclick = () => setP({ period: b.dataset.period })));
  $$('[data-cs]', root).forEach((i) => (i.onchange = () => setP({ [i.dataset.cs]: i.value })));
  $('[data-apply-accts]', root).onclick = () => setP({ accounts: $$('#acct-pick input:checked', root).map((i) => i.value).join(','), types: '' });
  $('[data-all-accts]', root).onclick = () => setP({ accounts: '', types: '' });
  $$('[data-add-snap]', root).forEach((b) => (b.onclick = () => snapModal({})));
  $$('[data-edit-snap]', root).forEach((b) => (b.onclick = () => snapModal(d.snapshots.find((s) => s.id === +b.dataset.editSnap))));
  $('[data-edit-map]', root).onclick = mapModal;

  function snapModal(s) {
    F.modal({
      title: s.id ? 'Edit past balance' : 'Add a past balance', sub: 'Use the ending balance from a statement. Contributions year-to-date helps separate saving from growth.',
      body: html`<div class="form-grid">
        <div class="field full"><label>Account</label><select class="input" name="account_id">${d.accounts.map((a) => html`<option value="${a.account_id}" ${a.account_id === s.account_id ? raw('selected') : ''}>${a.label}</option>`)}</select></div>
        <div class="field"><label>Statement date</label><input class="input" type="date" name="as_of" value="${s.as_of || ''}" required></div>
        <div class="field"><label>Balance</label><span class="money-wrap"><input class="input" name="balance" inputmode="decimal" value="${s.balance ?? ''}" required></span></div>
        <div class="field"><label>Contributions year to date</label><span class="money-wrap"><input class="input" name="contributions_ytd" inputmode="decimal" value="${s.contributions_ytd ?? ''}"></span><span class="hint">Optional</span></div>
        <div class="field"><label>Note</label><input class="input" name="note" value="${s.note || ''}"></div></div>`,
      danger: s.id ? { label: 'Delete', onClick: async () => { if (await F.confirm('Delete this balance?')) { await F.del('/api/snapshot', { id: s.id }); F.refresh(); return true; } return false; } } : null,
      onSubmit: async (v) => {
        if (!v.as_of || v.balance === '') { F.toast('A date and balance are required', { kind: 'error' }); return false; }
        await F.post('/api/snapshot', { ...v, id: s.id, balance: v.balance.replace(/[$,]/g, ''), contributions_ytd: v.contributions_ytd.replace(/[$,]/g, '') });
        F.toast('Balance saved'); F.refresh();
      },
    });
  }
  function mapModal() {
    F.modal({
      title: 'Asset class mapping', wide: true, submit: '', cancel: 'Done',
      sub: 'Rules run top to bottom; the first match decides. Match a ticker exactly, or any text in the fund name.',
      body: html`<div class="table-wrap"><table class="t"><thead><tr><th>Match</th><th>Pattern</th><th>Asset class</th><th class="num">Order</th><th></th></tr></thead><tbody>
        ${d.asset_map.map((m) => html`<tr><td>${m.match === 'symbol' ? 'Ticker is' : 'Name contains'}</td><td><b>${m.pattern}</b></td><td>${m.asset_class}</td><td class="num">${m.priority}</td><td class="right"><button type="button" class="btn xs ghost danger" data-del-map="${m.id}">Remove</button></td></tr>`)}
        <tr><td><select class="input sm" id="am-match"><option value="symbol">Ticker is</option><option value="description">Name contains</option></select></td><td><input class="input sm" id="am-pattern" placeholder="e.g. VTSAX or 'core bond'"></td>
          <td><select class="input sm" id="am-class">${F.meta.asset_classes.map((a) => html`<option>${a}</option>`)}</select></td><td><input class="input sm num" id="am-pri" value="20" style="width:64px"></td><td><button type="button" class="btn sm primary" id="am-add">Add</button></td></tr></tbody></table></div>`,
      onOpen: (el, close) => {
        $$('[data-del-map]', el).forEach((b) => (b.onclick = async () => { await F.del('/api/asset_class', { id: b.dataset.delMap }); close(); F.refresh(); }));
        $('#am-add', el).onclick = async () => {
          const pattern = $('#am-pattern', el).value.trim(); if (!pattern) return;
          await F.post('/api/asset_class', { pattern, match: $('#am-match', el).value, asset_class: $('#am-class', el).value, priority: +$('#am-pri', el).value || 20 });
          close(); F.toast('Mapping added'); F.refresh();
        };
      },
    });
  }

  // ---------- forecast ----------
  const fcEl = $('#forecast', root);
  const num = (k, label, o = {}) => html`<div class="field"><label for="fc-${k}">${label}</label>${o.money ? html`<span class="money-wrap"><input class="input" id="fc-${k}" data-fc="${k}" inputmode="decimal" value="${fc[k]}"></span>` : html`<input class="input num" id="fc-${k}" data-fc="${k}" inputmode="decimal" value="${fc[k]}">`}${o.hint ? html`<span class="hint">${o.hint}</span>` : ''}</div>`;
  const drawForecastShell = () => {
    F.setHTML(fcEl, html`<div class="panel-head"><h2>Forecast</h2><span class="sub">Where the selected accounts could be, with ${fmt.num(fc.paths)} simulated markets</span>
      <div class="tools"><div class="seg sm" role="group" aria-label="Dollars"><button data-real="0" aria-pressed="${String(!fc.real)}">Future dollars</button><button data-real="1" aria-pressed="${String(!!fc.real)}">Today’s dollars</button></div></div></div>
      <div class="grid" style="margin-top:20px">
        <form class="span-4 stack" style="gap:12px" id="fc-form" novalidate>
          <div class="form-grid">
            ${num('start', 'Starting value', { money: true, hint: 'Today’s total for the selection' })}
            ${num('monthly', 'Our contribution / month', { money: true, hint: 'Trailing average on record' })}
            ${num('employer', 'Employer match / month', { money: true })}
            ${num('growth', 'Contribution growth %/yr')}
            ${num('ret', 'Expected return %/yr', { hint: 'Average yearly return' })}
            ${num('vol', 'Volatility %/yr', { hint: 'Ups and downs (std. dev.)' })}
            ${num('infl', 'Inflation %/yr')}
            ${num('target', 'Target amount', { money: true })}
            ${num('targetYear', 'Target year')}
            ${num('horizonYear', 'Chart through')}
          </div>
          <p class="tiny muted">7% return and 15% volatility are long-run assumptions for a stock-heavy mix, not a promise. Lower both for a bond-heavy mix.</p>
          <div class="row wrap"><button type="button" class="btn sm" data-fc-reset>Reset to defaults</button><button type="button" class="btn sm primary" data-fc-save>${icon('plus')}Save as scenario</button></div>
        </form>
        <div class="span-8">
          <div class="band" style="--n:4" id="fc-kpis"></div>
          <div class="chart h-340" id="fc-chart" style="margin-top:14px"></div><div id="fc-legend"></div>
          <div id="fc-scen" style="margin-top:14px"></div>
          <details class="disclosure" style="margin-top:8px"><summary>Year by year</summary><div class="table-wrap" id="fc-table" style="max-height:360px;overflow-y:auto"></div></details>
        </div></div>`);
    $$('[data-fc]', fcEl).forEach((i) => i.addEventListener('input', F.debounce(() => {
      const v = parseFloat(i.value.replace(/[$,]/g, ''));
      if (!Number.isNaN(v)) { fc[i.dataset.fc] = v; persist(); runForecast(); }
    }, 300)));
    $$('[data-real]', fcEl).forEach((b) => (b.onclick = () => { fc.real = b.dataset.real === '1'; persist(); $$('[data-real]', fcEl).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); runForecast(); }));
    $('[data-fc-reset]', fcEl).onclick = () => { fc = { ...fcDefaults }; persist(); drawForecastShell(); runForecast(); };
    $('[data-fc-save]', fcEl).onclick = () => F.modal({
      title: 'Save scenario', body: html`<div class="field"><label>Name</label><input class="input" name="name" placeholder="e.g. Max out 403(b) from 2027" required></div>`,
      onSubmit: async (v) => { if (!v.name.trim()) return false; await F.post('/api/scenario', { name: v.name, params: { ...fc } }); F.toast('Scenario saved'); const s = await F.get('/api/investments', { types: p.types, accounts: p.accounts, start, end }); d.scenarios = s.scenarios; runForecast(); },
    });
  };
  const persist = () => { try { localStorage.setItem('fin.fc', JSON.stringify({ ...fc, _for: p.accounts || p.types || 'all' })); } catch { /* ignore */ } };
  const runForecast = () => {
    const res = F.forecast({ ...fc, startMonth: F.thisMonth() });
    const at = res.atTarget;
    const realNote = fc.real ? 'in today’s dollars' : 'in future dollars';
    F.setHTML($('#fc-kpis', fcEl), html`
      ${F.kpi(`Median in ${fc.targetYear}`, F.tick(at.p50), `Typical outcome, ${realNote}`, { vcls: 'accent' })}
      ${F.kpi('10th – 90th', html`${F.tick(at.p10)}<span class="of"> – ${F.tick(at.p90)}</span>`, '8 in 10 outcomes fall here')}
      ${F.kpi(`Chance of ${F.tick(fc.target)}`, res.hit !== null ? fmt.pct(res.hit, 0) : '—', `By December ${fc.targetYear}`)}
      ${F.kpi('Needed a month', res.reqMedian !== null ? fmt.amt(res.reqMedian, { cents: false }) : '—', res.reqMedian === 0 && res.req80 === 0 ? 'On track with no more of our money' : res.req80 !== null ? `${fmt.money(res.req80, { cents: false })} for 80% confidence` : '')}`);
    const chosen = d.scenarios.filter((s) => compare.has(s.id)).slice(0, 3);
    F.setHTML($('#fc-scen', fcEl), d.scenarios.length ? html`<div class="small ink2" style="margin-bottom:6px">Compare saved scenarios (up to 3)</div><div class="chips">${d.scenarios.map((s) => html`<span class="chip" aria-pressed="${String(compare.has(s.id))}" style="padding-right:4px"><button type="button" data-cmp="${s.id}" style="border:0;background:none;color:inherit;font:inherit;cursor:pointer;padding:0">${s.name}</button>
      <button type="button" data-load="${s.id}" title="Load into the inputs" style="border:0;background:none;color:inherit;cursor:pointer;opacity:.7">↺</button><button type="button" data-del-scen="${s.id}" title="Delete" style="border:0;background:none;color:inherit;cursor:pointer;opacity:.7">✕</button></span>`)}</div>` : html`<p class="small muted">Save a scenario to compare it with others on the chart.</p>`);
    $$('[data-cmp]', fcEl).forEach((b) => (b.onclick = () => { const id = +b.dataset.cmp; if (compare.has(id)) compare.delete(id); else if (compare.size < 3) compare.add(id); else F.toast('Compare up to 3 at a time'); runForecast(); }));
    $$('[data-load]', fcEl).forEach((b) => (b.onclick = () => { const s = d.scenarios.find((x) => x.id === +b.dataset.load); fc = { ...fcDefaults, ...JSON.parse(s.params_json), start: fc.start }; persist(); drawForecastShell(); runForecast(); F.toast(`Loaded “${s.name}”`); }));
    $$('[data-del-scen]', fcEl).forEach((b) => (b.onclick = async () => { if (await F.confirm('Delete this scenario?')) { await F.del('/api/scenario', { id: b.dataset.delScen }); d.scenarios = d.scenarios.filter((x) => x.id !== +b.dataset.delScen); compare.delete(+b.dataset.delScen); runForecast(); } }));
    F.setHTML($('#fc-table', fcEl), html`<table class="t"><thead><tr><th>Year end</th><th class="num">Contributed</th><th class="num">Steady ${fc.ret}%</th><th class="num">Poor (10th)</th><th class="num">Median</th><th class="num">Strong (90th)</th></tr></thead>
      <tbody>${res.years.map((yy) => html`<tr ${yy.k === res.kT ? raw('style="font-weight:650"') : ''}><td data-label="">${yy.year}</td><td class="num" data-label="Added">${fmt.money(yy.contributed, { cents: false })}</td><td class="num" data-label="Steady ${fc.ret}%">${fmt.money(yy.det, { cents: false })}</td><td class="num" data-label="Poor">${fmt.money(yy.p10, { cents: false })}</td><td class="num" data-label="Median">${fmt.money(yy.p50, { cents: false })}</td><td class="num" data-label="Strong">${fmt.money(yy.p90, { cents: false })}</td></tr>`)}</tbody></table>`);
    if (!F.hasCharts) return;
    F.charts = F.charts.filter((ch) => { if (ch.canvas.closest('#fc-chart')) { ch.destroy(); return false; } return true; });
    const s1 = F.css('--accent'), ink2 = F.css('--ink');
    const labels = res.years.map((yy) => yy.year);
    const ds = [
      { label: '90th percentile', data: res.years.map((yy) => yy.p90), borderColor: 'transparent', backgroundColor: F.alpha(s1, 0.14), fill: '+1', pointRadius: 0, tension: 0.25 },
      { label: '10th percentile', data: res.years.map((yy) => yy.p10), borderColor: F.alpha(s1, 0.35), borderWidth: 1, backgroundColor: 'transparent', fill: false, pointRadius: 0, tension: 0.25 },
      F.lineDs('Median', res.years.map((yy) => yy.p50), s1),
      F.lineDs(`Steady ${fc.ret}% a year`, res.years.map((yy) => yy.det), ink2, { borderDash: [5, 4], borderWidth: 1.5 }),
      F.lineDs('Start + contributions', res.years.map((yy) => fc.start + yy.contributed), F.css('--faint'), { borderDash: [2, 3], borderWidth: 1.5 }),
    ];
    const scColors = [F.css('--s2'), F.css('--s3'), F.css('--s7')];
    chosen.forEach((s, i) => {
      const sp = { ...fcDefaults, ...JSON.parse(s.params_json), start: fc.start, real: fc.real };
      const rr = F.forecast({ ...sp, horizonYear: fc.horizonYear, startMonth: F.thisMonth() });
      ds.push(F.lineDs(`${s.name} (median)`, rr.years.map((yy) => yy.p50), scColors[i]));
    });
    const o = F.chartOpts({ kind: 'line', beginAtZero: true });
    o.scales.x.ticks.maxTicksLimit = 10;
    const targetLine = {
      id: 'target', afterDatasetsDraw(ch) {
        if (!fc.target) return;
        const yv = ch.scales.y.getPixelForValue(fc.target);
        if (yv < ch.chartArea.top || yv > ch.chartArea.bottom) return;
        const cx = ch.ctx; cx.save(); cx.strokeStyle = F.css('--ink'); cx.setLineDash([2, 3]); cx.lineWidth = 1;
        cx.beginPath(); cx.moveTo(ch.chartArea.left, yv); cx.lineTo(ch.chartArea.right, yv); cx.stroke();
        cx.fillStyle = F.css('--ink-2'); cx.font = `500 11.5px ${C_FONT()}`; cx.textAlign = 'left';
        cx.fillText(`Target ${F.tick(fc.target)}`, ch.chartArea.left + 6, yv - 6); cx.restore();
      },
    };
    F.chart($('#fc-chart', fcEl), { type: 'line', aria: 'Forecast fan chart', data: { labels, datasets: ds }, options: o, plugins: [targetLine] });
    F.setHTML($('#fc-legend', fcEl), F.legend([{ label: 'Median outcome', color: s1, type: 'line' }, { label: '10th–90th percentile', color: F.alpha(s1, 0.3) },
      { label: `Steady ${fc.ret}% a year`, color: ink2, type: 'dash' }, { label: 'Start + contributions, no growth', color: F.css('--faint'), type: 'dash' },
      ...chosen.map((s, i) => ({ label: s.name, color: scColors[i], type: 'line' }))]));
  };
  const C_FONT = () => getComputedStyle(document.body).fontFamily;

  // ---------- charts ----------
  const draw = () => {
    if (!F.hasCharts) return;
    const ser = d.series.filter((m) => !start || m.month >= start.slice(0, 7));
    const labels = ser.map((m) => fmt.month(m.month, { short: true }));
    const accts = d.accounts.filter((a) => selAccts.has(a.account_id) && ser.some((m) => m.by_account[a.account_id]));
    if (hasHistory) {
      const o = F.chartOpts({ kind: 'line', stacked: true });
      o.plugins.tooltip.callbacks.footer = (items) => `Total ${fmt.money(items.reduce((s, i) => s + (i.parsed.y || 0), 0), { cents: false })}`;
      F.chart($('#val-chart', root), { type: 'line', aria: 'Value over time by account', data: { labels, datasets: accts.map((a, i) => ({
        ...F.lineDs(a.label, ser.map((m) => m.by_account[a.account_id] ?? 0), color(a.account_id)), fill: i === 0 ? 'origin' : '-1', backgroundColor: F.alpha(color(a.account_id), 0.55), borderWidth: 1.5, tension: 0.15 })) }, options: o });
      F.setHTML($('#val-legend', root), F.legend(accts.map((a) => ({ label: a.label, color: color(a.account_id) }))));
      let cum = ser[0].start || 0;
      const base = ser.map((m) => (cum += m.net_flow || 0));
      F.chart($('#cg-chart', root), { type: 'line', aria: 'Value versus contributions', data: { labels, datasets: [
        F.areaDs('Value', ser.map((m) => m.total), F.css('--accent')), F.lineDs('Starting value + net contributions', base, F.css('--ink'), { borderDash: [5, 4], borderWidth: 1.5 })] },
        options: (() => { const o2 = F.chartOpts({ kind: 'line', beginAtZero: false }); o2.plugins.tooltip.callbacks.afterBody = (it) => `Growth ${fmt.money(ser[it[0].dataIndex].total - base[it[0].dataIndex], { cents: false })}`; return o2; })() });
      const gains = ser.map((m) => (m.has_valuation ? m.gain : null));
      F.chart($('#gain-chart', root), { type: 'bar', aria: 'Market gain by month', data: { labels, datasets: [F.barDs('Market gain', gains, gains.map((g) => (g >= 0 ? F.css('--accent') : F.css('--ink'))))] },
        options: (() => { const o3 = F.chartOpts({ kind: 'bar' }); o3.scales.y.beginAtZero = true; return o3; })() });
    }
    runForecast();
  };
  drawForecastShell();
  draw();
  if (pFocus === 'forecast') requestAnimationFrame(() => fcEl.scrollIntoView({ block: 'start' }));
  const jf = $('[data-jump-fc]', root); if (jf) jf.onclick = (e) => { e.preventDefault(); fcEl.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  ctl.rerender = () => { F.destroyCharts(); draw(); };

  function methodology() {
    return html`
      <h3>Market gain</h3><p>For the chosen period: ending value − starting value − net contributions (contributions minus withdrawals). Dividends and fees are part of the gain, not contributions.</p>
      <h3>Time-weighted return (Modified Dietz, chained monthly)</h3>
      <p>Each month gets its own return, which adjusts for money added partway through the month, so the result reflects the investments — not the timing or size of deposits.</p>
      <div class="math"><var>R</var><sub>m</sub> = <span class="frac"><span><var>V</var><sub>1</sub> − <var>V</var><sub>0</sub> − <var>F</var></span><span><var>V</var><sub>0</sub> + <span class="bigop"><b>Σ</b><small><var>i</var></small></span> <var>w</var><sub>i</sub> <var>F</var><sub>i</sub></span></span>
        &nbsp;&nbsp; with &nbsp; <var>w</var><sub>i</sub> = <span class="frac"><span><var>D</var> − <var>d</var><sub>i</sub></span><span><var>D</var></span></span></div>
      <div class="math">TWR = (1 + <var>R</var><sub>1</sub>)(1 + <var>R</var><sub>2</sub>) ⋯ (1 + <var>R</var><sub>n</sub>) − 1 &nbsp;&nbsp;&nbsp; annualized = (1 + TWR)<sup>365 / days</sup> − 1</div>
      <p><var>V</var><sub>0</sub>, <var>V</var><sub>1</sub>: values at the start and end of the month. <var>F</var>: net external flow in the month; <var>F</var><sub>i</sub> on day <var>d</var><sub>i</sub> of a <var>D</var>-day month. Between statements, values are rolled forward by contributions only (no growth is assumed), so the return lands in the month of the next real valuation. An account’s first valuation counts as money coming in.</p>
      <h3>Money-weighted return (XIRR)</h3>
      <p>The single yearly rate that makes the starting value, every contribution and withdrawal, and the ending value balance out. It rewards good timing and penalizes bad timing, so it can differ from the time-weighted figure.</p>
      <div class="math"><span class="bigop"><b>Σ</b><small><var>i</var></small></span> <span class="frac"><span><var>CF</var><sub>i</sub></span><span>(1 + <var>r</var>)<sup>(<var>t</var><sub>i</sub> − <var>t</var><sub>0</sub>) / 365</sup></span></span> = 0</div>
      <p>Cash flows from our side: the starting value and contributions are negative, withdrawals and the ending value positive. Solved by bisection.</p>
      <h3>Monte Carlo forecast</h3>
      <p>Each simulated path draws a random market return every month from a lognormal distribution whose average yearly return equals the expected return you enter, with the volatility you enter.</p>
      <div class="math"><var>x</var><sub>k</sub> ∼ 𝒩(<var>μ</var>, <var>σ</var><sub>m</sub><sup>2</sup>), &nbsp; <var>σ</var><sub>m</sub> = <span class="frac"><span><var>σ</var></span><span>√<span style="border-top:1px solid currentColor;padding-left:1px">12</span></span></span>, &nbsp; <var>μ</var> = <span class="frac"><span>ln(1 + <var>R</var>)</span><span>12</span></span> − <span class="frac"><span><var>σ</var><sub>m</sub><sup>2</sup></span><span>2</span></span></div>
      <div class="math"><var>V</var><sub>k+1</sub> = <var>V</var><sub>k</sub> · <var>e</var><sup><var>x</var><sub>k</sub></sup> + <var>C</var><sub>k</sub>, &nbsp;&nbsp; <var>C</var><sub>k</sub> = (<var>c</var> + <var>m</var>)(1 + <var>g</var>)<sup>⌊<var>k</var> / 12⌋</sup></div>
      <p>The fan shows the 10th, 50th and 90th percentile of ${fmt.num(fc.paths)} paths at each year end. “Today’s dollars” divides by (1 + inflation)<sup><var>k</var>/12</sup>. The chance of reaching the target is the share of paths at or above it in December of the target year.</p>
      <h3>Required monthly contribution</h3>
      <p>On a fixed set of simulated markets, each path’s final value is a straight line in our monthly contribution <var>c</var>: <var>V</var><sub>T</sub> = <var>A</var><sub>i</sub> + <var>c</var>·<var>B</var><sub>i</sub>. So each path needs <var>c</var><sub>i</sub> = (target − <var>A</var><sub>i</sub>) / <var>B</var><sub>i</sub>, and the amount that succeeds with probability <var>q</var> is the <var>q</var>-quantile of those — the median for 50%, the 80th percentile for 80% confidence.</p>
      <h3>Contributions: employee or employer</h3>
      <p>Descriptions with “CO CONTR” or “employer” count as employer money; “PARTIC CONTR”, “contribution” or “employee” as ours. Voya 403(b) credits don’t say who paid, so they show as not specified; credits under $50 there are treated as dividends. Past balances with a contributions-year-to-date figure add contributions for periods before transactions were synced.</p>`;
  }
};
