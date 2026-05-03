// Multi-event conversion matrix. It mirrors the single-event funnel styling,
// but keeps the outer chart height bounded and scrolls the deck rows internally.
import { setChartLoading } from './utils/dom.js';
import { getMultiEventChartData } from './modules/filters/filter-index.js';
import { calculateDeckConversionStats } from './utils/data-chart.js';
import { getActiveTheme, getChartTheme } from './utils/theme.js';

export let multiEventFunnelChart = null;
let activeMultiEventFunnelGroupingMode = 'detailed';
let activeMultiEventFunnelLabelMode = 'copies';
let currentMultiEventFunnelRows = [];
let multiEventFunnelRenderFrame = 0;

const MULTI_EVENT_FUNNEL_MIN_HEIGHT = 220;
const MULTI_EVENT_FUNNEL_ROW_HEIGHT = 22;
const MULTI_EVENT_FUNNEL_VIEWPORT_HEIGHT = 680;
const MULTI_EVENT_FUNNEL_BUFFER_ROWS = 6;
const MULTI_EVENT_FUNNEL_CHART_PADDING_Y = 16;

const FUNNEL_BUCKETS = Object.freeze([
  {
    label: 'Top 8',
    key: 'rank1_8',
    lightColor: '#16A34A',
    lightBorderColor: '#15803D',
    darkColor: '#22C55E',
    darkBorderColor: '#16A34A'
  },
  {
    label: '9th-16th',
    key: 'rank9_16',
    lightColor: '#2563EB',
    lightBorderColor: '#1D4ED8',
    darkColor: '#3B82F6',
    darkBorderColor: '#2563EB'
  },
  {
    label: '17th-32nd',
    key: 'rank17_32',
    lightColor: '#F59E0B',
    lightBorderColor: '#D97706',
    darkColor: '#F59E0B',
    darkBorderColor: '#D97706'
  },
  {
    label: '33rd+',
    key: 'rank33_worse',
    lightColor: '#DC2626',
    lightBorderColor: '#B91C1C',
    darkColor: '#DC2626',
    darkBorderColor: '#B91C1C'
  }
]);

const FUNNEL_GROUPING_MODES = Object.freeze([
  {
    key: 'detailed',
    label: 'Detailed',
    buckets: FUNNEL_BUCKETS.map(bucket => ({
      label: bucket.label,
      key: bucket.key,
      sourceKeys: [bucket.key]
    }))
  },
  {
    key: 'top8-rest',
    label: 'Top 8 vs Rest',
    buckets: [
      { label: 'Top 8', key: 'rank1_8', sourceKeys: ['rank1_8'] },
      { label: 'Rest', key: 'rest', sourceKeys: ['rank9_16', 'rank17_32', 'rank33_worse'] }
    ]
  },
  {
    key: 'top16-rest',
    label: 'Top 16 vs Rest',
    buckets: [
      { label: 'Top 16', key: 'top16', sourceKeys: ['rank1_8', 'rank9_16'] },
      { label: 'Rest', key: 'rest', sourceKeys: ['rank17_32', 'rank33_worse'] }
    ]
  },
  {
    key: 'top32-rest',
    label: 'Top 32 vs Rest',
    buckets: [
      { label: 'Top 32', key: 'top32', sourceKeys: ['rank1_8', 'rank9_16', 'rank17_32'] },
      { label: 'Rest', key: 'rest', sourceKeys: ['rank33_worse'] }
    ]
  }
]);

const FUNNEL_LABEL_MODES = Object.freeze([
  { key: 'copies', label: 'Copies' },
  { key: 'percentage', label: 'Percentage' }
]);

function getActiveFunnelGroupingMode() {
  return FUNNEL_GROUPING_MODES.find(mode => mode.key === activeMultiEventFunnelGroupingMode) || FUNNEL_GROUPING_MODES[0];
}

function getBucketThemeColors(bucketKey, activeTheme = getActiveTheme()) {
  const normalizedTheme = activeTheme === 'light' ? 'light' : 'dark';
  const baseBucket = FUNNEL_BUCKETS.find(bucket => bucket.key === bucketKey);
  if (baseBucket) {
    return {
      color: normalizedTheme === 'light' ? baseBucket.lightColor : baseBucket.darkColor,
      borderColor: normalizedTheme === 'light' ? baseBucket.lightBorderColor : baseBucket.darkBorderColor
    };
  }

  if (bucketKey === 'top16' || bucketKey === 'top32') {
    return normalizedTheme === 'light'
      ? { color: '#2563EB', borderColor: '#1D4ED8' }
      : { color: '#3B82F6', borderColor: '#2563EB' };
  }

  return { color: '#B91C1C', borderColor: '#991B1B' };
}

