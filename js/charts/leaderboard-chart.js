import { formatDate, formatEventName } from '../utils/format.js';

export function buildEventLevelEloPoints(historyEntries = []) {
  if (!historyEntries.length) {
    return [];
  }

  const eventMap = new Map();

  historyEntries.forEach(entry => {
    const eventKey = [
      String(entry.seasonKey || '').trim(),
      String(entry.date || '').trim(),
      String(entry.eventId || '').trim(),
      String(entry.event || '').trim()
    ].join('|||');

    const normalizedRound = Number.isFinite(Number(entry.round)) ? Number(entry.round) : Number.NEGATIVE_INFINITY;
    const currentEntry = eventMap.get(eventKey);
    if (!currentEntry || normalizedRound >= currentEntry.roundSortValue) {
      eventMap.set(eventKey, {
        ...entry,
        roundSortValue: normalizedRound
      });
    }
  });

  return Array.from(eventMap.values())
    .sort((a, b) => {
      return (
        String(a.date || '').localeCompare(String(b.date || '')) ||
        String(a.eventId || '').localeCompare(String(b.eventId || '')) ||
        Number(a.roundSortValue || 0) - Number(b.roundSortValue || 0)
      );
    })
    .map((entry, index) => ({
      index,
      date: entry.date,
      event: entry.event,
      eventId: entry.eventId,
      label: `${entry.date ? formatDate(entry.date) : '--'} - ${formatEventName(entry.event) || entry.event || 'Unknown Event'}`,
      ratingAfter: Number(entry.ratingAfter),
      delta: Number(entry.delta)
    }))
    .filter(point => Number.isFinite(point.ratingAfter));
}

export function buildLeaderboardTimeline(processedMatches = []) {
  const eventMap = new Map();

  (processedMatches || []).forEach(match => {
    const eventKey = [
      String(match.seasonKey || '').trim(),
      String(match.date || '').trim(),
      String(match.event_id || match.eventId || '').trim(),
      String(match.event || '').trim()
    ].join('|||');

    if (!eventMap.has(eventKey)) {
      eventMap.set(eventKey, {
        key: eventKey,
        date: String(match.date || '').trim(),
        eventId: String(match.event_id || match.eventId || '').trim(),
        event: String(match.event || '').trim()
      });
    }
  });

  return Array.from(eventMap.values())
    .sort((a, b) => {
      return (
        String(a.date || '').localeCompare(String(b.date || '')) ||
        String(a.eventId || '').localeCompare(String(b.eventId || '')) ||
        String(a.event || '').localeCompare(String(b.event || ''))
      );
    })
    .map((entry, index) => ({
      ...entry,
      index,
      label: `${entry.date ? formatDate(entry.date) : '--'} - ${formatEventName(entry.event) || entry.event || 'Unknown Event'}`
    }));
}

export function getLeaderboardTimelineColor(index = 0) {
  const palette = [
    '#d4a657',
    '#5aa9e6',
    '#ef6f6c',
    '#7bd389',
    '#c792ea',
    '#f4a261',
    '#4ecdc4',
    '#ff6b6b'
  ];

  return palette[index % palette.length];
}

export function shouldShowLeaderboardYearBoundaries(dataset = {}) {
  const selectedYears = Array.isArray(dataset?.summary?.selectedYears) ? dataset.summary.selectedYears : [];
  return dataset?.period?.windowMode === 'range' && !dataset?.resetByYear && selectedYears.length > 1;
}

function getLeaderboardEntryYear(entry = {}) {
  const year = String(entry?.date || '').slice(0, 4);
  return /^\d{4}$/.test(year) ? year : '';
}

export function buildLeaderboardYearBands(entries = []) {
  return (Array.isArray(entries) ? entries : []).reduce((bands, entry, index) => {
    const year = getLeaderboardEntryYear(entry);
    if (!year) {
      return bands;
    }

    const currentBand = bands[bands.length - 1];
    if (currentBand && currentBand.year === year && currentBand.endIndex === index - 1) {
      currentBand.endIndex = index;
      return bands;
    }

    bands.push({
      year,
      startIndex: index,
      endIndex: index
    });
    return bands;
  }, []);
}

