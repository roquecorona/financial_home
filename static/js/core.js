/* Financial home — core: templating, API, formatting, shell, overlays, router. */
'use strict';
const F = (window.F = { pages: {}, state: {}, charts: [] });

/* ---------- safe templating ---------- */
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
function val(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}
function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < vals.length ? val(vals[i]) : ''); });
  return new Raw(out);
}
const raw = (s) => new Raw(s);
F.html = html; F.raw = raw; F.esc = esc;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
F.$ = $; F.$$ = $$;
function setHTML(el, h) { el.innerHTML = h instanceof Raw ? h.s : esc(h); }
F.setHTML = setHTML;

/* ---------- icons (hand-drawn 24px strokes) ---------- */
const ICONS = {
  home: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>',
  accounts: '<rect x="3.5" y="6" width="17" height="13" /><path d="M3.5 10h17"/><path d="M15.5 14.5h2"/>',
  cards: '<rect x="3" y="5.5" width="18" height="13" /><path d="M3 9.5h18"/><path d="M7 15h4"/><path d="m15 14.5 1.5 1.5 3-3"/>',
  bills: '<rect x="4" y="5" width="16" height="15" /><path d="M4 9.5h16M8.5 3.5v3M15.5 3.5v3"/><path d="M8 13.5h3M8 16.5h6"/>',
  spending: '<path d="M4 19.5h16"/><path d="M6.5 16V11M10.5 16V7M14.5 16v-6M18.5 16V9"/>',
  orders: '<path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z"/><path d="m4 7.5 8 3.5 8-3.5M12 11v9"/>',
  investments: '<path d="M4 19.5h16"/><path d="m5 15 4.5-4.5 3.5 3L19 7"/><path d="M15 7h4v4"/>',
  properties: '<path d="M3.5 19.5h17"/><path d="M5.5 19.5V9l6-4 6 4v10.5"/><path d="M9.5 19.5v-5h4v5"/><path d="M17.5 12.5h2v7"/>',
  notes: '<path d="M6 4.5h9l3.5 3.5v11.5H6z"/><path d="M14.5 4.5V8.5h4"/><path d="M9 12.5h6M9 15.5h4"/>',
  manual: '<rect x="4" y="4" width="16" height="16" /><path d="M12 8.5v7M8.5 12h7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6"/>',
  data: '<ellipse cx="12" cy="6.5" rx="7" ry="2.8"/><path d="M5 6.5v11c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-11"/><path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
  auto: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  more: '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4 3 19.5h18z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  ext: '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5 11 13"/><path d="M18 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H10"/>',
  note: '<path d="M5 5.5h14v10H11l-4 3.5v-3.5H5z"/>',
  pin: '<path d="M9 4.5h6l-1 5 3 3H7l3-3z"/><path d="M12 12.5v7"/>',
  edit: '<path d="M4.5 19.5h4l10-10-4-4-10 10z"/><path d="m13 7 4 4"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7"/>',
  chevL: '<path d="m14.5 6-6 6 6 6"/>', chevR: '<path d="m9.5 6 6 6-6 6"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" /><path d="M4 9.5h16M8.5 3.5v3M15.5 3.5v3"/>',
  list: '<path d="M8.5 7h11M8.5 12h11M8.5 17h11"/><path d="M4.5 7h.5M4.5 12h.5M4.5 17h.5"/>',
  logout: '<path d="M14 4.5H6.5v15H14"/><path d="M10.5 12h9M16.5 8.5 20 12l-3.5 3.5"/>',
  bag: '<path d="M5.5 8h13l-1 11.5h-11z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  sync: '<path d="M19.5 12a7.5 7.5 0 0 1-13.2 4.9M4.5 12a7.5 7.5 0 0 1 13.2-4.9"/><path d="M18 3.5v3.6h-3.6M6 20.5v-3.6h3.6"/>',
  rule: '<path d="M4.5 6.5h15M7.5 12h9M10.5 17.5h3"/>',
  download: '<path d="M12 4.5v11M7.5 11l4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>',
};
const icon = (name, cls = '') => raw(`<svg viewBox="0 0 24 24" aria-hidden="true" class="${cls}">${ICONS[name] || ''}</svg>`);
F.icon = icon;
/* Swiss wordmark: two lines of Space Grotesk, no logo tile. */
const BRAND = 'Financial<br>Home';
const BRAND_SHORT = '<span aria-hidden="true">FH</span>';

