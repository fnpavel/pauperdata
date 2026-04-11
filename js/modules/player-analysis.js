import { getAnalysisRows } from '../utils/analysis-data.js';
import { updatePlayerWinRateChart } from '../charts/player-win-rate.js';
import { updatePlayerDeckPerformanceChart } from '../charts/player-deck-performance.js';
import { triggerUpdateAnimation, updateElementHTML } from '../utils/dom.js';
import { calculatePlayerStats } from '../utils/data-cards.js';
import { calculatePlayerEventTable, calculatePlayerDeckTable } from '../utils/data-tables.js';
import { formatDate, formatEventName } from '../utils/format.js';
import { getEventGroupInfo } from '../utils/event-groups.js';
import { getSelectedPlayerLabel, rowMatchesPlayerKey } from '../utils/player-names.js';
import { getPlayerAnalysisActivePreset, getPlayerPresetRows } from '../utils/player-analysis-presets.js';
import { setSingleEventType, setSelectedSingleEvent, updateEventFilter } from './filters/filter-index.js';

function getSelectedPlayerEventTypes() {
  const playerAnalysisSection = document.getElementById('playerAnalysisSection');
  return Array.from(playerAnalysisSection?.querySelectorAll('.event-type-filter.active') || []).map(button =>
    button.dataset.type.toLowerCase()
  );
}

