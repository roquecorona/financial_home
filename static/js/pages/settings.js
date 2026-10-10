/* Settings & data: categories, rules, data health, preferences. */
'use strict';
F.pages.settings = async (root, r, ctl) => {
  const { html, raw, fmt, icon, $, $$ } = F;
  const tab = r.params.tab || 'categories';
  const tabs = [['categories', 'Categories'], ['rules', 'Rules'], ['data', 'Data health'], ['prefs', 'Preferences']];
  const head = html`${F.head({ title: 'Settings & data', lede: 'Categories, the rules that apply them, and how fresh the data is.' })}
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => html`<a role="tab" href="#/settings?tab=${k}" aria-selected="${String(k === tab)}">${l}</a>`)}</div>`;

  if (tab === 'categories') {
    const d = await F.get('/api/categories');
    if (!ctl.alive()) return;
    const names = d.categories.map((c) => c.category);
    F.setHTML(root, html`${head}<section class="panel"><div class="panel-head"><h2>Categories</h2><span class="sub">Rename to tidy up; rename onto an existing name to merge. Budgets live on the Spending page.</span>
      <div class="tools"><button class="btn sm ghost" data-reset-colors>Reset chart colors</button></div></div>
      <div class="panel-body flush"><div class="table-wrap"><table class="t"><thead><tr><th>Category</th><th class="num">Transactions</th><th class="num">Net amount</th><th class="num hide-sm">Budget / month</th><th class="hide-sm">Last used</th><th></th></tr></thead>
      <tbody>${d.categories.map((c) => html`<tr><td><details><summary style="cursor:pointer;list-style:none"><span class="row" style="gap:8px"><i class="dot" style="background:${raw(F.catVar(c.category))}"></i><b>${c.category}</b><span class="small muted">${c.subcategories.length} sub</span></span></summary>
          <div style="padding:6px 0 4px 16px">${c.subcategories.map((s) => html`<div class="row small" style="padding:3px 0"><span style="flex:1">${s.subcategory || '(none)'}</span><span class="muted num">${s.n}</span><button class="btn xs ghost" data-rename-sub="${c.category}" data-sub="${s.subcategory}">Rename</button></div>`)}</div></details></td>
        <td class="num">${fmt.num(c.n)}</td><td class="num">${fmt.money(c.total, { cents: false })}</td><td class="num hide-sm">${c.budget ? fmt.money(c.budget, { cents: false }) : '—'}</td><td class="hide-sm">${c.last ? fmt.date(c.last, { year: true }) : '—'}</td>
        <td class="right"><button class="btn xs" data-rename="${c.category}">Rename or merge</button></td></tr>`)}</tbody></table></div></div></section>`);
    $$('[data-rename]', root).forEach((b) => (b.onclick = () => F.modal({
      title: `Rename “${b.dataset.rename}”`, sub: 'Every transaction, rule, budget and order item using it is updated. Picking an existing name merges the two.',
      body: html`<div class="field"><label>New name</label><input class="input" name="to" list="cat-names" value="${b.dataset.rename}">${F.datalist('cat-names', new Set(names))}</div>`,
      submit: 'Rename', onSubmit: async (v) => {
        if (!v.to.trim() || v.to === b.dataset.rename) return false;
        const merge = names.includes(v.to.trim());
        const res = await F.post('/api/category/rename', { from: b.dataset.rename, to: v.to.trim() });
        F.toast(`${merge ? 'Merged' : 'Renamed'} · ${res.updated} transactions updated`); F.loadMeta(true); F.refresh();
      },
    })));
    $$('[data-rename-sub]', root).forEach((b) => (b.onclick = () => F.modal({
      title: `Rename subcategory “${b.dataset.sub || '(none)'}”`, sub: `In ${b.dataset.renameSub}. You can also move it under another category.`,
      body: html`<div class="form-grid"><div class="field"><label>Category</label><select class="input" name="to_category">${names.map((n) => html`<option ${n === b.dataset.renameSub ? raw('selected') : ''}>${n}</option>`)}</select></div>
        <div class="field"><label>Subcategory</label><input class="input" name="to" value="${b.dataset.sub}"></div></div>`,
      submit: 'Rename', onSubmit: async (v) => {
        if (!v.to.trim()) return false;
        const res = await F.post('/api/category/rename', { from: b.dataset.renameSub, subcategory: b.dataset.sub || null, to: v.to.trim(), to_category: v.to_category });
        F.toast(`Updated ${res.updated} transactions`); F.loadMeta(true); F.refresh();
      },
    })));
    $('[data-reset-colors]', root).onclick = async () => { await F.post('/api/settings', { reset_category_colors: true }); await F.loadMeta(true); F.toast('Chart colors reassigned to the largest categories'); F.refresh(); };
    return;
  }

  if (tab === 'rules') {
    const d = await F.get('/api/rules');
    if (!ctl.alive()) return;
    F.setHTML(root, html`${head}<section class="panel"><div class="panel-head"><h2>Category rules</h2><span class="sub">Run in order before the built-in rules in scripts\\categorize.py. Rows edited by hand are never changed.</span>
      <div class="tools"><button class="btn sm" data-preview>Preview</button><button class="btn sm" data-apply>${icon('sync')}Re-apply all rules</button><button class="btn sm primary" data-new>${icon('plus')}New rule</button></div></div>
      <div class="panel-body flush"><div class="table-wrap"><table class="t"><thead><tr><th class="num">Order</th><th>When</th><th>Set category</th><th class="hide-sm">Entity</th><th class="num">Matches</th><th class="hide-sm">Added</th><th></th></tr></thead>
      <tbody>${d.rules.map((x) => html`<tr class="${x.active === 0 ? 'muted' : ''}"><td class="num">${x.priority}</td><td><span class="muted">${x.field} contains</span> <b>${x.pattern}</b></td><td><span class="row" style="gap:6px"><i class="dot" style="background:${raw(F.catVar(x.category))}"></i>${x.category}${x.subcategory ? ' · ' + x.subcategory : ''}</span></td>
        <td class="hide-sm">${x.entity || '—'}</td><td class="num">${x.matches ?? '—'}</td><td class="hide-sm small muted">${x.created_by || ''} ${x.created_at ? fmt.ago(x.created_at) : ''}</td><td class="right"><button class="btn xs" data-edit="${x.rule_id}">Edit</button></td></tr>`)}</tbody></table></div>
      ${d.rules.length ? '' : F.empty('No rules yet', 'Create one here, or from any transaction with “Make a rule”.', html`<button class="btn primary" data-new>New rule</button>`)}</div></section>`);
    $$('[data-new]', root).forEach((b) => (b.onclick = () => F.ruleModal({}, F.refresh)));
    $$('[data-edit]', root).forEach((b) => (b.onclick = () => F.ruleModal(d.rules.find((x) => x.rule_id === +b.dataset.edit), F.refresh)));
    $('[data-preview]', root).onclick = async () => { const res = await F.post('/api/rules/apply', { preview: true }); F.modal({ title: 'Preview', submit: '', cancel: 'Close', body: html`<p>${res.changed} transaction${res.changed === 1 ? '' : 's'} would change.</p>${res.examples.length ? html`<ul class="small">${res.examples.map((e) => html`<li>${e.description}: ${e.from_ || 'none'} → <b>${e.to}</b></li>`)}</ul>` : ''}` }); };
    $('[data-apply]', root).onclick = async () => { const res = await F.post('/api/rules/apply', {}); F.toast(`${res.changed} transaction${res.changed === 1 ? '' : 's'} updated by ${res.rules} rule${res.rules === 1 ? '' : 's'}`); F.loadMeta(true); };
    return;
  }

  if (tab === 'data') {
    const d = await F.get('/api/health');
    if (!ctl.alive()) return;
    const s = d.stats;
    const FRESH = { ok: ['good', 'Fresh'], stale: ['warn', 'Stale'], never: ['crit', 'No balance'] };
    F.setHTML(root, html`${head}
      <section class="band" style="--n:5" aria-label="Data summary">
        ${F.kpi('Transactions', fmt.num(s.transactions), s.first ? `${fmt.date(s.first, { year: true })} – ${fmt.date(s.last, { year: true })}` : '—')}
        ${F.kpi('Need a category', fmt.num(s.uncategorized), s.uncategorized ? html`<a href="#/spending?category=__none__&preset=all">Review them →</a>` : 'All categorized', { vcls: s.uncategorized ? 'alert-text' : '' })}
        ${F.kpi('Edited by hand', fmt.num(s.manual_edits), 'Protected from re-categorizing')}
        ${F.kpi('Pending', fmt.num(s.pending), 'Not counted until posted')}
        ${F.kpi('Data size', s.db_size ? fmt.num(s.db_size / 1048576, 1) + ' MB' : '—', html`<span title="${s.db_path || ''}">${F.dataStatus ? F.dataStatus() || s.db_path || '' : s.db_path || ''}</span>`)}
      </section>
      <div class="grid">
        <section class="panel span-12"><div class="panel-head"><h2>Sync freshness by account</h2><span class="sub">Balances older than 2 days are flagged</span></div>
          <div class="panel-body flush"><div class="table-wrap"><table class="t"><thead><tr><th>Account</th><th>Status</th><th>Last balance</th><th class="hide-sm">Balance days</th><th>History</th><th class="num">Transactions</th><th class="num hide-sm">Pending</th><th class="hide-sm">Sources</th></tr></thead>
          <tbody>${d.accounts.map((a) => html`<tr><td><a href="#/accounts/${encodeURIComponent(a.account_id)}"><b>${a.name}</b></a><div class="tiny muted">${a.institution_id || ''} · ${F.typeLabel(a.type)}</div></td>
            <td><span class="pill ${FRESH[a.fresh][0]}">${FRESH[a.fresh][1]}</span></td><td class="nowrap">${a.last_balance ? fmt.ago(a.last_balance) : '—'}</td><td class="hide-sm num">${a.balance_rows}</td>
            <td class="nowrap small">${a.first_txn ? `${fmt.date(a.first_txn, { year: true })} – ${fmt.date(a.last_txn, { year: true })}` : '—'}</td><td class="num">${fmt.num(a.txns)}</td><td class="num hide-sm">${a.pending || ''}</td><td class="hide-sm small">${a.sources || ''}</td></tr>`)}</tbody></table></div></div></section>
        <section class="panel span-6"><div class="panel-head"><h2>Imports</h2><span class="sub">Most recent first</span></div><div class="panel-body flush"><div class="list">
          ${d.imports.map((i) => html`<div class="list-item"><div class="main-col"><div class="title">${i.source}</div><div class="meta" title="${i.file_path || ''}">${i.file_path || ''}${i.notes ? ' · ' + i.notes : ''}</div></div><div style="text-align:right"><div class="small"><b>${fmt.num(i.rows_new)}</b> new of ${fmt.num(i.rows_in)}</div><div class="tiny muted">${fmt.ago(i.imported_at)}</div></div></div>`)}</div>
          ${d.imports.length ? '' : F.empty('No imports logged')}</div></section>
        <section class="panel span-6"><div class="panel-head"><h2>Tables</h2></div><div class="panel-body flush"><div class="table-wrap" style="max-height:380px;overflow-y:auto"><table class="t"><thead><tr><th>Table</th><th class="num">Rows</th></tr></thead>
          <tbody>${d.tables.map((t) => html`<tr><td>${t.table}</td><td class="num">${fmt.num(t.rows)}</td></tr>`)}</tbody></table></div></div></section>
        <section class="panel span-6"><div class="panel-head"><h2>By source</h2></div><div class="panel-body flush"><table class="t"><thead><tr><th>Source</th><th class="num">Rows</th><th>Covers</th></tr></thead>
          <tbody>${s.by_source.map((x) => html`<tr><td>${x.source}</td><td class="num">${fmt.num(x.n)}</td><td class="small">${x.first ? `${fmt.date(x.first, { year: true })} – ${fmt.date(x.last, { year: true })}` : ''}</td></tr>`)}</tbody></table>
          <div class="panel-body"><p class="small ink2">Jenny’s sheet months loaded: ${s.sheet_months.length ? s.sheet_months.map((m) => fmt.month(m, { short: true })).join(', ') : 'none'}.</p></div></div></section>
        <section class="panel span-6"><div class="panel-head"><h2>Settings</h2></div><div class="panel-body stack" style="gap:14px">
          <div class="row wrap" style="align-items:flex-end"><div class="field"><label for="thr">Flag transactions on Home at or above</label><span class="money-wrap"><input class="input" id="thr" value="${s.large_txn_threshold}" style="width:140px"></span></div><button class="btn" data-thr>Save</button></div>
          <div class="row wrap"><button class="btn" data-loans ${s.new_sheet_loans ? '' : raw('disabled')}>${icon('download')}Add new loans from Jenny’s sheet</button><span class="small muted">${s.new_sheet_loans ? `${s.new_sheet_loans} new loan${s.new_sheet_loans === 1 ? '' : 's'} found` : 'All sheet loans are tracked'}</span></div>
        </div></section>
      </div>`);
    $('[data-thr]', root).onclick = async () => { await F.post('/api/settings', { large_txn_threshold: $('#thr', root).value.replace(/[$,]/g, '') }); F.toast('Saved'); };
    $('[data-loans]', root).onclick = async () => { const res = await F.post('/api/import_sheet_loans', {}); F.toast(`Added ${res.created} loan${res.created === 1 ? '' : 's'}`); F.refresh(); };
    return;
  }

  F.setHTML(root, html`${head}<div class="grid"><section class="panel span-6"><div class="panel-head"><h2>This device</h2></div><div class="panel-body stack" style="gap:20px">
    <div class="field"><span class="label">Signed in as</span><div class="who-name">${F.state.user || '—'}</div><span class="hint">Notes and edits are signed with the name on your sign-in.</span></div>
    <div class="field"><label class="label" for="pw1">Password</label><input class="input" id="pw1" type="password" autocomplete="new-password" placeholder="New password (10+ characters)"><input class="input" id="pw2" type="password" autocomplete="new-password" placeholder="Repeat it" style="margin-top:8px"><div class="row" style="margin-top:8px"><button class="btn primary" type="button" data-setpw>Set password</button></div><span class="hint">Lets you sign in with email + password instead of an emailed link.</span></div>
    <div class="field"><span class="label" id="th-l">Theme</span><div class="seg" role="group" aria-labelledby="th-l">${['light', 'dark', 'auto'].map((k) => html`<button type="button" data-theme-set="${k}" aria-pressed="${String(F.theme === k)}">${F.themeLabel(k)}</button>`)}</div><span class="hint">Light is the default. “Match device” follows the phone or laptop setting.</span></div>
    </div></section>
    <section class="panel span-6"><div class="panel-head"><h2>Keyboard shortcuts</h2></div><div class="panel-body"><dl class="kv">
      <dt><kbd>/</kbd></dt><dd>Search everything</dd><dt><kbd>g</kbd> then <kbd>h</kbd></dt><dd>Home (also a accounts, s spending, c cards, b bills, i investments, p properties, o orders, n notes, m manual)</dd>
      <dt><kbd>Esc</kbd></dt><dd>Close a panel or dialog</dd><dt><kbd>Enter</kbd></dt><dd>Open the focused transaction</dd></dl></div></section></div>`);
  $$('[data-theme-set]', root).forEach((b) => (b.onclick = () => F.setTheme(b.dataset.themeSet)));
  const spw = $('[data-setpw]', root);
  if (spw) spw.onclick = async () => {
    const a = $('#pw1', root).value, b = $('#pw2', root).value;
    if (a !== b) { F.toast('The two passwords don’t match', { kind: 'error' }); return; }
    try { await Auth.setPassword(a); $('#pw1', root).value = ''; $('#pw2', root).value = ''; F.toast('Password set'); }
    catch (e) { F.toast(e.message || 'Couldn’t set the password', { kind: 'error' }); }
  };
};
