// Multi-event conversion matrix. It mirrors the single-event funnel styling,
// but keeps the outer chart height bounded and scrolls the deck rows internally.
import { setChartLoading } from './utils/dom.js';
import { getMultiEventChartData } from './modules/filters/filter-index.js';
import { calculateDeckConversionStats } from './utils/data-chart.js';
import { openMultiEventDeckEvolutionModal } from './charts/multi-deck-evolution.js';
import { openMultiEventPlayerAggregateModal } from './modules/multi-player-aggregate-modal.js';
import { getActiveTheme, getChartTheme } from './utils/theme.js';
import { getPlayerIdentityKey } from './utils/player-names.js';
import { renderMultiEventPeriodSummaryBadge } from './utils/multi-event-period-badge.js';
import { exportTopConversionCsv } from './modules/export-table-csv.js';

export let multiEventFunnelChart = null;
let activeMultiEventFunnelGroupingMode = 'detailed';
let activeMultiEventFunnelLabelMode = 'copies';
let activeMultiEventFunnelEntityMode = 'deck';
let activeMultiEventFunnelSearchTerms = {
  deck: '',
  player: ''
};
let activeMultiEventFunnelHighlightedEntityNames = {
  deck: '',
  player: ''
};
let currentMultiEventFunnelChartData = [];
let currentMultiEventFunnelSourceRows = [];
let currentMultiEventFunnelRows = [];
let multiEventFunnelRenderFrame = 0;

const MULTI_EVENT_FUNNEL_EMPTY_HEIGHT = 220;
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

const FUNNEL_ENTITY_MODES = Object.freeze([
  { key: 'deck', label: 'Deck' },
  { key: 'player', label: 'Player' }
]);

function getActiveFunnelGroupingMode() {
  return FUNNEL_GROUPING_MODES.find(mode => mode.key === activeMultiEventFunnelGroupingMode) || FUNNEL_GROUPING_MODES[0];
}

function getActiveFunnelEntityMode() {
  return FUNNEL_ENTITY_MODES.find(mode => mode.key === activeMultiEventFunnelEntityMode) || FUNNEL_ENTITY_MODES[0];
}

function normalizeMultiEventFunnelSearchTerm(searchTerm = '') {
  return String(searchTerm || '').trim().toLowerCase();
}