function getActivePlayerEventGroupFilter() {
  const selectionPanels = document.getElementById('playerSelectionPanels');
  const activeGroupKeys = String(selectionPanels?.dataset.activeGroupKeys || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  return {
    initialized: selectionPanels?.dataset.groupFilterInitialized === 'true',
    activeGroupKeys: new Set(activeGroupKeys)
  };
}

function applyPlayerEventGroupFilter(rows = []) {
  const { initialized, activeGroupKeys } = getActivePlayerEventGroupFilter();
  if (!initialized) {
    return rows;
  }

  if (activeGroupKeys.size === 0) {
    return [];
  }

  return rows.filter(row => activeGroupKeys.has(getEventGroupInfo(row.Event).key));
}

const playerSidebarCardIds = [
  'playerWinRateStatsCard',
  'playerMostPlayedDeckCard',
  'playerLeastPlayedDeckCard',
  'playerBestDeckCard',
  'playerWorstDeckCard'
];

const PLAYER_RANK_DRILLDOWN_CONFIG = {
  top1: {
    cardId: 'playerTop1Card',
    title: 'Top 1 Finishes',
    emptyMessage: 'No Top 1 finishes in the current Player Analysis filters.',
    predicate: row => Number(row.Rank) === 1,
    includeTop8: true
  },
  top1_8: {
    cardId: 'playerTop1_8Card',
    title: 'Top 2-8 Finishes',
    emptyMessage: 'No Top 2-8 finishes in the current Player Analysis filters.',
    predicate: row => {
      const rank = Number(row.Rank);
      return rank >= 2 && rank <= 8;
    },
    includeTop8: true
  },
  top9_16: {
    cardId: 'playerTop9_16Card',
    title: 'Top 9-16 Finishes',
    emptyMessage: 'No Top 9-16 finishes in the current Player Analysis filters.',
    predicate: row => {
      const rank = Number(row.Rank);
      return rank >= 9 && rank <= 16;
    },
    includeTop8: false
  },
  top17_32: {
    cardId: 'playerTop17_32Card',
    title: 'Top 17-32 Finishes',
    emptyMessage: 'No Top 17-32 finishes in the current Player Analysis filters.',
    predicate: row => {
      const rank = Number(row.Rank);
      return rank >= 17 && rank <= 32;
    },
    includeTop8: false
  },
  top33Plus: {
    cardId: 'playerTop33PlusCard',
    title: 'Top 33+ Finishes',
    emptyMessage: 'No Top 33+ finishes in the current Player Analysis filters.',
    predicate: row => Number(row.Rank) > 32,
    includeTop8: false
  }
};

const PLAYER_SUMMARY_DRILLDOWN_CONFIG = {
  totalEvents: {
    cardId: 'playerEventsCard',
    title: 'Event History',
    emptyMessage: 'No events in the current Player Analysis filters.'
  },
  uniqueDecks: {
    cardId: 'playerUniqueDecksCard',
    title: 'Unique Decks Used',
    emptyMessage: 'No deck data in the current Player Analysis filters.'
  },
  mostPlayedDecks: {
    cardId: 'playerMostPlayedCard',
    title: 'Most Played Decks',
    emptyMessage: 'No deck data in the current Player Analysis filters.'
  },
  leastPlayedDecks: {
    cardId: 'playerLeastPlayedCard',
    title: 'Least Played Decks',
    emptyMessage: 'No deck data in the current Player Analysis filters.'
  }
};

const PLAYER_SIDEBAR_DRILLDOWN_CONFIG = {
  overallWinRate: {
    cardId: 'playerWinRateStatsCard',
    fallbackTitle: 'Overall Win Rate',
    emptyMessage: 'No deck data in the current Player Analysis filters.'
  },
  mostPlayedDeckStats: {
    cardId: 'playerMostPlayedDeckCard',
    fallbackTitle: 'Most Played Deck',
    emptyMessage: 'No deck data in the current Player Analysis filters.'
  },
  leastPlayedDeckStats: {
    cardId: 'playerLeastPlayedDeckCard',
    fallbackTitle: 'Least Played Deck',
    emptyMessage: 'No deck data in the current Player Analysis filters.'
  },
  bestDeckStats: {
    cardId: 'playerBestDeckCard',
    fallbackTitle: 'Best Performing Deck',
    emptyMessage: 'No deck data in the current Player Analysis filters.'
  },
  worstDeckStats: {
    cardId: 'playerWorstDeckCard',
    fallbackTitle: 'Worst Performing Deck',
    emptyMessage: 'No deck data in the current Player Analysis filters.'
  }
};

let currentPlayerAnalysisRows = [];
let activePlayerDrilldownCategory = '';

function createPlayerSearchEmptyState(message) {
  const emptyState = document.createElement('div');
  emptyState.className = 'player-search-empty';
  emptyState.textContent = message;
  return emptyState;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getPlayerRankDrilldownElements() {
  return {
    overlay: document.getElementById('playerRankDrilldownOverlay'),
    title: document.getElementById('playerRankDrilldownTitle'),
    subtitle: document.getElementById('playerRankDrilldownSubtitle'),
    content: document.getElementById('playerRankDrilldownContent'),
    closeButton: document.getElementById('playerRankDrilldownClose')
  };
}

function getPlayerRankDrilldownMatches(categoryKey, data = currentPlayerAnalysisRows) {
  const config = PLAYER_RANK_DRILLDOWN_CONFIG[categoryKey];
  if (!config) {
    return [];
  }

  return (data || [])
    .filter(config.predicate)
    .sort((a, b) => {
      const dateComparison = String(b.Date || '').localeCompare(String(a.Date || ''));
      if (dateComparison !== 0) {
        return dateComparison;
      }

      const rankComparison = Number(a.Rank) - Number(b.Rank);
      if (rankComparison !== 0) {
        return rankComparison;
      }

      return String(a.Event || '').localeCompare(String(b.Event || ''));
    });
}

function getRowWinRateText(row) {
  const wins = Number(row?.Wins) || 0;
  const losses = Number(row?.Losses) || 0;
  const totalMatches = wins + losses;

  if (totalMatches === 0) {
    return '--';
  }

  return `${((wins / totalMatches) * 100).toFixed(1)}%`;
}

function getRowWinRateValue(row) {
  const wins = Number(row?.Wins) || 0;
  const losses = Number(row?.Losses) || 0;
  const totalMatches = wins + losses;

  if (totalMatches === 0) {
    return 0;
  }

  return (wins / totalMatches) * 100;
}

function formatAverageRankText(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return `#${value.toFixed(1)}`;
}

function formatWinRatePercentage(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return `${value.toFixed(1)}%`;
}

function highlightDrilldownText(text, tone = 'reference') {
  return `<span class="player-rank-drilldown-emphasis player-rank-drilldown-emphasis-${tone}">${escapeHtml(text)}</span>`;
}

function highlightDrilldownLabel(text, tone = 'reference') {
  const normalizedText = String(text ?? '');
  if (/^Your\b/i.test(normalizedText)) {
    const suffix = normalizedText.replace(/^Your\b\s*/i, '');
    return `
      <span class="player-rank-drilldown-emphasis player-rank-drilldown-emphasis-${tone}">
        <strong>Your</strong>${suffix ? ` ${escapeHtml(suffix)}` : ''}
      </span>
    `;
  }

  return highlightDrilldownText(normalizedText, tone);
}

function describeWinRateComparison(subjectLabel, subjectValue, referenceLabel, referenceValue) {
  if (!Number.isFinite(subjectValue) || !Number.isFinite(referenceValue)) {
    return '';
  }

  const difference = subjectValue - referenceValue;
  if (Math.abs(difference) < 0.05) {
    return `${highlightDrilldownLabel(subjectLabel)} matches ${highlightDrilldownLabel(referenceLabel)}`;
  }

  const direction = difference > 0 ? 'above' : 'below';
  const directionTone = difference > 0 ? 'positive' : 'negative';
  return `${highlightDrilldownLabel(subjectLabel)} is ${highlightDrilldownText(`${Math.abs(difference).toFixed(1)} pp`, 'number')} ${highlightDrilldownText(direction, directionTone)} ${highlightDrilldownLabel(referenceLabel)}`;
}

function describeFinishComparison(subjectLabel, subjectRank, referenceLabel, referenceRank) {
  if (!Number.isFinite(subjectRank) || !Number.isFinite(referenceRank)) {
    return '';
  }

  const difference = referenceRank - subjectRank;
  if (Math.abs(difference) < 0.05) {
    return `${highlightDrilldownLabel(subjectLabel)} matches ${highlightDrilldownLabel(referenceLabel)}`;
  }

  const direction = difference > 0 ? 'better' : 'worse';
  const directionTone = difference > 0 ? 'positive' : 'negative';
  return `${highlightDrilldownLabel(subjectLabel)} is ${highlightDrilldownText(`${Math.abs(difference).toFixed(1)} places`, 'number')} ${highlightDrilldownText(direction, directionTone)} than ${highlightDrilldownLabel(referenceLabel)}`;
}

function buildTooltipText(parts) {
  return parts.filter(Boolean);
}

function hasDrilldownTooltipContent(tooltipText = []) {
  return Array.isArray(tooltipText) ? tooltipText.length > 0 : Boolean(tooltipText);
}

function buildDrilldownTooltipClasses(baseClasses, tooltipText = []) {
  return hasDrilldownTooltipContent(tooltipText) ? `${baseClasses} drilldown-tooltip` : baseClasses;
}

function buildDrilldownHoverNote(tooltipText = [], extraClasses = '', headerText = '') {
  const tooltipItems = Array.isArray(tooltipText)
    ? tooltipText.filter(Boolean)
    : [String(tooltipText)].filter(Boolean);

  if (tooltipItems.length === 0) {
    return '';
  }

  const noteClasses = ['player-rank-drilldown-hover-note', extraClasses]
    .filter(Boolean)
    .join(' ');

  return `
    <span class="${noteClasses}">
      ${headerText ? `<span class="player-rank-drilldown-hover-note-header">${escapeHtml(headerText)}</span>` : ''}
      <ul class="player-rank-drilldown-hover-note-list">
        ${tooltipItems.map(item => `<li>${item}</li>`).join('')}
      </ul>
    </span>
  `;
}

function buildEventRowsByName(eventNames) {
  const eventNameSet = new Set(eventNames);
  const eventRowsByName = new Map();

  getAnalysisRows().forEach(row => {
    if (!eventNameSet.has(row.Event)) {
      return;
    }

    if (!eventRowsByName.has(row.Event)) {
      eventRowsByName.set(row.Event, []);
    }

    eventRowsByName.get(row.Event).push(row);
  });

  eventRowsByName.forEach(rows => {
    rows.sort((a, b) => {
      const rankComparison = Number(a.Rank) - Number(b.Rank);
      if (rankComparison !== 0) {
        return rankComparison;
      }

      return String(a.Player || '').localeCompare(String(b.Player || ''));
    });
  });

  return eventRowsByName;
}

function sortPlayerAnalysisRows(rows = []) {
  return [...rows].sort((a, b) => {
    const dateComparison = String(b.Date || '').localeCompare(String(a.Date || ''));
    if (dateComparison !== 0) {
      return dateComparison;
    }

    const rankComparison = Number(a.Rank) - Number(b.Rank);
    if (rankComparison !== 0) {
      return rankComparison;
    }

    return String(a.Event || '').localeCompare(String(b.Event || ''));
  });
}

function getPlayerDeckRows(data = currentPlayerAnalysisRows) {
  return (data || []).filter(row => {
    const deckName = String(row?.Deck || '').trim();
    return deckName && deckName !== 'No Show';
  });
}

function getBestFinishRow(rows) {
  if (!rows || rows.length === 0) {
    return null;
  }

  return rows.reduce((bestRow, row) => {
    const rowRank = Number(row.Rank) || Number.POSITIVE_INFINITY;
    const bestRank = Number(bestRow.Rank) || Number.POSITIVE_INFINITY;

    if (rowRank !== bestRank) {
      return rowRank < bestRank ? row : bestRow;
    }

    const rowWinRate = getRowWinRateValue(row);
    const bestWinRate = getRowWinRateValue(bestRow);
    if (rowWinRate !== bestWinRate) {
      return rowWinRate > bestWinRate ? row : bestRow;
    }

    return String(row.Event || '').localeCompare(String(bestRow.Event || '')) < 0 ? row : bestRow;
  }, rows[0]);
}

function getWorstFinishRow(rows) {
  if (!rows || rows.length === 0) {
    return null;
  }

  return rows.reduce((worstRow, row) => {
    const rowRank = Number(row.Rank) || Number.NEGATIVE_INFINITY;
    const worstRank = Number(worstRow.Rank) || Number.NEGATIVE_INFINITY;

    if (rowRank !== worstRank) {
      return rowRank > worstRank ? row : worstRow;
    }

    const rowWinRate = getRowWinRateValue(row);
    const worstWinRate = getRowWinRateValue(worstRow);
    if (rowWinRate !== worstWinRate) {
      return rowWinRate < worstWinRate ? row : worstRow;
    }

    return String(row.Event || '').localeCompare(String(worstRow.Event || '')) < 0 ? row : worstRow;
  }, rows[0]);
}

function buildPlayerDeckGroups(data = currentPlayerAnalysisRows) {
  const deckGroups = new Map();

  getPlayerDeckRows(data).forEach(row => {
    const deckName = String(row.Deck || '').trim();
    if (!deckGroups.has(deckName)) {
      deckGroups.set(deckName, []);
    }

    deckGroups.get(deckName).push(row);
  });

  return Array.from(deckGroups.entries())
    .map(([deck, rows]) => {
      const sortedRows = sortPlayerAnalysisRows(rows);
      const wins = sortedRows.reduce((sum, row) => sum + (Number(row.Wins) || 0), 0);
      const losses = sortedRows.reduce((sum, row) => sum + (Number(row.Losses) || 0), 0);
      const eventCount = new Set(sortedRows.map(row => `${row.Date || ''}::${row.Event || ''}`)).size;
      const averageFinish = sortedRows.reduce((sum, row) => sum + (Number(row.Rank) || 0), 0) / sortedRows.length;

      return {
        deck,
        rows: sortedRows,
        eventCount,
        wins,
        losses,
        overallWinRate: getRowWinRateValue({ Wins: wins, Losses: losses }),
        averageFinish,
        bestFinishRow: getBestFinishRow(sortedRows),
        worstFinishRow: getWorstFinishRow(sortedRows)
      };
    })
    .sort((a, b) => {
      if (b.eventCount !== a.eventCount) {
        return b.eventCount - a.eventCount;
      }

      if (b.overallWinRate !== a.overallWinRate) {
        return b.overallWinRate - a.overallWinRate;
      }

      return a.deck.localeCompare(b.deck);
    });
}

function sortDeckGroupsByOverallWinRate(groups = []) {
  return [...groups].sort((a, b) => {
    if (b.overallWinRate !== a.overallWinRate) {
      return b.overallWinRate - a.overallWinRate;
    }

    if (b.eventCount !== a.eventCount) {
      return b.eventCount - a.eventCount;
    }

    if (a.averageFinish !== b.averageFinish) {
      return a.averageFinish - b.averageFinish;
    }

    return a.deck.localeCompare(b.deck);
  });
}

function getPlayerSummaryDrilldownItems(categoryKey, data = currentPlayerAnalysisRows) {
  switch (categoryKey) {
    case 'totalEvents':
      return sortPlayerAnalysisRows(data);
    case 'uniqueDecks':
      return buildPlayerDeckGroups(data);
    case 'mostPlayedDecks': {
      const deckGroups = buildPlayerDeckGroups(data);
      const maxEventCount = deckGroups.length > 0 ? Math.max(...deckGroups.map(group => group.eventCount)) : 0;
      return deckGroups.filter(group => group.eventCount === maxEventCount);
    }
    case 'leastPlayedDecks': {
      const deckGroups = buildPlayerDeckGroups(data);
      const minEventCount = deckGroups.length > 0 ? Math.min(...deckGroups.map(group => group.eventCount)) : 0;
      return deckGroups.filter(group => group.eventCount === minEventCount);
    }
    default:
      return [];
  }
}

function getPlayerSidebarDrilldownItems(categoryKey, data = currentPlayerAnalysisRows) {
  const deckGroups = buildPlayerDeckGroups(data);

  switch (categoryKey) {
    case 'overallWinRate':
      return sortDeckGroupsByOverallWinRate(deckGroups);
    case 'mostPlayedDeckStats': {
      const maxEventCount = deckGroups.length > 0 ? Math.max(...deckGroups.map(group => group.eventCount)) : 0;
      return deckGroups.filter(group => group.eventCount === maxEventCount);
    }
    case 'leastPlayedDeckStats': {
      const minEventCount = deckGroups.length > 0 ? Math.min(...deckGroups.map(group => group.eventCount)) : 0;
      return deckGroups.filter(group => group.eventCount === minEventCount);
    }
    case 'bestDeckStats': {
      const bestWinRate = deckGroups.length > 0 ? Math.max(...deckGroups.map(group => group.overallWinRate)) : Number.NEGATIVE_INFINITY;
      return deckGroups.filter(group => group.overallWinRate === bestWinRate);
    }
    case 'worstDeckStats': {
      const worstWinRate = deckGroups.length > 0 ? Math.min(...deckGroups.map(group => group.overallWinRate)) : Number.POSITIVE_INFINITY;
      return deckGroups.filter(group => group.overallWinRate === worstWinRate);
    }
    default:
      return [];
  }
}

function getMostCommonDeckStats(rows = []) {
  const deckCounts = rows.reduce((acc, row) => {
    const deckName = String(row?.Deck || '').trim();
    if (!deckName || deckName === 'No Show') {
      return acc;
    }

    acc[deckName] = (acc[deckName] || 0) + 1;
    return acc;
  }, {});

  const deckEntries = Object.entries(deckCounts);
  if (deckEntries.length === 0) {
    return null;
  }

  const maxCount = Math.max(...deckEntries.map(([, count]) => count));
  const deckNames = deckEntries
    .filter(([, count]) => count === maxCount)
    .map(([deckName]) => deckName)
    .sort((a, b) => a.localeCompare(b));

  return {
    deckLabel: deckNames.join(', '),
    count: maxCount
  };
}

function buildPlayerRankCardHoverItems(categoryKey, data = currentPlayerAnalysisRows) {
  const rows = getPlayerRankDrilldownMatches(categoryKey, data);
  if (rows.length === 0) {
    return [];
  }

  const averageRank = rows.reduce((sum, row) => sum + (Number(row.Rank) || 0), 0) / rows.length;
  const averageWinRate = rows.reduce((sum, row) => sum + getRowWinRateValue(row), 0) / rows.length;
  const mostCommonDeck = getMostCommonDeckStats(rows);

  const items = [
    `${highlightDrilldownText('Average finish')} ${highlightDrilldownText(formatAverageRankText(averageRank), 'number')}`,
    `${highlightDrilldownText('Average WR')} ${highlightDrilldownText(formatWinRatePercentage(averageWinRate), 'number')}`
  ];

  if (mostCommonDeck) {
    items.push(
      `${highlightDrilldownText('Most played deck')} ${highlightDrilldownText(mostCommonDeck.deckLabel)} ${highlightDrilldownText(`(${mostCommonDeck.count}x)`, 'number')}`
    );
  }

  return items;
}

function updatePlayerRankCardHoverNotes(data = currentPlayerAnalysisRows) {
  Object.entries(PLAYER_RANK_DRILLDOWN_CONFIG).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card) {
      return;
    }

    const hoverItems = buildPlayerRankCardHoverItems(categoryKey, data);
    const existingNote = card.querySelector('.player-stat-card-hover-note');

    if (hoverItems.length === 0) {
      card.classList.remove('drilldown-tooltip');
      existingNote?.remove();
      return;
    }

    card.classList.add('drilldown-tooltip');
    const hoverNoteMarkup = buildDrilldownHoverNote(hoverItems, 'player-stat-card-hover-note');

    if (existingNote) {
      existingNote.outerHTML = hoverNoteMarkup;
    } else {
      card.insertAdjacentHTML('beforeend', hoverNoteMarkup);
    }
  });
}

