const DEFAULT_EVENT_TYPE = 'online';
const PRECALCULATED_ROOT = new URL('../../data/precalculated-elo/', import.meta.url);

let precalculatedManifestPromise = null;

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeEventTypes(eventTypes = []) {
  const normalizedTypes = (Array.isArray(eventTypes) ? eventTypes : [eventTypes])
    .map(value => normalizeText(value).toLowerCase())
    .filter(Boolean);

  return normalizedTypes.length > 0 ? normalizedTypes : [DEFAULT_EVENT_TYPE];
}

function normalizeEntityScope(entityMode = 'player') {
  return String(entityMode || 'player').trim().toLowerCase() === 'player_deck'
    ? 'player-on-deck'
    : 'player';
}

function getYearFromDate(dateValue = '') {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || '').trim())
    ? String(dateValue).slice(0, 4)
    : '';
}

async function loadManifest() {
  if (!precalculatedManifestPromise) {
    precalculatedManifestPromise = fetch(new URL('manifest.json', PRECALCULATED_ROOT))
      .then(response => {
        if (!response.ok) {
          throw new Error(`Failed to load precalculated Elo manifest (${response.status})`);
        }

        return response.json();
      })
      .catch(error => {
        precalculatedManifestPromise = null;
        throw error;
      });
  }

  return precalculatedManifestPromise;
}

function getAvailableDatesForTypes(manifest, eventTypes = [DEFAULT_EVENT_TYPE]) {
  const normalizedTypes = normalizeEventTypes(eventTypes);
  const datesByEventType = manifest?.available_dates_by_event_type || {};

  return [...new Set(
    normalizedTypes.flatMap(eventType => Array.isArray(datesByEventType[eventType]) ? datesByEventType[eventType] : [])
  )].sort((a, b) => a.localeCompare(b));
}

function resolveDateWindowDescriptor(manifest, {
  eventTypes = [DEFAULT_EVENT_TYPE],
  startDate = '',
  endDate = '',
  resetByYear = true
} = {}) {
  const normalizedEventTypes = normalizeEventTypes(eventTypes);
  if (normalizedEventTypes.length !== 1 || normalizedEventTypes[0] !== DEFAULT_EVENT_TYPE) {
    return null;
  }

  const dates = getAvailableDatesForTypes(manifest, normalizedEventTypes);
  if (!startDate || !endDate || !dates.includes(startDate) || !dates.includes(endDate)) {
    return null;
  }

  const startYear = getYearFromDate(startDate);
  const endYear = getYearFromDate(endDate);
  if (!startYear || !endYear) {
    return null;
  }

  const firstDateByYear = new Map();
  const lastDateByYear = new Map();
  dates.forEach(date => {
    const year = getYearFromDate(date);
    if (!year) {
      return;
    }

    if (!firstDateByYear.has(year)) {
      firstDateByYear.set(year, date);
    }
    lastDateByYear.set(year, date);
  });

  if (startDate !== firstDateByYear.get(startYear) || endDate !== lastDateByYear.get(endYear)) {
    return null;
  }

  if (startYear === endYear) {
    return {
      type: 'seasonal',
      year: startYear
    };
  }

  return {
    type: 'multi-year',
    rangeKey: `${startYear}-${endYear}`,
    mode: resetByYear === false ? 'continuous' : 'reset'
  };
}

function mapPayloadRow(row = {}, descriptor = null) {
  const seasonKey = normalizeText(row?.seasonKey)
    || (descriptor?.type === 'seasonal' ? String(descriptor.year || '') : '');
  const seasonYear = normalizeText(row?.seasonYear)
    || (descriptor?.type === 'seasonal' ? String(descriptor.year || '') : '');

  return {
    seasonKey,
    seasonYear,
    playerKey: normalizeText(row?.playerKey),
    displayName: normalizeText(row?.displayName || row?.basePlayerName || row?.playerKey),
    basePlayerKey: normalizeText(row?.basePlayerKey || row?.playerKey),
    basePlayerName: normalizeText(row?.basePlayerName || row?.displayName || row?.playerKey),
    deck: normalizeText(row?.deck),
    rating: Number(row?.rating) || 0,
    matches: Number(row?.matches) || 0,
    wins: Number(row?.wins) || 0,
    losses: Number(row?.losses) || 0,
    winRate: Number(row?.winRate) || 0,
    lastActiveDate: normalizeText(row?.lastActiveDate),
    eloGain: Number(row?.eloGain) || 0,
    eventCount: Number(row?.eventCount) || 0
  };
}

const warnedFallbackReasons = new Set();

function warnFallback(message, error = null) {
  const warningKey = `${message}|||${error?.message || ''}`;
  if (warnedFallbackReasons.has(warningKey)) {
    return;
  }

  warnedFallbackReasons.add(warningKey);
  if (error) {
    console.warn(message, error);
    return;
  }

  console.warn(message);
}

export function clearPrecalculatedEloManifestCache() {
  precalculatedManifestPromise = null;
}

export async function loadPrecalculatedRankingsData({
  eventTypes = [DEFAULT_EVENT_TYPE],
  startDate = '',
  endDate = '',
  resetByYear = true,
  entityMode = 'player'
} = {}) {
  try {
    const manifest = await loadManifest();
    const descriptor = resolveDateWindowDescriptor(manifest, {
      eventTypes,
      startDate,
      endDate,
      resetByYear
    });
    if (!descriptor) {
      return null;
    }

    const scope = normalizeEntityScope(entityMode);
    const scopeConfig = manifest?.scopes?.[scope];
    if (!scopeConfig) {
      warnFallback(`[rankings] Missing precalculated Elo scope "${scope}". Falling back to runtime Elo calculation.`);
      return null;
    }

    const relativePath = descriptor.type === 'seasonal'
      ? scopeConfig?.seasonal_by_year?.[String(descriptor.year)]
      : scopeConfig?.multi_year_by_range?.[descriptor.rangeKey]?.[descriptor.mode];
    if (!relativePath) {
      return null;
    }

    const response = await fetch(new URL(relativePath, PRECALCULATED_ROOT));
    if (!response.ok) {
      throw new Error(`Failed to load ${relativePath} (${response.status})`);
    }

    const payload = await response.json();
    const rows = Array.isArray(payload?.rows)
      ? payload.rows.map(row => mapPayloadRow(row, descriptor))
      : null;
    if (!rows) {
      throw new Error(`Invalid row payload in ${relativePath}`);
    }

    return {
      descriptor,
      relativePath,
      generatedAt: normalizeText(payload?.generatedAt || manifest?.generatedAt),
      matchCount: Number(payload?.matchCount) || 0,
      selectedMatchCount: Number(payload?.selectedMatchCount) || Number(payload?.matchCount) || 0,
      rows
    };
  } catch (error) {
    warnFallback('[rankings] Failed to load precalculated Elo data. Falling back to runtime Elo calculation.', error);
    return null;
  }
}
