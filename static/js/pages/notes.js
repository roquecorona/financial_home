/* Notes journal: every note on transactions, accounts, properties, orders, bills and months. */
'use strict';
F.pages.notes = async (root, r, ctl) => {
  const { html, raw, fmt, icon, $, $$ } = F;
  const p = r.params;
  const d = await F.get('/api/notes', { q: p.q, target_type: p.month ? 'month' : p.type, target_id: p.month, author: p.author });
  if (!ctl.alive()) return;
  const setP = (patch) => F.go('#/notes?' + new URLSearchParams(Object.entries({ ...p, ...patch }).filter(([, v]) => v)).toString());
  const TYPES = [['', 'Everything'], ['month', 'Months'], ['transaction', 'Transactions'], ['account', 'Accounts'], ['property', 'Properties'], ['bill', 'Bills'], ['order', 'Orders']];
  const groups = {};
  d.notes.forEach((n) => { const k = n.pinned ? 'Pinned' : fmt.month((n.updated_at || n.created_at).slice(0, 7)); (groups[k] = groups[k] || []).push(n); });
  const typeLabel = { month: 'Month', transaction: 'Transaction', account: 'Account', property: 'Property', bill: 'Bill', order: 'Order' };
  F.setHTML(root, html`
    ${F.head({ title: 'Notes', lede: 'One shared journal. Notes added anywhere — on a charge, a card, a property, a month — collect here, signed by whoever wrote them.' })}
    <div class="grid">
      <section class="span-8">
        <div class="filters"><input class="input sm" type="search" data-q placeholder="Search notes" value="${p.q || ''}" style="width:240px" aria-label="Search notes">
          <select class="input sm" data-type style="width:auto" aria-label="About">${TYPES.map(([k, l]) => html`<option value="${k}" ${(p.month ? 'month' : p.type || '') === k ? raw('selected') : ''}>${l}</option>`)}</select>
          <div class="seg" role="group" aria-label="Author">${[['', 'Both'], ['Roque', 'Roque'], ['Jenny', 'Jenny']].map(([k, l]) => html`<button type="button" data-author="${k}" aria-pressed="${String((p.author || '') === k)}">${l}</button>`)}</div>
          ${p.month ? html`<button class="chip" aria-pressed="true" data-clear-month>${fmt.month(p.month)} ✕</button>` : ''}</div>
        ${d.notes.length ? Object.entries(groups).map(([g, list]) => html`<div class="panel" style="margin-top:28px"><div class="panel-head"><h2>${g}</h2><span class="sub">${list.length}</span></div><div class="panel-body" style="padding-top:4px">
          ${list.map((n) => html`<div class="note" data-id="${n.id}">${F.avatar(n.author) || html`<span class="avatar">?</span>`}<div style="flex:1;min-width:0">
            <div class="row wrap small" style="gap:6px;margin-bottom:3px"><span class="pill neutral">${typeLabel[n.target_type] || n.target_type}</span><a href="${n.link}">${n.target_label}</a><span class="muted">· ${fmt.date((n.created_at || '').slice(0, 10), { year: true })}</span></div>
            <div class="body">${n.body}</div>
            <div class="meta"><span>${n.author || 'Unsigned'} · ${fmt.ago(n.created_at)}${n.updated_at ? ' · edited' : ''}</span>${n.pinned ? html`<span class="pill info">${icon('pin')}Pinned to Home</span>` : ''}
              <button type="button" data-pin>${n.pinned ? 'Unpin' : 'Pin'}</button><button type="button" data-edit>Edit</button><button type="button" data-del>Delete</button></div></div></div>`)}</div></div>`)
        : html`<div class="panel">${F.empty(p.q || p.type || p.author || p.month ? 'No notes match' : 'No notes yet', 'Add one to a month on the right, or open any transaction, account or property and write a note there.')}</div>`}
      </section>
      <section class="span-4 stack">
        <div class="panel"><div class="panel-head"><h2>Note on a month</h2></div><div class="panel-body stack" style="gap:10px">
          <div class="field"><label for="nm-month">Month</label><input class="input" type="month" id="nm-month" value="${p.month || F.thisMonth()}"></div>
          <div class="field"><label for="nm-body">Note</label><textarea class="input" id="nm-body" rows="4" placeholder="What happened this month that we’ll want to remember?"></textarea></div>
          <label class="check small"><input type="checkbox" id="nm-pin"> Pin to Home</label>
          <div class="row"><button class="btn primary" data-add-month>Add note</button><span class="small muted">${F.state.user ? 'Signed ' + F.state.user : ''}</span></div></div></div>
        <p class="small ink2 hide-sm">Tip: press <kbd>/</kbd> anywhere to search notes together with transactions and orders.</p>
      </section>
    </div>`);
  const qi = $('[data-q]', root); qi.addEventListener('input', F.debounce(() => setP({ q: qi.value }), 450));
  $('[data-type]', root).onchange = (e) => setP({ type: e.target.value, month: '' });
  $$('[data-author]', root).forEach((b) => (b.onclick = () => setP({ author: b.dataset.author })));
  const cm = $('[data-clear-month]', root); if (cm) cm.onclick = () => setP({ month: '' });
  $('[data-add-month]', root).onclick = async () => {
    const body = $('#nm-body', root).value.trim(), month = $('#nm-month', root).value;
    if (!body || !month) { $('#nm-body', root).focus(); return; }
    await F.post('/api/note', { target_type: 'month', target_id: month, body, pinned: $('#nm-pin', root).checked });
    F.toast(`Note added to ${fmt.month(month)}`); F.refresh();
  };
  $$('.note[data-id]', root).forEach((el) => {
    const n = d.notes.find((x) => x.id === +el.dataset.id);
    $('[data-del]', el).onclick = async () => { if (await F.confirm('Delete this note?', n.body.slice(0, 140))) { await F.del('/api/note', { id: n.id }); F.refresh(); } };
    $('[data-pin]', el).onclick = async () => { await F.post('/api/note', { id: n.id, target_type: n.target_type, target_id: n.target_id, pinned: !n.pinned }); F.refresh(); };
    $('[data-edit]', el).onclick = () => F.modal({ title: 'Edit note', body: html`<textarea class="input" name="body" rows="6">${n.body}</textarea>`,
      onSubmit: async (v) => { await F.post('/api/note', { id: n.id, target_type: n.target_type, target_id: n.target_id, body: v.body }); F.refresh(); } });
  });
};