function getBestDeckPilotRow(rows) {
  if (!rows || rows.length === 0) {
    return null;
  }

  return rows.reduce((bestRow, row) => {
    const rowRank = Number(row.Rank) || Number.POSITIVE_INFINITY;
    const bestRank = Number(bestRow.Rank) || Number.POSITIVE_INFINITY;

    if (rowRank !== bestRank) {
      return rowRank < bestRank ? row : bestRow;
    }

    const rowWinRate = getRowWinRateValue(row);
    const bestWinRate = getRowWinRateValue(bestRow);
    if (rowWinRate !== bestWinRate) {
      return rowWinRate > bestWinRate ? row : bestRow;
    }

    const rowWins = Number(row.Wins) || 0;
    const bestWins = Number(bestRow.Wins) || 0;
    if (rowWins !== bestWins) {
      return rowWins > bestWins ? row : bestRow;
    }

    return String(row.Player || '').localeCompare(String(bestRow.Player || '')) < 0 ? row : bestRow;
  }, rows[0]);
}

function getSameDeckEventComparisonData(eventRows, playerRow, selectedPlayerKey = '') {
  const playerDeck = String(playerRow?.Deck || '').trim();
  if (!playerDeck || !eventRows || eventRows.length === 0) {
    return null;
  }

  const sameDeckRows = eventRows.filter(row => String(row.Deck || '').trim() === playerDeck);
  if (sameDeckRows.length === 0) {
    return null;
  }

  const averageRank = sameDeckRows.reduce((sum, row) => sum + (Number(row.Rank) || 0), 0) / sameDeckRows.length;
  const averageDeckWinRate = sameDeckRows.reduce((sum, row) => sum + getRowWinRateValue(row), 0) / sameDeckRows.length;
  const bestDeckPilot = getBestDeckPilotRow(sameDeckRows);

  return {
    sameDeckRows,
    averageRank,
    averageDeckWinRate,
    bestDeckPilot,
    bestDeckPilotIsSelectedPlayer: bestDeckPilot && selectedPlayerKey
      ? rowMatchesPlayerKey(bestDeckPilot, selectedPlayerKey)
      : false,
    playerRank: Number(playerRow?.Rank) || Number.NaN,
    playerWinRateValue: getRowWinRateValue(playerRow),
    bestDeckPilotRank: Number(bestDeckPilot?.Rank) || Number.NaN,
    bestDeckPilotWinRate: getRowWinRateValue(bestDeckPilot)
  };
}

function isOnlyCopyDeckEventComparison(comparisonData) {
  return Array.isArray(comparisonData?.sameDeckRows) && comparisonData.sameDeckRows.length === 1;
}

function buildSameDeckEventComparisonNote(comparisonData) {
  if (!comparisonData) {
    return '';
  }

  if (isOnlyCopyDeckEventComparison(comparisonData)) {
    return buildTooltipText([
      'Only copy of this deck in this event.'
    ]);
  }

  return buildTooltipText([
    describeFinishComparison('Your Finish', comparisonData.playerRank, 'deck average finish', comparisonData.averageRank),
    describeFinishComparison('Your Finish', comparisonData.playerRank, 'best same-deck finish', comparisonData.bestDeckPilotRank),
    describeWinRateComparison('Your WR', comparisonData.playerWinRateValue, 'deck average WR', comparisonData.averageDeckWinRate),
    describeWinRateComparison('Your WR', comparisonData.playerWinRateValue, 'best same-deck WR', comparisonData.bestDeckPilotWinRate)
  ]);
}

function getMetricComparisonDirection(subjectValue, referenceValue, { lowerIsBetter = false, tolerance = 0.1 } = {}) {
  if (!Number.isFinite(subjectValue) || !Number.isFinite(referenceValue)) {
    return 'even';
  }

  const difference = subjectValue - referenceValue;
  if (Math.abs(difference) <= tolerance) {
    return 'even';
  }

  if (lowerIsBetter) {
    return difference < 0 ? 'better' : 'worse';
  }

  return difference > 0 ? 'better' : 'worse';
}

function getPlayerDeckEventComparisonTone(comparisonData) {
  if (!comparisonData) {
    return 'mixed-average';
  }

  const rankDirection = getMetricComparisonDirection(comparisonData.playerRank, comparisonData.averageRank, {
    lowerIsBetter: true,
    tolerance: 0.1
  });
  const winRateDirection = getMetricComparisonDirection(comparisonData.playerWinRateValue, comparisonData.averageDeckWinRate, {
    tolerance: 0.1
  });

  const betterCount = [rankDirection, winRateDirection].filter(direction => direction === 'better').length;
  const worseCount = [rankDirection, winRateDirection].filter(direction => direction === 'worse').length;

  if (betterCount > 0 && worseCount === 0) {
    return 'above-average';
  }

  if (worseCount > 0 && betterCount === 0) {
    return 'below-average';
  }

  return 'mixed-average';
}

function getPlayerDeckEventComparisonToneLabel(comparisonTone, comparisonData) {
  if (isOnlyCopyDeckEventComparison(comparisonData)) {
    return 'Only Copy';
  }

  switch (comparisonTone) {
    case 'above-average':
      return 'Above Avg';
    case 'below-average':
      return 'Below Avg';
    default:
      return 'Mixed';
  }
}

function buildPlayerDeckEventLegendHtml() {
  return `
    <div class="player-drilldown-event-legend">
      <div class="player-drilldown-event-legend-note">
        Colors compare each result against the same deck's average finish and win rate in that event. Single-pilot deck entries are labeled Only Copy.
      </div>
      <div class="player-drilldown-event-legend-items">
        <span class="player-drilldown-event-legend-chip player-drilldown-event-legend-chip-above-average">Above average</span>
        <span class="player-drilldown-event-legend-chip player-drilldown-event-legend-chip-mixed-average">Mixed</span>
        <span class="player-drilldown-event-legend-chip player-drilldown-event-legend-chip-below-average">Below average</span>
      </div>
    </div>
  `;
}

function buildDeckPilotsTooltipItems(rows = [], selectedPlayerKey = '') {
  return rows.map(row => {
    const playerName = String(row?.Player || '').trim() || '--';
    const isSelectedPlayer = selectedPlayerKey ? rowMatchesPlayerKey(row, selectedPlayerKey) : false;
    const playerLabel = isSelectedPlayer
      ? `${escapeHtml(playerName)} ${highlightDrilldownText('(You)', 'reference')}`
      : escapeHtml(playerName);

    return `${playerLabel}: ${highlightDrilldownText(`#${row?.Rank ?? '--'}`, 'number')} / ${highlightDrilldownText(String(row?.Wins ?? 0), 'number')} / ${highlightDrilldownText(String(row?.Losses ?? 0), 'number')} / ${highlightDrilldownText(getRowWinRateText(row), 'number')}`;
  });
}

function buildPlayerDeckEventContextHtml(eventRows, playerRow, selectedPlayerKey) {
  const comparisonData = getSameDeckEventComparisonData(eventRows, playerRow, selectedPlayerKey);
  if (!comparisonData) {
    return '';
  }

  const {
    sameDeckRows,
    averageRank,
    averageDeckWinRate,
    bestDeckPilot,
    bestDeckPilotIsSelectedPlayer,
    playerRank,
    playerWinRateValue,
    bestDeckPilotRank,
    bestDeckPilotWinRate
  } = comparisonData;
  const deckPilotsTooltip = buildDeckPilotsTooltipItems(sameDeckRows, selectedPlayerKey);
  const averageRankTooltip = buildTooltipText([
    describeFinishComparison('Deck average finish', averageRank, 'Your Finish', playerRank)
  ]);
  const averageDeckWinRateTooltip = buildTooltipText([
    describeWinRateComparison('Deck average WR', averageDeckWinRate, 'Your WR', playerWinRateValue)
  ]);
  const bestDeckResultTooltip = buildTooltipText([
    describeFinishComparison('Best same-deck finish', bestDeckPilotRank, 'Your Finish', playerRank),
    describeWinRateComparison('Best same-deck WR', bestDeckPilotWinRate, 'Your WR', playerWinRateValue)
  ]);
  const deckPilotsItemClasses = buildDrilldownTooltipClasses(
    'player-rank-drilldown-summary-item',
    deckPilotsTooltip
  );
  const averageRankItemClasses = buildDrilldownTooltipClasses('player-rank-drilldown-summary-item', averageRankTooltip);
  const averageDeckWinRateItemClasses = buildDrilldownTooltipClasses('player-rank-drilldown-summary-item', averageDeckWinRateTooltip);
  const bestDeckResultItemClasses = buildDrilldownTooltipClasses('player-rank-drilldown-summary-item', bestDeckResultTooltip);

  return `
    <div class="player-rank-drilldown-context">
      <div class="player-rank-drilldown-context-title">Same-Deck Results in This Event</div>
      <div class="player-rank-drilldown-summary-grid">
        <div class="${deckPilotsItemClasses}">
          <span class="player-rank-drilldown-summary-label">Deck Pilots</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(sameDeckRows.length)}</strong>
          ${buildDrilldownHoverNote(deckPilotsTooltip, 'player-rank-drilldown-hover-note-scrollable', 'Player / Position / Wins / Losses / WR')}
        </div>
        <div class="${averageRankItemClasses}">
          <span class="player-rank-drilldown-summary-label">Average Deck Finish</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatAverageRankText(averageRank))}</strong>
          ${buildDrilldownHoverNote(averageRankTooltip)}
        </div>
        <div class="${averageDeckWinRateItemClasses}">
          <span class="player-rank-drilldown-summary-label">Average Deck Win Rate</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatWinRatePercentage(averageDeckWinRate))}</strong>
          ${buildDrilldownHoverNote(averageDeckWinRateTooltip)}
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Best Deck Pilot</span>
          <div class="player-rank-drilldown-summary-value player-rank-drilldown-summary-value-stack">
            <span>${escapeHtml(bestDeckPilot?.Player || '--')}</span>
            ${bestDeckPilotIsSelectedPlayer ? '<span class="player-rank-drilldown-badge">You</span>' : ''}
          </div>
        </div>
        <div class="${bestDeckResultItemClasses}">
          <span class="player-rank-drilldown-summary-label">Best Deck Result</span>
          <div class="player-rank-drilldown-summary-value player-rank-drilldown-summary-value-stack">
            <span>#${escapeHtml(bestDeckPilot?.Rank ?? '--')} / ${escapeHtml(bestDeckPilot?.Wins ?? 0)}-${escapeHtml(bestDeckPilot?.Losses ?? 0)} / ${escapeHtml(getRowWinRateText(bestDeckPilot))}</span>
          </div>
          ${buildDrilldownHoverNote(bestDeckResultTooltip)}
        </div>
      </div>
    </div>
  `;
}