/* ---------- formatting ---------- */
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = {
  money(v, o = {}) {
    if (v === null || v === undefined || Number.isNaN(v)) return o.blank ?? '—';
    const neg = v < 0; const a = Math.abs(v);
    let s;
    if (o.compact && a >= 1e6) s = '$' + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.0+$/, '') + 'M';
    else if (o.compact && a >= 1e4) s = '$' + (a / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K';
    else s = '$' + (o.cents === false || (o.auto && a >= 1000) ? nf0.format(Math.round(a)) : nf2.format(a));
    if (neg) return (o.paren ? `(${s})` : '−' + s);
    return (o.sign && v > 0 ? '+' : '') + s;
  },
  signed(v, o = {}) { return fmt.money(v, { ...o, sign: true }); },
  num(v, d = 0) { return v === null || v === undefined ? '—' : new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v); },
  pct(v, d = 1, sign = false) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    const s = (Math.abs(v) * 100).toFixed(d) + '%';
    return v < 0 ? '−' + s : (sign && v > 0 ? '+' : '') + s;
  },
  /** Swiss dates: 10.20 this year, 10.20.2025 otherwise; { long } spells it out. */
  date(s, o = {}) {
    if (!s) return o.blank ?? 'Pending';
    const iso = String(s).slice(0, 10);
    if (o.long) return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: o.weekday ? 'long' : undefined, month: 'long', day: 'numeric', year: 'numeric' });
    const [y, m, d] = iso.split('-');
    if (!d) return iso;
    const sameYear = y === F.todayISO().slice(0, 4);
    return sameYear && !o.year ? `${m}.${d}` : `${m}.${d}.${y}`;
  },
  /** Amount without the currency sign, true minus: 1,234.56 / −834.48 (+ when o.sign). */
  amt(v, o = {}) {
    if (v === null || v === undefined || Number.isNaN(v)) return o.blank ?? '—';
    const a = Math.abs(v); const s = o.cents === false ? nf0.format(Math.round(a)) : nf2.format(a);
    if (v < 0 && (o.cents === false ? Math.round(a) > 0 : a >= 0.005)) return '−' + s;
    return (o.sign && v > 0 ? '+' : '') + s;
  },
  month(m, o = {}) {
    if (!m) return '';
    const d = new Date(m.slice(0, 7) + '-15T12:00:00');
    return d.toLocaleDateString('en-US', o.short ? { month: 'short', year: '2-digit' } : o.only ? { month: 'short' } : { month: 'long', year: 'numeric' });
  },
  ago(s) {
    if (!s) return 'never';
    const d = new Date(s.length <= 10 ? s + 'T12:00:00' : s.replace(' ', 'T'));
    const days = Math.round((Date.now() - d.getTime()) / 86400000);
    if (s.length <= 10) { if (days <= 0) return 'today'; if (days === 1) return 'yesterday'; }
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    if (mins < 60 * 24 && s.length > 10) return `${Math.round(mins / 60)} h ago`;
    if (days < 31) return `${days} days ago`;
    return fmt.date(s, { year: true });
  },
  parts(v) {
    const neg = v < 0; const a = Math.abs(v || 0);
    const [d, c] = nf2.format(a).split('.');
    return { neg, d, c };
  },
  label(s) { return (s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()); },
};
F.fmt = fmt;
/** Big figure (Space Grotesk via CSS): whole dollars, no "$", true minus. Screen readers get the full amount. */
F.figure = (v, cls = 'hero-figure') => {
  if (v === null || v === undefined) return html`<div class="${cls}">—</div>`;
  return html`<div class="${cls}" aria-label="${fmt.money(v)}"><span aria-hidden="true">${fmt.amt(v, { cents: false })}</span></div>`;
};
/** KPI figure: whole dollars without "$" (o.cents keeps cents), true minus. */
F.kpiMoney = (v, o = {}) => {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (o.cents) { const p = fmt.parts(v); return raw(`<span aria-label="${esc(fmt.money(v))}">${p.neg && Math.abs(v) >= 0.005 ? '−' : ''}${p.d}<span class="cents">.${p.c}</span></span>`); }
  return raw(`<span aria-label="${esc(fmt.money(v, { cents: false }))}">${esc(fmt.amt(v, { cents: false }))}</span>`);
};
F.delta = (change, { goodWhenUp = true, label = '' } = {}) => {
  if (change === null || change === undefined || !Number.isFinite(change)) return '';
  const up = change > 0.0005, down = change < -0.0005;
  const cls = !up && !down ? 'flat' : (up === goodWhenUp ? 'good' : 'bad');
  const arrow = up ? '↑' : down ? '↓' : '';
  return html`<span class="delta ${cls}">${arrow}${fmt.pct(Math.abs(change), Math.abs(change) < 0.1 ? 1 : 0)}${label ? ' ' + label : ''}</span>`;
};
/** Amount cell: ink with true minus; money coming in is green with a plus. */
F.amtCell = (v, o = {}) => html`<span class="${v > 0 && o.inGreen !== false ? 'pos' : ''}">${fmt.amt(v, { sign: v > 0, cents: o.cents })}</span>`;
F.todayISO = () => {
  const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
F.addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
F.addMonths = (m, k) => { const [y, mo] = m.split('-').map(Number); const i = y * 12 + mo - 1 + k; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };
F.thisMonth = () => F.todayISO().slice(0, 7);
F.debounce = (fn, ms = 400) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---------- user + theme ---------- */
F.state.user = (() => { try { return localStorage.getItem('fin.user') || ''; } catch { return ''; } })();
F.setUser = (u) => {
  F.state.user = u; try { localStorage.setItem('fin.user', u); } catch { /* private mode */ }
  $$('.who button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.user === u)));
  toast(`Edits and notes will be signed ${u}`);
};
/* Light is the default; dark and "match device" are opt-in per device. */
F.theme = (() => { try { const t = localStorage.getItem('fin.theme3'); return ['light', 'dark', 'auto'].includes(t) ? t : 'light'; } catch { return 'light'; } })();
function applyTheme() {
  if (F.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', F.theme);
  const dark = F.theme === 'dark' || (F.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', dark ? '#111110' : '#FFFFFF');
}
applyTheme();
F.themeLabel = (t = F.theme) => ({ light: 'Light', dark: 'Dark', auto: 'Match device' }[t]);
F.setTheme = (t) => {
  F.theme = t;
  try { localStorage.setItem('fin.theme3', F.theme); } catch { /* ignore */ }
  applyTheme();
  $$('#theme-btn, [data-theme-btn]').forEach((b) => { setHTML(b, icon(F.theme === 'dark' ? 'moon' : F.theme === 'light' ? 'sun' : 'auto')); b.title = `Theme: ${F.themeLabel()}`; b.setAttribute('aria-label', `Theme: ${F.themeLabel()}. Change theme`); });
  $$('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === F.theme)));
  $$('[data-theme-label]').forEach((b) => { b.textContent = F.themeLabel(); });
  F.rerenderCharts();
};
F.cycleTheme = () => F.setTheme({ light: 'dark', dark: 'auto', auto: 'light' }[F.theme]);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => F.theme === 'auto' && F.rerenderCharts());
F.css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ---------- API ---------- */
/* v3: no server. F.api dispatches to the in-browser handlers registered on API (js/api/*.js), which run
   against the local sql.js copy of the data (DB). Errors keep v2's behavior: H.ApiError -> toast + err.status. */
F.api = async (path, { method = 'GET', body, quiet = false } = {}) => {
  const m = String(method).toUpperCase();
  if (m !== 'GET' && F.offline()) {
    const msg = 'You’re offline, so this wasn’t saved. Try again when you’re back online.';
    if (!quiet) toast(msg, { kind: 'error', ms: 6000 });
    const e = new Error(msg); e.status = 0; throw e;
  }
  if (m !== 'GET' && body !== undefined) {
    // Same 100 KB body limit and JSON round trip as the v2 server (drops undefined, copies the object).
    const s = JSON.stringify(body);
    if (s.length > 100000) { if (!quiet) toast('Request too large (100 KB max)', { kind: 'error' }); const e = new Error('Request too large (100 KB max)'); e.status = 413; throw e; }
    body = JSON.parse(s);
  }
  let data;
  try {
    data = await API.call(m, path, body);
  } catch (e) {
    if (e.status === 401) { F.showLogin(); throw new Error('login'); }
    let msg = e.message;
    if (!e.status) { console.error('[api]', m, path, e); msg = `Something went wrong: ${e.name || 'Error'}`; e.status = 500; }
    if (!quiet) toast(msg, { kind: 'error', ms: m === 'GET' ? 3800 : 7000 });
    const err = new Error(msg); err.status = e.status; throw err;
  }
  if (data === undefined || data === null) throw new Error('The response was cut off. Try again.');
  return JSON.parse(JSON.stringify(data)); // a fresh copy, exactly what a JSON response would have produced
};
F.get = (path, params) => {
  const q = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  return F.api(path + (q === '?' ? '' : q));
};
F.post = (path, body, o = {}) => F.api(path, { method: 'POST', body: body || {}, ...o });
F.del = (path, params) => F.api(path + '?' + new URLSearchParams(params), { method: 'DELETE' });

/* ---------- toasts ---------- */
function toast(msg, { kind = '', action, onAction, ms = 3800 } = {}) {
  let host = $('.toasts');
  if (!host) { host = document.createElement('div'); host.className = 'toasts'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); document.body.append(host); }
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  if (kind === 'error') t.setAttribute('role', 'alert');
  setHTML(t, html`<span>${msg}</span>${action ? html`<button type="button">${action}</button>` : ''}`);
  if (action) t.querySelector('button').onclick = () => { onAction && onAction(); t.remove(); };
  host.append(t);
  setTimeout(() => t.remove(), ms);
}
F.toast = toast;

/* ---------- overlays ---------- */
const overlay = { stack: [] };
function closeTop() {
  const top = overlay.stack.pop();
  if (!top) return false;
  top.els.forEach((e) => e.remove());
  top.onClose && top.onClose();
  if (top.restore && document.contains(top.restore)) top.restore.focus();
  return true;
}
F.closeOverlay = closeTop;
function trapFocus(el) {
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = $$('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', el).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  });
}
F.drawer = (render, { label = 'Details', onClose } = {}) => {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const el = document.createElement('aside'); el.className = 'drawer'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', label);
  document.body.append(scrim, el);
  const entry = { els: [scrim, el], onClose, restore: document.activeElement };
  overlay.stack.push(entry);
  scrim.onclick = () => closeOverlayEntry(entry);
  trapFocus(el);
  el.tabIndex = -1; el.focus();
  render(el, () => closeOverlayEntry(entry));
  return el;
};
function closeOverlayEntry(entry) {
  const i = overlay.stack.indexOf(entry);
  if (i >= 0) { overlay.stack.splice(i, 1); entry.els.forEach((e) => e.remove()); entry.onClose && entry.onClose(); if (entry.restore && document.contains(entry.restore)) entry.restore.focus(); }
}
/** Modal form. fields html inside <form>; onSubmit(formData obj) may return false to keep open. */
let modalSeq = 0;
F.modal = ({ title, sub = '', body, submit = 'Save', danger, onSubmit, wide = false, onOpen, cancel = 'Cancel', kind = '' }) => {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const el = document.createElement('div'); el.className = 'modal' + (wide ? ' wide' : '') + (kind ? ' ' + kind : ''); el.setAttribute('role', kind === 'confirm' ? 'alertdialog' : 'dialog'); el.setAttribute('aria-modal', 'true');
  const hid = 'mh-' + (++modalSeq); el.setAttribute('aria-labelledby', hid); el.tabIndex = -1;
  setHTML(el, html`<form novalidate>
    <div class="modal-head"><div style="flex:1;min-width:0"><h2 id="${hid}">${title}</h2>${sub ? html`<p>${sub}</p>` : ''}</div>
      <button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
    ${body ? html`<div class="modal-body">${body}</div>` : ''}
    <div class="modal-foot">${danger ? html`<button type="button" class="btn danger" data-danger style="margin-right:auto">${danger.label}</button>` : ''}
      ${cancel ? html`<button type="button" class="btn ghost" data-close>${cancel}</button>` : ''}
      ${submit ? html`<button type="submit" class="btn primary">${submit}</button>` : ''}</div></form>`);
  document.body.append(scrim, el);
  const entry = { els: [scrim, el], restore: document.activeElement };
  overlay.stack.push(entry);
  const close = () => closeOverlayEntry(entry);
  scrim.onclick = close;
  $$('[data-close]', el).forEach((b) => (b.onclick = close));
  trapFocus(el);
  const form = $('form', el);
  if (danger) $('[data-danger]', el).onclick = async () => { if (await danger.onClick()) close(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = {};
    $$('[name]', form).forEach((i) => {
      if (i.type === 'checkbox') data[i.name] = i.checked;
      else if (i.type === 'radio') { if (i.checked) data[i.name] = i.value; }
      else data[i.name] = i.value;
    });
    const btn = $('button[type=submit]', form);
    if (btn) btn.disabled = true;
    try {
      const r = onSubmit ? await onSubmit(data, el) : true;
      if (r !== false) close();
    } catch (err) { /* toast already shown */ } finally { if (btn) btn.disabled = false; }
  };
  // Phones: don't pop the keyboard over the form; focus the dialog itself. Laptops: first field.
  const firstInput = $('input:not([type=hidden]), select, textarea', el);
  if (firstInput && !window.matchMedia('(pointer: coarse)').matches) firstInput.focus();
  else ($('button[type=submit]', el) || el).focus();
  onOpen && onOpen(el, close);
  return { el, close };
};
/** Confirm dialog → Promise<boolean>. Destructive by default (red button); pass { danger: false } for a neutral one. */
F.confirm = (title, sub, label = 'Delete', { danger = true } = {}) => new Promise((resolve) => {
  let ok = false;
  const m = F.modal({ title, sub, body: '', submit: label, kind: 'confirm', onSubmit: () => { ok = true; } });
  const orig = overlay.stack[overlay.stack.length - 1];
  const prev = orig.onClose; orig.onClose = () => { prev && prev(); resolve(ok); };
  if (danger) { $('button[type=submit]', m.el).classList.remove('primary'); $('button[type=submit]', m.el).classList.add('danger'); }
});

/* ---------- meta + helpers ---------- */
F.meta = null;
F.loadMeta = async (force) => { if (!F.meta || force) F.meta = await F.get('/api/meta'); return F.meta; };
F.catColor = (cat) => {
  const s = F.meta && F.meta.cat_slots ? F.meta.cat_slots[cat] : undefined;
  return s === undefined ? F.css('--s-other') : F.css(`--s${s + 1}`);
};
F.catVar = (cat) => {
  const s = F.meta && F.meta.cat_slots ? F.meta.cat_slots[cat] : undefined;
  return s === undefined ? 'var(--s-other)' : `var(--s${s + 1})`;
};
F.categories = () => {
  const m = {};
  (F.meta?.categories || []).forEach((c) => { (m[c.category] = m[c.category] || new Set()); if (c.subcategory) m[c.category].add(c.subcategory); });
  return m;
};
F.catOptions = (sel = '', { blank = 'Choose…' } = {}) => {
  const cats = Object.keys(F.categories()).filter((c) => c !== 'Uncategorized').sort();
  return html`<option value="">${blank}</option>${cats.map((c) => html`<option ${c === sel ? raw('selected') : ''}>${c}</option>`)}`;
};
F.entityOptions = (sel = '', blank = 'household') => html`${(F.meta?.entities || ['household']).map((e) => html`<option ${e === (sel || blank) ? raw('selected') : ''}>${e}</option>`)}`;
F.datalist = (id, items) => html`<datalist id="${id}">${[...items].sort().map((s) => html`<option value="${s}">`)}</datalist>`;
F.avatar = (who) => who ? html`<span class="avatar ${who === 'Jenny' ? 'jenny' : ''}" title="${who}">${who[0]}</span>` : '';
F.empty = (title, text = '', action = '', kind = '') => html`<div class="empty ${kind}" role="${kind === 'error' ? 'alert' : 'status'}"><b>${title}</b>${text ? html`<p>${text}</p>` : ''}${action}</div>`;
F.skeleton = () => html`<div class="skel-page" aria-busy="true" aria-label="Loading"><div class="skel-head"><div class="skel" style="height:40px;width:min(280px,60%)"></div></div>
  <div class="skel-band">${[0, 1, 2, 3].map(() => html`<div><div class="skel" style="height:12px;width:60%"></div><div class="skel" style="height:34px;margin-top:12px;width:80%"></div></div>`)}</div>
  <div class="grid" style="margin-top:0"><div class="span-7"><div class="skel" style="height:14px;width:30%"></div><div class="skel" style="height:240px;margin-top:14px"></div></div><div class="span-5"><div class="skel" style="height:14px;width:40%"></div><div class="skel" style="height:240px;margin-top:14px"></div></div></div></div>`;
F.spark = (vals, { color = 'var(--ink)', w = 96, h = 28 } = {}) => {
  const v = (vals || []).filter((x) => x !== null && x !== undefined);
  if (v.length < 2 || Math.max(...v) === Math.min(...v)) return '';
  const pts = (vals || []).map((x, i) => [i, x]).filter((p) => p[1] !== null && p[1] !== undefined);
  const min = Math.min(...v), max = Math.max(...v), rng = max - min || 1;
  const n = vals.length - 1 || 1;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(p[0] / n * (w - 4) + 2).toFixed(1)},${(h - 3 - (p[1] - min) / rng * (h - 6)).toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return raw(`<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" stroke="${color}"/><rect x="${(last[0] / n * (w - 4) + 2 - 2.5).toFixed(1)}" y="${(h - 3 - (last[1] - min) / rng * (h - 6) - 2.5).toFixed(1)}" width="5" height="5" fill="${color}"/></svg>`);
};

/* ---------- router ---------- */
/* Numbered navigation: 01 Home … 09 Notes, then Settings. Hand-entered records live where they belong
   (accounts on Accounts, transactions on Spending and in the transaction drawer, past balances on Investments,
   ledger entries on Properties), so there is no separate "Manual entry" screen. */
const NAV = [['home', 'Home'], ['accounts', 'Accounts'], ['cards', 'Pay cards'], ['bills', 'Bills'], ['spending', 'Spending'],
  ['orders', 'Orders'], ['investments', 'Investments'], ['properties', 'Properties'], ['notes', 'Notes']].map(([p, l], i) => [p, l, String(i + 1).padStart(2, '0')]);
const NAV2 = [['settings', 'Settings', '10']];
const NAV_NUM = Object.fromEntries([...NAV, ...NAV2].map(([p, , n]) => [p, n]));
/* Phone tab bar: the five things done most from a phone, then More. */
const MOBILE = [['home', 'Home'], ['cards', 'Cards'], ['bills', 'Bills'], ['spending', 'Spending'], ['accounts', 'Accounts']];
F.NAV = NAV; F.NAV2 = NAV2;
F.parseHash = () => {
  const h = location.hash.replace(/^#\/?/, '') || 'home';
  const [path, qs] = h.split('?');
  const parts = path.split('/').map(decodeURIComponent);
  return { page: parts[0] || 'home', id: parts[1], rest: parts.slice(2), params: Object.fromEntries(new URLSearchParams(qs || '')) };
};
F.go = (hash) => { if (location.hash === hash) F.route(); else location.hash = hash; };
F.setParams = (params, { replace = true } = {}) => {
  const r = F.parseHash();
  const base = '#/' + [r.page, r.id, ...r.rest].filter(Boolean).map(encodeURIComponent).join('/');
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  const url = base + (q ? '?' + q : '');
  if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
};
F.destroyCharts = () => { F.charts.forEach((c) => { try { c.destroy(); } catch { /* ignore */ } }); F.charts = []; };
F.rerenderCharts = () => { if (F.current && F.current.rerender) F.current.rerender(); else F.route(); };
let routeSeq = 0;
F.route = async () => {
  const r = F.parseHash();
  if (r.page === 'txn' && r.id) { F.openTxn(r.id); history.replaceState(null, '', '#/spending'); r.page = 'spending'; }
  // Old "Manual entry" links (bookmarks, notes): accounts → Accounts, transactions → Spending with the add form open.
  if (r.page === 'manual') {
    const to = r.params.tab === 'accounts' ? (r.params.id ? `#/accounts/manual-${r.params.id}` : `#/accounts${r.params.new === '1' ? '?new=1' : ''}`) : '#/spending?add=1';
    history.replaceState(null, '', to); return F.route();
  }
  const page = F.pages[r.page] ? r.page : 'home';
  const seq = ++routeSeq;
  while (overlay.stack.length) closeTop();
  F.destroyCharts();
  $$('.nav-link, .mobile-nav a').forEach((a) => { const on = a.dataset.page === page; a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const moreBtn = $('#more-btn'); if (moreBtn) moreBtn.classList.toggle('active', !MOBILE.some((m) => m[0] === page));
  const root = $('#content');
  setHTML(root, F.skeleton());
  window.scrollTo(0, 0);
  try {
    await F.loadMeta();
    const ctl = { root, r, alive: () => seq === routeSeq };
    F.current = ctl;
    await F.pages[page](root, r, ctl);
    const h1 = $('h1', root);
    document.title = (h1 ? h1.textContent.trim() + ' · ' : '') + 'Financial home';
  } catch (e) {
    if (e.message === 'login' || seq !== routeSeq) return;
    console.warn(e);
    setHTML(root, html`<div class="page-head"><div><h1>${(NAV.concat(NAV2).find((n) => n[0] === page) || [, 'Page'])[1]}</h1></div></div>
      ${F.empty('This page couldn’t load', e.message || 'Unexpected error', html`<button type="button" class="btn" data-retry>Try again</button>`, 'error')}`);
    const rb = $('[data-retry]', root); if (rb) rb.onclick = () => F.route();
  }
};
F.refresh = () => { const y = window.scrollY; F.route().then(() => window.scrollTo(0, y)); };

/* ---------- shell ---------- */
const signOut = async () => {
  try { await (F.signOut ? F.signOut() : F.post('/api/logout', {})); } catch { /* the reload shows the login screen either way */ }
  location.reload();
};
F.renderShell = () => {
  const app = $('#app');
  const link = ([p, label, n]) => html`<a class="nav-link" href="#/${p}" data-page="${p}"><span class="n" aria-hidden="true">${n}</span><span>${label}</span></a>`;
  setHTML(app, html`<a class="skip" href="#content">Skip to content</a><div class="shell">
    <nav class="sidebar" aria-label="Main">
      <a class="brand" href="#/home" aria-label="Financial Home, home">${raw(BRAND)}</a>
      <div class="nav">${NAV.map(link)}<div class="nav-end"></div></div>
      <div class="nav secondary">${NAV2.map(link)}</div>
      <div class="sidebar-foot">
        <div><span class="label">Signed in</span><div class="who-name">${F.state.user || '—'}</div></div>
        <div class="row wrap" style="gap:6px 14px"><button type="button" class="linkbtn" data-theme-cycle>Theme: <span data-theme-label>${F.themeLabel()}</span></button><button type="button" class="linkbtn" id="logout">Sign out</button></div>
      </div>
    </nav>
    <div class="main">
      <header class="topbar">
        <a class="brand show-sm" href="#/home" aria-label="Financial Home, home">${raw(BRAND_SHORT)}</a>
        <div class="search" role="search">${icon('search')}<input id="gsearch" type="search" placeholder="Search transactions, merchants, notes, orders" autocomplete="off" enterkeyhint="search" aria-label="Search everything" aria-controls="gresults" aria-autocomplete="list"><kbd aria-hidden="true">/</kbd>
          <div class="search-results hidden" id="gresults" role="listbox" aria-label="Search results"></div></div>
        <div class="topbar-right"><button type="button" class="icon-btn" id="theme-btn" title="Theme: ${F.themeLabel()}" aria-label="Theme: ${F.themeLabel()}. Change theme">${icon(F.theme === 'dark' ? 'moon' : F.theme === 'light' ? 'sun' : 'auto')}</button></div>
      </header>
      <main class="content" id="content" tabindex="-1"></main>
    </div>
    <nav class="mobile-nav" aria-label="Main">${MOBILE.map(([p, l]) => html`<a href="#/${p}" data-page="${p}"><span class="n" aria-hidden="true">${NAV_NUM[p]}</span><span>${l}</span></a>`)}
      <button type="button" id="more-btn" aria-haspopup="dialog" aria-expanded="false"><span class="n" aria-hidden="true">+</span><span>More</span></button></nav>
  </div>`);
  $('#theme-btn').onclick = F.cycleTheme;
  $('[data-theme-cycle]').onclick = F.cycleTheme;
  $('#logout').onclick = signOut;
  $('#more-btn').onclick = openMore;
  window.addEventListener('scroll', () => $('.topbar')?.classList.toggle('scrolled', window.scrollY > 4), { passive: true });
  if (window.innerWidth < 600) $('#gsearch').placeholder = 'Search';
  initSearch();
};
/* More sheet (phones): the rest of the numbered nav, theme, sign out. */
function openMore() {
  const btn = $('#more-btn');
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const el = document.createElement('div'); el.className = 'more-sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'More');
  const cur = F.parseHash().page;
  const rest = [...NAV, ...NAV2].filter(([p]) => !MOBILE.some((m) => m[0] === p));
  setHTML(el, html`<div class="ms-head"><span class="label">More</span><button type="button" class="icon-btn bare" data-close aria-label="Close">${icon('x')}</button></div>
    ${rest.map(([p, l, n]) => html`<a href="#/${p}" class="${p === cur ? 'active' : ''}" ${p === cur ? raw('aria-current="page"') : ''}><span class="n" aria-hidden="true">${n}</span><span>${l}</span></a>`)}
    <div class="ms-prefs ms-sync"><span class="label" style="width:100%">Data</span><span class="small ink2" data-sync-text>${F.syncText()}</span><button type="button" class="btn sm" data-ms-refresh>Refresh</button></div>
    <div class="ms-prefs"><span class="label" style="width:100%">Theme</span><div class="seg" role="group" aria-label="Theme">${['light', 'dark', 'auto'].map((t) => html`<button type="button" data-theme-set="${t}" aria-pressed="${String(F.theme === t)}">${F.themeLabel(t)}</button>`)}</div></div>
    <button type="button" class="ms-item" id="ms-logout"><span class="n" aria-hidden="true">→</span><span>Sign out${F.state.user ? ` (${F.state.user})` : ''}</span></button>`);
  document.body.append(scrim, el);
  const entry = { els: [scrim, el], restore: btn, onClose: () => btn.setAttribute('aria-expanded', 'false') };
  overlay.stack.push(entry);
  btn.setAttribute('aria-expanded', 'true');
  const close = () => closeOverlayEntry(entry);
  scrim.onclick = close;
  $('[data-close]', el).onclick = close;
  $$('a', el).forEach((a) => a.addEventListener('click', close));
  $$('[data-theme-set]', el).forEach((b) => (b.onclick = () => F.setTheme(b.dataset.themeSet)));
  $('#ms-logout', el).onclick = signOut;
  $('[data-ms-refresh]', el).onclick = () => { close(); F.refreshData(); };
  trapFocus(el);
  ($('a.active', el) || $('a', el)).focus();
}

/* ---------- global search ---------- */
function initSearch() {
  const input = $('#gsearch'), box = $('#gresults');
  let sel = -1, items = [];
  const close = () => { box.classList.add('hidden'); sel = -1; };
  const run = F.debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { close(); return; }
    let d;
    try { d = await F.get('/api/search', { q }); } catch { return; }
    if (input.value.trim() !== q) return;
    const groups = [];
    if (d.accounts.length) groups.push(['Accounts', d.accounts.map((a) => ({ href: `#/accounts/${encodeURIComponent(a.account_id)}`, t: a.name, m: `${fmt.label(a.type)} · ${a.holder || ''}` }))]);
    if (d.merchants.length) groups.push(['Merchants', d.merchants.map((m) => ({ href: `#/spending?merchant=${encodeURIComponent(m.merchant)}&preset=all`, t: m.merchant, m: `${m.n} transactions`, a: fmt.money(m.total) }))]);
    if (d.transactions.length) groups.push(['Transactions', d.transactions.map((t) => ({ txn: t.txn_id, t: t.merchant_name, m: `${fmt.date(t.posted_date)} · ${t.account}`, a: fmt.money(t.amount) }))]);
    if (d.orders.length) groups.push(['Orders', d.orders.map((o) => ({ href: `#/orders?id=${encodeURIComponent(o.order_id)}`, t: o.title || o.label, m: `${o.label} · ${fmt.date(o.order_date)}`, a: fmt.money(o.total) }))]);
    if (d.notes.length) groups.push(['Notes', d.notes.map((n) => ({ href: n.link, t: n.body.slice(0, 80), m: `${n.author || 'Someone'} on ${n.target_label}` }))]);
    if (d.bills.length) groups.push(['Bills', d.bills.map((b) => ({ href: '#/bills', t: b.item, m: b.due_day ? `Due on the ${b.due_day}` : 'No due day', a: fmt.money(b.amount) }))]);
    if ((d.properties || []).length) groups.push(['Properties', d.properties.map((p) => ({ href: `#/properties/${p.id}`, t: p.name, m: p.status }))]);
    items = groups.flatMap((g) => g[1]);
    let i = 0;
    setHTML(box, groups.length ? html`${groups.map(([g, list]) => html`<div class="sr-group"><h4>${g}</h4>${list.map((it) => html`<button type="button" class="sr-item" data-i="${i++}" role="option">
      <div class="grow"><div class="ellipsis" style="font-weight:550">${it.t}</div><div class="ellipsis small muted">${it.m}</div></div>${it.a ? html`<span class="num" style="font-weight:600">${it.a}</span>` : ''}</button>`)}</div>`)}
      <div class="sr-group"><button type="button" class="sr-item" data-all="1"><div class="grow">See all transactions matching “${q}”</div></button></div>`
      : html`<div class="empty"><b>Nothing matches “${q}”</b><p>Try a merchant, an amount like 54.20, or a word from a note.</p></div>`);
    box.classList.remove('hidden'); sel = -1;
    $$('.sr-item', box).forEach((b) => (b.onclick = () => pick(b)));
  }, 220);
  const pick = (b) => {
    close(); input.blur();
    if (b.dataset.all) { F.go(`#/spending?q=${encodeURIComponent(input.value.trim())}&preset=all&kind=all`); return; }
    const it = items[+b.dataset.i];
    if (it.txn) F.openTxn(it.txn); else F.go(it.href);
  };
  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) run(); });
  input.addEventListener('keydown', (e) => {
    const opts = $$('.sr-item', box);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!opts.length) return;
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
      opts.forEach((o, i) => o.classList.toggle('sel', i === sel)); opts[sel].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (sel >= 0 && opts[sel]) pick(opts[sel]); else if (input.value.trim()) { close(); F.go(`#/spending?q=${encodeURIComponent(input.value.trim())}&preset=all&kind=all`); }
    } else if (e.key === 'Escape') { close(); input.blur(); }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) close(); });
}

