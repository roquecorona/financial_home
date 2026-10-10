/* Financial Home — Supabase Auth: email + password, emailed sign-in link, sign out, persistent session,
   household allow-list check (rpc finance.whoami), and the login screen (styles: static/login.css). */
'use strict';
(function (g) {
  const CFG = g.SUPABASE_CONFIG || {};
  const Auth = g.Auth = g.Auth || {};
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  Auth.client = null;
  Auth.getClient = () => {
    if (Auth.client) return Auth.client;
    if (!g.supabase || !g.supabase.createClient) throw new Error('supabase-js is not loaded (vendor/supabase.umd.js).');
    Auth.client = g.supabase.createClient(CFG.url, CFG.publishableKey, {
      auth: {
        persistSession: true,          // session survives reloads (localStorage)
        autoRefreshToken: true,
        detectSessionInUrl: true,      // finishes the emailed sign-in link (?code=…)
        flowType: 'pkce',              // query-string code, so the #/ hash router is untouched
        storageKey: 'fin.auth',
      },
    });
    return Auth.client;
  };

  const redirectUrl = () => g.location.origin + g.location.pathname;

  Auth.session = async () => {
    const { data, error } = await Auth.getClient().auth.getSession();
    if (error) { console.warn('[auth]', error); return null; }
    // Drop a leftover ?code= from the sign-in link once it has been exchanged.
    if (g.location && /[?&](code|error_description)=/.test(g.location.search)) {
      g.history.replaceState(null, '', g.location.pathname + g.location.hash);
    }
    return data.session || null;
  };

  Auth.signIn = async (email, password) => {
    const { data, error } = await Auth.getClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.session;
  };

  Auth.sendLink = async (email) => {
    const { error } = await Auth.getClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectUrl(), shouldCreateUser: false },
    });
    if (error) throw error;
  };

  Auth.signOut = async () => {
    let email = null;
    try { email = (await Auth.session())?.user?.email || null; } catch (e) { /* ignore */ }
    try { await Auth.getClient().auth.signOut(); } catch (e) { console.warn('[auth] sign out', e); }
    if (g.DB && g.DB.clearCache) await g.DB.clearCache(email); // do not leave the household's data on a shared device
  };

  // { member, email, display_name }
  Auth.whoami = async () => {
    const { data, error } = await Auth.getClient().schema(CFG.schema || 'finance').rpc('whoami');
    if (error) throw error;
    const r = Array.isArray(data) ? data[0] : data;
    return r || { member: false };
  };

  Auth.onChange = (fn) => Auth.getClient().auth.onAuthStateChange((evt, session) => fn(evt, session));

  /* ---------------------------------------------------------------- login screen */
  const MARK = '<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect x="1" y="1" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 22V12l8-5 8 5v10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 22v-6h6v6" fill="none" stroke="#00875A" stroke-width="2"/></svg>';

  function frame(inner) {
    return `<div class="fh-login"><div class="fh-login__panel">
      <header class="fh-login__head">${MARK}<div><span class="fh-login__kicker">Household</span><h1 class="fh-login__title">Financial Home</h1></div></header>
      ${inner}
      <footer class="fh-login__foot">Private. Access is limited to household members.</footer>
    </div></div>`;
  }

  Auth.renderLogin = (root, { onSignedIn, message } = {}) => {
    root.innerHTML = frame(`
      <form class="fh-login__form" id="fh-login-form" novalidate>
        <label class="fh-login__label" for="fh-email">Email</label>
        <input class="fh-login__input" id="fh-email" type="email" autocomplete="username" inputmode="email" required>
        <label class="fh-login__label" for="fh-pass">Password</label>
        <input class="fh-login__input" id="fh-pass" type="password" autocomplete="current-password">
        <button class="fh-login__btn fh-login__btn--primary" type="submit" id="fh-signin">Sign in</button>
        <div class="fh-login__rule" role="separator"><span>or</span></div>
        <button class="fh-login__btn" type="button" id="fh-link">Email me a sign-in link</button>
        <p class="fh-login__msg" id="fh-msg" role="status" aria-live="polite">${esc(message || '')}</p>
      </form>`);
    const $ = (s) => root.querySelector(s);
    const msg = (t, kind = '') => { const m = $('#fh-msg'); m.textContent = t; m.dataset.kind = kind; };
    const busy = (b) => { ['#fh-signin', '#fh-link'].forEach((s) => ($(s).disabled = b)); };
    try { const last = g.localStorage.getItem('fin.lastEmail'); if (last) $('#fh-email').value = last; } catch (e) { /* ignore */ }
    ($('#fh-email').value ? $('#fh-pass') : $('#fh-email')).focus();
    const email = () => $('#fh-email').value.trim();
    const remember = () => { try { g.localStorage.setItem('fin.lastEmail', email()); } catch (e) { /* ignore */ } };

    $('#fh-login-form').onsubmit = async (e) => {
      e.preventDefault();
      if (!email() || !$('#fh-pass').value) { msg('Enter your email and password.', 'error'); return; }
      busy(true); msg('Signing in…');
      try {
        await Auth.signIn(email(), $('#fh-pass').value);
        remember();
        msg('');
        if (onSignedIn) await onSignedIn();
      } catch (err) {
        msg(/invalid/i.test(err.message || '') ? 'That email and password do not match.' : (err.message || 'Sign in failed.'), 'error');
        $('#fh-pass').select();
      } finally { busy(false); }
    };
    $('#fh-link').onclick = async () => {
      if (!email()) { msg('Enter your email first.', 'error'); $('#fh-email').focus(); return; }
      busy(true); msg('Sending…');
      try {
        await Auth.sendLink(email());
        remember();
        msg(`Check ${email()} for a sign-in link. Open it on this device.`, 'ok');
      } catch (err) {
        msg(/signups? not allowed|not found/i.test(err.message || '') ? 'This account isn’t on the household allow-list.' : (err.message || 'Could not send the link.'), 'error');
      } finally { busy(false); }
    };
  };

  Auth.renderDenied = (root, email) => {
    root.innerHTML = frame(`
      <div class="fh-login__form">
        <span class="fh-login__label">Signed in as</span>
        <p class="fh-login__value">${esc(email || 'unknown')}</p>
        <p class="fh-login__msg" data-kind="error" role="alert">This account isn’t on the household allow-list.</p>
        <button class="fh-login__btn" type="button" id="fh-out">Sign out</button>
      </div>`);
    root.querySelector('#fh-out').onclick = async () => { await Auth.signOut(); g.location.reload(); };
  };

  Auth.renderLoading = (root, text) => {
    if (!root.querySelector('.fh-loading')) {
      root.innerHTML = frame(`<div class="fh-login__form fh-loading">
        <span class="fh-login__label" id="fh-load-label">Loading</span>
        <div class="fh-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="fh-bar"></i></div>
        <p class="fh-login__msg" id="fh-load-msg"></p></div>`);
    }
    const m = root.querySelector('#fh-load-msg'); if (m) m.textContent = text || '';
  };
  Auth.renderProgress = (root, p) => {
    Auth.renderLoading(root, p.phase === 'done' ? 'Preparing…' : `${p.rows.toLocaleString()} rows · ${p.tablesDone} of ${p.tablesTotal} tables`);
    const pct = p.tablesTotal ? Math.round((100 * p.tablesDone) / p.tablesTotal) : 0;
    const bar = root.querySelector('#fh-bar'); if (bar) bar.style.width = pct + '%';
    const pb = root.querySelector('.fh-progress'); if (pb) pb.setAttribute('aria-valuenow', String(pct));
  };
  Auth.renderError = (root, title, detail, onRetry) => {
    root.innerHTML = frame(`<div class="fh-login__form">
      <span class="fh-login__label">${esc(title)}</span>
      <p class="fh-login__msg" data-kind="error" role="alert">${esc(detail || '')}</p>
      <button class="fh-login__btn fh-login__btn--primary" type="button" id="fh-retry">Try again</button>
      <button class="fh-login__btn" type="button" id="fh-out">Sign out</button></div>`);
    root.querySelector('#fh-retry').onclick = () => (onRetry ? onRetry() : g.location.reload());
    root.querySelector('#fh-out').onclick = async () => { await Auth.signOut(); g.location.reload(); };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
