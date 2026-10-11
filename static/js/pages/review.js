/* Spending → Review: payees waiting for a tag (money sent to people, rows still in Other / Uncategorized, rental-business
   rows with no property), grouped by payee with the account each came from. Tagging a payee can teach a rule
   ("always"), which re-tags every matching row at once and is used by the laptop's categorize run from then on.
   Also: the split editor used by the transaction drawer. */
'use strict';
(() => {
  const { html, raw, fmt, icon, $, $$ } = F;

  // Spending / Review tab strip (the review count is the inbox size).
  F.spendTabs = (view, n) => html`<div class="tabs" role="tablist" aria-label="Spending views">
    <a href="#/spending" role="tab" aria-selected="${String(view !== 'review')}">Analysis</a>
    <a href="#/spending?view=review" role="tab" aria-selected="${String(view === 'review')}">Review ${n ? html`<span class="badge ${view === 'review' ? '' : 'alert'}" data-review-badge>${fmt.num(n)}</span>` : ''}</a></div>`;

  const KIND = { people: 'Paid to people', property: 'Rental, no property', other: 'Needs a category' };
  const KIND_HINT = { people: 'Zelle, Venmo, checks and wires still filed as Other.', property: 'Rental-business money that isn’t tied to a property yet.', other: 'Card and bank rows no rule recognized.' };

  F.reviewView = async (root, r, ctl) => {
    const p = Object.assign({ kind: '' }, r.params);
    const d = await F.get('/api/review', { kind: p.kind || undefined });
    if (!ctl.alive()) return;
    const all = await F.get('/api/review', { summary: 1 });
    const counts = all.counts;
    const skipped = new Set();
    const tax = d.taxonomy;
    const cats = Object.keys(tax).sort();
    const ENT = ['household', ...d.properties, 'primary home', 'rental business'].filter((x, i, a) => a.indexOf(x) === i);
    const setP = (patch) => F.go('#/spending?' + new URLSearchParams(Object.entries({ view: 'review', ...p, ...patch }).filter(([, v]) => v)).toString());
    let groups = d.groups.slice();
    let open = groups.length ? groups[0].key : null;

    const money = (v) => fmt.amt(v, { cents: Math.abs(v) < 1000 });
    const range = (g) => (g.first === g.last ? fmt.date(g.first, { year: true }) : `${fmt.date(g.first, { year: true })} – ${fmt.date(g.last, { year: true })}`);
    const sumLine = () => {
      const left = groups.filter((g) => !skipped.has(g.key));
      const n = left.reduce((s, g) => s + g.n, 0), t = left.reduce((s, g) => s + g.total, 0);
      return n ? html`<b>${fmt.num(n)}</b> transaction${n === 1 ? '' : 's'} from <b>${fmt.num(left.length)}</b> payee${left.length === 1 ? '' : 's'} · ${fmt.money(Math.abs(t), { cents: false })}` : 'Nothing left to review here';
    };

    const editor = (g) => {
      const s = g.rule || g.suggestion || {};
      const cat = s.category && s.category !== 'Other' ? s.category : '';
      const subs = tax[cat] || [];
      const ent = s.entity && s.entity !== 'household' && s.entity !== 'rental business' ? s.entity : '';
      const per = g.rule ? g.rule.person || '' : (s.person || '');
      const id = 'rv-' + Math.abs([...g.key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));
      return html`<form class="rv-form" data-form autocomplete="off">
        ${g.suggestion && !g.rule ? html`<p class="small ink2 rv-hint">${icon('info')}Elsewhere tagged <b>${g.suggestion.category}${g.suggestion.subcategory ? ' · ' + g.suggestion.subcategory : ''}</b>${g.suggestion.entity && g.suggestion.entity !== 'household' ? ' for ' + g.suggestion.entity : ''} (${g.suggestion.n}×). Filled in below.</p>` : ''}
        ${g.rule ? html`<p class="small ink2 rv-hint">${icon('rule')}A rule already files this payee as <b>${g.rule.category}${g.rule.subcategory ? ' · ' + g.rule.subcategory : ''}</b>${g.rule.created_by ? ' (set by ' + g.rule.created_by + ')' : ''}.</p>` : ''}
        <div class="form-grid">
          <div class="field"><label for="${id}-c">Category</label><select class="input" id="${id}-c" name="category">${html`<option value="">Choose…</option>${cats.map((c) => html`<option ${c === cat ? raw('selected') : ''}>${c}</option>`)}`}</select></div>
          <div class="field"><label for="${id}-s">Subcategory</label><input class="input" id="${id}-s" name="subcategory" list="${id}-sl" value="${s.subcategory && cat ? s.subcategory : ''}"><datalist id="${id}-sl">${subs.map((x) => html`<option value="${x}">`)}</datalist></div>
          <div class="field"><label for="${id}-e">Property / entity</label><select class="input" id="${id}-e" name="entity"><option value="">${g.needs_property ? 'Pick a property…' : 'Keep as is'}</option>${ENT.map((e) => html`<option ${e === ent ? raw('selected') : ''}>${e}</option>`)}</select></div>
          <div class="field"><label for="${id}-n">Note</label><input class="input" id="${id}-n" name="note" placeholder="e.g. Piano teacher" maxlength="300"></div>
          <fieldset class="field full rv-people"><legend class="label">Who it was for</legend><div class="chips" role="radiogroup" aria-label="Who it was for">
            ${[['', 'Not set'], ...d.people.map((x) => [x, x])].map(([v, l]) => html`<label class="chip rv-chip"><input type="radio" name="person" value="${v}" ${v === per ? raw('checked') : ''}>${l}</label>`)}</div></fieldset>
          <label class="check full rv-always ${g.can_rule ? '' : 'muted'}"><input type="checkbox" name="always" ${g.can_rule ? (g.n > 1 || g.rule ? raw('checked') : '') : raw('disabled')}>
            <span>${g.can_rule ? html`<b>${g.key}</b> is always this — save a rule and apply it to every matching transaction` : html`Each ${g.key.toLowerCase()} is different, so this tags only the ones checked below`}</span></label>
        </div>
        <details class="rv-rows" ${g.n <= 3 ? raw('open') : ''}><summary>${g.n === 1 ? 'The transaction' : `All ${fmt.num(g.n)} transactions`} <span class="small muted">· uncheck any that are something else</span></summary>
          <div class="rv-list">${g.rows.map((t) => html`<label class="rv-row"><input type="checkbox" name="txn" value="${t.txn_id}" checked>
            <span class="d">${fmt.date(t.posted_date, { year: true })}</span><span class="t"><span class="ellipsis">${t.account}</span><span class="m ellipsis">${t.description}</span></span>
            <span class="a">${F.amtCell(t.amount)}</span></label>`)}</div>
          ${g.rows.length < g.n ? html`<p class="caption">Showing the latest ${g.rows.length}; “always” covers the rest too.</p>` : ''}</details>
        <div class="row wrap rv-actions">
          <button type="submit" class="btn primary">${icon('check')}Save</button>
          ${g.needs_property ? html`<button type="button" class="btn" data-noprop>Not property-specific</button>` : ''}
          <button type="button" class="btn ghost" data-skip>Skip for now</button>
          <a class="btn ghost sm" style="margin-left:auto" href="#/spending?merchant=${encodeURIComponent(g.key)}&preset=all&kind=all">History</a>
        </div></form>`;
    };

    const card = (g) => html`<section class="rv-card ${open === g.key ? 'open' : ''}" data-key="${g.key}">
      <button type="button" class="rv-head" data-toggle aria-expanded="${String(open === g.key)}">
        <span class="rv-main"><span class="rv-name">${g.key}</span>
          <span class="rv-meta">${fmt.num(g.n)} × · ${range(g)}${g.recurring ? html` · <b>${fmt.money(Math.abs(g.recurring.amount))}</b> ×${g.recurring.n}` : ''}</span>
          <span class="rv-meta rv-acct">${g.accounts.map((a, i) => html`${i ? ' · ' : ''}${a.name}${g.accounts.length > 1 ? ` ×${a.n}` : ''}`)}</span></span>
        <span class="rv-side"><span class="rv-amt">${money(g.total)}</span><span class="pill ${g.kind === 'property' ? 'warn' : 'neutral'}">${g.kind === 'people' && g.needs_property ? 'Rental · ' : ''}${KIND[g.kind]}</span></span>
      </button>
      <div class="rv-body">${open === g.key ? editor(g) : ''}</div></section>`;

    const draw = () => {
      const shown = groups.filter((g) => !skipped.has(g.key));
      F.setHTML(root, html`
        ${F.head({ title: 'Spending', lede: 'Tag what the bank couldn’t: who a Zelle went to, what a check paid for, which property a rental expense belongs to. Tick “always” and the app remembers the payee.' })}
        ${F.spendTabs('review', counts.rows)}
        <div class="filters rv-filters">
          <div class="seg" role="group" aria-label="What to review">${[['', 'All', counts.rows], ['people', KIND.people, counts.people], ['property', KIND.property, counts.property], ['other', KIND.other, counts.other]].map(([k, l, n]) => html`<button type="button" data-kind="${k}" aria-pressed="${String((p.kind || '') === k)}">${l} <span class="badge">${fmt.num(n)}</span></button>`)}</div>
        </div>
        <p class="small ink2 rv-sum" aria-live="polite">${sumLine()}${p.kind ? html` · ${KIND_HINT[p.kind]}` : ''}</p>
        <div class="rv-cards">${shown.length ? shown.map(card) : F.empty(groups.length ? 'You skipped the rest' : 'All caught up', groups.length ? 'They’ll be back next time you open Review.' : 'New Zelle payments, checks and untagged rows land here after the next sync.', groups.length ? html`<button type="button" class="btn sm" data-unskip>Show skipped</button>` : '')}</div>`);
      bind();
    };

    const advance = (key) => {
      const shown = groups.filter((g) => !skipped.has(g.key));
      const i = shown.findIndex((g) => g.key === key);
      const next = shown[i + 1] || shown[i - 1];
      open = next ? next.key : null;
    };
    const refreshCount = async () => {
      try { const c = await F.get('/api/review', { summary: 1 }); Object.assign(counts, c.counts); } catch { /* keep the old numbers */ }
    };

    const bind = () => {
      $$('[data-kind]', root).forEach((b) => (b.onclick = () => setP({ kind: b.dataset.kind })));
      const us = $('[data-unskip]', root); if (us) us.onclick = () => { skipped.clear(); open = groups[0] ? groups[0].key : null; draw(); };
      $$('.rv-card', root).forEach((el) => {
        const g = groups.find((x) => x.key === el.dataset.key);
        $('[data-toggle]', el).onclick = () => { open = open === g.key ? null : g.key; draw(); const c = $(`.rv-card[data-key="${CSS.escape(g.key)}"]`, root); if (c && open) c.scrollIntoView({ block: 'nearest' }); };
        const form = $('[data-form]', el);
        if (!form) return;
        const catSel = $('[name=category]', form);
        catSel.onchange = () => F.setHTML($('datalist', form), html`${(tax[catSel.value] || []).map((x) => html`<option value="${x}">`)}`);
        const ids = () => $$('[name=txn]:checked', form).map((i) => i.value);
        const send = async (extra, btn) => {
          const chosen = ids();
          if (!chosen.length) { F.toast('Check at least one transaction', { kind: 'error' }); return; }
          const fd = new FormData(form);
          const always = !!$('[name=always]', form)?.checked && chosen.length === g.rows.length;
          const body = { key: g.key, txn_ids: chosen, category: fd.get('category'), subcategory: fd.get('subcategory').trim(), entity: fd.get('entity'),
            person: fd.get('person') || '', note: fd.get('note').trim(), always, ...extra };
          if (!body.category && !body.no_property) { catSel.focus(); F.toast('Pick a category first', { kind: 'error' }); return; }
          if (g.needs_property && !body.no_property && !body.entity) {
            if (!(await F.confirm('No property picked', 'Save without a property? It stays in Review until it has one, or until you mark it “Not property-specific”.', 'Save anyway', { danger: false }))) return;
          }
          btn.disabled = true;
          try {
            const res = await F.post('/api/review/tag', body);
            const more = res.rule_applied ? ` · rule updated ${fmt.num(res.rule_applied)} more` : res.rule_id ? ' · rule saved' : '';
            F.toast(`${g.key}: tagged ${fmt.num(res.updated)}${more}`);
            if (chosen.length === g.rows.length && g.rows.length === g.n) { advance(g.key); groups = groups.filter((x) => x.key !== g.key); }
            else { g.rows = g.rows.filter((t) => !chosen.includes(t.txn_id)); g.n -= chosen.length; g.total = g.rows.reduce((s, t) => s + t.amount, 0); if (!g.n) { advance(g.key); groups = groups.filter((x) => x.key !== g.key); } }
            await refreshCount();
            F.loadMeta(true);
            draw();
            const nx = open && $(`.rv-card[data-key="${CSS.escape(open)}"]`, root); if (nx) nx.scrollIntoView({ block: 'nearest' });
          } catch { btn.disabled = false; }
        };
        form.onsubmit = (e) => { e.preventDefault(); send({}, $('button[type=submit]', form)); };
        const np = $('[data-noprop]', form); if (np) np.onclick = () => send({ no_property: true }, np);
        $('[data-skip]', form).onclick = () => { advance(g.key); skipped.add(g.key); draw(); };
      });
    };
    draw();
  };

  /* ---------- split editor (transaction drawer) ---------- */
  /** Render the split section into el for transaction t (from /api/txn). onChange after a save/remove. */
  F.splitSection = async (el, t, { onChange } = {}) => {
    let d;
    try { d = await F.get('/api/splits', { txn_id: t.txn_id }); } catch { el.remove(); return; }
    const sign = t.amount < 0 ? -1 : 1;
    const label = (s) => [s.category, s.subcategory].filter(Boolean).join(' · ') || 'Not set';
    const who = (s) => [s.person, s.entity && s.entity !== 'household' && s.entity !== t.entity ? s.entity : ''].filter(Boolean).join(' · ');
    if (!d.splits.length) {
      F.setHTML(el, html`<h3>Split</h3><p class="small ink2">One charge, several things? Split it so each part counts in its own category or for its own person.</p>
        <button type="button" class="btn sm" data-split>${icon('list')}Split this ${t.amount < 0 ? 'charge' : 'deposit'}</button>`);
    } else {
      F.setHTML(el, html`<h3>Split <span class="small muted">${d.source === 'order' ? '· from the order’s items' : '· by hand'}</span></h3>
        <div class="list">${d.summary.map((s) => html`<div class="list-item"><span class="main-col"><span class="title"><i class="dot" style="background:${raw(F.catVar(s.category))}"></i> ${label(s)}</span>
          <span class="meta">${who(s) || (s.n > 1 ? `${s.n} items` : '')}${who(s) && s.n > 1 ? ` · ${s.n} items` : ''}</span></span><span class="amount">${F.amtCell(s.amount)}</span></div>`)}</div>
        <p class="caption">Spending and budgets count these lines instead of “${t.category || 'Uncategorized'}”. ${d.source === 'order' ? (d.splits.some((s) => s.note === 'estimated') ? `The order history has no item prices, so the charge is spread evenly over its ${d.splits.length} items (an estimate; adjust by hand if it matters).` : 'Tax, shipping and discounts are spread over the items so the lines add up to the charge.') : ''}</p>
        <div class="row wrap"><button type="button" class="btn sm" data-split>${icon('edit')}${d.source === 'order' ? 'Adjust by hand' : 'Edit split'}</button>
          ${d.source === 'manual' ? html`<button type="button" class="btn sm ghost" data-unsplit>Remove split</button>` : ''}</div>`);
    }
    const ub = $('[data-unsplit]', el);
    if (ub) ub.onclick = async () => {
      if (!(await F.confirm('Remove this split?', 'The whole amount goes back to one category. If the charge has an order, its item split comes back after the next sync.', 'Remove'))) return;
      await F.del('/api/splits', { txn_id: t.txn_id }); F.toast('Split removed'); onChange && onChange(); F.splitSection(el, t, { onChange });
    };
    $('[data-split]', el).onclick = () => F.splitModal(t, d, () => { onChange && onChange(); F.splitSection(el, t, { onChange }); });
    void sign;
  };

  F.splitModal = (t, d, onDone) => {
    const sign = t.amount < 0 ? -1 : 1;
    const total = Math.round(Math.abs(t.amount) * 100);
    const cats = Object.keys(F.categories()).filter((c) => c !== 'Uncategorized').sort();
    const people = F.people();
    let lines = (d.summary.length ? d.summary : [{ category: t.category, subcategory: t.subcategory, entity: t.entity, person: t.person, amount: t.amount }, { category: '', subcategory: '', amount: 0 }])
      .map((s) => ({ category: s.category || '', subcategory: s.subcategory || '', person: s.person || '', entity: s.entity || '', amount: Math.abs(s.amount) ? (Math.abs(s.amount)).toFixed(2) : '' }));
    if (!d.summary.length) { lines[0].amount = (total / 100).toFixed(2); }
    const rowHtml = (l, i) => html`<div class="split-line" data-i="${i}">
      <select class="input sm" data-f="category" aria-label="Category, line ${i + 1}"><option value="">Category…</option>${cats.map((c) => html`<option ${c === l.category ? raw('selected') : ''}>${c}</option>`)}</select>
      <input class="input sm" data-f="subcategory" value="${l.subcategory}" placeholder="Subcategory" aria-label="Subcategory, line ${i + 1}">
      <select class="input sm" data-f="person" aria-label="Who, line ${i + 1}"><option value="">Who…</option>${people.map((x) => html`<option ${x === l.person ? raw('selected') : ''}>${x}</option>`)}</select>
      <span class="money-wrap"><input class="input sm" data-f="amount" inputmode="decimal" value="${l.amount}" aria-label="Amount, line ${i + 1}"></span>
      <button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove line ${i + 1}">${icon('x')}</button></div>`;
    const m = F.modal({
      title: `Split ${fmt.money(Math.abs(t.amount))}`, sub: `${t.merchant_name} · ${fmt.date(t.posted_date, { year: true })}. Lines must add up to the ${t.amount < 0 ? 'charge' : 'amount'} exactly.`,
      wide: true, submit: 'Save split',
      body: html`<div id="split-lines"></div><div class="row wrap" style="margin-top:10px"><button type="button" class="btn sm" data-add>${icon('plus')}Add a line</button>
        <span class="small" id="split-left" style="margin-left:auto" aria-live="polite"></span></div>`,
      onSubmit: async () => {
        sync();
        const out = lines.filter((l) => F.parseAmt(l.amount));
        if (out.length < 2) { F.toast('A split needs at least two lines with amounts', { kind: 'error' }); return false; }
        if (out.some((l) => !l.category)) { F.toast('Every line needs a category', { kind: 'error' }); return false; }
        const left = total - out.reduce((s, l) => s + Math.round(F.parseAmt(l.amount) * 100), 0);
        if (left !== 0) { F.toast(`The lines are ${fmt.money(Math.abs(left) / 100)} ${left > 0 ? 'short of' : 'over'} the total`, { kind: 'error' }); return false; }
        await F.post('/api/splits', { txn_id: t.txn_id, lines: out.map((l) => ({ category: l.category, subcategory: l.subcategory.trim(), person: l.person, entity: l.entity || null, amount: sign * F.parseAmt(l.amount) })) });
        F.toast('Split saved'); onDone && onDone();
      },
    });
    const host = $('#split-lines', m.el);
    const sync = () => $$('.split-line', host).forEach((r) => { const l = lines[+r.dataset.i]; $$('[data-f]', r).forEach((i) => { l[i.dataset.f] = i.value; }); });
    const left = () => {
      sync();
      const rem = total - lines.reduce((s, l) => s + Math.round((F.parseAmt(l.amount) || 0) * 100), 0);
      F.setHTML($('#split-left', m.el), rem === 0 ? html`<span class="pos">${icon('check')}Adds up</span>` : html`<b class="${rem < 0 ? 'neg' : ''}">${fmt.money(Math.abs(rem) / 100)}</b> ${rem > 0 ? 'left to assign' : 'over'}`);
      return rem;
    };
    const draw = () => {
      F.setHTML(host, html`${lines.map(rowHtml)}`);
      $$('[data-f]', host).forEach((i) => i.addEventListener('input', left));
      $$('[data-f]', host).forEach((i) => i.addEventListener('change', left));
      $$('[data-rm]', host).forEach((b) => (b.onclick = () => { sync(); if (lines.length > 1) lines.splice(+b.dataset.rm, 1); draw(); }));
      left();
    };
    $('[data-add]', m.el).onclick = () => { const rem = left(); lines.push({ category: '', subcategory: '', person: '', entity: '', amount: rem > 0 ? (rem / 100).toFixed(2) : '' }); draw(); };
    draw();
  };
})();
