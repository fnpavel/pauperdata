// Builds the normalized leaderboard dataset used by Leaderboards and Player
// Analysis Elo widgets. This module owns date-window resolution, event-type
// filtering, duplicate protection, and the final summary values consumed by UI.
import { buildYearlyEloRatings } from './elo-rating.js';
import { getEloAvailableDates, getEloEventTypes, getEloMatches } from './elo-data.js';
import { loadPrecalculatedRankingsData } from './precalculated-elo.js';

export const DEFAULT_RANKINGS_OPTIONS = Object.freeze({
  startingRating: 1500,
  kFactor: Object.freeze({
    multiYear: 16,
    seasonal: 16
  }),
  resetByYear: true,
  entityMode: 'player',
  preferPrecalculated: true,
  includeHistory: true
});

const DEFAULT_EVENT_TYPE = 'online';

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeEventTypes(eventTypes = []) {
  const normalizedTypes = (Array.isArray(eventTypes) ? eventTypes : [eventTypes])
    .map(value => normalizeText(value).toLowerCase())
    .filter(Boolean);

  return normalizedTypes.length > 0 ? normalizedTypes : [DEFAULT_EVENT_TYPE];
}

function getMatchKey(match, index) {
  // Prefer the generated pair key when present. Older data may not have it, so
  // the fallback uses stable match fields plus the input index to avoid merging
  // legitimate rematches by accident.
  const pairKey = normalizeText(match?.pair_key || match?.pairKey);
  if (pairKey) {
    return pairKey;
  }

  return [
    normalizeText(match?.event_id || match?.eventId || match?.event),
    normalizeText(match?.date || match?.Date),
    String(Number.isFinite(Number(match?.round)) ? Number(match.round) : ''),
    normalizeText(match?.player_key || match?.playerKey),
    normalizeText(match?.opponent_key || match?.opponentKey),
    String(index)
  ].join('|||');
}

function dedupeMatches(matches = []) {
  const dedupedMatches = [];
  const seenMatchKeys = new Set();

  matches.forEach((match, index) => {
    const matchKey = getMatchKey(match, index);
    if (seenMatchKeys.has(matchKey)) {
      return;
    }

    seenMatchKeys.add(matchKey);
    dedupedMatches.push(match);
  });

  return dedupedMatches;
}

function compareSeasonRows(a, b) {
  return (
    Number(b.rating) - Number(a.rating) ||
    Number(b.matches) - Number(a.matches) ||
    Number(b.wins) - Number(a.wins) ||
    String(a.deck || '').localeCompare(String(b.deck || ''), undefined, { sensitivity: 'base' }) ||
    String(a.displayName).localeCompare(String(b.displayName), undefined, { sensitivity: 'base' }) ||
    String(a.playerKey).localeCompare(String(b.playerKey))
  );
}

function getMatchYear(match) {
  const dateValue = normalizeText(match?.date || match?.Date);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? dateValue.slice(0, 4) : '';
}