function getNormalizedMultiEventFunnelEntityName(entityName = '') {
  return normalizeMultiEventFunnelSearchTerm(entityName);
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

function buildEntityRowLabel(entityName) {
  return `${entityName}`;
}

function getMultiEventFunnelPrimaryColumnLabel() {
  return activeMultiEventFunnelEntityMode === 'player' ? 'Player' : 'Deck';
}

function getMultiEventFunnelMetricColumnLabel() {
  return activeMultiEventFunnelEntityMode === 'player' ? 'Entries' : 'Copies';
}

function getMultiEventFunnelYAxisLabel() {
  return activeMultiEventFunnelEntityMode === 'player' ? 'Players' : 'Decks';
}

function getMultiEventFunnelSearchPlaceholder() {
  return activeMultiEventFunnelEntityMode === 'player'
    ? 'Find a player in Top Conversion'
    : 'Find a deck in Top Conversion';
}

function getMultiEventFunnelXAxisTitle(groupingMode = getActiveFunnelGroupingMode()) {
  const metricLabel = getMultiEventFunnelMetricColumnLabel();
  return groupingMode.key === 'detailed' ? `${metricLabel} and Finish Buckets` : `${metricLabel} and ${groupingMode.label}`;
}

function calculatePlayerConversionStats(data = []) {
  const playerStats = data.reduce((acc, row) => {
    const playerName = String(row?.Player || '').trim();
    const playerKey = getPlayerIdentityKey(playerName);
    if (!playerKey) {
      return acc;
    }

    if (!acc[playerKey]) {
      acc[playerKey] = {
        player: playerName,
        total: 0,
        rank1_8: 0,
        rank9_16: 0,
        rank17_32: 0,
        rank33_worse: 0
      };
    }

    acc[playerKey].total += 1;
    const rank = Number(row?.Rank);
    if (rank >= 1 && rank <= 8) acc[playerKey].rank1_8 += 1;
    else if (rank >= 9 && rank <= 16) acc[playerKey].rank9_16 += 1;
    else if (rank >= 17 && rank <= 32) acc[playerKey].rank17_32 += 1;
    else acc[playerKey].rank33_worse += 1;
    return acc;
  }, {});

  return Object.values(playerStats)
    .map(stats => {
      const total = Number(stats.total || 0);
      const percentages = {
        rank1_8: total > 0 ? (Number(stats.rank1_8 || 0) / total) * 100 : 0,
        rank9_16: total > 0 ? (Number(stats.rank9_16 || 0) / total) * 100 : 0,
        rank17_32: total > 0 ? (Number(stats.rank17_32 || 0) / total) * 100 : 0,
        rank33_worse: total > 0 ? (Number(stats.rank33_worse || 0) / total) * 100 : 0
      };

      return {
        deck: stats.player,
        total,
        counts: {
          rank1_8: Number(stats.rank1_8 || 0),
          rank9_16: Number(stats.rank9_16 || 0),
          rank17_32: Number(stats.rank17_32 || 0),
          rank33_worse: Number(stats.rank33_worse || 0)
        },
        data: [percentages.rank1_8, percentages.rank9_16, percentages.rank17_32, percentages.rank33_worse],
        rank1_8: percentages.rank1_8
      };
    })
    .sort((a, b) => b.rank1_8 - a.rank1_8 || a.deck.localeCompare(b.deck));
}

function getMultiEventFunnelRows(data = []) {
  return activeMultiEventFunnelEntityMode === 'player'
    ? calculatePlayerConversionStats(data)
    : calculateDeckConversionStats(data);
}

function getMultiEventFunnelSearchEntityLabel() {
  return activeMultiEventFunnelEntityMode === 'player' ? 'player' : 'deck';
}

function getActiveMultiEventFunnelSearchTerm() {
  return String(activeMultiEventFunnelSearchTerms?.[activeMultiEventFunnelEntityMode] || '');
}

function getActiveMultiEventFunnelHighlightedEntityName() {
  return String(activeMultiEventFunnelHighlightedEntityNames?.[activeMultiEventFunnelEntityMode] || '');
}

function getMultiEventFunnelSearchOptions() {
  return currentMultiEventFunnelSourceRows.map((row, index) => ({
    key: getNormalizedMultiEventFunnelEntityName(row?.deck),
    label: String(row?.deck || '').trim(),
    searchText: normalizeMultiEventFunnelSearchTerm(row?.deck),
    index
  })).filter(option => option.key && option.label);
}

function getMultiEventFunnelSearchMatches(searchTerm = '') {
  const normalizedSearchTerm = normalizeMultiEventFunnelSearchTerm(searchTerm);
  if (!normalizedSearchTerm) {
    return [];
  }

  return getMultiEventFunnelSearchOptions().filter(option => option.searchText.includes(normalizedSearchTerm));
}

function findMultiEventFunnelSearchSelection(searchTerm = '', { jumpToFirst = false } = {}) {
  const normalizedSearchTerm = normalizeMultiEventFunnelSearchTerm(searchTerm);
  if (!normalizedSearchTerm) {
    return null;
  }

  const matches = getMultiEventFunnelSearchMatches(normalizedSearchTerm);
  const exactMatch = matches.find(option => option.searchText === normalizedSearchTerm);
  return exactMatch || (jumpToFirst ? matches[0] || null : null);
}

function updateMultiEventFunnelSearchStatus(message = '') {
  const statusElement = document.getElementById('multiEventFunnelSearchStatus');
  if (!statusElement) {
    return;
  }

  statusElement.textContent = message;
}

function syncMultiEventFunnelRows() {
  currentMultiEventFunnelRows = Array.isArray(currentMultiEventFunnelSourceRows)
    ? [...currentMultiEventFunnelSourceRows]
    : [];
}

function clearMultiEventFunnelHighlight({ preserveInput = false } = {}) {
  activeMultiEventFunnelHighlightedEntityNames[activeMultiEventFunnelEntityMode] = '';
  if (!preserveInput) {
    activeMultiEventFunnelSearchTerms[activeMultiEventFunnelEntityMode] = '';
  }
}

function scrollMultiEventFunnelToRowIndex(rowIndex) {
  const chartBody = document.getElementById('multiEventFunnelChartBody');
  if (!chartBody || !Number.isFinite(rowIndex) || rowIndex < 0) {
    return;
  }

  const { rowsViewportHeight } = getMultiEventFunnelViewportMetrics();
  const targetScrollTop = Math.max(
    0,
    (rowIndex * MULTI_EVENT_FUNNEL_ROW_HEIGHT) - Math.max(0, (rowsViewportHeight / 2) - (MULTI_EVENT_FUNNEL_ROW_HEIGHT / 2))
  );

  chartBody.scrollTo({
    top: targetScrollTop,
    behavior: 'smooth'
  });
}

function setActiveMultiEventFunnelFocus(option = null, { scroll = true } = {}) {
  activeMultiEventFunnelHighlightedEntityNames[activeMultiEventFunnelEntityMode] = option?.label || '';
  if (option?.label) {
    activeMultiEventFunnelSearchTerms[activeMultiEventFunnelEntityMode] = option.label;
    updateMultiEventFunnelSearchStatus(`Focused on ${option.label}. The ${getMultiEventFunnelSearchEntityLabel()} row is highlighted.`);
    if (scroll) {
      scrollMultiEventFunnelToRowIndex(option.index);
    }
  } else {
    updateMultiEventFunnelSearchStatus('');
  }

  renderMultiEventFunnelSuggestions('');
  renderMultiEventFunnelViewport();
}

function renderMultiEventFunnelSuggestions(searchTerm = '') {
  const searchDropdown = document.getElementById('multiEventFunnelSearchDropdown');
  if (!searchDropdown) {
    return;
  }

  const matches = getMultiEventFunnelSearchMatches(searchTerm);
  if (!searchTerm.trim()) {
    searchDropdown.innerHTML = '';
    searchDropdown.classList.remove('open');
    return;
  }

  if (matches.length === 0) {
    searchDropdown.innerHTML = `<div class="player-search-empty">No matching ${getMultiEventFunnelSearchEntityLabel()}s found.</div>`;
    searchDropdown.classList.add('open');
    return;
  }

  searchDropdown.innerHTML = matches.map(option => `
    <div class="chart-search-option" data-multi-event-funnel-search-key="${option.key}">
      ${option.label}
    </div>
  `).join('');
  searchDropdown.classList.add('open');
}

function selectMultiEventFunnelSearchResult(searchTerm = '', { jumpToFirst = false } = {}) {
  const normalizedSearchTerm = normalizeMultiEventFunnelSearchTerm(searchTerm);
  activeMultiEventFunnelSearchTerms[activeMultiEventFunnelEntityMode] = String(searchTerm || '');

  if (!normalizedSearchTerm) {
    clearMultiEventFunnelHighlight({ preserveInput: false });
    renderMultiEventFunnelSuggestions('');
    updateMultiEventFunnelSearchStatus('');
    renderMultiEventFunnelViewport();
    return;
  }

  const matches = getMultiEventFunnelSearchMatches(searchTerm);
  const selectedMatch = findMultiEventFunnelSearchSelection(searchTerm, { jumpToFirst });
  renderMultiEventFunnelSuggestions(searchTerm);

  if (selectedMatch) {
    setActiveMultiEventFunnelFocus(selectedMatch, { scroll: true });
    return;
  }

  activeMultiEventFunnelHighlightedEntityNames[activeMultiEventFunnelEntityMode] = '';
  const entityLabel = getMultiEventFunnelSearchEntityLabel();
  updateMultiEventFunnelSearchStatus(
    matches.length > 0
      ? `${matches.length} ${entityLabel}${matches.length === 1 ? '' : 's'} match "${String(searchTerm || '').trim()}". Choose one from the suggestions or press Enter to jump to the first match.`
      : `No ${entityLabel} matched "${String(searchTerm || '').trim()}".`
  );
  renderMultiEventFunnelViewport();
}

function syncMultiEventFunnelSearchState() {
  const searchInput = document.getElementById('multiEventFunnelSearchInput');
  const activeSearchTerm = getActiveMultiEventFunnelSearchTerm();
  const activeHighlightedEntityName = getActiveMultiEventFunnelHighlightedEntityName();
  const hasHighlightedRow = getMultiEventFunnelSearchOptions().some(option => option.label === activeHighlightedEntityName);
  if (!hasHighlightedRow) {
    activeMultiEventFunnelHighlightedEntityNames[activeMultiEventFunnelEntityMode] = '';
  }

  if (searchInput && document.activeElement !== searchInput) {
    searchInput.value = activeSearchTerm;
  }

  const entityLabel = getMultiEventFunnelSearchEntityLabel();
  if (getActiveMultiEventFunnelHighlightedEntityName()) {
    updateMultiEventFunnelSearchStatus(`Focused on ${getActiveMultiEventFunnelHighlightedEntityName()}. The ${entityLabel} row is highlighted.`);
  } else if (activeSearchTerm.trim()) {
    const matches = getMultiEventFunnelSearchMatches(activeSearchTerm);
    updateMultiEventFunnelSearchStatus(
      matches.length > 0
        ? `${matches.length} ${entityLabel}${matches.length === 1 ? '' : 's'} match "${activeSearchTerm.trim()}". Choose one from the suggestions or press Enter to jump to the first match.`
        : `No ${entityLabel} matched "${activeSearchTerm.trim()}".`
    );
  } else {
    updateMultiEventFunnelSearchStatus('');
  }

  renderMultiEventFunnelSuggestions(activeSearchTerm);
}

function openMultiEventFunnelEntityModal(entityName = '') {
  const normalizedEntityName = String(entityName || '').trim();
  if (!normalizedEntityName) {
    return;
  }

  if (activeMultiEventFunnelEntityMode === 'player') {
    openMultiEventPlayerAggregateModal(normalizedEntityName);
    return;
  }

  openMultiEventDeckEvolutionModal(normalizedEntityName);
}

function getMultiEventFunnelPointerPosition(event) {
  const nativeEvent = event?.native || event;
  const x = Number(
    event?.x
    ?? nativeEvent?.offsetX
    ?? nativeEvent?.layerX
    ?? nativeEvent?.x
  );
  const y = Number(
    event?.y
    ?? nativeEvent?.offsetY
    ?? nativeEvent?.layerY
    ?? nativeEvent?.y
  );

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
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

const multiEventFunnelHighlightPlugin = {
  id: 'multiEventFunnelHighlightRow',
  beforeDatasetsDraw(chart, _args, pluginOptions) {
    const highlightedEntityName = String(pluginOptions?.highlightedEntityName || '').trim();
    if (!highlightedEntityName) {
      return;
    }

    const xScale = chart.scales?.x;
    const yScale = chart.scales?.y;
    const chartArea = chart.chartArea;
    if (!xScale || !yScale || !chartArea) {
      return;
    }

    const matchingDataset = chart.data.datasets?.[0];
    const highlightedIndex = matchingDataset?.data?.findIndex(point => (
      String(point?.entityName || point?.deckName || '').trim() === highlightedEntityName
    )) ?? -1;
    if (highlightedIndex < 0) {
      return;
    }

    const yStep = yScale.ticks.length > 1
      ? Math.abs(yScale.getPixelForTick(1) - yScale.getPixelForTick(0))
      : chartArea.height;
    const rowCenterY = yScale.getPixelForTick(highlightedIndex);
    const rowHeight = Math.max(18, Math.min(MULTI_EVENT_FUNNEL_ROW_HEIGHT, yStep * 0.92));
    const rowTop = rowCenterY - (rowHeight / 2);
    const highlightLeft = Math.max(0, Number(yScale.left) || chartArea.left);
    const highlightWidth = chartArea.right - highlightLeft;

    chart.ctx.save();
    chart.ctx.fillStyle = pluginOptions?.highlightFill || 'rgba(217, 164, 65, 0.16)';
    chart.ctx.strokeStyle = pluginOptions?.highlightStroke || 'rgba(217, 164, 65, 0.55)';
    chart.ctx.lineWidth = 1.5;
    chart.ctx.beginPath();
    chart.ctx.roundRect(highlightLeft + 2, rowTop + 1, Math.max(24, highlightWidth - 4), Math.max(16, rowHeight - 2), 8);
    chart.ctx.fill();
    chart.ctx.stroke();
    chart.ctx.restore();
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
        <span class="event-funnel-toolbar-label">Entity</span>
        <div class="bubble-menu event-funnel-entity-menu" id="multiEventFunnelEntityMenu" aria-label="Select multi-event funnel entity type"></div>
      </div>
      <div class="event-funnel-toolbar-group multi-event-funnel-search-group">
        <span class="event-funnel-toolbar-label">Search</span>
        <div class="player-search-select leaderboard-table-search multi-event-funnel-search">
          <input
            type="search"
            class="player-search-input"
            id="multiEventFunnelSearchInput"
            placeholder="Find a deck in Top Conversion"
            aria-label="Find a deck in Top Conversion"
            autocomplete="off"
          />
          <div class="player-search-dropdown chart-search-dropdown" id="multiEventFunnelSearchDropdown"></div>
        </div>
      </div>
      <div class="event-funnel-toolbar-group">
        <span class="event-funnel-toolbar-label">Bucket View</span>
        <div class="bubble-menu event-funnel-grouping-menu" id="multiEventFunnelGroupingMenu" aria-label="Select multi-event funnel bucket grouping"></div>
      </div>
      <div class="event-funnel-toolbar-group">
        <span class="event-funnel-toolbar-label">Label View</span>
        <div class="bubble-menu event-funnel-label-menu" id="multiEventFunnelLabelMenu" aria-label="Select multi-event funnel label display mode"></div>
      </div>
      <div class="event-funnel-toolbar-group">
        <button type="button" class="bubble-button" id="multiEventFunnelExportCsvButton">Export CSV</button>
      </div>
    `;
    const title = chartContainer.querySelector('.chart-title');
    if (title) {
      title.insertAdjacentElement('afterend', toolbar);
    } else {
      chartContainer.prepend(toolbar);
    }

    const searchStatus = document.createElement('div');
    searchStatus.id = 'multiEventFunnelSearchStatus';
    searchStatus.className = 'leaderboard-table-search-status multi-event-funnel-search-status';
    searchStatus.setAttribute('aria-live', 'polite');
    toolbar.insertAdjacentElement('afterend', searchStatus);
  }

  const menu = toolbar.querySelector('#multiEventFunnelGroupingMenu');
  const labelMenu = toolbar.querySelector('#multiEventFunnelLabelMenu');
  const entityMenu = toolbar.querySelector('#multiEventFunnelEntityMenu');
  const searchInput = toolbar.querySelector('#multiEventFunnelSearchInput');
  const searchGroup = toolbar.querySelector('.multi-event-funnel-search-group');
  const searchDropdown = toolbar.querySelector('#multiEventFunnelSearchDropdown');
  const exportButton = toolbar.querySelector('#multiEventFunnelExportCsvButton');
  if (!menu || !labelMenu || !entityMenu || !searchInput || !searchGroup || !searchDropdown || !exportButton) {
    return;
  }

  const searchPlaceholder = getMultiEventFunnelSearchPlaceholder();
  searchInput.placeholder = searchPlaceholder;
  searchInput.setAttribute('aria-label', searchPlaceholder);
  const expectedSearchValue = getActiveMultiEventFunnelSearchTerm();
  if (searchInput.value !== expectedSearchValue) {
    searchInput.value = expectedSearchValue;
  }
  searchGroup.hidden = false;
  searchInput.disabled = false;

  entityMenu.innerHTML = FUNNEL_ENTITY_MODES.map(mode => `
    <button
      type="button"
      class="bubble-button multi-event-scatter-mode-button${mode.key === activeMultiEventFunnelEntityMode ? ' active' : ''}"
      data-multi-event-funnel-entity-mode="${mode.key}"
    >
      ${mode.label}
    </button>
  `).join('');

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
      ${mode.key === 'copies' ? getMultiEventFunnelMetricColumnLabel() : mode.label}
    </button>
  `).join('');

  if (entityMenu.dataset.listenerBound !== 'true') {
    entityMenu.addEventListener('click', event => {
      const button = event.target.closest('[data-multi-event-funnel-entity-mode]');
      if (!button) {
        return;
      }

      const nextMode = String(button.dataset.multiEventFunnelEntityMode || '').trim();
      if (!nextMode || nextMode === activeMultiEventFunnelEntityMode) {
        return;
      }

      activeMultiEventFunnelEntityMode = nextMode === 'player' ? 'player' : 'deck';
      ensureMultiEventFunnelControls();
      updateMultiEventFunnelChart();
    });
    entityMenu.dataset.listenerBound = 'true';
  }

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

  if (searchInput.dataset.listenerBound !== 'true') {
    searchInput.addEventListener('input', event => {
      selectMultiEventFunnelSearchResult(String(event.target.value || ''), { jumpToFirst: false });
    });

    searchInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        selectMultiEventFunnelSearchResult(searchInput.value || '', { jumpToFirst: true });
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        clearMultiEventFunnelHighlight({ preserveInput: false });
        renderMultiEventFunnelSuggestions('');
        updateMultiEventFunnelSearchStatus('');
        renderMultiEventFunnelViewport();
      }
    });

    searchDropdown.addEventListener('click', event => {
      const option = event.target.closest('[data-multi-event-funnel-search-key]');
      if (!option) {
        return;
      }

      const optionKey = String(option.dataset.multiEventFunnelSearchKey || '').trim();
      const selectedOption = getMultiEventFunnelSearchOptions().find(entry => entry.key === optionKey);
      if (!selectedOption) {
        return;
      }

      setActiveMultiEventFunnelFocus(selectedOption, { scroll: true });
    });

    searchInput.dataset.listenerBound = 'true';
  }

  if (exportButton.dataset.listenerBound !== 'true') {
    exportButton.addEventListener('click', () => {
      exportTopConversionCsv(currentMultiEventFunnelChartData, {
        entityType: activeMultiEventFunnelEntityMode,
        scope: 'multi',
        startDate: document.getElementById('startDateSelect')?.value || '',
        endDate: document.getElementById('endDateSelect')?.value || ''
      });
    });
    exportButton.dataset.listenerBound = 'true';
  }

  syncMultiEventFunnelSearchState();
}

