/* Properties & rental business: profiles, P&L, ledger entries, notes. */
'use strict';
(function () {
  const { html, raw, fmt, icon, $, $$ } = F;
  const STATUS = { rented: ['good', 'Rented'], vacant: ['warn', 'Vacant'], 'primary residence': ['info', 'Our home'], sold: ['neutral', 'Sold'], other: ['neutral', 'Other'] };
  const statusPill = (s) => { const [c, l] = STATUS[s] || ['neutral', s || '—']; return html`<span class="pill ${c}">${l}</span>`; };
  const NOT_PROP = 'not-property-specific';
  const shareOf = (pr) => (pr.share === undefined || pr.share === null ? 1 : pr.share);
  const sharePct = (pr) => { const v = shareOf(pr) * 100; return Math.abs(v - Math.round(v)) < 0.01 ? `${Math.round(v)}%` : `${v.toFixed(1)}%`; };
  const shareWords = (pr) => (Math.abs(shareOf(pr) - 1 / 3) < 0.001 ? 'One third' : sharePct(pr));
  const withTag = (tags, tag, on) => { const s = new Set((tags || '').split(',').map((x) => x.trim()).filter(Boolean)); if (on) s.add(tag); else s.delete(tag); return [...s].join(','); };

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
        <div class="field"><label>Our ownership %</label><input class="input" name="ownership_pct" inputmode="decimal" value="${pr.ownership_pct ?? ''}" placeholder="100"><span class="hint">Net worth counts this share of the value</span></div>
        <div class="field"><label>Value source</label><input class="input" name="value_source" value="${pr.value_source || ''}" placeholder="e.g. Redfin Estimate"></div>
        <div class="field"><label>Sale date</label><input class="input" type="date" name="sale_date" value="${pr.sale_date || ''}"><span class="hint">Leaves net worth from this date</span></div>
        <div class="field"><label>Sale price</label><span class="money-wrap"><input class="input" name="sale_price" inputmode="decimal" value="${pr.sale_price ?? ''}"></span></div>
        <div class="field"><label>Net sale proceeds</label><span class="money-wrap"><input class="input" name="sale_proceeds" inputmode="decimal" value="${pr.sale_proceeds ?? ''}"></span><span class="hint">What reached the bank after payoff and closing costs</span></div>
        <div class="field"><label>Mortgage account</label><select class="input" name="mortgage_account_id"><option value="">None linked</option>${(accounts || []).map((a) => html`<option value="${a.account_id}" ${a.account_id === pr.mortgage_account_id ? raw('selected') : ''}>${a.name}</option>`)}</select></div>
        <div class="field"><label>Interest rate %</label><input class="input" name="rate" inputmode="decimal" value="${pr.rate ?? ''}"></div>
        <div class="field"><label>Monthly rent</label><span class="money-wrap"><input class="input" name="rent" inputmode="decimal" value="${pr.rent ?? ''}"></span></div>
        <div class="field"><label>Tenant</label><input class="input" name="tenant" value="${pr.tenant || ''}"></div>
        <div class="field"><label>Lease ends</label><input class="input" type="date" name="lease_end" value="${pr.lease_end || ''}"></div>
        <div class="field"><label>Rental since</label><input class="input" type="date" name="rental_start" value="${pr.rental_start || ''}"><span class="hint">Earlier months count as primary-home costs, not rental P&amp;L</span></div>
        <div class="field"><label>Rental until</label><input class="input" type="date" name="rental_end" value="${pr.rental_end || ''}"><span class="hint">Optional, e.g. if you moved back in</span></div>
        <div class="field"><label>Entity name in transactions</label><select class="input" name="entity">${F.entityOptions(pr.entity || pr.name || '', pr.name || 'household')}</select></div>
        <div class="field full"><label>Notes</label><textarea class="input" name="notes" rows="2">${pr.notes || ''}</textarea></div></div>`,
      onSubmit: async (v) => {
        const clean = (x) => (x || '').replace(/[$,]/g, '');
        const r = await F.post('/api/property', { ...v, id: pr.id, purchase_price: clean(v.purchase_price), est_value: clean(v.est_value), cash_invested: clean(v.cash_invested), rent: clean(v.rent),
          ownership_pct: clean(v.ownership_pct).replace('%', ''), sale_price: clean(v.sale_price), sale_proceeds: clean(v.sale_proceeds),
          value_as_of: clean(v.est_value) !== String(pr.est_value ?? '') ? F.todayISO() : (pr.value_as_of || '') });
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
    const unRow = (t) => html`<div class="list-item"><div class="main-col"><button type="button" class="title linkish" data-txn="${t.txn_id}">${t.merchant_name}</button><div class="meta">${fmt.date(t.posted_date)} · ${t.account}${t.category ? ' · ' + t.category : ''}${t.subcategory ? ' · ' + t.subcategory : ''}</div></div>
            <select class="input sm assign" data-assign="${t.txn_id}" aria-label="Assign ${t.merchant_name} to a property"><option value="">Assign to…</option>${d.properties.filter((p) => p.status !== 'sold' || (p.sale_date && t.posted_date <= p.sale_date)).map((p) => html`<option value="${p.entity || p.name}">${p.name}</option>`)}</select>
            <button type="button" class="btn sm ghost np" data-general="${t.txn_id}" title="It's a cost of the rental business as a whole (bank fees, software, an LLC filing…), not of one property">Not property-specific</button>
            <span class="amount np-amt">${F.amtCell(t.amount)}</span></div>`;
    F.setHTML(root, html`
      ${F.head({ title: 'Properties', lede: 'Rentals and our home. Jenny’s sheet covers the months it has; bank transactions tagged to a property fill in the rest, plus anything entered here.',
        actions: html`<select class="input sm" data-year style="width:auto" aria-label="Year">${d.years.map((y) => html`<option ${y === year ? raw('selected') : ''}>${y}</option>`)}</select><button type="button" class="btn primary" data-add>${icon('plus')}Add property</button>` })}
      <section class="band" style="--n:5" aria-label="Rental business ${year}">
        ${F.kpi(`Rent in · ${year}`, F.kpiMoney(b.income), `${d.rentals} active rental${d.rentals === 1 ? '' : 's'}${d.co_owned ? ' we fully own' : ''}`, { vcls: 'accent' })}
        ${F.kpi('Expenses', F.kpiMoney(-b.expenses), 'Repairs, HOA, utilities…')}
        ${F.kpi('NOI', F.kpiMoney(b.noi), 'Net operating income, before mortgage')}
        ${F.kpi('Mortgage', F.kpiMoney(-b.debt_service), 'Principal, interest, escrow')}
        ${F.kpi('Cash flow', F.kpiMoney(b.cash_flow), 'After mortgage', { vcls: b.cash_flow < 0 ? 'alert-text' : '' })}
      </section>
      <div class="grid">
        ${d.properties.map((pr) => html`<a class="prop span-6" href="#/properties/${pr.id}">
          <div class="panel-head"><h2>${pr.name}</h2>${statusPill(pr.status)}<div class="tools">${F.spark(pr.spark.map((s) => s.cash_flow), { color: 'var(--accent)' })}</div></div>
          <div class="panel-body"><div class="small ink2">${[pr.address !== pr.name ? pr.address : '', shareOf(pr) !== 1 ? `${shareWords(pr)} ours, co-owned` : '', pr.status === 'sold' && pr.sale_date ? `Sold ${fmt.date(pr.sale_date, { year: true })}${pr.sale_price ? ' for ' + fmt.money(pr.sale_price, { cents: false }) : ''}` : '', pr.rent ? `${fmt.money(pr.rent, { cents: false })}/mo rent` : '', pr.tenant ? `Tenant ${pr.tenant}` : '', pr.lease_end ? `lease to ${fmt.date(pr.lease_end, { year: true })}` : ''].filter(Boolean).join(' · ') || (pr.status === 'primary residence' ? 'Costs only' : 'Add rent, tenant and value')}</div>
            <dl class="figs">
              <div><dt>Income</dt><dd>${fmt.amt(pr.kpis.income, { cents: false })}</dd></div>
              <div><dt>Expenses</dt><dd>${fmt.amt(-pr.kpis.expenses, { cents: false })}</dd></div>
              <div><dt>Mortgage</dt><dd>${fmt.amt(-pr.kpis.debt_service, { cents: false })}</dd></div>
              <div><dt>${pr.status === 'primary residence' ? 'Total cost' : 'Cash flow'}</dt><dd class="${pr.kpis.cash_flow > 0 ? 'pos' : ''}">${fmt.amt(pr.kpis.cash_flow, { cents: false, sign: true })}</dd></div>
              <div><dt>Loan</dt><dd>${pr.mortgage_balance ? fmt.amt(-pr.mortgage_balance, { cents: false }) : '—'}</dd></div>
              ${shareOf(pr) !== 1 ? html`<div><dt>Our equity · ${sharePct(pr)}</dt><dd>${pr.our_equity !== null && pr.our_equity !== undefined ? fmt.amt(pr.our_equity, { cents: false }) : '—'}</dd></div>`
                : pr.status === 'sold' && pr.sale_proceeds ? html`<div><dt>Net proceeds</dt><dd>${fmt.amt(pr.sale_proceeds, { cents: false })}</dd></div>`
                : html`<div><dt>Equity</dt><dd>${pr.equity !== null && pr.equity !== undefined ? fmt.amt(pr.equity, { cents: false }) : '—'}</dd></div>`}
            </dl></div></a>`)}
        <section class="span-12"><div class="panel-head"><h2>Rental business transactions without a property</h2><span class="sub">${year} · assign each to a property so it lands in that property’s numbers, or mark it not property-specific${d.not_property ? ` · ${d.not_property} marked not property-specific` : ''}</span></div>
          <div class="panel-body flush">${[d.unassigned.slice(0, 6), d.unassigned.slice(6, 40)].map((part, i) => (!part.length ? '' : i === 0 ? html`<div class="list">${part.map(unRow)}</div>` : html`<details class="disclosure"><summary>${part.length} more <span class="badge">${Math.min(d.unassigned.length, 40)} in all</span></summary><div class="list">${part.map(unRow)}</div></details>`))}
          ${d.unassigned.length ? '' : F.empty('Everything is assigned')}</div></section>
      </div>`);
    $('[data-year]', root).onchange = (e) => F.go(`#/properties?year=${e.target.value}`);
    $('[data-add]', root).onclick = () => profileModal({}, d.accounts);
    $$('[data-txn]', root).forEach((x) => (x.onclick = () => F.openTxn(x.dataset.txn, { onChange: F.refresh })));
    $$('[data-assign]', root).forEach((s) => (s.onchange = async () => { if (!s.value) return; await F.post('/api/txn', { txn_id: s.dataset.assign, entity: s.value }); F.toast(`Assigned to ${s.options[s.selectedIndex].text}`); F.refresh(); }));
    // "Not property-specific": tags the transaction (kept on every sync; the categorizer also tags later charges from the
    // same merchant), so it leaves this list. Undo removes the tag.
    $$('[data-general]', root).forEach((btn) => (btn.onclick = async () => {
      const t = d.unassigned.find((x) => x.txn_id === btn.dataset.general);
      if (!t) return;
      btn.disabled = true;
      try { await F.post('/api/txn', { txn_id: t.txn_id, tags: withTag(t.tags, NOT_PROP, true) }); } catch (e) { btn.disabled = false; return; }
      F.toast(`${t.merchant_name} marked not property-specific`, { action: 'Undo', ms: 6000, onAction: async () => {
        const cur = await F.get('/api/txn', { id: t.txn_id }).catch(() => null);
        const tags = cur && (cur.txn || cur).tags !== undefined ? (cur.txn || cur).tags : withTag(t.tags, 'manual', true);
        await F.post('/api/txn', { txn_id: t.txn_id, tags: withTag(tags, NOT_PROP, false) }); F.refresh();
      } });
      F.refresh();
    }));
  };

  // months a payment covers, compressed: ['2024-08','2024-10','2024-11'] -> 'Aug, Oct–Nov 2024'
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function covLabel(ms) {
    if (!ms || !ms.length) return '';
    const byYear = new Map();
    for (const m of [...ms].sort()) { const y = m.slice(0, 4); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(+m.slice(5, 7)); }
    return [...byYear.entries()].map(([y, ns]) => {
      const runs = [];
      for (const n of ns) { const r = runs[runs.length - 1]; if (r && n === r[1] + 1) r[1] = n; else runs.push([n, n]); }
      return runs.map(([a, b]) => (a === b ? MON[a - 1] : `${MON[a - 1]}–${MON[b - 1]}`)).join(', ') + ' ' + y;
    }).join('; ');
  }
  const money0 = (v) => fmt.money(v, { cents: false });

  // owner distributions per partner per year; with a sheet ledger, also the months each partner has been paid for, what
  // is still unpaid (catch-up), and every payment with the months it covers
  function distPanel(dd) {
    const latest = Object.values(dd.last).sort().pop() || '';
    const stopped = (p) => dd.last[p] && latest && (Date.parse(latest) - Date.parse(dd.last[p])) / 864e5 > 120;
    const cov = dd.coverage || [];
    const covRow = (c) => html`<div class="list-item partner"><div class="main-col"><span class="title">${c.person}
        ${c.stopped ? html`<span class="pill neutral">Stopped</span>` : c.behind.length || c.gaps.length ? html`<span class="pill warn">Owed ${c.behind.length + c.gaps.length} mo</span>` : html`<span class="pill good">Up to date</span>`}</span>
      <span class="meta">Paid through ${fmt.month(c.covered_through)} · ${c.months_covered} months in ${c.payments} payment${c.payments === 1 ? '' : 's'}${c.batches ? ` (${c.batches} catch-up batch${c.batches === 1 ? '' : 'es'})` : ''}</span>
      ${c.behind.length || c.gaps.length ? html`<span class="meta warn-text">Not yet paid: ${covLabel([...c.gaps, ...c.behind])}${c.owed_estimate ? ` · about ${money0(c.owed_estimate)}` : ''}</span>` : ''}
      ${c.draws ? html`<span class="meta">Includes ${fmt.money(c.draws)} of personal charges on the account</span>` : ''}</div>
      <span class="amount">${money0(dd.total[c.person] || 0)}</span></div>`;
    const pays = dd.payments || [];
    const SRCP = { both: ['good', 'Sheet + bank'], sheet: ['neutral', 'Sheet'], bank: ['info', 'Bank'] };
    const payRow = (x) => html`<tr title="${SRCP[x.source][1]}${x.flagged ? ' · ' + x.flagged : ''}"${x.txn_id ? raw(` class="clickable" tabindex="0" data-btxn="${x.txn_id}"`) : ''}><td class="nowrap">${fmt.date(x.date, { year: true })}</td>
      <td data-label="">${x.person}${x.kind === 'draw' ? html` <span class="pill neutral">Personal charge</span>` : ''}</td>
      <td data-label="For">${covLabel(x.covers) || '—'}${x.flagged ? html` <span class="pill warn">Check</span>` : ''}</td>
      <td class="num key">${fmt.money(x.amount)}</td></tr>`;
    return html`<div class="panel"><div class="panel-head"><h2>Owner distributions</h2><span class="sub">Paid out of the property’s account${dd.rate ? ` · now ${money0(dd.rate)} a month each` : ''}</span></div>
      <div class="panel-body flush">
      ${cov.length ? html`<div class="list">${cov.map(covRow)}</div>` : ''}
      <div class="table-wrap"><table class="t"><thead><tr><th>Year</th>${dd.partners.map((p) => html`<th class="num">${p}</th>`)}</tr></thead>
      <tbody>${dd.rows.map((r) => html`<tr><td data-label=""><b>${r.year}</b></td>${dd.partners.map((p) => html`<td class="num" data-label="${p}">${r.by[p] ? money0(r.by[p]) : '—'}</td>`)}</tr>`)}
      <tr><td data-label=""><b>Last paid</b></td>${dd.partners.map((p) => html`<td class="num small" data-label="${p}">${fmt.date(dd.last[p], { year: true })}${stopped(p) && !cov.length ? html`<br><span class="pill neutral">Stopped</span>` : ''}</td>`)}</tr></tbody></table></div>
      ${pays.length ? html`<details class="disclosure"><summary>Payments <span class="badge">${pays.length}</span></summary><div class="table-wrap"><table class="t">
        <thead><tr><th>Date</th><th>Partner</th><th>For</th><th class="num">Amount</th></tr></thead><tbody>${pays.map(payRow)}</tbody></table></div></details>` : ''}
      </div></div>`;
  }

  // the property account month by month, like its sheet: income, costs, deposits, owner payouts, net, ending balance
  function cashflowPanel(cf, year) {
    const ms = [...cf.months].reverse();
    const sum = (k) => ms.reduce((a, x) => a + (x[k] || 0), 0);
    const row = (x) => html`<tr><td class="nowrap"><b>${fmt.month(x.month, { short: true })}</b></td>
      <td class="num" data-label="In">${x.income ? money0(x.income) : '—'}</td>
      <td class="num" data-label="Costs">${x.expenses ? '−' + fmt.money(x.expenses, { cents: false }) : '—'}</td>
      <td class="num hide-sm" data-label="Deposits">${x.deposits ? (x.deposits > 0 ? '+' : '−') + money0(Math.abs(x.deposits)) : '—'}</td>
      <td class="num" data-label="Owners">${x.take_home ? '−' + money0(x.take_home) : '—'}</td>
      <td class="num key ${x.net > 0 ? 'pos' : ''}">${x.net > 0 ? '+' : x.net < 0 ? '−' : ''}${money0(Math.abs(x.net))}</td>
      <td class="num" data-label="Balance">${x.end !== null && x.end !== undefined ? fmt.money(x.end) : '—'}</td></tr>`;
    const head = html`<thead><tr><th>Month</th><th class="num">Income</th><th class="num">Expenses</th><th class="num hide-sm">Deposits</th><th class="num">Owners</th><th class="num">Net</th><th class="num">Balance</th></tr></thead>`;
    const bc = cf.bank_check;
    const n = 12;
    return html`<section class="panel span-12" id="cashflow"><div class="panel-head"><h2>Cash flow by month</h2>
        <span class="sub">${year || 'All years'} · income, operating costs, security deposits (in − refunded) and owner payouts; the balance is the account’s month-end balance</span></div>
      <div class="panel-body flush">
      ${bc ? html`<p class="small ${bc.differs ? 'warn-text' : 'ink2'}" style="margin:0 0 8px;padding:0 var(--pad, 16px)">${bc.differs ? `The books show ${fmt.money(bc.rolled)}; the bank shows ${fmt.money(bc.balance)} on ${fmt.date(bc.as_of, { year: true })}` : `Reconciled with the bank: ${fmt.money(bc.balance)} on ${fmt.date(bc.as_of, { year: true })}`}</p>` : ''}
      <div class="table-wrap"><table class="t cf">${head}<tbody>${ms.slice(0, n).map(row)}</tbody>
        <tfoot><tr><td><b>${ms.length} months</b></td><td class="num" data-label="In">${money0(sum('income'))}</td><td class="num" data-label="Costs">−${money0(sum('expenses'))}</td>
          <td class="num hide-sm" data-label="Deposits">${sum('deposits') ? money0(sum('deposits')) : '—'}</td><td class="num" data-label="Owners">−${money0(sum('take_home'))}</td>
          <td class="num key">${sum('net') < 0 ? '−' : '+'}${money0(Math.abs(sum('net')))}</td><td></td></tr></tfoot></table></div>
      ${ms.length > n ? html`<details class="disclosure"><summary>${ms.length - n} earlier months</summary><div class="table-wrap"><table class="t cf">${head}<tbody>${ms.slice(n).map(row)}</tbody></table></div></details>` : ''}
      ${ms.length ? '' : F.empty('No activity in this period')}</div></section>`;
  }

  // operating expenses by category, one column per year
  function expYearPanel(ey) {
    const ys = ey.years;
    return html`<section class="panel span-7"><div class="panel-head"><h2>Expenses by category</h2><span class="sub">Operating costs per year</span></div>
      <div class="panel-body flush"><div class="table-wrap"><table class="t"><thead><tr><th>Category</th>${ys.map((y) => html`<th class="num">${y}</th>`)}<th class="num">Total</th></tr></thead>
      <tbody>${ey.categories.map((c) => html`<tr><td>${c.name}</td>${ys.map((y) => html`<td class="num" data-label="${y}">${c.by[y] ? money0(c.by[y]) : '—'}</td>`)}<td class="num key">${money0(c.total)}</td></tr>`)}</tbody>
      <tfoot><tr><td><b>Total</b></td>${ys.map((y) => html`<td class="num" data-label="${y}"><b>${money0(ey.totals[y] || 0)}</b></td>`)}<td class="num key">${money0(ys.reduce((a, y) => a + (ey.totals[y] || 0), 0))}</td></tr></tfoot></table></div>
      ${ey.categories.length ? '' : F.empty('No expenses recorded')}</div></section>`;
  }

  // the property account's register: every movement of its money, newest first (bank rows open the transaction)
  function registerPanel(pr, reg) {
    const rows = reg.rows;
    const row = (t) => html`<tr${t.source !== 'sheet' ? raw(` class="clickable" tabindex="0" data-reg="${t.source}:${t.ref}"`) : ''}><td class="nowrap">${fmt.date(t.date, { year: true })}</td>
      <td>${t.description}${t.person ? html` <span class="pill neutral">${t.person}</span>` : ''}</td>
      <td class="hide-sm">${t.category}</td><td class="num key">${F.amtCell(t.amount)}</td></tr>`;
    const head = html`<thead><tr><th>Date</th><th>Description</th><th class="hide-sm">Category</th><th class="num">Amount</th></tr></thead>`;
    const n = 15;
    return html`<section class="panel span-12" id="register"><div class="panel-head"><h2>Transactions</h2>
        <span class="sub">${rows.length} · everything in and out of ${pr.bank_accounts.map((a) => a.label).join(', ')}${reg.bank_from ? ` · from the bank since ${fmt.month(reg.bank_from)}, the family sheet before` : ''}</span></div>
      <div class="panel-body flush"><div class="table-wrap"><table class="t">${head}<tbody>${rows.slice(0, n).map(row)}</tbody></table></div>
      ${rows.length > n ? html`<details class="disclosure"><summary>${rows.length - n} more</summary><div class="table-wrap"><table class="t">${head}<tbody>${rows.slice(n).map(row)}</tbody></table></div></details>` : ''}
      ${rows.length ? '' : F.empty('Nothing in this period')}</div></section>`;
  }

  // months before properties.rental_start (or after rental_end): costs of living there, kept out of the rental P&L
  function preRentalPanel(pr) {
    return html`<section class="panel span-8"><div class="panel-head"><h2>Before it was a rental</h2>
      <span class="sub">Primary home costs${pr.rental_start ? ` before ${fmt.date(pr.rental_start, { year: true })}` : ''}${pr.rental_end ? ` and after ${fmt.date(pr.rental_end, { year: true })}` : ''}; not in this rental's P&amp;L</span></div>
      <div class="panel-body flush"><div class="table-wrap"><table class="t"><thead><tr><th>Year</th><th class="num">Mortgage</th><th class="num">Other costs</th><th class="num">Total cost</th></tr></thead>
      <tbody>${pr.years.map((y) => html`<tr><td>${y.year}</td><td class="num" data-label="Mortgage">${fmt.amt(-y.debt, { cents: false })}</td><td class="num" data-label="Other costs">${fmt.amt(-y.expense, { cents: false })}</td><td class="num key">${fmt.amt(-y.total_cost, { cents: false })}</td></tr>`)}</tbody></table></div>
      ${pr.lines.length ? html`<details class="panel-foot"><summary class="small">${pr.lines.length} entries</summary><div class="table-wrap"><table class="t"><tbody>${pr.lines.map((l) => html`<tr><td class="nowrap">${fmt.date(l.date, { year: true })}</td><td>${l.description}</td><td class="hide-sm">${l.category}</td><td class="num">${l.kind === 'income' ? '+' : '−'}${fmt.amt(Math.abs(l.amount))}</td></tr>`)}</tbody></table></div></details>` : ''}</div></section>`;
  }
  async function detail(root, r, ctl) {
    const year = r.params.year ?? String(new Date().getFullYear());
    const d = await F.get('/api/property', { id: r.id, year });
    if (!ctl.alive()) return;
    const pr = d.property, k = d.pnl.kpis;
    const isHome = pr.status === 'primary residence';
    const cats = d.pnl.categories;
    const SRC = { sheet: ['neutral', 'Sheet'], bank: ['info', 'Bank'], manual: ['good', 'Entered'] };
    // a property with its own bank account (e.g. co-owned): the account is the books, so the page leads with it and
    // shows one register instead of a ledger plus a bank list; no mortgage means cash flow = NOI, so that tile goes
    const own = !!(d.cashflow && (pr.bank_accounts || []).length && d.register);
    const bankTile = () => {
      const a = pr.bank_accounts, bal = pr.bank_balance;
      const asOf = a.map((x) => x.as_of).filter(Boolean).sort().pop();
      return F.kpi('In the account', bal !== null && bal !== undefined ? F.kpiMoney(bal) : '—',
        html`<a href="#/accounts/${encodeURIComponent(a[0].account_id)}">${a.length === 1 ? a[0].label : `${a.length} accounts`}</a>${asOf ? ` · ${fmt.ago(asOf)}` : ''}`);
    };
    F.setHTML(root, html`
      ${F.head({ crumb: html`<a href="#/properties">Properties</a>`, title: pr.name, lede: html`${statusPill(pr.status)} ${pr.address && pr.address !== pr.name ? pr.address : ''}`,
        actions: html`<select class="input sm" data-year style="width:auto" aria-label="Year"><option value="">All years</option>${d.pnl.years.map((y) => html`<option ${y === year ? raw('selected') : ''}>${y}</option>`)}</select>
          <button type="button" class="btn" data-edit>${icon('edit')}Edit profile</button><button type="button" class="btn primary" data-entry>${icon('plus')}Add entry</button>` })}
      <section class="band" style="--n:6" aria-label="Profit and loss">
        ${F.kpi('Income', F.kpiMoney(k.income), `${k.months} month${k.months === 1 ? '' : 's'} with activity`, { vcls: 'accent' })}
        ${F.kpi('Expenses', F.kpiMoney(-k.expenses), 'Operating')}
        ${F.kpi('NOI', F.kpiMoney(k.noi), own && !k.debt_service ? 'Income − expenses' : 'Before mortgage')}
        ${own && !k.debt_service ? '' : F.kpi('Cash flow', F.kpiMoney(k.cash_flow), `After ${fmt.money(k.debt_service, { cents: false })} mortgage`, { vcls: k.cash_flow < 0 ? 'alert-text' : '' })}
        ${own ? F.kpi('Paid to owners', F.kpiMoney(-d.cashflow.paid_to_owners), 'Owner distributions') : ''}
        ${F.kpi('Cap rate', k.cap_rate !== null ? fmt.pct(k.cap_rate, 1) : '—', pr.est_value ? 'Annualized NOI ÷ value' : 'Add an estimated value')}
        ${own ? bankTile() : F.kpi('Cash-on-cash', k.cash_on_cash !== null ? fmt.pct(k.cash_on_cash, 1) : '—', pr.cash_invested ? 'Annual cash flow ÷ cash in' : 'Add cash invested')}
      </section>
      <div class="grid">
      ${own ? html`
        <section class="panel span-8"><div class="panel-head"><h2>Month by month</h2><span class="sub">Income up, costs down; the line is cash flow</span></div>
          <div class="panel-body"><div class="chart h-260" id="pl-chart"></div>${F.legend([{ label: 'Income', color: F.css('--accent') }, { label: 'Expenses', color: F.css('--ink') }, { label: 'Mortgage', color: F.css('--faint') }, { label: 'Cash flow', color: F.css('--s2'), type: 'line' }])}</div></section>
        <section class="span-4 stack">
          ${d.distributions ? distPanel(d.distributions) : ''}
        </section>
        ${cashflowPanel(d.cashflow, year)}
        ${expYearPanel(d.cashflow.expenses_by_year)}
        <section class="span-5 stack">
          <div class="panel"><div class="panel-head"><h2>Profile</h2></div><div class="panel-body"><dl class="kv">
            <dt>Purchased</dt><dd>${pr.purchase_date ? fmt.date(pr.purchase_date, { year: true }) : '—'}${pr.purchase_price ? ' for ' + fmt.money(pr.purchase_price, { cents: false }) : ''}</dd>
            ${pr.rental_start || pr.rental_end ? html`<dt>Rented</dt><dd>${pr.rental_start ? 'Since ' + fmt.date(pr.rental_start, { year: true }) : ''}${pr.rental_end ? (pr.rental_start ? ' until ' : 'Until ') + fmt.date(pr.rental_end, { year: true }) : ''}</dd>` : ''}
            ${shareOf(pr) !== 1 ? html`<dt>Ownership</dt><dd>${shareWords(pr)} ours (${sharePct(pr)}), co-owned with family</dd>` : ''}
            <dt>Estimated value</dt><dd>${pr.est_value ? fmt.money(pr.est_value, { cents: false }) : '—'}${pr.est_value && pr.value_source ? html`<span class="small ink2" style="display:block">${pr.value_source}${pr.value_as_of && !String(pr.value_source).includes(pr.value_as_of) ? ' · ' + fmt.date(pr.value_as_of, { year: true }) : ''}</span>` : ''}</dd>
            ${shareOf(pr) !== 1 && pr.our_value ? html`<dt>Our share</dt><dd>${fmt.money(pr.our_value, { cents: false })} <span class="small ink2">counts toward net worth</span></dd>` : ''}
            ${pr.status === 'sold' ? html`<dt>Sold</dt><dd>${pr.sale_date ? fmt.date(pr.sale_date, { year: true }) : 'Date not recorded'}${pr.sale_price ? ' for ' + fmt.money(pr.sale_price, { cents: false }) : ''}</dd>
              ${pr.sale_proceeds ? html`<dt>Net proceeds</dt><dd>${fmt.money(pr.sale_proceeds, { cents: false })}</dd>` : ''}` : ''}
            <dt>Loan balance</dt><dd>${pr.mortgage_balance ? `${fmt.money(pr.mortgage_balance, { cents: false })} · ${fmt.ago(pr.mortgage_as_of)}` : '—'}</dd>
            ${pr.status === 'sold' ? '' : html`<dt>Equity</dt><dd>${pr.equity !== null && pr.equity !== undefined ? fmt.money(pr.equity, { cents: false }) : '—'}${shareOf(pr) !== 1 && pr.our_equity !== null && pr.our_equity !== undefined ? html` <span class="small ink2">· ours ${fmt.money(pr.our_equity, { cents: false })}</span>` : ''}</dd>`}
            ${!isHome ? html`<dt>Rent</dt><dd>${pr.rent ? fmt.money(pr.rent, { cents: false }) + ' a month' : '—'}</dd><dt>Tenant</dt><dd>${pr.tenant || '—'}${pr.lease_end ? ` · lease ends ${fmt.date(pr.lease_end, { year: true })}` : ''}</dd>` : ''}
            ${pr.rate ? html`<dt>Rate</dt><dd>${pr.rate}%</dd>` : ''}${pr.notes ? html`<dt>Notes</dt><dd>${pr.notes}</dd>` : ''}</dl></div></div>
          ${d.loans.some((l) => l.points.length > 1) ? html`<div class="panel"><div class="panel-head"><h2>Loan balance</h2></div><div class="panel-body"><div class="chart h-180" id="loan-chart"></div></div></div>` : ''}
          <div class="panel"><div class="panel-head"><h2>Notes</h2></div><div class="panel-body" id="prop-notes"></div></div>
        </section>
        ${registerPanel(pr, d.register)}` : html`
        <section class="panel span-8"><div class="panel-head"><h2>Month by month</h2><span class="sub">Income up, costs down; the line is cash flow</span></div>
          <div class="panel-body"><div class="chart h-260" id="pl-chart"></div>${F.legend([{ label: 'Income', color: F.css('--accent') }, { label: 'Expenses', color: F.css('--ink') }, { label: 'Mortgage', color: F.css('--faint') }, { label: 'Cash flow', color: F.css('--s2'), type: 'line' }])}</div></section>
        <section class="panel span-4"><div class="panel-head"><h2>Where the money goes</h2></div><div class="panel-body flush">${cats.length ? F.hbars(cats.map((c) => ({ label: c.name, value: c.total })), { valueFmt: (v) => fmt.amt(v, { cents: false }) }) : F.empty('No expenses recorded')}</div></section>
        ${d.cashflow ? html`${cashflowPanel(d.cashflow, year)}${expYearPanel(d.cashflow.expenses_by_year)}` : ''}
        <section class="panel span-8"><div class="panel-head"><h2>Ledger</h2><span class="sub">${d.pnl.lines.length} entries</span></div>
          <div class="panel-body flush"><div class="table-wrap" style="max-height:560px;overflow-y:auto"><table class="t"><thead><tr><th>Date</th><th>Description</th><th class="hide-sm">Category</th><th>Source</th><th class="num">Amount</th></tr></thead>
          <tbody>${d.pnl.lines.map((l, i) => html`<tr class="${l.source !== 'sheet' ? 'clickable' : ''}" data-line="${i}" ${l.source !== 'sheet' ? raw('tabindex="0"') : ''}><td class="nowrap">${fmt.date(l.date, { year: true })}</td><td>${l.description}${l.flagged ? html` <span class="pill warn" title="${l.flagged}">${l.flagged.length > 24 ? 'Check' : l.flagged}</span>` : ''}${l.receipt_url ? html` <span class="pill info">Receipt</span>` : ''}</td>
            <td class="hide-sm">${l.category}</td><td data-label=""><span class="pill ${SRC[l.source][0]}">${SRC[l.source][1]}</span></td><td class="num key ${l.kind === 'income' ? 'pos' : ''}">${l.kind === 'income' ? '+' : '−'}${fmt.amt(Math.abs(l.amount))}</td></tr>`)}</tbody></table></div>
          ${d.pnl.lines.length ? '' : F.empty('Nothing recorded for this period')}</div></section>
        ${d.pnl.pre_rental ? preRentalPanel(d.pnl.pre_rental) : ''}
        <section class="span-4 stack">
          ${d.distributions ? distPanel(d.distributions) : ''}
          <div class="panel"><div class="panel-head"><h2>Profile</h2></div><div class="panel-body"><dl class="kv">
            <dt>Purchased</dt><dd>${pr.purchase_date ? fmt.date(pr.purchase_date, { year: true }) : '—'}${pr.purchase_price ? ' for ' + fmt.money(pr.purchase_price, { cents: false }) : ''}</dd>
            ${pr.rental_start || pr.rental_end ? html`<dt>Rented</dt><dd>${pr.rental_start ? 'Since ' + fmt.date(pr.rental_start, { year: true }) : ''}${pr.rental_end ? (pr.rental_start ? ' until ' : 'Until ') + fmt.date(pr.rental_end, { year: true }) : ''}</dd>` : ''}
            ${shareOf(pr) !== 1 ? html`<dt>Ownership</dt><dd>${shareWords(pr)} ours (${sharePct(pr)}), co-owned with family</dd>` : ''}
            <dt>Estimated value</dt><dd>${pr.est_value ? fmt.money(pr.est_value, { cents: false }) : '—'}${pr.est_value && pr.value_source ? html`<span class="small ink2" style="display:block">${pr.value_source}${pr.value_as_of && !String(pr.value_source).includes(pr.value_as_of) ? ' · ' + fmt.date(pr.value_as_of, { year: true }) : ''}</span>` : ''}</dd>
            ${shareOf(pr) !== 1 && pr.our_value ? html`<dt>Our share</dt><dd>${fmt.money(pr.our_value, { cents: false })} <span class="small ink2">counts toward net worth</span></dd>` : ''}
            ${pr.status === 'sold' ? html`<dt>Sold</dt><dd>${pr.sale_date ? fmt.date(pr.sale_date, { year: true }) : 'Date not recorded'}${pr.sale_price ? ' for ' + fmt.money(pr.sale_price, { cents: false }) : ''}</dd>
              ${pr.sale_proceeds ? html`<dt>Net proceeds</dt><dd>${fmt.money(pr.sale_proceeds, { cents: false })}</dd>` : ''}` : ''}
            <dt>Loan balance</dt><dd>${pr.mortgage_balance ? `${fmt.money(pr.mortgage_balance, { cents: false })} · ${fmt.ago(pr.mortgage_as_of)}` : '—'}</dd>
            ${pr.status === 'sold' ? '' : html`<dt>Equity</dt><dd>${pr.equity !== null && pr.equity !== undefined ? fmt.money(pr.equity, { cents: false }) : '—'}${shareOf(pr) !== 1 && pr.our_equity !== null && pr.our_equity !== undefined ? html` <span class="small ink2">· ours ${fmt.money(pr.our_equity, { cents: false })}</span>` : ''}</dd>`}
            ${!isHome ? html`<dt>Rent</dt><dd>${pr.rent ? fmt.money(pr.rent, { cents: false }) + ' a month' : '—'}</dd><dt>Tenant</dt><dd>${pr.tenant || '—'}${pr.lease_end ? ` · lease ends ${fmt.date(pr.lease_end, { year: true })}` : ''}</dd>` : ''}
            ${pr.rate ? html`<dt>Rate</dt><dd>${pr.rate}%</dd>` : ''}${pr.notes ? html`<dt>Notes</dt><dd>${pr.notes}</dd>` : ''}</dl></div></div>
          ${d.loans.some((l) => l.points.length > 1) ? html`<div class="panel"><div class="panel-head"><h2>Loan balance</h2></div><div class="panel-body"><div class="chart h-180" id="loan-chart"></div></div></div>` : ''}
          <div class="panel"><div class="panel-head"><h2>Notes</h2></div><div class="panel-body" id="prop-notes"></div></div>
        </section>`}
      </div>`);
    $$('tr[data-reg]', root).forEach((tr) => {
      const [src, ref] = tr.dataset.reg.split(/:(.*)/);
      tr.onkeydown = (e) => { if (e.key === 'Enter') tr.click(); };
      tr.onclick = () => {
        if (src === 'bank') F.openTxn(ref, { onChange: F.refresh });
        else { const l = d.pnl.lines.find((x) => x.source === 'manual' && String(x.ref) === ref); if (l) entryModal(pr.id, l, cats.map((c) => c.name)); }
      };
    });
    $$('tr[data-btxn]', root).forEach((tr) => { tr.onclick = () => F.openTxn(tr.dataset.btxn, { onChange: F.refresh }); tr.onkeydown = (e) => { if (e.key === 'Enter') tr.click(); }; });
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
