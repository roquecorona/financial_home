/* Properties & rental business: profiles, P&L, ledger entries, notes. */
'use strict';
(function () {
  const { html, raw, fmt, icon, $, $$ } = F;
  const STATUS = { rented: ['good', 'Rented'], vacant: ['warn', 'Vacant'], 'primary residence': ['info', 'Our home'], sold: ['neutral', 'Sold'], other: ['neutral', 'Other'] };
  const statusPill = (s) => { const [c, l] = STATUS[s] || ['neutral', s || '—']; return html`<span class="pill ${c}">${l}</span>`; };

  function profileModal(pr, accounts) {
    pr = pr || {};
    F.modal({
      title: pr.id ? `Edit ${pr.name}` : 'Add a property', wide: true,
      sub: 'Purchase price, estimated value and cash invested unlock equity, cap rate and cash-on-cash return.',
      body: html`<div class="form-grid">
        <div class="field"><label>Name</label><input class="input" name="name" value="${pr.name || ''}" required></div>
        <div class="field"><label>Status</label><select class="input" name="status">${Object.entries(STATUS).map(([k, [, l]]) => html`<option value="${k}" ${k === (pr.status || 'rented') ? raw('selected') : ''}>${l}</option>`)}</select></div>
        <div class="field full"><label>Address</label><input class="input" name="address" value="${pr.address || ''}"></div>
        <div class="field"><label>Purchase date</label><input class="input" type="date" name="purchase_date" value="${pr.purchase_date || ''}"></div>
        <div class="field"><label>Purchase price</label><span class="money-wrap"><input class="input" name="purchase_price" inputmode="decimal" value="${pr.purchase_price ?? ''}"></span></div>
        <div class="field"><label>Estimated value today</label><span class="money-wrap"><input class="input" name="est_value" inputmode="decimal" value="${pr.est_value ?? ''}"></span><span class="hint">Counts toward net worth unless sold</span></div>
        <div class="field"><label>Cash invested</label><span class="money-wrap"><input class="input" name="cash_invested" inputmode="decimal" value="${pr.cash_invested ?? ''}"></span><span class="hint">Down payment + closing + rehab</span></div>
        <div class="field"><label>Mortgage account</label><select class="input" name="mortgage_account_id"><option value="">None linked</option>${(accounts || []).map((a) => html`<option value="${a.account_id}" ${a.account_id === pr.mortgage_account_id ? raw('selected') : ''}>${a.name}</option>`)}</select></div>
        <div class="field"><label>Interest rate %</label><input class="input" name="rate" inputmode="decimal" value="${pr.rate ?? ''}"></div>
        <div class="field"><label>Monthly rent</label><span class="money-wrap"><input class="input" name="rent" inputmode="decimal" value="${pr.rent ?? ''}"></span></div>
        <div class="field"><label>Tenant</label><input class="input" name="tenant" value="${pr.tenant || ''}"></div>
        <div class="field"><label>Lease ends</label><input class="input" type="date" name="lease_end" value="${pr.lease_end || ''}"></div>
        <div class="field"><label>Entity name in transactions</label><select class="input" name="entity">${F.entityOptions(pr.entity || pr.name || '', pr.name || 'household')}</select></div>
        <div class="field full"><label>Notes</label><textarea class="input" name="notes" rows="2">${pr.notes || ''}</textarea></div></div>`,
      onSubmit: async (v) => {
        const clean = (x) => (x || '').replace(/[$,]/g, '');
        const r = await F.post('/api/property', { ...v, id: pr.id, purchase_price: clean(v.purchase_price), est_value: clean(v.est_value), cash_invested: clean(v.cash_invested), rent: clean(v.rent) });
        F.toast('Property saved'); F.loadMeta(true);
        if (!pr.id) F.go(`#/properties/${r.id}`); else F.refresh();
      },
    });
  }
  function entryModal(pid, e = {}, cats = []) {
    F.modal({
      title: e.ref ? 'Edit entry' : 'Add income or expense', sub: 'For things the bank data doesn’t show — cash rent, a repair paid from another card, a receipt you want on record.',
      body: html`<div class="form-grid">
        <div class="field"><label>Type</label><select class="input" name="type">${[['expense', 'Expense'], ['income', 'Income'], ['debt', 'Mortgage / loan payment']].map(([k, l]) => html`<option value="${k}" ${k === (e.kind || 'expense') ? raw('selected') : ''}>${l}</option>`)}</select></div>
        <div class="field"><label>Date</label><input class="input" type="date" name="date" value="${e.date || F.todayISO()}" required></div>
        <div class="field"><label>Amount</label><span class="money-wrap"><input class="input" name="amount" inputmode="decimal" value="${e.amount ?? ''}" required></span></div>
        <div class="field"><label>Category</label><input class="input" name="category" list="pe-cats" value="${e.category || ''}" placeholder="e.g. Repairs, Insurance, Rent">${F.datalist('pe-cats', new Set(['Rent', 'Repairs & maintenance', 'Insurance', 'Property tax', 'HOA', 'Utilities', 'Management', 'Supplies', 'Legal & fees', ...cats]))}</div>
        <div class="field full"><label>Description</label><input class="input" name="description" value="${e.description || ''}"></div>
        <div class="field full"><label>Receipt link</label><input class="input" name="receipt_url" value="${e.receipt_url || ''}" placeholder="https://… or C:\\Users\\…\\receipt.pdf"></div>
        <div class="field full"><label>Notes</label><textarea class="input" name="notes" rows="2">${e.notes || ''}</textarea></div></div>`,
      danger: e.ref ? { label: 'Delete', onClick: async () => { if (await F.confirm('Delete this entry?')) { await F.del('/api/property_entry', { id: e.ref }); F.refresh(); return true; } return false; } } : null,
      onSubmit: async (v) => {
        if (!v.amount || Number.isNaN(+v.amount.replace(/[$,]/g, ''))) { F.toast('Enter an amount', { kind: 'error' }); return false; }
        await F.post('/api/property_entry', { ...v, id: e.ref, property_id: pid, amount: v.amount.replace(/[$,]/g, '') });
        F.toast('Entry saved'); F.refresh();
      },
    });
  }

  F.pages.properties = async (root, r, ctl) => {
    if (r.id) return detail(root, r, ctl);
    const year = r.params.year || String(new Date().getFullYear());
    const d = await F.get('/api/properties', { year });
    if (!ctl.alive()) return;
    const b = d.business;
    const unRow = (t) => html`<div class="list-item"><div class="main-col"><button type="button" class="title linkish" data-txn="${t.txn_id}">${t.merchant_name}</button><div class="meta">${fmt.date(t.posted_date)} · ${t.category || ''}${t.subcategory ? ' · ' + t.subcategory : ''}</div></div>
            <select class="input sm assign" data-assign="${t.txn_id}" aria-label="Assign ${t.merchant_name} to a property"><option value="">Assign to…</option>${d.properties.map((p) => html`<option value="${p.entity || p.name}">${p.name}</option>`)}</select>
            <span class="amount">${F.amtCell(t.amount)}</span></div>`;
    F.setHTML(root, html`
      ${F.head({ title: 'Properties', lede: 'Rentals and our home. Jenny’s sheet covers the months it has; bank transactions tagged to a property fill in the rest, plus anything entered here.',
        actions: html`<select class="input sm" data-year style="width:auto" aria-label="Year">${d.years.map((y) => html`<option ${y === year ? raw('selected') : ''}>${y}</option>`)}</select><button type="button" class="btn primary" data-add>${icon('plus')}Add property</button>` })}
      <section class="band" style="--n:5" aria-label="Rental business ${year}">
        ${F.kpi(`Rent in · ${year}`, F.kpiMoney(b.income), `${d.rentals} active rental${d.rentals === 1 ? '' : 's'}`, { vcls: 'accent' })}
        ${F.kpi('Expenses', F.kpiMoney(-b.expenses), 'Repairs, HOA, utilities…')}
        ${F.kpi('NOI', F.kpiMoney(b.noi), 'Net operating income, before mortgage')}
        ${F.kpi('Mortgage', F.kpiMoney(-b.debt_service), 'Principal, interest, escrow')}
        ${F.kpi('Cash flow', F.kpiMoney(b.cash_flow), 'After mortgage', { vcls: b.cash_flow < 0 ? 'alert-text' : '' })}
      </section>
      <div class="grid">
        ${d.properties.map((pr) => html`<a class="prop span-6" href="#/properties/${pr.id}">
          <div class="panel-head"><h2>${pr.name}</h2>${statusPill(pr.status)}<div class="tools">${F.spark(pr.spark.map((s) => s.cash_flow), { color: 'var(--accent)' })}</div></div>
          <div class="panel-body"><div class="small ink2">${[pr.address !== pr.name ? pr.address : '', pr.rent ? `${fmt.money(pr.rent, { cents: false })}/mo rent` : '', pr.tenant ? `Tenant ${pr.tenant}` : '', pr.lease_end ? `lease to ${fmt.date(pr.lease_end, { year: true })}` : ''].filter(Boolean).join(' · ') || (pr.status === 'primary residence' ? 'Costs only' : 'Add rent, tenant and value')}</div>
            <dl class="figs">
              <div><dt>Income</dt><dd>${fmt.amt(pr.kpis.income, { cents: false })}</dd></div>
              <div><dt>Expenses</dt><dd>${fmt.amt(-pr.kpis.expenses, { cents: false })}</dd></div>
              <div><dt>Mortgage</dt><dd>${fmt.amt(-pr.kpis.debt_service, { cents: false })}</dd></div>
              <div><dt>${pr.status === 'primary residence' ? 'Total cost' : 'Cash flow'}</dt><dd class="${pr.kpis.cash_flow > 0 ? 'pos' : ''}">${fmt.amt(pr.kpis.cash_flow, { cents: false, sign: true })}</dd></div>
              <div><dt>Loan</dt><dd>${pr.mortgage_balance ? fmt.amt(-pr.mortgage_balance, { cents: false }) : '—'}</dd></div>
              <div><dt>Equity</dt><dd>${pr.equity !== null && pr.equity !== undefined ? fmt.amt(pr.equity, { cents: false }) : '—'}</dd></div>
            </dl></div></a>`)}
        <section class="span-12"><div class="panel-head"><h2>Rental business transactions without a property</h2><span class="sub">${year} · assign each to a property so it lands in that property’s numbers</span></div>
          <div class="panel-body flush">${[d.unassigned.slice(0, 6), d.unassigned.slice(6, 40)].map((part, i) => (!part.length ? '' : i === 0 ? html`<div class="list">${part.map(unRow)}</div>` : html`<details class="disclosure"><summary>${part.length} more <span class="badge">${Math.min(d.unassigned.length, 40)} in all</span></summary><div class="list">${part.map(unRow)}</div></details>`))}
          ${d.unassigned.length ? '' : F.empty('Everything is assigned')}</div></section>
      </div>`);
    $('[data-year]', root).onchange = (e) => F.go(`#/properties?year=${e.target.value}`);
    $('[data-add]', root).onclick = () => profileModal({}, d.accounts);
    $$('[data-txn]', root).forEach((x) => (x.onclick = () => F.openTxn(x.dataset.txn, { onChange: F.refresh })));
    $$('[data-assign]', root).forEach((s) => (s.onchange = async () => { if (!s.value) return; await F.post('/api/txn', { txn_id: s.dataset.assign, entity: s.value }); F.toast(`Assigned to ${s.options[s.selectedIndex].text}`); F.refresh(); }));
  };

  async function detail(root, r, ctl) {
    const year = r.params.year ?? String(new Date().getFullYear());
    const d = await F.get('/api/property', { id: r.id, year });
    if (!ctl.alive()) return;
    const pr = d.property, k = d.pnl.kpis;
    const isHome = pr.status === 'primary residence';
    const cats = d.pnl.categories;
    const SRC = { sheet: ['neutral', 'Sheet'], bank: ['info', 'Bank'], manual: ['good', 'Entered'] };
    F.setHTML(root, html`
      ${F.head({ crumb: html`<a href="#/properties">Properties</a>`, title: pr.name, lede: html`${statusPill(pr.status)} ${pr.address && pr.address !== pr.name ? pr.address : ''}`,
        actions: html`<select class="input sm" data-year style="width:auto" aria-label="Year"><option value="">All years</option>${d.pnl.years.map((y) => html`<option ${y === year ? raw('selected') : ''}>${y}</option>`)}</select>
          <button type="button" class="btn" data-edit>${icon('edit')}Edit profile</button><button type="button" class="btn primary" data-entry>${icon('plus')}Add entry</button>` })}
      <section class="band" style="--n:6" aria-label="Profit and loss">
        ${F.kpi('Income', F.kpiMoney(k.income), `${k.months} month${k.months === 1 ? '' : 's'} with activity`, { vcls: 'accent' })}
        ${F.kpi('Expenses', F.kpiMoney(-k.expenses), 'Operating')}
        ${F.kpi('NOI', F.kpiMoney(k.noi), 'Before mortgage')}
        ${F.kpi('Cash flow', F.kpiMoney(k.cash_flow), `After ${fmt.money(k.debt_service, { cents: false })} mortgage`, { vcls: k.cash_flow < 0 ? 'alert-text' : '' })}
        ${F.kpi('Cap rate', k.cap_rate !== null ? fmt.pct(k.cap_rate, 1) : '—', pr.est_value ? 'Annualized NOI ÷ value' : 'Add an estimated value')}
        ${F.kpi('Cash-on-cash', k.cash_on_cash !== null ? fmt.pct(k.cash_on_cash, 1) : '—', pr.cash_invested ? 'Annual cash flow ÷ cash in' : 'Add cash invested')}
      </section>
      <div class="grid">
        <section class="panel span-8"><div class="panel-head"><h2>Month by month</h2><span class="sub">Income up, costs down; the line is cash flow</span></div>
          <div class="panel-body"><div class="chart h-260" id="pl-chart"></div>${F.legend([{ label: 'Income', color: F.css('--accent') }, { label: 'Expenses', color: F.css('--ink') }, { label: 'Mortgage', color: F.css('--faint') }, { label: 'Cash flow', color: F.css('--s2'), type: 'line' }])}</div></section>
        <section class="panel span-4"><div class="panel-head"><h2>Where the money goes</h2></div><div class="panel-body flush">${cats.length ? F.hbars(cats.map((c) => ({ label: c.name, value: c.total })), { valueFmt: (v) => fmt.amt(v, { cents: false }) }) : F.empty('No expenses recorded')}</div></section>
        <section class="panel span-8"><div class="panel-head"><h2>Ledger</h2><span class="sub">${d.pnl.lines.length} entries</span></div>
          <div class="panel-body flush"><div class="table-wrap" style="max-height:560px;overflow-y:auto"><table class="t"><thead><tr><th>Date</th><th>Description</th><th class="hide-sm">Category</th><th>Source</th><th class="num">Amount</th></tr></thead>
          <tbody>${d.pnl.lines.map((l, i) => html`<tr class="${l.source !== 'sheet' ? 'clickable' : ''}" data-line="${i}" ${l.source !== 'sheet' ? raw('tabindex="0"') : ''}><td class="nowrap">${fmt.date(l.date, { year: true })}</td><td>${l.description}${l.flagged ? html` <span class="pill warn">${l.flagged}</span>` : ''}${l.receipt_url ? html` <span class="pill info">Receipt</span>` : ''}</td>
            <td class="hide-sm">${l.category}</td><td data-label=""><span class="pill ${SRC[l.source][0]}">${SRC[l.source][1]}</span></td><td class="num key ${l.kind === 'income' ? 'pos' : ''}">${l.kind === 'income' ? '+' : '−'}${fmt.amt(Math.abs(l.amount))}</td></tr>`)}</tbody></table></div>
          ${d.pnl.lines.length ? '' : F.empty('Nothing recorded for this period')}</div></section>
        <section class="span-4 stack">
          <div class="panel"><div class="panel-head"><h2>Profile</h2></div><div class="panel-body"><dl class="kv">
            <dt>Purchased</dt><dd>${pr.purchase_date ? fmt.date(pr.purchase_date, { year: true }) : '—'}${pr.purchase_price ? ' for ' + fmt.money(pr.purchase_price, { cents: false }) : ''}</dd>
            <dt>Estimated value</dt><dd>${pr.est_value ? fmt.money(pr.est_value, { cents: false }) : '—'}</dd>
            <dt>Loan balance</dt><dd>${pr.mortgage_balance ? `${fmt.money(pr.mortgage_balance, { cents: false })} · ${fmt.ago(pr.mortgage_as_of)}` : '—'}</dd>
            <dt>Equity</dt><dd>${pr.equity !== null && pr.equity !== undefined ? fmt.money(pr.equity, { cents: false }) : '—'}</dd>
            ${!isHome ? html`<dt>Rent</dt><dd>${pr.rent ? fmt.money(pr.rent, { cents: false }) + ' a month' : '—'}</dd><dt>Tenant</dt><dd>${pr.tenant || '—'}${pr.lease_end ? ` · lease ends ${fmt.date(pr.lease_end, { year: true })}` : ''}</dd>` : ''}
            ${pr.rate ? html`<dt>Rate</dt><dd>${pr.rate}%</dd>` : ''}${pr.notes ? html`<dt>Notes</dt><dd>${pr.notes}</dd>` : ''}</dl></div></div>
          ${d.loans.some((l) => l.points.length > 1) ? html`<div class="panel"><div class="panel-head"><h2>Loan balance</h2></div><div class="panel-body"><div class="chart h-180" id="loan-chart"></div></div></div>` : ''}
          <div class="panel"><div class="panel-head"><h2>Notes</h2></div><div class="panel-body" id="prop-notes"></div></div>
        </section>
      </div>`);
    $('[data-year]', root).onchange = (e) => F.go(`#/properties/${pr.id}?year=${e.target.value}`);
    $('[data-edit]', root).onclick = () => profileModal(pr, d.accounts);
    $('[data-entry]', root).onclick = () => entryModal(pr.id, {}, cats.map((c) => c.name));
    $$('tr[data-line]', root).forEach((tr) => (tr.onkeydown = (e) => { if (e.key === 'Enter') tr.click(); }, tr.onclick = () => {
      const l = d.pnl.lines[+tr.dataset.line];
      if (l.source === 'manual') entryModal(pr.id, l, cats.map((c) => c.name));
      else if (l.source === 'bank') F.openTxn(l.ref, { onChange: F.refresh });
    }));
    F.notesBlock($('#prop-notes', root), 'property', String(pr.id), d.notes, { compact: true, placeholder: 'e.g. Tenant asked about renewing in March' });
    const draw = () => {
      if (!F.hasCharts) return;
      const m = d.pnl.months;
      if (m.length) {
        const o = F.chartOpts({ kind: 'bar', stacked: true });
        F.chart($('#pl-chart', root), { type: 'bar', aria: 'Monthly income, expenses and cash flow',
          data: { labels: m.map((x) => fmt.month(x.month, { short: true })), datasets: [
            { ...F.stackDs('Income', m.map((x) => x.income), F.css('--accent')), stack: 'a' },
            { ...F.stackDs('Expenses', m.map((x) => -x.expense), F.css('--ink')), stack: 'a' },
            { ...F.stackDs('Mortgage', m.map((x) => -x.debt), F.css('--faint')), stack: 'a' },
            { type: 'line', ...F.lineDs('Cash flow', m.map((x) => x.cash_flow), F.css('--s2'), { pointRadius: 3, pointBackgroundColor: F.css('--s2'), pointBorderColor: F.css('--page'), pointBorderWidth: 1 }), stack: 'line' }] },
          options: o });
      } else { $('#pl-chart', root).classList.add('is-empty'); F.setHTML($('#pl-chart', root), F.empty('No activity in this period')); }
      const lc = $('#loan-chart', root);
      if (lc) {
        const loans = d.loans.filter((l) => l.points.length > 1);
        const dates = [...new Set(loans.flatMap((l) => l.points.map((p) => p.date)))].sort();
        F.chart(lc, { type: 'line', aria: 'Loan balance', data: { labels: dates.map((x) => fmt.month(x, { short: true })), datasets: loans.map((l, i) => F.lineDs(l.name, dates.map((dt) => { const p = l.points.find((q) => q.date === dt); return p ? p.balance : null; }), i ? F.css(`--s${i + 1}`) : F.css('--ink'))) },
          options: F.chartOpts({ kind: 'line', beginAtZero: false }) });
      }
    };
    draw();
    ctl.rerender = () => { F.destroyCharts(); draw(); };
  }
})();