function getFunnelCategories(mode = getActiveFunnelGroupingMode()) {
  return ['Copies', ...mode.buckets.map(bucket => bucket.label)];
}

function formatWholePercentage(value) {
  return `${Math.round(Number(value) || 0)}%`;
}

function formatEventFunnelLabel(point = {}, labelMode = activeMultiEventFunnelLabelMode) {
  if (labelMode === 'percentage') {
    return formatWholePercentage(point?.percentage);
  }

  return `${Number(point?.rawCount || 0)}`;
}

function buildDeckRowLabel(deckName) {
  return `${deckName}`;
}

function resolveCellRadius(context) {
  const chart = context.chart;
  const chartArea = chart?.chartArea;
  const xScale = chart?.scales?.x;
  const yScale = chart?.scales?.y;

  if (!chartArea || !xScale || !yScale) {
    return 18;
  }

  const columnCount = Math.max(xScale.ticks?.length || 0, 1);
  const rowCount = Math.max(yScale.ticks?.length || 0, 1);
  const columnWidth = (chartArea.right - chartArea.left) / columnCount;
  const rowHeight = (chartArea.bottom - chartArea.top) / rowCount;
  return Math.max(12, Math.min(30, Math.min(columnWidth, rowHeight) * 0.34));
}

const fixedBucketBarPlugin = {
  id: 'multiEventFunnelFixedBucketBars',
  beforeDatasetsDraw(chart, _args, pluginOptions) {
    const xScale = chart.scales?.x;
    const yScale = chart.scales?.y;
    const chartArea = chart.chartArea;

    if (!xScale || !yScale || !chartArea) {
      return;
    }

    const maxBucketCount = Math.max(Number(pluginOptions?.maxBucketCount || 0), 1);
    const xStep = xScale.ticks.length > 1
      ? Math.abs(xScale.getPixelForTick(1) - xScale.getPixelForTick(0))
      : chartArea.width;
    const yStep = yScale.ticks.length > 1
      ? Math.abs(yScale.getPixelForTick(1) - yScale.getPixelForTick(0))
      : chartArea.height;
    const bucketLabels = Array.isArray(pluginOptions?.bucketLabels) ? pluginOptions.bucketLabels : [];
    if (bucketLabels.length === 0) {
      return;
    }

    const categories = ['Copies', ...bucketLabels];
    const copiesCenterX = xScale.getPixelForValue(categories[0]);
    const firstBucketCenterX = xScale.getPixelForValue(bucketLabels[0]);
    const lastBucketCenterX = xScale.getPixelForValue(bucketLabels[bucketLabels.length - 1]);
    const copiesCellWidth = Math.max(36, xStep * 0.82);
    const cellHeight = Math.max(22, yStep * 0.62);
    const barHeight = Math.max(12, Math.min(20, cellHeight * 0.46));
    const cellRadius = Math.min(10, cellHeight * 0.24);
    const barRadius = Math.min(6, barHeight * 0.4);
    const trackColor = pluginOptions?.trackColor || 'rgba(148, 163, 184, 0.12)';
    const dividerColor = pluginOptions?.dividerColor || 'rgba(148, 163, 184, 0.4)';
    const copiesBgColor = pluginOptions?.copiesBgColor || 'rgba(148, 163, 184, 0.14)';
    const copiesBorderColor = pluginOptions?.copiesBorderColor || 'rgba(148, 163, 184, 0.35)';
    const copiesTextColor = pluginOptions?.copiesTextColor || '#111827';
    const bucketSpanLeft = firstBucketCenterX - (xStep / 2);
    const bucketSpanRight = lastBucketCenterX + (xStep / 2);
    const bucketSpanWidth = bucketSpanRight - bucketSpanLeft;
    const bucketSegmentWidth = bucketSpanWidth / Math.max(bucketLabels.length, 1);

    chart.ctx.save();

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (meta.hidden) {
        return;
      }

      meta.data.forEach((element, pointIndex) => {
        const point = dataset.data?.[pointIndex];
        if (!point) {
          return;
        }

        if (datasetIndex === 0) {
          const copiesLeft = copiesCenterX - (copiesCellWidth / 2);
          const copiesTop = element.y - (cellHeight / 2);
          const copiesValue = Number(point.totalCopies || 0);

          chart.ctx.fillStyle = copiesBgColor;
          chart.ctx.strokeStyle = copiesBorderColor;
          chart.ctx.lineWidth = 1;
          chart.ctx.beginPath();
          chart.ctx.roundRect(copiesLeft, copiesTop, copiesCellWidth, cellHeight, cellRadius);
          chart.ctx.fill();
          chart.ctx.stroke();

          chart.ctx.fillStyle = copiesTextColor;
          chart.ctx.font = "700 12px 'Bitter', serif";
          chart.ctx.textAlign = 'center';
          chart.ctx.textBaseline = 'middle';
          chart.ctx.fillText(String(copiesValue), copiesCenterX, element.y);

          chart.ctx.fillStyle = trackColor;
          chart.ctx.strokeStyle = dividerColor;
          chart.ctx.lineWidth = 1;
          chart.ctx.beginPath();
          chart.ctx.roundRect(bucketSpanLeft, copiesTop, bucketSpanWidth, cellHeight, cellRadius);
          chart.ctx.fill();
          chart.ctx.stroke();

          for (let dividerIndex = 1; dividerIndex < bucketLabels.length; dividerIndex += 1) {
            const dividerX = bucketSpanLeft + (bucketSegmentWidth * dividerIndex);
            chart.ctx.beginPath();
            chart.ctx.moveTo(dividerX, copiesTop + 3);
            chart.ctx.lineTo(dividerX, copiesTop + cellHeight - 3);
            chart.ctx.stroke();
          }
        }

        const rawCount = Number(point.rawCount || 0);
        const widthRatio = Math.max(0, Math.min(1, rawCount / maxBucketCount));
        const centerY = element.y;
        const segmentLeft = element.x - (xStep / 2);
        const barLeft = segmentLeft + 6;
        const barTop = centerY - (barHeight / 2);
        const maxBarWidth = Math.max(12, xStep - 12);
        const barWidth = rawCount > 0 ? Math.max(8, maxBarWidth * widthRatio) : 0;

        if (rawCount > 0) {
          chart.ctx.fillStyle = dataset.backgroundColor;
          chart.ctx.strokeStyle = dataset.borderColor;
          chart.ctx.lineWidth = 1.5;
          chart.ctx.beginPath();
          chart.ctx.roundRect(barLeft, barTop, barWidth, barHeight, barRadius);
          chart.ctx.fill();
          chart.ctx.stroke();
        } else {
          chart.ctx.strokeStyle = dataset.borderColor;
          chart.ctx.lineWidth = 2;
          chart.ctx.beginPath();
          chart.ctx.moveTo(barLeft + 2, centerY);
          chart.ctx.lineTo(barLeft + Math.min(18, maxBarWidth * 0.22), centerY);
          chart.ctx.stroke();
        }
      });
    });

    chart.ctx.restore();
  }
};