function buildPlayerRankTop8Html(eventRows, playerRow, selectedPlayerKey) {
  const top8Rows = (eventRows || []).filter(row => {
    const rank = Number(row.Rank);
    return rank >= 1 && rank <= 8;
  });

  if (top8Rows.length === 0) {
    return `
      <div class="player-rank-drilldown-top8">
        <div class="player-rank-drilldown-top8-title">Full Top 8</div>
        <div class="player-rank-drilldown-top8-empty">Top 8 data is not available for this event.</div>
      </div>
    `;
  }

  const playerDeck = String(playerRow?.Deck || '');
  const rowsHtml = top8Rows.map(row => {
    const isPlayerRow = selectedPlayerKey ? rowMatchesPlayerKey(row, selectedPlayerKey) : false;
    const isPlayerDeck = playerDeck && row.Deck === playerDeck;
    const rowClasses = [
      'player-rank-drilldown-top8-row',
      isPlayerDeck ? 'player-deck-highlight' : '',
      isPlayerRow ? 'player-row-highlight' : ''
    ]
      .filter(Boolean)
      .join(' ');

    return `
      <tr class="${rowClasses}">
        <td>#${escapeHtml(row.Rank)}</td>
        <td>
          <div class="player-rank-drilldown-cell-stack">
            <span>${escapeHtml(row.Player || '--')}</span>
            ${isPlayerRow ? '<span class="player-rank-drilldown-badge">You</span>' : ''}
          </div>
        </td>
        <td>
          <div class="player-rank-drilldown-cell-stack">
            <span>${escapeHtml(row.Deck || '--')}</span>
            ${isPlayerDeck ? '<span class="player-rank-drilldown-badge player-rank-drilldown-badge-accent">Your Deck</span>' : ''}
          </div>
        </td>
        <td>${escapeHtml(row.Wins ?? 0)}</td>
        <td>${escapeHtml(row.Losses ?? 0)}</td>
        <td>${escapeHtml(getRowWinRateText(row))}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="player-rank-drilldown-top8">
      <div class="player-rank-drilldown-top8-title">Full Top 8</div>
      <div class="player-rank-drilldown-top8-scroll">
        <table class="player-rank-drilldown-top8-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Deck</th>
              <th>Wins</th>
              <th>Losses</th>
              <th>Win Rate</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function buildPlayerRankDrilldownHtml(categoryKey) {
  const config = PLAYER_RANK_DRILLDOWN_CONFIG[categoryKey];
  if (!config) {
    return '';
  }

  const matchingRows = getPlayerRankDrilldownMatches(categoryKey);
  if (matchingRows.length === 0) {
    return `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
  }

  const selectedPlayerKey = document.getElementById('playerFilterMenu')?.value || '';
  const eventRowsByName = buildEventRowsByName(matchingRows.map(row => row.Event));

  if (matchingRows.length > 1) {
    return buildPlayerEventAccordionListHtml(matchingRows, {
      includeTop8: config.includeTop8,
      selectedPlayerKey,
      eventRowsByName
    });
  }

  return matchingRows
    .map(playerRow => buildPlayerEventResultDrilldownHtml(playerRow, {
      includeTop8: config.includeTop8,
      selectedPlayerKey,
      eventRowsByName,
      actionButtonHtml: buildPlayerOpenEventAnalysisButtonHtml(playerRow)
    }))
    .join('');
}

function buildPlayerEventAccordionListHtml(
  rows,
  { includeTop8 = true, selectedPlayerKey = '', eventRowsByName = null } = {}
) {
  if (!rows || rows.length === 0) {
    return '<div class="player-rank-drilldown-empty">No events found.</div>';
  }

  return `
    <div class="event-stat-drilldown-toolbar">
      <div class="event-stat-drilldown-toolbar-note">Expand an event to inspect the full challenge details, same-deck context, and Top 8.</div>
    </div>
    <div class="event-stat-drilldown-list player-summary-event-list">
      ${rows.map(row => {
        const formattedEventName = formatEventName(row.Event) || row.Event || 'Unknown Event';
        const eventDate = row.Date ? formatDate(row.Date) : '--';
        const eventBodyId = `playerBucketEvent-${String(row.Date || '').replace(/[^a-zA-Z0-9_-]/g, '-')}-${String(row.Event || '').replace(/[^a-zA-Z0-9_-]/g, '-')}-${String(row.Rank || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;

        return `
          <article class="player-summary-event-item">
            <button
              type="button"
              class="event-stat-drilldown-list-item player-summary-event-toggle"
              data-player-summary-event-toggle="${escapeHtml(eventBodyId)}"
              aria-expanded="false"
              aria-controls="${escapeHtml(eventBodyId)}"
            >
              <span class="event-stat-drilldown-list-item-date">${escapeHtml(eventDate)}</span>
              <span class="event-stat-drilldown-list-item-main">${escapeHtml(formattedEventName)}</span>
              <span class="event-stat-drilldown-list-item-meta">${escapeHtml(`Finish: #${row.Rank || '--'} | Deck: ${row.Deck || '--'} | ${row.Wins ?? 0}-${row.Losses ?? 0} | ${getRowWinRateText(row)} WR`)}</span>
              <span class="player-summary-event-toggle-indicator drilldown-toggle-indicator" aria-hidden="true">+</span>
            </button>
            <div id="${escapeHtml(eventBodyId)}" class="leaderboard-event-drilldown-body" hidden>
              ${buildPlayerEventResultDrilldownHtml(row, {
                includeTop8,
                selectedPlayerKey,
                eventRowsByName,
                actionButtonHtml: buildPlayerOpenEventAnalysisButtonHtml(row)
              })}
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function buildPlayerOpenEventAnalysisButtonHtml(playerRow) {
  if (!playerRow) {
    return '';
  }

  return `
    <div class="event-stat-drilldown-toolbar">
      <button
        type="button"
        class="bubble-button"
        data-player-open-event-analysis="${escapeHtml(String(playerRow.Event || '').trim())}"
        data-player-open-event-type="${escapeHtml(String(playerRow.EventType || '').toLowerCase())}"
      >
        Open in Event Analysis
      </button>
    </div>
  `;
}

function buildPlayerEventResultDrilldownHtml(
  playerRow,
  { includeTop8 = true, selectedPlayerKey = '', eventRowsByName = null, actionButtonHtml = '' } = {}
) {
  if (!playerRow) {
    return '<div class="player-rank-drilldown-empty">Event details are unavailable.</div>';
  }

  const formattedEventName = formatEventName(playerRow.Event) || playerRow.Event || 'Unknown Event';
  const eventDate = playerRow.Date ? formatDate(playerRow.Date) : '--';
  const resolvedEventRowsByName = eventRowsByName instanceof Map ? eventRowsByName : buildEventRowsByName([playerRow.Event]);
  const eventRows = resolvedEventRowsByName.get(playerRow.Event) || [];
  const playerRank = Number(playerRow?.Rank) || Number.NaN;
  const playerWinRateValue = getRowWinRateValue(playerRow);
  const playerDeck = String(playerRow?.Deck || '').trim();
  const sameDeckRows = eventRows.filter(row => String(row.Deck || '').trim() === playerDeck);
  const averageRank = sameDeckRows.length > 0
    ? sameDeckRows.reduce((sum, row) => sum + (Number(row.Rank) || 0), 0) / sameDeckRows.length
    : Number.NaN;
  const averageDeckWinRate = sameDeckRows.length > 0
    ? sameDeckRows.reduce((sum, row) => sum + getRowWinRateValue(row), 0) / sameDeckRows.length
    : Number.NaN;
  const bestDeckPilot = sameDeckRows.length > 0 ? getBestDeckPilotRow(sameDeckRows) : null;
  const bestDeckPilotRank = Number(bestDeckPilot?.Rank) || Number.NaN;
  const bestDeckPilotWinRate = getRowWinRateValue(bestDeckPilot);
  const playerRankTooltip = buildTooltipText([
    describeFinishComparison('Your Finish', playerRank, 'deck average finish', averageRank),
    describeFinishComparison('Your Finish', playerRank, 'best same-deck finish', bestDeckPilotRank)
  ]);
  const playerWinRateTooltip = buildTooltipText([
    describeWinRateComparison('Your WR', playerWinRateValue, 'deck average WR', averageDeckWinRate),
    describeWinRateComparison('Your WR', playerWinRateValue, 'best same-deck WR', bestDeckPilotWinRate)
  ]);
  const playerRankItemClasses = buildDrilldownTooltipClasses('player-rank-drilldown-summary-item', playerRankTooltip);
  const playerWinRateItemClasses = buildDrilldownTooltipClasses('player-rank-drilldown-summary-item', playerWinRateTooltip);
  const deckEventContextHtml = buildPlayerDeckEventContextHtml(eventRows, playerRow, selectedPlayerKey);
  const top8Html = includeTop8
    ? buildPlayerRankTop8Html(eventRows, playerRow, selectedPlayerKey)
    : '';

  return `
    <article class="player-rank-drilldown-event">
      <div class="player-rank-drilldown-event-header">
        <div>
          <div class="player-rank-drilldown-event-date">${escapeHtml(eventDate)}</div>
          <h4 class="player-rank-drilldown-event-name">${escapeHtml(formattedEventName)}</h4>
        </div>
        <span class="player-rank-drilldown-rank-badge">#${escapeHtml(playerRow.Rank)}</span>
      </div>
      <div class="player-rank-drilldown-summary-grid">
        <div class="${playerRankItemClasses}">
          <span class="player-rank-drilldown-summary-label">Finish</span>
          <strong class="player-rank-drilldown-summary-value">#${escapeHtml(playerRow.Rank)}</strong>
          ${buildDrilldownHoverNote(playerRankTooltip)}
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Deck Played</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(playerRow.Deck || '--')}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Wins</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(playerRow.Wins ?? 0)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Losses</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(playerRow.Losses ?? 0)}</strong>
        </div>
        <div class="${playerWinRateItemClasses}">
          <span class="player-rank-drilldown-summary-label">Win Rate</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(getRowWinRateText(playerRow))}</strong>
          ${buildDrilldownHoverNote(playerWinRateTooltip)}
        </div>
      </div>
      ${deckEventContextHtml}
      ${actionButtonHtml}
      ${top8Html}
    </article>
  `;
}

function buildPlayerSummaryEventListHtml(rows) {
  if (!rows || rows.length === 0) {
    return '<div class="player-rank-drilldown-empty">No events found.</div>';
  }

  const selectedPlayerKey = document.getElementById('playerFilterMenu')?.value || '';
  const eventRowsByName = buildEventRowsByName(rows.map(row => row.Event));

  return `
    <div class="event-stat-drilldown-toolbar">
      <div class="event-stat-drilldown-toolbar-note">Expand a challenge to inspect the event details, same-deck context, full Top 8, and open it in Event Analysis.</div>
    </div>
    <div class="event-stat-drilldown-list player-summary-event-list">
      ${rows.map(row => {
        const formattedEventName = formatEventName(row.Event) || row.Event || 'Unknown Event';
        const eventDate = row.Date ? formatDate(row.Date) : '--';
        const eventBodyId = `playerSummaryEvent-${String(row.Date || '').replace(/[^a-zA-Z0-9_-]/g, '-')}-${String(row.Event || '').replace(/[^a-zA-Z0-9_-]/g, '-')}-${String(row.Rank || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;

        return `
          <article class="player-summary-event-item">
            <button
              type="button"
              class="event-stat-drilldown-list-item player-summary-event-toggle"
              data-player-summary-event-toggle="${escapeHtml(eventBodyId)}"
              aria-expanded="false"
              aria-controls="${escapeHtml(eventBodyId)}"
            >
              <span class="event-stat-drilldown-list-item-date">${escapeHtml(eventDate)}</span>
              <span class="event-stat-drilldown-list-item-main">${escapeHtml(formattedEventName)}</span>
              <span class="event-stat-drilldown-list-item-meta">${escapeHtml(`#${row.Rank || '--'} | ${row.Deck || '--'} | ${getRowWinRateText(row)} WR`)}</span>
              <span class="player-summary-event-toggle-indicator drilldown-toggle-indicator" aria-hidden="true">+</span>
            </button>
            <div id="${escapeHtml(eventBodyId)}" class="leaderboard-event-drilldown-body" hidden>
              ${buildPlayerEventResultDrilldownHtml(row, {
                includeTop8: true,
                selectedPlayerKey,
                eventRowsByName,
                actionButtonHtml: buildPlayerOpenEventAnalysisButtonHtml(row)
              })}
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function buildPlayerDeckEventListHtml(rows, eventRowsByName = new Map()) {
  if (!rows || rows.length === 0) {
    return '<div class="player-drilldown-event-list-empty">No events found for this deck.</div>';
  }

  return `
    <div class="player-drilldown-event-list">
      ${rows.map(row => {
        const formattedEventName = formatEventName(row.Event) || row.Event || 'Unknown Event';
        const eventDate = row.Date ? formatDate(row.Date) : '--';
        const comparisonData = getSameDeckEventComparisonData(eventRowsByName.get(row.Event) || [], row);
        const comparisonNote = buildSameDeckEventComparisonNote(comparisonData);
        const comparisonTone = getPlayerDeckEventComparisonTone(comparisonData);
        const comparisonToneLabel = getPlayerDeckEventComparisonToneLabel(comparisonTone, comparisonData);
        const itemClasses = buildDrilldownTooltipClasses(
          `player-drilldown-event-list-item player-drilldown-event-list-item-${comparisonTone}`,
          comparisonNote
        );

        return `
          <div class="${itemClasses}">
            <div class="player-drilldown-event-list-main">
              <strong>${escapeHtml(formattedEventName)}</strong>
              <span>${escapeHtml(eventDate)}</span>
            </div>
            <div class="player-drilldown-event-list-meta">
              <span>#${escapeHtml(row.Rank)}</span>
              <span>${escapeHtml(row.Wins ?? 0)}-${escapeHtml(row.Losses ?? 0)}</span>
              <span>${escapeHtml(getRowWinRateText(row))}</span>
              <span class="player-drilldown-event-list-tone player-drilldown-event-list-tone-${comparisonTone}">${escapeHtml(comparisonToneLabel)}</span>
            </div>
            ${buildDrilldownHoverNote(comparisonNote)}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function buildPlayerDeckGroupDrilldownHtml(groups) {
  if (!groups || groups.length === 0) {
    return '<div class="player-rank-drilldown-empty">No deck data found.</div>';
  }

  return groups.map((group, index) => {
    const eventRowsByName = buildEventRowsByName(group.rows.map(row => row.Event));

    return `
      <article class="player-rank-drilldown-event">
        <div class="player-rank-drilldown-event-header">
          <div>
            <div class="player-rank-drilldown-event-date">Deck Summary</div>
            <h4 class="player-rank-drilldown-event-name">${escapeHtml(group.deck)}</h4>
          </div>
          <span class="player-rank-drilldown-rank-badge">${escapeHtml(group.eventCount)} Event${group.eventCount === 1 ? '' : 's'}</span>
        </div>
        <div class="player-rank-drilldown-summary-grid">
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Wins</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(group.wins)}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Losses</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(group.losses)}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Overall Win Rate</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatWinRatePercentage(group.overallWinRate))}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Average Finish</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatAverageRankText(group.averageFinish))}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Best Finish</span>
            <strong class="player-rank-drilldown-summary-value">
              #${escapeHtml(group.bestFinishRow?.Rank ?? '--')} ${group.bestFinishRow ? `(${escapeHtml(formatEventName(group.bestFinishRow.Event) || group.bestFinishRow.Event)})` : ''}
            </strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Worst Finish</span>
            <strong class="player-rank-drilldown-summary-value">
              #${escapeHtml(group.worstFinishRow?.Rank ?? '--')} ${group.worstFinishRow ? `(${escapeHtml(formatEventName(group.worstFinishRow.Event) || group.worstFinishRow.Event)})` : ''}
            </strong>
          </div>
        </div>
        <div class="player-rank-drilldown-context">
          <div class="player-rank-drilldown-context-header">
            <div class="player-rank-drilldown-context-title">Event Results</div>
            ${index === 0 ? buildPlayerDeckEventLegendHtml() : ''}
          </div>
          ${buildPlayerDeckEventListHtml(group.rows, eventRowsByName)}
        </div>
      </article>
    `;
  }).join('');
}

function buildPlayerSummaryDrilldownHtml(categoryKey) {
  const config = PLAYER_SUMMARY_DRILLDOWN_CONFIG[categoryKey];
  if (!config) {
    return '';
  }

  const items = getPlayerSummaryDrilldownItems(categoryKey);
  if (items.length === 0) {
    return `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
  }

  if (categoryKey === 'totalEvents') {
    return buildPlayerSummaryEventListHtml(items);
  }

  return buildPlayerDeckGroupDrilldownHtml(items);
}

function updatePlayerRankDrilldownCardStates(data = currentPlayerAnalysisRows) {
  Object.entries(PLAYER_RANK_DRILLDOWN_CONFIG).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card) {
      return;
    }

    const matchCount = getPlayerRankDrilldownMatches(categoryKey, data).length;
    const isDisabled = matchCount === 0;

    card.classList.add('drilldown-card');
    card.classList.toggle('drilldown-disabled', isDisabled);
    card.setAttribute('role', 'button');
    card.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
    card.tabIndex = isDisabled ? -1 : 0;
    card.title = isDisabled
      ? config.emptyMessage
      : `Open ${config.title.toLowerCase()} details`;
  });
}

function updatePlayerSummaryDrilldownCardStates(data = currentPlayerAnalysisRows) {
  Object.entries(PLAYER_SUMMARY_DRILLDOWN_CONFIG).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card) {
      return;
    }

    const itemCount = getPlayerSummaryDrilldownItems(categoryKey, data).length;
    const isDisabled = itemCount === 0;

    card.classList.add('drilldown-card');
    card.classList.toggle('drilldown-disabled', isDisabled);
    card.setAttribute('role', 'button');
    card.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
    card.tabIndex = isDisabled ? -1 : 0;
    card.title = isDisabled
      ? config.emptyMessage
      : `Open ${config.title.toLowerCase()} details`;
  });
}

function updatePlayerSidebarDrilldownCardStates(data = currentPlayerAnalysisRows) {
  Object.entries(PLAYER_SIDEBAR_DRILLDOWN_CONFIG).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card) {
      return;
    }

    const itemCount = getPlayerSidebarDrilldownItems(categoryKey, data).length;
    const isDisabled = itemCount === 0;

    card.classList.add('drilldown-card');
    card.classList.toggle('drilldown-disabled', isDisabled);
    card.setAttribute('role', 'button');
    card.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
    card.tabIndex = isDisabled ? -1 : 0;
    const cardTitle = getPlayerSidebarCardTitle(config.cardId, config.fallbackTitle);
    card.title = isDisabled
      ? config.emptyMessage
      : `Open ${cardTitle.toLowerCase()} details`;
  });
}

function renderPlayerRankDrilldown(categoryKey) {
  const elements = getPlayerRankDrilldownElements();
  const config = PLAYER_RANK_DRILLDOWN_CONFIG[categoryKey];

  if (!config || !elements.overlay || !elements.title || !elements.subtitle || !elements.content) {
    return;
  }

  const playerLabel = getSelectedPlayerLabel(document.getElementById('playerFilterMenu')) || 'Selected Player';
  const matchCount = getPlayerRankDrilldownMatches(categoryKey).length;
  const eventLabel = `${matchCount} event${matchCount === 1 ? '' : 's'}`;

  elements.title.textContent = `${playerLabel} - ${config.title}`;
  elements.subtitle.textContent = matchCount > 0
    ? `${eventLabel} in the current Player Analysis filters`
    : config.emptyMessage;
  elements.content.innerHTML = buildPlayerRankDrilldownHtml(categoryKey);
}

function renderPlayerSummaryDrilldown(categoryKey) {
  const elements = getPlayerRankDrilldownElements();
  const config = PLAYER_SUMMARY_DRILLDOWN_CONFIG[categoryKey];

  if (!config || !elements.overlay || !elements.title || !elements.subtitle || !elements.content) {
    return;
  }

  const playerLabel = getSelectedPlayerLabel(document.getElementById('playerFilterMenu')) || 'Selected Player';
  const items = getPlayerSummaryDrilldownItems(categoryKey);
  const itemLabel = categoryKey === 'totalEvents'
    ? `${items.length} event${items.length === 1 ? '' : 's'}`
    : `${items.length} ${items.length === 1 ? 'entry' : 'entries'}`;

  elements.title.textContent = `${playerLabel} - ${config.title}`;
  elements.subtitle.textContent = items.length > 0
    ? `${itemLabel} in the current Player Analysis filters`
    : config.emptyMessage;
  elements.content.innerHTML = buildPlayerSummaryDrilldownHtml(categoryKey);
}

function getPlayerSidebarCardTitle(cardId, fallbackTitle = 'Details') {
  return document.getElementById(cardId)?.querySelector('.stat-title')?.textContent?.trim() || fallbackTitle;
}

function renderPlayerSidebarDrilldown(categoryKey) {
  const elements = getPlayerRankDrilldownElements();
  const config = PLAYER_SIDEBAR_DRILLDOWN_CONFIG[categoryKey];

  if (!config || !elements.overlay || !elements.title || !elements.subtitle || !elements.content) {
    return;
  }

  const playerLabel = getSelectedPlayerLabel(document.getElementById('playerFilterMenu')) || 'Selected Player';
  const items = getPlayerSidebarDrilldownItems(categoryKey);
  const itemLabel = `${items.length} deck ${items.length === 1 ? 'entry' : 'entries'}`;

  elements.title.textContent = `${playerLabel} - ${getPlayerSidebarCardTitle(config.cardId, config.fallbackTitle)}`;
  elements.subtitle.textContent = items.length > 0
    ? `${itemLabel} in the current Player Analysis filters`
    : config.emptyMessage;
  elements.content.innerHTML = items.length > 0
    ? buildPlayerDeckGroupDrilldownHtml(items)
    : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
}

function renderPlayerDrilldown(categoryKey) {
  if (PLAYER_RANK_DRILLDOWN_CONFIG[categoryKey]) {
    renderPlayerRankDrilldown(categoryKey);
    return;
  }

  if (PLAYER_SUMMARY_DRILLDOWN_CONFIG[categoryKey]) {
    renderPlayerSummaryDrilldown(categoryKey);
    return;
  }

  if (PLAYER_SIDEBAR_DRILLDOWN_CONFIG[categoryKey]) {
    renderPlayerSidebarDrilldown(categoryKey);
  }
}

function openPlayerDrilldown(categoryKey) {
  const elements = getPlayerRankDrilldownElements();
  const hasConfig =
    Boolean(PLAYER_RANK_DRILLDOWN_CONFIG[categoryKey]) ||
    Boolean(PLAYER_SUMMARY_DRILLDOWN_CONFIG[categoryKey]) ||
    Boolean(PLAYER_SIDEBAR_DRILLDOWN_CONFIG[categoryKey]);

  if (!elements.overlay || !hasConfig) {
    return;
  }

  activePlayerDrilldownCategory = categoryKey;
  renderPlayerDrilldown(categoryKey);
  elements.overlay.hidden = false;
  document.body.classList.add('modal-open');
}

function findPlayerEventHistoryRow({ eventName = '', eventDate = '', deckName = '', rank = '' } = {}) {
  const normalizedEventName = String(eventName || '').trim();
  const normalizedEventDate = String(eventDate || '').trim();
  const normalizedDeckName = String(deckName || '').trim();
  const normalizedRank = String(rank || '').trim();

  return currentPlayerAnalysisRows.find(row => {
    return (
      String(row?.Event || '').trim() === normalizedEventName &&
      String(row?.Date || '').trim() === normalizedEventDate &&
      String(row?.Deck || '').trim() === normalizedDeckName &&
      String(row?.Rank ?? '').trim() === normalizedRank
    );
  }) || currentPlayerAnalysisRows.find(row => {
    return (
      String(row?.Event || '').trim() === normalizedEventName &&
      String(row?.Date || '').trim() === normalizedEventDate
    );
  }) || null;
}

function openPlayerEventHistoryDrilldown({ eventName = '', eventDate = '', deckName = '', rank = '' } = {}) {
  const elements = getPlayerRankDrilldownElements();
  if (!elements.overlay || !elements.title || !elements.subtitle || !elements.content) {
    return;
  }

  const playerRow = findPlayerEventHistoryRow({ eventName, eventDate, deckName, rank });
  const playerLabel = getSelectedPlayerLabel(document.getElementById('playerFilterMenu')) || 'Selected Player';

  if (!playerRow) {
    elements.title.textContent = `${playerLabel} - Event History`;
    elements.subtitle.textContent = 'Event details are not available for the selected history entry.';
    elements.content.innerHTML = '<div class="player-rank-drilldown-empty">Event details are unavailable.</div>';
    activePlayerDrilldownCategory = '';
    elements.overlay.hidden = false;
    document.body.classList.add('modal-open');
    return;
  }

  const formattedEventName = formatEventName(playerRow.Event) || playerRow.Event || 'Unknown Event';
  const eventDateLabel = playerRow.Date ? formatDate(playerRow.Date) : '--';
  const deckLabel = String(playerRow.Deck || '').trim() || '--';
  const rankLabel = playerRow.Rank ? `#${playerRow.Rank}` : '#--';

  elements.title.textContent = `${playerLabel} - ${formattedEventName}`;
  elements.subtitle.textContent = `${eventDateLabel} | ${deckLabel} | ${rankLabel} | ${getRowWinRateText(playerRow)} WR`;
  elements.content.innerHTML = buildPlayerEventResultDrilldownHtml(playerRow, { includeTop8: true });
  activePlayerDrilldownCategory = '';
  elements.overlay.hidden = false;
  document.body.classList.add('modal-open');

  // Add the "Open in Event Analysis" button
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'bubble-button';
  openBtn.textContent = 'Open in Event Analysis';
  openBtn.style.marginLeft = '10px';
  elements.title.appendChild(openBtn);

  openBtn.addEventListener('click', () => {
    // Switch to Event Analysis
    const eventBtn = document.querySelector('.top-mode-button[data-top-mode="event"]');
    if (eventBtn) eventBtn.click();

    // Set to single mode
    const singleBtn = document.querySelector('.analysis-mode[data-mode="single"]');
    if (singleBtn) singleBtn.click();

    // Set event type
    setSingleEventType(playerRow.EventType.toLowerCase());

    // Update the event filter to populate the menu with the correct events
    updateEventFilter(playerRow.Event, true);

    // Trigger the change event to update the charts
    const eventFilterMenu = document.getElementById('eventFilterMenu');
    if (eventFilterMenu) {
      eventFilterMenu.dispatchEvent(new Event('change'));
    }

    // Close the modal
    closePlayerRankDrilldown();

    // Scroll to top
    window.scrollTo(0, 0);
  });
}

function closePlayerRankDrilldown() {
  const { overlay } = getPlayerRankDrilldownElements();
  if (!overlay) {
    return;
  }

  overlay.hidden = true;
  activePlayerDrilldownCategory = '';
  document.body.classList.remove('modal-open');
}

function openPlayerEventInAnalysis(eventName = '', eventType = '') {
  const normalizedEventName = String(eventName || '').trim();
  const normalizedEventType = String(eventType || '').trim().toLowerCase();
  if (!normalizedEventName) {
    return;
  }

  const eventBtn = document.querySelector('.top-mode-button[data-top-mode="event"]');
  if (eventBtn) {
    eventBtn.click();
  }

  const singleBtn = document.querySelector('.analysis-mode[data-mode="single"]');
  if (singleBtn) {
    singleBtn.click();
  }

  if (normalizedEventType) {
    setSingleEventType(normalizedEventType);
  }

  updateEventFilter(normalizedEventName, true);

  const eventFilterMenu = document.getElementById('eventFilterMenu');
  if (eventFilterMenu) {
    eventFilterMenu.dispatchEvent(new Event('change'));
  }

  closePlayerRankDrilldown();
  window.scrollTo(0, 0);
}

function setupPlayerRankDrilldownModal() {
  const { overlay, closeButton, content } = getPlayerRankDrilldownElements();
  if (!overlay || overlay.dataset.initialized === 'true') {
    return;
  }

  overlay.dataset.initialized = 'true';

  closeButton?.addEventListener('click', closePlayerRankDrilldown);

  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      closePlayerRankDrilldown();
    }
  });

  content?.addEventListener('click', event => {
    const summaryToggleButton = event.target.closest('[data-player-summary-event-toggle]');
    if (summaryToggleButton) {
      const targetId = summaryToggleButton.dataset.playerSummaryEventToggle || '';
      const target = targetId ? document.getElementById(targetId) : null;
      if (!target) {
        return;
      }

      const shouldExpand = summaryToggleButton.getAttribute('aria-expanded') !== 'true';
      summaryToggleButton.setAttribute('aria-expanded', shouldExpand ? 'true' : 'false');
      const indicator = summaryToggleButton.querySelector('.player-summary-event-toggle-indicator');
      if (indicator) {
        indicator.textContent = shouldExpand ? '-' : '+';
      }
      target.hidden = !shouldExpand;
      return;
    }

    const openEventAnalysisButton = event.target.closest('[data-player-open-event-analysis]');
    if (openEventAnalysisButton) {
      openPlayerEventInAnalysis(
        openEventAnalysisButton.dataset.playerOpenEventAnalysis,
        openEventAnalysisButton.dataset.playerOpenEventType
      );
      return;
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) {
      closePlayerRankDrilldown();
    }
  });
}

function setupPlayerRankDrilldownCards() {
  Object.entries(PLAYER_RANK_DRILLDOWN_CONFIG).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card || card.dataset.drilldownBound === 'true') {
      return;
    }

    card.dataset.drilldownBound = 'true';

    const openIfEnabled = () => {
      if (card.getAttribute('aria-disabled') === 'true') {
        return;
      }

      openPlayerDrilldown(categoryKey);
    };

    card.addEventListener('click', openIfEnabled);
    card.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && card.getAttribute('aria-disabled') !== 'true') {
        event.preventDefault();
        openPlayerDrilldown(categoryKey);
      }
    });
  });
}

