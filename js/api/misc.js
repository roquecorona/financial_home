/* Financial Home v3 - meta, search, categories, rules, health, manual, settings API (ported 1:1 from app_v2/app.py).
   api_meta, api_search, api_categories, api_rules, rule_match_count, rule_regex, rule_field_value, api_health, api_manual,
   post_category_rename, post_rule, del_rule, apply_db_rules, post_rules_apply, post_settings, seed_sheet_loans,
   post_import_sheet_loans. (add_tag lives in helpers.js.) Same SQL as app.py; writes go through DB.insert/upsert/update/remove. */
'use strict';
(function (g) {
  const H = (g.H = g.H || {});
  const API = (g.API = g.API || {});
  API.get = API.get || {};
  API.post = API.post || {};
  API.del = API.del || {};
  const DB = () => g.DB;
  const has = (o, k) => o !== null && o !== undefined && Object.prototype.hasOwnProperty.call(o, k);
  const nn = (x) => (x === undefined ? null : x);

  // ---------------------------------------------------------------------------------------------- GET /api/meta
  function api_meta(q) {
    const accts = H.Q(`SELECT account_id, COALESCE(display_name, name) AS name, holder, type, entity, status, last4
        FROM accounts ORDER BY type, name`);
    const cats = H.Q(`SELECT COALESCE(category,'Uncategorized') AS category, subcategory, COUNT(*) AS n FROM transactions
        GROUP BY 1,2 ORDER BY 1,2`);
    const ents = new Set();
    for (const r of H.rows('SELECT DISTINCT entity FROM transactions WHERE entity IS NOT NULL')) ents.add(r[0]);
    for (const r of H.rows('SELECT DISTINCT entity FROM accounts WHERE entity IS NOT NULL')) ents.add(r[0]);
    for (const r of H.rows('SELECT DISTINCT entity FROM properties WHERE entity IS NOT NULL')) ents.add(r[0]);
    ents.add('household');
    const rng = H.rows('SELECT MIN(posted_date), MAX(posted_date) FROM transactions')[0];
    return {
      accounts: accts, categories: cats, entities: H.pysorted(Array.from(ents)), holders: H.HOLDERS.slice(),
      account_types: H.ACCOUNT_TYPES.slice(), asset_classes: H.ASSET_CLASSES.slice(), cat_slots: H.cat_slots(), today: H.today_s(),
      data_start: rng[0], data_end: rng[1], users: H.USERS.slice(),
    };
  }

  // ---------------------------------------------------------------------------------------------- GET /api/search
  function api_search(q) {
    const text = H.pystrip(H.first(q, 'q') || '');
    if (Array.from(text).length < 2) {
      return { q: text, transactions: [], merchants: [], notes: [], orders: [], accounts: [], bills: [] };
    }
    const like = '%' + text + '%';
    const [w, args] = H.txn_where({ q: text });
    const tx = H.Q(`SELECT ${H.TXN_COLS} FROM transactions t JOIN accounts a USING(account_id) WHERE ${w.join(' AND ')}
        ORDER BY t.posted_date IS NULL DESC, t.posted_date DESC LIMIT 12`, args);
    const merch = H.Q(`SELECT merchant_of(t.description) AS merchant, COUNT(*) AS n, ROUND(-SUM(t.amount),2) AS total, MAX(t.posted_date) AS last
        FROM transactions t WHERE merchant_of(t.description) LIKE ? AND t.is_transfer=0 GROUP BY 1 ORDER BY n DESC LIMIT 6`, [like]);
    const notes = H.Q('SELECT * FROM notes WHERE body LIKE ? ORDER BY created_at DESC LIMIT 8', [like]);
    for (const n of notes) [n.target_label, n.link] = H.note_target(n.target_type, n.target_id);
    const orders = H.Q(`SELECT DISTINCT o.order_id, o.retailer, o.order_date, o.total, i.title FROM orders o LEFT JOIN order_items i ON i.order_id=o.order_id
        WHERE o.order_id LIKE ? OR i.title LIKE ? ORDER BY o.order_date DESC LIMIT 8`, [like, like]);
    for (const o of orders) o.label = H.order_label(o);
    const accts = H.Q(`SELECT account_id, COALESCE(display_name,name) AS name, type, holder FROM accounts
        WHERE name LIKE ? OR display_name LIKE ? OR last4 LIKE ? LIMIT 6`, [like, like, like]);
    const bills = H.Q('SELECT bill_id, item, amount, due_day FROM bills WHERE active=1 AND item LIKE ? LIMIT 6', [like]);
    const props = H.Q('SELECT id, name, status FROM properties WHERE name LIKE ? OR address LIKE ? OR tenant LIKE ? LIMIT 4', [like, like, like]);
    return { q: text, transactions: tx, merchants: merch, notes, orders, accounts: accts, bills, properties: props };
  }

  // ---------------------------------------------------------------------------------------------- GET /api/categories
  function api_categories(q) {
    const cats = H.Q(`SELECT COALESCE(category,'Uncategorized') AS category, COUNT(*) AS n, ROUND(SUM(amount),2) AS total,
        MAX(posted_date) AS last FROM transactions GROUP BY 1 ORDER BY 1`);
    const subs = H.Q(`SELECT COALESCE(category,'Uncategorized') AS category, COALESCE(subcategory,'') AS subcategory, COUNT(*) AS n,
        ROUND(SUM(amount),2) AS total FROM transactions GROUP BY 1,2 ORDER BY 1,2`);
    for (const c of cats) c.subcategories = subs.filter((s) => s.category === c.category);
    const budgets = new Map();
    for (const r of H.Q('SELECT * FROM budget')) budgets.set(r.category, r.monthly_amount);
    for (const c of cats) c.budget = budgets.has(c.category) ? nn(budgets.get(c.category)) : null;
    return { categories: cats, slots: H.cat_slots() };
  }

  // ---------------------------------------------------------------------------------------------- rules
  // Python re.error equivalent (str(e) is "<msg> at position <n>", like CPython's re._parser for the common cases).
  class ReError extends Error {
    constructor(msg, pos) {
      super(pos === null || pos === undefined ? msg : `${msg} at position ${pos}`);
      this.name = 're.error';
    }
  }
  H.ReError = ReError;

  // Mirror the errors CPython's re parser raises for the usual mistakes, with the same messages and positions.
  const CLASS_ESC_OK = new Set(['a', 'b', 'f', 'n', 'r', 't', 'v', 'x', 'u', 'U', 'N', 'd', 'D', 's', 'S', 'w', 'W']);
  const ESC_OK = new Set(['a', 'f', 'n', 'r', 't', 'v', 'x', 'u', 'U', 'N', 'd', 'D', 's', 'S', 'w', 'W', 'A', 'Z', 'b', 'B']);
  const ASCII_LETTER = /^[A-Za-z]$/;
  function py_re_check(pattern) {
    const s = Array.from(pattern);
    const n = s.length;
    let i = 0;
    const stack = [];           // open groups: {start, last}
    let last = 'none';          // none | at | repeat | item
    const tok = () => {         // next token (escape = 2 code points)
      if (i >= n) return null;
      if (s[i] === '\\') {
        if (i + 1 >= n) throw new ReError('bad escape (end of pattern)', n - 1);
        return s[i] + s[i + 1];
      }
      return s[i];
    };
    while (i < n) {
      const t = tok();
      const start = i;
      i += t.length === 2 && t[0] === '\\' ? 2 : 1;
      if (t[0] === '\\' && t.length === 2) {
        const c = t[1];
        if (ASCII_LETTER.test(c) && !ESC_OK.has(c)) throw new ReError(`bad escape ${t}`, start);
        if (c === 'x') i += Math.min(2, n - i);
        else if (c === 'u') i += Math.min(4, n - i);
        else if (c === 'U') i += Math.min(8, n - i);
        last = 'AZbB'.includes(c) ? 'at' : 'item';
        continue;
      }
      if (t === '|') { last = 'none'; continue; }
      if (t === ')') {
        if (!stack.length) throw new ReError('unbalanced parenthesis', start);
        stack.pop();
        last = 'item';
        continue;
      }
      if (t === '(') {
        if (s[i] === '?') {
          if (s[i + 1] === '#') {   // comment
            let j = i + 2;
            while (j < n && s[j] !== ')') j++;
            if (j >= n) throw new ReError('missing ), unterminated comment', start);
            i = j + 1;
            continue;
          }
          const fl = /^\?[aiLmsux]+\)/.exec(s.slice(i, i + 12).join(''));
          if (fl) { i += Array.from(fl[0]).length; continue; }   // global flags: nothing to repeat after them
          const rest = s.slice(i, i + 200).join('');
          const named_ref = /^\?P=[^)]*\)/.exec(rest);
          if (named_ref) { i += Array.from(named_ref[0]).length; last = 'item'; continue; }
          const ext = /^\?(?:[:=!>]|<[=!]|P?<[^>]*>|[aiLmsux]*-?[imsx]*:|\([^)]*\))/.exec(rest);
          if (ext) i += Array.from(ext[0]).length;
        }
        stack.push({ start, last });
        last = 'none';
        continue;
      }
      if (t === '[') {
        let j = i, first = true;
        if (s[j] === '^') j++;
        const get = () => {
          if (j >= n) return null;
          if (s[j] === '\\') {
            if (j + 1 >= n) throw new ReError('bad escape (end of pattern)', n - 1);
            const e = s[j] + s[j + 1];
            j += 2;
            const c = e[1];
            if (ASCII_LETTER.test(c) && !CLASS_ESC_OK.has(c)) throw new ReError(`bad escape ${e}`, j - 2);
            if (c === '8' || c === '9') throw new ReError(`bad escape ${e}`, j - 2);
            if (c === 'x') j += Math.min(2, n - j);
            else if (c === 'u') j += Math.min(4, n - j);
            else if (c === 'U') j += Math.min(8, n - j);
            return e;
          }
          return s[j++];
        };
        const isCat = (e) => e.length === 2 && e[0] === '\\' && 'dDsSwW'.includes(e[1]);
        const lit = (e) => (e.length === 2 && e[0] === '\\' ? e[1] : e);
        for (;;) {
          const thisPos = j;
          const a = get();
          if (a === null) throw new ReError('unterminated character set', start);
          if (a === ']' && !first) break;
          first = false;
          if (s[j] === '-') {
            j++;
            const b = get();
            if (b === null) throw new ReError('unterminated character set', start);
            if (b === ']') break;
            const simpleEsc = (e) => e.length === 2 && e[0] === '\\' && !ASCII_LETTER.test(e[1]) && !/[0-9]/.test(e[1]);
            if (isCat(a) || isCat(b)) throw new ReError(`bad character range ${a}-${b}`, thisPos);
            if ((a.length === 1 || simpleEsc(a)) && (b.length === 1 || simpleEsc(b)) &&
                lit(b).codePointAt(0) < lit(a).codePointAt(0)) {
              throw new ReError(`bad character range ${a}-${b}`, thisPos);
            }
          }
        }
        i = j;
        last = 'item';
        continue;
      }
      if (t === '^' || t === '$') { last = 'at'; continue; }
      if (t === '*' || t === '+' || t === '?' || t === '{') {
        if (t === '{') {
          if (s[i] === '}') { last = 'item'; continue; }
          let j = i, lo = '', hi = '';
          while (j < n && /[0-9]/.test(s[j])) lo += s[j++];
          let comma = false;
          if (s[j] === ',') { comma = true; j++; while (j < n && /[0-9]/.test(s[j])) hi += s[j++]; } else hi = lo;
          if (s[j] !== '}') { last = 'item'; continue; }   // literal '{'
          j++;
          if (hi && lo && Number(hi) < Number(lo)) throw new ReError('min repeat greater than max repeat', i);
          void comma;
          i = j;
        }
        if (last === 'none' || last === 'at') throw new ReError('nothing to repeat', start);
        if (last === 'repeat') throw new ReError('multiple repeat', start);
        if (s[i] === '?' || s[i] === '+') i++;
        last = 'repeat';
        continue;
      }
      last = 'item';
    }
    if (stack.length) throw new ReError('missing ), unterminated subpattern', stack[stack.length - 1].start);
  }
  H.py_re_check = py_re_check;

  function rule_regex(pattern) {
    const p = H.pystrip(pattern);
    if (p.startsWith('re:')) {
      if (Array.from(p).length > 300) throw new ReError('too long');
      const src = p.slice(3);
      py_re_check(src);
      try {
        return H.pyre(src, 'i');
      } catch (e) {
        throw new ReError(e.message);
      }
    }
    return new RegExp(H.re_escape(p), 'iu');
  }

  function rule_field_value(field, t) {
    if (field === 'merchant') return t.merchant || H.merchant_of(t.description);
    if (field === 'memo') return t.memo;
    if (field === 'account') return t.account_id;
    return t.description;
  }

  const isReError = (e) => e instanceof ReError;

  function rule_match_count(r) {
    let rx;
    try {
      rx = rule_regex(r.pattern);
    } catch (e) {
      if (isReError(e)) return null;
      throw e;
    }
    let n = 0;
    for (const t of H.Q('SELECT t.description, t.merchant, t.memo, t.account_id FROM transactions t')) {
      rx.lastIndex = 0;
      if (rx.test(rule_field_value(nn(r.field), t) || '')) n += 1;
    }
    return n;
  }

  function api_rules(q) {
    const rs = H.Q('SELECT * FROM category_rules ORDER BY priority, rule_id');
    for (const r of rs) r.matches = rule_match_count(r);
    return { rules: rs, fields: ['description', 'merchant', 'memo', 'account'] };
  }

  // ---------------------------------------------------------------------------------------------- GET /api/health
  function api_health(q) {
    const accts = H.Q(`SELECT a.account_id, COALESCE(a.display_name,a.name) AS name, a.type, a.holder, a.status, a.institution_id,
        (SELECT MAX(as_of) FROM balances b WHERE b.account_id=a.account_id) AS last_balance,
        (SELECT COUNT(*) FROM balances b WHERE b.account_id=a.account_id) AS balance_rows,
        (SELECT MIN(posted_date) FROM transactions t WHERE t.account_id=a.account_id) AS first_txn,
        (SELECT MAX(posted_date) FROM transactions t WHERE t.account_id=a.account_id) AS last_txn,
        (SELECT COUNT(*) FROM transactions t WHERE t.account_id=a.account_id) AS txns,
        (SELECT COUNT(*) FROM transactions t WHERE t.account_id=a.account_id AND t.pending=1) AS pending,
        (SELECT GROUP_CONCAT(DISTINCT source) FROM transactions t WHERE t.account_id=a.account_id) AS sources
        FROM accounts a ORDER BY a.institution_id, a.type, a.name`);
    const td = H.today();
    const cutoff = H.add_days(td, -2);
    for (const a of accts) {
      a.fresh = !a.last_balance ? 'never' : (a.last_balance < cutoff ? 'stale' : 'ok');
      a.days_since = a.last_balance ? H.days_between(H.fromiso(Array.from(a.last_balance).slice(0, 10).join('')), td) : null;
    }
    const tables = [];
    for (const [nm] of H.rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")) {
      tables.push({ table: nm, rows: H.one(`SELECT COUNT(*) FROM "${nm}"`) });
    }
    const imports = H.Q('SELECT * FROM imports ORDER BY imported_at DESC LIMIT 100');
    const thr = H.setting('large_txn_threshold', '1000');
    // app.py reports the SQLite file path and size; online the data lives in Supabase and is mirrored in memory.
    const db = DB();
    const db_path = db && db.backend === 'supabase' ? 'Supabase (finance schema), cached in this browser' : 'local SQLite snapshot';
    const db_size = H.one('SELECT (SELECT page_count FROM pragma_page_count()) * (SELECT page_size FROM pragma_page_size())');
    const stats = {
      transactions: H.one('SELECT COUNT(*) FROM transactions'),
      uncategorized: H.one("SELECT COUNT(*) FROM transactions WHERE (category IS NULL OR category IN ('','Uncategorized')) AND is_transfer=0"),
      manual_edits: H.one("SELECT COUNT(*) FROM transactions WHERE tags LIKE '%manual%'"),
      pending: H.one('SELECT COUNT(*) FROM transactions WHERE pending=1'),
      first: H.one('SELECT MIN(posted_date) FROM transactions'), last: H.one('SELECT MAX(posted_date) FROM transactions'),
      by_source: H.Q('SELECT source, COUNT(*) AS n, MIN(posted_date) AS first, MAX(posted_date) AS last FROM transactions GROUP BY 1'),
      sheet_months: H.rows('SELECT DISTINCT month FROM budget_lines ORDER BY 1').map((r) => r[0]),
      db_path, db_size,
      large_txn_threshold: H.pybool(thr) ? H.pyfloat(String(thr)) : 1000,
      new_sheet_loans: H.rows('SELECT DISTINCT loan FROM loan_balances')
        .filter((r) => !H.row('SELECT 1 FROM manual_accounts WHERE sheet_loan=?', [r[0]])).length,
    };
    return { accounts: accts, tables, imports, stats, today: H.today_s() };
  }

  // ---------------------------------------------------------------------------------------------- GET /api/manual
  function api_manual(q) {
    const man = H.manual_accounts();
    for (const m of man) {
      m.entries = H.Q('SELECT * FROM manual_account_balances WHERE manual_account_id=? ORDER BY as_of DESC', [m.id]);
      m.points = H.manual_points(m).map(([d, v, s]) => ({ date: d, balance: v, source: s }));
    }
    const txns = H.Q(`SELECT ${H.TXN_COLS} FROM transactions t JOIN accounts a USING(account_id) WHERE t.source='manual' ORDER BY t.posted_date DESC LIMIT 300`);
    return {
      manual_accounts: man, manual_transactions: txns,
      accounts: H.Q('SELECT account_id, COALESCE(display_name,name) AS name, type FROM accounts ORDER BY type, name'),
    };
  }

  // ---------------------------------------------------------------------------------------------- writes
  // json.loads for settings values; throws like ValueError on bad JSON
  const jloads = (s) => JSON.parse(s);

  async function post_category_rename(b) {
    b = b || {};
    const frm = H.v_str(b.from, 'from', true, 120);
    const to = H.v_str(b.to, 'to', true, 120);
    const sub = nn(b.subcategory);
    let n;
    if (sub !== null) {
      const sub_from = H.v_str(sub, 'subcategory', false, 120);
      const to_cat = H.v_str(b.to_category, 'to_category', false, 120) || frm;
      const match = { category: frm, subcategory: sub_from };
      const patch = { category: to_cat, subcategory: to };
      n = (await DB().update('transactions', match, patch)).length;
      await DB().update('category_rules', match, patch);
      await DB().update('order_items', match, patch);
    } else {
      n = (await DB().update('transactions', { category: frm }, { category: to })).length;
      await DB().update('category_rules', { category: frm }, { category: to });
      await DB().update('order_items', { category: frm }, { category: to });
      await DB().update('bills', { category: frm }, { category: to });
      const old = H.row('SELECT monthly_amount FROM budget WHERE category=?', [frm]);
      if (old) {
        if (!H.row('SELECT 1 FROM budget WHERE category=?', [to])) {
          await DB().insert('budget', { category: to, monthly_amount: old.monthly_amount });
        }
      }
      let slots;
      try {
        slots = jloads(H.setting('cat_slots', '{}') || '{}');
      } catch (e) {
        throw new Error(`JSONDecodeError: ${e.message}`);
      }
      if (has(slots, frm) && !has(slots, to)) {
        const v = slots[frm];
        delete slots[frm];
        slots[to] = v;
        await H.set_setting('cat_slots', H.pyjson(slots));
      }
    }
    // remember the rename so scripts/categorize.py maps its built-in names onto the new ones
    let aliases;
    try {
      aliases = jloads(H.setting('category_aliases', '{}') || '{}');
    } catch (e) {
      aliases = {};
    }
    if (sub === null) {
      for (const k of Object.keys(aliases)) {
        const v = aliases[k];
        if (v[0] === frm) aliases[k] = [to, v[1]];
      }
      aliases[frm] = [to, null];
    } else {
      aliases[`${frm}|${H.pybool(sub) ? H.pystr(sub) : ''}`] = [H.pybool(b.to_category) ? b.to_category : frm, to];
    }
    await H.set_setting('category_aliases', H.pyjson(aliases));
    return { ok: true, updated: n };
  }

  async function post_rule(b) {
    b = b || {};
    const pat = H.v_str(b.pattern, 'pattern', true, 300);
    try {
      rule_regex(pat);
    } catch (e) {
      if (isReError(e)) throw new H.ApiError(400, `Pattern is not valid: ${e.message}`);
      throw e;
    }
    const vals = {
      pattern: pat,
      field: H.v_str(b.field, 'field', false, 500, ['description', 'merchant', 'memo', 'account']) || 'description',
      category: H.v_str(b.category, 'category', true, 120),
      subcategory: H.v_str(b.subcategory, 'subcategory', false, 120),
      entity: H.v_str(b.entity, 'entity', false, 120),
      tags: H.v_str(b.tags, 'tags', false, 200),
      priority: H.v_int(b.priority, 'priority') || 100,
      active: b.active === false || b.active === 0 || b.active === '0' ? 0 : 1,
    };
    let rid = H.v_int(b.rule_id, 'rule_id');
    if (rid) {
      await DB().update('category_rules', { rule_id: rid }, vals);
    } else {
      const rows = await DB().insert('category_rules', Object.assign({}, vals, { created_by: nn(DB().user), created_at: H.now_s() }));
      rid = rows.length ? rows[0].rule_id : null;
    }
    const out = { ok: true, rule_id: rid };
    if (H.pybool(b.apply)) Object.assign(out, await apply_db_rules(false));
    return out;
  }

  async function del_rule(q) {
    await DB().remove('category_rules', { rule_id: H.v_int(H.first(q, 'id'), 'id', true) });
    return { ok: true };
  }

  // Apply category_rules (lowest priority number first, first match wins) to rows not edited by hand.
  async function apply_db_rules(preview = false) {
    const rules = [];
    for (const r of H.Q('SELECT * FROM category_rules WHERE COALESCE(active,1)=1 ORDER BY priority, rule_id')) {
      try {
        rules.push([rule_regex(r.pattern), r]);
      } catch (e) {
        if (isReError(e)) continue;
        throw e;
      }
    }
    let changed = 0;
    const examples = [];
    const groups = new Map();  // identical patches are written together (one request per distinct patch)
    for (const t of H.Q(`SELECT t.txn_id, t.description, t.merchant, t.memo, t.account_id, t.category, t.subcategory, t.entity, t.tags
            FROM transactions t JOIN accounts a USING(account_id) WHERE COALESCE(t.tags,'') NOT LIKE '%manual%'
            AND a.type NOT IN ('ira','hsa','401k','403b','brokerage')`)) {
      for (const [rx, r] of rules) {
        rx.lastIndex = 0;
        if (rx.test(rule_field_value(r.field, t) || '')) {
          const nw = [r.category, r.subcategory, r.entity || t.entity];
          if (nw[0] !== t.category || nw[1] !== t.subcategory || nw[2] !== t.entity) {
            changed += 1;
            if (examples.length < 5) examples.push({ description: t.description, from_: t.category, to: r.category });
            if (!preview) {
              let tags = t.tags;
              for (const tg of (r.tags || '').split(',')) {
                if (H.pystrip(tg)) tags = H.add_tag(tags, H.pystrip(tg));
              }
              const patch = { category: nw[0], subcategory: nw[1], entity: nw[2], tags,
                is_transfer: nw[0] === 'Transfer' || nw[0] === 'Investments' ? 1 : 0 };
              const key = JSON.stringify([patch.category, patch.subcategory, patch.entity, patch.tags, patch.is_transfer]);
              if (!groups.has(key)) groups.set(key, { patch, ids: [] });
              groups.get(key).ids.push(t.txn_id);
            }
          }
          break;
        }
      }
    }
    if (!preview) {
      for (const { patch, ids } of groups.values()) {
        for (let i = 0; i < ids.length; i += 200) await DB().update('transactions', { txn_id: ids.slice(i, i + 200) }, patch);
      }
    }
    return { changed, examples, rules: rules.length };
  }

  async function post_rules_apply(b) {
    b = b || {};
    return Object.assign({ ok: true }, await apply_db_rules(H.pybool(b.preview)));
  }

  async function post_settings(b) {
    b = b || {};
    if (has(b, 'large_txn_threshold')) {
      const x = H.v_num(b.large_txn_threshold, 'large_txn_threshold', false, 1, 1e7);
      await H.set_setting('large_txn_threshold', x === null ? 'None' : H.pyfloat_str(x));
    }
    if (H.pybool(b.reset_category_colors)) await H.set_setting('cat_slots', '');
    return { ok: true };
  }

  // Create a manual debt account for each loan in loan_balances that isn't already tracked. Returns count created.
  async function seed_sheet_loans() {
    const have = new Set(H.rows('SELECT sheet_loan FROM manual_accounts WHERE sheet_loan IS NOT NULL').map((r) => r[0]));
    const linked_ents = H.rows("SELECT entity FROM accounts WHERE type IN ('mortgage','loan','heloc') AND entity IS NOT NULL").map((r) => r[0]);
    const maxm = H.one('SELECT MAX(month) FROM loan_balances');
    let n = 0;
    for (const r of H.Q('SELECT loan, MAX(month) AS last, MAX(rate) AS rate FROM loan_balances GROUP BY loan')) {
      const loan = r.loan;
      if (have.has(loan) || linked_ents.some((e) => e && String(loan).includes(e))) continue;
      const low = String(loan).toLowerCase();
      let ent = H.rows('SELECT entity FROM properties WHERE entity IS NOT NULL').map((x) => x[0]).find((e) => String(loan).includes(String(e).split(' ')[0])) || null;
      if (ent === null && (low.includes('cooper') || low.includes('pool'))) ent = 'primary home';
      const typ = low.includes('mortgage') ? 'mortgage' : (low.includes('honda') || low.includes('auto')) ? 'auto_loan' : 'loan';
      const holder = low.endsWith('- roque') ? 'Roque' : low.endsWith('- jennifer') ? 'Jennifer' : 'Joint';
      const lastbal = H.one('SELECT balance FROM loan_balances WHERE loan=? AND month=?', [loan, r.last]) || 0;
      const is_open = r.last === maxm && lastbal > 0;
      await DB().insert('manual_accounts', {
        name: loan, kind: 'debt', type: typ, holder, entity: ent || 'household', include_in_totals: is_open ? 1 : 0,
        status: is_open ? 'open' : 'closed', sheet_loan: loan, rate: nn(r.rate), notes: "Balances come from Jenny's monthly sheet",
        created_by: 'sheet',
      });
      n += 1;
    }
    return n;
  }

  async function post_import_sheet_loans(b) {
    const n = await seed_sheet_loans();
    return { ok: true, created: n };
  }

  // ---------------------------------------------------------------------------------------------- registration
  Object.assign(H, {
    api_meta, api_search, api_categories, api_rules, rule_match_count, rule_regex, rule_field_value, api_health, api_manual,
    post_category_rename, post_rule, del_rule, apply_db_rules, post_rules_apply, post_settings, seed_sheet_loans,
    post_import_sheet_loans,
  });
  API.get['/api/meta'] = api_meta;
  API.get['/api/search'] = api_search;
  API.get['/api/categories'] = api_categories;
  API.get['/api/rules'] = api_rules;
  API.get['/api/health'] = api_health;
  API.get['/api/manual'] = api_manual;
  API.post['/api/category/rename'] = post_category_rename;
  API.post['/api/rule'] = post_rule;
  API.post['/api/rules/apply'] = post_rules_apply;
  API.post['/api/settings'] = post_settings;
  API.post['/api/import_sheet_loans'] = post_import_sheet_loans;
  API.del['/api/rule'] = del_rule;
  if (typeof module !== 'undefined' && module.exports) module.exports = H;
})(typeof globalThis !== 'undefined' ? globalThis : this);
