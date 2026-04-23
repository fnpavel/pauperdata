// CSV export helpers for tables and matchup matrices. Export modules receive
// already-rendered table state and convert it to stable, spreadsheet-friendly
// rows without reaching back into the DOM.
import { formatDate, formatEventName } from '../utils/format.js';

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
    group = 'single'
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
      { header: 'Win Rate', value: row => `${Number(row.winRate || 0).toFixed(2)}%` }
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
    rows = []
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
      { header: "Deck's Meta", value: row => `${Number(row.deckMeta || 0).toFixed(1)}%` }
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
      { header: 'Worst Event', value: row => `${row.worstDate || '--'} - ${row.worstEvent || '--'}` }
    ];

  const csvText = buildStructuredTableCsv(columnDefinitions, rows, buildTableMetadata(title));
  downloadCsvFile(`${sanitizeCsvFilename(title || fallbackName)}.csv`, csvText);
  return true;
}
