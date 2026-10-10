/* Accounts list + single account page. */
'use strict';
(function () {
  const { html, raw, fmt, icon, $, $$ } = F;
  const GROUPS = [
    ['cash', 'Cash', 'Checking and savings'], ['cards', 'Credit cards', 'Balances owed'], ['investments', 'Investments', 'Retirement, HSA and brokerage'],
    ['loans', 'Loans and mortgages', 'Linked loan accounts'], ['other', 'Other linked accounts', ''],
    ['manual_asset', 'Other assets', 'Entered by hand'], ['manual_debt', 'Other debts', 'Entered by hand or from Jenny’s sheet'],
  ];
  const TYPE_LABEL = { checking: 'Checking', savings: 'Savings', credit_card: 'Credit card', store_card: 'Store card', mortgage: 'Mortgage', loan: 'Loan', heloc: 'HELOC',
    auto_loan: 'Auto loan', brokerage: 'Brokerage', ira: 'IRA', '401k': '401(k)', '403b': '403(b)', hsa: 'HSA', other: 'Other' };
  F.typeLabel = (t) => TYPE_LABEL[t] || fmt.label(t || '');

  F.pages.accounts = async (root, r, ctl) => {
    if (r.id) return accountPage(root, r, ctl);
    const d = await F.get('/api/accounts');
    if (!ctl.alive()) return;
    const t = d.totals;
    const all = [...d.accounts, ...d.manual.map((m) => ({ ...m, group: m.group, manual: true }))];
    const shown = (g) => all.filter((a) => a.group === g && !(a.manual && a.status === 'closed'));
    const closed = d.manual.filter((m) => m.status === 'closed');
    const value = (a) => (a.group === 'cards' ? -(a.balance || 0) : a.manual ? a.balance : a.group === 'loans' ? Math.abs(a.balance || 0) : a.balance);
    const row = (a) => {
      const href = a.manual ? `#/manual?tab=accounts&id=${a.id}` : `#/accounts/${encodeURIComponent(a.account_id)}`;
      const sub = a.manual ? [F.typeLabel(a.type), a.holder, a.sheet_loan ? 'Jenny’s sheet' : 'Manual'].filter(Boolean).join(' · ')
        : [a.institution, a.holder, a.last4 ? '••' + a.last4 : ''].filter(Boolean).join(' · ');
      const sparkColor = a.group === 'cards' || a.group === 'loans' || a.group === 'manual_debt' ? 'var(--ink)' : 'var(--accent)';
      const spark = a.spark && a.spark.length ? (a.group === 'cards' ? a.spark.map((x) => (x === null ? null : -x)) : a.spark) : null;
      return html`<a class="list-item" href="${href}">
        <div class="main-col"><div class="title">${a.label}</div><div class="meta">${sub}</div></div>
        ${!a.included && !a.manual ? html`<span class="pill neutral" title="${a.status === 'shares_balance' ? 'Shares a balance with another card' : 'Excluded from totals'}">${a.status === 'shares_balance' ? 'Shared balance' : 'Not in totals'}</span>` : ''}
        ${a.manual && !a.include_in_totals ? html`<span class="pill neutral">Not in totals</span>` : ''}
        <span class="hide-sm">${spark ? F.spark(spark, { color: sparkColor }) : ''}</span>
        <span class="acct-amt"><span class="amount">${fmt.amt(value(a))}</span>
          <span class="tiny ${a.stale ? 'warn-text' : 'muted'}">${a.stale ? 'Not synced ' : ''}${a.as_of ? fmt.ago(a.as_of) : 'no balance yet'}</span></span></a>`;
    };
    F.setHTML(root, html`
      ${F.head({ title: 'Accounts', lede: `${d.accounts.length} linked through the bank sync, ${d.manual.filter((m) => m.status !== 'closed').length} tracked by hand. Card balances shared between two cards are counted once.`,
        actions: html`<a class="btn" href="#/settings?tab=data">Sync health</a><a class="btn primary" href="#/manual?tab=accounts&new=1">${icon('plus')}Add an account</a>` })}
      <section class="band" style="--n:5" aria-label="Totals">
        ${F.kpi('Cash', F.kpiMoney(t.cash), 'Checking and savings')}
        ${F.kpi('Cards owed', F.kpiMoney(-t.cards), 'Current balances')}
        ${F.kpi('Invested', F.kpiMoney(t.investments), 'Retirement, HSA, brokerage', { vcls: 'accent' })}
        ${F.kpi('Loans', F.kpiMoney(-t.loans), 'Mortgages and loans')}
        ${F.kpi('Net worth', F.kpiMoney(t.net_worth), t.real_estate ? 'Includes home estimates' : 'Home values not included')}
      </section>
      <div class="grid">
        ${GROUPS.map(([g, label, sub]) => {
          const list = shown(g);
          if (!list.length) return '';
          const total = list.filter((a) => (a.manual ? a.include_in_totals : a.included)).reduce((s, a) => s + (value(a) || 0), 0);
          return html`<section class="span-6">${F.secHead(label, { sub, tools: html`<b class="num">${fmt.amt(total, { cents: false })}</b>` })}
            <div><div class="list">${list.sort((a, b) => (b.included !== false) - (a.included !== false) || Math.abs(value(b) || 0) - Math.abs(value(a) || 0)).map(row)}</div></div></section>`;
        })}
        ${closed.length ? html`<section class="span-6"><details class="disclosure"><summary>Closed or paid off <span class="badge">${closed.length}</span></summary>
          <div class="list">${closed.map(row)}</div></details></section>` : ''}
      </div>`);
  };

  async function accountPage(root, r, ctl) {
    const d = await F.get('/api/account', { id: r.id });
    if (!ctl.alive()) return;
    const a = d.account;
    const isCard = a.group === 'cards', isInv = a.group === 'investments', isLoan = a.group === 'loans';
    const shown = (v) => (v === null || v === undefined ? null : isCard || isLoan ? -v : v);
    const last90 = d.monthly.slice(-3);
    const mIn = last90.reduce((s, m) => s + m.money_in, 0), mOut = last90.reduce((s, m) => s + m.money_out, 0);
    F.setHTML(root, html`
      ${F.head({ crumb: html`<a href="#/accounts">Accounts</a> / ${F.typeLabel(a.type)}`, title: a.label,
        lede: html`${[a.institution, a.holder, a.last4 ? '••' + a.last4 : '', a.entity && a.entity !== 'household' ? a.entity : ''].filter(Boolean).join(' · ')}${a.status === 'shares_balance' ? ' · shares its balance with another card, so it isn’t counted in totals' : ''}`,
        actions: html`<button type="button" class="btn" data-edit>${icon('edit')}Edit details</button>${isInv ? html`<a class="btn" href="#/investments?accounts=${encodeURIComponent(a.account_id)}">Performance</a>` : ''}${isCard ? html`<a class="btn" href="#/cards">Pay cards</a>` : ''}` })}
      <section class="band" style="--n:4" aria-label="Summary">
        ${F.kpi(isCard ? 'Owed' : isLoan ? 'Balance owed' : 'Balance', F.kpiMoney(shown(a.balance)), html`${a.as_of ? 'As of ' + fmt.date(a.as_of, { year: true }) : 'No balance yet'}${a.balance_source ? ' · ' + a.balance_source : ''}`)}
        ${isInv ? html`${F.kpi('Contributions on record', F.kpiMoney(a.contributions_all), 'From transactions and snapshots')}
          ${F.kpi('Holdings', String((a.holdings || []).length), (a.holdings || []).length ? 'As of ' + fmt.date(a.holdings[0].as_of) : 'No detail from the sync')}`
        : html`${F.kpi('In · 3 months', F.kpiMoney(mIn), 'Including transfers')}${F.kpi('Out · 3 months', F.kpiMoney(-mOut), 'Including payments')}`}
        ${F.kpi('Transactions', fmt.num(d.txn_count), d.first ? `${fmt.date(d.first, { year: true })} – ${fmt.date(d.last, { year: true })}` : 'None yet')}
      </section>
      <div class="grid">
        <section class="span-8">${F.secHead(isCard ? 'Amount owed over time' : 'Balance over time', { sub: isInv ? 'Synced balances and snapshots' : 'Rebuilt from transactions, anchored to synced balances' })}
          <div class="panel-body"><div class="chart h-260" id="bal-chart"></div></div></section>
        <section class="panel span-4"><div class="panel-head"><h2>Account notes</h2></div><div class="panel-body" id="acct-notes"></div></section>
        ${!isInv ? html`<section class="panel span-6"><div class="panel-head"><h2>Money in and out by month</h2></div><div class="panel-body"><div class="chart h-220" id="io-chart"></div>
          ${F.legend([{ label: 'In', color: F.css('--accent') }, { label: 'Out', color: F.css('--ink') }])}</div></section>
          <section class="panel span-6"><div class="panel-head"><h2>Where the money went</h2><span class="sub">All time · transfers excluded</span></div><div class="panel-body flush" id="cat-bars"></div></section>`
        : html`<section class="panel span-12"><div class="panel-head"><h2>Holdings</h2></div><div class="panel-body flush"><div class="table-wrap"><table class="t">
          <thead><tr><th>Holding</th><th>Asset class</th><th class="num">Shares</th><th class="num">Price</th><th class="num">Value</th></tr></thead>
          <tbody>${(a.holdings || []).map((h) => html`<tr><td><b>${h.ticker || ''}</b> ${h.description}</td><td>${h.asset_class}</td><td class="num">${fmt.num(h.quantity, 3)}</td><td class="num" data-label="Price">${fmt.amt(h.price)}</td><td class="num key">${fmt.amt(h.market_value)}</td></tr>`)}</tbody></table></div>
          ${(a.holdings || []).length ? '' : F.empty('No holdings detail', 'The sync only reports this account’s total.')}</div></section>`}
        <section class="panel span-12" id="acct-txns"></section>
      </div>`);
    F.notesBlock($('#acct-notes', root), 'account', a.account_id, d.notes, { placeholder: 'e.g. Autopay set to statement balance on the 25th' });
    F.txnTable($('#acct-txns', root), { base: { account: a.account_id }, state: { preset: 'all', kind: 'all' }, title: 'Transactions', showAccount: false, onEdit: () => {} });
    if (!isInv && d.categories.length) {
      F.setHTML($('#cat-bars', root), F.hbars(d.categories.slice(0, 10).map((c) => ({ label: c.category, value: c.total, key: c.category })),
        { labelDot: (i) => F.catVar(i.label), sub: (i) => `${d.categories.find((c) => c.category === i.label).n} txns` }));
    } else if (!isInv) F.setHTML($('#cat-bars', root), F.empty('No spending on this account'));
    const draw = () => {
      if (!F.hasCharts) return;
      const pts = d.history;
      if (pts.length >= 2) {
        const color = isCard || isLoan ? F.css('--ink') : F.css('--accent');
        F.chart($('#bal-chart', root), { type: 'line', aria: 'Balance over time',
          data: { labels: pts.map((p) => fmt.date(p.date)), datasets: [F.areaDs(isCard ? 'Owed' : 'Balance', pts.map((p) => shown(p.balance)), color, { tension: 0, stepped: !isInv ? 'before' : false })] },
          options: (() => { const o = F.chartOpts({ kind: 'line', beginAtZero: isCard }); o.scales.x.ticks.maxTicksLimit = 7; return o; })() });
      } else { $('#bal-chart', root).classList.add('is-empty'); F.setHTML($('#bal-chart', root), F.empty('Not enough history yet', isInv ? 'Add past statement values as snapshots on the Investments page.' : 'Each sync adds a day.')); }
      if (!isInv && d.monthly.length) {
        F.chart($('#io-chart', root), { type: 'bar', aria: 'Money in and out by month',
          data: { labels: d.monthly.map((m) => fmt.month(m.month, { short: true })), datasets: [F.barDs('In', d.monthly.map((m) => m.money_in), F.css('--accent')), F.barDs('Out', d.monthly.map((m) => m.money_out), F.css('--ink'))] },
          options: F.chartOpts({ kind: 'bar' }) });
      }
    };
    draw();
    ctl.rerender = () => { F.destroyCharts(); draw(); };
    $('[data-edit]', root).onclick = () => F.modal({
      title: 'Edit account details', sub: 'Changes here are kept even when the bank sync and categorize script run again.',
      body: html`<div class="form-grid">
        <div class="field full"><label>Display name</label><input class="input" name="display_name" value="${a.display_name || ''}" placeholder="${a.name}"></div>
        <div class="field"><label>Holder</label><select class="input" name="holder">${F.meta.holders.map((h) => html`<option ${h === a.holder ? raw('selected') : ''}>${h}</option>`)}</select></div>
        <div class="field"><label>Type</label><select class="input" name="type">${F.meta.account_types.map((t) => html`<option value="${t}" ${t === a.type ? raw('selected') : ''}>${F.typeLabel(t)}</option>`)}</select></div>
        <div class="field"><label>Entity</label><select class="input" name="entity">${F.entityOptions(a.entity)}</select></div>
        <div class="field"><label>Count in totals</label><select class="input" name="include_in_totals">
          <option value="auto" ${a.include_in_totals === null ? raw('selected') : ''}>Automatic${a.status === 'shares_balance' ? ' (no — shared balance)' : ' (yes)'}</option>
          <option value="1" ${a.include_in_totals === 1 ? raw('selected') : ''}>Yes</option><option value="0" ${a.include_in_totals === 0 ? raw('selected') : ''}>No</option></select></div></div>`,
      onSubmit: async (v) => {
        await F.post('/api/account', { account_id: a.account_id, display_name: v.display_name, holder: v.holder, type: v.type, entity: v.entity,
          include_in_totals: v.include_in_totals === 'auto' ? null : v.include_in_totals === '1' });
        F.toast('Account updated'); F.loadMeta(true); F.refresh();
      },
    });
  }
})();
