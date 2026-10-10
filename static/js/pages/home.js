/* 01 Home: where we stand, what's due, where the money went, what needs a look. */
'use strict';
F.pages.home = async (root, r, ctl) => {
  const { html, raw, fmt, icon, $, $$ } = F;
  const today = F.todayISO();
  const start90 = F.addDays(today, -89);
  // Three existing endpoints in parallel: the dashboard, 90 days of category spending, and account balances.
  // Uses home.spending_90d / home.investments_by_account when the API provides them (DESIGN_REVIEW #4); otherwise
  // falls back to the existing /api/spending and /api/accounts calls (handlers run on the local copy, so this is cheap).
  const d = await F.get('/api/home');
  const sp = d.spending_90d || await F.get('/api/spending', { start: start90, end: today }).catch(() => null);
  const ac = d.investments_by_account ? { accounts: d.investments_by_account.map((a) => ({ ...a, group: 'investments', included: true })) } : await F.get('/api/accounts').catch(() => null);
  if (!ctl.alive()) return;
  const t = d.totals;
  const nw = d.networth.filter((p) => p.complete);
  const dayIdx = +today.slice(8, 10) - 1;
  const paceThis = d.pace.this[Math.min(dayIdx, d.pace.this.length - 1)] ?? d.spending;
  const paceLast = d.pace.last[Math.min(dayIdx, d.pace.last.length - 1)];
  const paceDiff = paceThis - (paceLast ?? 0);
  const monthName = fmt.month(d.month).split(' ')[0];
  const lastName = fmt.month(d.last_month).split(' ')[0];
  const upcoming = d.upcoming.slice(0, 8);
  const overdue = d.upcoming.filter((u) => u.overdue && !u.paid);
  const cats = sp ? sp.categories.filter((c) => c.total > 0).slice(0, 8) : [];
  const catMax = Math.max(1, ...cats.map((c) => c.total));
  const inv = ac ? ac.accounts.filter((a) => a.group === 'investments' && a.included !== false && (a.balance || 0) > 0).sort((a, b) => b.balance - a.balance) : [];
  const invTotal = inv.reduce((s, a) => s + a.balance, 0) || 1;
  const invShade = (i) => ['var(--accent)', 'var(--ink)', 'var(--faint)', 'var(--line)'][Math.min(i, 3)];
  const alertIcon = { warning: 'alert', serious: 'alert', info: 'info' };
  const rangeKey = (() => { try { return localStorage.getItem('fin.nwrange') || '1y'; } catch { return '1y'; } })();
  const synced = d.last_sync ? `synced ${fmt.ago(d.last_sync)}` : 'not synced yet';

  F.setHTML(root, html`
    ${F.head({ title: 'Home', stamp: `${F.stamp()} — ${synced}`,
      actions: html`<button type="button" class="btn" data-month-note>${icon('note')}Note on ${monthName}</button><a class="btn primary" href="#/cards">Plan card payments</a>` })}
    ${d.pinned_notes.length ? html`<div class="pinned-notes">${d.pinned_notes.map((n) => html`<div class="callout">${icon('pin')}<div><div class="note-body">${n.body}</div><div class="small muted" style="margin-top:2px">${n.author || 'Unsigned'} · ${fmt.ago(n.created_at)}</div></div></div>`)}</div>` : ''}
    <section class="band" style="--n:5" aria-label="Balances">
      ${F.kpi('Cash', F.kpiMoney(t.cash), 'Checking and savings', { href: '#/accounts' })}
      ${F.kpi('Cards owed', F.kpiMoney(-t.cards), overdue.some((u) => u.kind === 'card') ? html`<span class="alert-text">${overdue.filter((u) => u.kind === 'card').length} past due</span>` : 'Current balances', { href: '#/cards' })}
      ${F.kpi('Invested', F.kpiMoney(t.investments), 'Retirement and HSA', { href: '#/investments', vcls: 'accent' })}
      ${F.kpi('Loans', F.kpiMoney(-t.loans), 'Mortgages, HELOCs, loans', { href: '#/accounts' })}
      ${F.kpi('Net worth', F.kpiMoney(t.net_worth), t.real_estate ? 'Includes home estimates' : html`Home values not counted · <span class="u">add</span>`, { href: t.real_estate ? '#/accounts' : '#/properties' })}
    </section>

    <div class="grid">
      <section class="span-7" aria-labelledby="sp-h">
        ${F.secHead(html`Spending · last 90 days`, { id: 'sp-h', tools: html`<a href="#/spending?preset=custom&start=${start90}&end=${today}">All spending →</a>` })}
        ${cats.length ? html`<div class="hbars">${cats.map((c) => html`<a class="hbar" href="#/spending?preset=custom&start=${start90}&end=${today}&category=${encodeURIComponent(c.category)}">
            <span class="lbl"><span>${c.category}</span></span>
            <span class="track"><span class="fill" style="width:${(c.total / catMax * 100).toFixed(1)}%"></span></span>
            <span class="val">${fmt.amt(c.total, { cents: false })}</span></a>`)}</div>
          <p class="caption">${fmt.money(sp.total, { cents: false })} in all, about ${fmt.money(sp.avg_month || 0, { cents: false })} a month. Card payments and transfers are left out.</p>`
          : F.empty(sp ? 'No spending in the last 90 days' : 'Spending couldn’t load', sp ? '' : 'Open Spending to try again.')}

        ${F.secHead(`${monthName} so far`, { tools: html`<a href="#/spending?preset=this_month">Details →</a>` })}
        <div class="duo">
          <div><div class="label">Spent</div><div class="figure-md">${F.kpiMoney(d.spending)}</div></div>
          <div><div class="label">Came in</div><div class="figure-md">${F.kpiMoney(d.income)}</div></div>
          <p class="small ink2">${paceLast !== undefined && paceLast !== null ? html`<b class="${paceDiff > 0 ? '' : 'pos'}">${fmt.money(Math.abs(paceDiff), { cents: false })} ${paceDiff <= 0 ? 'less' : 'more'}</b> than by this day in ${lastName}, which ended at ${fmt.money(d.last_spending, { cents: false })}.` : ''}</p>
        </div>
        <div class="chart h-180" id="pace-chart"></div>
        ${F.legend([{ label: monthName, color: F.css('--accent'), type: 'line' }, { label: lastName, color: F.css('--faint'), type: 'dash' }])}

        ${F.secHead('Recent', { tools: html`<a href="#/spending?preset=3m&kind=banking">All transactions →</a>` })}
        <div class="rows">${d.recent.slice(0, 8).map((x) => html`<button type="button" class="trow" data-txn="${x.txn_id}">
            <span class="d">${x.posted_date ? fmt.date(x.posted_date) : 'Pend.'}</span>
            <span class="t"><span class="ellipsis">${x.merchant_name}</span>${x.order_count ? html`<span class="tag-link">order ↗</span>` : ''}<span class="m ellipsis">${x.account}</span></span>
            <span class="a">${F.amtCell(x.amount)}</span></button>`)}</div>
      </section>

      <aside class="span-5 stack home-aside">
        <section aria-labelledby="due-h">
          ${F.secHead('Due next', { id: 'due-h', sub: overdue.length ? html`<span class="alert-text">${overdue.length} past due</span>` : 'Next 14 days', tools: html`<a href="#/bills">Bills →</a>` })}
          ${upcoming.length ? html`<div class="list">${upcoming.map((u) => html`<a class="due-row" href="${u.kind === 'card' ? `#/cards?month=${u.month}` : `#/bills?month=${u.month}`}">
              <span class="dnum ${u.overdue && !u.paid ? 'overdue' : u.date === today ? 'today' : ''}">${fmt.date(u.date)}</span>
              <span class="ellipsis">${u.name}</span>
              <span class="amt">${u.paid ? html`<span class="pill good">${icon('check')}Paid</span> ` : ''}${fmt.amt(u.amount)}</span>
              <span class="who-meta">${u.kind === 'card' ? 'Card' : 'Bill'}${u.overdue && !u.paid ? ' · past due' : ''}${u.pay_from ? ' · from ' + u.pay_from : ''}</span></a>`)}</div>`
          : F.empty('Nothing due in the next two weeks', 'Bills and card due dates show up here once they have a due day.')}
        </section>

        <section aria-labelledby="att-h">
          ${F.secHead('Needs attention', { id: 'att-h', sub: `${d.alerts.length || 'No'} item${d.alerts.length === 1 ? '' : 's'}` })}
          ${d.alerts.length ? html`<div class="list">${d.alerts.map((a) => html`${raw(a.txn_id ? `<button type="button" class="list-item" data-txn="${F.esc(a.txn_id)}">` : `<a class="list-item" href="${F.esc(a.link || '#/home')}">`)}
              <span class="alert-ico ${a.level}">${icon(alertIcon[a.level] || 'info')}</span>
              <span class="main-col"><span class="title">${a.title}</span><span class="meta">${a.detail}</span></span>${raw(a.txn_id ? '</button>' : '</a>')}`)}</div>`
          : F.empty('All clear', 'Nothing needs a look right now.')}
        </section>

        <section aria-labelledby="inv-h">
          ${F.secHead('Investments', { id: 'inv-h', tools: html`<a href="#/investments?focus=forecast">Forecast →</a>` })}
          ${inv.length ? html`<div class="strip" role="img" aria-label="Investment split by account">${inv.map((a, i) => html`<div style="flex:${a.balance};background:${raw(invShade(i))}" title="${a.label} ${fmt.pct(a.balance / invTotal, 1)}"></div>`)}</div>
            <div class="inv-grid">${inv.map((a, i) => html`<a href="#/accounts/${encodeURIComponent(a.account_id)}" class="ellipsis"><i class="dot" style="background:${raw(invShade(i))}"></i> ${a.label}</a><span class="muted">${fmt.pct(a.balance / invTotal, 1)}</span><span class="right">${fmt.amt(a.balance, { cents: false })}</span>`)}</div>`
          : F.empty('No investment balances yet')}
        </section>
      </aside>

      <section class="span-7" aria-labelledby="nw-h">
        ${F.secHead('Net worth by month', { id: 'nw-h', tools: html`<div class="seg sm" id="nw-range" role="group" aria-label="Range">${['6m', '1y', '3y', 'all'].map((k) => html`<button type="button" data-r="${k}" aria-pressed="${String(k === rangeKey)}">${k === 'all' ? 'All' : k.toUpperCase()}</button>`)}</div>` })}
        <div class="chart h-260" id="nw-chart"></div><div id="nw-note"></div>
      </section>
      <section class="span-5" aria-labelledby="fl-h">
        ${F.secHead('In and out · 6 months', { id: 'fl-h' })}
        <div class="chart h-260" id="flow-chart"></div>${F.legend([{ label: 'Came in', color: F.css('--accent') }, { label: 'Spent', color: F.css('--ink') }])}
        ${d.data_start ? html`<p class="caption">Bank history starts ${fmt.date(d.data_start, { year: true })}. Transfers and card payments are left out.</p>` : ''}
      </section>
    </div>`);

  $$('[data-txn]', root).forEach((b) => (b.onclick = () => F.openTxn(b.dataset.txn, { onChange: F.refresh })));
  $('[data-month-note]', root).onclick = () => F.modal({
    title: `Note on ${fmt.month(d.month)}`, sub: 'Month notes show up on Pay cards and in the Notes journal.',
    body: html`<div class="field"><label for="mn-body">Note</label><textarea class="input" id="mn-body" name="body" rows="5" placeholder="e.g. Paid the Hyatt card early because of the trip"></textarea></div><label class="check small" style="margin-top:10px"><input type="checkbox" name="pinned"> Pin to Home</label>`,
    submit: 'Add note', onSubmit: async (v) => { if (!v.body.trim()) { F.toast('Write the note first', { kind: 'error' }); return false; } await F.post('/api/note', { target_type: 'month', target_id: d.month, body: v.body, pinned: v.pinned }); F.toast('Note added'); if (v.pinned) F.refresh(); },
  });

  const draw = () => {
    if (!F.hasCharts) return;
    const range = (() => { try { return localStorage.getItem('fin.nwrange') || '1y'; } catch { return '1y'; } })();
    const n = { '6m': 6, '1y': 12, '3y': 36, all: 999 }[range];
    const pts = nw.slice(-n);
    const accent = F.css('--accent'), ink = F.css('--ink'), faint = F.css('--faint');
    const note = $('#nw-note', root), nwEl = $('#nw-chart', root);
    if (pts.length < 2) {
      const incomplete = d.networth.filter((p) => !p.complete).slice(-1)[0];
      nwEl.classList.add('is-empty');
      F.setHTML(nwEl, F.empty('The trend fills in as history builds up', incomplete ? html`Earlier months are missing balances for ${incomplete.missing.slice(0, 3).join(', ')}${incomplete.missing.length > 3 ? ` and ${incomplete.missing.length - 3} more` : ''}. Add past statement values under <a href="#/investments">Investments</a> or <a href="#/manual?tab=accounts">Manual entry</a>.` : 'Each daily sync adds a point.'));
    } else {
      F.chart(nwEl, {
        type: 'line', aria: `Net worth by month, from ${fmt.money(pts[0].net_worth, { cents: false })} to ${fmt.money(pts[pts.length - 1].net_worth, { cents: false })}`,
        data: { labels: pts.map((p) => fmt.month(p.month, { short: true })), datasets: [F.areaDs('Net worth', pts.map((p) => p.net_worth), ink)] },
        options: (() => { const o = F.chartOpts({ kind: 'line', beginAtZero: false }); o.plugins.tooltip.callbacks.afterBody = (items) => { const p = pts[items[0].dataIndex]; return [`Assets  ${fmt.amt(p.assets, { cents: false })}`, `Debts  ${fmt.amt(-p.liabilities, { cents: false })}`]; }; return o; })(),
      });
      const partial = d.networth.length - nw.length;
      F.setHTML(note, partial > 0 ? html`<p class="caption">Only months where every account has a balance are drawn. ${partial} earlier month${partial === 1 ? ' is' : 's are'} hidden until their history is added.</p>` : '');
    }
    const days = Math.max(d.pace.this.length, d.pace.last.length);
    F.chart($('#pace-chart', root), {
      type: 'line', aria: `Cumulative spending: ${monthName} ${fmt.money(paceThis, { cents: false })} so far versus ${lastName}`,
      data: { labels: Array.from({ length: days }, (_, i) => i + 1),
        datasets: [F.lineDs(monthName, d.pace.this, accent), F.lineDs(lastName, d.pace.last, faint, { borderDash: [4, 4], borderWidth: 1.5 })] },
      options: (() => { const o = F.chartOpts({ kind: 'line', beginAtZero: true }); o.plugins.tooltip.callbacks.title = (it) => `Day ${it[0].label}`; o.scales.x.ticks.maxTicksLimit = 6; return o; })(),
    });
    F.chart($('#flow-chart', root), {
      type: 'bar', aria: 'Income and spending by month for the last 6 months',
      data: { labels: d.flow.map((f) => fmt.month(f.month, { only: true })), datasets: [F.barDs('Came in', d.flow.map((f) => f.income), accent), F.barDs('Spent', d.flow.map((f) => f.spending), ink)] },
      options: (() => { const o = F.chartOpts({ kind: 'bar' }); o.datasets = { bar: { categoryPercentage: 0.6, barPercentage: 0.88 } }; return o; })(),
    });
  };
  draw();
  ctl.rerender = () => { F.destroyCharts(); draw(); };
  $$('#nw-range button', root).forEach((b) => (b.onclick = () => {
    try { localStorage.setItem('fin.nwrange', b.dataset.r); } catch { /* ignore */ }
    $$('#nw-range button', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    F.destroyCharts(); draw();
  }));
};