function setupPlayerEventHistoryInteractions() {
  const eventHistoryList = document.getElementById('playerEventsDetails');
  if (!eventHistoryList || eventHistoryList.dataset.drilldownBound === 'true') {
    return;
  }

  eventHistoryList.dataset.drilldownBound = 'true';
  eventHistoryList.addEventListener('click', event => {
    const historyButton = event.target.closest('.player-event-history-item');
    if (!historyButton) {
      return;
    }

    openPlayerEventHistoryDrilldown({
      eventName: historyButton.dataset.playerHistoryEvent,
      eventDate: historyButton.dataset.playerHistoryDate,
      deckName: historyButton.dataset.playerHistoryDeck,
      rank: historyButton.dataset.playerHistoryRank
    });
  });
}

function setupPlayerSummaryDrilldownCards() {
  Object.entries(PLAYER_SUMMARY_DRILLDOWN_CONFIG).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card || card.dataset.drilldownBound === 'true') {
      return;
    }

    card.dataset.drilldownBound = 'true';

    const openIfEnabled = () => {
      if (card.getAttribute('aria-disabled') === 'true') {
        return;
      }

      openPlayerDrilldown(categoryKey);
    };

    card.addEventListener('click', openIfEnabled);
    card.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && card.getAttribute('aria-disabled') !== 'true') {
        event.preventDefault();
        openPlayerDrilldown(categoryKey);
      }
    });
  });
}

