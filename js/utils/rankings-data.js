// Builds the normalized leaderboard dataset used by Leaderboards and Player
// Analysis Elo widgets. This module owns date-window resolution, event-type
// filtering, duplicate protection, and the final summary values consumed by UI.
import { buildYearlyEloRatings } from './elo-rating.js';
import { getEloAvailableDates, getEloEventTypes, getEloMatches } from './elo-data.js';

export const DEFAULT_RANKINGS_OPTIONS = Object.freeze({
  startingRating: 1500,
  kFactor: Object.freeze({
    multiYear: 16,
    seasonal: 16
  }),
  resetByYear: true,
  entityMode: 'player'
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

export function getRankingsKFactor(options = {}) {
  const resetByYear = options?.resetByYear !== false;
  return resetByYear
    ? DEFAULT_RANKINGS_OPTIONS.kFactor.seasonal
    : DEFAULT_RANKINGS_OPTIONS.kFactor.multiYear;
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

    return {
      ...eloResults,
      availableDates,
      defaultRange,
      eventTypes: normalizedEventTypes,
      startDate: resolvedStartDate,
      endDate: resolvedEndDate,
      filteredMatches: [],
      seasonRows: [],
      summary: {
        leader: null,
        mostActiveSeason: null,
        uniquePlayers: 0,
        seasonEntries: 0,
        ratedMatches: 0,
        selectedMatches: 0,
        skippedMatches: 0,
        latestProcessedMatch: null,
        selectedYears: [],
        selectedYearRangeLabel: ''
      }
    };
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
  const selectedYears = [...new Set(
    filteredMatches
      .map(getMatchYear)
      .filter(Boolean)
  )].sort();
  const selectedYearRangeLabel = getYearRangeLabel(selectedYears);
  const seasonRows = [...eloResults.seasonRows]
    .map(row => ({
      ...row,
      // Continuous all-time mode still needs a human-readable period label in
      // tables and reports, so derive it from the selected match years.
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
  const latestProcessedMatch = eloResults.processedMatches[eloResults.processedMatches.length - 1] || null;

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
      ratedMatches: eloResults.processedMatches.length,
      selectedMatches: filteredMatches.length,
      skippedMatches: eloResults.skippedMatchCount,
      latestProcessedMatch,
      selectedYears,
      selectedYearRangeLabel
    }
  };
}
