/* Forecast engine: deterministic projection + Monte Carlo (lognormal monthly returns), all client-side. */
'use strict';
(function () {
  /** Seeded PRNG (mulberry32) + Box–Muller so results are stable between renders and scenarios. */
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const normCache = {};
  function normals(paths, months, seed) {
    const key = `${paths}:${months}:${seed}`;
    if (normCache[key]) return normCache[key];
    const r = rng(seed), z = new Float64Array(paths * months);
    for (let i = 0; i < z.length; i += 2) {
      const u1 = Math.max(r(), 1e-12), u2 = r();
      const m = Math.sqrt(-2 * Math.log(u1));
      z[i] = m * Math.cos(2 * Math.PI * u2);
      if (i + 1 < z.length) z[i + 1] = m * Math.sin(2 * Math.PI * u2);
    }
    Object.keys(normCache).forEach((k) => delete normCache[k]);
    normCache[key] = z;
    return z;
  }
  const quantile = (sorted, q) => {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };
  F.quantile = quantile;

  /**
   * params: start, monthly, growth (%/yr), employer ($/mo), ret (%/yr expected), vol (%/yr), infl (%/yr), real (bool),
   *         horizonYear, targetYear, target, paths, seed, startMonth ('YYYY-MM' of the first projected month)
   */
  F.forecast = (p) => {
    const startMonth = p.startMonth || F.thisMonth();
    const [y0, m0] = startMonth.split('-').map(Number);
    const horizonYear = Math.max(p.horizonYear || y0 + 20, y0);
    const N = Math.max(1, (horizonYear - y0) * 12 + (12 - m0 + 1)); // through December of the horizon year
    const targetYear = Math.min(Math.max(p.targetYear || horizonYear, y0), horizonYear);
    const kT = Math.max(1, (targetYear - y0) * 12 + (12 - m0 + 1));
    const R = (p.ret ?? 7) / 100, S = (p.vol ?? 15) / 100, I = (p.infl ?? 2.5) / 100, G = (p.growth ?? 0) / 100;
    const rm = Math.pow(1 + R, 1 / 12) - 1;
    const sm = S / Math.sqrt(12);
    const mu = Math.log(1 + R) / 12 - (sm * sm) / 2;
    const paths = Math.max(200, Math.min(10000, p.paths || 2000));
    const z = normals(paths, N, p.seed || 20261010);
    const deflate = (k) => (p.real ? Math.pow(1 + I, k / 12) : 1);
    const contribUnit = (k) => Math.pow(1 + G, Math.floor(k / 12)); // $1/mo growing yearly
    const employer = p.employer || 0, monthly = p.monthly || 0, start = p.start || 0;
    // deterministic path
    const det = new Float64Array(N + 1); det[0] = start;
    let cum = 0; const contribCum = new Float64Array(N + 1);
    for (let k = 0; k < N; k++) {
      const c = (monthly + employer) * contribUnit(k);
      det[k + 1] = det[k] * (1 + rm) + c; cum += c; contribCum[k + 1] = cum;
    }
    // Monte Carlo: each path's value is linear in the employee contribution c: V = A + c*B (common random numbers)
    const yearsIdx = [];
    for (let k = 0; k <= N; k++) if (k === 0 || (m0 - 1 + k) % 12 === 0 || k === N) yearsIdx.push(k);
    const snap = yearsIdx.map(() => new Float64Array(paths));
    const AT = new Float64Array(paths), BT = new Float64Array(paths);
    for (let i = 0; i < paths; i++) {
      let A = start, B = 0, yi = 0;
      if (yearsIdx[0] === 0) { snap[0][i] = (A + monthly * B) / deflate(0); yi = 1; }
      for (let k = 0; k < N; k++) {
        const g = Math.exp(mu + sm * z[i * N + k]);
        A = A * g + employer * contribUnit(k);
        B = B * g + contribUnit(k);
        if (k + 1 === kT) { AT[i] = A / deflate(kT); BT[i] = B / deflate(kT); }
        if (yi < yearsIdx.length && yearsIdx[yi] === k + 1) { snap[yi][i] = (A + monthly * B) / deflate(k + 1); yi++; }
      }
    }
    const bands = snap.map((col) => { const s = Array.from(col).sort((a, b) => a - b); return { p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9) }; });
    const target = p.target || 0;
    let hit = null, reqMedian = null, req80 = null;
    if (target > 0) {
      let n = 0;
      const need = new Float64Array(paths);
      for (let i = 0; i < paths; i++) {
        if (AT[i] + monthly * BT[i] >= target) n++;
        need[i] = (target - AT[i]) / BT[i]; // employee $/mo this path needs (can be negative = already enough)
      }
      hit = n / paths;
      const s = Array.from(need).sort((a, b) => a - b);
      reqMedian = Math.max(0, quantile(s, 0.5));
      req80 = Math.max(0, quantile(s, 0.8));
    }
    const years = yearsIdx.map((k, j) => {
      const mm = m0 - 1 + k, yy = y0 + Math.floor(mm / 12);
      return { k, year: k === 0 ? `Now` : String(yy - (mm % 12 === 0 ? 1 : 0)), yearNum: k === 0 ? y0 : yy - (mm % 12 === 0 ? 1 : 0),
        det: det[k] / deflate(k), contributed: contribCum[k] / (p.real ? deflate(k) : 1), ...bands[j] };
    });
    const tIdx = years.findIndex((y) => y.k >= kT);
    return { N, years, hit, reqMedian, req80, target, targetYear, kT, atTarget: years[tIdx >= 0 ? tIdx : years.length - 1], paths, real: !!p.real };
  };
})();