function setupPlayerSidebarDrilldownCards() {
  Object.entries(PLAYER_SIDEBAR_DRILLDOWN_CONFIG).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card || card.dataset.drilldownBound === 'true') {
      return;
    }

    card.dataset.drilldownBound = 'true';

    const openIfEnabled = () => {
      if (card.getAttribute('aria-disabled') === 'true') {
        return;
      }

      openPlayerDrilldown(categoryKey);
    };

    card.addEventListener('click', openIfEnabled);
    card.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && card.getAttribute('aria-disabled') !== 'true') {
        event.preventDefault();
        openPlayerDrilldown(categoryKey);
      }
    });
  });
}

function initPlayerSearchDropdown() {
  const playerFilterMenu = document.getElementById('playerFilterMenu');
  if (!playerFilterMenu || playerFilterMenu.dataset.searchEnhanced === 'true') {
    return;
  }

  playerFilterMenu.dataset.searchEnhanced = 'true';
  playerFilterMenu.classList.add('player-filter-select-hidden');
  playerFilterMenu.tabIndex = -1;
  playerFilterMenu.setAttribute('aria-hidden', 'true');

  const searchSelect = document.createElement('div');
  searchSelect.className = 'player-search-select';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'player-search-input';
  searchInput.placeholder = 'Search players...';
  searchInput.autocomplete = 'off';
  searchInput.setAttribute('role', 'combobox');
  searchInput.setAttribute('aria-autocomplete', 'list');
  searchInput.setAttribute('aria-expanded', 'false');

  const dropdown = document.createElement('div');
  dropdown.id = 'playerFilterMenuDropdown';
  dropdown.className = 'player-search-dropdown';
  dropdown.setAttribute('role', 'listbox');

  searchInput.setAttribute('aria-controls', dropdown.id);

  searchSelect.appendChild(searchInput);
  searchSelect.appendChild(dropdown);
  playerFilterMenu.insertAdjacentElement('afterend', searchSelect);

  let filteredOptions = [];
  let activeIndex = -1;

  const getSelectableOptions = () =>
    Array.from(playerFilterMenu.options)
      .filter(option => option.value && !option.disabled)
      .map(option => ({
        label: option.textContent || option.value,
        value: option.value
      }));

  const getSelectedLabel = () => {
    const selectedOption = playerFilterMenu.selectedOptions[0];
    return selectedOption && selectedOption.value ? selectedOption.textContent || selectedOption.value : '';
  };

  const setDropdownOpen = isOpen => {
    dropdown.classList.toggle('open', isOpen && !searchInput.disabled);
    searchInput.setAttribute('aria-expanded', dropdown.classList.contains('open') ? 'true' : 'false');
  };

  const updateActiveOption = () => {
    const optionElements = dropdown.querySelectorAll('.player-search-option');

    optionElements.forEach((optionElement, index) => {
      const isActive = index === activeIndex;
      optionElement.classList.toggle('active', isActive);
      optionElement.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    if (activeIndex >= 0 && optionElements[activeIndex]) {
      const activeElement = optionElements[activeIndex];
      searchInput.setAttribute('aria-activedescendant', activeElement.id);
      activeElement.scrollIntoView({ block: 'nearest' });
    } else {
      searchInput.removeAttribute('aria-activedescendant');
    }
  };

  const syncInputFromSelect = () => {
    const selectableOptions = getSelectableOptions();
    const selectedLabel = getSelectedLabel();
    const emptyMessage = playerFilterMenu.options.length > 0
      ? playerFilterMenu.options[0].textContent || 'No Players Available'
      : 'No Players Available';

    if (selectableOptions.length === 0 || !selectedLabel) {
      searchInput.disabled = true;
      searchInput.value = '';
      searchInput.placeholder = emptyMessage;
      dropdown.innerHTML = '';
      filteredOptions = [];
      activeIndex = -1;
      searchInput.removeAttribute('aria-activedescendant');
      setDropdownOpen(false);
      return;
    }

    searchInput.disabled = false;
    searchInput.placeholder = 'Search players...';
    searchInput.value = selectedLabel;

    if (dropdown.classList.contains('open')) {
      renderOptions(searchInput.value.trim().toLowerCase());
    }
  };

  const selectOption = option => {
    if (!option) {
      return;
    }

    const didChange = playerFilterMenu.value !== option.value;
    playerFilterMenu.value = option.value;
    searchInput.value = option.label;
    activeIndex = -1;
    setDropdownOpen(false);

    if (didChange) {
      playerFilterMenu.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  function renderOptions(searchTerm = '') {
    const selectableOptions = getSelectableOptions();
    const normalizedSearchTerm = searchTerm.trim().toLowerCase();

    dropdown.innerHTML = '';

    if (selectableOptions.length === 0) {
      filteredOptions = [];
      activeIndex = -1;
      searchInput.removeAttribute('aria-activedescendant');
      setDropdownOpen(false);
      return;
    }

    filteredOptions = selectableOptions.filter(option => option.label.toLowerCase().includes(normalizedSearchTerm));

    if (filteredOptions.length === 0) {
      activeIndex = -1;
      dropdown.appendChild(createPlayerSearchEmptyState('No matching players.'));
      searchInput.removeAttribute('aria-activedescendant');
      setDropdownOpen(true);
      return;
    }

    const selectedIndex = filteredOptions.findIndex(option => option.value === playerFilterMenu.value);
    if (activeIndex < 0 || activeIndex >= filteredOptions.length) {
      activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
    }

    filteredOptions.forEach((option, index) => {
      const optionElement = document.createElement('div');
      optionElement.id = `${dropdown.id}-option-${index}`;
      optionElement.className = 'player-search-option';
      optionElement.textContent = option.label;
      optionElement.setAttribute('role', 'option');

      optionElement.addEventListener('mousedown', event => {
        event.preventDefault();
        selectOption(option);
      });

      dropdown.appendChild(optionElement);
    });

    updateActiveOption();
    setDropdownOpen(true);
  }

  searchInput.addEventListener('focus', () => {
    if (searchInput.disabled) {
      return;
    }

    renderOptions('');
    searchInput.select();
  });

  searchInput.addEventListener('click', () => {
    if (searchInput.disabled) {
      return;
    }

    renderOptions('');
  });

  searchInput.addEventListener('input', event => {
    activeIndex = -1;
    renderOptions(event.target.value);
  });

  searchInput.addEventListener('keydown', event => {
    if (searchInput.disabled) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!dropdown.classList.contains('open')) {
        renderOptions(searchInput.value);
        return;
      }

      activeIndex = Math.min(activeIndex + 1, filteredOptions.length - 1);
      updateActiveOption();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!dropdown.classList.contains('open')) {
        renderOptions(searchInput.value);
        return;
      }

      activeIndex = Math.max(activeIndex - 1, 0);
      updateActiveOption();
      return;
    }

    if (event.key === 'Enter') {
      if (dropdown.classList.contains('open') && activeIndex >= 0) {
        event.preventDefault();
        selectOption(filteredOptions[activeIndex]);
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      syncInputFromSelect();
      setDropdownOpen(false);
    }
  });

  document.addEventListener('mousedown', event => {
    if (!searchSelect.contains(event.target)) {
      syncInputFromSelect();
      setDropdownOpen(false);
    }
  });

  playerFilterMenu.addEventListener('change', syncInputFromSelect);

  const observer = new MutationObserver(() => {
    activeIndex = -1;
    syncInputFromSelect();
  });

  observer.observe(playerFilterMenu, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled']
  });

  syncInputFromSelect();
}

export function initPlayerAnalysis() {
  initPlayerSearchDropdown();
  setupPlayerRankDrilldownModal();
  setupPlayerRankDrilldownCards();
  setupPlayerEventHistoryInteractions();
  setupPlayerSummaryDrilldownCards();
  setupPlayerSidebarDrilldownCards();
  updatePlayerRankDrilldownCardStates();
  updatePlayerSummaryDrilldownCardStates();
  updatePlayerSidebarDrilldownCardStates();
  console.log('Player Analysis initialized');
}

export function updatePlayerAnalysis(data) {
  currentPlayerAnalysisRows = Array.isArray(data) ? [...data] : [];
  updatePlayerWinRateChart();
  updatePlayerDeckPerformanceChart();
  populatePlayerAnalysisRawData(data);
  populatePlayerStats(data);
}

export function updatePlayerAnalytics() {
  console.log("Updating player analytics...");
  const startDate = document.getElementById("playerStartDateSelect").value;
  const endDate = document.getElementById("playerEndDateSelect").value;
  const playerFilterMenu = document.getElementById("playerFilterMenu");
  const selectedPlayer = playerFilterMenu ? playerFilterMenu.value : null;
  const selectedPlayerLabel = getSelectedPlayerLabel(playerFilterMenu);
  const selectedEventTypes = getSelectedPlayerEventTypes();
  const scopedRows = getPlayerPresetRows(selectedEventTypes, getPlayerAnalysisActivePreset());

  console.log("Player Analytics Filters:", {
    startDate,
    endDate,
    selectedPlayer,
    selectedPlayerLabel,
    selectedEventTypes
  });

  const baseFilteredData = selectedPlayer && startDate && endDate && selectedEventTypes.length > 0
    ? scopedRows.filter(row => {
        return (
          row.Date >= startDate &&
          row.Date <= endDate &&
          rowMatchesPlayerKey(row, selectedPlayer) &&
          selectedEventTypes.includes(row.EventType.toLowerCase())
        );
      })
    : [];
  const filteredData = applyPlayerEventGroupFilter(baseFilteredData);

  console.log("baseFilteredData length in player-analysis:", baseFilteredData.length);
  updatePlayerAnalysis(filteredData);
}

export function populatePlayerAnalysisRawData(data) {
  const rawTableHead = document.getElementById("playerRawTableHead");
  const rawTableBody = document.getElementById("playerRawTableBody");
  const rawTableTitle = document.getElementById("playerRawTableTitle");
  const playerFilterMenu = document.getElementById("playerFilterMenu");
  const selectedPlayer = getSelectedPlayerLabel(playerFilterMenu) || "No Player Selected";

  rawTableTitle.textContent = `${selectedPlayer} - Event Data`;
  console.log("Setting initial table title:", rawTableTitle.textContent);

  let toggleContainer = document.querySelector('.player-table-toggle');
  if (!toggleContainer) {
    console.log("Creating toggle buttons...");
    toggleContainer = document.createElement('div');
    toggleContainer.className = 'bubble-menu player-table-toggle';
    toggleContainer.innerHTML = `
      <button class="bubble-button table-toggle-btn active" data-table="event">Event Data</button>
      <button class="bubble-button table-toggle-btn" data-table="deck">Deck Data</button>
    `;
    rawTableTitle.insertAdjacentElement('afterend', toggleContainer);
  }

  const updateTable = (tableType) => {
    if (tableType === 'event') {
      rawTableTitle.textContent = `${selectedPlayer} - Event Data`;
      rawTableHead.innerHTML = `
        <tr>
          <th data-sort="date">Date <span class="sort-arrow"></span></th>
          <th data-sort="event">Event <span class="sort-arrow"></span></th>
          <th data-sort="players">Number of Players <span class="sort-arrow"></span></th>
          <th data-sort="rank">Rank <span class="sort-arrow"></span></th>
          <th data-sort="deck">Deck <span class="sort-arrow"></span></th>
          <th data-sort="wins">Wins <span class="sort-arrow"></span></th>
          <th data-sort="losses">Losses <span class="sort-arrow"></span></th>
          <th data-sort="winRate">Player Win Rate <span class="sort-arrow"></span></th>
          <th data-sort="deckWinRate">Deck's Overall Win Rate <span class="sort-arrow"></span></th>
          <th data-sort="deckMeta">Deck's Meta <span class="sort-arrow"></span></th>
        </tr>
      `;

      const rows = calculatePlayerEventTable(data);
      updateElementHTML("playerRawTableBody", rows.length === 0 ? "<tr><td colspan='10'>No data available</td></tr>" : rows.map(row => `
        <tr>
          <td>${row.date}</td>
          <td class="event-tooltip" data-tooltip="${row.tooltip}">${row.event}</td>
          <td>${row.players}</td>
          <td>${row.rank}</td>
          <td>${row.deck}</td>
          <td>${row.wins}</td>
          <td>${row.losses}</td>
          <td>${row.winRate.toFixed(1)}%</td>
          <td>${row.deckWinRate.toFixed(1)}%</td>
          <td>${row.deckMeta.toFixed(1)}%</td>
        </tr>
      `).join(""));

      setupTableSorting(rawTableHead, rawTableBody, rows);
    } else if (tableType === 'deck') {
      rawTableTitle.textContent = `${selectedPlayer} - Deck Data`;
      rawTableHead.innerHTML = `
        <tr>
          <th data-sort="deck">Deck <span class="sort-arrow"></span></th>
          <th data-sort="events">Number of Events <span class="sort-arrow"></span></th>
          <th data-sort="wins">Wins <span class="sort-arrow"></span></th>
          <th data-sort="losses">Losses <span class="sort-arrow"></span></th>
          <th data-sort="overallWinRate">Overall Win Rate <span class="sort-arrow"></span></th>
          <th data-sort="bestWinRate">Best Win Rate <span class="sort-arrow"></span></th>
          <th data-sort="worstWinRate">Worst Win Rate <span class="sort-arrow"></span></th>
        </tr>
      `;

      const rows = calculatePlayerDeckTable(data);
      updateElementHTML("playerRawTableBody", rows.length === 0 ? "<tr><td colspan='7'>No data available</td></tr>" : rows.map(row => `
        <tr>
          <td>${row.deck}</td>
          <td>${row.events}</td>
          <td>${row.wins}</td>
          <td>${row.losses}</td>
          <td>${row.overallWinRate.toFixed(2)}%</td>
          <td class="event-tooltip" data-tooltip="${row.bestDate} - ${row.bestEvent}">${row.bestWinRate.toFixed(2)}%</td>
          <td class="event-tooltip" data-tooltip="${row.worstDate} - ${row.worstEvent}">${row.worstWinRate.toFixed(2)}%</td>
        </tr>
      `).join(""));

      setupTableSorting(rawTableHead, rawTableBody, rows);
    }
  };

  updateTable('event');
  const toggleButtons = toggleContainer.querySelectorAll('.table-toggle-btn');
  toggleButtons.forEach(button => button.addEventListener('click', () => {
    console.log(`Toggle clicked: ${button.dataset.table}`);
    toggleButtons.forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    updateTable(button.dataset.table);
  }));
}

export function populatePlayerStats(data) {
  console.log("populatePlayerStats called with data:", data);
  const stats = calculatePlayerStats(data);

  // Ensure all stat cards are visible
  ['playerEventsCard', 'playerUniqueDecksCard', 'playerMostPlayedCard', 'playerLeastPlayedCard',
   'playerBestDeckCard', 'playerWorstDeckCard', 'playerMostPlayedDeckCard', 'playerLeastPlayedDeckCard',
   'playerRankStatsCard', 'playerOverallWinRateCard'].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.style.display = "block";
  });

  // Helper function to safely update DOM elements
  const updateElement = (id, value, property = "textContent") => {
    const element = document.getElementById(id);
    if (element) element[property] = value;
    else console.warn(`Element with ID '${id}' not found in the DOM`);
  };

  const updateQueryElement = (id, selector, value, property = "innerHTML") => {
    const parent = document.getElementById(id);
    if (parent) {
      const element = parent.querySelector(selector);
      if (element) element[property] = value;
      else console.warn(`Selector '${selector}' not found in element with ID '${id}'`);
    } else console.warn(`Parent element with ID '${id}' not found in the DOM`);
  };

  // Simple Cards
  updateQueryElement("playerEventsCard", ".stat-value", stats.totalEvents);
  updateQueryElement("playerEventsCard", ".stat-change", stats.eventsDetails);
  updateQueryElement("playerUniqueDecksCard", ".stat-value", stats.uniqueDecks);
  updateQueryElement("playerMostPlayedCard", ".stat-value", stats.mostPlayedDecks);
  updateQueryElement("playerMostPlayedCard", ".stat-change", stats.mostPlayedCount);
  updateQueryElement("playerLeastPlayedCard", ".stat-value", stats.leastPlayedDecks);
  updateQueryElement("playerLeastPlayedCard", ".stat-change", stats.leastPlayedCount);

  // Rank Stats
  updateElement("playerTop1", stats.rankStats.top1);
  updateElement("playerTop1_8", stats.rankStats.top1_8);
  updateElement("playerTop9_16", stats.rankStats.top9_16);
  updateElement("playerTop17_32", stats.rankStats.top17_32);
  updateElement("playerTop33Plus", stats.rankStats.top33Plus);
  updateElement("playerTop1%", stats.rankStats.top1Percent);
  updateElement("playerTop1_8%", stats.rankStats.top1_8Percent);
  updateElement("playerTop9_16%", stats.rankStats.top9_16Percent);
  updateElement("playerTop17_32%", stats.rankStats.top17_32Percent);
  updateElement("playerTop33Plus%", stats.rankStats.top33PlusPercent);

  // Overall Win Rate
  updateElement("playerOverallWinRate", stats.overallWinRate);

  // Best Performing Deck
  updateQueryElement("playerBestDeckCard", ".stat-title", stats.bestDeckTitle);
  updateElement("playerBestDeckName", stats.bestDecks.name);
  updateElement("playerBestDeckEvents", stats.bestDecks.events);
  updateElement("playerBestDeckWinRate", stats.bestDecks.winRate);
  updateElement("playerBestDeckBestWinRate", stats.bestDecks.bestWinRate);
  updateElement("playerBestDeckWorstWinRate", stats.bestDecks.worstWinRate);

  // Worst Performing Deck
  updateQueryElement("playerWorstDeckCard", ".stat-title", stats.worstDeckTitle);
  updateElement("playerWorstDeckName", stats.worstDecks.name);
  updateElement("playerWorstDeckEvents", stats.worstDecks.events);
  updateElement("playerWorstDeckWinRate", stats.worstDecks.winRate);
  updateElement("playerWorstDeckBestWinRate", stats.worstDecks.bestWinRate);
  updateElement("playerWorstDeckWorstWinRate", stats.worstDecks.worstWinRate);

  // Most Played Deck
  updateQueryElement("playerMostPlayedDeckCard", ".stat-title", stats.mostPlayedDeckTitle);
  updateElement("playerMostPlayedDeckName", stats.mostPlayedDecksData.name);
  updateElement("playerMostPlayedDeckEvents", stats.mostPlayedDecksData.events);
  updateElement("playerMostPlayedDeckWinRate", stats.mostPlayedDecksData.winRate);
  updateElement("playerMostPlayedDeckBestWinRate", stats.mostPlayedDecksData.bestWinRate);
  updateElement("playerMostPlayedDeckWorstWinRate", stats.mostPlayedDecksData.worstWinRate);

  // Least Played Deck
  updateQueryElement("playerLeastPlayedDeckCard", ".stat-title", stats.leastPlayedDeckTitle);
  updateElement("playerLeastPlayedDeckName", stats.leastPlayedDecksData.name);
  updateElement("playerLeastPlayedDeckEvents", stats.leastPlayedDecksData.events);
  updateElement("playerLeastPlayedDeckWinRate", stats.leastPlayedDecksData.winRate);
  updateElement("playerLeastPlayedDeckBestWinRate", stats.leastPlayedDecksData.bestWinRate);
  updateElement("playerLeastPlayedDeckWorstWinRate", stats.leastPlayedDecksData.worstWinRate);

  playerSidebarCardIds.forEach(triggerUpdateAnimation);
  updatePlayerRankDrilldownCardStates(data);
  updatePlayerRankCardHoverNotes(data);
  updatePlayerSummaryDrilldownCardStates(data);
  updatePlayerSidebarDrilldownCardStates(data);

  if (activePlayerDrilldownCategory) {
    renderPlayerDrilldown(activePlayerDrilldownCategory);
  }

}

