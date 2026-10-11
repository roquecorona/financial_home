/* Financial Home v3 - shared API helpers, ported 1:1 from app_v2/app.py (module-level helpers + constants).
   Every Python helper foo(con, a, b) is H.foo(a, b); snake_case names are kept and `con` is dropped.
   Python semantics that matter for exact output are replicated:
     - round() (correctly-rounded, ties-to-even) -> H.r2 / H.pyround
     - sum() of floats (Python 3.12+ Neumaier compensated summation) -> H.pysum
     - tuple ordering -> H.pycmp; bisect -> H.bisect_left / H.bisect_right
     - date.fromisoformat (3.11+ forms) -> H.fromiso; date math on 'YYYY-MM-DD' strings -> H.add_days / H.days_between
     - json.dumps default formatting -> H.pyjson; str(float) -> H.pyfloat_str
     - Python `re` -> JS RegExp translation for user patterns -> H.pyre
   Return conventions: Python tuples come back as JS arrays (e.g. const [w, args] = H.txn_where(q)).
   H.today() returns the ISO date STRING (same as H.today_s()); use H.add_days / H.days_between for date math. */
'use strict';
(function (g) {
  const H = g.H = g.H || {};
  const db = () => g.DB;

  // ------------------------------------------------------------------------------------------------------------------
  // constants
  // ------------------------------------------------------------------------------------------------------------------
  H.MAX_BODY = 100000;
  H.USERS = ['Roque', 'Jenny'];
  H.INVEST = ['ira', 'hsa', '401k', '403b', 'brokerage', '529'];
  H.DEBT_TYPES = ['mortgage', 'loan', 'heloc', 'auto_loan'];
  H.CASH_TYPES = ['checking', 'savings'];
  H.ACCOUNT_TYPES = ['checking', 'savings', 'credit_card', 'store_card', 'mortgage', 'loan', 'heloc', 'auto_loan',
    'brokerage', 'ira', '401k', '403b', 'hsa', '529', 'other'];
  H.HOLDERS = ['Roque', 'Jennifer', 'Joint', 'Business', 'Unconfirmed'];
  H.NON_SPEND = ['Income', 'Transfer', 'Investments'];
  H.VARIABLE_BILLS = /groceries|gas, tolls|cleaning|lawn/iu;
  H.ASSET_CLASSES = ['US stock', 'Intl stock', 'Bonds', 'Cash', 'Real estate', 'Other'];
  H.BILL_KEYWORDS = {}; // bill keyword hints live in the data (bills.keyword), not in public code
  H.BILL_CATS = {
    'groceries': ['Food', 'Groceries'], 'gas, tolls': ['Transportation', null], 'cleaning': ['Home services', 'Cleaning'],
    'lawn': ['Home services', 'Lawn'],
  };
  H.ASSET_CLASS_SEED = [
    ['SPAXX', 'symbol', 'Cash', 10], ['VMRXX', 'symbol', 'Cash', 10], ['FDRXX', 'symbol', 'Cash', 10],
    ['VTI', 'symbol', 'US stock', 10], ['FXAIX', 'symbol', 'US stock', 10], ['VITAX', 'symbol', 'US stock', 10],
    ['AVUV', 'symbol', 'US stock', 10], ['FITLX', 'symbol', 'US stock', 10], ['VXUS', 'symbol', 'Intl stock', 10],
    ['AVDV', 'symbol', 'Intl stock', 10],
    ['money market', 'description', 'Cash', 50], ['cash reserves', 'description', 'Cash', 50],
    ['bond', 'description', 'Bonds', 60], ['intl', 'description', 'Intl stock', 70],
    ['international', 'description', 'Intl stock', 70], ['tot stk', 'description', 'US stock', 80],
    ['total stock', 'description', 'US stock', 80], ['500 index', 'description', 'US stock', 80],
  ];
  H.MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
    'November', 'December'];

  // ------------------------------------------------------------------------------------------------------------------
  // errors
  // ------------------------------------------------------------------------------------------------------------------
  class ApiError extends Error {
    constructor(code, msg) {
      super(msg);
      this.name = 'ApiError';
      this.code = code;
      this.msg = msg;
    }
  }
  H.ApiError = ApiError;

  // ------------------------------------------------------------------------------------------------------------------
  // Python-semantics primitives
  // ------------------------------------------------------------------------------------------------------------------
  // Python str.isspace() characters (str patterns' \s, str.strip(), str.split())
  const WS = '\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
  const S = `[${WS}]`, NS = `[^${WS}]`;
  const WORD = '\\p{L}\\p{N}_';  // Python unicode \w (str.isalnum() or '_')
  H._WS = WS;

  function pystrip(s, chars) {
    s = String(s);
    if (chars === undefined || chars === null) return s.replace(new RegExp(`^${S}+|${S}+$`, 'gu'), '');
    const set = new Set(Array.from(chars));
    const a = Array.from(s);
    let i = 0, j = a.length;
    while (i < j && set.has(a[i])) i++;
    while (j > i && set.has(a[j - 1])) j--;
    return a.slice(i, j).join('');
  }
  H.pystrip = pystrip;

  function pysplit(s) {  // str.split() with no args
    return String(s).split(new RegExp(`${S}+`, 'u')).filter((x) => x !== '');
  }
  H.pysplit = pysplit;

  // Python truthiness
  function pybool(x) {
    if (x === null || x === undefined || x === false || x === 0 || x === '') return false;
    if (Array.isArray(x)) return x.length > 0;
    if (typeof x === 'object') return Object.keys(x).length > 0;
    return true;
  }
  H.pybool = pybool;

  // repr()/str() of a Python float
  function pyfloat_str(x) {
    if (Number.isNaN(x)) return 'nan';
    if (x === Infinity) return 'inf';
    if (x === -Infinity) return '-inf';
    if (Object.is(x, -0)) return '-0.0';
    const ax = Math.abs(x);
    if (ax >= 1e16 || (ax < 1e-4 && ax !== 0)) {
      // Python repr: shortest digits, exponent with sign and at least 2 digits
      let [mant, exp] = x.toExponential().split('e');
      const e = parseInt(exp, 10);
      return `${mant}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
    }
    const s = String(x);
    return Number.isInteger(x) ? s + '.0' : s;
  }
  H.pyfloat_str = pyfloat_str;

  // str(x) as Python would print the JSON-decoded value
  function pystr(x) {
    if (x === null || x === undefined) return 'None';
    if (x === true) return 'True';
    if (x === false) return 'False';
    if (typeof x === 'number') return Number.isInteger(x) && Math.abs(x) < 1e16 ? String(x) : pyfloat_str(x);
    return String(x);
  }
  H.pystr = pystr;

  // float(str) - throws on ValueError
  const FLOAT_RX = /^[+-]?(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?$/;
  function pyfloat(s) {
    const t = pystrip(s);
    const m = /^([+-]?)(?:(inf|infinity)|(nan))$/i.exec(t);
    if (m) return m[2] ? (m[1] === '-' ? -Infinity : Infinity) : NaN;
    if (!FLOAT_RX.test(t)) throw new Error(`could not convert string to float: '${s}'`);
    return Number(t.replace(/_/g, ''));
  }
  H.pyfloat = pyfloat;

  function pyint(s) {  // int(str)
    if (typeof s === 'number') return Math.trunc(s);
    const t = pystrip(s);
    if (!/^[+-]?\d(?:_?\d)*$/.test(t)) throw new Error(`invalid literal for int() with base 10: '${s}'`);
    return parseInt(t.replace(/_/g, ''), 10);
  }
  H.pyint = pyint;

  // round(x, nd): correctly rounded, ties to even (ties only occur when x*10^nd is exactly k+0.5)
  function pyround(x, nd = 0) {
    if (x === null || x === undefined) return x;
    if (!Number.isFinite(x)) return x;
    if (nd >= 0 && nd <= 20) {
      // exact decimal tie <=> x * 2^(nd+1) is an odd integer
      const e = x * Math.pow(2, nd + 1);
      if (Number.isInteger(e) && Math.abs(e % 2) === 1) {
        const p = Math.pow(10, nd), y = x * p, f = Math.floor(y);
        return (f % 2 === 0 ? f : f + 1) / p;
      }
    }
    if (Math.abs(x) >= 1e21) return x;
    return Number(x.toFixed(nd));
  }
  H.pyround = pyround;

  function r2(x) {
    return x === null || x === undefined ? null : pyround(x + 0.0, 2);
  }
  H.r2 = r2;

  // sum(iterable) with CPython 3.12+ float semantics (Neumaier compensated summation)
  function pysum(arr) {
    let s = 0.0, c = 0.0;
    for (const v of arr) {
      const x = +v;
      const t = s + x;
      if (Math.abs(s) >= Math.abs(x)) c += (s - t) + x;
      else c += (x - t) + s;
      s = t;
    }
    if (c && Number.isFinite(c)) s += c;
    return s;
  }
  H.pysum = pysum;

  // Python ordering of scalars / tuples (arrays); None sorts first (Python would raise)
  function pycmp(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) {
        if (a[i] === b[i] || (a[i] == null && b[i] == null)) continue;
        if (Array.isArray(a[i]) && Array.isArray(b[i]) && pycmp(a[i], b[i]) === 0) continue;
        return pycmp(a[i], b[i]);
      }
      return a.length - b.length;
    }
    if (a === b) return 0;
    if (a == null) return b == null ? 0 : -1;
    if (b == null) return 1;
    if (typeof a === 'boolean') a = +a;
    if (typeof b === 'boolean') b = +b;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  H.pycmp = pycmp;
  H.pysorted = (arr, key) => arr.slice().sort(key ? (x, y) => pycmp(key(x), key(y)) : pycmp);

  function bisect_right(a, x) {
    let lo = 0, hi = a.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pycmp(x, a[mid]) < 0) hi = mid; else lo = mid + 1; }
    return lo;
  }
  function bisect_left(a, x) {
    let lo = 0, hi = a.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pycmp(a[mid], x) < 0) lo = mid + 1; else hi = mid; }
    return lo;
  }
  H.bisect_right = bisect_right;
  H.bisect_left = bisect_left;

  // json.dumps(obj) with default separators and ensure_ascii=True
  function pyjson(v) {
    if (v === null || v === undefined) return 'null';
    if (v === true) return 'true';
    if (v === false) return 'false';
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return 'NaN';
      if (v === Infinity) return 'Infinity';
      if (v === -Infinity) return '-Infinity';
      return Number.isInteger(v) && Math.abs(v) < 1e16 && !Object.is(v, -0) ? String(v) : pyfloat_str(v);
    }
    if (typeof v === 'string') {
      return JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    }
    if (Array.isArray(v)) return '[' + v.map(pyjson).join(', ') + ']';
    return '{' + Object.keys(v).map((k) => pyjson(String(k)) + ': ' + pyjson(v[k])).join(', ') + '}';
  }
  H.pyjson = pyjson;

  // ------------------------------------------------------------------------------------------------------------------
  // Python `re` pattern -> JS RegExp (unicode mode). Used for user-entered rule patterns.
  // ------------------------------------------------------------------------------------------------------------------
  function hexEsc(ch) { return `\\u{${ch.codePointAt(0).toString(16)}}`; }

  function pyre_source(pat, flags) {
    let out = '', i = 0, inClass = false, classStart = false;
    const cps = Array.from(pat);
    const dot = flags.includes('s') ? '[\\s\\S]' : '[^\\n]';
    const mline = flags.includes('m');
    while (i < cps.length) {
      const c = cps[i];
      if (c === '\\') {
        const n = cps[i + 1];
        if (n === undefined) throw new SyntaxError('bad escape (end of pattern)');
        i += 2;
        if (inClass) {
          classStart = false;
          if (n === 'w') out += WORD;
          else if (n === 'd') out += '\\p{Nd}';
          else if (n === 's') out += WS;
          else if ('WDS'.includes(n)) out += '\\' + n;
          else if (/[A-Za-z0-9]/.test(n)) {
            if (n === 'U') { out += `\\u{${cps.slice(i, i + 8).join('').replace(/^0+(?=.)/, '')}}`; i += 8; }
            else if (n === 'b') out += '\\x08';
            else out += '\\' + n;
          } else out += hexEsc(n);
          continue;
        }
        if (n === 'b') out += `(?:(?<=[${WORD}])(?![${WORD}])|(?<![${WORD}])(?=[${WORD}]))`;
        else if (n === 'B') out += `(?:(?<=[${WORD}])(?=[${WORD}])|(?<![${WORD}])(?![${WORD}]))`;
        else if (n === 'w') out += `[${WORD}]`;
        else if (n === 'W') out += `[^${WORD}]`;
        else if (n === 'd') out += '\\p{Nd}';
        else if (n === 'D') out += '\\P{Nd}';
        else if (n === 's') out += S;
        else if (n === 'S') out += NS;
        else if (n === 'A') out += '(?<![\\s\\S])';
        else if (n === 'Z') out += '(?![\\s\\S])';
        else if (n === 'U') { out += `\\u{${cps.slice(i, i + 8).join('').replace(/^0+(?=.)/, '')}}`; i += 8; }
        else if (/[A-Za-z0-9]/.test(n)) out += '\\' + n;
        else out += hexEsc(n);
        continue;
      }
      if (inClass) {
        if (c === ']' && !classStart) { inClass = false; out += ']'; i++; continue; }
        if (c === ']' && classStart) { out += '\\]'; classStart = false; i++; continue; }
        if (c === '^' && classStart && out.endsWith('[')) { out += '^'; i++; continue; }
        classStart = false;
        if (c === '[' || c === '/' ) { out += '\\' + c; i++; continue; }
        out += c; i++;
        continue;
      }
      if (c === '[') { inClass = true; classStart = true; out += '['; i++; continue; }
      if (c === '(' && cps[i + 1] === '?') {
        // scoped inline flags (?i:...) / (?-i:...): JS engines may lack modifiers; keep the group, drop the flags
        // (rule patterns are compiled case-insensitive anyway)
        const sm = /^\(\?[aiLmsux]*(?:-[imsx]+)?:/.exec(cps.slice(i, i + 16).join(''));
        if (sm && sm[0] !== '(?:') { out += '(?:'; i += sm[0].length; continue; }
      }
      if (c === '(' && cps[i + 1] === '?' && cps[i + 2] === 'P') {
        if (cps[i + 3] === '<') { out += '(?<'; i += 4; continue; }
        if (cps[i + 3] === '=') {
          let j = i + 4, name = '';
          while (j < cps.length && cps[j] !== ')') name += cps[j++];
          out += `\\k<${name}>`; i = j + 1; continue;
        }
      }
      if (c === '{') {
        const rest = cps.slice(i).join('');
        const m = /^\{(\d*)(?:(,)(\d*))?\}/.exec(rest);
        if (m && (m[1] !== '' || m[2]) && out !== '' ) {
          out += `{${m[1] === '' ? '0' : m[1]}${m[2] ? ',' + m[3] : ''}}`;
          i += m[0].length; continue;
        }
        out += '\\{'; i++; continue;
      }
      if (c === '}' || c === ']' || c === '/') { out += '\\' + c; i++; continue; }
      if (c === '.') { out += dot; i++; continue; }
      if (c === '$') { out += mline ? '(?=\\n|(?![\\s\\S]))' : '(?=\\n?(?![\\s\\S]))'; i++; continue; }
      if (c === '^') { out += mline ? '(?:(?<![\\s\\S])|(?<=\\n))' : '(?<![\\s\\S])'; i++; continue; }
      out += c; i++;
    }
    if (inClass) throw new SyntaxError('unterminated character set');
    return out;
  }

  // Compile a Python regex (flags: 'i', 'm', 's'). Throws SyntaxError like re.error.
  function pyre(pattern, flags = '') {
    let p = String(pattern), fl = flags;
    const lead = /^\(\?([aiLmsux]+)\)/.exec(p);
    if (lead) { p = p.slice(lead[0].length); fl += lead[1].replace(/[aLux]/g, ''); }
    fl = Array.from(new Set(fl)).join('');
    const src = pyre_source(p, fl);
    try {
      return new RegExp(src, fl.replace(/[ms]/g, '') + 'u');
    } catch (e) {
      try { return new RegExp(p, fl.replace(/[ms]/g, '') + (fl.includes('s') ? 's' : '') + (fl.includes('m') ? 'm' : '')); }
      catch (e2) { throw new SyntaxError(e.message); }
    }
  }
  H.pyre = pyre;
  H.re_escape = (s) => String(s).replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');  // safe in 'u' mode

  // ------------------------------------------------------------------------------------------------------------------
  // dates (plain 'YYYY-MM-DD' strings; integer day math, no timezones)
  // ------------------------------------------------------------------------------------------------------------------
  function days_from_civil(y, m, d) {
    y -= m <= 2 ? 1 : 0;
    const era = Math.floor(y / 400);
    const yoe = y - era * 400;
    const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }
  function civil_from_days(z) {
    z += 719468;
    const era = Math.floor(z / 146097);
    const doe = z - era * 146097;
    const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    const y = yoe + era * 400;
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const m = mp + (mp < 10 ? 3 : -9);
    return [y + (m <= 2 ? 1 : 0), m, d];
  }
  const is_leap = (y) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days_in_month = (y, m) => [31, is_leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  const pad = (n, w) => String(n).padStart(w, '0');
  const iso = (y, m, d) => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
  H.days_in_month = days_in_month;
  H.is_leap = is_leap;

  function make_date(y, m, d) {  // dt.date(y, m, d) validation
    if (!(y >= 1 && y <= 9999)) throw new RangeError(`year ${y} is out of range`);
    if (!(m >= 1 && m <= 12)) throw new RangeError('month must be in 1..12');
    if (!(d >= 1 && d <= days_in_month(y, m))) throw new RangeError('day is out of range for month');
    return iso(y, m, d);
  }
  H.make_date = make_date;

  // dt.date.fromisoformat(s).isoformat() (Python 3.11+ accepted forms); throws on ValueError
  function fromiso(s) {
    s = String(s);
    const bad = () => new RangeError(`Invalid isoformat string: '${s}'`);
    const len = new TextEncoder().encode(s).length;
    if (!(len === 7 || len === 8 || len === 10)) throw bad();
    let p = 0;
    const digits = (n) => {
      let v = 0;
      for (let k = 0; k < n; k++) {
        const c = s.charCodeAt(p);
        if (!(c >= 48 && c <= 57)) return null;
        v = v * 10 + (c - 48); p++;
      }
      return v;
    };
    const year = digits(4);
    if (year === null) throw bad();
    const sep = s[p] === '-';
    if (sep) p++;
    if (s[p] === 'W') {
      p++;
      const week = digits(2);
      if (week === null) throw bad();
      let wd = 1;
      if (p < len) {
        if (sep && s[p++] !== '-') throw bad();
        wd = digits(1);
        if (wd === null) throw bad();
      }
      if (week <= 0 || week >= 53) {
        let out = true;
        if (week === 53) {
          const first_wd = ((days_from_civil(year, 1, 1) + 3) % 7 + 7) % 7;  // Monday=0
          if (first_wd === 3 || (first_wd === 2 && is_leap(year))) out = false;
        }
        if (out) throw bad();
      }
      if (wd <= 0 || wd >= 8) throw bad();
      const jan4 = days_from_civil(year, 1, 4);
      const wk1mon = jan4 - (((jan4 + 3) % 7 + 7) % 7);
      const [y, m, d] = civil_from_days(wk1mon + (week - 1) * 7 + wd - 1);
      return make_date(y, m, d);
    }
    const month = digits(2);
    if (month === null) throw bad();
    if (sep && s[p++] !== '-') throw bad();
    const day = digits(2);
    if (day === null) throw bad();
    return make_date(year, month, day);
  }
  H.fromiso = fromiso;

  const ord = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return days_from_civil(y, m, d); };
  // (date(s) + timedelta(days=n)).isoformat()
  H.add_days = (s, n) => { const [y, m, d] = civil_from_days(ord(s) + n); return iso(y, m, d); };
  // (date(b) - date(a)).days
  H.days_between = (a, b) => ord(b) - ord(a);
  // date.weekday() (Monday=0)
  H.weekday = (s) => ((ord(s) + 3) % 7 + 7) % 7;

  function today() { return db().today(); }
  H.today = today;  // NOTE: returns 'YYYY-MM-DD' (Python returned a date object)
  H.today_s = () => today();
  H.now_s = () => {
    const t = new Date();
    return `${iso(t.getFullYear(), t.getMonth() + 1, t.getDate())} ${pad(t.getHours(), 2)}:${pad(t.getMinutes(), 2)}:${pad(t.getSeconds(), 2)}`;
  };

  // ------------------------------------------------------------------------------------------------------------------
  // db passthroughs
  // ------------------------------------------------------------------------------------------------------------------
  H.Q = (sql, args = []) => db().Q(sql, args);
  H.one = (sql, args = []) => db().one(sql, args);
  H.row = (sql, args = []) => db().row(sql, args);
  // positional rows (Python r[0], r[1]...)
  H.rows = (sql, args = []) => db().Q(sql, args).map((r) => Object.values(r));

  H.setting = (key, dflt = null) => {
    const r = db().row('SELECT value FROM app_settings WHERE key=?', [key]);
    return r ? r.value : dflt;
  };
  H.set_setting = async (key, value) => db().upsert('app_settings', { key, value }, ['key']);

  // ------------------------------------------------------------------------------------------------------------------
  // month helpers
  // ------------------------------------------------------------------------------------------------------------------
  const ym = (m) => {
    const parts = String(m).split('-');
    if (parts.length !== 2) throw new Error(`bad month: ${m}`);
    return parts.map(pyint);
  };
  H.month_of = (d) => d.slice(0, 7);
  H.month_bounds = (m) => {
    const [y, mo] = ym(m);
    return [make_date(y, mo, 1), make_date(y + (mo === 12 ? 1 : 0), (mo % 12) + 1, 1)];
  };
  H.month_end = (m) => {
    const [y, mo] = ym(m);
    if (!(mo >= 1 && mo <= 12)) throw new RangeError('bad month number');
    return make_date(y, mo, days_in_month(y, mo));
  };
  H.add_months = (m, k) => {
    const [y, mo] = ym(m);
    const idx = y * 12 + (mo - 1) + k;
    return `${Math.floor(idx / 12)}-${pad(((idx % 12) + 12) % 12 + 1, 2)}`;
  };
  H.month_range = (m0, m1) => {
    const out = [];
    let m = m0;
    while (m <= m1) { out.push(m); m = H.add_months(m, 1); }
    return out;
  };
  H.this_month = () => today().slice(0, 7);

  // ------------------------------------------------------------------------------------------------------------------
  // validators
  // ------------------------------------------------------------------------------------------------------------------
  const empty = (s) => s === null || s === undefined || s === '';
  H.v_date = (s, field = 'date', required = false) => {
    if (empty(s)) {
      if (required) throw new ApiError(400, `${field} is required`);
      return null;
    }
    try {
      return fromiso(Array.from(pystr(s)).slice(0, 10).join(''));
    } catch (e) {
      throw new ApiError(400, `${field} must be a date like 2026-10-10`);
    }
  };
  H.v_month = (s, field = 'month') => {
    if (!pybool(s)) return H.this_month();
    const t = pystr(s);
    if (!/^\p{Nd}{4}-\p{Nd}{2}$/u.test(t) || !(pyint(t.slice(5)) >= 1 && pyint(t.slice(5)) <= 12)) {
      throw new ApiError(400, `${field} must look like 2026-10`);
    }
    return t;
  };
  H.v_num = (s, field, required = false, lo = null, hi = null) => {
    if (empty(s)) {
      if (required) throw new ApiError(400, `${field} is required`);
      return null;
    }
    let x;
    try {
      x = pyfloat(pystr(s).split(',').join('').split('$').join(''));
    } catch (e) {
      throw new ApiError(400, `${field} must be a number`);
    }
    if (Number.isNaN(x) || !Number.isFinite(x) || (lo !== null && lo !== undefined && x < lo) ||
        (hi !== null && hi !== undefined && x > hi)) {
      throw new ApiError(400, `${field} is out of range`);
    }
    return x;
  };
  H.v_str = (s, field, required = false, maxlen = 500, choices = null) => {
    if (s === null || s === undefined || pystrip(pystr(s)) === '') {
      if (required) throw new ApiError(400, `${field} is required`);
      return null;
    }
    s = pystrip(pystr(s));
    if (Array.from(s).length > maxlen) throw new ApiError(400, `${field} is too long`);
    if (choices && choices.length && !choices.includes(s)) {
      throw new ApiError(400, `${field} must be one of: ` + choices.join(', '));
    }
    return s;
  };
  H.v_int = (s, field, required = false) => {
    const x = H.v_num(s, field, required);
    return x === null ? null : Math.trunc(x);
  };

  // ------------------------------------------------------------------------------------------------------------------
  // merchant_of
  // ------------------------------------------------------------------------------------------------------------------
  const D = '\\p{Nd}';
  const MERCH_ACH = new RegExp(`ORIG CO NAME:${S}*([^\\n]+?)${S}+ORIG ID`, 'iu');
  const MERCH_PREFIX = new RegExp(`^(?:[A-Z]{2,4}${S}?\\*${S}*|(?:FD|SP|PP|WWW)${S}+|PAYPAL${S}*\\*${S}*|LINK\\.COM\\*${S}*|` +
    `PADDLE\\.NET\\*${S}*|APPLE\\.COM\\/BILL${S}*)`, 'iu');
  const MERCH_TAIL = new Set(['-', '&', 'of', 'for', 'by', 'de', 'the', 'and', 'com', 'inc', 'llc', 'co', 'f', 'r', 'i', 'd']);
  const ACRONYMS = new Set(['FPL', 'AT&T', 'UPS', 'CVS', 'HMG', 'IHG', 'FIU', 'H&M', 'USPS', 'WDW', 'AP', 'TV', 'HOA', 'CHA', 'AWS',
    'PNC', 'EDI', 'WF', 'MIT', 'US', 'USA', 'BB', 'EMS', 'PSA', 'GEICO', 'SFITE']);
  H.MERCH_ACH = MERCH_ACH;
  H.MERCH_PREFIX = MERCH_PREFIX;
  H.MERCH_TAIL = MERCH_TAIL;
  H.ACRONYMS = ACRONYMS;

  const RX_LOWER = /\p{Lowercase}/u, RX_UPPER = /\p{Uppercase}/u, RX_TITLE = /\p{Lt}/u;
  function isupper(s) {
    let cased = false;
    for (const ch of s) {
      if (RX_LOWER.test(ch) || RX_TITLE.test(ch)) return false;
      if (RX_UPPER.test(ch)) cased = true;
    }
    return cased;
  }
  function islower(s) {
    let cased = false;
    for (const ch of s) {
      if (RX_UPPER.test(ch) || RX_TITLE.test(ch)) return false;
      if (RX_LOWER.test(ch)) cased = true;
    }
    return cased;
  }
  H.isupper = isupper;
  H.islower = islower;

  function _nice(word) {
    if (ACRONYMS.has(word.toUpperCase())) return word.toUpperCase();
    if (isupper(word) || islower(word)) {
      const cps = Array.from(word);
      return (cps[0] || '').toUpperCase() + cps.slice(1).join('').toLowerCase();
    }
    return word;
  }
  H._nice = _nice;

  const RX_AMAZON = /amazon|amzn/u, RX_AMZ_PAY = /syf|storecrd|pmt|payment|pmts/u;
  const RX_ZELLE = new RegExp('^zelle payment (to|from) ([^\\n]+)', 'iu');
  const RX_DIGIT = new RegExp(D, 'u');
  const RX_XFER = /^online (realtime )?transfer/u;
  const RX_OP = new RegExp(`^online payment ${NS}+ to ([^\\n]+?)(${S}+${D}${D}\\/${D}${D})?$`, 'iu');
  const RX_GOOGLE = new RegExp(`^google${S}*\\*${S}*([^\\n]+)`, 'iu');
  const RX_CUT = new RegExp(`${S}[*#]|\\*|#|${S}{2,}|${S}WEB ID|${S}PPD ID|${S}ID:|,`, 'u');
  const RX_DOTCOM = new RegExp(`\\.com(?![${WORD}])`, 'giu');
  const RX_WSPLIT = new RegExp(`[${WS}/]+`, 'u');

  const MCACHE = new Map();
  function merchant_of(desc) {
    const key = desc === null || desc === undefined ? null : String(desc);
    if (MCACHE.has(key)) return MCACHE.get(key);
    const v = merchant_of_raw(key);
    if (MCACHE.size >= 65536) MCACHE.clear();
    MCACHE.set(key, v);
    return v;
  }
  function merchant_of_raw(desc) {
    let d = pystrip(desc || '');
    if (!d) return 'Unknown';
    const m = MERCH_ACH.exec(d);
    if (m) d = m[1];
    const low = d.toLowerCase();
    if (RX_AMAZON.test(low) && !RX_AMZ_PAY.test(low)) return low.includes('onemed') ? 'Amazon One Medical' : 'Amazon';
    if (low.startsWith('target')) return 'Target';
    if (low.startsWith('att*') || low.startsWith('at&t')) return 'AT&T';
    const z = RX_ZELLE.exec(d);
    if (z) {
      const words = [];
      for (const w of pysplit(z[2])) {
        if (RX_DIGIT.test(w) && words.length) break;
        words.push(w);
      }
      return 'Zelle: ' + words.slice(0, 3).map(_nice).join(' ');
    }
    if (RX_XFER.test(low)) return 'Transfer';
    const op = RX_OP.exec(d);
    if (op) d = 'Payment to ' + op[1];
    if (low.startsWith('check #')) return 'Check';
    const gg = RX_GOOGLE.exec(d);
    if (gg) d = 'Google ' + gg[1];
    else for (let k = 0; k < 2; k++) d = d.replace(MERCH_PREFIX, '');
    const cut = d.search(RX_CUT);
    if (cut >= 0) d = d.slice(0, cut);
    d = d.replace(RX_DOTCOM, '');
    let words = d.split(RX_WSPLIT).filter((w) => w && !RX_DIGIT.test(w)).map((w) => pystrip(w, ".'"));
    words = words.filter((w) => w && w !== '-');
    const out = words.slice(0, 3);
    while (out.length > 1 && MERCH_TAIL.has(out[out.length - 1].toLowerCase())) out.pop();
    if (!out.length) return Array.from(desc || 'Unknown').slice(0, 24).join('');
    return out.map(_nice).join(' ').split(' To ').join(' to ').split(' Of ').join(' of ');
  }
  H.merchant_of = merchant_of;

  // ------------------------------------------------------------------------------------------------------------------
  // accounts & balances
  // ------------------------------------------------------------------------------------------------------------------
  H.LATEST_BAL = `SELECT a.account_id, a.name, a.display_name, a.holder, a.type, a.last4, a.entity, a.status, a.institution_id,
  a.include_in_totals, a.simplefin_name, a.notes AS meta_notes, i.name AS institution,
  (SELECT b.balance FROM balances b WHERE b.account_id=a.account_id ORDER BY b.as_of DESC LIMIT 1) AS balance,
  (SELECT b.available FROM balances b WHERE b.account_id=a.account_id ORDER BY b.as_of DESC LIMIT 1) AS available,
  (SELECT b.as_of FROM balances b WHERE b.account_id=a.account_id ORDER BY b.as_of DESC LIMIT 1) AS as_of
  FROM accounts a LEFT JOIN institutions i ON i.institution_id=a.institution_id`;

  H.acct_group = (t) => {
    if (H.CASH_TYPES.includes(t)) return 'cash';
    if (t === 'credit_card' || t === 'store_card') return 'cards';
    if (H.INVEST.includes(t)) return 'investments';
    if (H.DEBT_TYPES.includes(t)) return 'loans';
    return 'other';
  };

  H.included = (a) => {
    if (a.include_in_totals !== null && a.include_in_totals !== undefined) return pybool(a.include_in_totals);
    // v3 (documented divergence): kids' 529s are not household money, so they stay out of totals and net worth unless an
    // account explicitly sets include_in_totals=1. Investments shows them in their own "Kids' 529s" block.
    if (a.type === '529') return false;
    return !['shares_balance', 'closed'].includes(a.status);
  };

  H.linked_accounts = (where = '', args = []) => {
    const rs = H.Q(H.LATEST_BAL + (where ? ' WHERE ' + where : '') + ' ORDER BY a.type, a.name', args);
    for (const a of rs) {
      a.label = a.display_name || a.name;
      a.group = H.acct_group(a.type);
      a.included = H.included(a);
      if (H.INVEST.includes(a.type)) {
        const s = H.row('SELECT as_of, balance FROM manual_snapshots WHERE account_id=? ORDER BY as_of DESC LIMIT 1',
          [a.account_id]);
        if (s && (a.as_of === null || a.as_of === undefined || s.as_of > a.as_of)) {
          a.balance = s.balance; a.as_of = s.as_of; a.balance_source = 'manual snapshot';
        }
      }
    }
    return rs;
  };

  H.manual_accounts = () => {
    const rs = H.Q("SELECT * FROM manual_accounts ORDER BY kind, status='closed', name");
    for (const m of rs) {
      const [val, as_of, src] = H.manual_value(m, H.today_s());
      m.balance = val; m.as_of = as_of; m.balance_source = src;
      m.group = 'manual_' + m.kind;
      m.label = m.name;
    }
    return rs;
  };

  // all dated points for a manual account: [[date, value, src]] sorted
  H.manual_points = (m) => {
    const pts = H.Q('SELECT as_of, balance FROM manual_account_balances WHERE manual_account_id=? ORDER BY as_of', [m.id])
      .map((r) => [r.as_of, r.balance, 'manual']);
    if (pybool(m.sheet_loan)) {
      for (const r of H.Q('SELECT month, balance FROM loan_balances WHERE loan=? ORDER BY month', [m.sheet_loan])) {
        if (r.balance !== null && r.balance !== undefined) pts.push([H.month_end(r.month), r.balance, 'sheet']);
      }
    }
    pts.sort((a, b) => pycmp([a[0], a[2] === 'manual'], [b[0], b[2] === 'manual']));
    return pts;
  };

  H.manual_value = (m, d, pts = null) => {
    pts = pts === null || pts === undefined ? H.manual_points(m) : pts;
    const i = bisect_right(pts.map((p) => p[0]), d) - 1;
    if (i < 0) return [null, null, null];
    const p = pts[i];
    if (m.status === 'closed' && i === pts.length - 1 && d > H.month_end(H.month_of(p[0])) && m.kind === 'debt') {
      if (d > H.month_end(H.add_months(H.month_of(p[0]), 1))) return [0.0, p[0], p[2]];
    }
    return [p[1], p[0], p[2]];
  };

  H.data_start = () => H.one("SELECT MIN(posted_date) FROM transactions WHERE source='simplefin'") ||
    H.one('SELECT MIN(posted_date) FROM transactions');

  class BalanceWalker {
    constructor(aid, coverage_start = null) {
      this.real = H.rows('SELECT as_of, balance FROM balances WHERE account_id=? AND balance IS NOT NULL ORDER BY as_of', [aid])
        .map((r) => [r[0], r[1]]);
      const tx = H.rows(`SELECT posted_date, SUM(amount) FROM transactions WHERE account_id=? AND posted_date IS NOT NULL
            AND pending=0 GROUP BY 1 ORDER BY 1`, [aid]);
      this.days = tx.map((r) => r[0]);
      this.cum = [];
      let c = 0.0;
      for (const r of tx) { c += r[1]; this.cum.push(c); }
      const first = this.days.length ? this.days[0] : null;
      const cs = [coverage_start, first].filter((x) => pybool(x));
      this.start = cs.length ? cs.reduce((a, b) => (b < a ? b : a)) : (this.real.length ? this.real[0][0] : null);
      if (this.start) this.start = H.add_days(fromiso(this.start), -1);
      this._realDays = this.real.map((r) => r[0]);
    }
    _cum(d) {
      const i = bisect_right(this.days, d) - 1;
      return i >= 0 ? this.cum[i] : 0.0;
    }
    at(d) {
      if (!this.real.length) return null;
      if (this.start && d < this.start && !this.real.some((r) => r[0] === d)) return null;
      const i = bisect_left(this._realDays, d);
      if (i < this.real.length) {
        const [a_d, a_b] = this.real[i];
        return a_b - (this._cum(a_d) - this._cum(d));
      }
      const [a_d, a_b] = this.real[this.real.length - 1];
      return a_b + (this._cum(d) - this._cum(a_d));
    }
  }
  H.BalanceWalker = BalanceWalker;

  // ------------------------------------------------------------------------------------------------------------------
  // investments engine
  // ------------------------------------------------------------------------------------------------------------------
  // v3 (documented divergence from app.py): money moved between investment accounts (rollovers, ACAT/in-kind transfers,
  // transfer-out distributions) is kind 'transfer': an external flow for the account's value and returns, but never a
  // contribution or withdrawal, so a rollover isn't counted as saving.
  // Every contribution gets a source (v3, 10.11.2026):
  //   employee  payroll deferral into a workplace plan (401(k)/403(b)/FRS/HSA: PARTIC CONTR, employee, deferral, payroll)
  //   employer  match / non-elective / safe-harbor money (CO CONTR, employer, company, match)
  //   personal  money we moved in ourselves (bank deposits into brokerage/IRA/Roth/HSA/529: "deposit from bank",
  //             "funds received", or any other contribution to an account that isn't a workplace plan)
  //   gift      529 gifting deposits
  //   payroll   (internal) a workplace-plan credit that doesn't say who paid (e.g. the sync's plain "contribution" rows):
  //             inv_flows splits it into employee + employer using that account's own labelled contributions
  //   unspecified / snapshot  only when nothing tells us (a workplace plan with no labelled history)
  // app.py counted plain "contribution" rows as employee and bank deposits / 403(b) credits as unspecified.
  H.INV_TRANSFER_RE = /\brollover (in|distr|out)\b|\bacat\b|\bjournal(ed)?\b|transfer of assets|transfer out distr|\btransfer in\b(?!.*(funds received|deposit))/i;
  H.INV_DEPOSIT_RE = /funds received|deposit from bank|deposits per statement/i;
  H.INV_WORKPLACE = ['401k', '403b'];
  H.classify_inv = (sub, desc, amt, atype) => {
    const d = (desc || '').toLowerCase();
    const workplace = H.INV_WORKPLACE.includes(atype);
    if (amt > 0 && /\bgift(ing)?\b/.test(d) && sub !== 'Dividend' && sub !== 'Fees') return ['contribution', 'gift'];
    if (H.INV_DEPOSIT_RE.test(d) && amt > 0) return ['contribution', workplace ? 'payroll' : 'personal'];
    if (sub !== 'Dividend' && sub !== 'Fees' && H.INV_TRANSFER_RE.test(d) && amt) return ['transfer', amt > 0 ? 'in' : 'out'];
    if (sub === 'Contribution') {
      if (d.includes('co contr') || d.includes('employer') || d.includes('company') || /\bmatch\b|non.?elective|safe harbor/.test(d)) {
        return ['contribution', 'employer'];
      }
      if (d.includes('partic') || d.includes('employee') || d.includes('deferral') || d.includes('payroll')) return ['contribution', 'employee'];
      return ['contribution', workplace ? 'payroll' : (atype === 'hsa' ? 'employee' : 'personal')];
    }
    if (sub === 'Distribution') return ['withdrawal', null];
    if (sub === 'Other' && amt > 0 && workplace) {
      return amt >= 50 ? ['contribution', 'payroll'] : ['dividend', null];
    }
    if (sub === 'Dividend' && amt > 0 && !d.includes('reinvest')) return ['dividend', null];
    if (sub === 'Fees') return ['fee', null];
    return [null, null];
  };
  // Display names for contribution sources (the Investments table and flow list).
  H.INV_SOURCE_LABEL = { employee: 'Employee (payroll)', employer: 'Employer (match)', personal: 'Personal deposits', gift: 'Gifts', unspecified: 'Not specified', snapshot: 'Not specified' };

  // Split workplace-plan credits that don't say who paid ('payroll', and snapshot-derived amounts in a workplace plan) into
  // employee + employer parts, using the share of employer money among that account's labelled contributions in the year
  // before (or, failing that, any time). With no labelled history the amount stays 'unspecified'. flows: [[d, amt, kind, src]]
  function split_payroll(flows, workplace) {
    const lab = flows.filter((f) => f[2] === 'contribution' && (f[3] === 'employee' || f[3] === 'employer'));
    const share = (d) => {
      const lo = H.add_days(d, -400);
      let w = lab.filter((f) => f[0] <= d && f[0] >= lo);
      if (!w.length) w = lab;
      const emp = pysum(w.filter((f) => f[3] === 'employer').map((f) => f[1])), tot = pysum(w.map((f) => f[1]));
      return tot > 0 ? emp / tot : null;
    };
    const out = [];
    for (const f of flows) {
      if (f[2] !== 'contribution' || !(f[3] === 'payroll' || (workplace && f[3] === 'snapshot'))) { out.push(f); continue; }
      const sh = share(f[0]);
      if (sh === null) { out.push([f[0], f[1], f[2], f[3] === 'payroll' ? 'unspecified' : f[3]]); continue; }
      out.push([f[0], f[1] * (1 - sh), 'contribution', 'employee', 'split']);
      if (sh > 0) out.push([f[0], f[1] * sh, 'contribution', 'employer', 'split']);
    }
    return out;
  }

  // {aid: [[date, amount, kind, source(, 'split')]]}
  H.inv_flows = (acct_ids) => {
    if (!acct_ids || !acct_ids.length) return {};
    const ph = acct_ids.map(() => '?').join(',');
    const out = {};
    const atype = {};
    for (const a of acct_ids) out[a] = [];
    const first_tx = {};
    for (const r of H.Q(`SELECT t.account_id, t.posted_date, t.amount, t.description, t.subcategory, a.type
            FROM transactions t JOIN accounts a USING(account_id) WHERE t.account_id IN (${ph}) AND t.posted_date IS NOT NULL
            ORDER BY t.posted_date`, acct_ids)) {
      if (!(r.account_id in first_tx)) first_tx[r.account_id] = r.posted_date;
      atype[r.account_id] = r.type;
      const [kind, src] = H.classify_inv(r.subcategory, r.description, r.amount, r.type);
      if (kind) out[r.account_id].push([r.posted_date, r.amount, kind, src]);
    }
    for (const aid of acct_ids) {
      const snaps = H.Q(`SELECT as_of, contributions_ytd FROM manual_snapshots WHERE account_id=? AND contributions_ytd IS NOT NULL
            ORDER BY as_of`, [aid]);
      let prev = null;
      for (const s of snaps) {
        if (first_tx[aid] && s.as_of >= first_tx[aid]) break;
        let f;
        if (prev && prev.as_of.slice(0, 4) === s.as_of.slice(0, 4)) f = s.contributions_ytd - prev.contributions_ytd;
        else f = prev !== null ? s.contributions_ytd : 0;
        if (f) out[aid].push([s.as_of, f, 'contribution', 'snapshot']);
        prev = s;
      }
      out[aid].sort(pycmp);
      const t = atype[aid] || H.one('SELECT type FROM accounts WHERE account_id=?', [aid]);
      const workplace = H.INV_WORKPLACE.includes(t);
      out[aid] = split_payroll(out[aid], workplace);
      // a snapshot amount outside a workplace plan is money we put in ourselves
      if (!workplace) out[aid] = out[aid].map((f) => (f[2] === 'contribution' && f[3] === 'snapshot' ? [f[0], f[1], f[2], 'personal'] : f));
    }
    return out;
  };

  // [[date, value, 'synced'|'manual']] sorted
  H.inv_valuations = (aid) => {
    const pts = new Map();
    for (const r of H.rows('SELECT as_of, balance FROM balances WHERE account_id=? AND balance IS NOT NULL ORDER BY as_of', [aid])) {
      pts.set(r[0], [r[1], 'synced']);
    }
    for (const r of H.rows('SELECT as_of, balance FROM manual_snapshots WHERE account_id=? AND balance IS NOT NULL ORDER BY as_of', [aid])) {
      if (!pts.has(r[0])) pts.set(r[0], [r[1], 'manual']);
    }
    return Array.from(pts.entries()).map(([d, [v, s]]) => [d, v, s]).sort(pycmp);
  };

  // external flows move value in or out of an account (transfers included); dividends and fees are part of the gain
  H.inv_is_ext = (f) => f[2] === 'contribution' || f[2] === 'withdrawal' || f[2] === 'transfer';
  // value at end of day d -> [value, valuation_date] or [null, null]
  H.inv_value_at = (vals, flows, d) => {
    const i = bisect_right(vals.map((v) => v[0]), d) - 1;
    if (i < 0) return [null, null];
    const [vd, vv] = vals[i];
    const ext = pysum(flows.filter((f) => H.inv_is_ext(f) && vd < f[0] && f[0] <= d)
      .map((f) => f[1]));
    return [vv + ext, vd];
  };

  // cfs: [[date_iso, amount]] investor perspective -> annual rate or null
  H.xirr = (cfs) => {
    const c = cfs.filter(([, a]) => a !== 0 && a !== null && a !== undefined).map(([d, a]) => [ord(fromiso(d)), a]);
    if (c.length < 2 || !(c.some(([, a]) => a > 0) && c.some(([, a]) => a < 0))) return null;
    const d0 = Math.min(...c.map(([d]) => d));
    const ts = c.map(([d, a]) => [(d - d0) / 365.0, a]);
    if (Math.max(...ts.map(([t]) => t)) < 1 / 365) return null;
    const npv = (r) => pysum(ts.map(([t, a]) => a / Math.pow(1 + r, t)));
    let lo = -0.9999, hi = 10.0;
    let flo = npv(lo), fhi = npv(hi);
    if (flo * fhi > 0) return null;
    for (let k = 0; k < 200; k++) {
      const mid = (lo + hi) / 2;
      const fm = npv(mid);
      if (Math.abs(fm) < 1e-7) break;
      if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  };

  H.inv_engine = (accts, start, end) => {
    const ids = accts.map((a) => a.account_id);
    const flows = H.inv_flows(ids);
    const vals = {};
    for (const a of ids) vals[a] = H.inv_valuations(a);
    const firsts = Object.values(vals).filter((v) => v.length).map((v) => v[0][0]);
    const ts = H.today_s();
    end = end < ts ? end : ts;
    if (!firsts.length) return { months: [], by_account: {}, flows, vals };
    const m0 = H.month_of(firsts.reduce((a, b) => (b < a ? b : a)));
    const months = H.month_range(m0, H.month_of(end));
    const rows = [];
    let prev_total = 0.0;
    let prev_by = {};
    const isExt = H.inv_is_ext;
    for (const m of months) {
      const mend = H.month_end(m);
      const me = mend < end ? mend : end;
      const ms = H.month_bounds(m)[0];
      const by = {};
      let initial = 0.0;
      const flows_m = [];
      for (const aid of ids) {
        const [v] = H.inv_value_at(vals[aid], flows[aid], me);
        if (v === null) continue;
        by[aid] = v;
        if (!(aid in prev_by)) {
          const fv = vals[aid][0];
          initial += fv[1];
          flows_m.push([fv[0], fv[1], 'initial']);
          for (const f of flows[aid]) if (isExt(f) && fv[0] < f[0] && f[0] <= me) flows_m.push([f[0], f[1], f[2]]);
        } else {
          for (const f of flows[aid]) if (isExt(f) && ms <= f[0] && f[0] <= me) flows_m.push([f[0], f[1], f[2]]);
        }
      }
      const total = pysum(Object.values(by));
      const net_flow = pysum(flows_m.map((f) => f[1]));
      const Dd = H.days_between(ms, me) + 1;
      let wsum = 0.0;
      for (const [fd, fa] of flows_m) {
        const dd = H.days_between(ms, fd);
        wsum += fa * Math.max(0.0, (Dd - dd) / Dd);
      }
      const denom = prev_total + wsum;
      const gain = total - prev_total - net_flow;
      const ret = denom > 1e-6 ? gain / denom : null;
      const inM = (f, kind) => f[2] === kind && ms <= f[0] && f[0] <= me;
      const all = ids.flatMap((aid) => flows[aid]);
      const contrib = pysum(all.filter((f) => inM(f, 'contribution')).map((f) => f[1]));
      const withdr = pysum(all.filter((f) => inM(f, 'withdrawal')).map((f) => f[1]));
      const divs = pysum(all.filter((f) => inM(f, 'dividend')).map((f) => f[1]));
      const fees = pysum(all.filter((f) => inM(f, 'fee')).map((f) => -f[1]));
      const real_val = ids.some((aid) => vals[aid].some((v) => ms <= v[0] && v[0] <= me));
      const by_r = {};
      for (const k of Object.keys(by)) by_r[k] = r2(by[k]);
      rows.push({
        month: m, date: me, total: r2(total), by_account: by_r, start: r2(prev_total),
        net_flow: r2(net_flow), initial: r2(initial), contributions: r2(contrib), withdrawals: r2(withdr),
        dividends: r2(divs), fees: r2(fees), gain: r2(gain), ret, has_valuation: real_val,
        flows: flows_m.map((f) => [f[0], r2(f[1])]),
      });
      prev_total = total; prev_by = by;
    }
    return { months: rows, flows, vals };
  };

  H.period_stats = (rows, start, end) => {
    const sel = rows.filter((r) => H.month_of(start) <= r.month && r.month <= H.month_of(end));
    if (!sel.length) return null;
    const v0 = sel[0].start || 0.0;
    const v1 = sel[sel.length - 1].total || 0.0;
    const net = pysum(sel.map((r) => r.net_flow));
    let twr = 1.0, n_ret = 0;
    for (const r of sel) {
      if (r.ret !== null && r.ret !== undefined) { twr *= 1 + r.ret; n_ret += 1; }
    }
    const d_start = H.add_days(H.month_bounds(sel[0].month)[0], -1);
    const cfs = [];
    if (v0 > 0) cfs.push([d_start, -v0]);
    for (const r of sel) for (const [fd, fa] of r.flows) cfs.push([fd, -fa]);
    const last = sel[sel.length - 1];
    cfs.push([last.date, v1]);
    const irr = H.xirr(cfs);
    const days = H.days_between(d_start, last.date);
    const valuations = sel.filter((r) => r.has_valuation).length;
    const enough = valuations >= 2 || (v0 > 0 && valuations >= 1);
    const twr_c = n_ret && enough ? twr - 1 : null;
    const twr_a = twr_c !== null && days >= 365 ? Math.pow(1 + twr_c, 365.0 / days) - 1 : null;
    return {
      start_value: r2(v0), end_value: r2(v1), net_flows: r2(net), market_gain: enough ? r2(v1 - v0 - net) : null,
      twr: twr_c, twr_annualized: twr_a, xirr: enough ? irr : null, days, valuations,
      enough_history: enough, start_date: d_start, end_date: last.date,
    };
  };

  // ------------------------------------------------------------------------------------------------------------------
  // shared transaction filtering
  // ------------------------------------------------------------------------------------------------------------------
  // An account that belongs to a property rather than the household (accounts.entity = a property's entity and
  // include_in_totals = 0, e.g. a co-owned property's checking) never counts as household spending or income.
  H.NOT_PROPERTY_ACCT_SQL = `NOT (COALESCE(a.include_in_totals,1)=0 AND a.entity IN (SELECT entity FROM properties WHERE entity IS NOT NULL))`;
  H.SPEND_SQL = `t.is_transfer=0 AND COALESCE(t.category,'') NOT IN ('Income','Transfer','Investments')
  AND a.type NOT IN ('ira','hsa','401k','403b','brokerage','529') AND t.pending=0 AND ${H.NOT_PROPERTY_ACCT_SQL}`;
  H.INCOME_SQL = `t.category='Income' AND t.is_transfer=0 AND a.type NOT IN ('ira','hsa','401k','403b','brokerage','529') AND t.pending=0
  AND ${H.NOT_PROPERTY_ACCT_SQL}`;
  H.SORTS = {
    date: 't.posted_date', amount: 't.amount', description: 't.description', category: 't.category',
    account: 'a.name', merchant: 'merchant_of(t.description)',
  };
  H.RETAILER_SQL = {
    amazon: "(LOWER(t.description) LIKE '%amazon%' OR LOWER(t.description) LIKE '%amzn%') AND t.is_transfer=0",
    target: "LOWER(t.description) LIKE 'target%' AND t.is_transfer=0",
  };
  H.TXN_COLS = `t.txn_id, t.account_id, t.posted_date, t.transacted_date, t.amount, t.description, t.merchant, t.category,
  t.subcategory, t.entity, t.person, t.tags, t.notes, t.pending, t.is_transfer, t.source, t.mcc,
  COALESCE(a.display_name, a.name) AS account, a.holder, a.type AS account_type, merchant_of(t.description) AS merchant_name,
  (SELECT COUNT(*) FROM notes n WHERE n.target_type='transaction' AND n.target_id=t.txn_id) AS note_count,
  (SELECT COUNT(*) FROM order_links l WHERE l.txn_id=t.txn_id) AS order_count`;

  H.first = (q, k, dflt = null) => {
    const v = q ? q[k] : undefined;
    if (Array.isArray(v)) return v.length ? v[0] : dflt;
    return v !== null && v !== undefined ? v : dflt;
  };

  // -> [w, args]
  H.txn_where = (q) => {
    const first = H.first;
    const w = ['1=1'], args = [];
    const s = H.v_date(first(q, 'start'), 'start'), e = H.v_date(first(q, 'end'), 'end');
    if (s) { w.push('t.posted_date>=?'); args.push(s); }
    if (e) { w.push('t.posted_date<=?'); args.push(e); }
    const acc = first(q, 'account');
    if (pybool(acc)) {
      const ids = String(acc).split(',').filter((x) => x).slice(0, 50);
      w.push(`t.account_id IN (${ids.map(() => '?').join(',')})`); args.push(...ids);
    }
    // category / subcategory / person: a split transaction matches through any of its split lines (v3).
    const cat = first(q, 'category');
    if (cat === '__none__') w.push("(t.category IS NULL OR t.category='' OR t.category='Uncategorized')");
    else if (pybool(cat)) { w.push(H.split_or('t.category=?', 's.category=?')); args.push(cat, cat); }
    const sub = first(q, 'subcategory');
    if (sub === '__none__') w.push("(t.subcategory IS NULL OR t.subcategory='')");
    else if (pybool(sub)) { w.push(H.split_or('t.subcategory=?', 's.subcategory=?')); args.push(sub, sub); }
    const person = first(q, 'person');
    if (person === '__none__') w.push(H.split_or('t.person IS NULL', 's.person IS NULL'));
    else if (pybool(person)) { w.push(H.split_or('t.person=?', 's.person=?')); args.push(person, person); }
    const ent = first(q, 'entity');
    if (pybool(ent)) { w.push("COALESCE(t.entity,'household')=?"); args.push(ent); }
    const holder = first(q, 'holder');
    if (pybool(holder)) { w.push('a.holder=?'); args.push(holder); }
    const merch = first(q, 'merchant');
    if (pybool(merch)) { w.push('merchant_of(t.description)=?'); args.push(merch); }
    const src = first(q, 'source');
    if (pybool(src)) { w.push('t.source=?'); args.push(src); }
    const text = first(q, 'q');
    if (pybool(text)) {
      const t = pystrip(text);
      const like = '%' + t + '%';
      w.push(`(t.description LIKE ? OR t.notes LIKE ? OR t.category LIKE ? OR t.subcategory LIKE ? OR t.merchant LIKE ?
                  OR EXISTS (SELECT 1 FROM notes n WHERE n.target_type='transaction' AND n.target_id=t.txn_id AND n.body LIKE ?)
                  OR CAST(ABS(t.amount) AS TEXT) LIKE ?)`);
      args.push(like, like, like, like, like, like, t.split('$').join('').split(',').join('') + '%');
    }
    const mn = H.v_num(first(q, 'min'), 'min'), mx = H.v_num(first(q, 'max'), 'max');
    if (mn !== null) { w.push('ABS(t.amount)>=?'); args.push(mn); }
    if (mx !== null) { w.push('ABS(t.amount)<=?'); args.push(mx); }
    const kind = first(q, 'kind', 'all');
    if (kind === 'spending') w.push(H.SPEND_SQL);
    else if (kind === 'income') w.push(H.INCOME_SQL);
    else if (kind === 'transfers') w.push('t.is_transfer=1');
    else if (kind === 'banking') w.push("a.type NOT IN ('ira','hsa','401k','403b','brokerage','529')");
    if (first(q, 'pending') === '1') w.push('t.pending=1');
    const retailer = first(q, 'retailer');
    if (retailer === 'amazon' || retailer === 'target') w.push(H.RETAILER_SQL[retailer]);
    const linked = first(q, 'linked');
    if (linked === '1') w.push('EXISTS (SELECT 1 FROM order_links l WHERE l.txn_id=t.txn_id)');
    else if (linked === '0') w.push('NOT EXISTS (SELECT 1 FROM order_links l WHERE l.txn_id=t.txn_id)');
    return [w, args];
  };

  // ------------------------------------------------------------------------------------------------------------------
  // splits and spending lines (v3)
  // A transaction with rows in transaction_splits is analysed as those lines (category, subcategory, entity, person,
  // amount); every other transaction is one line. Which transactions count (SPEND_SQL, dates, accounts, holder…) is
  // always decided on the transaction itself, so totals are identical with or without splits.
  // ------------------------------------------------------------------------------------------------------------------
  H.split_or = (txnCond, splitCond) => `((NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.txn_id=t.txn_id) AND ${txnCond})
      OR EXISTS (SELECT 1 FROM transaction_splits s WHERE s.txn_id=t.txn_id AND ${splitCond}))`;
  const LINE_KEYS = new Set(['category', 'subcategory', 'entity', 'person']);
  /* H.spend_lines(q) -> { from, where, args }: use as `SELECT … FROM ${L.from} WHERE ${L.where}` with L.args.
     q is a txn_where query (kind=spending etc.); category/subcategory/entity/person filter the lines, everything else the
     transaction. Columns of l: txn_id, line (null when not split), split (0/1), account_id, account, holder, posted_date,
     description, merchant, category, subcategory, entity, person, amount, txn_amount, source. */
  H.spend_lines = (q) => {
    const txq = {}, lq = {};
    for (const k of Object.keys(q || {})) (LINE_KEYS.has(k) ? lq : txq)[k] = q[k];
    const [w, args] = H.txn_where(txq);
    const lw = [], largs = [];
    const cat = H.first(lq, 'category');
    if (cat === '__none__') lw.push("(l.category IS NULL OR l.category='' OR l.category='Uncategorized')");
    else if (pybool(cat)) { lw.push('l.category=?'); largs.push(cat); }
    const sub = H.first(lq, 'subcategory');
    if (sub === '__none__') lw.push("(l.subcategory IS NULL OR l.subcategory='')");
    else if (pybool(sub)) { lw.push('l.subcategory=?'); largs.push(sub); }
    const ent = H.first(lq, 'entity');
    if (pybool(ent)) { lw.push("COALESCE(l.entity,'household')=?"); largs.push(ent); }
    const person = H.first(lq, 'person');
    if (person === '__none__') lw.push('l.person IS NULL');
    else if (pybool(person)) { lw.push('l.person=?'); largs.push(person); }
    const from = `(SELECT t.txn_id, s.line, CASE WHEN s.txn_id IS NULL THEN 0 ELSE 1 END AS split, t.account_id,
        COALESCE(a.display_name, a.name) AS account, a.holder, t.posted_date, t.description, t.merchant, t.source,
        CASE WHEN s.txn_id IS NULL THEN t.category ELSE s.category END AS category,
        CASE WHEN s.txn_id IS NULL THEN t.subcategory ELSE s.subcategory END AS subcategory,
        CASE WHEN s.txn_id IS NULL THEN t.entity ELSE COALESCE(s.entity, t.entity) END AS entity,
        CASE WHEN s.txn_id IS NULL THEN t.person ELSE COALESCE(s.person, t.person) END AS person,
        CASE WHEN s.txn_id IS NULL THEN t.amount ELSE s.amount END AS amount, t.amount AS txn_amount
      FROM transactions t JOIN accounts a USING(account_id) LEFT JOIN transaction_splits s ON s.txn_id=t.txn_id
      WHERE ${w.join(' AND ')}) l`;
    return { from, where: lw.length ? lw.join(' AND ') : '1=1', args: args.concat(largs) };
  };
  // Split lines of one transaction (with a friendly label for order items).
  H.txn_splits = (tid) => H.Q(`SELECT s.*, i.title AS item_title FROM transaction_splits s
      LEFT JOIN order_items i ON i.order_id=s.order_id AND i.line_no=s.item_line WHERE s.txn_id=? ORDER BY s.line`, [tid]);

  // category -> color slot (0..7); persists newly assigned slots (fire-and-forget: GET handlers are synchronous)
  H.cat_slots = () => {
    const raw = H.setting('cat_slots');
    let slots;
    try {
      slots = raw ? JSON.parse(raw) : {};
    } catch (e) {
      slots = {};
    }
    const L = H.spend_lines({ kind: 'spending' });
    const rank = H.rows(`SELECT l.category FROM ${L.from}
        WHERE ${L.where} AND l.category IS NOT NULL AND l.category NOT IN ('Uncategorized','Other')
        GROUP BY 1 ORDER BY -SUM(l.amount) DESC`, L.args).map((r) => r[0]);
    const used = new Set(Object.values(slots));
    let changed = false;
    for (const c of rank) {
      if (Object.keys(slots).length >= 8) break;
      if (!(c in slots)) {
        let free = null;
        for (let i = 0; i < 8; i++) if (!used.has(i)) { free = i; break; }
        if (free === null) break;
        slots[c] = free;
        used.add(free);
        changed = true;
      }
    }
    if (changed) {
      Promise.resolve().then(() => H.set_setting('cat_slots', pyjson(slots)))
        .catch((e) => { if (g.console) g.console.warn('cat_slots save failed', e); });
    }
    return slots;
  };

  // add a tag to a comma-separated tag string (sorted, de-duplicated)
  H.add_tag = (tags, tag) => {
    const s = new Set((tags || '').split(',').filter((x) => x));
    s.add(tag);
    return Array.from(s).sort(pycmp).join(',');
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
