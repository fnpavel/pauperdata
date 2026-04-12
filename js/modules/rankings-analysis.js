import { escapeHtml, getTopMode } from './filters/shared.js';
import { updateElementHTML, updateElementText, triggerUpdateAnimation } from '../utils/dom.js';
import { formatDate, formatEventName } from '../utils/format.js';
import {
  DEFAULT_RANKINGS_OPTIONS,
  buildRankingsDataset,
  getRankingsAvailableDates
} from '../utils/rankings-data.js';
import {
  getDefaultRankingsPeriodId,
  getRankingsPeriodDefinitions
} from '../utils/rankings-periods.js';

const DEFAULT_EVENT_TYPE = 'online';
const RANKINGS_STAT_CARD_IDS = [
  'rankingsWindowCard',
  'rankingsRatedMatchesCard',
  'rankingsTrackedPlayersCard',
  'rankingsLeaderCard',
  'rankingsMostActiveCard'
];

let activeRankingsPeriodId = '';
let currentRankingRows = [];
let currentRankingsDataset = {
  summary: {
    selectedYears: [],
    ratedMatches: 0
  },
  eventTypes: [DEFAULT_EVENT_TYPE],
  period: null
};
let rankingsTableSort = {
  key: 'rating',
  direction: 'desc'
};

function getRankingsSection() {
  return document.getElementById('rankingsSection');
}

function getRankingsEventTypeButtons() {
  return Array.from(getRankingsSection()?.querySelectorAll('.rankings-event-type-filter') || []);
}

function getSelectedRankingsEventTypes() {
  return getRankingsEventTypeButtons()
    .filter(button => button.classList.contains('active'))
    .map(button => String(button.dataset.type || '').toLowerCase())
    .filter(Boolean);
}

function setRankingsEventType(nextType = DEFAULT_EVENT_TYPE) {
  const normalizedNextType = String(nextType || '').toLowerCase();
  const buttons = getRankingsEventTypeButtons();
  const fallbackType =
    buttons.find(button => String(button.dataset.type || '').toLowerCase() === DEFAULT_EVENT_TYPE)?.dataset.type?.toLowerCase()
    || buttons[0]?.dataset.type?.toLowerCase()
    || '';
  const resolvedType = buttons.some(button => String(button.dataset.type || '').toLowerCase() === normalizedNextType)
    ? normalizedNextType
    : fallbackType;

  buttons.forEach(button => {
    button.classList.toggle('active', String(button.dataset.type || '').toLowerCase() === resolvedType);
  });
}

function getRankingsPeriodRoot() {
  return document.getElementById('rankingsPeriodButtons');
}

function getAvailableRankingsPeriods() {
  return getRankingsPeriodDefinitions(getRankingsAvailableDates(getSelectedRankingsEventTypes()));
}

function getActiveRankingsPeriodDefinition() {
  return getAvailableRankingsPeriods().find(period => period.id === activeRankingsPeriodId) || null;
}

function ensureActiveRankingsPeriod() {
  const periodDefinitions = getAvailableRankingsPeriods();
  if (periodDefinitions.length === 0) {
    activeRankingsPeriodId = '';
    return null;
  }

  if (!periodDefinitions.some(period => period.id === activeRankingsPeriodId)) {
    activeRankingsPeriodId = getDefaultRankingsPeriodId(
      getRankingsAvailableDates(getSelectedRankingsEventTypes())
    );
  }

  return periodDefinitions.find(period => period.id === activeRankingsPeriodId) || periodDefinitions[0];
}

