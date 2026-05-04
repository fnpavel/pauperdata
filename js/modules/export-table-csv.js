// CSV export helpers for tables and matchup matrices. Export modules receive
// already-rendered table state and convert it to stable, spreadsheet-friendly
// rows without reaching back into the DOM.
import { formatDate, formatEventName } from '../utils/format.js';
import { getMultiEventPeriodBadgeParts } from '../utils/multi-event-period-badge.js';
import { getPlayerIdentityKey } from '../utils/player-names.js';

// Escapes a single CSV field.
export function escapeCsvValue(value) {
  const text = String(value ?? '');
  // RFC-style CSV escaping: quote fields only when commas, quotes, or newlines
  // would otherwise break the column shape.
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

// Converts arbitrary UI labels into filesystem-safe CSV filenames.
export function sanitizeCsvFilename(value) {
  return String(value || '')
    .trim()
    .replace(/[\/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'matchup';
}

function formatCrossTabMatrixCell(cell, {
  format = 'combined',
  mirrorCellLabel = 'Mirror',
  blankValue = '--'
} = {}) {
  if (!cell || cell.total === 0) {
    return blankValue;
  }

  if (format === 'record') {
    return `${cell.wins}-${cell.losses}`;
  }

  const winRate = cell.total > 0 ? ((cell.wins / cell.total) * 100).toFixed(1) : '';
  if (format === 'winrate') {
    return winRate || blankValue;
  }

  const matchLabel = `${cell.total} ${cell.total === 1 ? 'match' : 'matches'}`;
  if (cell.isMirror) {
    return `${mirrorCellLabel} | ${matchLabel}`;
  }

  return `${winRate}% | ${cell.wins}-${cell.losses} | ${matchLabel}`;
}

function formatCrossTabSummaryValue(stats, {
  format = 'combined',
  blankValue = '--'
} = {}) {
  if (!stats || Number(stats.decisiveMatches || 0) <= 0) {
    return blankValue;
  }

  if (format === 'record') {
    return `${stats.wins}-${stats.losses}`;
  }

  const winRate = stats.decisiveMatches > 0 ? ((stats.wins / stats.decisiveMatches) * 100).toFixed(1) : '';
  if (format === 'winrate') {
    return winRate || blankValue;
  }

  return `${winRate}% | ${stats.wins}-${stats.losses}`;
}

// Builds a CSV string for deck/player matchup matrices.
export function buildCrossTabMatrixCsv(matrixData, rowHeaderLabel = 'Played Deck', metadataRows = [], options = {}) {
  if (!matrixData || !Array.isArray(matrixData.rowOrder) || !Array.isArray(matrixData.columnOrder)) {
    return '';
  }

  const {
    mirrorCellLabel = 'Mirror',
    format = 'combined',
    blankValue = '--',
    excludeDiagonal = false,
    includeSummaryRow = false,
    includeSummaryColumn = false,
    summaryLabel = 'Total',
    summaryCornerValue = ''
  } = options || {};
  const rows = [];

  if (Array.isArray(metadataRows) && metadataRows.length > 0) {
    // Metadata rows give exported files enough context to be useful outside the
    // dashboard, while the blank row keeps the actual matrix easy to locate.
    metadataRows.forEach(metadataRow => {
      rows.push((metadataRow || []).map(escapeCsvValue).join(','));
    });
    rows.push('');
  }

  const headerRow = [rowHeaderLabel, ...matrixData.columnOrder.map(columnKey => {
    return matrixData.columnStatsMap.get(columnKey)?.deck || columnKey;
  })];

  if (includeSummaryColumn) {
    headerRow.push(summaryLabel);
  }

  rows.push(headerRow.map(escapeCsvValue).join(','));

  if (includeSummaryRow) {
    const summaryRow = [
      summaryLabel,
      ...matrixData.columnOrder.map(columnKey => {
        const columnStats = matrixData.columnStatsMap.get(columnKey);
        return formatCrossTabSummaryValue(columnStats, { format, blankValue });
      })
    ];

    if (includeSummaryColumn) {
      summaryRow.push(summaryCornerValue);
    }

    rows.push(summaryRow.map(escapeCsvValue).join(','));
  }

  matrixData.rowOrder.forEach(rowKey => {
    const rowLabel = matrixData.rowStatsMap.get(rowKey)?.deck || rowKey;
    const rowCells = matrixData.columnOrder.map(columnKey => {
      if (excludeDiagonal && rowKey === columnKey) {
        return blankValue;
      }

      const cell = matrixData.cellMap.get(rowKey)?.get(columnKey);
      return formatCrossTabMatrixCell(cell, { format, mirrorCellLabel, blankValue });
    });

    const rowValues = [rowLabel, ...rowCells];
    if (includeSummaryColumn) {
      const rowStats = matrixData.rowStatsMap.get(rowKey);
      rowValues.push(formatCrossTabSummaryValue(rowStats, { format, blankValue }));
    }

    rows.push(rowValues.map(escapeCsvValue).join(','));
  });

  return rows.join('\r\n');
}

// Builds a CSV string from generic column definitions and row objects.
export function buildStructuredTableCsv(columnDefinitions = [], rows = [], metadataRows = []) {
  if (!Array.isArray(columnDefinitions) || columnDefinitions.length === 0) {
    return '';
  }

  const csvRows = [];

  if (Array.isArray(metadataRows) && metadataRows.length > 0) {
    metadataRows.forEach(metadataRow => {
      csvRows.push((metadataRow || []).map(escapeCsvValue).join(','));
    });
    csvRows.push('');
  }

  csvRows.push(
    columnDefinitions
      .map(column => column?.header || column?.label || column?.key || '')
      .map(escapeCsvValue)
      .join(',')
  );

  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const values = columnDefinitions.map(column => {
      if (typeof column?.value === 'function') {
        return column.value(row, index);
      }

      if (column?.key && row && typeof row === 'object') {
        return row[column.key];
      }

      return '';
    });

    csvRows.push(values.map(escapeCsvValue).join(','));
  });

  return csvRows.join('\r\n');
}

// Downloads a CSV string in the browser.
export function downloadCsvFile(filename, csvText) {
  // Browser-only download path: create a temporary object URL, click a hidden
  // anchor, then immediately release the blob URL.
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename, csvText) {
  downloadCsvFile(filename, csvText);
}

function formatExportPercentage(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function buildMonthSlug(dateStr = '') {
  const [year, month] = String(dateStr || '').split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return '';
  }

  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' }).toLowerCase();
}

function buildMultiEventPeriodFilenameSuffix(startDate = '', endDate = '') {
  if (!startDate || !endDate) {
    return 'selected-period';
  }

  const startYear = startDate.slice(0, 4);
  const endYear = endDate.slice(0, 4);
  const startMonth = buildMonthSlug(startDate);
  const endMonth = buildMonthSlug(endDate);

  if (startYear === endYear) {
    return startMonth === endMonth
      ? `${startYear}-${startMonth}`
      : `${startYear}-${startMonth}-${endMonth}`;
  }

  return `${startYear}-${startMonth}-${endYear}-${endMonth}`;
}

function formatGeneratedTimestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes())
  ].join('');
}

