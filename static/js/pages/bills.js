/* 04 Bills: the monthly checklist. Big tick targets, matching bank payments offered inline, list or calendar. */
'use strict';
F.pages.bills = async (root, r, ctl) => {
  const { html, raw, fmt, icon, $, $$ } = F;
  const month = r.params.month || F.thisMonth();
  const pref = (k, def) => { try { return localStorage.getItem('fin.bills.' + k) ?? def; } catch { return def; } };
  const setPref = (k, v) => { try { localStorage.setItem('fin.bills.' + k, v); } catch { /* ignore */ } };
  let view = r.params.view || pref('view', 'list');
  let order = pref('order', 'due');
  let hidePaid = pref('hidePaid', '0') === '1';
  const d = await F.get('/api/bills', { month });
  if (!ctl.alive()) return;
  const STATE = { paid: ['good', 'Paid', 'check'], detected: ['info', 'Payment found', 'link'], overdue: ['crit', 'Past due', 'alert'], soon: ['warn', 'Due soon', 'clock'], upcoming: ['neutral', 'Upcoming', 'calendar'] };
  const pill = (b) => { if (!STATE[b.state] || b.state === 'upcoming') return ''; const [c, l, ic] = STATE[b.state]; return html`<span class="pill ${c}">${icon(ic)}${l}</span>`; };
  const t = d.totals;
  const today = F.todayISO();
  const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  const byId = (id) => d.bills.find((b) => b.bill_id === +id);

  const setStatus = async (b, paid, txn) => {
    const body = paid ? { month, bill_id: b.bill_id, paid: true, txn_id: txn ? txn.txn_id : null, amount_paid: txn ? Math.abs(txn.amount) : b.amount } : { month, bill_id: b.bill_id, paid: false };
    await F.post('/api/bill_status', body);
    if (paid) F.toast(`${b.item} marked paid`, { action: 'Undo', onAction: async () => { await F.post('/api/bill_status', { month, bill_id: b.bill_id, paid: false }); F.refresh(); } });
    F.refresh();
  };

  const billRow = (b) => html`<div class="billrow ${b.paid ? 'is-paid' : ''}" data-bill="${b.bill_id}">
    <label class="tick" title="${b.paid ? 'Paid — tap to undo' : 'Mark paid'}"><input type="checkbox" data-paid ${b.paid ? raw('checked') : ''} aria-label="${b.item}, ${fmt.money(b.amount)}${b.due_date ? ', due ' + fmt.date(b.due_date, { long: true }) : ''}: paid"><span>${icon('check')}</span></label>
    <span class="dnum ${b.state === 'overdue' ? 'overdue' : b.due_date === today ? 'today' : ''}" aria-hidden="true">${b.due_date ? fmt.date(b.due_date) : '—'}</span>
    <div class="main-col"><div class="title">${b.item}</div>
      <div class="meta">${b.due_day ? `Due the ${ordinal(+b.due_day)}` : 'No set due day'}${b.pay_from ? ' · ' + b.pay_from : ''}${b.autopay ? ' · autopay' : ''}${order === 'due' && b.section ? ' · ' + b.section : ''}${b.note_count ? ` · ${b.note_count} note${b.note_count === 1 ? '' : 's'}` : ''}</div>
      ${b.paid && b.paid_txn ? html`<div class="small pos">Matched ${fmt.date(b.paid_txn.posted_date)} · ${fmt.amt(Math.abs(b.paid_txn.amount))}</div>` : ''}
      ${b.paid && b.status && b.status.paid_by ? html`<div class="tiny muted">Marked by ${b.status.paid_by}</div>` : ''}
      ${b.variable && b.spent !== undefined && b.spent !== null ? html`<div style="max-width:320px;margin-top:6px"><div class="meter ${b.spent > b.amount ? 'over' : ''}"><div style="width:${Math.min(100, (b.spent / (b.amount || 1)) * 100).toFixed(1)}%"></div></div>
        <div class="tiny muted" style="margin-top:3px">${fmt.money(b.spent, { cents: false })} spent of ${fmt.money(b.amount, { cents: false })} budget (${b.category}${b.subcategory ? ' · ' + b.subcategory : ''})</div></div>` : ''}
    </div>
    <div class="amtcol"><span class="amount">${fmt.amt(b.amount)}</span>${b.paid ? '' : pill(b)}</div>
    <button type="button" class="icon-btn" data-edit aria-label="Edit ${b.item}">${icon('edit')}</button>
    ${!b.paid && b.suggestions.length ? html`<div class="bill-sugg">${b.suggestions.map((s) => html`<div class="callout">${icon('link')}<div><div class="small"><b>${fmt.amt(Math.abs(s.amount))}</b> on ${fmt.date(s.posted_date)} · ${s.account}</div><div class="tiny muted ellipsis">${s.description}</div></div>
        <button type="button" class="btn sm primary" data-match="${s.txn_id}">Mark paid</button></div>`)}</div>` : ''}</div>`;

  const listView = () => {
    let bills = d.bills.slice();
    const paidCount = bills.filter((b) => b.paid).length;
    if (hidePaid) bills = bills.filter((b) => !b.paid);
    const byDue = (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.item.localeCompare(b.item);
    const foot = hidePaid && paidCount ? html`<p class="caption">${paidCount} paid bill${paidCount === 1 ? '' : 's'} hidden.</p>` : '';
    if (!d.bills.length) return F.empty('No bills yet', 'Add the bills you pay every month.', html`<button type="button" class="btn primary" data-add>Add bill</button>`);
    if (!bills.length) return html`${F.empty('Every bill is paid', 'Nice. Turn off “Hide paid” to see them.')}`;
    if (order === 'due') {
      const late = bills.filter((b) => b.state === 'overdue'), rest = bills.filter((b) => b.state !== 'overdue');
      return html`${late.length ? html`<section>${F.secHead(html`<span class="alert-text">Past due</span>`, { sub: `${late.length} · ${fmt.money(late.reduce((a, b) => a + (b.amount || 0), 0), { cents: false })}` })}<div class="list">${late.sort(byDue).map(billRow)}</div></section>` : ''}
        <section>${F.secHead(late.length ? 'Everything else' : 'By due date', { sub: `${rest.length} · ${fmt.money(rest.reduce((a, b) => a + (b.amount || 0), 0), { cents: false })}` })}<div class="list">${rest.sort(byDue).map(billRow)}</div></section>${foot}`;
    }
    return html`${d.sections.map((s) => {
      const list = bills.filter((b) => b.section === s);
      const all = d.bills.filter((b) => b.section === s);
      if (!list.length) return '';
      return html`<section>${F.secHead(s, { sub: `${fmt.money(all.reduce((a, b) => a + (b.amount || 0), 0), { cents: false })} · ${all.filter((b) => b.paid).length}/${all.length} paid` })}<div class="list">${list.sort(byDue).map(billRow)}</div></section>`;
    })}${foot}`;
  };
  const calendar = () => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate();
    const lead = first.getDay();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(html`<div class="day out" aria-hidden="true"></div>`);
    for (let dd = 1; dd <= days; dd++) {
      const iso = `${month}-${String(dd).padStart(2, '0')}`;
      const evs = d.bills.filter((b) => b.due_date === iso);
      cells.push(html`<div class="day ${iso === today ? 'today' : ''}"><span class="n">${dd}</span>${evs.map((b) => html`<button type="button" class="ev ${b.paid ? 'paid' : b.state}" data-ev="${b.bill_id}" title="${b.item} · ${fmt.money(b.amount)}" aria-label="${b.item}, ${fmt.money(b.amount)}, ${STATE[b.state] ? STATE[b.state][1] : ''}">${b.item}</button>`)}</div>`);
    }
    while (cells.length % 7) cells.push(html`<div class="day out" aria-hidden="true"></div>`);
    const undated = d.bills.filter((b) => !b.due_date);
    return html`<div class="cal">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((x) => html`<div class="dow">${x}</div>`)}${cells}</div>
      ${undated.length ? html`<div class="panel-body"><div class="label" style="margin-bottom:8px">No set due day</div><div class="chips">${undated.map((b) => html`<button type="button" class="chip" data-ev="${b.bill_id}">${b.paid ? '✓ ' : ''}${b.item} · ${fmt.amt(b.amount, { cents: false })}</button>`)}</div></div>` : ''}`;
  };

  const overdueN = d.bills.filter((b) => b.state === 'overdue').length;
  F.setHTML(root, html`
    ${F.head({ title: 'Bills', compactSm: true, lede: 'Recurring bills from Jenny’s sheet. When a matching bank payment shows up, it’s offered here so you can confirm it in one tap.',
      actions: html`${F.monthNav(month, d.months)}<div class="seg" role="group" aria-label="View"><button type="button" data-view="list" aria-pressed="${String(view === 'list')}">List</button><button type="button" data-view="calendar" aria-pressed="${String(view === 'calendar')}">Calendar</button></div>
      <button type="button" class="btn primary" data-add>${icon('plus')}Add bill</button>` })}
    <section class="band" style="--n:4" aria-label="Totals">
      ${F.kpi('Bills this month', F.kpiMoney(t.total), `${t.count} active bills`)}
      ${F.kpi('Paid', html`${t.paid}<span class="of">/${t.count}</span>`, `${fmt.money(t.paid_total, { cents: false })} paid`)}
      ${F.kpi('Still to pay', F.kpiMoney(t.remaining), overdueN ? html`<span class="alert-text">${overdueN} past due</span>` : 'None past due')}
      ${F.kpi('Payments found', String(t.suggested), t.suggested ? 'Ready to confirm' : 'Nothing to confirm')}
    </section>
    ${t.suggested ? html`<div class="callout accent">${icon('link')}<div>${t.suggested} bill${t.suggested === 1 ? ' has' : 's have'} a matching bank payment (amount within 5% and the name matches).</div><button type="button" class="btn sm primary" data-accept-all>Mark all ${t.suggested} paid</button></div>` : ''}
    ${view === 'list' ? html`<div class="paytools" role="toolbar" aria-label="List options"><div class="seg" role="group" aria-label="Order"><button type="button" data-order="due" aria-pressed="${String(order === 'due')}">By due date</button><button type="button" data-order="group" aria-pressed="${String(order === 'group')}">By group</button></div>
      <label class="check small"><input type="checkbox" data-hide-paid ${hidePaid ? raw('checked') : ''}> Hide paid</label></div>` : ''}
    <div id="bills-body" class="stack">${view === 'calendar' ? calendar() : listView()}</div>`);

  const bind = () => {
    $$('[data-bill]', root).forEach((el) => {
      const b = byId(el.dataset.bill);
      $('[data-paid]', el).onchange = (e) => setStatus(b, e.target.checked, null);
      $$('[data-match]', el).forEach((m) => (m.onclick = () => { m.disabled = true; setStatus(b, true, b.suggestions.find((s) => s.txn_id === m.dataset.match)); }));
      $('[data-edit]', el).onclick = () => billModal(b);
    });
    $$('[data-ev]', root).forEach((e) => (e.onclick = () => billModal(byId(e.dataset.ev))));
    $$('[data-add]', root).forEach((b) => (b.onclick = () => billModal({})));
  };
  bind();
  F.bindMonthNav(root, (m) => F.go(`#/bills?month=${m}&view=${view}`));
  $$('[data-view]', root).forEach((b) => (b.onclick = () => { view = b.dataset.view; setPref('view', view); F.go(`#/bills?month=${month}&view=${view}`); }));
  const redraw = () => { F.setHTML($('#bills-body', root), listView()); bind(); };
  $$('[data-order]', root).forEach((b) => (b.onclick = () => { order = b.dataset.order; setPref('order', order); $$('[data-order]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); redraw(); }));
  const hp = $('[data-hide-paid]', root); if (hp) hp.onchange = () => { hidePaid = hp.checked; setPref('hidePaid', hidePaid ? '1' : '0'); redraw(); };
  const acc = $('[data-accept-all]', root);
  if (acc) acc.onclick = async () => {
    const todo = d.bills.filter((x) => !x.paid && x.suggestions.length);
    if (!(await F.confirm(`Mark ${todo.length} bill${todo.length === 1 ? '' : 's'} paid?`, todo.map((b) => `${b.item} ${fmt.money(Math.abs(b.suggestions[0].amount))} on ${fmt.date(b.suggestions[0].posted_date)}`).join(' · '), 'Mark paid', { danger: false }))) return;
    acc.disabled = true;
    for (const b of todo) {
      const s = b.suggestions[0];
      await F.post('/api/bill_status', { month, bill_id: b.bill_id, paid: true, txn_id: s.txn_id, amount_paid: Math.abs(s.amount) });
    }
    F.toast(`Marked ${todo.length} paid`, { action: 'Undo', onAction: async () => { for (const b of todo) await F.post('/api/bill_status', { month, bill_id: b.bill_id, paid: false }); F.refresh(); } });
    F.refresh();
  };
  function billModal(b) {
    const isNew = !b.bill_id;
    F.modal({
      title: isNew ? 'Add a bill' : b.item, sub: isNew ? '' : `${fmt.month(month)} · ${b.paid ? 'Paid' : (STATE[b.state] || STATE.upcoming)[1]}`, wide: !isNew,
      body: html`<div class="${isNew ? '' : 'grid'}" style="${isNew ? '' : 'margin-top:0'}"><div class="${isNew ? '' : 'span-7'}"><div class="form-grid">
        <div class="field full"><label for="bm-item">Name</label><input class="input" id="bm-item" name="item" value="${b.item || ''}" required></div>
        <div class="field"><label for="bm-amt">Amount</label><span class="money-wrap"><input class="input" id="bm-amt" name="amount" inputmode="decimal" value="${b.amount ?? ''}"></span></div>
        <div class="field"><label for="bm-dd">Due day</label><input class="input" id="bm-dd" name="due_day" type="number" inputmode="numeric" min="1" max="31" value="${b.due_day || ''}"></div>
        <div class="field"><label for="bm-sec">Group</label><input class="input" id="bm-sec" name="section" list="sections" value="${b.section || 'Miscellaneous'}">${F.datalist('sections', new Set(d.sections))}</div>
        <div class="field"><label for="bm-from">Pay from</label><input class="input" id="bm-from" name="pay_from" value="${b.pay_from || ''}"></div>
        <div class="field full"><label for="bm-kw">Match bank payments containing</label><input class="input" id="bm-kw" name="keyword" value="${b.keyword || ''}" placeholder="e.g. fpl|florida power"><span class="hint">Separate alternatives with |. Used to find the payment automatically.</span></div>
        <div class="field"><label for="bm-cat">Category (for budget bills)</label><select class="input" id="bm-cat" name="category">${F.catOptions(b.category || '', { blank: 'None' })}</select></div>
        <div class="field"><label for="bm-sub">Subcategory</label><input class="input" id="bm-sub" name="subcategory" value="${b.subcategory || ''}"></div>
        <label class="check"><input type="checkbox" name="variable" ${b.variable ? raw('checked') : ''}> Amount varies (a budget, like groceries)</label>
        <label class="check"><input type="checkbox" name="autopay" ${b.autopay ? raw('checked') : ''}> On autopay</label>
      </div></div>${isNew ? '' : html`<div class="span-5"><h3 style="margin-bottom:8px">Notes</h3><div id="bill-notes"></div></div>`}</div>`,
      danger: isNew ? null : { label: 'Remove bill', onClick: async () => { if (await F.confirm(`Remove ${b.item}?`, 'Past paid months stay in the history.', 'Remove')) { await F.del('/api/bill', { id: b.bill_id }); F.toast('Bill removed'); F.refresh(); return true; } return false; } },
      onOpen: (el) => { if (!isNew) F.get('/api/notes', { target_type: 'bill', target_id: String(b.bill_id) }).then((n) => F.notesBlock($('#bill-notes', el), 'bill', String(b.bill_id), n.notes, { compact: true })).catch(() => {}); },
      onSubmit: async (v) => {
        if (!v.item.trim()) { F.toast('Give the bill a name', { kind: 'error' }); return false; }
        if (v.amount && Number.isNaN(F.parseAmt(v.amount))) { F.toast('Amount must be a number', { kind: 'error' }); return false; }
        await F.post('/api/bill', { ...v, amount: v.amount ? String(F.parseAmt(v.amount)) : v.amount, bill_id: b.bill_id });
        F.toast(isNew ? 'Bill added' : 'Bill saved'); F.refresh();
      },
    });
  }
};