function renderRankingsPeriodButtons() {
  const periodRoot = getRankingsPeriodRoot();
  if (!periodRoot) {
    return null;
  }

  const periodDefinitions = getAvailableRankingsPeriods();
  const activePeriod = ensureActiveRankingsPeriod();
  periodRoot.innerHTML = '';

  if (periodDefinitions.length === 0) {
    periodRoot.innerHTML = '<div class="quick-view-empty">No matchup periods available.</div>';
    return null;
  }

  const buttonRow = document.createElement('div');
  buttonRow.className = 'bubble-menu quick-view-static-list';

  periodDefinitions.forEach(period => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `bubble-button rankings-period-button${period.id === activePeriod?.id ? ' active' : ''}`;
    button.dataset.rankingsPeriod = period.id;
    button.textContent = period.label;
    buttonRow.appendChild(button);
  });

  periodRoot.appendChild(buttonRow);
  return activePeriod;
}

function formatRating(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.round(numericValue).toString() : '--';
}

function formatWinRate(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? `${(numericValue * 100).toFixed(1)}%` : '0.0%';
}

function formatWindowRange(startDate = '', endDate = '') {
  if (!startDate || !endDate) {
    return 'Choose a period';
  }

  if (startDate === endDate) {
    return formatDate(startDate);
  }

  return `${formatDate(startDate)} to ${formatDate(endDate)}`;
}

function getWindowLabel(period, selectedYears = [], startDate = '', endDate = '') {
  if (period?.label) {
    return period.label;
  }

  if (selectedYears.length === 1) {
    return `${selectedYears[0]} Season`;
  }

  if (selectedYears.length > 1) {
    return `${selectedYears[0]}-${selectedYears[selectedYears.length - 1]} Seasons`;
  }

  if (startDate && endDate) {
    return 'Selected Window';
  }

  return 'Season Window';
}

function buildEmptyStateMessage(selectedEventTypes = []) {
  if (selectedEventTypes.length === 1 && selectedEventTypes[0] === 'offline') {
    return 'No offline matchup records are available yet, so Elo rankings can only be computed for online events right now.';
  }

  return 'No rated matchup records are available for the selected filters.';
}

function buildSummaryText(dataset) {
  const { summary, startDate, endDate, resetByYear, filteredMatches, period } = dataset;

  if (summary.ratedMatches === 0) {
    return buildEmptyStateMessage(dataset.eventTypes);
  }

  const latestMatch = summary.latestProcessedMatch;
  const latestMatchLabel = latestMatch
    ? `${formatEventName(latestMatch.event) || latestMatch.event || 'Unknown Event'} on ${formatDate(latestMatch.date)}`
    : '';
  const seasonNote = summary.selectedYears.length > 1
    ? ' Players can appear more than once because each season is ranked separately.'
    : '';
  const resetNote = resetByYear
    ? ' Ratings reset to 1500 when the calendar year changes.'
    : ' Ratings carry across the full selected window.';
  const skipNote = summary.skippedMatches > 0
    ? ` ${summary.skippedMatches} selected pairings were skipped because they were byes or had unknown results.`
    : '';
  const periodLabel = period?.label || 'the selected period';

  return `${summary.ratedMatches} rated matches across ${filteredMatches.length} selected pairings for ${periodLabel} (${formatWindowRange(startDate, endDate)}).${seasonNote}${resetNote}${skipNote}${latestMatchLabel ? ` Latest rated match: ${latestMatchLabel}.` : ''}`;
}