function getActiveMultiEventFilterSummary() {
  const eventTypeLabels = Array.from(document.querySelectorAll('#eventAnalysisSection .event-type-filter.active'))
    .map(button => button.textContent.trim())
    .filter(Boolean);
  const groupLabels = Array.from(document.querySelectorAll('#multiEventSelectionSummaryContent .multi-event-group-card.active .multi-event-group-card-label'))
    .map(label => label.textContent.trim())
    .filter(Boolean);
  const summaryParts = [];

  if (eventTypeLabels.length > 0) {
    summaryParts.push(`Event Types: ${eventTypeLabels.join(', ')}`);
  }

  if (groupLabels.length > 0) {
    summaryParts.push(`Event Groups: ${groupLabels.join(', ')}`);
  }

  return summaryParts.join('; ');
}

export function buildCsvMetadataRows({
  report = '',
  mode = '',
  scope = 'multi',
  rows = [],
  startDate = '',
  endDate = '',
  eventName = '',
  filters = ''
} = {}) {
  const metadataRows = [];

  if (report) {
    metadataRows.push(['Report', report]);
  }

  if (mode) {
    metadataRows.push(['Mode', mode]);
  }

  if (scope === 'multi') {
    const { yearLabel, dateRangeLabel, eventTypeLabels } = getMultiEventPeriodBadgeParts(rows, { startDate, endDate });
    metadataRows.push(['Period', yearLabel || 'No events selected']);
    metadataRows.push(['Date Range', dateRangeLabel || 'No events selected']);
    metadataRows.push(['Events', eventTypeLabels.length > 0 ? eventTypeLabels.join('; ') : 'No events selected']);
    metadataRows.push(['Generated At', formatGeneratedTimestamp()]);
    metadataRows.push(['Filters', filters || getActiveMultiEventFilterSummary() || 'All selected events']);
    return metadataRows;
  }

  metadataRows.push(['Event', formatEventName(eventName) || eventName || 'Selected Event']);
  metadataRows.push(['Generated At', formatGeneratedTimestamp()]);
  if (filters) {
    metadataRows.push(['Filters', filters]);
  }
  return metadataRows;
}