export function buildLeaderboardYearBoundaryMarkers(entries = []) {
  return buildLeaderboardYearBands(entries).slice(1).map(band => ({
    index: band.startIndex,
    year: band.year
  }));
}

const LEADERBOARD_YEAR_BAND_COLORS = [
  'rgba(217, 164, 65, 0.08)',
  'rgba(90, 169, 230, 0.06)',
  'rgba(123, 211, 137, 0.06)',
  'rgba(239, 111, 108, 0.05)'
];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getLeaderboardYearBandPixelRange(xScale, chartArea, band, lastIndex) {
  const startPixel = xScale.getPixelForValue(band.startIndex);
  const endPixel = xScale.getPixelForValue(band.endIndex);
  if (!Number.isFinite(startPixel) || !Number.isFinite(endPixel)) {
    return null;
  }

  const previousPixel = band.startIndex > 0
    ? xScale.getPixelForValue(band.startIndex - 1)
    : chartArea.left;
  const nextPixel = band.endIndex < lastIndex
    ? xScale.getPixelForValue(band.endIndex + 1)
    : chartArea.right;

  const left = band.startIndex > 0 && Number.isFinite(previousPixel)
    ? (previousPixel + startPixel) / 2
    : chartArea.left;
  const right = band.endIndex < lastIndex && Number.isFinite(nextPixel)
    ? (endPixel + nextPixel) / 2
    : chartArea.right;

  return {
    left: clamp(Math.min(left, right), chartArea.left, chartArea.right),
    right: clamp(Math.max(left, right), chartArea.left, chartArea.right)
  };
}

const leaderboardYearBoundaryPlugin = {
  id: 'leaderboardYearBoundaryPlugin',
  beforeDraw(chart, _args, pluginOptions) {
    const bands = Array.isArray(pluginOptions?.bands) ? pluginOptions.bands : [];
    if (!bands.length) {
      return;
    }

    const xScale = chart.scales?.x;
    const chartArea = chart.chartArea;
    const labels = Array.isArray(chart.data?.labels) ? chart.data.labels : [];
    const lastIndex = labels.length - 1;
    if (!xScale || !chartArea || lastIndex < 0) {
      return;
    }

    const ctx = chart.ctx;
    const bandColors = Array.isArray(pluginOptions?.bandColors) && pluginOptions.bandColors.length
      ? pluginOptions.bandColors
      : LEADERBOARD_YEAR_BAND_COLORS;

    ctx.save();
    bands.forEach((band, index) => {
      const pixelRange = getLeaderboardYearBandPixelRange(xScale, chartArea, band, lastIndex);
      if (!pixelRange || pixelRange.right <= pixelRange.left) {
        return;
      }

      ctx.fillStyle = bandColors[index % bandColors.length];
      ctx.fillRect(
        pixelRange.left,
        chartArea.top,
        pixelRange.right - pixelRange.left,
        chartArea.bottom - chartArea.top
      );
    });
    ctx.restore();
  },
  afterDatasetsDraw(chart, _args, pluginOptions) {
    const bands = Array.isArray(pluginOptions?.bands) ? pluginOptions.bands : [];
    if (!bands.length) {
      return;
    }

    const xScale = chart.scales?.x;
    const chartArea = chart.chartArea;
    const labels = Array.isArray(chart.data?.labels) ? chart.data.labels : [];
    const lastIndex = labels.length - 1;
    if (!xScale || !chartArea || lastIndex < 0) {
      return;
    }

    const ctx = chart.ctx;
    const lineColor = pluginOptions?.lineColor || 'rgba(212, 166, 87, 0.35)';
    const labelColor = pluginOptions?.labelColor || '#d4a657';
    const labelMinWidth = Number.isFinite(pluginOptions?.labelMinWidth) ? pluginOptions.labelMinWidth : 64;

    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = lineColor;
    ctx.fillStyle = labelColor;
    ctx.font = '600 12px Bitter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    bands.slice(1).forEach(band => {
      const pixelRange = getLeaderboardYearBandPixelRange(xScale, chartArea, band, lastIndex);
      const x = pixelRange?.left;
      if (!Number.isFinite(x)) {
        return;
      }

      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
    });

    ctx.setLineDash([]);
    bands.forEach(band => {
      const pixelRange = getLeaderboardYearBandPixelRange(xScale, chartArea, band, lastIndex);
      const bandWidth = pixelRange ? pixelRange.right - pixelRange.left : 0;
      if (!pixelRange || bandWidth < labelMinWidth) {
        return;
      }

      const labelX = clamp((pixelRange.left + pixelRange.right) / 2, chartArea.left + 20, chartArea.right - 20);
      ctx.fillText(band.year, labelX, chartArea.top + 6);
    });

    ctx.restore();
  }
};

