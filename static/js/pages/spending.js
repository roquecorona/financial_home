/* Spending analysis: ranges, categories, merchants, people, entities, budgets, transactions. */
'use strict';
F.pages.spending = async (root, r, ctl) => {
  const { html, raw, fmt, icon, $, $$ } = F;
  const p = Object.assign({ preset: '3m' }, r.params);
  if (p.view === 'review') return F.reviewView(root, r, ctl);
  const rng = p.preset === 'all' ? { start: F.meta.data_start || '', end: F.todayISO() } : F.presetRange(p.preset, p);
  const q = { start: rng.start, end: rng.end, holder: p.holder, entity: p.entity, account: p.account, person: p.person, category: p.category && p.category !== '__none__' ? p.category : undefined };
  const [d, rv] = await Promise.all([F.get('/api/spending', q), F.get('/api/review', { summary: 1 }).catch(() => null)]);
  if (!ctl.alive()) return;
  const setP = (patch) => F.go('#/spending?' + new URLSearchParams(Object.entries({ ...p, _from: '', ...patch }).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString());
  const slots = d.cat_slots || {};
  const slotCats = Object.keys(slots).sort((a, b) => slots[a] - slots[b]);
  const others = d.categories.filter((c) => !(c.category in slots)).map((c) => c.category);
  const rangeLabel = `${fmt.date(d.start, { year: true })} – ${fmt.date(d.end, { year: true })}`;
  const accounts = F.meta.accounts.filter((a) => !['ira', 'hsa', '401k', '403b', 'brokerage', '529'].includes(a.type));
  const totalBudget = d.budgets.reduce((s, b) => s + (b.monthly || 0), 0);
  const persons = [...new Set([...F.people(), ...d.by_person.map((x) => x.name).filter(Boolean)])];
  const personBars = d.by_person.length ? F.hbars(d.by_person.map((x) => ({ label: x.name || 'Not set', value: x.total, key: x.name || '__none__' })), { onClick: true, active: p.person, valueFmt: (v) => fmt.amt(v, { cents: false }), sub: (i) => (d.total ? fmt.pct(i.value / d.total, 0) : '') }) : F.empty('No spending in this range');
  const sel = (name, label, opts, cur) => html`<select class="input sm" data-p="${name}" aria-label="${label}"><option value="">${label}</option>${opts.map(([v, l]) => html`<option value="${v}" ${v === cur ? raw('selected') : ''}>${l}</option>`)}</select>`;

  F.setHTML(root, html`
    ${F.head({ title: 'Spending', lede: `${rangeLabel}. Card payments, transfers between our accounts and investment activity are left out; refunds reduce spending.`,
      actions: html`<a class="btn" href="#/settings?tab=categories">Categories</a><button type="button" class="btn primary" data-add-txn>${icon('plus')}Add a transaction</button>` })}
    ${F.spendTabs('analysis', rv ? rv.counts.rows : 0)}
    <div class="filters">
      <span class="hide-sm">${F.presetSeg(p.preset)}</span><span class="show-sm">${F.presetSelect(p.preset, 'preset-sel')}</span>
      ${p.preset === 'custom' ? html`<input type="date" class="input sm" data-p="start" value="${d.start}" aria-label="From"><input type="date" class="input sm" data-p="end" value="${d.end}" aria-label="To">` : ''}
      ${sel('holder', 'Everyone', F.meta.holders.map((h) => [h, h === 'Business' ? 'Business cards & accounts' : h]), p.holder)}
      ${sel('entity', 'All entities', F.meta.entities.map((e) => [e, e]), p.entity)}
      ${sel('account', 'All accounts', accounts.map((a) => [a.account_id, a.name]), p.account)}
      ${sel('person', 'Anyone', [...persons.map((x) => [x, x]), ['__none__', 'Not set']], p.person)}
    </div>
    <section class="band" style="--n:5" aria-label="Summary">
      ${F.kpi('Spent', F.kpiMoney(d.total), `${fmt.num(d.count)} transactions`)}
      ${F.kpi('Per month', d.avg_month !== null ? F.kpiMoney(d.avg_month) : '—', d.months_covered ? `Over ${fmt.num(d.months_covered, 1)} months of data` : 'Not enough data')}
      ${F.kpi('Vs. period before', d.change !== null ? html`${d.change > 0 ? '+' : ''}${fmt.pct(d.change, 0)}` : '—', d.prior.ok ? `${fmt.money(d.prior.total, { cents: false })} from ${fmt.date(d.prior.start)} – ${fmt.date(d.prior.end)}` : 'No bank data for the earlier period yet')}
      ${F.kpi('Came in', F.kpiMoney(d.income), 'Pay, rent and deposits', { vcls: 'accent' })}
      ${F.kpi('Left over', F.kpiMoney(d.income - d.total), d.income > 0 ? `${fmt.pct((d.income - d.total) / d.income, 0)} of what came in` : '—', { vcls: d.income - d.total < 0 ? 'alert-text' : '' })}
    </section>
    <div class="grid">
      <section class="panel span-5"><div class="panel-head"><h2>By category</h2><span class="sub">${totalBudget ? 'Line marks the budget for this period' : 'Tap a category to dig in'}</span></div>
        <div class="panel-body flush" id="cat-bars"></div></section>
      <section class="panel span-7"><div class="panel-head"><h2>Month by month</h2><span class="sub">Largest categories, the rest grouped</span></div>
        <div class="panel-body"><div class="chart h-300" id="stack-chart"></div><div id="stack-legend"></div></div></section>
      <section class="panel span-12 ${p.category ? '' : 'hidden'}" id="cat-detail"></section>
      <section class="panel span-6"><div class="panel-head"><h2>Top merchants</h2><span class="sub">Tap one to see its transactions</span></div>
        <div class="panel-body flush"><div class="table-wrap"><table class="t"><thead><tr><th>Merchant</th><th class="hide-sm">Category</th><th class="num">Visits</th><th class="num">Total</th></tr></thead>
        <tbody>${d.merchants.slice(0, window.matchMedia('(max-width: 760px)').matches ? 8 : 15).map((m) => html`<tr class="clickable" data-merchant="${m.merchant}" tabindex="0"><td><b>${m.merchant}</b><div class="tiny muted">Last ${fmt.date(m.last)}</div></td>
          <td class="hide-sm"><span class="row" style="gap:6px"><i class="dot" style="background:${raw(F.catVar(m.category))}"></i>${m.category}</span></td><td class="num" data-label="Visits">${m.n}</td><td class="num key">${fmt.amt(m.total, { cents: false })}</td></tr>`)}</tbody></table></div>
        ${d.merchants.length ? '' : F.empty('No spending in this range')}</div></section>
      <div class="span-6 stack" style="gap:28px">
      <section class="panel" id="person-panel"><div class="panel-head"><h2>By person</h2><span class="sub">Who the money was spent on${d.split_lines ? ' · order items count for their own person' : ''}</span></div><div class="panel-body flush" id="person-bars">${personBars}</div></section>
      <section class="panel"><div class="panel-head"><h2>By card holder</h2></div><div class="panel-body flush">${F.hbars(d.by_holder.map((x) => ({ label: x.name, value: x.total, key: x.name })), { onClick: true, active: p.holder, valueFmt: (v) => fmt.amt(v, { cents: false }) })}</div></section>
      <section class="panel"><div class="panel-head"><h2>By entity</h2></div><div class="panel-body flush" id="ent-bars">${F.hbars(d.by_entity.map((x) => ({ label: x.name, value: x.total, key: x.name })), { onClick: true, active: p.entity, valueFmt: (v) => fmt.amt(v, { cents: false }) })}</div></section>
      </div>
      <section class="span-12"><details class="disclosure" id="budgets" ${p.budgets === '1' ? raw('open') : ''}><summary>Monthly budgets <span class="badge">${totalBudget ? fmt.money(totalBudget, { cents: false }) + ' a month' : 'none set'}</span></summary>
        <p class="small ink2" style="margin:8px 0 4px">Type an amount to set a budget; the average month in this range is compared with it, and the category bars above mark it.</p>
        <div class="panel-body flush"><div class="table-wrap"><table class="t" id="budget-table"><thead><tr><th>Category</th><th class="num" style="width:150px">Monthly budget</th><th class="num">Average month</th><th style="width:30%" class="hide-sm">Average vs budget</th><th class="num">This range</th></tr></thead>
        <tbody>${d.categories.filter((c) => c.category !== 'Uncategorized').map((c) => {
          const avg = d.months_covered ? c.total / Math.max(d.months_covered, 1) : null;
          const b = c.budget_monthly;
          const pct = b ? avg / b : null;
          return html`<tr><td><span class="row" style="gap:8px"><i class="dot" style="background:${raw(F.catVar(c.category))}"></i>${c.category}</span></td>
            <td class="num" data-label="Budget"><span class="money-wrap"><input class="input sm" data-budget="${c.category}" value="${b ?? ''}" inputmode="decimal" aria-label="Monthly budget for ${c.category}"></span></td>
            <td class="num" data-label="Avg month">${avg !== null ? fmt.amt(avg, { cents: false }) : '—'}</td>
            <td class="hide-sm">${b ? html`<div class="row"><div class="meter ${pct > 1 ? 'over' : ''}" style="flex:1"><div style="width:${Math.min(100, pct * 100).toFixed(1)}%"></div></div><span class="small ${pct > 1 ? 'neg' : 'muted'}" style="width:48px;text-align:right">${fmt.pct(pct, 0)}</span></div>` : html`<span class="small muted">No budget</span>`}</td>
            <td class="num key">${fmt.amt(c.total, { cents: false })}</td></tr>`;
        })}</tbody></table></div></div></details></section>
      <section class="panel span-12" id="spend-txns"></section>
    </div>`);

  // filters
  $$('[data-preset]', root).forEach((b) => (b.onclick = () => setP({ preset: b.dataset.preset, start: b.dataset.preset === 'custom' ? d.start : undefined, end: b.dataset.preset === 'custom' ? d.end : undefined })));
  const ps = $('#preset-sel', root); if (ps) ps.onchange = () => setP({ preset: ps.value });
  $$('[data-p]', root).forEach((s) => (s.onchange = () => setP({ [s.dataset.p]: s.value })));
  $$('.hbar[data-key]', root).forEach((b) => {
    const parent = b.closest('section');
    b.onclick = () => {
      if (parent.querySelector('#ent-bars')) setP({ entity: p.entity === b.dataset.key ? '' : b.dataset.key });
      else if (parent.querySelector('#person-bars')) setP({ person: p.person === b.dataset.key ? '' : b.dataset.key });
      else if (parent.querySelector('h2')?.textContent === 'By card holder') setP({ holder: p.holder === b.dataset.key ? '' : b.dataset.key });
    };
  });
  $$('[data-budget]', root).forEach((i) => i.addEventListener('change', async () => {
    const v = i.value.replace(/[$,]/g, '').trim();
    if (v && Number.isNaN(+v)) { F.toast('Enter a number', { kind: 'error' }); return; }
    await F.post('/api/budget', { category: i.dataset.budget, monthly_amount: v === '' ? null : +v });
    F.toast(v === '' ? `Budget for ${i.dataset.budget} removed` : `Budget for ${i.dataset.budget} set to ${fmt.money(+v, { cents: false })} a month`);
  }));

  const addTxn = () => F.manualTxnModal({}, () => table.reload());
  $('[data-add-txn]', root).onclick = addTxn;
  if (p.add === '1') { F.setParams({ ...p, add: '' }); setTimeout(addTxn, 0); }

  // category bars
  const periodMonths = Math.max(d.months_covered, 0);
  F.setHTML($('#cat-bars', root), d.categories.length ? F.hbars(d.categories.map((c) => ({ label: c.category, value: c.total, key: c.category, c })), {
    onClick: true, valueFmt: (v) => fmt.amt(v, { cents: false }), active: p.category, labelDot: (i) => F.catVar(i.label),
    marker: (i) => (i.c.budget_monthly ? i.c.budget_monthly * periodMonths : null), over: (i) => i.c.budget_monthly && i.value > i.c.budget_monthly * periodMonths,
    sub: (i) => `${fmt.pct(i.c.share, 0)}${i.c.prior !== null && i.c.prior !== undefined && i.c.prior > 0 ? ` · ${i.value >= i.c.prior ? '+' : '−'}${fmt.pct(Math.abs(i.value / i.c.prior - 1), 0)}` : ''}`,
  }) : F.empty('No spending in this range'));
  $$('#cat-bars .hbar', root).forEach((b) => (b.onclick = () => setP({ category: p.category === b.dataset.key ? '' : b.dataset.key, merchant: '', _from: p.category === b.dataset.key ? '' : 'bar' })));

  // category detail
  if (p.category && d.detail) {
    const det = d.detail;
    F.setHTML($('#cat-detail', root), html`<div class="panel-head"><i class="dot" style="background:${raw(F.catVar(det.category))};width:10px;height:10px"></i><h2>${det.category}</h2>
      <span class="sub">${fmt.money(det.total, { cents: false })} in this range</span><div class="tools"><button class="btn sm ghost" data-clear-cat>${icon('x')}Close</button></div></div>
      <div class="grid" style="margin-top:0;row-gap:16px">
        <div class="span-4"><div class="label" style="padding:12px 0 4px">Subcategories</div>${F.hbars(det.subcategories.map((s) => ({ label: s.name, value: s.total, key: s.name })), { color: F.catVar(det.category), onClick: true, sub: (i) => `${det.subcategories.find((s) => s.name === i.label).n} txns` })}</div>
        <div class="span-4"><div class="label" style="padding:12px 0 4px">Top merchants</div><div class="list">${det.merchants.slice(0, 8).map((m) => html`<button class="list-item" data-merchant="${m.merchant}" ><div class="main-col"><div class="title">${m.merchant}</div><div class="meta">${m.n} visit${m.n === 1 ? '' : 's'} · last ${fmt.date(m.last)}</div></div><span class="amount">${fmt.amt(m.total, { cents: false })}</span></button>`)}</div></div>
        <div class="span-4"><div class="label" style="padding:12px 0 4px">By month</div><div class="chart h-220" id="cat-month"></div></div>
      </div>`);
    $('[data-clear-cat]', root).onclick = () => setP({ category: '' });
    if (r.params._from === 'bar') requestAnimationFrame(() => $('#cat-detail', root).scrollIntoView({ block: 'start' }));
    $$('#cat-detail .hbar', root).forEach((b) => (b.onclick = () => table.set({ subcategory: b.dataset.key === '(none)' ? '__none__' : b.dataset.key })));
  }
  $$('[data-merchant]', root).forEach((b) => { b.onclick = () => { table.set({ merchant: b.dataset.merchant }); $('#spend-txns', root).scrollIntoView({ behavior: 'smooth' }); }; b.onkeydown = (e) => { if (e.key === 'Enter') b.onclick(); }; });

  const table = F.txnTable($('#spend-txns', root), {
    base: { holder: p.holder, entity: p.entity, account: p.account, person: p.person }, noPreset: true,
    state: { preset: 'custom', start: d.start, end: d.end, category: p.category, merchant: p.merchant, q: p.q || '', kind: p.kind || 'spending', subcategory: '' },
    title: 'Transactions', onEdit: F.debounce(() => {}, 10), pageSize: window.matchMedia('(max-width: 760px)').matches ? 40 : 100,
  });

  const draw = () => {
    if (!F.hasCharts) return;
    const top = slotCats.filter((c) => d.categories.some((x) => x.category === c));
    const series = top.map((c) => F.stackDs(c, d.months.map((m) => d.monthly[m]?.[c] || 0), F.catColor(c)));
    const otherCats = d.categories.map((c) => c.category).filter((c) => !top.includes(c));
    if (otherCats.length) series.push(F.stackDs('Everything else', d.months.map((m) => otherCats.reduce((s, c) => s + (d.monthly[m]?.[c] || 0), 0)), F.css('--s-other')));
    const o = F.chartOpts({ kind: 'bar', stacked: true });
    o.plugins.tooltip.callbacks.footer = (items) => `Total ${fmt.money(items.reduce((s, i) => s + (i.parsed.y || 0), 0), { cents: false })}`;
    o.plugins.tooltip.itemSort = (a, b) => b.datasetIndex - a.datasetIndex;
    o.plugins.tooltip.filter = (i) => Math.abs(i.parsed.y) >= 0.5;
    F.chart($('#stack-chart', root), { type: 'bar', aria: 'Spending by month and category', data: { labels: d.months.map((m) => fmt.month(m, { short: true })), datasets: series }, options: o });
    F.setHTML($('#stack-legend', root), F.legend(series.map((s) => ({ label: s.label, color: s.backgroundColor }))));
    if (p.category && d.detail) {
      F.chart($('#cat-month', root), { type: 'bar', aria: `${p.category} by month`,
        data: { labels: d.detail.monthly.map((m) => fmt.month(m.month, { short: true })), datasets: [F.barDs(p.category, d.detail.monthly.map((m) => m.total), F.catColor(p.category))] },
        options: F.chartOpts({ kind: 'bar' }) });
    }
  };
  draw();
  ctl.rerender = () => { F.destroyCharts(); draw(); };
  void others;
};