/* ---------- keyboard ---------- */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && closeTop()) { e.preventDefault(); return; }
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); $('#gsearch')?.focus(); return; }
  if (F._g) {
    const map = { h: 'home', a: 'accounts', s: 'spending', c: 'cards', b: 'bills', i: 'investments', p: 'properties', o: 'orders', n: 'notes', ',': 'settings' };
    if (map[e.key]) F.go('#/' + map[e.key]);
    F._g = false; return;
  }
  if (e.key === 'g') { F._g = true; setTimeout(() => (F._g = false), 900); }
});

/* ---------- login ---------- */
/* v3 session: Supabase Auth (js/data/auth.js) + DB.init (js/data/db.js). */
F.showLogin = (message) => {
  F.destroyCharts();
  F.booted = false;
  Auth.renderLogin($('#app'), { onSignedIn: boot, message: typeof message === 'string' ? message : '' });
};
// Sign out: ends the Supabase session, clears this user's cached data, returns to the login screen.
F.signOut = async () => {
  if (F.localMode()) { location.href = location.pathname; return; }
  try { await Auth.signOut(); } catch (e) { console.warn('[auth] sign out', e); }
  DB.ready = false; DB.user = null;
  F.showLogin();
};

// Dev-only test mode: http://localhost:<port>/?local=1 loads a SQLite file from the dev server
// (tests/dev_server.py serves it at __dev__/snapshot.db). It never activates on the public site.
F.localMode = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && new URLSearchParams(location.search).get('local') === '1';