const multiEventFunnelHeaderLayoutPlugin = {
  id: 'multiEventFunnelHeaderLayout',
  afterLayout(chart, _args, pluginOptions) {
    syncMultiEventFunnelColumnHeaderLayout(chart, pluginOptions?.bucketLabels || []);
  }
};

function ensureMultiEventFunnelControls() {
  const canvas = document.getElementById('multiEventFunnelChart');
  const chartContainer = canvas?.closest('.chart-container');
  if (!chartContainer) {
    return;
  }

  let toolbar = chartContainer.querySelector('#multiEventFunnelGroupingToolbar');
  if (!toolbar) {
    toolbar = document.createElement('div');
    toolbar.id = 'multiEventFunnelGroupingToolbar';
    toolbar.className = 'event-funnel-toolbar';
    toolbar.innerHTML = `
      <div class="event-funnel-toolbar-group">
        <span class="event-funnel-toolbar-label">Bucket View</span>
        <div class="bubble-menu event-funnel-grouping-menu" id="multiEventFunnelGroupingMenu" aria-label="Select multi-event funnel bucket grouping"></div>
      </div>
      <div class="event-funnel-toolbar-group">
        <span class="event-funnel-toolbar-label">Label View</span>
        <div class="bubble-menu event-funnel-label-menu" id="multiEventFunnelLabelMenu" aria-label="Select multi-event funnel label display mode"></div>
      </div>
    `;
    const title = chartContainer.querySelector('.chart-title');
    if (title) {
      title.insertAdjacentElement('afterend', toolbar);
    } else {
      chartContainer.prepend(toolbar);
    }
  }

  const menu = toolbar.querySelector('#multiEventFunnelGroupingMenu');
  const labelMenu = toolbar.querySelector('#multiEventFunnelLabelMenu');
  if (!menu || !labelMenu) {
    return;
  }

  menu.innerHTML = FUNNEL_GROUPING_MODES.map(mode => `
    <button
      type="button"
      class="bubble-button event-funnel-grouping-button${mode.key === activeMultiEventFunnelGroupingMode ? ' active' : ''}"
      data-multi-event-funnel-grouping-mode="${mode.key}"
    >
      ${mode.label}
    </button>
  `).join('');

  labelMenu.innerHTML = FUNNEL_LABEL_MODES.map(mode => `
    <button
      type="button"
      class="bubble-button event-funnel-label-button${mode.key === activeMultiEventFunnelLabelMode ? ' active' : ''}"
      data-multi-event-funnel-label-mode="${mode.key}"
    >
      ${mode.label}
    </button>
  `).join('');

  if (menu.dataset.listenerBound !== 'true') {
    menu.addEventListener('click', event => {
      const button = event.target.closest('[data-multi-event-funnel-grouping-mode]');
      if (!button) {
        return;
      }

      const nextMode = String(button.dataset.multiEventFunnelGroupingMode || '').trim();
      if (!nextMode || nextMode === activeMultiEventFunnelGroupingMode) {
        return;
      }

      activeMultiEventFunnelGroupingMode = nextMode;
      ensureMultiEventFunnelControls();
      updateMultiEventFunnelChart();
    });
    menu.dataset.listenerBound = 'true';
  }

  if (labelMenu.dataset.listenerBound !== 'true') {
    labelMenu.addEventListener('click', event => {
      const button = event.target.closest('[data-multi-event-funnel-label-mode]');
      if (!button) {
        return;
      }

      const nextMode = String(button.dataset.multiEventFunnelLabelMode || '').trim();
      if (!nextMode || nextMode === activeMultiEventFunnelLabelMode) {
        return;
      }

      activeMultiEventFunnelLabelMode = nextMode;
      ensureMultiEventFunnelControls();
      updateMultiEventFunnelChart();
    });
    labelMenu.dataset.listenerBound = 'true';
  }
}

