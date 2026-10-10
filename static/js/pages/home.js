/* 01 Home: this month at a glance — card and bill progress, what's due, what needs a look, spending pace.
   Everything links out; the full tables live on their own pages (no section here repeats another page). */
'use strict';
F.pages.home = async (root, r, ctl) => {
  const { html, raw, fmt, icon, $, $$ } = F;
  const today = F.todayISO();
  // Handlers run on the in-browser copy, so three calls cost a few milliseconds.
  const [d, cd, bd] = await Promise.all([F.get('/api/home'), F.get('/api/cards').catch(() => null), F.get('/api/bills').catch(() => null)]);
  if (!ctl.alive()) return;
  const t = d.totals;
  const cs = cd ? F.cardSummary(cd) : null;
  const bt = bd ? bd.totals : null;
  const billsLate = bd ? bd.bills.filter((b) => b.state === 'overdue').length : 0;
  const cardsLate = d.upcoming.filter((u) => u.kind === 'card' && u.overdue && !u.paid).length;
  const dayIdx = +today.slice(8, 10) - 1;
  const paceThis = d.pace.this[Math.min(dayIdx, d.pace.this.length - 1)] ?? d.spending;
  const paceLast = d.pace.last[Math.min(dayIdx, d.pace.last.length - 1)];
  const paceDiff = paceThis - (paceLast ?? 0);
  const monthName = fmt.month(d.month).split(' ')[0];
  const lastName = fmt.month(d.last_month).split(' ')[0];
  // Due next: anything unpaid that is past due, then the next two weeks; paid items drop off (they're ticked on their pages).
  const due = d.upcoming.filter((u) => !u.paid).sort((a, b) => (b.overdue - a.overdue) || String(a.date).localeCompare(String(b.date)));
  const dueShown = due.slice(0, 6);
  const alertIcon = { warning: 'alert', serious: 'alert', info: 'info' };
  const late = (n) => (n ? html`<span class="alert-text">${n} past due</span>` : '');

  F.setHTML(root, html`
    ${F.head({ title: 'Home', stamp: `${F.stamp()} · ${d.last_sync ? 'bank sync ' + fmt.ago(d.last_sync) : 'not synced yet'}` })}
    ${d.pinned_notes.length ? html`<div class="pinned-notes">${d.pinned_notes.map((n) => html`<div class="callout">${icon('pin')}<div><div class="note-body">${n.body}</div><div class="small muted" style="margin-top:2px">${n.author || 'Unsigned'} · ${fmt.ago(n.created_at)} · <a href="#/notes">Notes</a></div></div></div>`)}</div>` : ''}
    <section class="band" style="--n:4" aria-label="${monthName} at a glance">
      ${F.kpi('Cards paid', cs ? html`${cs.paid}<span class="of">/${cs.count}</span>` : '—', cs ? (cardsLate ? late(cardsLate) : cs.unplanned ? `${cs.unplanned} not planned yet` : cs.count && cs.paid === cs.count ? 'All paid' : `${fmt.money(cs.unpaid, { cents: false })} planned to go out`) : '', { href: '#/cards' })}
      ${F.kpi('Bills paid', bt ? html`${bt.paid}<span class="of">/${bt.count}</span>` : '—', bt ? (billsLate ? late(billsLate) : bt.remaining > 0 ? `${fmt.money(bt.remaining, { cents: false })} still to pay` : 'All paid') : '', { href: '#/bills' })}
      ${F.kpi('Left in checking', cs ? F.kpiMoney(cs.left) : '—', cs ? (cs.left < 0 ? html`<span class="alert-text">Short ${fmt.money(-cs.left, { cents: false })}</span>` : 'After planned card payments') : '', { href: '#/cards', cls: cs && cs.left < 0 ? 'leftover neg' : '' })}
      ${F.kpi('Net worth', F.kpiMoney(t.net_worth), t.real_estate ? 'Accounts, homes and debts' : html`Home values not counted`, { href: '#/accounts' })}
    </section>

    <div class="grid">
      <section class="span-7" aria-labelledby="due-h">
        ${F.secHead('Due next', { id: 'due-h', sub: due.some((u) => u.overdue) ? late(due.filter((u) => u.overdue).length) : 'Next 14 days, unpaid', tools: html`<a href="#/cards">Cards →</a><a href="#/bills">Bills →</a>` })}
        ${dueShown.length ? html`<div class="list">${dueShown.map((u) => html`<a class="due-row" href="${u.kind === 'card' ? `#/cards?month=${u.month}` : `#/bills?month=${u.month}`}">
            <span class="dnum ${u.overdue ? 'overdue' : u.date === today ? 'today' : ''}">${fmt.date(u.date)}</span>
            <span class="ellipsis">${u.name}</span>
            <span class="amt">${fmt.amt(u.amount)}</span>
            <span class="who-meta">${u.kind === 'card' ? 'Card' : 'Bill'}${u.overdue ? ' · past due' : ''}${u.pay_from ? ' · from ' + u.pay_from : ''}</span></a>`)}</div>
          ${due.length > dueShown.length ? html`<p class="caption">${due.length - dueShown.length} more on <a href="#/cards">Pay cards</a> and <a href="#/bills">Bills</a>.</p>` : ''}`
        : F.empty('Nothing unpaid in the next two weeks', 'Cards and bills show up here once they have a due day.')}
      </section>

      <section class="span-5" aria-labelledby="att-h">
        ${F.secHead('Needs attention', { id: 'att-h', sub: d.alerts.length ? `${d.alerts.length} item${d.alerts.length === 1 ? '' : 's'}` : '' })}
        ${d.alerts.length ? html`<div class="list">${d.alerts.map((a) => html`${raw(a.txn_id ? `<button type="button" class="list-item" data-txn="${F.esc(a.txn_id)}">` : `<a class="list-item" href="${F.esc(a.link || '#/home')}">`)}
            <span class="alert-ico ${a.level}">${icon(alertIcon[a.level] || 'info')}</span>
            <span class="main-col"><span class="title">${a.title}</span><span class="meta">${a.detail}</span></span>${raw(a.txn_id ? '</button>' : '</a>')}`)}</div>`
        : F.empty('All clear', 'Nothing needs a look right now.')}
      </section>

      <section class="span-12" aria-labelledby="pace-h">
        ${F.secHead(`${monthName} so far`, { id: 'pace-h', tools: html`<a href="#/spending?preset=this_month">Spending →</a>` })}
        <div class="grid" style="margin-top:0;row-gap:12px">
          <div class="span-4"><div class="duo">
            <div><div class="label">Spent</div><div class="figure-md">${F.kpiMoney(d.spending)}</div></div>
            <div><div class="label">Came in</div><div class="figure-md">${F.kpiMoney(d.income)}</div></div></div>
            <p class="small ink2" style="margin-top:10px">${paceLast !== undefined && paceLast !== null ? html`<b class="${paceDiff > 0 ? '' : 'pos'}">${fmt.money(Math.abs(paceDiff), { cents: false })} ${paceDiff <= 0 ? 'less' : 'more'}</b> than by this day in ${lastName}, which ended at ${fmt.money(d.last_spending, { cents: false })}.` : ''} Card payments and transfers are left out.</p></div>
          <div class="span-8"><div class="chart h-180" id="pace-chart"></div>
            ${F.legend([{ label: monthName, color: F.css('--accent'), type: 'line' }, { label: lastName, color: F.css('--faint'), type: 'dash' }])}</div>
        </div>
      </section>
    </div>`);

  $$('[data-txn]', root).forEach((b) => (b.onclick = () => F.openTxn(b.dataset.txn, { onChange: F.refresh })));

  const draw = () => {
    if (!F.hasCharts) return;
    const days = Math.max(d.pace.this.length, d.pace.last.length);
    F.chart($('#pace-chart', root), {
      type: 'line', aria: `Cumulative spending: ${monthName} ${fmt.money(paceThis, { cents: false })} so far versus ${lastName}`,
      data: { labels: Array.from({ length: days }, (_, i) => i + 1),
        datasets: [F.lineDs(monthName, d.pace.this, F.css('--accent')), F.lineDs(lastName, d.pace.last, F.css('--faint'), { borderDash: [4, 4], borderWidth: 1.5 })] },
      options: (() => { const o = F.chartOpts({ kind: 'line', beginAtZero: true }); o.plugins.tooltip.callbacks.title = (it) => `Day ${it[0].label}`; o.scales.x.ticks.maxTicksLimit = 6; return o; })(),
    });
  };
  draw();
  ctl.rerender = () => { F.destroyCharts(); draw(); };
};