const REFRESH_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/></svg>';
/* ---------- sync status, offline, refresh ---------- */
F.offline = () => typeof navigator !== 'undefined' && navigator.onLine === false && typeof DB !== 'undefined' && DB.backend === 'supabase';
/** "Updated 4 min ago" / "Updating…" / "Offline · saved copy from 9:12". */
F.syncText = () => {
  if (typeof DB === 'undefined' || !DB.loadedAt) return '';
  if (DB.refreshing) return 'Updating…';
  const when = fmt.ago(DB.loadedAt);
  if (F.offline()) return `Offline · copy from ${when}`;
  return DB.backend === 'local' ? 'Local snapshot' : `Updated ${when}`;
};
F.updateSyncStatus = () => {
  $$('[data-sync-text]').forEach((el) => { el.textContent = F.syncText(); });
  const b = $('#refresh-data');
  if (b) { const busy = typeof DB !== 'undefined' && DB.refreshing; b.classList.toggle('spinning', !!busy); if (busy) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy'); b.title = 'Refresh data · ' + F.syncText(); }
  document.body.classList.toggle('is-offline', F.offline());
  const banner = $('#offline-banner');
  if (banner) banner.hidden = !F.offline();
};
let refreshFailed = 0;
F.refreshData = async ({ quiet = false } = {}) => {
  if (DB.backend !== 'supabase') { if (!quiet) toast('This is the local snapshot; there is nothing to refresh.'); return; }
  if (F.offline()) { if (!quiet) toast('You’re offline. The copy on this device is shown until the connection is back.', { kind: 'error' }); return; }
  F.manualRefresh = !quiet;
  F.updateSyncStatus();
  try {
    await DB.refresh();
    refreshFailed = 0;
  } catch (e) {
    if (e.code === 401 || e.status === 401) { F.showLogin('Your session ended. Sign in again.'); return; }
    refreshFailed++;
    if (!quiet || refreshFailed === 1) toast(`Couldn’t refresh: ${e.msg || e.message}. Showing the copy saved on this device.`, { kind: 'error', ms: 6000 });
  } finally { F.manualRefresh = false; F.updateSyncStatus(); }
};
F.dataStatus = () => F.syncText();
/** True while someone is mid-edit: typing in a field, a dialog or drawer open, or a save in flight. */
F.isBusy = () => {
  const a = document.activeElement;
  if (overlay.stack.length || $('.popover')) return true;
  if (a && a.closest && a.closest('#content') && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return true;
  return !!$('#content .saved-flag:not(:empty)');
};
/* Fresh data landed in the background. Re-render now unless that would wipe out an edit in progress;
   then offer it instead. */
F.onDataRefreshed = () => {
  F.meta = null;
  F.updateSyncStatus();
  if (!F.booted) return;
  if (F.isBusy() && !F.manualRefresh) {
    toast('Newer data is ready', { action: 'Show it', onAction: () => F.refresh(), ms: 12000 });
    return;
  }
  F.refresh();
  if (F.manualRefresh) toast('Data refreshed');
};
function addRefreshControl() {
  const right = $('.topbar-right');
  if (!right || $('#refresh-data')) return;
  const st = document.createElement('span');
  st.className = 'sync-status hide-sm'; st.setAttribute('data-sync-text', ''); st.setAttribute('aria-live', 'polite');
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'refresh-data'; b.className = 'icon-btn fh-refresh';
  b.setAttribute('aria-label', 'Refresh data');
  b.innerHTML = REFRESH_SVG;
  b.onclick = () => F.refreshData();
  right.insertBefore(b, $('#theme-btn', right));
  right.insertBefore(st, b);
  const banner = document.createElement('div');
  banner.id = 'offline-banner'; banner.className = 'offline-banner'; banner.setAttribute('role', 'status'); banner.hidden = true;
  banner.textContent = 'You’re offline. Showing the copy saved on this device; changes can’t be saved until you’re back online.';
  $('.main').insertBefore(banner, $('#content'));
  if (typeof DB !== 'undefined' && DB.onChange) DB.onChange((k) => { if (k === 'refreshing' || k === 'idle') F.updateSyncStatus(); });
  window.addEventListener('online', () => { F.updateSyncStatus(); toast('Back online'); F.refreshData({ quiet: true }); });
  window.addEventListener('offline', F.updateSyncStatus);
  // Opening the app again after a while (phones keep the tab alive): fetch what changed.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    const age = DB.loadedAt ? Date.now() - new Date(DB.loadedAt).getTime() : Infinity;
    if (hiddenAt && age > 10 * 60000 && !DB.refreshing) F.refreshData({ quiet: true });
  });
  setInterval(F.updateSyncStatus, 60000);
  initPullToRefresh();
  F.updateSyncStatus();
}
/* Pull down at the top of a page on a phone to refresh (installed web apps have no browser pull-to-refresh). */
function initPullToRefresh() {
  if (!window.matchMedia('(pointer: coarse)').matches) return;
  const ind = document.createElement('div');
  ind.className = 'ptr'; ind.setAttribute('aria-hidden', 'true'); ind.innerHTML = REFRESH_SVG;
  document.body.append(ind);
  let y0 = null, dy = 0;
  const reset = () => { y0 = null; dy = 0; ind.style.transform = ''; ind.classList.remove('armed', 'show'); };
  document.addEventListener('touchstart', (e) => {
    if (window.scrollY > 0 || overlay.stack.length || e.touches.length !== 1 || !e.target.closest('#content')) return;
    y0 = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0 || window.scrollY > 0) { reset(); return; }
    const d = Math.min(dy, 120);
    ind.classList.add('show'); ind.classList.toggle('armed', dy > 80);
    ind.style.transform = `translateY(${d * 0.6}px) rotate(${d * 3}deg)`;
  }, { passive: true });
  document.addEventListener('touchend', () => { const go = y0 !== null && dy > 80; reset(); if (go) F.refreshData(); }, { passive: true });
}