function getYearRangeLabel(years = []) {
  const normalizedYears = [...new Set((Array.isArray(years) ? years : []).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (normalizedYears.length === 0) {
    return '';
  }

  if (normalizedYears.length === 1) {
    return normalizedYears[0];
  }

  return `${normalizedYears[0]}-${normalizedYears[normalizedYears.length - 1]}`;
}

function getYearsFromResolvedWindow(startDate = '', endDate = '') {
  const startYear = /^\d{4}-\d{2}-\d{2}$/.test(String(startDate || '').trim())
    ? String(startDate).slice(0, 4)
    : '';
  const endYear = /^\d{4}-\d{2}-\d{2}$/.test(String(endDate || '').trim())
    ? String(endDate).slice(0, 4)
    : '';

  if (!startYear || !endYear) {
    return [];
  }

  const startNumericYear = Number(startYear);
  const endNumericYear = Number(endYear);
  if (!Number.isInteger(startNumericYear) || !Number.isInteger(endNumericYear)) {
    return [];
  }

  const years = [];
  for (let year = Math.min(startNumericYear, endNumericYear); year <= Math.max(startNumericYear, endNumericYear); year += 1) {
    years.push(String(year));
  }

  return years;
}

function getNow() {
  return typeof globalThis.performance?.now === 'function'
    ? globalThis.performance.now()
    : Date.now();
}

function logRankingsTiming(message, startTime) {
  const elapsedMs = Math.round((getNow() - startTime) * 10) / 10;
  console.info(`[rankings] ${message} in ${elapsedMs}ms.`);
}

export function getRankingsKFactor(options = {}) {
  const resetByYear = options?.resetByYear !== false;
  return resetByYear
    ? DEFAULT_RANKINGS_OPTIONS.kFactor.seasonal
    : DEFAULT_RANKINGS_OPTIONS.kFactor.multiYear;
}

function finalizeRankingsDataset({
  eloResults,
  resolvedOptions,
  normalizedEventTypes,
  availableDates,
  defaultRange,
  resolvedStartDate,
  resolvedEndDate,
  filteredMatches = [],
  seasonRowsSource = [],
  ratedMatchCount = null,
  selectedMatchCount = null,
  skippedMatchCount = null,
  latestProcessedMatch = null
}) {
  const selectedYears = [...new Set(
    (Array.isArray(filteredMatches) ? filteredMatches : [])
      .map(getMatchYear)
      .filter(Boolean)
  )].sort();
  const resolvedWindowYears = getYearsFromResolvedWindow(resolvedStartDate, resolvedEndDate);
  const fallbackSelectedYears = selectedYears.length > 0
    ? selectedYears
    : (
      resolvedWindowYears.length > 0
        ? resolvedWindowYears
        : [...new Set(
            (Array.isArray(seasonRowsSource) ? seasonRowsSource : [])
              .map(row => String(row?.seasonYear || '').trim())
              .filter(value => /^\d{4}$/.test(value))
          )].sort()
    );
  const selectedYearRangeLabel = getYearRangeLabel(fallbackSelectedYears);
  const seasonRows = [...(Array.isArray(seasonRowsSource) ? seasonRowsSource : [])]
    .map(row => ({
      ...row,
      displaySeasonYear: eloResults.resetByYear
        ? row.seasonYear
        : (selectedYearRangeLabel || row.seasonYear || 'Selected Range')
    }))
    .sort(compareSeasonRows);
  const leader = seasonRows[0] || null;
  const mostActiveSeason = [...seasonRows].sort((a, b) => {
    return (
      Number(b.matches) - Number(a.matches) ||
      Number(b.rating) - Number(a.rating) ||
      String(a.displayName).localeCompare(String(b.displayName), undefined, { sensitivity: 'base' }) ||
      String(a.playerKey).localeCompare(String(b.playerKey))
    );
  })[0] || null;
  const uniquePlayers = new Set(seasonRows.map(row => row.basePlayerKey || row.playerKey)).size;
  const processedMatchList = Array.isArray(eloResults.processedMatches) ? eloResults.processedMatches : [];
  const resolvedLatestProcessedMatch = latestProcessedMatch || processedMatchList[processedMatchList.length - 1] || null;
  const resolvedRatedMatchCount = Number.isFinite(Number(ratedMatchCount))
    ? Number(ratedMatchCount)
    : processedMatchList.length;
  const resolvedSelectedMatchCount = Number.isFinite(Number(selectedMatchCount))
    ? Number(selectedMatchCount)
    : (Array.isArray(filteredMatches) ? filteredMatches.length : resolvedRatedMatchCount);
  const resolvedSkippedMatchCount = Number.isFinite(Number(skippedMatchCount))
    ? Number(skippedMatchCount)
    : Math.max(0, resolvedSelectedMatchCount - resolvedRatedMatchCount);

  return {
    ...eloResults,
    availableDates,
    defaultRange,
    eventTypes: normalizedEventTypes,
    startDate: resolvedStartDate,
    endDate: resolvedEndDate,
    filteredMatches,
    seasonRows,
    summary: {
      leader,
      mostActiveSeason,
      uniquePlayers,
      seasonEntries: seasonRows.length,
      ratedMatches: resolvedRatedMatchCount,
      selectedMatches: resolvedSelectedMatchCount,
      skippedMatches: resolvedSkippedMatchCount,
      latestProcessedMatch: resolvedLatestProcessedMatch,
      selectedYears: fallbackSelectedYears,
      selectedYearRangeLabel
    }
  };
}

// Exposes the event types available to ranking/leaderboard consumers.
export function getRankingsEventTypes() {
  return getEloEventTypes();
}

// Exposes available ranking dates after normalizing the requested event types.
export function getRankingsAvailableDates(eventTypes = [DEFAULT_EVENT_TYPE]) {
  return getEloAvailableDates(normalizeEventTypes(eventTypes));
}

// Chooses the default leaderboard date window from a sorted date list.
export function getDefaultRankingsRange(dates = []) {
  // Leaderboards default to the latest available calendar year instead of the
  // whole archive so first render remains focused and reasonably fast.
  if (!Array.isArray(dates) || dates.length === 0) {
    return {
      startDate: '',
      endDate: '',
      defaultYear: ''
    };
  }

  const latestDate = dates[dates.length - 1];
  const defaultYear = latestDate.slice(0, 4);
  const yearDates = dates.filter(date => date.startsWith(`${defaultYear}-`));

  return {
    startDate: yearDates[0] || dates[0],
    endDate: yearDates[yearDates.length - 1] || latestDate,
    defaultYear
  };
}

// Builds one complete rankings dataset: loaded matches, Elo rows, history maps,
// summary stats, and resolved date metadata.
export async function buildRankingsDataset(
  {
    eventTypes = [DEFAULT_EVENT_TYPE],
    startDate = '',
    endDate = '',
    matchFilter = null
  } = {},
  options = {}
) {
  const loadStartedAt = getNow();
  const resolvedOptions = {
    ...DEFAULT_RANKINGS_OPTIONS,
    ...options,
    kFactor: getRankingsKFactor(options)
  };
  const normalizedEventTypes = normalizeEventTypes(eventTypes);
  const availableDates = getRankingsAvailableDates(normalizedEventTypes);
  const defaultRange = getDefaultRankingsRange(availableDates);
  const resolvedStartDate =
    availableDates.includes(startDate) ? startDate : defaultRange.startDate;
  const resolvedEndDate =
    availableDates.includes(endDate) ? endDate : defaultRange.endDate;

  if (availableDates.length === 0) {
    // Return the full dataset shape even when no files are available. Callers can
    // render empty states without checking for missing properties.
    const eloResults = buildYearlyEloRatings([], {
      ...resolvedOptions
    });

    const emptyDataset = finalizeRankingsDataset({
      eloResults,
      resolvedOptions,
      normalizedEventTypes,
      availableDates,
      defaultRange,
      resolvedStartDate,
      resolvedEndDate,
      filteredMatches: [],
      seasonRowsSource: []
    });
    logRankingsTiming('Resolved empty rankings dataset', loadStartedAt);
    return emptyDataset;
  }

  const canUsePrecalculated = resolvedOptions.preferPrecalculated !== false && typeof matchFilter !== 'function';
  const precalculatedDataset = canUsePrecalculated
    ? await loadPrecalculatedRankingsData({
        eventTypes: normalizedEventTypes,
        startDate: resolvedStartDate,
        endDate: resolvedEndDate,
        resetByYear: resolvedOptions.resetByYear,
        entityMode: resolvedOptions.entityMode
      })
    : null;

  if (precalculatedDataset && resolvedOptions.includeHistory === false) {
    const emptyEloResults = buildYearlyEloRatings([], {
      ...resolvedOptions
    });
    const dataset = finalizeRankingsDataset({
      eloResults: emptyEloResults,
      resolvedOptions,
      normalizedEventTypes,
      availableDates,
      defaultRange,
      resolvedStartDate,
      resolvedEndDate,
      filteredMatches: [],
      seasonRowsSource: precalculatedDataset.rows,
      ratedMatchCount: precalculatedDataset.matchCount,
      selectedMatchCount: precalculatedDataset.selectedMatchCount,
      skippedMatchCount: Math.max(0, precalculatedDataset.selectedMatchCount - precalculatedDataset.matchCount),
      latestProcessedMatch: null
    });
    logRankingsTiming(`Loaded ${resolvedOptions.entityMode} rankings from precalculated data (${precalculatedDataset.relativePath})`, loadStartedAt);
    return dataset;
  }

  const loadedMatches = dedupeMatches(await getEloMatches({
    eventTypes: normalizedEventTypes,
    startDate: resolvedStartDate,
    endDate: resolvedEndDate
  }));
  const filteredMatches = typeof matchFilter === 'function'
    ? loadedMatches.filter(match => {
        try {
          // User-facing quality filters should not be able to break the entire
          // leaderboard if one record shape is unexpected.
          return matchFilter(match);
        } catch (error) {
          return false;
        }
      })
    : loadedMatches;

  const eloResults = buildYearlyEloRatings(filteredMatches, {
    ...resolvedOptions
  });
  const dataset = finalizeRankingsDataset({
    eloResults,
    resolvedOptions,
    normalizedEventTypes,
    availableDates,
    defaultRange,
    resolvedStartDate,
    resolvedEndDate,
    filteredMatches,
    seasonRowsSource: precalculatedDataset?.rows || eloResults.seasonRows,
    ratedMatchCount: precalculatedDataset?.matchCount ?? eloResults.processedMatches.length,
    selectedMatchCount: precalculatedDataset?.selectedMatchCount ?? filteredMatches.length,
    skippedMatchCount: precalculatedDataset
      ? Math.max(0, precalculatedDataset.selectedMatchCount - precalculatedDataset.matchCount)
      : eloResults.skippedMatchCount,
    latestProcessedMatch: eloResults.processedMatches[eloResults.processedMatches.length - 1] || null
  });
  logRankingsTiming(
    precalculatedDataset
      ? `Loaded ${resolvedOptions.entityMode} rankings with precalculated rows and runtime history fallback`
      : `Loaded ${resolvedOptions.entityMode} rankings with runtime Elo calculation`,
    loadStartedAt
  );
  return dataset;
}
