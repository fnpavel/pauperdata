// Parses and compares leaderboard CSV exports by stable identity so row moves
// do not mask stat corruption.

const HEADER_RANK_LABEL = 'rank';
const HEADER_PLAYER_LABEL = 'player';
const STORAGE_KEY_PREFIX = 'pauper-dashboard-leaderboard-csv-reference::';
const METADATA_IDENTITY_COLUMNS_LABEL = 'Integrity Identity Columns';
const METADATA_VERSION_LABEL = 'Integrity Version';
const INTEGRITY_VERSION = '1';
const COMPATIBILITY_METADATA_LABELS = Object.freeze([
  'View',
  'Window Type',
  'Rating Continuity',
  'Selected Window',
  'Selected Years',
  'Date Range',
  'Event Types',
  'Deck Scope',
  'Metric'
]);

function normalizeHeader(value = '') {
  return String(value || '').trim();
}

function normalizeHeaderKey(value = '') {
  return normalizeHeader(value).toLowerCase();
}

function normalizeCell(value = '') {
  return String(value ?? '').trim();
}

function parseCsvLine(line = '') {
  const values = [];
  let current = '';
  let index = 0;
  let inQuotes = false;

  while (index < line.length) {
    const char = line[index];

    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 2;
          continue;
        }

        inQuotes = false;
        index += 1;
        continue;
      }

      current += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }

    if (char === ',') {
      values.push(current);
      current = '';
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  values.push(current);
  return values;
}