function getTopConversionBaseStatsByDeck(rows = []) {
  const filteredRows = (Array.isArray(rows) ? rows : []).filter(row => {
    const deckName = String(row?.Deck || '').trim();
    return deckName && deckName.toUpperCase() !== 'UNKNOWN';
  });

  const statsMap = filteredRows.reduce((acc, row) => {
    const deckName = String(row?.Deck || '').trim();
    if (!acc[deckName]) {
      acc[deckName] = {
        entity: deckName,
        entries: 0,
        events: new Set(),
        trophies: 0,
        top2_8: 0,
        top9_16: 0,
        top17_32: 0,
        belowTop32: 0
      };
    }

    const deckStats = acc[deckName];
    deckStats.entries += 1;
    deckStats.events.add(`${String(row?.Date || '').trim()}:::${String(row?.Event || '').trim()}`);

    const rank = Number(row?.Rank);
    if (rank === 1) {
      deckStats.trophies += 1;
    } else if (rank >= 2 && rank <= 8) {
      deckStats.top2_8 += 1;
    } else if (rank >= 9 && rank <= 16) {
      deckStats.top9_16 += 1;
    } else if (rank >= 17 && rank <= 32) {
      deckStats.top17_32 += 1;
    } else {
      deckStats.belowTop32 += 1;
    }

    return acc;
  }, {});

  return Object.values(statsMap);
}

function getTopConversionBaseStatsByPlayer(rows = []) {
  const statsMap = {};

  (Array.isArray(rows) ? rows : []).forEach(row => {
    const playerName = String(row?.Player || '').trim();
    const playerKey = getPlayerIdentityKey(playerName);
    if (!playerKey) {
      return;
    }

    if (!statsMap[playerKey]) {
      statsMap[playerKey] = {
        entity: playerName,
        entries: 0,
        events: new Set(),
        trophies: 0,
        top2_8: 0,
        top9_16: 0,
        top17_32: 0,
        belowTop32: 0
      };
    }

    const playerStats = statsMap[playerKey];
    playerStats.entries += 1;
    playerStats.events.add(`${String(row?.Date || '').trim()}:::${String(row?.Event || '').trim()}`);

    const rank = Number(row?.Rank);
    if (rank === 1) {
      playerStats.trophies += 1;
    } else if (rank >= 2 && rank <= 8) {
      playerStats.top2_8 += 1;
    } else if (rank >= 9 && rank <= 16) {
      playerStats.top9_16 += 1;
    } else if (rank >= 17 && rank <= 32) {
      playerStats.top17_32 += 1;
    } else {
      playerStats.belowTop32 += 1;
    }
  });

  return Object.values(statsMap);
}

