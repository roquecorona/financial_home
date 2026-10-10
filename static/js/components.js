/* Shared components: date presets, transaction table, transaction drawer, notes, rules, popovers. */
'use strict';
(function () {
  const { html, raw, esc, $, $$, fmt, icon, setHTML } = F;

  /* ---------- page furniture ---------- */
  /** Today as 10.10.2026 (the page-head stamp). */
  F.stamp = (iso = F.todayISO()) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${m}.${d}.${y}`; };
  /** Page head: big Space Grotesk title over a 2px ink rule, stamp or actions on the right. */
  F.head = ({ title, crumb = '', lede = '', stamp = '', actions = '', compactSm = false }) => html`<div class="page-head ${compactSm ? 'compact-sm' : ''}"><div>
      ${crumb ? html`<div class="crumb">${crumb}</div>` : ''}<h1>${title}</h1>${lede ? html`<p class="lede">${lede}</p>` : ''}</div>
    ${stamp || actions ? html`<div class="actions">${stamp ? html`<span class="stamp">${stamp}</span>` : ''}${actions}</div>` : ''}</div>`;
  /** One KPI cell for a .band: uppercase label, big figure, grey sub line. */
  F.kpi = (label, value, sub = '', o = {}) => {
    const tag = o.href ? 'a' : 'div';
    return html`${raw(`<${tag} class="kpi ${o.cls || ''}"${o.href ? ` href="${esc(o.href)}"` : ''}${o.id ? ` id="${esc(o.id)}"` : ''}>`)}<div class="k-label">${label}</div><div class="k-value ${o.vcls || ''}">${value}</div>${sub ? html`<div class="k-sub">${sub}</div>` : ''}${raw(`</${tag}>`)}`;
  };
  /** Section head: label over an ink rule. */
  F.secHead = (title, { sub = '', tools = '', id = '' } = {}) => html`<div class="panel-head"><h2 ${id ? raw(`id="${esc(id)}"`) : ''}>${title}</h2>${sub ? html`<span class="sub">${sub}</span>` : ''}${tools ? html`<div class="tools">${tools}</div>` : ''}</div>`;
  /** Parse a typed amount ("$1,234.50", "1234.5") → number, '' → null, junk → NaN. */
  F.parseAmt = (v) => { const s = String(v ?? '').replace(/[$,\s]/g, '').replace(/^\u2212/, '-'); return s === '' ? null : Number(s); };

  /* ---------- date presets ---------- */
  F.PRESETS = [['this_month', 'This month'], ['last_month', 'Last month'], ['3m', '3 months'], ['6m', '6 months'], ['12m', '12 months'],
    ['ytd', 'Year to date'], ['last_year', 'Last year'], ['all', 'All time'], ['custom', 'Custom']];
  F.presetRange = (p, custom = {}) => {
    const t = F.todayISO(), m = t.slice(0, 7), y = +t.slice(0, 4);
    const monthStart = (mm) => mm + '-01';
    const monthEnd = (mm) => { const [yy, mo] = mm.split('-').map(Number); return new Date(Date.UTC(yy, mo, 0)).toISOString().slice(0, 10); };
    switch (p) {
      case 'this_month': return { start: monthStart(m), end: t };
      case 'last_month': { const lm = F.addMonths(m, -1); return { start: monthStart(lm), end: monthEnd(lm) }; }
      case '3m': return { start: monthStart(F.addMonths(m, -2)), end: t };
      case '6m': return { start: monthStart(F.addMonths(m, -5)), end: t };
      case '12m': return { start: monthStart(F.addMonths(m, -11)), end: t };
      case 'ytd': return { start: `${y}-01-01`, end: t };
      case 'last_year': return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
      case 'custom': return { start: custom.start || monthStart(m), end: custom.end || t };
      default: return { start: '', end: '' };
    }
  };
  F.presetSelect = (sel, id = '') => html`<select class="input sm" ${id ? raw(`id="${id}"`) : ''} aria-label="Date range">${F.PRESETS.map(([k, l]) => html`<option value="${k}" ${k === sel ? raw('selected') : ''}>${l}</option>`)}</select>`;
  F.presetSeg = (sel, keys) => html`<div class="seg" role="group" aria-label="Date range">${F.PRESETS.filter(([k]) => !keys || keys.includes(k)).map(([k, l]) => html`<button type="button" data-preset="${k}" aria-pressed="${String(k === sel)}">${l}</button>`)}</div>`;
  F.monthNav = (m, months) => html`<div class="row"><button class="icon-btn" data-month="${F.addMonths(m, -1)}" aria-label="Previous month">${icon('chevL')}</button>
    <select class="input sm" data-month-select style="width:auto" aria-label="Month">${[...new Set([...(months || []), m])].sort().reverse().map((x) => html`<option value="${x}" ${x === m ? raw('selected') : ''}>${fmt.month(x)}</option>`)}</select>
    <button class="icon-btn" data-month="${F.addMonths(m, 1)}" aria-label="Next month">${icon('chevR')}</button></div>`;
  F.bindMonthNav = (root, onPick) => {
    $$('[data-month]', root).forEach((b) => (b.onclick = () => onPick(b.dataset.month)));
    const s = $('[data-month-select]', root); if (s) s.onchange = () => onPick(s.value);
  };

  /* ---------- category chip + popover editor ---------- */
  F.catChip = (t) => {
    const none = !t.category || t.category === 'Uncategorized';
    return html`<button type="button" class="cat ${none ? 'none' : ''}" data-cat="${t.txn_id}" title="Change category">${none ? '' : html`<i class="dot" style="background:${raw(F.catVar(t.category))}"></i>`}<span class="ellipsis">${none ? 'Needs a category' : t.category + (t.subcategory ? ' · ' + t.subcategory : '')}</span></button>`;
  };
  let pop = null;
  F.closePop = () => { if (pop) { pop.remove(); pop = null; } };
  document.addEventListener('mousedown', (e) => { if (pop && !pop.contains(e.target) && !e.target.closest('[data-cat]')) F.closePop(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop) { F.closePop(); } });
  F.catPopover = (anchor, t, onSaved) => {
    F.closePop();
    const cats = F.categories();
    pop = document.createElement('div');
    pop.className = 'popover'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Change category');
    const subs = cats[t.category] ? [...cats[t.category]] : [];
    setHTML(pop, html`<form class="stack" style="gap:10px">
      <div class="small muted ellipsis">${t.merchant_name || t.description}</div>
      <div class="field"><label>Category</label><select class="input sm" name="category">${F.catOptions(t.category === 'Uncategorized' ? '' : t.category)}<option value="__new">New category…</option></select></div>
      <div class="field"><label>Subcategory</label><input class="input sm" name="subcategory" list="pop-subs" value="${t.subcategory || ''}" autocomplete="off">${F.datalist('pop-subs', subs)}</div>
      <label class="check small"><input type="checkbox" name="rule"> Always use this for ${t.merchant_name || 'this merchant'}</label>
      <div class="row"><button type="submit" class="btn primary sm">Save</button><button type="button" class="btn ghost sm" data-x>Cancel</button></div></form>`);
    document.body.append(pop);
    const r = anchor.getBoundingClientRect();
    const left = Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - Math.min(316, document.documentElement.clientWidth - 16) - 8);
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = (window.scrollY + r.bottom + 6) + 'px';
    const form = $('form', pop);
    const catSel = $('[name=category]', form);
    catSel.focus();
    catSel.onchange = () => {
      if (catSel.value === '__new') {
        const name = prompt('Name for the new category');
        if (name) { catSel.insertAdjacentHTML('afterbegin', `<option>${esc(name)}</option>`); catSel.value = name; } else catSel.value = t.category || '';
      }
      const s = cats[catSel.value] ? [...cats[catSel.value]] : [];
      setHTML($('#pop-subs', pop), html`${s.sort().map((x) => html`<option value="${x}">`)}`);
    };
    $('[data-x]', form).onclick = F.closePop;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const category = catSel.value, subcategory = $('[name=subcategory]', form).value.trim();
      if (!category) { catSel.focus(); return; }
      await F.post('/api/txn', { txn_id: t.txn_id, category, subcategory });
      if ($('[name=rule]', form).checked) {
        await F.post('/api/rule', { pattern: t.merchant_name, field: 'merchant', category, subcategory, priority: 50, apply: true });
        F.toast(`Saved. ${t.merchant_name} will be ${category} from now on.`);
      } else F.toast('Category saved');
      F.closePop();
      F.loadMeta(true);
      onSaved && onSaved({ category, subcategory });
    };
  };

  /* ---------- transaction table ---------- */
  /**
   * F.txnTable(el, { base, state, title, selectable, onState, compact, pageSize, showAccount })
   * base: fixed filters (e.g. {account}); state: user filters (q, preset, start, end, category, kind, sort, dir)
   */
  F.txnTable = (el, opts = {}) => {
    const st = Object.assign({ preset: '3m', kind: 'banking', sort: 'date', dir: 'desc', q: '' }, opts.state || {});
    const base = opts.base || {};
    const pageSize = opts.pageSize || 100;
    let rows = [], total = 0, agg = {}, selected = new Set(), loading = false, selecting = false, failed = false;
    const params = (offset) => {
      const rng = st.preset === 'all' ? {} : F.presetRange(st.preset, st);
      return { ...base, q: st.q, start: rng.start, end: rng.end, category: st.category, subcategory: st.subcategory, merchant: st.merchant, kind: st.kind === 'all' ? '' : st.kind,
        sort: st.sort, dir: st.dir, limit: pageSize, offset, entity: st.entity || base.entity, holder: st.holder || base.holder, linked: st.linked, retailer: st.retailer };
    };
    const load = async (append = false) => {
      if (loading) return; loading = true;
      try {
        const d = await F.get('/api/transactions', params(append ? rows.length : 0));
        rows = append ? rows.concat(d.transactions) : d.transactions;
        total = d.total; agg = d; failed = false;
        if (!append) selected.clear();
      } catch (e) { failed = e.message || 'Unexpected error'; }
      finally { loading = false; }
      draw();
      opts.onState && opts.onState({ ...st });
    };
    const kindSel = html`<select class="input sm" data-k="kind" aria-label="Type">
      ${[['banking', 'All banking'], ['spending', 'Spending only'], ['income', 'Income only'], ['transfers', 'Transfers & payments'], ['all', 'Everything incl. investments']].map(([k, l]) => html`<option value="${k}" ${k === st.kind ? raw('selected') : ''}>${l}</option>`)}</select>`;
    const catSel = () => html`<select class="input sm" data-k="category" aria-label="Category"><option value="">All categories</option><option value="__none__" ${st.category === '__none__' ? raw('selected') : ''}>Needs a category</option>
      ${Object.keys(F.categories()).sort().map((c) => html`<option ${c === st.category ? raw('selected') : ''}>${c}</option>`)}</select>`;
    const chips = () => {
      const c = [];
      if (st.merchant) c.push(['merchant', `Merchant: ${st.merchant}`]);
      if (st.subcategory) c.push(['subcategory', `Subcategory: ${st.subcategory === '__none__' ? 'none' : st.subcategory}`]);
      if (st.entity) c.push(['entity', `Entity: ${st.entity}`]);
      if (st.holder) c.push(['holder', `Card holder: ${st.holder}`]);
      if (st.linked) c.push(['linked', st.linked === '1' ? 'Linked to an order' : 'No order linked']);
      if (st.retailer) c.push(['retailer', fmt.label(st.retailer)]);
      return c.length ? html`<div class="chips" style="padding:0 0 12px">${c.map(([k, l]) => html`<button type="button" class="chip" data-clear="${k}" aria-pressed="true" aria-label="Remove filter ${l}">${l} <span class="x" aria-hidden="true">✕</span></button>`)}</div>` : '';
    };
    const sortBtn = (k, label) => html`<button type="button" class="sort" data-sort="${k}" ${st.sort === k ? raw(`data-active data-dir="${st.dir === 'asc' ? '↑' : '↓'}" aria-sort="${st.dir === 'asc' ? 'ascending' : 'descending'}"`) : ''}>${label}</button>`;
    const draw = () => {
      const sel = opts.selectable !== false;
      const cls = sel ? '' : 'no-check';
      setHTML(el, html`
        ${opts.title ? F.secHead(opts.title, { sub: `${fmt.num(total)} transaction${total === 1 ? '' : 's'}`, tools: html`${opts.tools || ''}${sel ? html`<button type="button" class="btn sm ghost show-sm" data-selmode aria-pressed="${String(selecting)}">${selecting ? 'Done' : 'Select'}</button>` : ''}` }) : ''}
        <div class="toolbar">
          <input class="input sm search-in" type="search" data-k="q" placeholder="Search description, note, amount" value="${st.q || ''}" aria-label="Search transactions" enterkeyhint="search">
          ${opts.noPreset ? '' : F.presetSelect(st.preset)}
          ${st.preset === 'custom' ? html`<input type="date" class="input sm" data-k="start" value="${st.start || ''}" aria-label="From"><input type="date" class="input sm" data-k="end" value="${st.end || ''}" aria-label="To">` : ''}
          ${catSel()} ${opts.noKind ? '' : kindSel}
        </div>
        ${chips()}
        <div class="summary-line" aria-live="polite"><span><b>${fmt.num(total)}</b> shown</span><span>Out <b>${fmt.amt(-(agg.out || 0) || 0)}</b></span><span>In <b>${fmt.amt(agg.into || 0)}</b></span><span>Net <b>${fmt.amt(agg.net || 0, { sign: true })}</b></span></div>
        <div class="txn-list ${selected.size || selecting ? 'selecting' : ''}" role="table" aria-label="Transactions" aria-rowcount="${total}">
          <div class="txn-head ${cls}" role="row">${sel ? html`<span class="ck" role="columnheader"><input type="checkbox" data-all aria-label="Select all shown" ${rows.length && selected.size === rows.length ? raw('checked') : ''}></span>` : ''}
            <span role="columnheader">${sortBtn('date', 'Date')}</span><span role="columnheader">${sortBtn('description', 'Description')}</span><span role="columnheader">${sortBtn('category', 'Category')}</span><span class="right" role="columnheader">${sortBtn('amount', 'Amount')}</span></div>
          ${failed ? F.empty('Transactions couldn’t load', failed, html`<button type="button" class="btn sm" data-retry>Try again</button>`, 'error')
          : rows.length ? rows.map((t) => html`<div class="txn-row ${cls} ${selected.has(t.txn_id) ? 'selected' : ''}" role="row" data-id="${t.txn_id}" tabindex="0" aria-label="${t.merchant_name}, ${fmt.money(t.amount)}, ${t.posted_date ? fmt.date(t.posted_date, { long: true }) : 'pending'}">
            ${sel ? html`<span class="ck"><input type="checkbox" data-sel="${t.txn_id}" aria-label="Select ${t.merchant_name}" ${selected.has(t.txn_id) ? raw('checked') : ''}></span>` : ''}
            <span class="d">${t.posted_date ? fmt.date(t.posted_date) : html`<span class="pill neutral">Pending</span>`}</span>
            <span class="desc"><span class="m"><span class="ellipsis">${t.merchant_name}</span>${t.note_count || t.notes ? html`<span class="flags" title="Has notes">${icon('note')}<span class="sr-only">Has notes</span></span>` : ''}${t.order_count ? html`<span class="flags" title="Linked to an order">${icon('bag')}<span class="sr-only">Linked to an order</span></span>` : ''}${t.source === 'manual' ? html`<span class="pill neutral">Manual</span>` : ''}</span>
              <span class="s">${opts.showAccount === false ? t.description : `${t.account}${t.holder ? ' · ' + t.holder : ''}`}</span></span>
            <span class="catc">${t.is_transfer ? html`<span class="cat" data-cat="${t.txn_id}"><span class="ellipsis">${t.category || 'Transfer'}${t.subcategory ? ' · ' + t.subcategory : ''}</span></span>` : F.catChip(t)}</span>
            <span class="amt ${t.amount > 0 ? 'in' : ''}">${fmt.amt(t.amount, { sign: t.amount > 0 })}</span></div>`)
          : F.empty(loading ? 'Loading…' : 'No transactions match', loading ? '' : 'Try a wider date range or clear a filter.')}
        </div>
        ${rows.length < total ? html`<div class="panel-foot"><button type="button" class="btn sm" data-more>Load ${Math.min(pageSize, total - rows.length)} more</button><span class="small muted">${fmt.num(rows.length)} of ${fmt.num(total)}</span></div>` : ''}
        ${selected.size ? html`<div class="bulkbar" role="region" aria-label="Bulk edit"><b>${selected.size} selected</b>
          <select class="input sm" data-bulk-cat aria-label="New category">${F.catOptions('', { blank: 'Move to category…' })}</select>
          <input class="input sm" data-bulk-sub placeholder="Subcategory (optional)" aria-label="Subcategory" list="bulk-subs" style="width:170px">${F.datalist('bulk-subs', new Set(Object.values(F.categories()).flatMap((x) => [...x])))}
          <select class="input sm" data-bulk-ent aria-label="Entity" style="width:160px"><option value="">Keep entity</option>${F.entityOptions('', '__')}</select>
          <button type="button" class="btn sm primary" data-bulk-apply>Apply</button><button type="button" class="btn sm ghost" data-bulk-clear>Clear</button></div>` : ''}
      `);
      bind();
    };
    const reload = F.debounce(() => load(false), 250);
    const bind = () => {
      $$('[data-k]', el).forEach((i) => {
        const k = i.dataset.k;
        i.addEventListener(i.tagName === 'INPUT' && i.type === 'search' ? 'input' : 'change', () => {
          st[k] = i.value;
          if (k === 'q') reload(); else load(false);
        });
      });
      const ps = $('select[aria-label="Date range"]', el);
      if (ps) ps.onchange = () => { st.preset = ps.value; if (ps.value === 'custom') { const r = F.presetRange('3m'); st.start = st.start || r.start; st.end = st.end || r.end; } load(false); };
      $$('[data-clear]', el).forEach((b) => (b.onclick = () => { st[b.dataset.clear] = ''; load(false); }));
      $$('[data-sort]', el).forEach((b) => (b.onclick = () => { if (st.sort === b.dataset.sort) st.dir = st.dir === 'asc' ? 'desc' : 'asc'; else { st.sort = b.dataset.sort; st.dir = b.dataset.sort === 'description' || b.dataset.sort === 'category' ? 'asc' : 'desc'; } load(false); }));
      const more = $('[data-more]', el); if (more) more.onclick = () => load(true);
      const retry = $('[data-retry]', el); if (retry) retry.onclick = () => load(false);
      const sm = $('[data-selmode]', el); if (sm) sm.onclick = () => { selecting = !selecting; if (!selecting) selected.clear(); draw(); };
      $$('.txn-row', el).forEach((r) => {
        r.onclick = (e) => {
          if (e.target.closest('[data-sel]') || e.target.closest('.ck')) return;
          if (selecting && window.matchMedia('(max-width: 760px)').matches) { const id = r.dataset.id; selected.has(id) ? selected.delete(id) : selected.add(id); draw(); return; }
          const c = e.target.closest('[data-cat]');
          const t = rows.find((x) => x.txn_id === r.dataset.id);
          if (c && c.tagName === 'BUTTON') { F.catPopover(c, t, (v) => { Object.assign(t, v); draw(); opts.onEdit && opts.onEdit(); }); return; }
          F.openTxn(r.dataset.id, { onChange: () => { load(false); opts.onEdit && opts.onEdit(); } });
        };
        r.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === r) { e.preventDefault(); r.click(); } };
      });
      $$('[data-sel]', el).forEach((c) => (c.onchange = () => { c.checked ? selected.add(c.dataset.sel) : selected.delete(c.dataset.sel); draw(); }));
      const all = $('[data-all]', el); if (all) all.onchange = () => { if (all.checked) rows.forEach((r) => selected.add(r.txn_id)); else selected.clear(); draw(); };
      const apply = $('[data-bulk-apply]', el);
      if (apply) {
        apply.onclick = async () => {
          const category = $('[data-bulk-cat]', el).value, subcategory = $('[data-bulk-sub]', el).value.trim(), entity = $('[data-bulk-ent]', el).value;
          const body = { ids: [...selected] };
          if (category) { body.category = category; body.subcategory = subcategory; }
          if (entity) body.entity = entity;
          if (!category && !entity) { F.toast('Pick a category or an entity first'); return; }
          apply.disabled = true;
          try {
            const r = await F.post('/api/txn/bulk', body);
            F.toast(`Updated ${r.updated} transaction${r.updated === 1 ? '' : 's'}`);
            selecting = false; F.loadMeta(true); load(false); opts.onEdit && opts.onEdit();
          } catch { apply.disabled = false; }
        };
        $('[data-bulk-clear]', el).onclick = () => { selected.clear(); selecting = false; draw(); };
      }
    };
    loading = true; draw(); loading = false;
    load(false);
    return { reload: () => load(false), set: (patch) => { Object.assign(st, patch); load(false); }, state: st };
  };

  /* ---------- notes ---------- */
  F.notesBlock = (el, targetType, targetId, notes, { onChange, placeholder = 'Add a note…', compact = false } = {}) => {
    const draw = (list) => {
      setHTML(el, html`<div class="note-compose">
          <textarea class="input" rows="${compact ? 2 : 3}" placeholder="${placeholder}" aria-label="New note"></textarea>
          <div class="row"><button type="button" class="btn sm primary" data-note-add>Add note</button><label class="check small"><input type="checkbox" data-pin> Pin to Home</label>
          <span class="small muted" style="margin-left:auto">${F.state.user ? `Signed ${F.state.user}` : 'Unsigned'}</span></div></div>
        <div class="notes-list">${list.map((n) => html`<div class="note ${n.pinned ? 'pinned' : ''}" data-id="${n.id}">${F.avatar(n.author) || html`<span class="avatar">?</span>`}
          <div style="flex:1;min-width:0"><div class="body">${n.body}</div>
          <div class="meta"><span>${n.author || 'Unsigned'} · ${fmt.ago(n.created_at)}${n.updated_at ? ' · edited' : ''}</span>${n.pinned ? html`<span class="pill info">${icon('pin')}Pinned</span>` : ''}
          <button type="button" data-pin-toggle>${n.pinned ? 'Unpin' : 'Pin'}</button><button type="button" data-edit>Edit</button><button type="button" data-del>Delete</button></div></div></div>`)}</div>`);
      $('[data-note-add]', el).onclick = async () => {
        const ta = $('textarea', el); const body = ta.value.trim();
        if (!body) { ta.focus(); return; }
        await F.post('/api/note', { target_type: targetType, target_id: targetId, body, pinned: $('[data-pin]', el).checked });
        F.toast('Note added');
        refresh();
      };
      $$('.note', el).forEach((nEl) => {
        const id = +nEl.dataset.id; const n = list.find((x) => x.id === id);
        $('[data-del]', nEl).onclick = async () => { if (await F.confirm('Delete this note?', n.body.slice(0, 120))) { await F.del('/api/note', { id }); refresh(); } };
        $('[data-pin-toggle]', nEl).onclick = async () => { await F.post('/api/note', { id, target_type: targetType, target_id: targetId, pinned: !n.pinned }); refresh(); };
        $('[data-edit]', nEl).onclick = () => F.modal({ title: 'Edit note', body: html`<textarea class="input" name="body" rows="5">${n.body}</textarea>`,
          onSubmit: async (d) => { await F.post('/api/note', { id, target_type: targetType, target_id: targetId, body: d.body }); refresh(); } });
      });
    };
    const refresh = async () => { const d = await F.get('/api/notes', { target_type: targetType, target_id: targetId }); draw(d.notes); onChange && onChange(d.notes); };
    draw(notes || []);
    return { refresh };
  };

  /* ---------- rule modal ---------- */
  F.ruleModal = (rule = {}, onDone) => {
    const cats = F.categories();
    F.modal({
      title: rule.rule_id ? 'Edit rule' : 'New category rule',
      sub: 'Rules run before the built-in ones and never touch rows you edited by hand.',
      body: html`<div class="form-grid">
        <div class="field full"><label>When the</label><div class="row"><select class="input" name="field" style="width:150px">${['description', 'merchant', 'memo', 'account'].map((f) => html`<option ${f === (rule.field || 'description') ? raw('selected') : ''}>${f}</option>`)}</select>
          <span class="muted nowrap">contains</span><input class="input" name="pattern" value="${rule.pattern || ''}" required placeholder="e.g. publix"></div>
          <span class="hint">Plain text matches anywhere, ignoring case. Start with <code>re:</code> for a regular expression.</span></div>
        <div class="field"><label>Category</label><select class="input" name="category" required>${F.catOptions(rule.category)}</select></div>
        <div class="field"><label>Subcategory</label><input class="input" name="subcategory" list="rule-subs" value="${rule.subcategory || ''}">${F.datalist('rule-subs', new Set(Object.values(cats).flatMap((s) => [...s])))}</div>
        <div class="field"><label>Entity</label><select class="input" name="entity"><option value="">Keep the account’s entity</option>${F.entityOptions(rule.entity || '', '__')}</select></div>
        <div class="field"><label>Priority</label><input class="input" name="priority" type="number" value="${rule.priority ?? 100}"><span class="hint">Lower runs first</span></div>
        <label class="check full"><input type="checkbox" name="apply" checked> Apply to existing transactions now</label></div>`,
      submit: rule.rule_id ? 'Save rule' : 'Create rule',
      danger: rule.rule_id ? { label: 'Delete', onClick: async () => { if (await F.confirm('Delete this rule?', rule.pattern)) { await F.del('/api/rule', { id: rule.rule_id }); onDone && onDone(); return true; } return false; } } : null,
      onSubmit: async (d) => {
        if (!d.pattern.trim() || !d.category) { F.toast('A pattern and a category are required', { kind: 'error' }); return false; }
        const r = await F.post('/api/rule', { ...d, rule_id: rule.rule_id, priority: +d.priority || 100 });
        F.toast(d.apply ? `Rule saved · ${r.changed || 0} transaction${r.changed === 1 ? '' : 's'} updated` : 'Rule saved');
        F.loadMeta(true); onDone && onDone();
      },
    });
  };

  /* ---------- transaction drawer ---------- */
  F.openTxn = (id, { onChange } = {}) => {
    F.drawer(async (el, close) => {
      setHTML(el, html`<div class="drawer-body"><div class="skel" style="height:60px"></div><div class="skel" style="height:200px"></div></div>`);
      let t;
      try { t = await F.get('/api/txn', { id }); } catch { close(); return; }
      const changed = () => { onChange && onChange(); };
      const cats = F.categories();
      const subs = cats[t.category] ? [...cats[t.category]] : [];
      const orderBlock = (o) => html`<div class="order-card">
        <div class="row" style="align-items:flex-start"><div style="flex:1;min-width:0"><b>${o.label}</b><div class="small muted">${fmt.date(o.order_date, { year: true })} · ${o.items.length} item${o.items.length === 1 ? '' : 's'} · total ${fmt.money(o.total)}${o.ordered_by ? ' · by ' + o.ordered_by : ''}</div></div>
          ${o.url ? html`<a class="btn sm" href="${o.url}" target="_blank" rel="noopener noreferrer">${icon('ext')}Open on ${fmt.label(o.retailer)}</a>` : ''}</div>
        <div class="list" style="margin-top:8px">${o.items.map((it) => html`<div class="row" style="padding:5px 0;border-top:1px solid var(--line-2);align-items:flex-start">
          <div style="flex:1;min-width:0">${it.product_url ? html`<a href="${it.product_url}" target="_blank" rel="noopener noreferrer">${it.title}</a>` : it.title}<div class="tiny muted">${it.quantity > 1 ? `${fmt.num(it.quantity)} × ` : ''}${fmt.money(it.unit_price)}${it.category ? ' · ' + it.category : ''}</div></div></div>`)}</div>
        <div class="row small" style="margin-top:8px"><span class="pill ${o.match === 'matched' ? 'good' : o.match === 'partial' ? 'warn' : 'neutral'}">${o.match === 'matched' ? 'Charges match the total' : o.match === 'partial' ? `Linked ${fmt.money(o.linked_total)} of ${fmt.money(o.total)}` : 'Not matched'}</span>
          <button class="btn xs ghost" data-unlink="${o.order_id}" style="margin-left:auto">Unlink</button></div></div>`;
      setHTML(el, html`
        <div class="drawer-head"><div style="flex:1;min-width:0">
          <div class="small muted">${t.account}${t.holder ? ' · ' + t.holder : ''}</div>
          <h2 style="margin-top:4px">${t.merchant_name}</h2>
          <div class="figure-md ${t.amount > 0 ? 'pos' : ''}" style="margin-top:8px" aria-label="${fmt.money(t.amount)}">${fmt.amt(t.amount, { sign: t.amount > 0 })}</div>
          <div class="row wrap small" style="margin-top:6px">${t.pending ? html`<span class="pill warn">${icon('clock')}Pending</span>` : html`<span class="muted">${fmt.date(t.posted_date, { long: true })}</span>`}
            ${t.is_transfer ? html`<span class="pill neutral">Transfer · not counted as spending</span>` : ''}${t.source === 'manual' ? html`<span class="pill info">Manual entry</span>` : ''}
            ${(t.tags || '').split(',').filter((x) => x === 'manual').length ? html`<span class="pill neutral">Edited${t.updated_by ? ' by ' + t.updated_by : ''}</span>` : ''}</div>
        </div><button class="icon-btn" data-x aria-label="Close">${icon('x')}</button></div>
        <div class="drawer-body">
          <section><form class="form-grid" id="txn-form">
            <div class="field"><label>Category</label><select class="input" name="category">${F.catOptions(t.category === 'Uncategorized' ? '' : t.category)}</select></div>
            <div class="field"><label>Subcategory</label><input class="input" name="subcategory" list="d-subs" value="${t.subcategory || ''}" autocomplete="off">${F.datalist('d-subs', subs)}</div>
            <div class="field"><label>Entity</label><select class="input" name="entity">${F.entityOptions(t.entity)}</select></div>
            <div class="field"><label>Person</label><select class="input" name="person"><option value="">—</option>${F.people().map((p) => html`<option ${p === t.person ? raw('selected') : ''}>${p}</option>`)}</select></div>
            <div class="field full"><label>Tags</label><input class="input" name="tags" value="${(t.tags || '').split(',').filter((x) => x && x !== 'manual').join(', ')}" placeholder="comma separated, e.g. tax, reimbursable"></div>
            <label class="check full"><input type="checkbox" name="is_transfer" ${t.is_transfer ? raw('checked') : ''}> Transfer between our own accounts (exclude from spending and income)</label>
            <div class="row full"><button class="btn primary" type="submit">Save changes</button><button type="button" class="btn ghost" data-rule>${icon('rule')}Make a rule</button>
              ${t.source === 'manual' ? html`<button type="button" class="btn ghost" data-edit-manual style="margin-left:auto">${icon('edit')}Amount, date…</button>` : ''}</div>
          </form></section>
          ${t.retailer || t.orders.length ? html`<section><h3>${t.orders.length ? 'What was bought' : `Link a ${fmt.label(t.retailer)} order`}</h3>
            <div class="stack" style="gap:10px">${t.orders.map(orderBlock)}</div>
            ${t.order_candidates.filter((c) => !t.orders.some((o) => o.order_id === c.order_id)).length ? html`<div class="${t.orders.length ? 'caption' : ''}" style="margin-top:${t.orders.length ? 10 : 0}px">${t.orders.length ? 'Another order belongs here?' : 'Orders placed around this date:'}</div>
              <div class="list" style="margin-top:6px">${t.order_candidates.filter((c) => !t.orders.some((o) => o.order_id === c.order_id)).map((c) => html`<div class="list-item"><div class="main-col"><div class="title">${c.first_item || c.label}</div>
              <div class="meta">${c.label} · ${fmt.date(c.order_date)} · ${c.items} item${c.items === 1 ? '' : 's'}</div></div><span class="amount">${fmt.money(c.total)}</span><button class="btn xs" data-link="${c.order_id}">Link</button></div>`)}</div>`
            : (!t.orders.length ? html`<p class="small muted">No ${fmt.label(t.retailer)} orders within a month of this charge. Import your order history with scripts/ingest_orders.py.</p>` : '')}</section>` : ''}
          <section><h3>Notes</h3>${t.notes ? html`<div class="callout" style="margin-bottom:10px">${icon('note')}<div><div class="small muted">Earlier note</div>${t.notes}</div></div>` : ''}<div id="d-notes"></div></section>
          <section><h3>Details</h3><dl class="kv">
            <dt>Bank description</dt><dd>${t.description}</dd>
            <dt>Posted</dt><dd>${t.posted_date || 'Pending'}</dd>${t.transacted_date && t.transacted_date !== t.posted_date ? html`<dt>Transacted</dt><dd>${t.transacted_date}</dd>` : ''}
            <dt>Account</dt><dd><a href="#/accounts/${encodeURIComponent(t.account_id)}">${t.account}</a></dd>
            <dt>Source</dt><dd>${t.source}${t.mcc ? ' · MCC ' + t.mcc : ''}</dd>${t.memo ? html`<dt>Memo</dt><dd>${t.memo}</dd>` : ''}${t.check_number ? html`<dt>Check #</dt><dd>${t.check_number}</dd>` : ''}
            ${t.updated_at ? html`<dt>Last edited</dt><dd>${fmt.ago(t.updated_at)}${t.updated_by ? ' by ' + t.updated_by : ''}</dd>` : ''}
            <dt>ID</dt><dd class="tiny muted">${t.txn_id}</dd></dl></section>
          ${t.similar.length ? html`<section><h3>Other ${t.merchant_name} transactions</h3><div class="list">${t.similar.map((s) => html`<button class="list-item" data-open="${s.txn_id}"><div class="main-col"><div class="title">${s.posted_date ? fmt.date(s.posted_date, { year: true }) : 'Pending'}</div><div class="meta">${s.category || ''}${s.subcategory ? ' · ' + s.subcategory : ''}</div></div><span class="amount">${F.amtCell(s.amount)}</span></button>`)}</div>
            <a class="small" href="#/spending?merchant=${encodeURIComponent(t.merchant_name)}&preset=all&kind=all" style="display:inline-block;margin-top:8px">See all ${t.merchant_name} activity</a></section>` : ''}
        </div>`);
      $('[data-x]', el).onclick = close;
      const form = $('#txn-form', el);
      $('[name=category]', form).onchange = (e) => {
        const s = cats[e.target.value] ? [...cats[e.target.value]] : [];
        setHTML($('#d-subs', el), html`${s.sort().map((x) => html`<option value="${x}">`)}`);
      };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(form));
        await F.post('/api/txn', { txn_id: t.txn_id, category: fd.category, subcategory: fd.subcategory, entity: fd.entity, person: fd.person,
          tags: fd.tags, is_transfer: !!fd.is_transfer });
        F.toast('Transaction saved'); F.loadMeta(true); changed();
      };
      $('[data-rule]', el).onclick = () => F.ruleModal({ pattern: t.merchant_name, field: 'merchant', category: $('[name=category]', form).value || t.category, subcategory: $('[name=subcategory]', form).value, priority: 50 }, changed);
      const em = $('[data-edit-manual]', el);
      if (em) em.onclick = () => F.manualTxnModal(t, (what) => { close(); if (what !== 'deleted') F.openTxn(id, { onChange }); changed(); });
      $$('[data-link]', el).forEach((b) => (b.onclick = async () => { await F.post('/api/order_link', { txn_id: t.txn_id, order_id: b.dataset.link }); F.toast('Order linked'); close(); F.openTxn(id, { onChange }); changed(); }));
      $$('[data-unlink]', el).forEach((b) => (b.onclick = async () => { await F.post('/api/order_link', { txn_id: t.txn_id, order_id: b.dataset.unlink, action: 'unlink' }); F.toast('Order unlinked'); close(); F.openTxn(id, { onChange }); changed(); }));
      $$('[data-open]', el).forEach((b) => (b.onclick = () => { close(); F.openTxn(b.dataset.open, { onChange }); }));
      F.notesBlock($('#d-notes', el), 'transaction', t.txn_id, t.notes_list, { onChange: changed, compact: true });
    }, { label: 'Transaction details' });
  };

  /* ---------- hand-entered records (formerly the Manual entry page) ---------- */
  /** Add or edit a hand-entered transaction (cash rent, a check, a charge on a card that isn't linked). */
  F.manualTxnModal = (t = {}, onDone) => {
    const accts = (F.meta?.accounts || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    F.modal({
      title: t.txn_id ? 'Edit transaction' : 'Add a transaction', sub: t.txn_id ? '' : 'For money the bank sync doesn’t see. It shows up everywhere a synced one does, marked “Manual”.',
      body: html`<div class="form-grid">
        <div class="field full"><label for="mt-acct">Account</label><select class="input" id="mt-acct" name="account_id" required>${accts.map((a) => html`<option value="${a.account_id}" ${a.account_id === t.account_id ? raw('selected') : ''}>${a.name}</option>`)}</select></div>
        <div class="field"><label for="mt-date">Date</label><input class="input" id="mt-date" type="date" name="date" value="${t.posted_date || F.todayISO()}" required></div>
        <fieldset class="field"><legend class="label">Direction</legend><div class="seg radio" role="radiogroup"><label class="check"><input type="radio" name="dir" value="out" ${!(t.amount > 0) ? raw('checked') : ''}> Money out</label><label class="check"><input type="radio" name="dir" value="in" ${t.amount > 0 ? raw('checked') : ''}> Money in</label></div></fieldset>
        <div class="field"><label for="mt-amt">Amount</label><span class="money-wrap"><input class="input" id="mt-amt" name="amount" inputmode="decimal" value="${t.amount !== undefined ? Math.abs(t.amount) : ''}" required></span></div>
        <div class="field"><label for="mt-desc">Description</label><input class="input" id="mt-desc" name="description" value="${t.description || ''}" required placeholder="e.g. Cash rent from tenant"></div>
        <div class="field"><label for="mt-cat">Category</label><select class="input" id="mt-cat" name="category">${F.catOptions(t.category || '')}</select></div>
        <div class="field"><label for="mt-sub">Subcategory</label><input class="input" id="mt-sub" name="subcategory" value="${t.subcategory || ''}"></div>
        <div class="field"><label for="mt-ent">Entity</label><select class="input" id="mt-ent" name="entity">${F.entityOptions(t.entity)}</select></div>
        <div class="field"><label for="mt-note">Note</label><input class="input" id="mt-note" name="notes" value="${t.notes || ''}"></div></div>`,
      submit: t.txn_id ? 'Save' : 'Add transaction',
      danger: t.txn_id ? { label: 'Delete', onClick: async () => { if (await F.confirm('Delete this transaction?', `${t.description} · ${fmt.money(t.amount)}`)) { await F.del('/api/txn/manual', { id: t.txn_id }); F.toast('Deleted'); onDone && onDone('deleted'); return true; } return false; } } : null,
      onSubmit: async (v) => {
        const amt = F.parseAmt(v.amount);
        if (!v.description.trim() || amt === null || Number.isNaN(amt)) { F.toast('A description and an amount are required', { kind: 'error' }); return false; }
        await F.post('/api/txn/manual', { ...v, txn_id: t.txn_id, amount: v.dir === 'in' ? Math.abs(amt) : -Math.abs(amt) });
        F.toast(t.txn_id ? 'Transaction updated' : 'Transaction added'); onDone && onDone('saved');
      },
    });
  };

  const MANUAL_TYPES = ['loan', 'mortgage', 'auto_loan', 'heloc', 'credit_card', 'brokerage', 'savings', 'vehicle', 'property', 'other'];
  /** Add or edit an account tracked by hand (a car, a loan, a 529…), with its first balance when new. */
  F.manualAcctModal = (m = {}, onDone) => F.modal({
    title: m.id ? `Edit ${m.name}` : 'Add an account by hand', sub: m.id ? '' : 'For anything the bank sync can’t see: a car, a private loan, a 529. Its balance counts toward net worth.',
    body: html`<div class="form-grid">
      <div class="field full"><label for="ma-name">Name</label><input class="input" id="ma-name" name="name" value="${m.name || ''}" required></div>
      <div class="field"><label for="ma-kind">It’s a…</label><select class="input" id="ma-kind" name="kind">${[['asset', 'Asset'], ['debt', 'Debt']].map(([k, l]) => html`<option value="${k}" ${k === (m.kind || 'debt') ? raw('selected') : ''}>${l}</option>`)}</select></div>
      <div class="field"><label for="ma-type">Type</label><select class="input" id="ma-type" name="type">${MANUAL_TYPES.map((x) => html`<option value="${x}" ${x === m.type ? raw('selected') : ''}>${F.typeLabel(x)}</option>`)}</select></div>
      <div class="field"><label for="ma-holder">Holder</label><select class="input" id="ma-holder" name="holder">${(F.meta?.holders || []).map((h) => html`<option ${h === (m.holder || 'Joint') ? raw('selected') : ''}>${h}</option>`)}</select></div>
      <div class="field"><label for="ma-ent">Entity</label><select class="input" id="ma-ent" name="entity">${F.entityOptions(m.entity)}</select></div>
      <div class="field"><label for="ma-rate">Interest rate %</label><input class="input" id="ma-rate" name="rate" value="${m.rate ?? ''}" inputmode="decimal"></div>
      <div class="field"><label for="ma-status">Status</label><select class="input" id="ma-status" name="status"><option value="open" ${m.status !== 'closed' ? raw('selected') : ''}>Open</option><option value="closed" ${m.status === 'closed' ? raw('selected') : ''}>Closed / paid off</option></select></div>
      ${m.id ? '' : html`<div class="field"><label for="ma-bal">Current balance</label><span class="money-wrap"><input class="input" id="ma-bal" name="balance" inputmode="decimal"></span></div><div class="field"><label for="ma-asof">As of</label><input class="input" id="ma-asof" type="date" name="as_of" value="${F.todayISO()}"></div>`}
      <label class="check full"><input type="checkbox" name="include_in_totals" ${m.include_in_totals !== 0 ? raw('checked') : ''}> Count in net worth</label>
      <div class="field full"><label for="ma-notes">Notes</label><input class="input" id="ma-notes" name="notes" value="${m.notes || ''}"></div></div>`,
    danger: m.id ? { label: m.sheet_loan ? 'Close account' : 'Delete', onClick: async () => {
      if (!(await F.confirm(m.sheet_loan ? `Close ${m.name}?` : `Delete ${m.name}?`, m.sheet_loan ? 'It comes from the household sheet, so it’s closed rather than deleted.' : 'Its balance history is deleted too.', m.sheet_loan ? 'Close' : 'Delete'))) return false;
      await F.del('/api/manual_account', { id: m.id }); F.toast(m.sheet_loan ? 'Account closed' : 'Account deleted'); onDone && onDone('deleted'); return true;
    } } : null,
    onSubmit: async (v) => {
      if (!v.name.trim()) { F.toast('Give the account a name', { kind: 'error' }); return false; }
      const bal = F.parseAmt(v.balance);
      if (Number.isNaN(bal)) { F.toast('The balance must be a number', { kind: 'error' }); return false; }
      const res = await F.post('/api/manual_account', { ...v, id: m.id, balance: bal === null ? '' : String(bal) });
      F.toast('Account saved'); onDone && onDone('saved', res.id);
    },
  });

  /** Card-payment progress for a month (every card, both holders): what Home shows and Pay cards details. */
  F.cardSummary = (d) => {
    const cards = (d.cards || []).filter((c) => !c.hidden);
    const withBal = cards.filter((c) => (c.owed || 0) > 0.005 || +c.planned > 0);
    const unpaid = cards.filter((c) => !c.paid).reduce((s, c) => s + (+c.planned || 0), 0);
    return { count: withBal.length, paid: withBal.filter((c) => c.paid).length, unplanned: withBal.filter((c) => !c.paid && !(+c.planned > 0)).length,
      unpaid, left: (d.totals?.checking || 0) - unpaid, checking: d.totals?.checking || 0 };
  };

  /* ---------- small helpers used by pages ---------- */
  F.hbars = (items, { max, color, onClick, active, valueFmt = (v) => fmt.amt(v, { cents: false }), sub, marker, over, labelDot } = {}) => {
    const m = max || Math.max(1, ...items.map((i) => Math.abs(i.value)), ...(marker ? items.map((i) => marker(i) || 0) : []));
    return html`<div class="hbars">${items.map((i) => {
      const w = Math.max(0, Math.abs(i.value)) / m * 100;
      const mk = marker ? marker(i) : null;
      const tag = onClick ? 'button' : 'div';
      return html`${raw(`<${tag} class="hbar ${over && over(i) ? 'over' : ''}" ${onClick ? `type="button" data-key="${esc(i.key ?? i.label)}" aria-pressed="${String(active === (i.key ?? i.label))}"` : ''}>`)}
        <span class="lbl">${labelDot ? html`<i class="dot" style="background:${raw(labelDot(i))}"></i>` : ''}<span title="${i.label}">${i.label}</span></span>
        <span class="track"><span class="fill" style="width:${w.toFixed(2)}%;${color ? 'background:' + (typeof color === 'function' ? color(i) : color) : ''}"></span>${mk ? html`<span class="marker" style="left:${Math.min(100, mk / m * 100).toFixed(2)}%" title="Budget ${fmt.money(mk, { cents: false })}"></span>` : ''}</span>
        <span class="val">${valueFmt(i.value)}${sub ? html`<small>${sub(i)}</small>` : ''}</span>${raw(`</${tag}>`)}`;
    })}</div>`;
  };
})();

/* People list for the Person picker: household defaults + app_settings 'people' + anyone already tagged. Kept out of code so no names live in the public repo. */
F.people = () => {
  const out = new Set(['Roque', 'Jennifer', 'Family']);
  try {
    const v = DB.one("SELECT value FROM app_settings WHERE key='people'");
    if (v) String(v).split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => out.add(x));
    DB.Q("SELECT DISTINCT person FROM transactions WHERE person IS NOT NULL AND person<>''").forEach((r) => out.add(r.person));
  } catch { /* DB not ready */ }
  return [...out];
};
