/* Manual entry: hand-entered transactions, unlinked accounts and their balances. */
'use strict';
F.pages.manual = async (root, r, ctl) => {
  const { html, raw, fmt, icon, $, $$ } = F;
  const p = Object.assign({ tab: 'transactions' }, r.params);
  const d = await F.get('/api/manual');
  if (!ctl.alive()) return;
  const tab = p.tab;
  const kinds = { asset: 'Asset', debt: 'Debt' };
  const TYPES = ['loan', 'mortgage', 'auto_loan', 'heloc', 'credit_card', 'brokerage', 'savings', 'vehicle', 'property', 'other'];
  const txnForm = (t = {}) => html`<div class="form-grid mt-form">
    <div class="field full"><label>Account</label><select class="input" name="account_id" required>${d.accounts.map((a) => html`<option value="${a.account_id}" ${a.account_id === t.account_id ? raw('selected') : ''}>${a.name}</option>`)}</select></div>
    <div class="field"><label>Date</label><input class="input" type="date" name="date" value="${t.posted_date || F.todayISO()}" required></div>
    <fieldset class="field"><legend class="label">Direction</legend><div class="seg radio" role="radiogroup"><label class="check"><input type="radio" name="dir" value="out" ${!(t.amount > 0) ? raw('checked') : ''}> Money out</label><label class="check"><input type="radio" name="dir" value="in" ${t.amount > 0 ? raw('checked') : ''}> Money in</label></div></fieldset>
    <div class="field"><label>Amount</label><span class="money-wrap"><input class="input" name="amount" inputmode="decimal" value="${t.amount !== undefined ? Math.abs(t.amount) : ''}" required></span></div>
    <div class="field"><label>Description</label><input class="input" name="description" value="${t.description || ''}" required placeholder="e.g. Cash rent from tenant"></div>
    <div class="field"><label>Category</label><select class="input" name="category">${F.catOptions(t.category || '')}</select></div>
    <div class="field"><label>Subcategory</label><input class="input" name="subcategory" value="${t.subcategory || ''}"></div>
    <div class="field"><label>Entity</label><select class="input" name="entity">${F.entityOptions(t.entity)}</select></div>
    <div class="field"><label>Note</label><input class="input" name="notes" value="${t.notes || ''}"></div></div>`;
  const saveTxn = async (v, id) => {
    const amt = parseFloat((v.amount || '').replace(/[$,]/g, ''));
    if (!v.description.trim() || Number.isNaN(amt)) { F.toast('Description and amount are required', { kind: 'error' }); return false; }
    await F.post('/api/txn/manual', { ...v, txn_id: id, amount: v.dir === 'in' ? Math.abs(amt) : -Math.abs(amt) });
    F.toast(id ? 'Transaction updated' : 'Transaction added'); F.refresh();
  };
  const acctModal = (m = {}) => F.modal({
    title: m.id ? `Edit ${m.name}` : 'Add an account by hand', sub: 'For things the bank sync can’t see: a car, a loan, a 529, a property loan from Jenny’s sheet.',
    body: html`<div class="form-grid">
      <div class="field full"><label>Name</label><input class="input" name="name" value="${m.name || ''}" required></div>
      <div class="field"><label>It’s a…</label><select class="input" name="kind">${Object.entries(kinds).map(([k, l]) => html`<option value="${k}" ${k === (m.kind || 'debt') ? raw('selected') : ''}>${l}</option>`)}</select></div>
      <div class="field"><label>Type</label><select class="input" name="type">${TYPES.map((t) => html`<option value="${t}" ${t === m.type ? raw('selected') : ''}>${F.typeLabel(t)}</option>`)}</select></div>
      <div class="field"><label>Holder</label><select class="input" name="holder">${F.meta.holders.map((h) => html`<option ${h === (m.holder || 'Joint') ? raw('selected') : ''}>${h}</option>`)}</select></div>
      <div class="field"><label>Entity</label><select class="input" name="entity">${F.entityOptions(m.entity)}</select></div>
      <div class="field"><label>Interest rate</label><input class="input" name="rate" value="${m.rate ?? ''}" inputmode="decimal"></div>
      <div class="field"><label>Status</label><select class="input" name="status"><option value="open" ${m.status !== 'closed' ? raw('selected') : ''}>Open</option><option value="closed" ${m.status === 'closed' ? raw('selected') : ''}>Closed / paid off</option></select></div>
      ${m.id ? '' : html`<div class="field"><label>Current balance</label><span class="money-wrap"><input class="input" name="balance" inputmode="decimal"></span></div><div class="field"><label>As of</label><input class="input" type="date" name="as_of" value="${F.todayISO()}"></div>`}
      <label class="check full"><input type="checkbox" name="include_in_totals" ${m.include_in_totals !== 0 ? raw('checked') : ''}> Count in net worth</label>
      <div class="field full"><label>Notes</label><input class="input" name="notes" value="${m.notes || ''}"></div></div>`,
    danger: m.id ? { label: m.sheet_loan ? 'Close account' : 'Delete', onClick: async () => { if (await F.confirm(m.sheet_loan ? `Close ${m.name}?` : `Delete ${m.name}?`, m.sheet_loan ? 'It comes from Jenny’s sheet, so it’s closed rather than deleted.' : 'Its balance history is deleted too.', m.sheet_loan ? 'Close' : 'Delete')) { await F.del('/api/manual_account', { id: m.id }); F.go('#/manual?tab=accounts'); return true; } return false; } } : null,
    onSubmit: async (v) => {
      if (!v.name.trim()) return false;
      const res = await F.post('/api/manual_account', { ...v, id: m.id, balance: (v.balance || '').replace(/[$,]/g, '') });
      F.toast('Account saved'); F.go(`#/manual?tab=accounts&id=${res.id}`); F.refresh();
    },
  });
  const sel = p.id ? d.manual_accounts.find((m) => m.id === +p.id) : null;
  F.setHTML(root, html`
    ${F.head({ title: 'Manual entry', lede: 'Add what the bank sync doesn’t see. Synced transactions can be edited but not deleted here — they’d come back on the next sync.' })}
    <div class="tabs" role="tablist"><a role="tab" href="#/manual?tab=transactions" aria-selected="${String(tab === 'transactions')}">Transactions <span class="badge">${d.manual_transactions.length}</span></a>
      <a role="tab" href="#/manual?tab=accounts" aria-selected="${String(tab === 'accounts')}">Accounts and balances <span class="badge">${d.manual_accounts.length}</span></a>
      <a role="tab" href="#/investments" aria-selected="false">Investment snapshots →</a></div>
    ${tab === 'transactions' ? html`<div class="grid">
      <section class="panel span-5"><div class="panel-head"><h2>Add a transaction</h2></div><div class="panel-body">${txnForm()}<div class="row" style="margin-top:12px"><button class="btn primary" data-add-txn>${icon('plus')}Add transaction</button></div></div></section>
      <section class="panel span-7"><div class="panel-head"><h2>Entered by hand</h2><span class="sub">Tap one to edit or delete</span></div><div class="panel-body flush"><div class="list">
        ${d.manual_transactions.map((t) => html`<button class="list-item" data-mt="${t.txn_id}"><div class="main-col"><div class="title">${t.description}</div><div class="meta">${fmt.date(t.posted_date, { year: true })} · ${t.account} · ${t.category || 'No category'}${t.updated_by ? ' · ' + t.updated_by : ''}</div></div><span class="amount">${F.amtCell(t.amount)}</span></button>`)}</div>
        ${d.manual_transactions.length ? '' : F.empty('Nothing entered by hand yet', 'Cash rent, a reimbursement paid by check, a purchase on a card that isn’t linked — add it on the left.')}</div></section></div>`
    : html`<div class="grid">
      <section class="panel span-5"><div class="panel-head"><h2>Accounts</h2><div class="tools"><button class="btn sm primary" data-new-acct>${icon('plus')}Add</button></div></div><div class="panel-body flush"><div class="list">
        ${d.manual_accounts.map((m) => html`<a class="list-item" href="#/manual?tab=accounts&id=${m.id}" ${sel && sel.id === m.id ? raw('aria-current="true" style="background:var(--accent-soft)"') : ''}><div class="main-col"><div class="title">${m.name}</div>
          <div class="meta">${kinds[m.kind]} · ${F.typeLabel(m.type)}${m.sheet_loan ? ' · from Jenny’s sheet' : ''}${m.status === 'closed' ? ' · closed' : ''}${!m.include_in_totals ? ' · not in totals' : ''}</div></div>
          <span class="acct-amt"><span class="amount">${fmt.amt(m.kind === 'debt' ? -Math.abs(m.balance || 0) : m.balance)}</span><span class="tiny muted">${m.as_of ? fmt.date(m.as_of, { year: true }) : 'no balance'}</span></span></a>`)}</div>
        ${d.manual_accounts.length ? '' : F.empty('No manual accounts')}</div></section>
      <section class="panel span-7">${sel ? html`<div class="panel-head"><h2>${sel.name}</h2><span class="sub">${kinds[sel.kind]} · ${fmt.money(sel.balance)}</span><div class="tools"><button class="btn sm" data-edit-acct>${icon('edit')}Edit</button></div></div>
        <div class="panel-body"><div class="chart h-220" id="ma-chart"></div>
          <form class="row wrap" id="mb-form" style="margin-top:14px;align-items:flex-end;gap:10px"><div class="field"><label>Date</label><input class="input" type="date" name="as_of" value="${F.todayISO()}"></div>
            <div class="field"><label>Balance</label><span class="money-wrap"><input class="input" name="balance" inputmode="decimal" style="width:140px" aria-label="Balance"></span></div><div class="field" style="flex:1;min-width:140px"><label>Note</label><input class="input" name="note"></div>
            <button class="btn primary" type="submit">Add balance</button></form>
          ${sel.sheet_loan ? html`<p class="caption">Month-end balances also come from Jenny’s sheet (“${sel.sheet_loan}”). A balance you add on the same date wins.</p>` : ''}</div>
        <div class="panel-body flush"><div class="table-wrap"><table class="t"><thead><tr><th>Date</th><th class="num">Balance</th><th>Source</th><th></th></tr></thead><tbody>
          ${[...sel.points].reverse().map((pt) => { const e = sel.entries.find((x) => x.as_of === pt.date && pt.source === 'manual'); return html`<tr><td>${fmt.date(pt.date, { year: true })}</td><td class="num key">${fmt.amt(pt.balance)}</td><td><span class="pill ${pt.source === 'sheet' ? 'neutral' : 'good'}">${pt.source === 'sheet' ? 'Sheet' : 'Entered'}</span>${e && e.note ? html` <span class="small muted">${e.note}</span>` : ''}</td>
            <td class="right">${e ? html`<button class="btn xs ghost danger" data-del-bal="${e.id}">Delete</button>` : ''}</td></tr>`; })}</tbody></table></div></div>`
      : F.empty('Pick an account', 'Choose one on the left to see its balance history and add a new balance.')}</section></div>`}`);
  if (tab === 'transactions') {
    $('[data-add-txn]', root).onclick = async () => { const f = $('.mt-form', root); const v = {}; $$('[name]', f).forEach((i) => { if (i.type === 'radio') { if (i.checked) v[i.name] = i.value; } else v[i.name] = i.value; }); await saveTxn(v); };
    $$('[data-mt]', root).forEach((b) => (b.onclick = () => {
      const t = d.manual_transactions.find((x) => x.txn_id === b.dataset.mt);
      F.modal({ title: 'Edit manual transaction', body: txnForm(t), onSubmit: (v) => saveTxn(v, t.txn_id),
        danger: { label: 'Delete', onClick: async () => { if (await F.confirm('Delete this transaction?', `${t.description} · ${fmt.money(t.amount)}`)) { await F.del('/api/txn/manual', { id: t.txn_id }); F.toast('Deleted'); F.refresh(); return true; } return false; } } });
    }));
  } else {
    $('[data-new-acct]', root).onclick = () => acctModal({});
    if (p.new === '1') acctModal({});
    if (sel) {
      $('[data-edit-acct]', root).onclick = () => acctModal(sel);
      $('#mb-form', root).onsubmit = async (e) => {
        e.preventDefault(); const v = Object.fromEntries(new FormData(e.target));
        if (!v.balance || Number.isNaN(+v.balance.replace(/[$,]/g, ''))) { F.toast('Enter a balance', { kind: 'error' }); return; }
        await F.post('/api/manual_balance', { manual_account_id: sel.id, as_of: v.as_of, balance: v.balance.replace(/[$,]/g, ''), note: v.note });
        F.toast('Balance added'); F.refresh();
      };
      $$('[data-del-bal]', root).forEach((b) => (b.onclick = async () => { await F.del('/api/manual_balance', { id: b.dataset.delBal }); F.refresh(); }));
      const draw = () => {
        if (!F.hasCharts) return;
        if (sel.points.length < 2) { $('#ma-chart', root).classList.add('is-empty'); F.setHTML($('#ma-chart', root), F.empty('Add another balance to see a trend')); return; }
        F.chart($('#ma-chart', root), { type: 'line', aria: 'Balance history', data: { labels: sel.points.map((x) => fmt.date(x.date, { year: true })), datasets: [F.areaDs('Balance', sel.points.map((x) => x.balance), F.css(sel.kind === 'debt' ? '--ink' : '--accent'))] }, options: F.chartOpts({ kind: 'line', beginAtZero: false }) });
      };
      draw();
      ctl.rerender = () => { F.destroyCharts(); draw(); };
    }
  }
};
