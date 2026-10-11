/* Financial Home v3 — Review inbox and transaction splits (no app.py counterpart).
   GET  /api/review            payees that need a look: payments to people (Zelle, Venmo, checks, wires…) and other rows
                               still in Other / Uncategorized, plus rental-business rows that aren't tied to a property.
                               ?summary=1 returns only the counts (Home's "needs attention" badge).
   POST /api/review/tag        tag a payee's rows; with always=true it also writes a category rule (priority 50, above the
                               categorize agent's 200-399) and applies it at once to every matching row nobody edited by hand.
   GET  /api/splits            split lines of one transaction
   POST /api/splits            split a transaction by hand (lines must add up to the amount exactly)
   DELETE /api/splits          remove a hand-made split (order splits come back from the order at the next laptop sync)
   Rows a person tagged are protected (updated_by = the person): the laptop pulls them as edits and never re-categorizes
   them. Rows a rule changed are marked updated_by='rule', so the laptop's categorize run (which pulls the rule first)
   reproduces them. */
'use strict';
(function (g) {
  const H = (g.H = g.H || {});
  const API = (g.API = g.API || {});
  API.get = API.get || {};
  API.post = API.post || {};
  API.del = API.del || {};
  const DB = () => g.DB;
  const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

  const INVEST = "('ira','hsa','401k','403b','brokerage','529')";
  const NON_PERSON = "('rule','auto','categorize','import','simplefin')";
  const PROTECTED = `(',' || REPLACE(COALESCE(t.tags,''),' ','') || ',' LIKE '%,manual,%'
      OR (t.updated_by IS NOT NULL AND LOWER(t.updated_by) NOT IN ${NON_PERSON}))`;
  const P2P = `(LOWER(t.description) LIKE '%zelle%' OR LOWER(t.description) LIKE '%venmo%' OR LOWER(t.description) LIKE '%cash app%'
      OR LOWER(t.description) LIKE 'check%' OR LOWER(t.description) LIKE '%wire%' OR LOWER(t.description) LIKE '%square cash%'
      OR LOWER(t.description) LIKE '%paypal%')`;
  const NEEDS_CAT = "(t.is_transfer=0 AND COALESCE(t.category,'') IN ('Other','Uncategorized',''))";
  const NO_PROPERTY_TAG = 'not-property-specific';  // same tag as Properties' "Not property-specific" (categorize.py learns it per merchant)
  // payees that are a payment method, not a payee: no "always" rule (each check is somebody else)
  const GENERIC = /^(check|checks|venmo|cash app|cash|atm|atm withdrawal|withdrawal|zelle|wire|domestic wire|paypal|square cash|unknown|deposit)$/i;
  const MAX_ROWS = 1000;

  const rentalEntities = () => H.Q("SELECT DISTINCT entity FROM properties WHERE entity IS NOT NULL AND COALESCE(kind,'rental')<>'primary'")
    .map((r) => r.entity);
  function needsPropertySql() {
    const ents = rentalEntities();
    const inList = ents.length ? ents.map(() => '?').join(',') : "''";
    return {
      sql: `(t.is_transfer=0 AND COALESCE(t.category,'') NOT IN ('Transfer','Investments')
        AND ',' || REPLACE(COALESCE(t.tags,''),' ','') || ',' NOT LIKE '%,${NO_PROPERTY_TAG},%'
        AND (COALESCE(t.entity,'')='rental business' OR (t.category='Rental property' AND COALESCE(t.entity,'') NOT IN (${inList}))))`,
      args: ents,
    };
  }

  /* Rows waiting in the inbox (one query; the payee grouping happens in JS so merchant_of runs once per row).
     A row needs a category while it is Other / Uncategorized and nobody edited it by hand; a rental-business row needs a
     property until it has one or is marked not property-specific (same list as Properties → without a property). */
  function reviewRows() {
    const np = needsPropertySql();
    return H.Q(`SELECT t.txn_id, t.posted_date, t.amount, t.description, t.category, t.subcategory, t.entity, t.person, t.notes,
          t.account_id, COALESCE(a.display_name, a.name) AS account, a.holder, merchant_of(t.description) AS payee,
          CASE WHEN ${P2P} THEN 1 ELSE 0 END AS p2p, CASE WHEN ${NEEDS_CAT} AND NOT ${PROTECTED} THEN 1 ELSE 0 END AS needs_category,
          CASE WHEN ${np.sql} THEN 1 ELSE 0 END AS needs_property
        FROM transactions t JOIN accounts a USING(account_id)
        WHERE t.pending=0 AND a.type NOT IN ${INVEST} AND ((${NEEDS_CAT} AND NOT ${PROTECTED}) OR ${np.sql})
        ORDER BY t.posted_date DESC, t.txn_id`, [...np.args, ...np.args]);
  }

  const kindOf = (grp) => (grp.p2p ? 'people' : grp.needs_category ? 'other' : 'property');
  const KIND_ORDER = { people: 0, property: 1, other: 2 };

  /* Rule pattern for a payee: a description regex that matches every row of the group, else an exact merchant match.
     null when the payee is generic (Check, Venmo…) or nothing matches all rows. */
  function payee_rule(key, rows) {
    if (!key || GENERIC.test(key.trim())) return null;
    const zm = /^Zelle: (.+)$/.exec(key);
    const words = (zm ? zm[1] : key).split(/\s+/).filter(Boolean).map((w) => H.re_escape(w.toLowerCase()));
    if (!words.length) return null;
    const cands = [];
    if (zm) cands.push({ field: 'description', pattern: `re:zelle\\W+(?:payment\\W+)?to\\W+${words.join('\\W+')}\\b` });
    else cands.push({ field: 'description', pattern: `re:\\b${words.join('\\W+')}` });
    cands.push({ field: 'merchant', pattern: `re:^${H.re_escape(key)}$` });
    for (const c of cands) {
      let rx;
      try { rx = H.rule_regex(c.pattern); } catch (e) { continue; }
      const ok = rows.every((t) => { rx.lastIndex = 0; return rx.test(H.rule_field_value(c.field, t) || ''); });
      if (ok) return c;
    }
    return null;
  }

  // Most common category/subcategory/entity/person this payee got elsewhere (rows outside the inbox).
  function suggestions(keys) {
    const want = new Set(keys);
    const out = new Map();
    if (!want.size) return out;
    const rows = H.Q(`SELECT merchant_of(t.description) AS payee, t.category, t.subcategory, t.entity, t.person, COUNT(*) AS n
        FROM transactions t WHERE t.is_transfer=0 AND COALESCE(t.category,'') NOT IN ('Other','Uncategorized','','Transfer','Investments','Income')
        GROUP BY 1,2,3,4,5 ORDER BY 6 DESC`);
    for (const r of rows) if (want.has(r.payee) && !out.has(r.payee)) out.set(r.payee, { category: r.category, subcategory: r.subcategory, entity: r.entity, person: r.person, n: r.n });
    return out;
  }

  function api_review(q) {
    const rows = reviewRows();
    const groups = new Map();
    for (const t of rows) {
      let grp = groups.get(t.payee);
      if (!grp) {
        grp = { key: t.payee, n: 0, total: 0, first: t.posted_date, last: t.posted_date, p2p: 0, needs_category: 0, needs_property: 0,
          _acc: new Map(), _amt: new Map(), rows: [] };
        groups.set(t.payee, grp);
      }
      grp.n += 1; grp.total += t.amount;
      if (t.posted_date && t.posted_date < grp.first) grp.first = t.posted_date;
      if (t.posted_date && t.posted_date > grp.last) grp.last = t.posted_date;
      grp.p2p |= t.p2p; grp.needs_category |= t.needs_category; grp.needs_property |= t.needs_property;
      const acc = grp._acc.get(t.account_id) || { account_id: t.account_id, name: t.account, holder: t.holder, n: 0, total: 0 };
      acc.n += 1; acc.total += t.amount; grp._acc.set(t.account_id, acc);
      const ak = H.r2(t.amount);
      grp._amt.set(ak, (grp._amt.get(ak) || 0) + 1);
      grp.rows.push(t);
    }
    const counts = { rows: rows.length, groups: groups.size, total: H.r2(rows.reduce((s, t) => s + t.amount, 0)), people: 0, property: 0, other: 0 };
    const list = [...groups.values()];
    for (const grp of list) { grp.kind = kindOf(grp); counts[grp.kind] += grp.n; }
    if (H.first(q, 'summary') === '1') return { counts };
    const kind = H.first(q, 'kind');
    const sel = kind && KIND_ORDER[kind] !== undefined ? list.filter((x) => x.kind === kind) : list;
    sel.sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || (Math.abs(b.total) - Math.abs(a.total)) || (a.key < b.key ? -1 : 1));
    const sug = suggestions(sel.map((x) => x.key));
    const userRules = H.Q(`SELECT * FROM category_rules WHERE COALESCE(active,1)=1 AND priority<200 ORDER BY priority, rule_id`);
    const out = sel.map((grp) => {
      let top = null;
      for (const [amt, n] of grp._amt) if (n >= 2 && (!top || n > top.n)) top = { amount: amt, n };
      const rule = payee_rule(grp.key, grp.rows);
      const existing = rule ? userRules.find((r) => r.pattern === rule.pattern && (r.field || 'description') === rule.field) || null : null;
      return {
        key: grp.key, kind: grp.kind, needs_category: !!grp.needs_category, needs_property: !!grp.needs_property,
        n: grp.n, total: H.r2(grp.total), first: grp.first, last: grp.last,
        accounts: [...grp._acc.values()].sort((a, b) => b.n - a.n).map((a) => ({ ...a, total: H.r2(a.total) })),
        recurring: top, can_rule: !!rule, rule_pattern: rule ? rule.pattern : null, rule: existing,
        suggestion: sug.get(grp.key) || null,
        rows: grp.rows.slice(0, 200).map((t) => ({ txn_id: t.txn_id, posted_date: t.posted_date, amount: t.amount, description: t.description,
          account: t.account, category: t.category, subcategory: t.subcategory, entity: t.entity, person: t.person, notes: t.notes,
          needs_category: !!t.needs_category, needs_property: !!t.needs_property })),
      };
    });
    // the choices the tagging form offers (categories in use anywhere, including order items and rules)
    const tax = {};
    for (const r of H.Q(`SELECT category, subcategory FROM (
          SELECT category, subcategory FROM transactions UNION SELECT category, subcategory FROM order_items
          UNION SELECT category, subcategory FROM category_rules UNION SELECT category, subcategory FROM transaction_splits)
        WHERE category IS NOT NULL AND category NOT IN ('Uncategorized','') ORDER BY 1, 2`)) {
      (tax[r.category] = tax[r.category] || []);
      if (r.subcategory && !tax[r.category].includes(r.subcategory)) tax[r.category].push(r.subcategory);
    }
    return { counts, groups: out, taxonomy: tax, properties: rentalEntities(), people: people() };
  }

  // Person choices: app_settings 'people' (kept out of the public code) + household defaults + anyone already tagged.
  function people() {
    const outp = [];
    const add = (x) => { x = String(x || '').trim(); if (x && !outp.includes(x)) outp.push(x); };
    ['Roque', 'Jennifer'].forEach(add);
    const v = H.setting('people');
    if (v) String(v).split(',').forEach(add);
    for (const r of H.Q(`SELECT person FROM (SELECT person FROM transactions UNION SELECT person FROM order_items UNION SELECT person FROM transaction_splits)
        WHERE person IS NOT NULL AND person<>'' ORDER BY 1`)) add(r.person);
    add('Family');
    return outp;
  }

  // Apply one rule now to every row nobody edited by hand whose first matching active rule (priority order) is this one.
  async function apply_rule_now(rule_id) {
    const rules = [];
    for (const r of H.Q('SELECT * FROM category_rules WHERE COALESCE(active,1)=1 AND category IS NOT NULL ORDER BY priority, rule_id')) {
      try { rules.push([H.rule_regex(r.pattern), r]); } catch (e) { /* invalid pattern: skipped, like categorize.py */ }
    }
    const mine = rules.find(([, r]) => r.rule_id === rule_id);
    if (!mine) return 0;
    const [mrx, rule] = mine;
    const groups = new Map();
    let n = 0;
    for (const t of H.Q(`SELECT t.txn_id, t.description, t.merchant, t.memo, t.account_id, t.category, t.subcategory, t.entity, t.person, t.tags
          FROM transactions t JOIN accounts a USING(account_id) WHERE a.type NOT IN ${INVEST} AND NOT ${PROTECTED}`)) {
      mrx.lastIndex = 0;
      if (!mrx.test(H.rule_field_value(rule.field, t) || '')) continue;
      let first = null;
      for (const [rx, r] of rules) { rx.lastIndex = 0; if (rx.test(H.rule_field_value(r.field, t) || '')) { first = r; break; } }
      if (!first || first.rule_id !== rule_id) continue;
      let tags = t.tags;
      for (const tg of String(rule.tags || '').split(',')) if (tg.trim()) tags = H.add_tag(tags, tg.trim());
      const patch = { category: rule.category, subcategory: rule.subcategory, entity: rule.entity || t.entity, person: rule.person || t.person,
        tags: tags || null, is_transfer: rule.category === 'Transfer' || rule.category === 'Investments' ? 1 : 0 };
      if (patch.category === t.category && patch.subcategory === t.subcategory && patch.entity === t.entity && patch.person === t.person && patch.tags === (t.tags || null)) continue;
      const key = JSON.stringify(patch);
      if (!groups.has(key)) groups.set(key, { patch, ids: [] });
      groups.get(key).ids.push(t.txn_id);
      n += 1;
    }
    const now = H.now_s();
    for (const { patch, ids } of groups.values()) {
      for (let i = 0; i < ids.length; i += 100) {
        await DB().update('transactions', { txn_id: ids.slice(i, i + 100) }, Object.assign({}, patch, { updated_by: 'rule', updated_at: now }));
      }
    }
    return n;
  }

  async function post_review_tag(b) {
    b = b || {};
    const db = DB();
    const ids = Array.isArray(b.txn_ids) ? b.txn_ids.map(String) : null;
    if (!ids || !ids.length || ids.length > MAX_ROWS) throw new H.ApiError(400, `txn_ids must be a list of 1-${MAX_ROWS} transaction ids`);
    const noProp = H.pybool(b.no_property);
    const category = H.v_str(b.category, 'category', !noProp, 120);
    const subcategory = H.v_str(b.subcategory, 'subcategory', false, 120);
    const entity = H.v_str(b.entity, 'entity', false, 120);
    const person = H.v_str(b.person, 'person', false, 120);
    const note = H.v_str(b.note, 'note', false, 2000);
    const always = H.pybool(b.always);
    const key = H.v_str(b.key, 'key', always, 200);
    const cur = new Map();
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      for (const r of db.Q(`SELECT txn_id, description, merchant, memo, account_id, category, subcategory, entity, person, tags, notes
          FROM transactions WHERE txn_id IN (${part.map(() => '?').join(',')})`, part)) cur.set(r.txn_id, r);
    }
    if (cur.size !== new Set(ids).size) throw new H.ApiError(404, 'Some of these transactions no longer exist. Refresh and try again.');
    let rule = null;
    if (always) {
      rule = payee_rule(key, [...cur.values()]);
      if (!rule) throw new H.ApiError(400, `Can't make a rule for “${key}”: tag these without “always”.`);
    }
    // one write per distinct patch (tags differ per row only when rows already had tags)
    const now = H.now_s();
    const groups = new Map();
    for (const t of cur.values()) {
      const patch = { updated_by: db.user || 'app', updated_at: now };
      if (category) {
        patch.category = category; patch.subcategory = subcategory;
        patch.is_transfer = category === 'Transfer' || category === 'Investments' ? 1 : 0;
      }
      if (entity && !noProp) patch.entity = entity;
      if (has(b, 'person')) patch.person = person;
      if (note) patch.notes = note;
      let tags = H.add_tag(t.tags, 'manual');
      if (noProp) tags = H.add_tag(tags, NO_PROPERTY_TAG);
      patch.tags = tags;
      const k = JSON.stringify(patch);
      if (!groups.has(k)) groups.set(k, { patch, ids: [] });
      groups.get(k).ids.push(t.txn_id);
    }
    for (const { patch, ids: gid } of groups.values()) {
      for (let i = 0; i < gid.length; i += 100) await db.update('transactions', { txn_id: gid.slice(i, i + 100) }, patch);
    }
    const out = { ok: true, updated: cur.size, rule_id: null, rule_applied: 0 };
    if (rule) {
      const first = [...cur.values()][0];
      const vals = {
        pattern: rule.pattern, field: rule.field,
        category: category || first.category, subcategory: category ? subcategory : first.subcategory,
        entity: noProp ? null : (entity || null), person: person || null, tags: noProp ? NO_PROPERTY_TAG : null,
        priority: 50, active: 1,
      };
      const existing = db.row('SELECT rule_id FROM category_rules WHERE pattern=? AND COALESCE(field,\'description\')=? ORDER BY priority, rule_id LIMIT 1', [rule.pattern, rule.field]);
      if (existing) {
        await db.update('category_rules', { rule_id: existing.rule_id }, vals);
        out.rule_id = existing.rule_id;
      } else {
        const rows = await db.insert('category_rules', Object.assign({}, vals, { created_by: db.user || 'app', created_at: now }));
        out.rule_id = rows.length ? rows[0].rule_id : null;
      }
      out.pattern = rule.pattern;
      if (out.rule_id) out.rule_applied = await apply_rule_now(out.rule_id);
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------- splits
  const cents = (x) => Math.round(Number(x) * 100);

  function api_splits(q) {
    const tid = H.v_str(H.first(q, 'txn_id') || H.first(q, 'id'), 'txn_id', true, 200);
    const t = H.row(`SELECT t.txn_id, t.amount, t.category, t.subcategory, t.entity, t.person, t.description, merchant_of(t.description) AS merchant_name
        FROM transactions t WHERE t.txn_id=?`, [tid]);
    if (!t) throw new H.ApiError(404, 'No such transaction');
    const splits = H.txn_splits(tid);
    const source = splits.length ? (splits.some((s) => s.source === 'manual') ? 'manual' : 'order') : null;
    // lines grouped by what they are (the order view lists every item; this is the "where did it go" summary)
    const agg = new Map();
    for (const s of splits) {
      const k = JSON.stringify([s.category, s.subcategory, s.entity, s.person]);
      const a = agg.get(k) || { category: s.category, subcategory: s.subcategory, entity: s.entity, person: s.person, amount: 0, n: 0 };
      a.amount += s.amount; a.n += 1; agg.set(k, a);
    }
    const summary = [...agg.values()].map((a) => ({ ...a, amount: H.r2(a.amount) })).sort((a, b) => a.amount - b.amount);
    return { txn: t, splits, source, summary, total: H.r2(splits.reduce((x, s) => x + s.amount, 0)) };
  }

  async function post_splits(b) {
    b = b || {};
    const db = DB();
    const tid = H.v_str(b.txn_id, 'txn_id', true, 200);
    const t = db.row('SELECT txn_id, amount, entity FROM transactions WHERE txn_id=?', [tid]);
    if (!t) throw new H.ApiError(404, 'No such transaction');
    const lines = Array.isArray(b.lines) ? b.lines : null;
    if (!lines || lines.length < 2 || lines.length > 50) throw new H.ApiError(400, 'A split needs 2 to 50 lines');
    const rows = lines.map((l, i) => {
      const amt = H.v_num(l && l.amount, `lines[${i}].amount`, true, -1e9, 1e9);
      if (!cents(amt)) throw new H.ApiError(400, `Line ${i + 1} has no amount`);
      return {
        txn_id: tid, line: i + 1, amount: cents(amt) / 100,
        category: H.v_str(l.category, `lines[${i}].category`, true, 120), subcategory: H.v_str(l.subcategory, `lines[${i}].subcategory`, false, 120),
        entity: H.v_str(l.entity, `lines[${i}].entity`, false, 120), person: H.v_str(l.person, `lines[${i}].person`, false, 120),
        note: H.v_str(l.note, `lines[${i}].note`, false, 500), source: 'manual', order_id: null, item_line: null,
        created_by: db.user || 'app', created_at: H.now_s(),
      };
    });
    const sum = rows.reduce((s, r) => s + cents(r.amount), 0);
    if (sum !== cents(t.amount)) {
      throw new H.ApiError(400, `The lines add up to ${(sum / 100).toFixed(2)}, not ${(cents(t.amount) / 100).toFixed(2)}. Adjust them so they match the charge.`);
    }
    await db.remove('transaction_splits', { txn_id: tid });
    await db.insert('transaction_splits', rows);
    return { ok: true, lines: rows.length };
  }

  async function del_splits(q) {
    const tid = H.v_str(H.first(q, 'txn_id') || H.first(q, 'id'), 'txn_id', true, 200);
    const n = (await DB().remove('transaction_splits', { txn_id: tid, source: 'manual' })).length;
    return { ok: true, removed: n };
  }

  Object.assign(H, { api_review, payee_rule, apply_rule_now, review_people: people });
  API.get['/api/review'] = api_review;
  API.post['/api/review/tag'] = post_review_tag;
  API.get['/api/splits'] = api_splits;
  API.post['/api/splits'] = post_splits;
  API.del['/api/splits'] = del_splits;
  if (typeof module !== 'undefined' && module.exports) module.exports = { api_review, post_review_tag, api_splits, post_splits, del_splits };
})(typeof globalThis !== 'undefined' ? globalThis : this);