function ensureMultiEventFunnelViewport() {
  const chartBody = document.getElementById('multiEventFunnelChartBody');
  const canvas = document.getElementById('multiEventFunnelChart');
  if (!chartBody || !canvas) {
    return { chartBody: null, rowsLayer: null, canvas: null };
  }

  chartBody.style.height = `${MULTI_EVENT_FUNNEL_VIEWPORT_HEIGHT}px`;

  let rowsLayer = chartBody.querySelector('#multiEventFunnelRowsLayer');
  if (!rowsLayer) {
    rowsLayer = document.createElement('div');
    rowsLayer.id = 'multiEventFunnelRowsLayer';
    rowsLayer.className = 'multi-event-funnel-rows-layer';
    chartBody.appendChild(rowsLayer);
  }

  if (canvas.parentElement !== rowsLayer) {
    rowsLayer.appendChild(canvas);
  }

  if (chartBody.dataset.listenerBound !== 'true') {
    chartBody.addEventListener('scroll', () => {
      scheduleMultiEventFunnelViewportRender();
    });
    chartBody.dataset.listenerBound = 'true';
  }

  return { chartBody, rowsLayer, canvas };
}

function ensureMultiEventFunnelColumnHeader(bucketLabels = []) {
  const canvas = document.getElementById('multiEventFunnelChart');
  const chartContainer = canvas?.closest('.chart-container');
  const chartBody = chartContainer?.querySelector('#multiEventFunnelChartBody');
  const rowsLayer = chartBody?.querySelector('#multiEventFunnelRowsLayer');
  if (!chartContainer) {
    return;
  }

  let header = chartContainer.querySelector('#multiEventFunnelColumnHeader');
  if (!header) {
    header = document.createElement('div');
    header.id = 'multiEventFunnelColumnHeader';
    header.className = 'event-funnel-column-header multi-event-funnel-column-header';
    if (chartBody) {
      chartBody.insertBefore(header, rowsLayer || canvas);
    } else {
      canvas.insertAdjacentElement('beforebegin', header);
    }
  }

  const cells = ['Deck', 'Copies', ...bucketLabels];
  header.innerHTML = cells.map((label, index) => `
    <span class="event-funnel-column-header-cell${index === 0 ? ' event-funnel-column-header-cell-deck' : ''}${index === 1 ? ' event-funnel-column-header-cell-copies' : ''}">${label}</span>
  `).join('');
}

