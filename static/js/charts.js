/* Chart.js theming + helpers — Swiss Precision: hairline grid, ink and one accent, square marks, straight lines.
   Colors come from CSS tokens so light and dark are each chosen, not flipped. Touch: tap or drag to scrub, tap
   outside to dismiss; the tooltip is large enough to read on a phone. */
'use strict';
(function () {
  const { fmt, css } = F;
  const C = window.Chart;
  F.hasCharts = !!C;
  if (!C) return;
  const coarse = () => window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 760;
  C.defaults.font.family = getComputedStyle(document.body).fontFamily || 'Archivo, system-ui, sans-serif';
  C.defaults.font.size = 12;
  C.defaults.animation = false; // Swiss: charts appear, they don't grow (and it's faster)
  C.defaults.maintainAspectRatio = false;
  C.defaults.responsive = true;
  C.defaults.plugins.legend.display = false;
  C.defaults.elements.line.borderWidth = 2;
  C.defaults.elements.line.borderJoinStyle = 'miter';
  C.defaults.elements.line.borderCapStyle = 'butt';
  C.defaults.elements.point.radius = 0;
  C.defaults.elements.point.pointStyle = 'rect';
  C.defaults.elements.point.hoverRadius = 5;
  C.defaults.elements.point.hitRadius = 12;
  C.defaults.elements.point.hoverBorderWidth = 2;
  C.defaults.elements.bar.borderRadius = 0;
  C.defaults.events = ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove'];

  /** Compact money for axes and short labels: 12K, −1.2M (no "$" — the section label says what it is). */
  F.money = (v) => fmt.money(v, { compact: Math.abs(v) >= 10000, cents: Math.abs(v) < 100 ? undefined : false });
  F.tick = (v) => {
    const a = Math.abs(v);
    const s = a >= 1e6 ? (a / 1e6).toFixed(a % 1e6 ? 1 : 0) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(a % 1e3 ? (a >= 1e4 ? 0 : 1) : 0) + 'K' : String(Math.round(a));
    return (v < 0 ? '−' : '') + s;
  };
  F.alpha = (hex, a) => {
    const h = String(hex).replace('#', '');
    if (!/^[0-9a-f]{3,8}$/i.test(h)) return hex;
    const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  /** Common options; kind = 'line' | 'bar' | 'hbar'. */
  F.chartOpts = ({ kind = 'line', stacked = false, money = true, yMin, legend = false, tooltipTitle, xType = 'category', yTitle, beginAtZero } = {}) => {
    const ink = css('--ink'), page = css('--page'), muted = css('--muted'), grid = css('--grid'), axis = css('--axis');
    const touch = coarse();
    const valueAxis = {
      stacked, grid: { color: grid, drawTicks: false, lineWidth: 1 }, border: { display: false },
      ticks: { color: muted, padding: 8, maxTicksLimit: touch ? 5 : 6, callback: money ? (v) => F.tick(v) : undefined, font: { size: 11.5 } },
      beginAtZero: beginAtZero ?? kind !== 'line', min: yMin,
      title: yTitle ? { display: true, text: yTitle, color: muted, font: { size: 11.5 } } : undefined,
    };
    const catAxis = {
      stacked, type: xType, grid: { display: false }, border: { color: axis },
      ticks: { color: muted, padding: 6, maxRotation: 0, autoSkip: true, autoSkipPadding: touch ? 18 : 14, font: { size: 11.5 } },
    };
    return {
      interaction: kind === 'hbar' ? { mode: 'nearest', axis: 'y', intersect: true } : { mode: 'index', intersect: false },
      layout: { padding: { top: 8, right: 4 } },
      plugins: {
        legend: { display: legend },
        tooltip: {
          backgroundColor: ink, titleColor: page, bodyColor: page, footerColor: page, borderWidth: 0,
          padding: touch ? 12 : 10, cornerRadius: 0, caretSize: 0, boxPadding: 6, boxWidth: 9, boxHeight: 9,
          titleFont: { weight: '700', size: touch ? 13.5 : 12.5 }, bodyFont: { size: touch ? 13.5 : 12.5 }, footerFont: { weight: '700', size: touch ? 13.5 : 12.5 },
          titleMarginBottom: 6, displayColors: true, usePointStyle: false,
          position: touch ? 'nearest' : 'average', yAlign: touch ? 'bottom' : undefined,
          callbacks: {
            title: tooltipTitle,
            label: (ctx) => {
              const v = ctx.parsed[kind === 'hbar' ? 'x' : 'y'];
              if (v === null || v === undefined) return null;
              return ` ${ctx.dataset.label ? ctx.dataset.label + '  ' : ''}${money ? fmt.amt(v, { cents: Math.abs(v) < 1000 ? undefined : false }) : fmt.num(v, 1)}`;
            },
            labelColor: (ctx) => {
              const c = ctx.dataset.borderColor && ctx.dataset.borderColor !== 'transparent' && ctx.dataset.type !== 'bar' && ctx.chart.config.type === 'line' ? ctx.dataset.borderColor : (Array.isArray(ctx.dataset.backgroundColor) ? ctx.dataset.backgroundColor[ctx.dataIndex] : ctx.dataset.backgroundColor);
              return { borderColor: page, backgroundColor: c, borderWidth: 1, borderRadius: 0 };
            },
          },
        },
      },
      scales: kind === 'hbar' ? { x: valueAxis, y: { ...catAxis, type: 'category', ticks: { ...catAxis.ticks, autoSkip: false } } } : { x: catAxis, y: valueAxis },
    };
  };

  /* A thin vertical rule under the active index (crosshair) — the scrub position on touch. */
  const crosshair = {
    id: 'fhCrosshair',
    afterDatasetsDraw(ch) {
      if (ch.config.type !== 'line') return;
      const act = ch.tooltip && ch.tooltip.getActiveElements && ch.tooltip.getActiveElements();
      if (!act || !act.length) return;
      const x = act[0].element.x, { top, bottom } = ch.chartArea, cx = ch.ctx;
      cx.save(); cx.strokeStyle = css('--ink'); cx.lineWidth = 1; cx.globalAlpha = 0.35;
      cx.beginPath(); cx.moveTo(Math.round(x) + 0.5, top); cx.lineTo(Math.round(x) + 0.5, bottom); cx.stroke(); cx.restore();
    },
  };

  /* Dismiss any open tooltip when the person taps elsewhere (touch has no mouseout). */
  document.addEventListener('touchstart', (e) => {
    F.charts.forEach((ch) => {
      if (ch.canvas && !ch.canvas.contains(e.target) && ch.tooltip && ch.tooltip.getActiveElements().length) {
        ch.tooltip.setActiveElements([], { x: 0, y: 0 }); ch.setActiveElements([]); ch.update('none');
      }
    });
  }, { passive: true });

  /** Create a chart in a .chart container; tracked so navigation/theme can destroy it. */
  F.chart = (el, cfg) => {
    if (!el) return null;
    el.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    if (cfg.aria) canvas.setAttribute('aria-label', cfg.aria);
    el.append(canvas);
    cfg.plugins = [...(cfg.plugins || []), crosshair];
    const ch = new C(canvas, cfg);
    F.charts.push(ch);
    return ch;
  };
  F.barDs = (label, data, color, extra = {}) => ({
    label, data, backgroundColor: color, hoverBackgroundColor: color, maxBarThickness: 22, borderRadius: 0, borderSkipped: 'start', ...extra,
  });
  F.stackDs = (label, data, color) => ({
    label, data, backgroundColor: color, hoverBackgroundColor: color, maxBarThickness: 28, borderRadius: 0,
    borderColor: css('--page'), borderWidth: { top: 1, bottom: 0, left: 0, right: 0 }, borderSkipped: false,
  });
  F.lineDs = (label, data, color, extra = {}) => ({
    label, data, borderColor: color, backgroundColor: color, pointHoverBackgroundColor: color, pointHoverBorderColor: css('--page'),
    tension: 0, spanGaps: true, ...extra,
  });
  F.areaDs = (label, data, color, extra = {}) => F.lineDs(label, data, color, { fill: 'start', backgroundColor: F.alpha(color, 0.08), ...extra });
  F.legend = (items) => F.html`<div class="legend">${items.map((i) => F.html`<span><i class="${i.type || ''}" style="background:${F.raw(i.color)};border-color:${F.raw(i.color)}"></i>${i.label}</span>`)}</div>`;
})();
