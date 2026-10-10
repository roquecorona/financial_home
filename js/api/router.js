/* Financial Home — API registry. Handler files register themselves:
     API.get['/api/home']  = (q) => obj              q: plain object of query strings (first value only)
     API.post['/api/txn']  = async (body, q) => obj
     API.del['/api/note']  = async (q, body) => obj
   API.call(method, path, body) parses the query string and dispatches (used by F.api in core.js and by tests). */
'use strict';
(function (g) {
  const API = g.API = g.API || {};
  API.get = API.get || {};
  API.post = API.post || {};
  API.del = API.del || {};

  // urllib.parse.parse_qs(keep_blank_values=False) + first(): first non-empty value per key.
  API.parseQuery = (qs) => {
    const q = {};
    const sp = new URLSearchParams(String(qs || '').replace(/^\?/, ''));
    for (const [k, v] of sp) { if (v === '' || Object.prototype.hasOwnProperty.call(q, k)) continue; q[k] = v; }
    return q;
  };
  API.split = (path) => {
    const s = String(path);
    const i = s.indexOf('?');
    return i < 0 ? { pathname: s, query: {} } : { pathname: s.slice(0, i), query: API.parseQuery(s.slice(i + 1)) };
  };
  API.isApiError = (e) => !!e && ((g.H && g.H.ApiError && e instanceof g.H.ApiError) ||
    (typeof e.code === 'number' && e.code >= 400 && e.code < 600 && (e.msg !== undefined || e.message !== undefined)));

  // Returns the handler's result (awaited). Throws an Error with .status (and .apiError) on failure.
  API.call = async (method, path, body) => {
    const m = String(method || 'GET').toUpperCase();
    const { pathname, query } = API.split(path);
    const table = m === 'GET' ? API.get : m === 'POST' ? API.post : m === 'DELETE' ? API.del : null;
    const fn = table && table[pathname];
    if (!fn) { const e = new Error('Unknown endpoint'); e.status = 404; throw e; }
    try {
      if (m === 'GET') return await fn(query);
      if (m === 'POST') return await fn(body || {}, query);
      return await fn(query, body || {});
    } catch (e) {
      if (API.isApiError(e)) {
        const err = new Error(e.msg !== undefined ? e.msg : e.message); err.status = e.code; err.apiError = true; throw err;
      }
      throw e;
    }
  };

  // Session endpoints from app.py's HTTP layer, now backed by Supabase Auth.
  API.post['/api/logout'] = async () => { if (g.Auth && g.Auth.signOut) await g.Auth.signOut(); return { ok: true }; };
  API.get['/api/session'] = () => ({ authed: !!(g.DB && g.DB.ready), user: g.DB ? g.DB.user : null });

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