function syncMultiEventFunnelColumnHeaderLayout(chart, bucketLabels = []) {
  const canvas = document.getElementById('multiEventFunnelChart');
  const chartContainer = canvas?.closest('.chart-container');
  const header = chartContainer?.querySelector('#multiEventFunnelColumnHeader');
  const xScale = chart?.scales?.x;

  if (!header || !xScale || !Array.isArray(bucketLabels) || bucketLabels.length === 0) {
    return;
  }

  const xStep = xScale.ticks.length > 1
    ? Math.abs(xScale.getPixelForTick(1) - xScale.getPixelForTick(0))
    : chart.chartArea?.width || chart.width || 0;
  const copiesCenterX = xScale.getPixelForValue('Copies');
  const copiesLeft = copiesCenterX - (xStep / 2);
  const deckWidth = Math.max(96, copiesLeft);
  const metricWidth = Math.max(32, xStep);
  header.style.gridTemplateColumns = [
    `${deckWidth}px`,
    `${metricWidth}px`,
    ...bucketLabels.map(() => `${metricWidth}px`)
  ].join(' ');
}

function getMultiEventFunnelViewportMetrics() {
  const chartBody = document.getElementById('multiEventFunnelChartBody');
  const header = document.getElementById('multiEventFunnelColumnHeader');
  const headerHeight = Math.max(0, header?.offsetHeight || 0);
  const bodyHeight = Math.max(0, chartBody?.clientHeight || MULTI_EVENT_FUNNEL_VIEWPORT_HEIGHT);
  const rowsViewportHeight = Math.max(MULTI_EVENT_FUNNEL_ROW_HEIGHT, bodyHeight - headerHeight);

  return {
    headerHeight,
    bodyHeight,
    rowsViewportHeight
  };
}

function getVisibleMultiEventFunnelWindow(totalRows, scrollTop, rowsViewportHeight) {
  const visibleRows = Math.max(1, Math.ceil(Math.max(rowsViewportHeight, MULTI_EVENT_FUNNEL_ROW_HEIGHT) / MULTI_EVENT_FUNNEL_ROW_HEIGHT));
  const startIndex = Math.max(
    0,
    Math.min(
      Math.max(0, totalRows - visibleRows),
      Math.floor(Math.max(Number(scrollTop) || 0, 0) / MULTI_EVENT_FUNNEL_ROW_HEIGHT)
    )
  );
  const bufferedStartIndex = Math.max(0, startIndex - Math.floor(MULTI_EVENT_FUNNEL_BUFFER_ROWS / 2));
  const endIndex = Math.min(totalRows, bufferedStartIndex + visibleRows + MULTI_EVENT_FUNNEL_BUFFER_ROWS);
  return {
    startIndex: bufferedStartIndex,
    endIndex,
    visibleRows
  };
}