function populateRankingStats(dataset) {
  const { summary, startDate, endDate, period } = dataset;
  const leader = summary.leader;
  const mostActiveSeason = summary.mostActiveSeason;

  updateElementText('rankingsWindowValue', getWindowLabel(period, summary.selectedYears, startDate, endDate));
  updateElementText('rankingsWindowDetails', formatWindowRange(startDate, endDate));
  updateElementText('rankingsRatedMatches', String(summary.ratedMatches || 0));
  updateElementText(
    'rankingsRatedMatchesDetails',
    summary.selectedMatches > 0
      ? `${summary.selectedMatches} selected pairings`
      : 'No selected pairings'
  );
  updateElementText('rankingsTrackedPlayers', String(summary.uniquePlayers || 0));
  updateElementText(
    'rankingsTrackedPlayersDetails',
    `${summary.seasonEntries || 0} season entr${summary.seasonEntries === 1 ? 'y' : 'ies'}`
  );
  updateElementText('rankingsLeaderName', leader?.displayName || '--');
  updateElementText(
    'rankingsLeaderDetails',
    leader
      ? `${formatRating(leader.rating)} Elo / ${leader.matches} matches / ${leader.seasonYear}`
      : 'No leader yet'
  );
  updateElementText('rankingsMostActiveName', mostActiveSeason?.displayName || '--');
  updateElementText(
    'rankingsMostActiveDetails',
    mostActiveSeason
      ? `${mostActiveSeason.matches} matches / ${formatWinRate(mostActiveSeason.winRate)} WR / ${mostActiveSeason.seasonYear}`
      : 'No active player yet'
  );
  updateElementText('rankingsSummary', buildSummaryText(dataset));

  RANKINGS_STAT_CARD_IDS.forEach(triggerUpdateAnimation);
}

function compareRows(a, b, key) {
  const resolvedKey = key === 'displayRank' ? 'rating' : key;

  if (resolvedKey === 'displayName') {
    return (
      String(a.displayName).localeCompare(String(b.displayName), undefined, { sensitivity: 'base' }) ||
      String(a.playerKey).localeCompare(String(b.playerKey))
    );
  }

  if (resolvedKey === 'seasonYear' || resolvedKey === 'lastActiveDate') {
    return String(a[resolvedKey] || '').localeCompare(String(b[resolvedKey] || ''));
  }

  return Number(a[resolvedKey] || 0) - Number(b[resolvedKey] || 0);
}

function sortRankingRows(rows = []) {
  const sortedRows = [...rows];
  const { key, direction } = rankingsTableSort;
  const multiplier = direction === 'asc' ? 1 : -1;

  sortedRows.sort((a, b) => {
    const comparison = compareRows(a, b, key);
    if (comparison !== 0) {
      return comparison * multiplier;
    }

    return (
      Number(b.rating) - Number(a.rating) ||
      Number(b.matches) - Number(a.matches) ||
      String(a.displayName).localeCompare(String(b.displayName), undefined, { sensitivity: 'base' }) ||
      String(a.playerKey).localeCompare(String(b.playerKey))
    );
  });

  return sortedRows;
}

function renderRankingsTable(dataset) {
  const sortedRows = sortRankingRows(currentRankingRows);
  const rowsWithRank = sortedRows.map((row, index) => ({
    ...row,
    displayRank: index + 1
  }));
  const seasonCount = dataset.summary.selectedYears.length;

  updateElementText(
    'rankingsTableTitle',
    seasonCount > 1 ? 'Seasonal Elo Rankings' : 'Player Elo Rankings'
  );
  updateElementText(
    'rankingsTableHelper',
    dataset.summary.ratedMatches > 0
      ? 'Rows are ranked by Elo. Seasons reset to 1500 on January 1, so multi-year windows keep each player-season as a separate entry.'
      : buildEmptyStateMessage(dataset.eventTypes)
  );

  updateElementHTML(
    'rankingsTableBody',
    rowsWithRank.length === 0
      ? "<tr><td colspan='9'>No Elo rankings are available for the selected filters.</td></tr>"
      : rowsWithRank.map(row => `
        <tr>
          <td class="leaderboard-rank-cell">${row.displayRank}</td>
          <td>${escapeHtml(row.displayName)}</td>
          <td>${escapeHtml(row.seasonYear || 'All-time')}</td>
          <td>${formatRating(row.rating)}</td>
          <td>${row.matches}</td>
          <td>${row.wins}</td>
          <td>${row.losses}</td>
          <td>${formatWinRate(row.winRate)}</td>
          <td>${row.lastActiveDate ? escapeHtml(formatDate(row.lastActiveDate)) : '--'}</td>
        </tr>
      `).join('')
  );
}