export function buildTopConversionExportRows(rows = [], { entityType = 'deck' } = {}) {
  const baseRows = entityType === 'player'
    ? getTopConversionBaseStatsByPlayer(rows)
    : getTopConversionBaseStatsByDeck(rows);

  return baseRows
    .map(baseRow => {
      const entries = Number(baseRow.entries || 0);
      const top8Count = Number(baseRow.trophies || 0) + Number(baseRow.top2_8 || 0);
      return {
        ...baseRow,
        top8Count,
        top8Percent: entries > 0 ? (top8Count / entries) * 100 : 0,
        top9_16Percent: entries > 0 ? (Number(baseRow.top9_16 || 0) / entries) * 100 : 0,
        top17_32Percent: entries > 0 ? (Number(baseRow.top17_32 || 0) / entries) * 100 : 0,
        belowTop32Percent: entries > 0 ? (Number(baseRow.belowTop32 || 0) / entries) * 100 : 0,
        eventsPlayed: baseRow.events instanceof Set ? baseRow.events.size : 0
      };
    })
    .sort((a, b) => b.top8Percent - a.top8Percent || String(a.entity || '').localeCompare(String(b.entity || '')))
    .map((row, index) => ({
      rank: index + 1,
      ...row
    }));
}

export function exportTopConversionCsv(rows = [], {
  entityType = 'deck',
  scope = 'multi',
  startDate = '',
  endDate = '',
  eventName = ''
} = {}) {
  const exportRows = buildTopConversionExportRows(rows, { entityType });
  if (exportRows.length === 0) {
    return false;
  }

  const entityHeader = entityType === 'player' ? 'Player' : 'Deck';
  const countHeader = entityType === 'player' ? 'Entries' : 'Copies';
  const columnDefinitions = [
    { header: 'Rank', key: 'rank' },
    { header: entityHeader, key: 'entity' },
    { header: countHeader, key: 'entries' },
    ...(entityType === 'player' ? [{ header: 'Events Played', key: 'eventsPlayed' }] : []),
    { header: 'Trophies', key: 'trophies' },
    { header: 'Top 2-8', key: 'top2_8' },
    { header: 'Top 9-16', key: 'top9_16' },
    { header: 'Top 17-32', key: 'top17_32' },
    { header: 'Below Top 32', key: 'belowTop32' },
    { header: 'Top 8 Conversion', value: row => formatExportPercentage(row.top8Percent) },
    { header: 'Top 9-16 Conversion', value: row => formatExportPercentage(row.top9_16Percent) },
    { header: 'Top 17-32 Conversion', value: row => formatExportPercentage(row.top17_32Percent) },
    { header: 'Below Top 32 Conversion', value: row => formatExportPercentage(row.belowTop32Percent) }
  ];

  const metadataRows = buildCsvMetadataRows({
    report: 'Top Conversion',
    mode: entityType === 'player' ? 'Players' : 'Decks',
    scope,
    rows,
    startDate,
    endDate,
    eventName
  });

  const csvText = buildStructuredTableCsv(columnDefinitions, exportRows, metadataRows);
  const filename = scope === 'single'
    ? sanitizeCsvFilename(`single-event-top-conversion-${entityType === 'player' ? 'players' : 'decks'}-${formatEventName(eventName) || eventName || 'selected-event'}.csv`)
    : sanitizeCsvFilename(`multi-event-top-conversion-${entityType === 'player' ? 'players' : 'decks'}-${buildMultiEventPeriodFilenameSuffix(startDate, endDate)}.csv`);

  downloadCsv(filename, csvText);
  return true;
}

function buildTableMetadata(title = '') {
  return title ? [['Table', title]] : [];
}