function buildMultiEventFunnelDatasets(visibleDecksData, groupingMode, activeTheme) {
  return groupingMode.buckets.map(bucket => ({
    label: bucket.label,
    bucketKey: bucket.label,
    showLine: false,
    data: visibleDecksData.map(item => {
      const rawCount = bucket.sourceKeys.reduce((sum, key) => sum + Number(item.counts?.[key] || 0), 0);
      const totalCopies = Number(item.total || 0);
      return {
        x: bucket.label,
        y: buildDeckRowLabel(item.deck),
        deckName: item.deck,
        bucketLabel: bucket.label,
        rawCount,
        totalCopies,
        percentage: totalCopies > 0 ? (rawCount / totalCopies) * 100 : 0
      };
    }),
    backgroundColor: getBucketThemeColors(bucket.key, activeTheme).color,
    borderColor: getBucketThemeColors(bucket.key, activeTheme).borderColor,
    borderWidth: 0,
    pointStyle: 'circle',
    pointRadius: 0,
    pointHoverRadius: context => resolveCellRadius(context) * 0.24,
    pointBorderWidth: 2,
    pointHitRadius: 18,
    pointHoverBorderWidth: 2
  }));
}

function renderMultiEventFunnelViewport() {
  multiEventFunnelRenderFrame = 0;

  const canvas = document.getElementById('multiEventFunnelChart');
  const chartBody = document.getElementById('multiEventFunnelChartBody');
  const rowsLayer = document.getElementById('multiEventFunnelRowsLayer');
  if (!canvas || !chartBody || !rowsLayer) {
    return;
  }

  const theme = getChartTheme();
  const activeTheme = getActiveTheme();
  const groupingMode = getActiveFunnelGroupingMode();
  const funnelCategories = getFunnelCategories(groupingMode);
  ensureMultiEventFunnelColumnHeader(groupingMode.buckets.map(bucket => bucket.label));
  const { rowsViewportHeight } = getMultiEventFunnelViewportMetrics();

  const totalRows = currentMultiEventFunnelRows.length;
  rowsLayer.style.height = `${Math.max(totalRows, 1) * MULTI_EVENT_FUNNEL_ROW_HEIGHT + MULTI_EVENT_FUNNEL_CHART_PADDING_Y}px`;

  if (totalRows === 0) {
    if (multiEventFunnelChart) {
      multiEventFunnelChart.destroy();
      multiEventFunnelChart = null;
    }
    canvas.style.top = '0px';
    canvas.style.height = `${MULTI_EVENT_FUNNEL_MIN_HEIGHT}px`;
    canvas.height = MULTI_EVENT_FUNNEL_MIN_HEIGHT;
    return;
  }

  const { startIndex, endIndex, visibleRows } = getVisibleMultiEventFunnelWindow(totalRows, chartBody.scrollTop, rowsViewportHeight);
  const visibleDecksData = currentMultiEventFunnelRows.slice(startIndex, endIndex);
  const visibleDeckLabels = visibleDecksData.map(item => buildDeckRowLabel(item.deck));
  const chartHeight = Math.max(
    MULTI_EVENT_FUNNEL_MIN_HEIGHT,
    (Math.max(visibleRows, visibleDecksData.length) * MULTI_EVENT_FUNNEL_ROW_HEIGHT) + MULTI_EVENT_FUNNEL_CHART_PADDING_Y
  );
  const maxBucketCount = Math.max(
    0,
    ...currentMultiEventFunnelRows.flatMap(item => groupingMode.buckets.map(bucket => (
      bucket.sourceKeys.reduce((sum, key) => sum + Number(item.counts?.[key] || 0), 0)
    )))
  );
  const datasets = buildMultiEventFunnelDatasets(visibleDecksData, groupingMode, activeTheme);

  canvas.style.top = `${startIndex * MULTI_EVENT_FUNNEL_ROW_HEIGHT}px`;
  canvas.style.height = `${chartHeight}px`;
  canvas.height = chartHeight;

  if (multiEventFunnelChart) {
    multiEventFunnelChart.destroy();
  }

  try {
    multiEventFunnelChart = new Chart(canvas, {
      type: 'scatter',
      plugins: [fixedBucketBarPlugin, multiEventFunnelHeaderLayoutPlugin],
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: {
            top: 8,
            right: 12,
            bottom: 8,
            left: 8
          }
        },
        scales: {
          x: {
            type: 'category',
            offset: true,
            labels: funnelCategories,
            title: {
              display: true,
              text: groupingMode.key === 'detailed' ? 'Copies and Finish Buckets' : `Copies and ${groupingMode.label}`,
              color: theme.text,
              font: { size: 16, weight: 'bold', family: "'Bitter', serif" }
            },
            ticks: {
              color: theme.text,
              font: { size: 13, family: "'Bitter', serif" }
            },
            grid: {
              color: theme.grid,
              borderDash: [],
              borderColor: theme.text
            }
          },
          y: {
            type: 'category',
            offset: true,
            labels: visibleDeckLabels,
            title: {
              display: true,
              text: 'Decks',
              color: theme.text,
              font: { size: 16, weight: 'bold', family: "'Bitter', serif" }
            },
            ticks: {
              color: theme.text,
              autoSkip: false,
              font: { size: 13, family: "'Bitter', serif" }
            },
            grid: {
              color: theme.grid,
              borderDash: [],
              borderColor: theme.text
            }
          }
        },
        plugins: {
          multiEventFunnelFixedBucketBars: {
            maxBucketCount,
            bucketLabels: groupingMode.buckets.map(bucket => bucket.label),
            trackColor: theme.grid,
            dividerColor: theme.tooltipBorder,
            copiesBgColor: theme.grid,
            copiesBorderColor: theme.tooltipBorder,
            copiesTextColor: theme.text
          },
          multiEventFunnelHeaderLayout: {
            bucketLabels: groupingMode.buckets.map(bucket => bucket.label)
          },
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleFont: { family: "'Bitter', serif", size: 14, weight: 'bold' },
            bodyFont: { family: "'Bitter', serif", size: 12 },
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
            displayColors: true,
            boxWidth: 10,
            boxHeight: 10,
            boxPadding: 4,
            bodySpacing: 4,
            callbacks: {
              title: () => '',
              label: context => {
                const point = context.raw || {};
                return `${point.deckName || ''} — ${point.bucketLabel || context.dataset.label}: ${Number(point.rawCount || 0)} (${formatWholePercentage(point.percentage)})`;
              },
              labelColor: context => ({
                backgroundColor: context.dataset?.backgroundColor || '#ffffff',
                borderColor: context.dataset?.borderColor || '#ffffff',
                borderWidth: 1,
                borderRadius: 0
              })
            },
            filter: tooltipItem => {
              const point = tooltipItem.raw || {};
              return Number(point.rawCount || 0) > 0;
            },
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            padding: 10
          },
          datalabels: {
            display: context => {
              const rawCount = Number(context?.dataset?.data?.[context.dataIndex]?.rawCount || 0);
              return rawCount > 0;
            },
            color: '#ffffff',
            font: { size: 12, weight: 'bold', family: "'Bitter', serif" },
            align: 'center',
            anchor: 'center',
            offset: 0,
            clamp: false,
            clip: false,
            textStrokeColor: 'rgba(17, 24, 39, 0.55)',
            textStrokeWidth: 3,
            textShadowBlur: 4,
            textShadowColor: 'rgba(17, 24, 39, 0.45)',
            formatter: value => formatEventFunnelLabel(value, activeMultiEventFunnelLabelMode)
          }
        },
        animation: {
          duration: 0
        },
        elements: {
          point: {
            hoverBorderWidth: 2
          }
        }
      }
    });
  } catch (error) {
    console.error('Error initializing Multi-Event Funnel Chart:', error);
  }
}

function scheduleMultiEventFunnelViewportRender() {
  if (multiEventFunnelRenderFrame) {
    return;
  }

  multiEventFunnelRenderFrame = requestAnimationFrame(() => {
    renderMultiEventFunnelViewport();
  });
}

export function updateMultiEventFunnelChart() {
  console.log('updateMultiEventFunnelChart called...');
  setChartLoading('multiEventFunnelChart', true);
  ensureMultiEventFunnelControls();
  const { chartBody } = ensureMultiEventFunnelViewport();
  const groupingMode = getActiveFunnelGroupingMode();
  ensureMultiEventFunnelColumnHeader(groupingMode.buckets.map(bucket => bucket.label));

  const filteredData = getMultiEventChartData();
  if (filteredData.length === 0) {
    currentMultiEventFunnelRows = [];
    if (chartBody) {
      chartBody.scrollTop = 0;
    }
    renderMultiEventFunnelViewport();
    setChartLoading('multiEventFunnelChart', false);
    return;
  }

  currentMultiEventFunnelRows = calculateDeckConversionStats(filteredData);
  if (chartBody) {
    chartBody.scrollTop = 0;
  }
  renderMultiEventFunnelViewport();
  setChartLoading('multiEventFunnelChart', false);
}
