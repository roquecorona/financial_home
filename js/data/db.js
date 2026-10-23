/* Financial Home — data layer (DB contract, see ARCHITECTURE.md).
   An in-memory sql.js SQLite database with the same schema as finances.db. Reads are synchronous SQL (DB.Q/one/row).
   Backends:
     'supabase' (browser): the first visit downloads every finance table once (paged by primary key, only the columns
                           the app keeps) into sql.js and caches it in IndexedDB per user and project. After that a refresh
                           asks the server which tables changed (changed_tables RPC, one call) and downloads only rows
                           written since the last refresh (_changed_at, index-backed) plus deletions (_deleted tombstones).
                           Writes go to Supabase first, then the returned rows are mirrored into sql.js.
     'local'    (Node tests, ?local=1 dev mode): opens a SQLite file with sql.js. Writes are local only.
   Classic script: no bundler, loads in the browser and in Node. */
'use strict';
(function (g) {
  const PAGE = 1000;
  const CONCURRENCY = 6;
  const IDB_NAME = 'financial-home';
  const IDB_STORE = 'datasets';
  const CACHE_VERSION = 2;
  const OVERLAP_MS = 5 * 60000;   // re-read the last 5 minutes on every refresh (commit-order safety; applying twice is harmless)

  const DB = g.DB = g.DB || {};
  Object.assign(DB, {
    backend: null,        // 'supabase' | 'local'
    ready: false,
    user: null,           // display name of the signed-in member
    email: null,
    loadedAt: null,       // ISO time the dataset was downloaded (or read from cache)
    fromCache: false,
    refreshing: false,
    _db: null,
    _SQL: null,
    _client: null,
    _cols: {},            // table -> [column names]
    _pk: {},              // table -> [primary key columns]
    _writeGen: 0,
    _listeners: new Set(),
  });

  /* ------------------------------------------------------------------ utilities */
  const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node) && typeof window === 'undefined';
  const qi = (name) => '"' + String(name).replace(/"/g, '""') + '"';
  const arr = (x) => (Array.isArray(x) ? x : [x]);
  function pad(n) { return String(n).padStart(2, '0'); }

  DB.today = () => {
    if (g.FIN_TODAY) return String(g.FIN_TODAY).slice(0, 10);
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  function apiError(code, msg) {
    const E = g.H && g.H.ApiError;
    if (E) return new E(code, msg);
    const e = new Error(msg); e.code = code; e.msg = msg; return e;
  }

  // Values as Python's sqlite3 would bind them: bool -> 0/1, undefined -> NULL, objects -> JSON text.
  function bindVal(v) {
    if (v === undefined || v === null) return null;
    if (v === true) return 1;
    if (v === false) return 0;
    if (typeof v === 'bigint') return Number(v);
    if (v instanceof Uint8Array) return v;
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  }
  function cleanRow(table, row) {
    const cols = DB._cols[table];
    const out = {};
    for (const [k, v] of Object.entries(row || {})) {
      if (v === undefined) continue;
      if (cols && !cols.includes(k)) continue;
      out[k] = bindVal(v);
    }
    return out;
  }
  function need() {
    if (!DB._db) throw apiError(503, 'The data is still loading. Try again in a moment.');
    return DB._db;
  }

  /* ------------------------------------------------------------------ reads (synchronous) */
  function run(sql, args, each) {
    const st = need().prepare(sql);
    try {
      const a = (args || []).map(bindVal);
      if (a.length) st.bind(a);
      while (st.step()) { if (each(st) === false) break; }
    } finally { st.free(); }
  }
  DB.Q = (sql, args = []) => {
    const out = [];
    run(sql, args, (st) => {
      const names = st.getColumnNames(), vals = st.get();
      const o = {};
      for (let i = 0; i < names.length; i++) if (!(names[i] in o)) o[names[i]] = vals[i]; // first wins, like dict(sqlite3.Row)
      out.push(o);
    });
    return out;
  };
  DB.row = (sql, args = []) => {
    let r = null;
    run(sql, args, (st) => {
      const names = st.getColumnNames(), vals = st.get();
      r = {};
      for (let i = 0; i < names.length; i++) if (!(names[i] in r)) r[names[i]] = vals[i];
      return false;
    });
    return r;
  };
  DB.one = (sql, args = []) => {
    let v = null;
    run(sql, args, (st) => { v = st.get()[0]; if (v === undefined) v = null; return false; });
    return v;
  };
  DB.tables = () => (g.SQLITE_TABLES || []).slice();
  DB.columns = (table) => (DB._cols[table] || []).slice();
  DB.primaryKey = (table) => (DB._pk[table] || []).slice();

  /* ------------------------------------------------------------------ sql.js setup */
  async function sqljs(opts) {
    if (DB._SQL) return DB._SQL;
    let init = opts.initSqlJs || g.initSqlJs;
    if (!init && isNode) {
      try { init = require('sql.js'); } catch (e) { /* caller must provide initSqlJs */ }
    }
    if (!init) throw new Error('sql.js is not loaded (vendor/sql-wasm.js).');
    const cfg = {};
    if (opts.locateFile) cfg.locateFile = opts.locateFile;
    else if (!isNode) cfg.locateFile = (f) => (opts.vendorBase || 'vendor/') + f;
    DB._SQL = await init(cfg);
    return DB._SQL;
  }

  function registerFunctions(db) {
    // merchant_of is ported in js/api/helpers.js (H.merchant_of); resolve it lazily at call time.
    db.create_function('merchant_of', (desc) => {
      const f = g.H && g.H.merchant_of;
      if (typeof f !== 'function') throw new Error('H.merchant_of is not loaded');
      const v = f(desc);
      return v === undefined ? null : v;
    });
  }

  function introspect(db) {
    DB._cols = {}; DB._pk = {};
    const res = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    const names = res.length ? res[0].values.map((r) => r[0]) : [];
    for (const t of names) {
      const info = db.exec(`PRAGMA table_info(${qi(t)})`);
      const rows = info.length ? info[0].values : [];
      DB._cols[t] = rows.map((r) => r[1]);
      DB._pk[t] = rows.filter((r) => r[5] > 0).sort((a, b) => a[5] - b[5]).map((r) => r[1]);
    }
  }

  function adopt(db) {
    if (DB._db && DB._db !== db) { try { DB._db.close(); } catch (e) { /* ignore */ } }
    registerFunctions(db);
    DB._db = db;
    introspect(db);
  }

  function emptyDb(SQL) {
    const db = new SQL.Database();
    db.exec(g.SQLITE_SCHEMA);
    return db;
  }

  // A local file older than SQLITE_SCHEMA (e.g. the test snapshot) gets the tables and columns added since, empty.
  function ensureSchema(db) {
    const ref = emptyDb(DB._SQL);
    try {
      const names = (d) => { const r = d.exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"); return r.length ? r[0].values : []; };
      const have = new Map(names(db));
      for (const [t, sql] of names(ref)) {
        if (!have.has(t)) { db.exec(sql); continue; }
        const cols = (d) => { const r = d.exec(`PRAGMA table_info(${qi(t)})`); return r.length ? r[0].values : []; };
        const got = new Set(cols(db).map((c) => c[1]));
        for (const c of cols(ref)) if (!got.has(c[1])) db.exec(`ALTER TABLE ${qi(t)} ADD COLUMN ${qi(c[1])} ${c[2] || ''}`);
      }
    } finally { ref.close(); }
    return db;
  }

  /* ------------------------------------------------------------------ IndexedDB cache (per user email) */
  function idb() {
    return new Promise((resolve, reject) => {
      if (!g.indexedDB) return reject(new Error('no IndexedDB'));
      const req = g.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbDo(mode, fn) {
    const d = await idb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = d.transaction(IDB_STORE, mode);
        const req = fn(tx.objectStore(IDB_STORE));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { d.close(); }
  }
  const project = () => String((g.SUPABASE_CONFIG && g.SUPABASE_CONFIG.url) || '').replace(/^https?:\/\//, '').split('.')[0];
  const cacheKey = (email) => 'v' + CACHE_VERSION + ':' + project() + ':' + String(email || '').toLowerCase();
  async function cacheGet(email) {
    try { return await idbDo('readonly', (s) => s.get(cacheKey(email))); } catch (e) { return null; }
  }
  async function cachePut(email) {
    if (!email || !DB._db) return;
    try {
      const bytes = DB._db.export(); // note: export() resets prepared statements; none are kept open
      registerFunctions(DB._db);
      await idbDo('readwrite', (s) => s.put({ bytes, savedAt: new Date().toISOString(), schema: g.SQLITE_SCHEMA.length,
        cursors: DB._cursors || {}, serverCols: DB._serverCols || null }, cacheKey(email)));
    } catch (e) { console.warn('[DB] cache save failed', e); }
  }
  DB.clearCache = async (email) => {
    try {
      if (email) await idbDo('readwrite', (s) => s.delete(cacheKey(email)));
      else await idbDo('readwrite', (s) => s.clear());
    } catch (e) { /* ignore */ }
  };

  /* ------------------------------------------------------------------ Supabase download */
  function sb() {
    if (!DB._client) throw apiError(401, 'Please sign in');
    return DB._client.schema((g.SUPABASE_CONFIG && g.SUPABASE_CONFIG.schema) || 'public');
  }
  function sbErr(error, what) {
    const status = error && (error.status || error.statusCode);
    if (status === 401 || /JWT|jwt expired/i.test((error && error.message) || '')) return apiError(401, 'Please sign in');
    if ((error && error.code) === '42501' || status === 403) return apiError(403, `Not allowed to ${what}. Is this account on the household allow-list?`);
    const m = (error && error.message) || '';
    const net = !m || /fetch|network|load failed|timeout|abort/i.test(m);
    // Writes say plainly that nothing changed; table names stay out of the message.
    if (/^(save|update|delete)/.test(what)) {
      return apiError(502, net ? 'Couldn’t reach the server, so nothing was saved. Check the connection and try again.'
        : `The server didn’t accept the change, so nothing was saved (${m}).`);
    }
    return apiError(502, net ? 'Couldn’t reach the server to load the data.' : `Couldn’t load the data (${m}).`);
  }

  // Run async jobs with limited concurrency.
  async function pool(jobs, n) {
    const results = new Array(jobs.length);
    let i = 0;
    async function worker() { while (i < jobs.length) { const k = i++; results[k] = await jobs[k](); } }
    await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker));
    return results;
  }

  // Columns to download for a table: the ones sql.js keeps that the server has, plus _changed_at (the refresh cursor).
  async function serverCols() {
    if (DB._serverCols) return DB._serverCols;
    const { data, error } = await sb().rpc('table_columns');
    if (error) throw sbErr(error, 'load the table list');
    DB._serverCols = data || {};
    return DB._serverCols;
  }
  function selectList(table) {
    const have = new Set((DB._serverCols || {})[table] || []);
    const cols = (DB._cols[table] || []).filter((c) => have.has(c));
    if (have.has('_changed_at')) cols.push('_changed_at');
    return cols.map((c) => `"${c}"`).join(',');
  }
  const latest = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));
  const minus = (iso, ms) => new Date(new Date(iso).getTime() - ms).toISOString();

  // All rows of a table, paged by primary key (no exact counts: stop at a short page).
  async function fetchTable(table, onPage) {
    const order = colsPK(table), cols = selectList(table);
    const rows = []; let top = null;
    for (let from = 0; ; from += PAGE) {
      let q = sb().from(table).select(cols);
      for (const c of order) q = q.order(c, { ascending: true });
      const res = await q.range(from, from + PAGE - 1);
      if (res.error) throw sbErr(res.error, `load ${table}`);
      const page = res.data || [];
      for (const r of page) { top = latest(top, r._changed_at || null); rows.push(r); }
      if (onPage) onPage(page.length);
      if (page.length < PAGE) break;
    }
    return { rows, top };
  }
  // Rows of a table written after `since` (oldest first), paged.
  async function fetchChanged(table, since) {
    const cols = selectList(table), pk = colsPK(table);
    const rows = []; let top = null;
    for (let from = 0; ; from += PAGE) {
      let q = sb().from(table).select(cols).gt('_changed_at', since).order('_changed_at', { ascending: true });
      for (const c of pk) q = q.order(c, { ascending: true });
      const res = await q.range(from, from + PAGE - 1);
      if (res.error) throw sbErr(res.error, `load ${table}`);
      const page = res.data || [];
      for (const r of page) { top = latest(top, r._changed_at || null); rows.push(r); }
      if (page.length < PAGE) break;
    }
    return { rows, top };
  }
  async function fetchDeleted(since) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      const res = await sb().from('_deleted').select('id,tbl,pk,deleted_at').gt('deleted_at', since)
        .order('deleted_at', { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1);
      if (res.error) throw sbErr(res.error, 'load deletions');
      out.push(...(res.data || []));
      if ((res.data || []).length < PAGE) break;
    }
    return out;
  }

  // First visit: every table once. Cursors start at the server's clock taken before the download (minus the overlap).
  async function downloadAll(onProgress) {
    const SQL = DB._SQL;
    const db = emptyDb(SQL);
    const tables = DB.tables();
    const state = { tablesDone: 0, tablesTotal: tables.length, rows: 0, table: null };
    const report = (extra) => { if (onProgress) try { onProgress({ ...state, ...extra }); } catch (e) { /* ignore */ } };
    report({ phase: 'start' });
    await serverCols();
    const ch = await sb().rpc('changed_tables', { p_since: null });
    if (ch.error) throw sbErr(ch.error, 'check for changes');
    const start = (ch.data && ch.data.now) || new Date().toISOString();
    const got = {};
    await pool(tables.map((t) => async () => {
      got[t] = await fetchTable(t, (n) => { state.rows += n; report({ table: t, phase: 'page' }); });
      state.tablesDone++; report({ table: t, phase: 'table' });
    }), CONCURRENCY);
    db.exec('BEGIN');
    try {
      for (const t of tables) insertRows(db, t, got[t].rows, 'INSERT');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    const cursors = { _deleted: start };
    for (const t of tables) cursors[t] = latest(got[t].top, start);
    report({ phase: 'done' });
    return { db, cursors };
  }

  // Later visits: only what changed since the cursors, applied in time order (a delete then a re-insert stays inserted).
  async function applyChanges() {
    const cur = DB._cursors || {};
    const tables = DB.tables();
    const floor = tables.reduce((a, t) => (cur[t] && (!a || cur[t] < a) ? cur[t] : a), cur._deleted || null);
    if (!floor) return null; // no cursors (old cache): caller does a full download
    await serverCols();
    const ch = await sb().rpc('changed_tables', { p_since: minus(floor, OVERLAP_MS) });
    if (ch.error) throw sbErr(ch.error, 'check for changes');
    const changed = (ch.data && ch.data.tables) || {};
    const todo = tables.filter((t) => changed[t] && (!cur[t] || changed[t] > minus(cur[t], OVERLAP_MS)));
    const events = []; const next = { ...cur };
    await pool(todo.map((t) => async () => {
      const { rows, top } = await fetchChanged(t, minus(cur[t] || floor, OVERLAP_MS));
      for (const r of rows) events.push({ at: r._changed_at || '', kind: 'up', t, r });
      next[t] = latest(cur[t], top);
    }), CONCURRENCY);
    const dels = Object.keys(changed).some((t) => !cur[t] || changed[t] > minus(cur[t], OVERLAP_MS))
      ? await fetchDeleted(minus(cur._deleted || floor, OVERLAP_MS)) : [];
    for (const d of dels) if (DB._cols[d.tbl]) events.push({ at: d.deleted_at, kind: 'del', t: d.tbl, pk: d.pk });
    // Everything stamped before the server's clock at this check has now been seen (each query re-reads OVERLAP_MS
    // before its cursor, so rows committed late with an earlier stamp are still picked up next time).
    const now = (ch.data && ch.data.now) || null;
    if (now) { for (const t of tables) next[t] = latest(next[t], now); next._deleted = latest(next._deleted, now); }
    events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    if (events.length) {
      const db = need();
      db.exec('BEGIN');
      try {
        for (const e of events) {
          if (e.kind === 'up') insertRows(db, e.t, [e.r], 'INSERT OR REPLACE');
          else {
            const w = whereOf(e.pk || {});
            const st = db.prepare(`DELETE FROM ${qi(e.t)} WHERE ${w.sql}`);
            try { st.run(w.args); } finally { st.free(); }
          }
        }
        db.exec('COMMIT');
      } catch (err) { db.exec('ROLLBACK'); throw err; }
    }
    DB._cursors = next;
    return { tables: todo.length, rows: events.length };
  }
  function colsPK(t) { const pk = DB._pk[t]; return pk && pk.length ? pk : (DB._cols[t] || []).slice(0, 1); }

  // Insert plain row objects (from Supabase) into sql.js. Unknown columns are dropped; _rowid sets the SQLite rowid.
  function insertRows(db, table, rows, verb) {
    if (!rows || !rows.length) return;
    const cols = DB._cols[table];
    const useRowid = verb === 'INSERT' && rows[0] && Object.prototype.hasOwnProperty.call(rows[0], '_rowid');
    const present = cols.filter((c) => rows.some((r) => Object.prototype.hasOwnProperty.call(r, c)));
    const names = (useRowid ? ['rowid'] : []).concat(present);
    const sql = `${verb} INTO ${qi(table)} (${names.map(qi).join(',')}) VALUES (${names.map(() => '?').join(',')})`;
    const st = db.prepare(sql);
    try {
      for (const r of rows) {
        const vals = (useRowid ? [r._rowid] : []).concat(present.map((c) => bindVal(r[c])));
        st.run(vals);
      }
    } finally { st.free(); }
  }

  /* ------------------------------------------------------------------ init / refresh */
  DB.onChange = (fn) => { DB._listeners.add(fn); return () => DB._listeners.delete(fn); };
  function emit(kind) { for (const fn of DB._listeners) { try { fn(kind); } catch (e) { console.warn(e); } } }

  /* DB.init(opts)
     local:    { backend:'local', path:'/abs/file.db' } (Node) or { backend:'local', url:'__dev__/snapshot.db' } or { bytes }
     supabase: { backend:'supabase', client, email, onProgress(p), onRefreshed(), useCache=true } */
  DB.init = async (opts = {}) => {
    const backend = opts.backend || 'supabase';
    const SQL = await sqljs(opts);
    DB.backend = backend;
    DB.ready = false;
    if (opts.user !== undefined) DB.user = opts.user;
    if (backend === 'local') {
      let bytes = opts.bytes;
      if (!bytes && opts.path) bytes = require('fs').readFileSync(opts.path);
      if (!bytes && opts.url) {
        const r = await fetch(opts.url, { cache: 'no-store' });
        if (!r.ok) throw new Error(`Could not load ${opts.url} (${r.status})`);
        bytes = new Uint8Array(await r.arrayBuffer());
      }
      adopt(bytes ? ensureSchema(new SQL.Database(new Uint8Array(bytes))) : emptyDb(SQL));
      DB.loadedAt = new Date().toISOString();
      DB.ready = true;
      emit('ready');
      return DB;
    }
    // supabase
    DB._client = opts.client || (g.Auth && g.Auth.client) || null;
    DB.email = opts.email || null;
    DB._onProgress = opts.onProgress || null;
    DB._onRefreshed = opts.onRefreshed || null;
    { const tmp = emptyDb(SQL); introspect(tmp); tmp.close(); } // column/pk metadata for the download
    const cached = opts.useCache === false ? null : await cacheGet(DB.email);
    if (cached && cached.bytes && cached.schema === g.SQLITE_SCHEMA.length && cached.cursors) {
      adopt(new SQL.Database(new Uint8Array(cached.bytes)));
      DB._cursors = cached.cursors;
      DB._serverCols = cached.serverCols || null;
      DB.loadedAt = cached.savedAt;
      DB.fromCache = true;
      DB.ready = true;
      emit('ready');
      // Refresh in the background; the UI re-renders through onRefreshed when fresh data lands.
      setTimeout(() => { DB.refresh({ background: true }).catch((e) => console.warn('[DB] background refresh failed', e)); }, 50);
      return DB;
    }
    const first = await downloadAll(DB._onProgress);
    adopt(first.db);
    DB._cursors = first.cursors;
    DB.loadedAt = new Date().toISOString();
    DB.fromCache = false;
    DB.ready = true;
    emit('ready');
    cachePut(DB.email);
    return DB;
  };

  // Bring the local copy up to date: only rows changed since the last refresh (a full download only when there is no
  // saved copy with cursors, or when { full: true }). Returns true when the data was updated.
  DB.refresh = async ({ background = false, full = false } = {}) => {
    if (DB.backend !== 'supabase') return false;
    if (DB._refreshing) return DB._refreshing;
    DB.refreshing = true; emit('refreshing');
    DB._refreshing = (async () => {
      try {
        let res = full || !DB._db ? null : await applyChanges();
        if (!res) {
          const fresh = await downloadAll(background ? null : DB._onProgress);
          adopt(fresh.db);
          DB._cursors = fresh.cursors;
          res = { full: true };
        }
        DB.loadedAt = new Date().toISOString();
        DB.fromCache = false;
        await cachePut(DB.email);
        emit('refreshed');
        if (DB._onRefreshed && (res.full || res.rows)) { try { DB._onRefreshed(); } catch (e) { console.warn(e); } }
        return true;
      } finally { DB.refreshing = false; DB._refreshing = null; emit('idle'); }
    })();
    return DB._refreshing;
  };

  /* ------------------------------------------------------------------ writes */
  function whereOf(match) {
    const parts = [], args = [];
    for (const [k, v] of Object.entries(match || {})) {
      if (v === undefined) continue;
      if (v === null) parts.push(`${qi(k)} IS NULL`);
      else if (Array.isArray(v)) {
        if (!v.length) { parts.push('0'); continue; }
        parts.push(`${qi(k)} IN (${v.map(() => '?').join(',')})`); args.push(...v.map(bindVal));
      } else { parts.push(`${qi(k)} = ?`); args.push(bindVal(v)); }
    }
    if (!parts.length) throw apiError(400, 'Refusing to write without a filter');
    return { sql: parts.join(' AND '), args };
  }
  function sbFilter(q, match) {
    for (const [k, v] of Object.entries(match || {})) {
      if (v === undefined) continue;
      if (v === null) q = q.is(k, null);
      else if (Array.isArray(v)) q = q.in(k, v.map(bindVal));
      else q = q.eq(k, bindVal(v));
    }
    return q;
  }
  function localAll(sql, args) {
    const out = [];
    const st = need().prepare(sql);
    try {
      st.bind(args);
      while (st.step()) out.push(st.getAsObject());
    } finally { st.free(); }
    return out;
  }
  // Mirror server rows into sql.js by primary key.
  function mirror(table, rows) {
    if (!rows || !rows.length) return [];
    const clean = rows.map((r) => cleanRow(table, r));
    insertRows(need(), table, clean, 'INSERT OR REPLACE');
    return clean;
  }
  function localInsert(table, rows, conflict) {
    const out = [];
    for (const r of rows) {
      const names = Object.keys(r);
      let sql;
      if (!names.length) sql = `INSERT INTO ${qi(table)} DEFAULT VALUES`;
      else sql = `INSERT INTO ${qi(table)} (${names.map(qi).join(',')}) VALUES (${names.map(() => '?').join(',')})`;
      if (conflict) {
        const upd = names.filter((n) => !conflict.includes(n));
        sql += ` ON CONFLICT(${conflict.map(qi).join(',')}) DO ` + (upd.length ? `UPDATE SET ${upd.map((n) => `${qi(n)}=excluded.${qi(n)}`).join(',')}` : 'NOTHING');
      }
      const got = localAll(sql + ' RETURNING *', names.map((n) => r[n]));
      if (got.length) out.push(...got);
      else if (conflict) { const w = whereOf(Object.fromEntries(conflict.map((c) => [c, r[c]]))); out.push(...localAll(`SELECT * FROM ${qi(table)} WHERE ${w.sql}`, w.args)); }
    }
    return out;
  }
  function checkTable(table) {
    if (!DB._cols[table]) throw apiError(500, `Unknown table ${table}`);
  }

  DB.insert = async (table, rowOrRows) => {
    checkTable(table);
    const rows = arr(rowOrRows).map((r) => cleanRow(table, r));
    if (!rows.length) return [];
    if (DB.backend === 'supabase') {
      const { data, error } = await sb().from(table).insert(rows).select();
      if (error) throw sbErr(error, `save to ${table}`);
      DB._writeGen++;
      const out = mirror(table, data);
      emit('write');
      return out;
    }
    const out = localInsert(table, rows, null);
    DB._writeGen++; emit('write');
    return out;
  };

  DB.upsert = async (table, rowOrRows, conflictCols) => {
    checkTable(table);
    const rows = arr(rowOrRows).map((r) => cleanRow(table, r));
    if (!rows.length) return [];
    const conflict = conflictCols ? arr(conflictCols) : DB._pk[table];
    if (DB.backend === 'supabase') {
      const { data, error } = await sb().from(table).upsert(rows, { onConflict: conflict.join(',') }).select();
      if (error) throw sbErr(error, `save to ${table}`);
      DB._writeGen++;
      const out = mirror(table, data);
      emit('write');
      return out;
    }
    const out = localInsert(table, rows, conflict);
    DB._writeGen++; emit('write');
    return out;
  };

  DB.update = async (table, matchObj, patchObj) => {
    checkTable(table);
    const patch = cleanRow(table, patchObj);
    const names = Object.keys(patch);
    if (!names.length) return [];
    const w = whereOf(matchObj);
    const sql = `UPDATE ${qi(table)} SET ${names.map((n) => `${qi(n)}=?`).join(',')} WHERE ${w.sql}`;
    const args = names.map((n) => patch[n]).concat(w.args);
    if (DB.backend === 'supabase') {
      const { data, error } = await sbFilter(sb().from(table).update(patch), matchObj).select();
      if (error) throw sbErr(error, `update ${table}`);
      DB._writeGen++;
      localAll(sql, args);          // apply the same change locally (handles key changes)…
      const out = mirror(table, data); // …then take the server's version of each row
      emit('write');
      return out;
    }
    const out = localAll(sql + ' RETURNING *', args);
    DB._writeGen++; emit('write');
    return out;
  };

  DB.remove = async (table, matchObj) => {
    checkTable(table);
    const w = whereOf(matchObj);
    if (DB.backend === 'supabase') {
      const { data, error } = await sbFilter(sb().from(table).delete(), matchObj).select();
      if (error) throw sbErr(error, `delete from ${table}`);
      DB._writeGen++;
      localAll(`DELETE FROM ${qi(table)} WHERE ${w.sql}`, w.args);
      emit('write');
      return (data || []).map((r) => cleanRow(table, r));
    }
    const out = localAll(`DELETE FROM ${qi(table)} WHERE ${w.sql} RETURNING *`, w.args);
    DB._writeGen++; emit('write');
    return out;
  };

  // Save the cache after writes settle so a reload shows the user's own edits immediately.
  let saveTimer = null;
  DB.onChange((kind) => {
    if (kind !== 'write' || DB.backend !== 'supabase' || typeof setTimeout === 'undefined') return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => cachePut(DB.email), 1500);
  });

  // Snapshot for tests/debugging (local backend).
  DB.exportBytes = () => need().export();

  if (typeof module !== 'undefined' && module.exports) module.exports = DB;
})(typeof globalThis !== 'undefined' ? globalThis : this);