// Exports the currently visible Event Analysis table.
export function downloadEventAnalysisCsv(tableState = {}, fallbackName = 'event-analysis-table') {
  const {
    tableType = 'raw',
    title = fallbackName,
    rows = [],
    displayMode = 'percent',
    group = 'single',
    runningEloLabel = '2024-2026'
  } = tableState || {};

  if (!Array.isArray(rows) || rows.length === 0) {
    return false;
  }

  let columnDefinitions = [];

  // Column definitions deliberately mirror the visible table modes so exported
  // CSV files match what the user was looking at when they clicked Download.
  if (group === 'single' && tableType === 'raw') {
    columnDefinitions = [
      { header: 'Rank', key: 'rank' },
      { header: 'Player', key: 'player' },
      { header: 'Deck', key: 'deck' },
      { header: 'Wins', key: 'wins' },
      { header: 'Losses', key: 'losses' },
      { header: 'Win Rate', value: row => `${Number(row.winRate || 0).toFixed(2)}%` },
      { header: 'Season Elo Gained', value: row => Number.isFinite(Number(row.seasonEloDelta)) ? `${Math.round(Number(row.seasonEloDelta)) > 0 ? '+' : ''}${Math.round(Number(row.seasonEloDelta))}` : '--' },
      { header: 'Season Elo', value: row => Number.isFinite(Number(row.seasonElo)) ? String(Math.round(Number(row.seasonElo))) : '--' },
      { header: 'Running Elo Gained', value: row => Number.isFinite(Number(row.runningEloDelta)) ? `${Math.round(Number(row.runningEloDelta)) > 0 ? '+' : ''}${Math.round(Number(row.runningEloDelta))}` : '--' },
      { header: `Running Elo (${runningEloLabel})`, value: row => Number.isFinite(Number(row.runningElo)) ? String(Math.round(Number(row.runningElo))) : '--' }
    ];
  } else if ((group === 'single' && tableType === 'aggregate') || (group === 'multi' && tableType === 'aggregate')) {
    columnDefinitions = [
      { header: 'Deck', key: 'deck' },
      { header: group === 'single' ? 'Number of Players' : 'Aggregate Meta', value: row => (
        group === 'single' ? row.count : `${Number(row.metaShare || 0).toFixed(1)}%`
      ) },
      ...(group === 'single'
        ? [{ header: '% of Meta', value: row => `${Number(row.metaShare || 0).toFixed(1)}%` }]
        : []),
      { header: group === 'single' ? 'Win Rate %' : 'Aggregate Win Rate', value: row => `${Number(row.winRate || 0).toFixed(1)}%` },
      { header: 'Top 8', value: row => displayMode === 'raw' ? row.top8 : `${Number(row.top8Percent || 0).toFixed(1)}%` },
      { header: 'Top 9-16', value: row => displayMode === 'raw' ? row.top16 : `${Number(row.top16Percent || 0).toFixed(1)}%` },
      { header: 'Top 17-32', value: row => displayMode === 'raw' ? row.top32 : `${Number(row.top32Percent || 0).toFixed(1)}%` },
      { header: 'Below Top 32', value: row => displayMode === 'raw' ? row.belowTop32 : `${Number(row.belowTop32Percent || 0).toFixed(1)}%` }
    ];
  } else if (group === 'multi' && tableType === 'deck') {
    columnDefinitions = [
      { header: 'Date', value: row => formatDate(row.date) },
      { header: 'Event', value: row => formatEventName(row.event) || row.event || '--' },
      { header: 'Meta Share', value: row => `${Number(row.metaShare || 0).toFixed(1)}%` },
      { header: 'Win Rate', value: row => `${Number(row.winRate || 0).toFixed(1)}%` },
      { header: 'Top 8', value: row => displayMode === 'raw' ? row.top8 : `${Number(row.top8Percent || 0).toFixed(1)}%` },
      { header: 'Top 9-16', value: row => displayMode === 'raw' ? row.top16 : `${Number(row.top16Percent || 0).toFixed(1)}%` },
      { header: 'Top 17-32', value: row => displayMode === 'raw' ? row.top32 : `${Number(row.top32Percent || 0).toFixed(1)}%` },
      { header: 'Below Top 32', value: row => displayMode === 'raw' ? row.belowTop32 : `${Number(row.belowTop32Percent || 0).toFixed(1)}%` }
    ];
  }

  if (columnDefinitions.length === 0) {
    return false;
  }

  const csvText = buildStructuredTableCsv(columnDefinitions, rows, buildTableMetadata(title));
  downloadCsvFile(`${sanitizeCsvFilename(title || fallbackName)}.csv`, csvText);
  return true;
}

