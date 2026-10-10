/* 06 Orders: Amazon / Target orders, what was in them, and the card charges they produced. */
'use strict';
F.pages.orders = async (root, r, ctl) => {
  const { html, raw, fmt, icon, $, $$ } = F;
  const p = Object.assign({ preset: 'all', tab: 'orders' }, r.params);
  const rng = p.preset === 'all' ? {} : F.presetRange(p.preset, p);
  const PAGE = 50;
  const query = { start: rng.start, end: rng.end, retailer: p.retailer, q: p.q, status: p.status };
  const d = await F.get('/api/orders', { ...query, limit: PAGE, offset: 0 });
  let nextOffset = d.orders.length;
  // A deep link (search result, note) to an older order: show it first, open.
  if (p.id && !d.orders.some((o) => o.order_id === p.id)) { const one = await F.get('/api/order', { id: p.id }).catch(() => null); if (one) d.orders.unshift(one); }
  if (!ctl.alive()) return;
  const setP = (patch) => F.go('#/orders?' + new URLSearchParams(Object.entries({ ...p, id: '', ...patch }).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString());
  const n = d.counts;
  const MATCH = { matched: ['good', 'Matched'], partial: ['warn', 'Partly matched'], unmatched: ['neutral', 'No charge found'] };
  const filtered = !!(p.retailer || p.q || p.status || p.preset !== 'all');
  const byId = Object.fromEntries(d.orders.map((o) => [o.order_id, o]));
  const shownCount = () => Object.keys(byId).length;
  const filteredN = d.counts.filtered ?? d.orders.length;

  /* The body of an order is rendered when it is opened — 300 orders × items × category menus would be slow on a phone. */
  const orderBody = (o) => html`<div class="order-body grid">
      <div class="span-7"><div class="label" style="margin-bottom:4px">Items</div>
        ${o.items.map((it) => html`<div class="order-item">
          <div class="oi-main">${it.product_url ? html`<a href="${it.product_url}" target="_blank" rel="noopener noreferrer">${it.title}<span class="sr-only"> (opens ${fmt.label(o.retailer)})</span></a>` : it.title}
            <div class="tiny muted">${it.quantity && it.quantity !== 1 ? `${fmt.num(it.quantity)} × ` : ''}${it.unit_price !== null && it.unit_price !== undefined ? fmt.amt(it.unit_price) : ''}${it.sku ? ' · ' + it.sku : ''}${it.status ? ' · ' + it.status : ''}</div></div>
          <select class="input sm" data-item="${it.line_no}" aria-label="Category for ${it.title.slice(0, 60)}">${F.catOptions(it.category || '', { blank: 'Item category…' })}</select></div>`)}</div>
      <div class="span-5"><div class="label" style="margin-bottom:4px">Card charges</div>
        ${o.links.length ? html`<div class="rows">${o.links.map((t) => html`<button type="button" class="trow" data-txn="${t.txn_id}"><span class="d">${fmt.date(t.posted_date)}</span>
            <span class="t"><span class="ellipsis">${t.account}</span><span class="m">${t.method === 'manual' ? 'Linked by hand' : t.method === 'split_shipments' ? 'One of several shipments' : 'Same amount'}</span></span><span class="a">${F.amtCell(t.amount)}</span></button>`)}</div>`
        : html`<p class="small ink2">No card charge is linked yet. Open the charge from <a href="#/orders?tab=charges">Charges without an order</a> to link it.</p>`}
        <div class="row wrap" style="margin-top:12px">${o.url ? html`<a class="btn sm" href="${o.url}" target="_blank" rel="noopener noreferrer">${icon('ext')}Open on ${fmt.label(o.retailer)}</a>` : ''}
          ${o.match === 'partial' ? html`<span class="small muted">Linked ${fmt.money(o.linked_total)} of ${fmt.money(o.total)}</span>` : ''}</div>
        ${o.ship_to || o.store ? html`<p class="tiny muted" style="margin-top:8px">${o.ship_to ? 'Shipped to ' + o.ship_to : ''}${o.store ? (o.ship_to ? ' · ' : '') + 'Store ' + o.store : ''}</p>` : ''}
        ${o.status ? html`<p class="tiny muted" style="margin-top:4px">${o.status}</p>` : ''}</div></div>`;
  const orderRow = (o) => {
    const [cls, lbl] = MATCH[o.match] || MATCH.unmatched;
    const first = o.items[0];
    return html`<details class="order" data-order="${o.order_id}" ${p.id === o.order_id ? raw('open') : ''}>
      <summary class="order-sum">
        <span class="d">${fmt.date(o.order_date)}</span>
        <span class="t"><span class="ellipsis">${first ? first.title : o.label}</span>
          <span class="m"><b class="ret">${fmt.label(o.retailer)}</b> ${o.label.replace(/^\w+ /, '')}${o.items.length > 1 ? ` · +${o.items.length - 1} more` : ''}${o.ordered_by ? ' · ' + o.ordered_by : ''}</span></span>
        <span class="pill ${cls} hide-sm">${lbl}</span>
        <span class="a">${fmt.amt(o.total)}</span></summary>
      <div class="order-slot">${p.id === o.order_id ? orderBody(o) : ''}</div></details>`;
  };
  const countLine = () => (nextOffset < filteredN ? `${fmt.num(shownCount())} of ${fmt.num(filteredN)}${filtered ? ' matching' : ''}, newest first` : `${fmt.num(filteredN)} ${filtered ? 'matching' : 'shown'}`);
  const moreBtn = () => (nextOffset < filteredN ? html`<button type="button" class="btn sm" data-more>Show ${fmt.num(Math.min(PAGE, filteredN - nextOffset))} more</button>` : '');
  F.setHTML(root, html`
    ${F.head({ title: 'Orders', lede: 'Amazon and Target orders matched to the card charges they produced, so a vague “AMAZON MKTPL” line turns into what was actually bought.' })}
    <section class="band" style="--n:3" aria-label="Summary">
      ${F.kpi('Orders', fmt.num(n.total), `${fmt.num(n.items)} items`)}
      ${F.kpi('Matched to a charge', n.total ? fmt.pct(n.matched / Math.max(1, n.matched + n.partial + n.unmatched), 0) : '—', `${fmt.num(n.partial)} partly · ${fmt.num(n.unmatched)} with no charge`, { vcls: 'accent' })}
      ${F.kpi('Charges, no order', fmt.num(n.unmatched_charges), n.unmatched_charges ? 'Link them →' : 'Every recent charge has an order', { href: '#/orders?tab=charges' })}
    </section>
    <div class="tabs" role="tablist"><button type="button" role="tab" data-tab="orders" aria-selected="${String(p.tab === 'orders')}">Orders</button><button type="button" role="tab" data-tab="charges" aria-selected="${String(p.tab === 'charges')}">Charges without an order <span class="badge">${n.unmatched_charges}</span></button></div>
    ${p.tab === 'orders' ? html`<div class="filters">${F.presetSelect(p.preset)}
        <div class="seg" role="group" aria-label="Retailer">${[['', 'Both'], ['amazon', 'Amazon'], ['target', 'Target']].map(([k, l]) => html`<button type="button" data-ret="${k}" aria-pressed="${String((p.retailer || '') === k)}">${l}</button>`)}</div>
        <select class="input sm" data-status style="width:auto" aria-label="Match status"><option value="">Any match status</option>${Object.entries(MATCH).map(([k, [, l]]) => html`<option value="${k}" ${p.status === k ? raw('selected') : ''}>${l}</option>`)}</select>
        <input class="input sm" type="search" data-q placeholder="Search items or order number" value="${p.q || ''}" style="width:260px" aria-label="Search orders" enterkeyhint="search"></div>
      <div class="grid"><section class="span-8" aria-label="Orders">${F.secHead('Orders', { sub: html`<span id="orders-count">${countLine()}</span>` })}
          ${d.orders.length ? html`<div class="orders" id="orders-list">${d.orders.map(orderRow)}</div>
            <div class="panel-foot" id="orders-more">${moreBtn()}</div>` : n.total ? F.empty('No orders match these filters', '', html`<button type="button" class="btn sm" data-reset>Clear filters</button>`) : F.empty('No orders imported yet', 'Orders arrive with the order-history import. Once they’re in, each one is linked to the card charge it produced.')}</section>
        <section class="span-4">${F.secHead('What we bought', { sub: 'By item category' })}${d.item_categories.length ? F.hbars(d.item_categories.map((c) => ({ label: c.name, value: c.total })), { labelDot: (i) => F.catVar(i.label), valueFmt: (v) => fmt.amt(v, { cents: false }) }) : F.empty('Set item categories to see this', 'Open an order and pick a category for each item.')}
          <p class="caption">Item categories are separate from the card charge’s category — useful when one Amazon order mixes groceries, school supplies and household items.</p></section></div>`
    : html`<section style="margin-top:24px">${F.secHead('Amazon and Target charges with no order', { sub: 'Open one to link it to an order placed around that date' })}
        ${d.unmatched_charges.length ? html`<div class="rows">${d.unmatched_charges.map((t) => html`<button type="button" class="trow" data-txn="${t.txn_id}"><span class="d">${fmt.date(t.posted_date)}</span>
          <span class="t"><span class="ellipsis">${t.merchant_name}</span><span class="m ellipsis">${t.account} · ${t.description}</span></span><span class="a">${F.amtCell(t.amount)}</span></button>`)}</div>`
        : F.empty('Every recent charge has an order')}</section>`}`);
  $$('[data-tab]', root).forEach((b) => (b.onclick = () => setP({ tab: b.dataset.tab })));
  $$('[data-ret]', root).forEach((b) => (b.onclick = () => setP({ retailer: b.dataset.ret })));
  const ps = $('select[aria-label="Date range"]', root); if (ps) ps.onchange = () => setP({ preset: ps.value });
  const ss = $('[data-status]', root); if (ss) ss.onchange = () => setP({ status: ss.value });
  const qi = $('[data-q]', root); if (qi) qi.addEventListener('input', F.debounce(() => setP({ q: qi.value }), 500));
  const rs = $('[data-reset]', root); if (rs) rs.onclick = () => F.go('#/orders');
  const bindTxn = (scope) => $$('[data-txn]', scope).forEach((b) => (b.onclick = (e) => { e.preventDefault(); F.openTxn(b.dataset.txn, { onChange: F.refresh }); }));
  const bindBody = (det) => {
    bindTxn(det);
    $$('[data-item]', det).forEach((s) => (s.onchange = async () => {
      await F.post('/api/order_item', { order_id: det.dataset.order, line_no: +s.dataset.item, category: s.value });
      F.toast('Item category saved');
    }));
  };
  bindTxn(root);
  const bindOrder = (det) => {
    if (det.open) bindBody(det);
    det.addEventListener('toggle', () => {
      const slot = $('.order-slot', det);
      if (det.open && !slot.firstElementChild) { F.setHTML(slot, orderBody(byId[det.dataset.order])); bindBody(det); }
    });
  };
  $$('details.order', root).forEach(bindOrder);
  const bindMore = () => {
    const mb = $('[data-more]', root);
    if (!mb) return;
    mb.onclick = async () => {
      mb.disabled = true; mb.textContent = 'Loading…';
      let next;
      try { next = await F.get('/api/orders', { ...query, limit: PAGE, offset: nextOffset }); } catch { mb.disabled = false; mb.textContent = 'Try again'; return; }
      nextOffset += next.orders.length;
      const fresh = next.orders.filter((o) => !byId[o.order_id]);
      fresh.forEach((o) => { byId[o.order_id] = o; });
      const list = $('#orders-list', root);
      list.insertAdjacentHTML('beforeend', html`${fresh.map(orderRow)}`.toString());
      fresh.forEach((o) => { const det = $(`details[data-order="${CSS.escape(o.order_id)}"]`, list); if (det) bindOrder(det); });
      F.setHTML($('#orders-count', root), countLine());
      F.setHTML($('#orders-more', root), moreBtn());
      bindMore();
    };
  };
  bindMore();
  if (p.id) { const el = $(`details[data-order="${CSS.escape(p.id)}"]`, root); if (el) el.scrollIntoView({ block: 'center' }); }
};
