'use strict';
/* global Chart */
// Chart helpers. Colours come from CSS custom properties (and Teams) when a chart is drawn, so both
// themes work as long as the open tab is drawn again after a theme change.
//
// Style: straight segments, no point markers, a few faint horizontal gridlines, flat axis labels,
// no legend (each line is named at its end, with a sample of its own stroke), bare tooltips.
const Charts = (() => {
  const instances = {};
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const series = (i) => css(`--series-${(i % 8) + 1}`);
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FONT_SIZE = 12;
  // Set on each chart, never on Chart.defaults: replacing the default animation object drops the keys
  // Chart.js needs to animate colours (the chart then fails with "this._fn is not a function").
  const animation = () => (reducedMotion() ? false : { duration: 1000, easing: 'easeOutQuart' });

  function base() {
    Chart.defaults.font.family = css('--font-text');
    Chart.defaults.font.size = FONT_SIZE;
    Chart.defaults.color = css('--text-secondary');
    Chart.defaults.borderColor = css('--grid');
  }

  // A chart is built the first time it scrolls into view, so its entrance animation is seen, not spent
  // off-screen. A chart on a hidden tab waits until the tab is shown. Without scroll observation, or
  // with reduced motion, charts are built at once.
  const pending = new Map();
  const watcher = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = e.target.id;
        const config = pending.get(id);
        watcher.unobserve(e.target);
        pending.delete(id);
        if (config) build(id, config);
      }
    }, { threshold: 0.2 })
    : null;

  function build(id, config) {
    base();
    instances[id]?.destroy();
    instances[id] = new Chart(document.getElementById(id), config);
    return instances[id];
  }

  function render(id, config) {
    const canvas = document.getElementById(id);
    instances[id]?.destroy();
    delete instances[id];
    pending.delete(id);
    watcher?.unobserve(canvas);
    if (!watcher || reducedMotion()) return build(id, config);
    pending.set(id, config);
    watcher.observe(canvas);
    return null;
  }

  const textWidth = (text) => {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${FONT_SIZE}px ${css('--font-text')}`;
    return Math.ceil(ctx.measureText(text).width);
  };

  const tooltip = (callbacks) => ({
    backgroundColor: css('--raised'),
    titleColor: css('--text'),
    bodyColor: css('--text-secondary'),
    borderColor: css('--border'),
    borderWidth: 1,
    padding: 10,
    cornerRadius: 6,
    caretSize: 0,
    boxPadding: 4,
    callbacks,
  });

  // y axis: a few faint horizontal lines, no axis line. x axis: baseline only, labels flat.
  const yAxis = (extra = {}) => ({
    grid: { color: css('--grid') },
    border: { display: false },
    ticks: { color: css('--text-muted'), maxTicksLimit: 5 },
    ...extra,
  });
  const xAxis = (extra = {}) => ({
    grid: { display: false },
    border: { color: css('--axis') },
    ticks: { color: css('--text-muted'), maxRotation: 0, autoSkip: true },
    ...extra,
  });

  // Names each line at the right end of the plot: a sample of its stroke, then its label.
  // Labels that would overlap are pushed apart, bottom ones first kept in place.
  const endLabels = {
    id: 'endLabels',
    afterDatasetsDraw(chart, args, opts) {
      if (!opts.enabled) return;
      const { ctx, chartArea } = chart;
      const items = [];
      chart.data.datasets.forEach((ds, i) => {
        if (!chart.isDatasetVisible(i)) return;
        let k = ds.data.length - 1;
        while (k >= 0 && (ds.data[k] === null || ds.data[k] === undefined)) k--;
        if (k < 0) return;
        const y = chart.getDatasetMeta(i).data[k].y;
        items.push({ ds, y, ty: y, text: ds.endLabel || ds.label });
      });
      items.sort((a, b) => a.y - b.y);
      const gap = FONT_SIZE + 3;
      for (let i = 1; i < items.length; i++) items[i].ty = Math.max(items[i].ty, items[i - 1].ty + gap);
      const over = items.length ? items[items.length - 1].ty - chartArea.bottom : 0;
      if (over > 0) {
        for (let i = items.length - 1; i >= 0; i--) {
          items[i].ty = Math.min(items[i].ty, chartArea.bottom - (items.length - 1 - i) * gap);
        }
      }
      ctx.save();
      ctx.font = `${FONT_SIZE}px ${css('--font-text')}`;
      ctx.textBaseline = 'middle';
      for (const it of items) {
        const x = chartArea.right + 8;
        ctx.strokeStyle = it.ds.borderColor;
        ctx.lineWidth = 2;
        ctx.setLineDash(it.ds.borderDash || []);
        ctx.beginPath();
        ctx.moveTo(x, it.ty);
        ctx.lineTo(x + 14, it.ty);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = opts.color;
        ctx.fillText(it.text, x + 20, it.ty);
      }
      ctx.restore();
    },
  };

  // Prints each bar's value just past its end.
  const barValues = {
    id: 'barValues',
    afterDatasetsDraw(chart, args, opts) {
      // The format function lives on the dataset: Chart.js would call a function found in plugin options.
      const format = chart.data.datasets[0].valueFormat;
      if (!format) return;
      const { ctx } = chart;
      ctx.save();
      ctx.font = `${FONT_SIZE}px ${css('--font-text')}`;
      ctx.fillStyle = opts.color;
      ctx.textBaseline = 'middle';
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        const v = chart.data.datasets[0].data[i];
        if (v === null || v === undefined) return;
        const neg = v < 0;
        ctx.textAlign = neg ? 'right' : 'left';
        ctx.fillText(format(v), bar.x + (neg ? -6 : 6), bar.y);
      });
      ctx.restore();
    },
  };

  // Line chart, one line per entity.
  // entities = [{label, short?, data, color? | colorIndex?, dashed?}]
  // titles = full tooltip titles per label (labels themselves may be short, like "R7").
  function lines(id, labels, entities, { reverseY = false, yTitle = '', tooltipSuffix = '', integerY = false, titles, endLabelsOn = true } = {}) {
    const canvas = document.getElementById(id);
    const narrow = (canvas.parentElement?.clientWidth || 800) < 560;
    const names = entities.map((e) => (narrow && e.short ? e.short : e.label));
    const rightPad = endLabelsOn && names.length ? Math.max(...names.map(textWidth)) + 36 : 8;
    return render(id, {
      type: 'line',
      data: {
        labels,
        datasets: entities.map((e, i) => {
          const colour = e.color || series(e.colorIndex ?? i);
          return {
            label: e.label,
            endLabel: names[i],
            data: e.data,
            borderColor: colour,
            backgroundColor: colour,
            borderWidth: 2,
            borderDash: e.dashed ? [6, 4] : [],
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHitRadius: 12,
            spanGaps: false,
            tension: 0,
          };
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: animation(),
        layout: { padding: { right: rightPad, top: 4 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          endLabels: { enabled: endLabelsOn, color: css('--text-secondary') },
          tooltip: tooltip({
            title: (items) => (titles ? titles[items[0].dataIndex] : items[0].label),
            label: (c) => `${c.dataset.label}: ${c.formattedValue}${tooltipSuffix}`,
          }),
        },
        scales: {
          x: xAxis({ ticks: { color: css('--text-muted'), maxRotation: 0, autoSkip: true, maxTicksLimit: narrow ? 6 : 12 } }),
          y: yAxis({
            reverse: reverseY,
            title: { display: !!yTitle, text: yTitle, color: css('--text-muted') },
            ticks: { color: css('--text-muted'), maxTicksLimit: 6, precision: integerY ? 0 : undefined },
          }),
        },
      },
      plugins: [endLabels],
    });
  }

  // Horizontal bars. One neutral colour unless `colors` gives one per bar; `format` prints values at the bar ends.
  function hbars(id, labels, values, { colors, valueLabel = '', tooltipFormat, format } = {}) {
    const axisColour = css('--axis');
    const gridColour = css('--grid');
    return render(id, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: valueLabel,
          valueFormat: format,
          data: values,
          backgroundColor: colors || css('--text-secondary'),
          borderWidth: 0,
          barPercentage: 0.7,
          maxBarThickness: 26,
          categoryPercentage: 0.9,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: animation(),
        layout: { padding: { right: format ? 8 : 0 } },
        plugins: {
          legend: { display: false },
          barValues: { color: css('--text-secondary') },
          tooltip: tooltip({ label: (c) => (tooltipFormat ? tooltipFormat(c.raw) : `${valueLabel}: ${c.formattedValue}`) }),
        },
        scales: {
          x: {
            grace: format ? '12%' : 0,
            grid: { color: (c) => (c.tick.value === 0 ? axisColour : gridColour) },
            border: { display: false },
            ticks: { color: css('--text-muted'), maxTicksLimit: 5 },
          },
          y: { grid: { display: false }, border: { display: false }, ticks: { color: css('--text-secondary'), autoSkip: false } },
        },
      },
      plugins: [barValues],
    });
  }

  // Prints each line's start label to the left of its first point and its finish label to the right of its last,
  // with a small heading above each end.
  const slopeLabels = {
    id: 'slopeLabels',
    afterDatasetsDraw(chart, args, opts) {
      const { ctx, chartArea } = chart;
      ctx.save();
      ctx.font = `${FONT_SIZE}px ${css('--font-text')}`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = opts.headingColor;
      ctx.textAlign = 'center';
      ctx.fillText(chart.data.labels[0], chartArea.left, chartArea.top - 16);
      ctx.fillText(chart.data.labels[1], chartArea.right, chartArea.top - 16);
      chart.data.datasets.forEach((ds, i) => {
        const [a, b] = chart.getDatasetMeta(i).data;
        ctx.fillStyle = ds.textColor;
        ctx.textAlign = 'right';
        ctx.fillText(ds.leftText, a.x - 10, a.y);
        ctx.textAlign = 'left';
        ctx.fillText(ds.rightText, b.x + 10, b.y);
      });
      ctx.restore();
    },
  };

  // Slope chart: one line per row from a start position to a finish position, position 1 at the top.
  // rows = [{label, from, to, left, right, tip, color, textColor, width?, dashed?, top?}]
  function slope(id, rows, { positions, headings = ['Grid', 'Finish'] }) {
    const side = (key) => (rows.length ? Math.max(...rows.map((r) => textWidth(r[key]))) + 16 : 16);
    return render(id, {
      type: 'line',
      data: {
        labels: headings,
        datasets: rows.map((r) => ({
          label: r.label,
          tip: r.tip,
          leftText: r.left,
          rightText: r.right,
          textColor: r.textColor,
          order: r.top ? 0 : 1,
          data: [r.from, r.to],
          borderColor: r.color,
          backgroundColor: r.color,
          borderWidth: r.width || 2,
          borderDash: r.dashed ? [6, 4] : [],
          pointRadius: r.width > 2 ? 4 : 3,
          pointHoverRadius: 5,
          pointHitRadius: 10,
          tension: 0,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: animation(),
        layout: { padding: { left: side('left'), right: side('right'), top: 30, bottom: 6 } },
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { display: false },
          slopeLabels: { headingColor: css('--text-muted') },
          tooltip: tooltip({ title: (items) => items[0].dataset.label, label: (c) => c.dataset.tip }),
        },
        scales: {
          x: { display: false },
          y: { reverse: true, min: 0.5, max: positions + 0.5, display: false, grid: { display: false } },
        },
      },
      plugins: [slopeLabels],
    });
  }

  function clear(id) {
    instances[id]?.destroy();
    delete instances[id];
    pending.delete(id);
    if (watcher) watcher.unobserve(document.getElementById(id));
  }

  // "#rrggbb" with an alpha, for dimming lines without changing their hue
  function fade(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  return { lines, hbars, slope, clear, fade, series, css };
})();