function getChartThemeColors() {
  const computed = getComputedStyle(document.documentElement);
  return {
    text: computed.getPropertyValue('--chart-text').trim() || '#333',
    muted: computed.getPropertyValue('--chart-muted-text').trim() || '#888',
    grid: computed.getPropertyValue('--chart-grid').trim() || 'rgba(0,0,0,0.1)'
  };
}

export function destroyLeaderboardChart(chartInstance) {
  if (chartInstance) {
    chartInstance.destroy();
  }
  return null;
}

export function createLeaderboardPlayerEloChart(canvas, {
  row,
  points = [],
  labels = [],
  datasets = [],
  timelineEntries = [],
  formatRating,
  showYearBoundaries = false,
  onLegendToggle = null
} = {}) {
  const resolvedLabels = labels.length > 0
    ? labels
    : points.map(point => point.label);
  const resolvedDatasets = datasets.length > 0
    ? datasets
    : (!row || !points.length ? [] : [{
        label: row.displayName || row.playerKey || 'Player Elo',
        data: points.map(point => point.ratingAfter),
        borderColor: getLeaderboardTimelineColor(0),
        backgroundColor: 'rgba(212, 166, 87, 0.18)',
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
        tension: 0.25,
        fill: true,
        tooltipLabelPrefix: 'Elo'
      }]);
  const resolvedTimelineEntries = timelineEntries.length > 0
    ? timelineEntries
    : points;

  if (!canvas || !globalThis.Chart || !resolvedLabels.length || !resolvedDatasets.length) {
    return null;
  }

  const theme = getChartThemeColors();
  const yearBands = showYearBoundaries
    ? buildLeaderboardYearBands(resolvedTimelineEntries)
    : [];
  const visibleYearBands = yearBands.length > 1 ? yearBands : [];

  return new globalThis.Chart(canvas, {
    type: 'line',
    plugins: [leaderboardYearBoundaryPlugin],
    data: {
      labels: resolvedLabels,
      datasets: resolvedDatasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      aspectRatio: 2.2,
      interaction: {
        mode: 'nearest',
        intersect: false
      },
      plugins: {
        leaderboardYearBoundaryPlugin: {
          bands: visibleYearBands,
          bandColors: LEADERBOARD_YEAR_BAND_COLORS,
          lineColor: 'rgba(212, 166, 87, 0.38)',
          labelColor: theme.text || '#d4a657',
          labelMinWidth: 54
        },
        legend: {
          display: resolvedDatasets.length > 1,
          position: 'top',
          onClick(event, legendItem, legend) {
            const defaultLegendClick = globalThis.Chart?.defaults?.plugins?.legend?.onClick;
            if (typeof defaultLegendClick === 'function') {
              defaultLegendClick(event, legendItem, legend);
            } else if (legend?.chart && Number.isInteger(legendItem?.datasetIndex)) {
              const datasetIndex = legendItem.datasetIndex;
              const chart = legend.chart;
              if (typeof chart.setDatasetVisibility === 'function' && typeof chart.isDatasetVisible === 'function') {
                chart.setDatasetVisibility(datasetIndex, !chart.isDatasetVisible(datasetIndex));
              }
              chart.update();
            }

            if (typeof onLegendToggle === 'function') {
              onLegendToggle(legend?.chart || null);
            }
          },
          labels: {
            color: theme.text
          }
        },
        datalabels: {
          display: false
        },
        tooltip: {
          callbacks: {
            title(items) {
              return items[0]?.label || '';
            },
            label(context) {
              if (!Number.isFinite(context.parsed.y)) {
                return `${context.dataset.label}: no event result`;
              }

              const tooltipLabelPrefix = context.dataset.tooltipLabelPrefix || context.dataset.label || 'Elo';
              return `${tooltipLabelPrefix}: ${formatRating(context.parsed.y)}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            maxRotation: 60,
            minRotation: 30,
            color: theme.muted
          },
          grid: {
            color: theme.grid
          }
        },
        y: {
          ticks: {
            color: theme.muted,
            callback(value) {
              return formatRating(value);
            }
          },
          grid: {
            color: theme.grid
          }
        }
      }
    }
  });
}

export function createLeaderboardTimelineChart(canvas, {
  labels = [],
  datasets = [],
  timelineEntries = [],
  formatRating,
  showYearBoundaries = false,
  onLegendToggle = null
} = {}) {
  if (!canvas || !globalThis.Chart || !labels.length || !datasets.length) {
    return null;
  }

  const theme = getChartThemeColors();
  const yearBands = showYearBoundaries
    ? buildLeaderboardYearBands(timelineEntries)
    : [];
  const visibleYearBands = yearBands.length > 1 ? yearBands : [];

  return new globalThis.Chart(canvas, {
    type: 'line',
    plugins: [leaderboardYearBoundaryPlugin],
    data: {
      labels,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      aspectRatio: 2.2,
      interaction: {
        mode: 'nearest',
        intersect: false
      },
      plugins: {
        leaderboardYearBoundaryPlugin: {
          bands: visibleYearBands,
          bandColors: LEADERBOARD_YEAR_BAND_COLORS,
          lineColor: 'rgba(212, 166, 87, 0.34)',
          labelColor: theme.text || '#d4a657',
          labelMinWidth: 54
        },
        legend: {
          position: 'top',
          onClick(event, legendItem, legend) {
            const defaultLegendClick = globalThis.Chart?.defaults?.plugins?.legend?.onClick;
            if (typeof defaultLegendClick === 'function') {
              defaultLegendClick(event, legendItem, legend);
            } else if (legend?.chart && Number.isInteger(legendItem?.datasetIndex)) {
              const datasetIndex = legendItem.datasetIndex;
              const chart = legend.chart;
              if (typeof chart.setDatasetVisibility === 'function' && typeof chart.isDatasetVisible === 'function') {
                chart.setDatasetVisibility(datasetIndex, !chart.isDatasetVisible(datasetIndex));
              }
              chart.update();
            }

            if (typeof onLegendToggle === 'function') {
              onLegendToggle(legend?.chart || null);
            }
          },
          labels: {
            color: theme.text
          }
        },
        datalabels: {
          display: false
        },
        tooltip: {
          callbacks: {
            label(context) {
              if (!Number.isFinite(context.parsed.y)) {
                return `${context.dataset.label}: no event result`;
              }
              return `${context.dataset.label}: ${formatRating(context.parsed.y)}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            maxRotation: 60,
            minRotation: 30,
            color: theme.muted
          },
          grid: {
            color: theme.grid
          }
        },
        y: {
          ticks: {
            color: theme.muted,
            callback(value) {
              return formatRating(value);
            }
          },
          grid: {
            color: theme.grid
          }
        }
      }
    }
  });
}