async function startApp() {
  if (DB.user) { F.state.user = DB.user; try { localStorage.setItem('fin.user', DB.user); } catch { /* ignore */ } }
  F.renderShell();
  addRefreshControl();
  window.onhashchange = F.route;
  F.booted = true;
  await F.route();
}

async function boot() {
  const app = $('#app');
  if (F.localMode()) {
    Auth.renderLoading(app, 'Loading local snapshot…');
    try {
      await DB.init({ backend: 'local', url: '__dev__/snapshot.db', user: new URLSearchParams(location.search).get('user') || 'Roque' });
    } catch (e) { Auth.renderError(app, 'Local snapshot unavailable', e.message, boot); return; }
    await startApp();
    return;
  }
  let session;
  try { session = await Auth.session(); } catch (e) { Auth.renderError(app, 'Can’t reach the sign-in service', e.message, boot); return; }
  if (!session) { F.showLogin(); return; }
  let who;
  try { who = await Auth.whoami(); } catch (e) { Auth.renderError(app, 'Can’t check access', e.message, boot); return; }
  if (!who || !who.member) { Auth.renderDenied(app, (who && who.email) || session.user.email); return; }
  DB.user = who.display_name || session.user.email;
  try {
    await DB.init({
      backend: 'supabase', client: Auth.getClient(), email: session.user.email,
      onProgress: (p) => { if (!F.booted) Auth.renderProgress(app, p); },
      onRefreshed: () => F.onDataRefreshed(),
    });
  } catch (e) {
    if (e.code === 401) { F.showLogin('Your session ended. Sign in again.'); return; }
    Auth.renderError(app, 'Couldn’t load the data', e.msg || e.message, boot);
    return;
  }
  await startApp();
}
F.boot = boot;
// Signing out in another tab (or the session expiring) returns this tab to the login screen.
if (!F.localMode()) {
  try { Auth.onChange((evt) => { if (evt === 'SIGNED_OUT' && F.booted) F.showLogin(); }); } catch (e) { console.warn(e); }
}