function syncRankingsSortIndicators() {
  const tableHead = document.getElementById('rankingsTableHead');
  tableHead?.querySelectorAll('th[data-sort]').forEach(header => {
    const isActive = header.dataset.sort === rankingsTableSort.key;
    header.classList.toggle('asc', isActive && rankingsTableSort.direction === 'asc');
    header.classList.toggle('desc', isActive && rankingsTableSort.direction === 'desc');

    const arrow = header.querySelector('.sort-arrow');
    if (arrow) {
      arrow.textContent = isActive ? (rankingsTableSort.direction === 'asc' ? '^' : 'v') : '';
    }
  });
}

function handleRankingsTableSort(sortKey) {
  if (rankingsTableSort.key === sortKey) {
    rankingsTableSort.direction = rankingsTableSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    rankingsTableSort.key = sortKey;
    rankingsTableSort.direction = sortKey === 'displayName' ? 'asc' : 'desc';

    if (sortKey === 'seasonYear' || sortKey === 'lastActiveDate') {
      rankingsTableSort.direction = 'desc';
    }
  }

  syncRankingsSortIndicators();
  renderRankingsTable(currentRankingsDataset);
}

function setupRankingsTableSorting() {
  const tableHead = document.getElementById('rankingsTableHead');
  if (!tableHead || tableHead.dataset.listenerAdded === 'true') {
    return;
  }

  tableHead.addEventListener('click', event => {
    const header = event.target.closest('th[data-sort]');
    if (!header) {
      return;
    }

    handleRankingsTableSort(header.dataset.sort);
  });

  tableHead.dataset.listenerAdded = 'true';
}

function setupRankingsFilterListeners() {
  const eventTypeButtons = getRankingsEventTypeButtons();
  const periodRoot = getRankingsPeriodRoot();

  eventTypeButtons.forEach(button => {
    if (button.dataset.listenerAdded === 'true') {
      return;
    }

    button.addEventListener('click', () => {
      setRankingsEventType(button.dataset.type);
      activeRankingsPeriodId = '';
      renderRankingsPeriodButtons();

      if (getTopMode() === 'rankings') {
        updateRankingsAnalytics();
      }
    });

    button.dataset.listenerAdded = 'true';
  });

  if (periodRoot && periodRoot.dataset.listenerAdded !== 'true') {
    periodRoot.addEventListener('click', event => {
      const periodButton = event.target.closest('.rankings-period-button');
      if (!periodButton) {
        return;
      }

      activeRankingsPeriodId = periodButton.dataset.rankingsPeriod || '';
      renderRankingsPeriodButtons();

      if (getTopMode() === 'rankings') {
        updateRankingsAnalytics();
      }
    });

    periodRoot.dataset.listenerAdded = 'true';
  }
}

export function initRankings() {
  setRankingsEventType(DEFAULT_EVENT_TYPE);
  updateElementText(
    'rankingsSystemSummary',
    `Starting rating ${DEFAULT_RANKINGS_OPTIONS.startingRating}, K-factor ${DEFAULT_RANKINGS_OPTIONS.kFactor}, yearly reset on January 1.`
  );
  renderRankingsPeriodButtons();
  setupRankingsTableSorting();
  setupRankingsFilterListeners();
}

export function updateRankingsAnalytics() {
  const activePeriod = renderRankingsPeriodButtons();
  const dataset = buildRankingsDataset({
    eventTypes: getSelectedRankingsEventTypes(),
    startDate: activePeriod?.startDate || '',
    endDate: activePeriod?.endDate || ''
  });

  currentRankingsDataset = {
    ...dataset,
    period: activePeriod
  };
  currentRankingRows = dataset.seasonRows;
  populateRankingStats(currentRankingsDataset);
  renderRankingsTable(currentRankingsDataset);
  syncRankingsSortIndicators();
}