function renderMultiEventFunnelPeriodBadge(rows = []) {
  const canvas = document.getElementById('multiEventFunnelChart');
  const chartContainer = canvas?.closest('.chart-container');
  const toolbar = chartContainer?.querySelector('#multiEventFunnelGroupingToolbar');
  const searchStatus = chartContainer?.querySelector('#multiEventFunnelSearchStatus');
  const startDate = document.getElementById('startDateSelect')?.value || '';
  const endDate = document.getElementById('endDateSelect')?.value || '';

  if (!chartContainer) {
    return;
  }

  renderMultiEventPeriodSummaryBadge({
    container: chartContainer,
    insertAfter: searchStatus || toolbar || chartContainer.querySelector('.chart-title'),
    badgeId: 'multiEventFunnelPeriodBadge',
    rows,
    startDate,
    endDate
  });
}

function ensureMultiEventFunnelViewport() {
  const chartBody = document.getElementById('multiEventFunnelChartBody');
  const canvas = document.getElementById('multiEventFunnelChart');
  if (!chartBody || !canvas) {
    return { chartBody: null, rowsLayer: null, canvas: null };
  }

  chartBody.style.maxHeight = `${MULTI_EVENT_FUNNEL_VIEWPORT_HEIGHT}px`;

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

  const cells = [getMultiEventFunnelPrimaryColumnLabel(), getMultiEventFunnelMetricColumnLabel(), ...bucketLabels];
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
        y: buildEntityRowLabel(item.deck),
        entityName: item.deck,
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

function getMultiEventFunnelInteractiveRow(chart, visibleDecksData, event) {
  const xScale = chart?.scales?.x;
  const yScale = chart?.scales?.y;
  const chartArea = chart?.chartArea;
  if (!xScale || !yScale || !chartArea || !Array.isArray(visibleDecksData) || visibleDecksData.length === 0) {
    return null;
  }

  const pointer = getMultiEventFunnelPointerPosition(event);
  if (!pointer) {
    return null;
  }
  const { x, y } = pointer;

  const xStep = xScale.ticks.length > 1
    ? Math.abs(xScale.getPixelForTick(1) - xScale.getPixelForTick(0))
    : chartArea.width;
  const yStep = yScale.ticks.length > 1
    ? Math.abs(yScale.getPixelForTick(1) - yScale.getPixelForTick(0))
    : chartArea.height;
  const copiesCenterX = xScale.getPixelForValue('Copies');
  const copiesLeft = copiesCenterX - (xStep / 2);
  const copiesRight = copiesCenterX + (xStep / 2);
  const rowHalfHeight = yStep / 2;

  const rowIndex = visibleDecksData.findIndex((_item, index) => {
    const rowCenterY = yScale.getPixelForTick(index);
    return y >= (rowCenterY - rowHalfHeight) && y <= (rowCenterY + rowHalfHeight);
  });
  if (rowIndex === -1) {
    return null;
  }

  const row = visibleDecksData[rowIndex];
  if (x >= 0 && x < copiesLeft) {
    return { type: 'deck', row };
  }

  if (x >= copiesLeft && x <= copiesRight && y >= chartArea.top && y <= chartArea.bottom) {
    return { type: 'copies', row };
  }

  if (x > copiesRight && x <= chartArea.right && y >= chartArea.top && y <= chartArea.bottom) {
    return { type: 'bucket', row };
  }

  return null;
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
  const emptyState = ensureMultiEventFunnelEmptyState();

  const totalRows = currentMultiEventFunnelRows.length;
  const headerHeight = Math.max(0, document.getElementById('multiEventFunnelColumnHeader')?.offsetHeight || 0);
  const desiredBodyHeight = totalRows === 0
    ? Math.min(MULTI_EVENT_FUNNEL_VIEWPORT_HEIGHT, MULTI_EVENT_FUNNEL_EMPTY_HEIGHT + headerHeight)
    : Math.min(
      MULTI_EVENT_FUNNEL_VIEWPORT_HEIGHT,
      (Math.max(totalRows, 1) * MULTI_EVENT_FUNNEL_ROW_HEIGHT) + MULTI_EVENT_FUNNEL_CHART_PADDING_Y + headerHeight
    );
  chartBody.style.height = `${Math.max(desiredBodyHeight, headerHeight + MULTI_EVENT_FUNNEL_ROW_HEIGHT)}px`;
  const { rowsViewportHeight } = getMultiEventFunnelViewportMetrics();
  rowsLayer.style.height = `${Math.max(totalRows, 1) * MULTI_EVENT_FUNNEL_ROW_HEIGHT + MULTI_EVENT_FUNNEL_CHART_PADDING_Y}px`;

  if (totalRows === 0) {
    if (multiEventFunnelChart) {
      multiEventFunnelChart.destroy();
      multiEventFunnelChart = null;
    }
    canvas.style.top = '0px';
    canvas.style.minHeight = '0px';
    canvas.style.height = `${MULTI_EVENT_FUNNEL_EMPTY_HEIGHT}px`;
    canvas.height = MULTI_EVENT_FUNNEL_EMPTY_HEIGHT;
    canvas.style.display = 'none';
    rowsLayer.style.display = 'none';
    updateMultiEventFunnelEmptyState(emptyState);
    return;
  }

  canvas.style.display = 'block';
  rowsLayer.style.display = 'block';
  updateMultiEventFunnelEmptyState(emptyState);

  const { startIndex, endIndex, visibleRows } = getVisibleMultiEventFunnelWindow(totalRows, chartBody.scrollTop, rowsViewportHeight);
  const visibleDecksData = currentMultiEventFunnelRows.slice(startIndex, endIndex);
  const visibleDeckLabels = visibleDecksData.map(item => buildEntityRowLabel(item.deck));
  const renderedRowCount = Math.max(visibleDecksData.length, 1);
  const chartHeight = (renderedRowCount * MULTI_EVENT_FUNNEL_ROW_HEIGHT) + MULTI_EVENT_FUNNEL_CHART_PADDING_Y;
  const maxBucketCount = Math.max(
    0,
    ...currentMultiEventFunnelRows.flatMap(item => groupingMode.buckets.map(bucket => (
      bucket.sourceKeys.reduce((sum, key) => sum + Number(item.counts?.[key] || 0), 0)
    )))
  );
  const datasets = buildMultiEventFunnelDatasets(visibleDecksData, groupingMode, activeTheme);

  canvas.tabIndex = 0;
  if (canvas.dataset.funnelKeyboardBound !== 'true') {
    canvas.addEventListener('keydown', keyboardEvent => {
      if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') {
        return;
      }

      const clickedDeckName = String(canvas.dataset.interactiveDeckName || '').trim();
      if (!clickedDeckName) {
        return;
      }

      keyboardEvent.preventDefault();
      openMultiEventFunnelEntityModal(clickedDeckName);
    });
    canvas.dataset.funnelKeyboardBound = 'true';
  }

  canvas.style.top = `${startIndex * MULTI_EVENT_FUNNEL_ROW_HEIGHT}px`;
  canvas.style.minHeight = '0px';
  canvas.style.height = `${chartHeight}px`;
  canvas.height = chartHeight;

  if (multiEventFunnelChart) {
    multiEventFunnelChart.destroy();
  }

  try {
    multiEventFunnelChart = new Chart(canvas, {
      type: 'scatter',
      plugins: [multiEventFunnelHighlightPlugin, fixedBucketBarPlugin, multiEventFunnelHeaderLayoutPlugin],
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
              text: getMultiEventFunnelXAxisTitle(groupingMode),
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
              text: getMultiEventFunnelYAxisLabel(),
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
          multiEventFunnelHighlightRow: {
            highlightedEntityName: getActiveMultiEventFunnelHighlightedEntityName(),
            highlightFill: 'rgba(217, 164, 65, 0.14)',
            highlightStroke: 'rgba(217, 164, 65, 0.52)'
          },
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
                return `${point.entityName || point.deckName || ''} — ${point.bucketLabel || context.dataset.label}: ${Number(point.rawCount || 0)} (${formatWholePercentage(point.percentage)})`;
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
        onClick: (event, activeElements, chart) => {
          let clickedEntityName = '';
          if (activeElements?.length) {
            const clickedPoint = chart.data.datasets?.[activeElements[0].datasetIndex]?.data?.[activeElements[0].index];
            clickedEntityName = String(clickedPoint?.entityName || clickedPoint?.deckName || '').trim();
          } else {
            const interactiveRow = getMultiEventFunnelInteractiveRow(chart, visibleDecksData, event);
            clickedEntityName = String(interactiveRow?.row?.deck || '').trim();
          }
          if (clickedEntityName) {
            openMultiEventFunnelEntityModal(clickedEntityName);
          }
        },
        onHover(event, activeElements, chart) {
          const interactiveRow = getMultiEventFunnelInteractiveRow(chart, visibleDecksData, event);
          const hoveredPoint = activeElements?.length
            ? chart.data.datasets?.[activeElements[0].datasetIndex]?.data?.[activeElements[0].index]
            : null;
          canvas.dataset.interactiveDeckName = String(
            hoveredPoint?.entityName
              || hoveredPoint?.deckName
              || interactiveRow?.row?.deck
              || ''
          ).trim();
          canvas.style.cursor = activeElements?.length || interactiveRow ? 'pointer' : 'default';
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

  canvas.style.cursor = 'default';
  canvas.dataset.interactiveDeckName = '';
}

function ensureMultiEventFunnelEmptyState() {
  const chartBody = document.getElementById('multiEventFunnelChartBody');
  if (!chartBody) {
    return null;
  }

  let emptyState = chartBody.querySelector('#multiEventFunnelEmptyState');
  if (!emptyState) {
    emptyState = document.createElement('div');
    emptyState.id = 'multiEventFunnelEmptyState';
    emptyState.className = 'multi-event-funnel-empty-state';
    chartBody.appendChild(emptyState);
  }

  return emptyState;
}

function updateMultiEventFunnelEmptyState(emptyState) {
  if (!emptyState) {
    return;
  }

  if (currentMultiEventFunnelRows.length > 0) {
    emptyState.hidden = true;
    emptyState.textContent = '';
    return;
  }

  emptyState.hidden = false;
  emptyState.textContent = 'No conversion data available for the current filters.';
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
  currentMultiEventFunnelChartData = Array.isArray(filteredData) ? [...filteredData] : [];
  renderMultiEventFunnelPeriodBadge(filteredData);
  if (filteredData.length === 0) {
    currentMultiEventFunnelSourceRows = [];
    syncMultiEventFunnelRows();
    syncMultiEventFunnelSearchState();
    if (chartBody) {
      chartBody.scrollTop = 0;
    }
    renderMultiEventFunnelViewport();
    setChartLoading('multiEventFunnelChart', false);
    return;
  }

  currentMultiEventFunnelSourceRows = getMultiEventFunnelRows(filteredData);
  syncMultiEventFunnelRows();
  syncMultiEventFunnelSearchState();
  if (chartBody && currentMultiEventFunnelRows.length > 0) {
    chartBody.scrollTop = 0;
  }
  renderMultiEventFunnelViewport();
  setChartLoading('multiEventFunnelChart', false);
}
