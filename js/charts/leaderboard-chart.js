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

export function buildLeaderboardYearBoundaryMarkers(entries = []) {
  const seenYears = new Set();

  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const year = String(entry?.date || '').slice(0, 4);
      if (!year || seenYears.has(year)) {
        return null;
      }

      seenYears.add(year);
      return {
        index,
        year
      };
    })
    .filter(Boolean)
    .slice(1);
}

const leaderboardYearBoundaryPlugin = {
  id: 'leaderboardYearBoundaryPlugin',
  afterDatasetsDraw(chart, _args, pluginOptions) {
    const markers = Array.isArray(pluginOptions?.markers) ? pluginOptions.markers : [];
    if (!markers.length) {
      return;
    }

    const xScale = chart.scales?.x;
    const chartArea = chart.chartArea;
    if (!xScale || !chartArea) {
      return;
    }

    const ctx = chart.ctx;
    const lineColor = pluginOptions?.lineColor || 'rgba(212, 166, 87, 0.35)';
    const labelColor = pluginOptions?.labelColor || '#d4a657';

    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = lineColor;
    ctx.fillStyle = labelColor;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    markers.forEach(marker => {
      const x = xScale.getPixelForValue(marker.index);
      if (!Number.isFinite(x)) {
        return;
      }

      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.fillText(`${marker.year} start`, Math.min(x + 6, chartArea.right - 58), chartArea.top + 6);
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
  showYearBoundaries = false
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
  const yearBoundaryMarkers = showYearBoundaries
    ? buildLeaderboardYearBoundaryMarkers(resolvedTimelineEntries)
    : [];

  return new globalThis.Chart(canvas, {
    type: 'line',
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
          markers: yearBoundaryMarkers,
          lineColor: 'rgba(212, 166, 87, 0.38)',
          labelColor: theme.text || '#d4a657'
        },
        legend: {
          display: resolvedDatasets.length > 1,
          position: 'top',
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
  showYearBoundaries = false
} = {}) {
  if (!canvas || !globalThis.Chart || !labels.length || !datasets.length) {
    return null;
  }

  const theme = getChartThemeColors();
  const yearBoundaryMarkers = showYearBoundaries
    ? buildLeaderboardYearBoundaryMarkers(timelineEntries)
    : [];

  return new globalThis.Chart(canvas, {
    type: 'line',
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
          markers: yearBoundaryMarkers,
          lineColor: 'rgba(212, 166, 87, 0.34)',
          labelColor: theme.text || '#d4a657'
        },
        legend: {
          position: 'top',
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
