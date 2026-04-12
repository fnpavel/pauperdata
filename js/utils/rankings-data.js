import { buildYearlyEloRatings } from './elo-rating.js';
import { getMatchupMatches, filterMatchupRecords } from './matchup-data.js';

export const DEFAULT_RANKINGS_OPTIONS = Object.freeze({
  startingRating: 1500,
  kFactor: 16,
  resetByYear: true
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
    String(a.displayName).localeCompare(String(b.displayName), undefined, { sensitivity: 'base' }) ||
    String(a.playerKey).localeCompare(String(b.playerKey))
  );
}

export function getRankingsEventTypes() {
  return [...new Set(
    getMatchupMatches()
      .map(match => normalizeText(match?.event_type || match?.EventType).toLowerCase())
      .filter(Boolean)
  )].sort();
}

export function getRankingsAvailableDates(eventTypes = [DEFAULT_EVENT_TYPE]) {
  const normalizedEventTypes = normalizeEventTypes(eventTypes);

  return [...new Set(
    filterMatchupRecords(getMatchupMatches(), { eventTypes: normalizedEventTypes })
      .map(match => normalizeText(match?.date || match?.Date))
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));
}

export function getDefaultRankingsRange(dates = []) {
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

export function buildRankingsDataset(
  {
    eventTypes = [DEFAULT_EVENT_TYPE],
    startDate = '',
    endDate = ''
  } = {},
  options = {}
) {
  const normalizedEventTypes = normalizeEventTypes(eventTypes);
  const availableDates = getRankingsAvailableDates(normalizedEventTypes);
  const defaultRange = getDefaultRankingsRange(availableDates);
  const resolvedStartDate =
    availableDates.includes(startDate) ? startDate : defaultRange.startDate;
  const resolvedEndDate =
    availableDates.includes(endDate) ? endDate : defaultRange.endDate;

  const filteredMatches = dedupeMatches(
    filterMatchupRecords(getMatchupMatches(), {
      eventTypes: normalizedEventTypes,
      startDate: resolvedStartDate,
      endDate: resolvedEndDate
    })
  );

  const eloResults = buildYearlyEloRatings(filteredMatches, {
    ...DEFAULT_RANKINGS_OPTIONS,
    ...options
  });
  const seasonRows = [...eloResults.seasonRows].sort(compareSeasonRows);
  const leader = seasonRows[0] || null;
  const mostActiveSeason = [...seasonRows].sort((a, b) => {
    return (
      Number(b.matches) - Number(a.matches) ||
      Number(b.rating) - Number(a.rating) ||
      String(a.displayName).localeCompare(String(b.displayName), undefined, { sensitivity: 'base' }) ||
      String(a.playerKey).localeCompare(String(b.playerKey))
    );
  })[0] || null;
  const uniquePlayers = new Set(seasonRows.map(row => row.playerKey)).size;
  const latestProcessedMatch = eloResults.processedMatches[eloResults.processedMatches.length - 1] || null;
  const selectedYears = [...new Set(
    seasonRows
      .map(row => row.seasonYear)
      .filter(Boolean)
  )].sort();

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
      selectedYears
    }
  };
}
