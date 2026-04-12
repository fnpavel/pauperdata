export function escapeCsvValue(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function sanitizeCsvFilename(value) {
  return String(value || '')
    .trim()
    .replace(/[\/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'matchup';
}

export function buildCrossTabMatrixCsv(matrixData, rowHeaderLabel = 'Played Deck', metadataRows = []) {
  if (!matrixData || !Array.isArray(matrixData.rowOrder) || !Array.isArray(matrixData.columnOrder)) {
    return '';
  }

  const rows = [];

  if (Array.isArray(metadataRows) && metadataRows.length > 0) {
    metadataRows.forEach(metadataRow => {
      rows.push((metadataRow || []).map(escapeCsvValue).join(','));
    });
    rows.push('');
  }

  const headerRow = [rowHeaderLabel, ...matrixData.columnOrder.map(columnKey => {
    return matrixData.columnStatsMap.get(columnKey)?.deck || columnKey;
  })];

  rows.push(headerRow.map(escapeCsvValue).join(','));

  matrixData.rowOrder.forEach(rowKey => {
    const rowLabel = matrixData.rowStatsMap.get(rowKey)?.deck || rowKey;
    const rowCells = matrixData.columnOrder.map(columnKey => {
      const cell = matrixData.cellMap.get(rowKey)?.get(columnKey);
      if (!cell || cell.total === 0) {
        return '--';
      }
      const winRate = cell.total > 0 ? ((cell.wins / cell.total) * 100).toFixed(1) : '0.0';
      return `${cell.wins}-${cell.losses} (${winRate}%)`;
    });

    rows.push([rowLabel, ...rowCells].map(escapeCsvValue).join(','));
  });

  return rows.join('\r\n');
}

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

export function downloadCsvFile(filename, csvText) {
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