export function parseCsvRecords(csvText = '') {
  const normalizedText = String(csvText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedText.split('\n');
  const rows = lines.map(parseCsvLine);
  const headerRowIndex = rows.findIndex(row => {
    const normalizedRow = row.map(normalizeHeaderKey);
    return normalizedRow[0] === HEADER_RANK_LABEL && normalizedRow.includes(HEADER_PLAYER_LABEL);
  });

  if (headerRowIndex < 0) {
    throw new Error('Unable to locate leaderboard table header row in CSV.');
  }

  const metadataRows = rows.slice(0, headerRowIndex)
    .filter(row => row.some(value => normalizeCell(value)));
  const headers = rows[headerRowIndex].map(normalizeHeader);
  const records = rows
    .slice(headerRowIndex + 1)
    .filter(row => row.some(value => normalizeCell(value)))
    .map((row, rowIndex) => {
      const values = headers.reduce((record, header, columnIndex) => {
        record[header] = row[columnIndex] ?? '';
        return record;
      }, {});

      return {
        ...values,
        __rowIndex: rowIndex,
        __sourceLine: headerRowIndex + rowIndex + 2
      };
    });

  return {
    metadataRows,
    headers,
    records,
    headerRowIndex
  };
}

function getMetadataValue(metadataRows = [], label = '') {
  const normalizedLabel = normalizeHeader(label).toLowerCase();
  const row = metadataRows.find(candidate => normalizeHeader(candidate?.[0]).toLowerCase() === normalizedLabel);
  return row?.[1] ?? '';
}

function buildMetadataMap(metadataRows = []) {
  return (Array.isArray(metadataRows) ? metadataRows : []).reduce((map, row) => {
    const label = normalizeHeader(row?.[0]);
    if (!label) {
      return map;
    }

    map.set(label, normalizeCell(row?.[1]));
    return map;
  }, new Map());
}

function buildCompatibilitySignature(metadataRows = []) {
  const metadataMap = buildMetadataMap(metadataRows);
  return COMPATIBILITY_METADATA_LABELS.reduce((signature, label) => {
    const value = normalizeCell(metadataMap.get(label));
    if (value) {
      signature[label] = value;
    }
    return signature;
  }, {});
}

function compareCompatibilitySignatures(oldSignature = {}, newSignature = {}) {
  return COMPATIBILITY_METADATA_LABELS.reduce((differences, label) => {
    const oldValue = normalizeCell(oldSignature[label]);
    const newValue = normalizeCell(newSignature[label]);
    if (oldValue !== newValue) {
      differences.push({
        label,
        oldValue,
        newValue
      });
    }
    return differences;
  }, []);
}

function getIdentityColumns(headers = [], metadataRows = []) {
  if (headers.includes('Identity Key')) {
    return ['Identity Key'];
  }

  if (headers.includes('Player Key') && headers.includes('Season Key')) {
    return ['Player Key', 'Season Key'];
  }

  const metadataValue = normalizeCell(getMetadataValue(metadataRows, METADATA_IDENTITY_COLUMNS_LABEL));
  const metadataColumns = metadataValue
    ? metadataValue.split('|').map(normalizeHeader).filter(Boolean)
    : [];

  if (metadataColumns.length > 0) {
    return metadataColumns.filter(column => headers.includes(column));
  }

  const fallbackColumns = headers.filter(header => {
    const normalized = normalizeHeaderKey(header);
    if (!normalized || normalized === HEADER_RANK_LABEL) {
      return false;
    }

    return normalized === HEADER_PLAYER_LABEL
      || normalized.endsWith('key')
      || normalized.includes('identity')
      || normalized.includes('deck')
      || normalized.includes('season')
      || normalized.includes('window')
      || normalized.includes('entry');
  });

  if (fallbackColumns.length > 0) {
    return fallbackColumns;
  }

  if (headers.includes('Player') && headers.some(header => normalizeHeaderKey(header).includes('season') || normalizeHeaderKey(header).includes('entry'))) {
    const secondaryHeader = headers.find(header => normalizeHeaderKey(header).includes('season') || normalizeHeaderKey(header).includes('entry'));
    return secondaryHeader ? ['Player', secondaryHeader] : ['Player'];
  }

  return headers.filter(header => normalizeHeaderKey(header) !== HEADER_RANK_LABEL).slice(0, 2);
}

function getStatColumns(headers = [], identityColumns = []) {
  const identitySet = new Set(identityColumns.map(normalizeHeaderKey));
  return headers.filter(header => {
    const normalized = normalizeHeaderKey(header);
    return normalized && normalized !== HEADER_RANK_LABEL && !identitySet.has(normalized);
  });
}

function buildIdentityKey(record = {}, identityColumns = []) {
  const explicitIdentity = normalizeCell(record['Identity Key']);
  if (explicitIdentity) {
    return explicitIdentity;
  }

  return identityColumns.map(column => normalizeCell(record[column])).join('|||');
}

function buildStatVector(record = {}, statColumns = []) {
  return statColumns.reduce((vector, column) => {
    vector[column] = normalizeCell(record[column]);
    return vector;
  }, {});
}

function areStatVectorsEqual(leftVector = {}, rightVector = {}, statColumns = []) {
  return statColumns.every(column => normalizeCell(leftVector[column]) === normalizeCell(rightVector[column]));
}

function buildChangedColumns(oldRecord = {}, newRecord = {}, statColumns = []) {
  return statColumns.reduce((changes, column) => {
    const oldValue = normalizeCell(oldRecord[column]);
    const newValue = normalizeCell(newRecord[column]);
    if (oldValue !== newValue) {
      changes.push({
        column,
        oldValue,
        newValue
      });
    }
    return changes;
  }, []);
}

function indexRecordsByIdentity(records = [], identityColumns = []) {
  const map = new Map();

  records.forEach(record => {
    const identityKey = buildIdentityKey(record, identityColumns);
    if (!identityKey) {
      throw new Error(`Encountered leaderboard row without a stable identity: ${JSON.stringify(record)}`);
    }

    if (map.has(identityKey)) {
      throw new Error(`Duplicate leaderboard identity detected: ${identityKey}`);
    }

    map.set(identityKey, record);
  });

  return map;
}

function buildOrderingChange(identityKey, oldRecord = {}, newRecord = {}) {
  return {
    identityKey,
    player: normalizeCell(newRecord.Player || oldRecord.Player),
    oldRank: normalizeCell(oldRecord.Rank),
    newRank: normalizeCell(newRecord.Rank),
    oldIndex: Number(oldRecord.__rowIndex),
    newIndex: Number(newRecord.__rowIndex)
  };
}

export function compareLeaderboardCsvText(oldCsvText = '', newCsvText = '') {
  const oldTable = parseCsvRecords(oldCsvText);
  const newTable = parseCsvRecords(newCsvText);
  const oldCompatibility = buildCompatibilitySignature(oldTable.metadataRows);
  const newCompatibility = buildCompatibilitySignature(newTable.metadataRows);
  const compatibilityDifferences = compareCompatibilitySignatures(oldCompatibility, newCompatibility);
  const isCompatible = compatibilityDifferences.length === 0;
  const identityColumns = getIdentityColumns(newTable.headers, newTable.metadataRows);
  const statColumns = getStatColumns(newTable.headers, identityColumns);
  const oldByIdentity = isCompatible ? indexRecordsByIdentity(oldTable.records, identityColumns) : new Map();
  const newByIdentity = isCompatible ? indexRecordsByIdentity(newTable.records, identityColumns) : new Map();

  const identitiesOnlyInOld = [];
  const identitiesOnlyInNew = [];
  const changedStatVectors = [];
  const orderingChanges = [];

  oldByIdentity.forEach((oldRecord, identityKey) => {
    if (!newByIdentity.has(identityKey)) {
      identitiesOnlyInOld.push({
        identityKey,
        player: normalizeCell(oldRecord.Player),
        record: oldRecord
      });
      return;
    }

    const newRecord = newByIdentity.get(identityKey);
    const changedColumns = buildChangedColumns(oldRecord, newRecord, statColumns);

    if (changedColumns.length > 0) {
      changedStatVectors.push({
        identityKey,
        player: normalizeCell(newRecord.Player || oldRecord.Player),
        changedColumns,
        oldRecord,
        newRecord
      });
      return;
    }

    if (
      normalizeCell(oldRecord.Rank) !== normalizeCell(newRecord.Rank)
      || Number(oldRecord.__rowIndex) !== Number(newRecord.__rowIndex)
    ) {
      orderingChanges.push(buildOrderingChange(identityKey, oldRecord, newRecord));
    }
  });

  newByIdentity.forEach((newRecord, identityKey) => {
    if (!oldByIdentity.has(identityKey)) {
      identitiesOnlyInNew.push({
        identityKey,
        player: normalizeCell(newRecord.Player),
        record: newRecord
      });
    }
  });

  const hasUnexpectedChanges = !isCompatible
    || identitiesOnlyInOld.length > 0
    || identitiesOnlyInNew.length > 0
    || changedStatVectors.length > 0;

  return {
    metadata: {
      integrityVersion: normalizeCell(getMetadataValue(newTable.metadataRows, METADATA_VERSION_LABEL)) || INTEGRITY_VERSION,
      compatibility: {
        isCompatible,
        differences: compatibilityDifferences,
        oldSignature: oldCompatibility,
        newSignature: newCompatibility
      },
      identityColumns,
      statColumns
    },
    oldRowCount: oldTable.records.length,
    newRowCount: newTable.records.length,
    identitiesOnlyInOld,
    identitiesOnlyInNew,
    changedStatVectors,
    orderingChanges,
    hasUnexpectedChanges
  };
}

export function buildLeaderboardIntegritySummary(report = {}) {
  const compatibilityDifferences = Array.isArray(report?.metadata?.compatibility?.differences)
    ? report.metadata.compatibility.differences.length
    : 0;
  const isCompatible = report?.metadata?.compatibility?.isCompatible !== false;
  const onlyOld = Array.isArray(report.identitiesOnlyInOld) ? report.identitiesOnlyInOld.length : 0;
  const onlyNew = Array.isArray(report.identitiesOnlyInNew) ? report.identitiesOnlyInNew.length : 0;
  const changed = Array.isArray(report.changedStatVectors) ? report.changedStatVectors.length : 0;
  const ordering = Array.isArray(report.orderingChanges) ? report.orderingChanges.length : 0;

  return [
    `compatible: ${isCompatible ? 'yes' : 'no'}`,
    `compatibility differences: ${compatibilityDifferences}`,
    `shared stat changes: ${changed}`,
    `old-only identities: ${onlyOld}`,
    `new-only identities: ${onlyNew}`,
    `pure ordering changes: ${ordering}`
  ].join(' | ');
}

function getStorage() {
  try {
    return globalThis?.localStorage || null;
  } catch {
    return null;
  }
}

function buildReferenceStorageKey(referenceKey = '') {
  return `${STORAGE_KEY_PREFIX}${String(referenceKey || '').trim()}`;
}

export function readStoredLeaderboardCsvReference(referenceKey = '') {
  const storage = getStorage();
  if (!storage || !referenceKey) {
    return '';
  }

  try {
    return String(storage.getItem(buildReferenceStorageKey(referenceKey)) || '');
  } catch {
    return '';
  }
}

export function writeStoredLeaderboardCsvReference(referenceKey = '', csvText = '') {
  const storage = getStorage();
  if (!storage || !referenceKey) {
    return false;
  }

  try {
    storage.setItem(buildReferenceStorageKey(referenceKey), String(csvText || ''));
    return true;
  } catch {
    return false;
  }
}

export function clearStoredLeaderboardCsvReference(referenceKey = '') {
  const storage = getStorage();
  if (!storage || !referenceKey) {
    return false;
  }

  try {
    storage.removeItem(buildReferenceStorageKey(referenceKey));
    return true;
  } catch {
    return false;
  }
}

export {
  INTEGRITY_VERSION,
  METADATA_IDENTITY_COLUMNS_LABEL,
  METADATA_VERSION_LABEL
};
