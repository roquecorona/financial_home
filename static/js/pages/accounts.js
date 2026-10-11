/* Accounts list + single account page. */
'use strict';
(function () {
  const { html, raw, fmt, icon, $, $$ } = F;
  const GROUPS = [
    ['cash', 'Cash', 'Checking and savings'], ['cards', 'Credit cards', 'Balances owed'], ['investments', 'Investments', 'Retirement, HSA and brokerage'],
    ['loans', 'Loans and mortgages', 'Linked loan accounts'], ['other', 'Other linked accounts', ''],
    ['manual_asset', 'Other assets', 'Tracked by hand'], ['manual_debt', 'Other debts', 'Tracked by hand or from the household sheet'],
  ];
  const TYPE_LABEL = { checking: 'Checking', savings: 'Savings', credit_card: 'Credit card', store_card: 'Store card', mortgage: 'Mortgage', loan: 'Loan', heloc: 'HELOC',
    auto_loan: 'Auto loan', brokerage: 'Brokerage', ira: 'IRA', '401k': '401(k)', '403b': '403(b)', hsa: 'HSA', '529': '529 plan', other: 'Other' };
  F.typeLabel = (t) => TYPE_LABEL[t] || fmt.label(t || '');

  F.pages.accounts = async (root, r, ctl) => {
    if (r.id && /^manual-\d+$/.test(r.id)) return manualPage(root, r, ctl);
    if (r.id) return accountPage(root, r, ctl);
    const d = await F.get('/api/accounts');
    if (!ctl.alive()) return;
    const t = d.totals;
    const all = [...d.accounts, ...d.manual.map((m) => ({ ...m, group: m.group, manual: true }))];
    const shown = (g) => all.filter((a) => a.group === g && !(a.manual && a.status === 'closed'));
    const closed = d.manual.filter((m) => m.status === 'closed');
    const value = (a) => (a.group === 'cards' ? -(a.balance || 0) : a.manual ? a.balance : a.group === 'loans' ? Math.abs(a.balance || 0) : a.balance);
    const row = (a) => {
      const href = a.manual ? `#/accounts/manual-${a.id}` : `#/accounts/${encodeURIComponent(a.account_id)}`;
      const sub = a.manual ? [F.typeLabel(a.type), a.holder, a.sheet_loan ? 'Household sheet' : 'By hand'].filter(Boolean).join(' · ')
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
    const nwTop = (d.networth || []).filter((x) => x.complete).length >= 2;
    const nwSec = html`<section class="span-12" aria-labelledby="nw-h">${F.secHead('Net worth by month', { id: 'nw-h', tools: nwTop ? html`<div class="seg sm" id="nw-range" role="group" aria-label="Range">${['6m', '1y', '3y', 'all'].map((k) => html`<button type="button" data-r="${k}" aria-pressed="${String(k === nwRange())}">${k === 'all' ? 'All' : k.toUpperCase()}</button>`)}</div>` : '' })}
          <div class="chart h-220" id="nw-chart"></div><div id="nw-note"></div></section>`;
    const kids = d.accounts.filter((a) => a.type === '529' && !a.included && a.status !== 'closed');
    F.setHTML(root, html`
      ${F.head({ title: 'Accounts', lede: `${d.accounts.length} linked through the bank sync, ${d.manual.filter((m) => m.status !== 'closed').length} tracked by hand. Card balances shared between two cards are counted once.`,
        actions: html`<button type="button" class="btn primary" data-add-acct>${icon('plus')}Track an account by hand</button>` })}
      <section class="band" style="--n:5" aria-label="Totals">
        ${F.kpi('Cash', F.kpiMoney(t.cash), 'Checking and savings')}
        ${F.kpi('Cards owed', F.kpiMoney(-t.cards), 'Current balances')}
        ${F.kpi('Invested', F.kpiMoney(t.investments), 'Retirement, HSA, brokerage', { vcls: 'accent' })}
        ${F.kpi('Loans', F.kpiMoney(-t.loans), 'Mortgages and loans')}
        ${F.kpi('Net worth', F.kpiMoney(t.net_worth), t.real_estate ? 'Includes home estimates' : 'Home values not included')}
      </section>
      ${kids.length ? html`<p class="small ink2" style="margin:10px 0 0">Kids’ 529s: <b class="num">${fmt.amt(kids.reduce((s, a) => s + (a.balance || 0), 0), { cents: false })}</b> (${kids.map((a) => `${a.label.replace(/^Fidelity 529 - /, '')} ${fmt.amt(a.balance, { cents: false })}`).join(' · ')}) — kept out of Invested and net worth. <a href="#/investments">See them on Investments</a></p>` : ''}
      <div class="grid">
        ${nwTop ? nwSec : ''}
        ${GROUPS.map(([g, label, sub]) => {
          const list = shown(g);
          if (!list.length) return '';
          const total = list.filter((a) => (a.manual ? a.include_in_totals : a.included)).reduce((s, a) => s + (value(a) || 0), 0);
          const sorted = list.sort((a, b) => (b.included !== false) - (a.included !== false) || Math.abs(value(b) || 0) - Math.abs(value(a) || 0));
          // Zero-balance accounts (paid-off cards, empty plans) fold away so the list shows what matters.
          const zero = sorted.filter((a) => a.balance !== null && a.balance !== undefined && Math.abs(value(a) || 0) < 0.005);
          const live = sorted.filter((a) => !zero.includes(a));
          return html`<section class="span-6">${F.secHead(label, { sub, tools: html`<b class="num">${fmt.amt(total, { cents: false })}</b>` })}
            <div><div class="list">${live.map(row)}</div>${zero.length ? html`<details class="disclosure"><summary>${g === 'cards' ? 'Nothing owed' : 'Zero balance'} <span class="badge">${zero.length}</span></summary><div class="list">${zero.map(row)}</div></details>` : ''}</div></section>`;
        })}
        ${closed.length ? html`<section class="span-6"><details class="disclosure"><summary>Closed or paid off <span class="badge">${closed.length}</span></summary>
          <div class="list">${closed.map(row)}</div></details></section>` : ''}
        ${nwTop ? '' : nwSec}
      </div>`);
    $('[data-add-acct]', root).onclick = () => F.manualAcctModal({}, (_, id) => F.go(id ? `#/accounts/manual-${id}` : '#/accounts'));
    if (r.params.new === '1') F.manualAcctModal({}, (_, id) => F.go(id ? `#/accounts/manual-${id}` : '#/accounts'));
    const draw = () => drawNetWorth(root, d.networth || []);
    draw();
    ctl.rerender = () => { F.destroyCharts(); draw(); };
    $$('#nw-range button', root).forEach((b) => (b.onclick = () => {
      try { localStorage.setItem('fin.nwrange', b.dataset.r); } catch { /* ignore */ }
      $$('#nw-range button', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      F.destroyCharts(); draw();
    }));
  };

  const nwRange = () => { try { return localStorage.getItem('fin.nwrange') || '1y'; } catch { return '1y'; } };
  /* Net worth trend: only months where every account has a balance are drawn; the empty state says how to fill the gap. */
  function drawNetWorth(root, series) {
    const el = $('#nw-chart', root), note = $('#nw-note', root);
    if (!el || !F.hasCharts) return;
    const nw = series.filter((p) => p.complete);
    const pts = nw.slice(-({ '6m': 6, '1y': 12, '3y': 36, all: 999 }[nwRange()] || 12));
    if (pts.length < 2) {
      const incomplete = series.filter((p) => !p.complete).slice(-1)[0];
      el.classList.add('is-empty');
      F.setHTML(el, F.empty('The trend fills in as history builds up', incomplete && incomplete.missing && incomplete.missing.length
        ? html`Earlier months are missing balances for ${incomplete.missing.slice(0, 3).join(', ')}${incomplete.missing.length > 3 ? ` and ${incomplete.missing.length - 3} more` : ''}. Add past statement values with <a href="#/investments">Investments → Add a past balance</a>, or open a hand-tracked account below and add its earlier balances.`
        : 'Each daily sync adds a point; a month is drawn once every account has a balance for it.'));
      F.setHTML(note, '');
      return;
    }
    el.classList.remove('is-empty');
    F.chart(el, {
      type: 'line', aria: `Net worth by month, from ${fmt.money(pts[0].net_worth, { cents: false })} to ${fmt.money(pts[pts.length - 1].net_worth, { cents: false })}`,
      data: { labels: pts.map((p) => fmt.month(p.month, { short: true })), datasets: [F.areaDs('Net worth', pts.map((p) => p.net_worth), F.css('--ink'))] },
      options: (() => { const o = F.chartOpts({ kind: 'line', beginAtZero: false }); o.plugins.tooltip.callbacks.afterBody = (items) => { const p = pts[items[0].dataIndex]; return [`Assets  ${fmt.amt(p.assets, { cents: false })}`, `Debts  ${fmt.amt(-p.liabilities, { cents: false })}`]; }; return o; })(),
    });
    const partial = series.length - nw.length;
    F.setHTML(note, partial > 0 ? html`<p class="caption">Only months where every account has a balance are drawn; ${partial} earlier month${partial === 1 ? ' is' : 's are'} hidden until their history is added.</p>` : '');
  }

  /* An account tracked by hand: balance history, add a balance, edit or delete. */
  async function manualPage(root, r, ctl) {
    const id = +r.id.slice(7);
    const d = await F.get('/api/manual');
    if (!ctl.alive()) return;
    const m = d.manual_accounts.find((x) => x.id === id);
    if (!m) { F.setHTML(root, html`${F.head({ crumb: html`<a href="#/accounts">Accounts</a>`, title: 'Account not found' })}${F.empty('This account no longer exists', 'It may have been deleted on another device.', html`<a class="btn" href="#/accounts">Back to accounts</a>`)}`); return; }
    const isDebt = m.kind === 'debt';
    F.setHTML(root, html`
      ${F.head({ crumb: html`<a href="#/accounts">Accounts</a> / ${isDebt ? 'Tracked debt' : 'Tracked asset'}`, title: m.name,
        lede: [F.typeLabel(m.type), m.holder, m.entity && m.entity !== 'household' ? m.entity : '', m.sheet_loan ? `month-end balances also come from the household sheet (“${m.sheet_loan}”)` : '', m.status === 'closed' ? 'closed' : '', !m.include_in_totals ? 'not counted in net worth' : ''].filter(Boolean).join(' · '),
        actions: html`<button type="button" class="btn" data-edit>${icon('edit')}Edit details</button>` })}
      <section class="band" style="--n:3" aria-label="Summary">
        ${F.kpi(isDebt ? 'Balance owed' : 'Value', F.kpiMoney(m.balance === null ? null : isDebt ? -Math.abs(m.balance) : m.balance), m.as_of ? 'As of ' + fmt.date(m.as_of, { year: true }) : 'No balance yet')}
        ${F.kpi('Balances on record', String(m.points.length), m.points.length ? `Since ${fmt.date(m.points[0].date, { year: true })}` : 'Add the first one below')}
        ${F.kpi('Interest rate', m.rate ? fmt.num(m.rate, 2) + '%' : '—', m.notes || '')}
      </section>
      <div class="grid">
        <section class="span-7">${F.secHead('Balance over time')}<div class="chart h-220" id="ma-chart"></div></section>
        <section class="span-5">${F.secHead('Add a balance', { sub: 'From a statement or an app' })}
          <form class="form-grid" id="mb-form" novalidate>
            <div class="field"><label for="mb-date">Date</label><input class="input" id="mb-date" type="date" name="as_of" value="${F.todayISO()}"></div>
            <div class="field"><label for="mb-bal">Balance</label><span class="money-wrap"><input class="input" id="mb-bal" name="balance" inputmode="decimal" enterkeyhint="done"></span></div>
            <div class="field full"><label for="mb-note">Note</label><input class="input" id="mb-note" name="note" placeholder="Optional"></div>
            <div class="row full"><button class="btn primary" type="submit">Add balance</button></div></form>
          ${m.sheet_loan ? html`<p class="caption">A balance you add on the same date as a sheet balance wins.</p>` : ''}</section>
        <section class="span-12">${F.secHead('History', { sub: `${m.points.length} balance${m.points.length === 1 ? '' : 's'}` })}
          ${m.points.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>Date</th><th class="num">Balance</th><th>Source</th><th></th></tr></thead><tbody>
          ${[...m.points].reverse().map((pt) => { const e = m.entries.find((x) => x.as_of === pt.date && pt.source === 'manual'); return html`<tr><td>${fmt.date(pt.date, { year: true })}</td><td class="num key">${fmt.amt(pt.balance)}</td><td><span class="pill ${pt.source === 'sheet' ? 'neutral' : 'good'}">${pt.source === 'sheet' ? 'Sheet' : 'Entered'}</span>${e && e.note ? html` <span class="small muted">${e.note}</span>` : ''}</td>
            <td class="right">${e ? html`<button type="button" class="btn xs ghost danger" data-del-bal="${e.id}" aria-label="Delete the ${fmt.date(pt.date, { year: true })} balance">Delete</button>` : ''}</td></tr>`; })}</tbody></table></div>`
          : F.empty('No balances yet', 'Add one above — today’s value is enough to start; earlier statement values draw the trend.')}</section>
      </div>`);
    $('[data-edit]', root).onclick = () => F.manualAcctModal(m, (what) => (what === 'deleted' ? F.go('#/accounts') : F.refresh()));
    $('#mb-form', root).onsubmit = async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target));
      const bal = F.parseAmt(v.balance);
      if (bal === null || Number.isNaN(bal)) { F.toast('Enter a balance like 12,500.00', { kind: 'error' }); $('#mb-bal', root).focus(); return; }
      await F.post('/api/manual_balance', { manual_account_id: m.id, as_of: v.as_of, balance: String(bal), note: v.note });
      F.toast('Balance added'); F.refresh();
    };
    $$('[data-del-bal]', root).forEach((b) => (b.onclick = async () => { if (await F.confirm('Delete this balance?')) { await F.del('/api/manual_balance', { id: b.dataset.delBal }); F.refresh(); } }));
    const draw = () => {
      if (!F.hasCharts) return;
      const el = $('#ma-chart', root);
      if (m.points.length < 2) { el.classList.add('is-empty'); F.setHTML(el, F.empty('Add another balance to see a trend')); return; }
      F.chart(el, { type: 'line', aria: 'Balance history', data: { labels: m.points.map((x) => fmt.date(x.date, { year: true })), datasets: [F.areaDs('Balance', m.points.map((x) => x.balance), F.css(isDebt ? '--ink' : '--accent'))] }, options: F.chartOpts({ kind: 'line', beginAtZero: false }) });
    };
    draw();
    ctl.rerender = () => { F.destroyCharts(); draw(); };
  }

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