// Helper Function
function setupTableSorting(tableHead, tableBody, rows) {
  const headers = tableHead.querySelectorAll('th[data-sort]');
  headers.forEach(header => header.addEventListener('click', () => {
    const sortKey = header.dataset.sort;
    const isAscending = header.classList.contains('asc');
    headers.forEach(h => { h.classList.remove('asc', 'desc'); h.querySelector('.sort-arrow').textContent = ''; });
    rows.sort((a, b) => {
      const aVal = typeof a[sortKey] === 'string' ? a[sortKey].toLowerCase() : a[sortKey];
      const bVal = typeof b[sortKey] === 'string' ? b[sortKey].toLowerCase() : b[sortKey];
      return isAscending ? (aVal > bVal ? -1 : 1) : (aVal < bVal ? -1 : 1);
    });
    header.classList.add(isAscending ? 'desc' : 'asc');
    header.querySelector('.sort-arrow').textContent = isAscending ? '↓' : '↑';
    updateElementHTML("playerRawTableBody", rows.map(row => row.hasOwnProperty('players') ? `
      <tr>
        <td>${row.date}</td>
        <td class="event-tooltip" data-tooltip="${row.tooltip}">${row.event}</td>
        <td>${row.players}</td>
        <td>${row.rank}</td>
        <td>${row.deck}</td>
        <td>${row.wins}</td>
        <td>${row.losses}</td>
        <td>${row.winRate.toFixed(1)}%</td>
        <td>${row.deckWinRate.toFixed(1)}%</td>
        <td>${row.deckMeta.toFixed(1)}%</td>
      </tr>
    ` : `
      <tr>
        <td>${row.deck}</td>
        <td>${row.events}</td>
        <td>${row.wins}</td>
        <td>${row.losses}</td>
        <td>${row.overallWinRate.toFixed(2)}%</td>
        <td class="event-tooltip" data-tooltip="${row.bestDate} - ${row.bestEvent}">${row.bestWinRate.toFixed(2)}%</td>
        <td class="event-tooltip" data-tooltip="${row.worstDate} - ${row.worstEvent}">${row.worstWinRate.toFixed(2)}%</td>
      </tr>
    `).join(""));
  }));
}
