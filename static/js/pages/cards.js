/* 03 Pay cards — replaces Jenny's monthly card sheet. Every edit autosaves.
   Built for one hand on a phone: big planned-amount field, one-tap fills (statement / minimum / full), a 44px Paid
   toggle, and a live bar with what's planned, still to go out and what's left in checking. */
'use strict';
F.pages.cards = async (root, r, ctl) => {
  const { html, raw, fmt, icon, $, $$ } = F;
  const month = r.params.month || F.thisMonth();
  const d = await F.get('/api/cards', { month });
  if (!ctl.alive()) return;
  const pref = (k, def) => { try { return localStorage.getItem('fin.cards.' + k) ?? def; } catch { return def; } };
  const setPref = (k, v) => { try { localStorage.setItem('fin.cards.' + k, v); } catch { /* ignore */ } };
  let showHidden = r.params.hidden === '1';
  let zeroOpen = false;
  let owner = pref('owner', 'all');
  let sortBy = pref('sort', 'due');
  let hidePaid = pref('hidePaid', '0') === '1';
  const openRows = new Set();
  const today = F.todayISO();
  const isPast = month < F.thisMonth();
  const cashOpts = d.cash_accounts.map((a) => a.label);
  const fromOptions = (cur) => {
    const opts = [...new Set([...cashOpts, ...(cur && !cashOpts.includes(cur) ? [cur] : [])])];
    return html`<option value="">Choose…</option>${opts.map((o) => html`<option ${o === cur ? raw('selected') : ''}>${o}</option>`)}<option value="__other">Other…</option>`;
  };
  const cards = d.cards;
  const byKey = Object.fromEntries(cards.map((c) => [c.card_key, c]));
  const holders = [...new Set(cards.map((c) => c.holder).filter(Boolean))];
  const short = (h) => (h === 'Jennifer' ? 'Jenny' : h);
  const ownerOk = (c) => owner === 'all' || c.holder === owner;
  const num = (v) => (v === null || v === undefined || v === '' ? null : +v);
  const overdue = (c) => !c.paid && c.due_date && c.due_date < today && (c.owed || 0) > 0.005 && !isPast;

  const totals = () => {
    const vis = cards.filter((c) => !c.hidden && ownerOk(c));
    const owed = vis.reduce((s, c) => s + Math.max(0, c.owed || 0), 0);
    const planned = vis.reduce((s, c) => s + (+c.planned || 0), 0);
    const unpaid = vis.filter((c) => !c.paid).reduce((s, c) => s + (+c.planned || 0), 0);
    // "Left" always uses every card (the checking balance is shared), whatever the owner filter shows.
    const allUnpaid = cards.filter((c) => !c.hidden && !c.paid).reduce((s, c) => s + (+c.planned || 0), 0);
    const byFrom = {};
    cards.filter((c) => !c.hidden && !c.paid && +c.planned).forEach((c) => { const k = c.pay_from || 'Not chosen'; byFrom[k] = (byFrom[k] || 0) + +c.planned; });
    const withBal = vis.filter((c) => (c.owed || 0) > 0.005 || +c.planned > 0);
    return { owed, planned, unpaid, allUnpaid, left: d.totals.checking - allUnpaid, byFrom, paid: withBal.filter((c) => c.paid).length, count: withBal.length, unplanned: withBal.filter((c) => !c.paid && !(+c.planned > 0)).length };
  };
  const drawTotals = () => {
    const t = totals();
    const who = owner === 'all' ? '' : ` · ${short(owner)}`;
    F.setHTML($('#pay-band', root), html`
      ${F.kpi('Owed on cards' + who, F.kpiMoney(t.owed), `${t.count} card${t.count === 1 ? '' : 's'} with a balance`)}
      ${F.kpi('Planned' + who, F.kpiMoney(t.planned), t.unplanned ? `${t.unplanned} not planned yet` : 'Every card planned')}
      ${F.kpi('Paid' + who, html`${t.paid}<span class="of">/${t.count}</span>`, t.unpaid ? `${fmt.money(t.unpaid, { cents: false })} planned, not paid yet` : t.count && t.paid === t.count ? 'All paid' : t.planned ? 'Everything planned is paid' : 'Nothing planned yet')}
      ${F.kpi('Left in checking', F.kpiMoney(t.left), t.left < 0 ? html`<span class="alert-text">Short ${fmt.money(-t.left, { cents: false })}</span>` : `${fmt.money(d.totals.checking, { cents: false })} now, after unpaid plans`, { cls: t.left < 0 ? 'leftover neg' : 'leftover' })}`);
    const fromEntries = Object.entries(t.byFrom).sort((a, b) => b[1] - a[1]);
    F.setHTML($('#by-from', root), fromEntries.length ? html`<div class="from-line"><span class="label">Unpaid by account</span>${fromEntries.map(([k, v]) => {
      const acct = d.cash_accounts.find((a) => a.label === k);
      const rest = acct ? acct.balance - v : null;
      return html`<span>${k}: <b>${fmt.amt(v)}</b>${acct ? html` of ${fmt.amt(acct.balance)} → <b class="${rest < 0 ? 'alert-text' : ''}">${fmt.amt(rest)}</b> left` : ''}</span>`;
    })}</div>` : '');
    F.setHTML($('#paybar', root), html`<div><span>Planned</span><b>${fmt.amt(t.planned, { cents: false })}</b></div><div><span>To go out</span><b>${fmt.amt(t.allUnpaid, { cents: false })}</b></div>
      <div class="${t.left < 0 ? 'alert-text' : ''}"><span>Left</span><b>${fmt.amt(t.left, { cents: false })}</b></div><div><span>Paid</span><b>${t.paid}/${t.count}</b></div>`);
  };

  const flag = (c, text, bad) => {
    const f = $(`[data-saved="${CSS.escape(c.card_key)}"]`, root);
    if (!f) return;
    f.textContent = text; f.classList.toggle('alert-text', !!bad);
    clearTimeout(f._t); if (!bad) f._t = setTimeout(() => (f.textContent = ''), 1600);
  };
  const save = async (c, patch, toastMsg) => {
    const prev = {}; Object.keys(patch).forEach((k) => (prev[k] = c[k === 'amount' ? 'planned' : k]));
    Object.assign(c, patch); if ('amount' in patch) c.planned = patch.amount;
    drawTotals();
    flag(c, 'Saving…');
    try {
      await F.post('/api/plan', { month, card_key: c.card_key, ...patch });
      flag(c, 'Saved');
      if (toastMsg) F.toast(toastMsg);
    } catch {
      Object.entries(prev).forEach(([k, v]) => (c[k] = v)); drawTotals();
      flag(c, 'Not saved', true);
    }
  };

  const fillBtn = (label, v, key) => (v !== null && v !== undefined && v > 0 ? html`<button type="button" data-fill-v="${v}" data-fill-k="${key}" aria-label="Plan ${label.toLowerCase()} ${fmt.money(v)}">${label} <span class="num">${fmt.amt(v, { cents: v < 1000 })}</span></button>` : '');
  const row = (c) => {
    const util = c.credit_limit && c.owed > 0 ? Math.min(1, c.owed / c.credit_limit) : null;
    const od = overdue(c);
    const open = openRows.has(c.card_key);
    return html`<div class="payrow ${c.paid ? 'paid' : ''} ${c.hidden ? 'is-hidden' : ''} ${open ? 'open' : ''} ${od ? 'is-overdue' : ''}" data-key="${c.card_key}" role="group" aria-label="${c.name}${c.last4 ? ' ending ' + c.last4 : ''}">
      <div class="c-dd"><span class="dnum ${od ? 'overdue' : c.due_date === today ? 'today' : ''}" title="${c.due_date ? 'Due ' + fmt.date(c.due_date, { long: true }) : 'No due date'}">${c.due_date ? fmt.date(c.due_date) : '—'}</span></div>
      <div class="name"><b>${c.linked ? html`<a href="#/accounts/${encodeURIComponent(c.account_id)}">${c.name}</a>` : c.name}</b>
        <div class="meta"><span>${short(c.holder) || ''}${c.last4 ? ' ••' + c.last4 : ''}</span>${od ? html`<span class="pill crit">Past due</span>` : ''}${!c.linked ? html`<span class="pill neutral" title="Not connected to the bank sync">Sheet</span>` : ''}${c.autopay ? html`<span class="pill info">Autopay</span>` : ''}
          ${c.auto_paid && !c.paid ? html`<span class="pill good" title="Payments this month cover the plan">${icon('check')}Payment seen</span>` : ''}<span class="saved-flag" data-saved="${c.card_key}" aria-live="polite"></span></div>
        ${util !== null ? html`<div class="util ${util > 0.3 ? 'hi' : ''}" title="${fmt.pct(util, 0)} of ${fmt.money(c.credit_limit, { cents: false })} limit"><i style="width:${(util * 100).toFixed(1)}%"></i></div>` : ''}</div>
      <div class="owed"><span class="cell-label">Owed</span><span class="num">${fmt.amt(c.owed)}</span><small>${c.linked ? (c.owed_asof ? fmt.ago(c.owed_asof) : '') : (c.owed_asof || '').replace('sheet ', 'sheet · ')}${c.paid_this_month ? ` · paid ${fmt.amt(c.paid_this_month, { cents: false })}` : ''}</small></div>
      <div class="c-stmt"><label class="cell-label" for="st-${c.card_key}">Statement</label><span class="money-wrap"><input class="input sm" id="st-${c.card_key}" data-f="statement_due" inputmode="decimal" enterkeyhint="done" autocomplete="off" value="${c.statement_due ?? ''}" aria-label="Statement balance, ${c.name}"></span></div>
      <div class="c-min"><label class="cell-label" for="mn-${c.card_key}">Minimum</label><span class="money-wrap"><input class="input sm" id="mn-${c.card_key}" data-f="min_due" inputmode="decimal" enterkeyhint="done" autocomplete="off" value="${c.min_due ?? ''}" aria-label="Minimum due, ${c.name}"></span></div>
      <div class="c-plan"><label class="cell-label" for="pl-${c.card_key}">Planned</label><span class="money-wrap"><input class="input sm" id="pl-${c.card_key}" data-f="amount" inputmode="decimal" enterkeyhint="done" autocomplete="off" value="${c.planned ?? ''}" placeholder="0.00" aria-label="Planned payment, ${c.name}"></span></div>
      <div class="c-from"><label class="cell-label" for="pf-${c.card_key}">Pay from</label><select class="input sm" id="pf-${c.card_key}" data-f="pay_from" aria-label="Pay from, ${c.name}">${fromOptions(c.pay_from)}</select></div>
      <div class="c-paid"><button type="button" class="paid-toggle" data-paid aria-pressed="${String(!!c.paid)}" aria-label="${c.name} paid">${icon('check')}<span>${c.paid ? 'Paid' : 'Mark paid'}</span></button></div>
      <div class="fills">${fillBtn('Stmt', num(c.statement_due), 'statement')}${fillBtn('Min', num(c.min_due), 'minimum')}${fillBtn('Full', (c.owed || 0) > 0 ? Math.round(c.owed * 100) / 100 : null, 'full')}</div>
      <div class="acts"><button type="button" class="btn xs hide-sm" data-full title="Plan the full amount owed" ${(c.owed || 0) > 0 ? '' : raw('disabled')}>Full</button>
        <button type="button" class="more-btn" data-more aria-expanded="${String(open)}" aria-label="More for ${c.name}">${icon('more')}</button></div>
      <div class="c-extra">
        <div class="c-due"><label class="cell-label" for="dd-${c.card_key}">Due date this month</label><input class="input sm" type="date" id="dd-${c.card_key}" data-f="due_date" value="${c.due_date || ''}"></div>
        <div class="c-set"><span class="cell-label">Card defaults</span><button type="button" class="btn sm" data-gear>${icon('settings')}Due day, limit, autopay…</button></div>
        ${c.payments.length ? html`<div class="c-pays"><span class="cell-label">Payments seen this month</span>${c.payments.map((p) => html`<button type="button" class="linkbtn" data-txn="${p.txn_id}">${fmt.date(p.posted_date)} · ${fmt.amt(p.amount)}</button>`)}</div>` : ''}
      </div>
    </div>`;
  };
  const order = (list) => list.sort((a, b) => (sortBy === 'owed' ? (b.owed || 0) - (a.owed || 0) : (a.due_date || '9999').localeCompare(b.due_date || '9999') || (b.owed || 0) - (a.owed || 0)));
  const draw = () => {
    const vis0 = cards.filter((c) => (showHidden || !c.hidden) && ownerOk(c));
    const active = (c) => (c.owed || 0) > 0.005 || +c.planned > 0 || +c.statement_due > 0 || c.paid;
    let vis = vis0.filter(active);
    const paidHidden = hidePaid ? vis.filter((c) => c.paid).length : 0;
    if (hidePaid) vis = vis.filter((c) => !c.paid);
    const zero = vis0.filter((c) => !active(c));
    const hiddenCount = cards.filter((c) => c.hidden && ownerOk(c)).length;
    F.setHTML($('#pay-rows', root), html`
      <div class="payhead" aria-hidden="true"><span>Due</span><span>Card</span><span class="right">Owed</span><span>Statement</span><span>Minimum</span><span>Planned</span><span>Pay from</span><span>Paid</span><span></span></div>
      ${vis.length ? order(vis).map(row) : F.empty(paidHidden ? `All ${paidHidden} paid` : 'Nothing owed on any card', paidHidden ? 'Turn off “Hide paid” to see them.' : 'Cards with a balance or a planned payment show up here.')}
      ${paidHidden ? html`<p class="caption">${paidHidden} paid card${paidHidden === 1 ? '' : 's'} hidden.</p>` : ''}
      ${zero.length ? html`<details class="disclosure" ${zeroOpen ? raw('open') : ''}><summary>Cards with nothing owed <span class="badge">${zero.length}</span></summary>${order(zero).map(row)}</details>` : ''}
      <div class="panel-foot">${hiddenCount ? html`<button type="button" class="btn sm ghost" data-toggle-hidden>${showHidden ? 'Hide' : 'Show'} ${hiddenCount} hidden card${hiddenCount === 1 ? '' : 's'}</button>` : ''}
        <span class="small muted" style="margin-left:auto">Owed comes from the bank sync; “Sheet” cards use Jenny’s last statement figure. Edits save as you type.</span></div>`);
    bindRows();
  };
  const bindRows = () => {
    $$('.payrow', root).forEach((rowEl) => {
      const c = byKey[rowEl.dataset.key];
      $$('[data-f]', rowEl).forEach((inp) => {
        const f = inp.dataset.f;
        let last = inp.value;
        const commit = async () => {
          if (inp.value === last && f !== 'pay_from') return;
          if (f === 'pay_from' && inp.value === '__other') {
            const v = prompt('Pay from which account?'); if (!v) { inp.value = c.pay_from || ''; return; }
            inp.insertAdjacentHTML('afterbegin', `<option>${F.esc(v)}</option>`); inp.value = v;
          }
          let v = inp.value.trim();
          if (['amount', 'statement_due', 'min_due'].includes(f)) {
            const n = F.parseAmt(v);
            if (Number.isNaN(n)) { inp.setAttribute('aria-invalid', 'true'); flag(c, 'Enter a number like 250.00', true); return; }
            inp.removeAttribute('aria-invalid');
            v = n;
          }
          last = inp.value;
          await save(c, { [f]: v });
          if (f === 'statement_due' || f === 'min_due') refreshFills(rowEl, c);
          if (f === 'due_date') { draw(); }
        };
        if (inp.tagName === 'INPUT' && inp.type !== 'date') { inp.addEventListener('input', F.debounce(commit, 700)); inp.addEventListener('change', commit); }
        else inp.addEventListener('change', commit);
        if (inp.inputMode === 'decimal') inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
      });
      const setPlanned = async (v, how) => {
        const inp = $('[data-f=amount]', rowEl); inp.value = v.toFixed(2);
        await save(c, { amount: v });
        flag(c, `Planned ${how}`);
      };
      $$('[data-fill-v]', rowEl).forEach((b) => (b.onclick = () => setPlanned(+b.dataset.fillV, b.dataset.fillK)));
      const full = $('[data-full]', rowEl); if (full) full.onclick = () => setPlanned(Math.max(0, c.owed || 0), 'full');
      $('[data-paid]', rowEl).onclick = async (e) => {
        const b = e.currentTarget, v = !c.paid;
        b.setAttribute('aria-pressed', String(v)); $('span', b).textContent = v ? 'Paid' : 'Mark paid';
        rowEl.classList.toggle('paid', v); rowEl.classList.toggle('is-overdue', !v && overdue({ ...c, paid: false }));
        await save(c, { paid: v });
        if (!c.paid === v) { b.setAttribute('aria-pressed', String(!v)); $('span', b).textContent = !v ? 'Paid' : 'Mark paid'; rowEl.classList.toggle('paid', !v); }
      };
      $('[data-more]', rowEl).onclick = (e) => {
        const open = !rowEl.classList.contains('open');
        rowEl.classList.toggle('open', open); e.currentTarget.setAttribute('aria-expanded', String(open));
        open ? openRows.add(c.card_key) : openRows.delete(c.card_key);
      };
      $('[data-gear]', rowEl).onclick = () => cardSettings(c);
      $$('[data-txn]', rowEl).forEach((b) => (b.onclick = () => F.openTxn(b.dataset.txn)));
    });
    const det = $('#pay-rows details', root); if (det) det.ontoggle = () => { zeroOpen = det.open; };
    const th = $('[data-toggle-hidden]', root); if (th) th.onclick = () => { showHidden = !showHidden; draw(); drawTotals(); };
  };
  const refreshFills = (rowEl, c) => {
    const box = $('.fills', rowEl); if (!box) return;
    F.setHTML(box, html`${fillBtn('Stmt', num(c.statement_due), 'statement')}${fillBtn('Min', num(c.min_due), 'minimum')}${fillBtn('Full', (c.owed || 0) > 0 ? Math.round(c.owed * 100) / 100 : null, 'full')}`);
    $$('[data-fill-v]', box).forEach((b) => (b.onclick = async () => { const v = +b.dataset.fillV; $('[data-f=amount]', rowEl).value = v.toFixed(2); await save(c, { amount: v }); flag(c, `Planned ${b.dataset.fillK}`); }));
  };
  const cardSettings = (c) => F.modal({
    title: c.name, sub: 'These defaults apply to every month for this card.',
    body: html`<div class="form-grid">
      <div class="field full"><label for="cs-name">Name on this screen</label><input class="input" id="cs-name" name="display_name" value="${c.name}"></div>
      <div class="field"><label for="cs-dd">Due day of month</label><input class="input" id="cs-dd" name="due_day" type="number" inputmode="numeric" min="1" max="31" value="${c.due_day ?? ''}"></div>
      <div class="field"><label for="cs-lim">Credit limit</label><span class="money-wrap"><input class="input" id="cs-lim" name="credit_limit" inputmode="decimal" value="${c.credit_limit ?? ''}"></span></div>
      <div class="field full"><label for="cs-from">Usually paid from</label><select class="input" id="cs-from" name="pay_from">${fromOptions(c.pay_from)}</select></div>
      ${!c.linked ? html`<div class="field full"><label for="cs-owed">Owed this month (not synced)</label><span class="money-wrap"><input class="input" id="cs-owed" name="owed_override" inputmode="decimal" value="${c.owed ?? ''}"></span></div>` : ''}
      <label class="check"><input type="checkbox" name="autopay" ${c.autopay ? raw('checked') : ''}> On autopay</label>
      <label class="check"><input type="checkbox" name="hidden" ${c.hidden ? raw('checked') : ''}> Hide from this screen</label></div>`,
    onSubmit: async (v) => {
      if (v.credit_limit && Number.isNaN(F.parseAmt(v.credit_limit))) { F.toast('Credit limit must be a number', { kind: 'error' }); return false; }
      await F.post('/api/card_settings', { card_key: c.card_key, display_name: v.display_name, due_day: v.due_day, credit_limit: v.credit_limit,
        pay_from: v.pay_from === '__other' ? '' : v.pay_from, autopay: v.autopay, hidden: v.hidden });
      if (!c.linked && v.owed_override !== undefined) await F.post('/api/plan', { month, card_key: c.card_key, owed_override: v.owed_override });
      F.toast('Card settings saved'); F.refresh();
    },
  });

  F.setHTML(root, html`
    ${F.head({ title: 'Pay cards', compactSm: true, lede: html`Plan this month’s payments, check checking covers them, tick them off.${isPast ? html` <b>You’re looking at a past month.</b>` : ''}`,
      actions: html`${F.monthNav(month, d.months)}<button type="button" class="btn primary" data-fill-all>Plan every card</button>` })}
    <section class="band" id="pay-band" style="--n:4" aria-label="Totals"></section>
    <div id="by-from"></div>
    <div class="paytools" role="toolbar" aria-label="Filter cards">
      ${holders.length > 1 ? html`<div class="seg" role="group" aria-label="Card holder">${[['all', 'Both'], ...holders.map((h) => [h, short(h)])].map(([k, l]) => html`<button type="button" data-owner="${k}" aria-pressed="${String(owner === k)}">${l}</button>`)}</div>` : ''}
      <div class="seg" role="group" aria-label="Sort"><button type="button" data-sort="due" aria-pressed="${String(sortBy === 'due')}">By due date</button><button type="button" data-sort="owed" aria-pressed="${String(sortBy === 'owed')}">By owed</button></div>
      <label class="check small"><input type="checkbox" data-hide-paid ${hidePaid ? raw('checked') : ''}> Hide paid</label>
    </div>
    <section id="pay-rows" aria-label="Cards"></section>
    <div class="paybar" id="paybar" aria-live="polite"></div>
    <div class="grid">
      <section class="span-6">${F.secHead(`Notes for ${fmt.month(month)}`)}<div class="panel-body" id="month-notes"></div></section>
      <section class="span-6">${F.secHead('Payments that went out this month')}
        ${cards.some((c) => c.payments.length) ? html`<div class="rows">${cards.flatMap((c) => c.payments.map((p) => ({ ...p, name: c.name }))).sort((a, b) => b.posted_date.localeCompare(a.posted_date)).map((p) => html`<button type="button" class="trow" data-txn="${p.txn_id}">
          <span class="d">${fmt.date(p.posted_date)}</span><span class="t"><span class="ellipsis">${p.name}</span></span><span class="a">${fmt.amt(Math.abs(p.amount))}</span></button>`)}</div>`
        : F.empty('No card payments posted yet this month')}</section>
    </div>`);
  drawTotals();
  draw();
  F.bindMonthNav(root, (m) => F.go(`#/cards?month=${m}`));
  F.notesBlock($('#month-notes', root), 'month', month, d.notes, { placeholder: 'e.g. Paying Hyatt Business in two parts this month' });
  $$('.grid [data-txn]', root).forEach((b) => (b.onclick = () => F.openTxn(b.dataset.txn)));
  $$('[data-owner]', root).forEach((b) => (b.onclick = () => { owner = b.dataset.owner; setPref('owner', owner); $$('[data-owner]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); drawTotals(); }));
  $$('[data-sort]', root).forEach((b) => (b.onclick = () => { sortBy = b.dataset.sort; setPref('sort', sortBy); $$('[data-sort]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); }));
  $('[data-hide-paid]', root).onchange = (e) => { hidePaid = e.target.checked; setPref('hidePaid', hidePaid ? '1' : '0'); draw(); };
  $('[data-fill-all]', root).onclick = async (e) => {
    const todo = cards.filter((c) => !c.hidden && ownerOk(c) && !c.paid && (c.planned === null || c.planned === undefined || c.planned === '') && ((c.statement_due ?? c.owed) > 0));
    if (!todo.length) { F.toast('Every card already has a planned amount'); return; }
    const ok = await F.confirm(`Plan ${todo.length} card${todo.length === 1 ? '' : 's'}?`, `Each unplanned ${owner === 'all' ? '' : short(owner) + ' '}card gets its statement balance, or the full balance when there’s no statement. Cards you already planned are left alone.`, 'Plan them', { danger: false });
    if (!ok) return;
    e.currentTarget.disabled = true;
    try {
      for (const c of todo) { const v = +(c.statement_due ?? c.owed); c.planned = v; await F.post('/api/plan', { month, card_key: c.card_key, amount: v }); }
      F.toast(`Planned ${todo.length} card${todo.length === 1 ? '' : 's'}`, { action: 'Undo', onAction: async () => { for (const c of todo) { c.planned = null; await F.post('/api/plan', { month, card_key: c.card_key, amount: null }); } draw(); drawTotals(); } });
    } finally { draw(); drawTotals(); const b = $('[data-fill-all]', root); if (b) b.disabled = false; }
  };
};