// Exports the currently visible Player Analysis table.
export function downloadPlayerAnalysisCsv(tableState = {}, fallbackName = 'player-analysis-table') {
  const {
    tableType = 'event',
    title = fallbackName,
    rows = [],
    runningEloLabel = '2024-2026'
  } = tableState || {};

  if (!Array.isArray(rows) || rows.length === 0) {
    return false;
  }

  const columnDefinitions = tableType === 'event'
    ? [
      { header: 'Date', key: 'date' },
      { header: 'Event', key: 'event' },
      { header: 'Number of Players', key: 'players' },
      { header: 'Rank', key: 'rank' },
      { header: 'Deck', key: 'deck' },
      { header: 'Wins', key: 'wins' },
      { header: 'Losses', key: 'losses' },
      { header: 'Player Win Rate', value: row => `${Number(row.winRate || 0).toFixed(1)}%` },
      { header: "Deck's Overall Win Rate", value: row => `${Number(row.deckWinRate || 0).toFixed(1)}%` },
      { header: "Deck's Meta", value: row => `${Number(row.deckMeta || 0).toFixed(1)}%` },
      { header: 'Season Elo Gained', value: row => Number.isFinite(Number(row.seasonEloDelta)) ? `${Math.round(Number(row.seasonEloDelta)) > 0 ? '+' : ''}${Math.round(Number(row.seasonEloDelta))}` : '--' },
      { header: 'Season Elo', value: row => Number.isFinite(Number(row.seasonElo)) ? String(Math.round(Number(row.seasonElo))) : '--' },
      { header: 'Running Elo Gained', value: row => Number.isFinite(Number(row.runningEloDelta)) ? `${Math.round(Number(row.runningEloDelta)) > 0 ? '+' : ''}${Math.round(Number(row.runningEloDelta))}` : '--' },
      { header: `Running Elo (${runningEloLabel})`, value: row => Number.isFinite(Number(row.runningElo)) ? String(Math.round(Number(row.runningElo))) : '--' }
    ]
    : [
      { header: 'Deck', key: 'deck' },
      { header: 'Number of Events', key: 'events' },
      { header: 'Wins', key: 'wins' },
      { header: 'Losses', key: 'losses' },
      { header: 'Overall Win Rate', value: row => `${Number(row.overallWinRate || 0).toFixed(2)}%` },
      { header: 'Best Win Rate', value: row => `${Number(row.bestWinRate || 0).toFixed(2)}%` },
      { header: 'Best Event', value: row => `${row.bestDate || '--'} - ${row.bestEvent || '--'}` },
      { header: 'Worst Win Rate', value: row => `${Number(row.worstWinRate || 0).toFixed(2)}%` },
      { header: 'Worst Event', value: row => `${row.worstDate || '--'} - ${row.worstEvent || '--'}` },
      { header: 'Elo Deck', value: row => Number.isFinite(Number(row.deckElo)) ? String(Math.round(Number(row.deckElo))) : '--' }
    ];

  const csvText = buildStructuredTableCsv(columnDefinitions, rows, buildTableMetadata(title));
  downloadCsvFile(`${sanitizeCsvFilename(title || fallbackName)}.csv`, csvText);
  return true;
}
