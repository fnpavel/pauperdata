// Renders Deck Matchup and Player Matchup views. It loads matchup archives for
// the active date window, builds matrix/table summaries, and manages focused
// player matchup drilldowns.
import {
  getDefaultQuickViewYear,
  getLatestSetQuickViewPresetId,
  getQuickViewPresetDefinitionById,
  getQuickViewPresetDefinitionsByIds,
  getQuickViewPresetEventTypes,
  getQuickViewPresetSuggestedRange,
  getQuickViewPresetYearOptions,
  getSetQuickViewPresetDefinitions,
  getStaticQuickViewPresetDefinitions,
  normalizeQuickViewPresetIds,
  shiftDateByDays
} from '../utils/quick-view-presets.js';
import {
  ensureMatchupCatalogLoaded,
  ensureMatchupWindowLoaded,
  getMatchupEvents,
  getMatchupMatches,
  filterMatchupRecords
} from '../utils/matchup-data.js';
import {
  buildRankingsDataset,
  getDefaultRankingsRange,
  getRankingsAvailableDates
} from '../utils/rankings-data.js';
import {
  getUnknownHeavyBelowTop32ExcludedEventNames,
  isUnknownHeavyBelowTop32FilterEnabled
} from '../utils/analysis-data.js';
import { renderDateRangeCalendar } from './filters/calendar-range-picker.js';
import { triggerUpdateAnimation, updateElementText } from '../utils/dom.js';
import { formatDate, formatDateRange, formatEventName } from '../utils/format.js';
import { formatGroupDisplayLabel, getEventGroupInfo } from '../utils/event-groups.js';
import { buildCrossTabMatrixCsv, downloadCsvFile, sanitizeCsvFilename } from './export-table-csv.js';

const DEFAULT_EVENT_TYPE = 'online';
const MATCHUP_TOP_MODES = new Set(['deck-matchup', 'player-matchup']);
const MATCHUP_STAT_CARD_IDS = [
  'matchupTotalEventsCard',
  'matchupTotalMatchesCard',
  'matchupTrackedDecksCard',
  'matchupMostPlayedDeckCard',
  'matchupMostCommonPairCard',
  'matchupResultsHeroCard',
  'matchupResultsVillainCard'
];

// State below represents the currently rendered matchup window. Matrix exports,
// stat-card drilldowns, and fullscreen tables all read from these snapshots.
let activeQuickViewYear = '';
let matchupGroupSelectionInitialized = false;
let activeMatchupGroupKeys = new Set();
let matchupGroupSelectionContextKey = '';
let currentMatchupSnapshot = null;
let currentMatchupMatrix = null;
let currentResolvedMatchupMatches = [];
let currentMatchupPlayerFocus = null;
let activeMatchupDrilldownCategory = '';
let activeMatchupPlayerFocusKey = '';
let activeMatchupPlayerFocusLabel = '';
let hasAppliedDefaultMatchupPlayerFocus = false;
let matchupAnalyticsRequestId = 0;
let matchupCatalogUiPromise = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pluralize(count, singular, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

function createPlayerSearchEmptyState(message) {
  const emptyState = document.createElement('div');
  emptyState.className = 'player-search-empty';
  emptyState.textContent = message;
  return emptyState;
}

function formatMatchupPercentage(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function normalizeDeckName(value) {
  return String(value || '').trim();
}

function normalizePlayerName(value) {
  return String(value || '').trim();
}

function normalizeMatchupEntityKey(value) {
  return String(value || '').trim().toLowerCase();
}

const MATCHUP_VIEW_CONFIGS = {
  // Deck and player matchup modes share nearly all rendering code. Config objects
  // provide copy and entity accessors so the matrix builder can stay generic.
  'deck-matchup': {
    mode: 'deck-matchup',
    viewTitle: 'Deck Matchup',
    entitySingular: 'deck',
    entityPlural: 'decks',
    entityTitleSingular: 'Deck',
    entityTitlePlural: 'Decks',
    pairingSingular: 'deck pairing',
    primaryTitle: 'Deck vs Deck Matchup Matrix',
    scopeLabel: 'Deck Scope',
    matrixTitleBase: 'Deck Matchup Matrix',
    trackedEntitiesTitle: 'Decks In Range',
    mostSampledTitle: 'Most Sampled Deck',
    resolvedMatchCopy: 'Resolved deck-vs-deck results',
    noEntitySamplesCopy: 'No deck samples',
    noEntitiesAvailableCopy: 'No decks available',
    emptyMatrixSummary: 'Choose an event type and a date window to build the deck matchup matrix.',
    allResolvedSummaryCopy: 'All filtered pairings had resolved deck-vs-deck results.',
    sameEntityPairingsLabel: 'Same-deck pairings',
    sameEntityMetricTitle: 'Mirrors',
    sameEntityCellLabel: 'Mirror',
    listRankingNote: 'Decks are ranked by matchup sample size in the current filters.',
    eventSampleEntityLabel: 'Decks Seen',
    getEntityName(match, side) {
      return side === 'a' ? normalizeDeckName(match?.deck_a) : normalizeDeckName(match?.deck_b);
    },
    getEntityKey(match, side) {
      return side === 'a'
        ? normalizeMatchupEntityKey(match?.deck_a)
        : normalizeMatchupEntityKey(match?.deck_b);
    }
  },
  'player-matchup': {
    mode: 'player-matchup',
    viewTitle: 'Player Matchup',
    entitySingular: 'player',
    entityPlural: 'players',
    entityTitleSingular: 'Player',
    entityTitlePlural: 'Players',
    pairingSingular: 'player pairing',
    primaryTitle: 'Player vs Player Matchup Matrix',
    scopeLabel: 'Player Scope',
    matrixTitleBase: 'Player Matchup Matrix',
    trackedEntitiesTitle: 'Players In Range',
    mostSampledTitle: 'Most Sampled Player',
    resolvedMatchCopy: 'Resolved player-vs-player results',
    noEntitySamplesCopy: 'No player samples',
    noEntitiesAvailableCopy: 'No players available',
    emptyMatrixSummary: 'Choose an event type and a date window to build the player matchup matrix.',
    allResolvedSummaryCopy: 'All filtered pairings had resolved player-vs-player results.',
    sameEntityPairingsLabel: 'Same-player pairings',
    sameEntityMetricTitle: 'Same Player Pairings',
    sameEntityCellLabel: 'Self',
    listRankingNote: 'Players are ranked by matchup sample size in the current filters.',
    eventSampleEntityLabel: 'Players Seen',
    getEntityName(match, side) {
      return side === 'a' ? normalizePlayerName(match?.player_a) : normalizePlayerName(match?.player_b);
    },
    getEntityKey(match, side) {
      return side === 'a'
        ? normalizeMatchupEntityKey(match?.player_a_key || match?.player_a)
        : normalizeMatchupEntityKey(match?.player_b_key || match?.player_b);
    }
  }
};

function getTopMode() {
  return document.querySelector('.top-mode-button.active')?.dataset.topMode || 'event';
}

function isMatchupTopMode(mode = getTopMode()) {
  return MATCHUP_TOP_MODES.has(mode);
}

function isPlayerMatchupMode() {
  return getTopMode() === 'player-matchup';
}

function getActiveMatchupViewConfig() {
  return MATCHUP_VIEW_CONFIGS[getTopMode()] || MATCHUP_VIEW_CONFIGS['deck-matchup'];
}

function getMatchEntityInfo(match, side = 'a') {
  const viewConfig = getActiveMatchupViewConfig();
  const name = viewConfig.getEntityName(match, side);
  const key = viewConfig.getEntityKey(match, side) || normalizeMatchupEntityKey(name);

  return {
    key,
    name
  };
}

function getMatchupDrilldownConfig() {
  const viewConfig = getActiveMatchupViewConfig();
  const isFocusedPlayerMode = isPlayerMatchupMode();
  const hasFocusedPlayer = isFocusedPlayerMode && Boolean(currentMatchupPlayerFocus?.selectedPlayerKey);

  return {
    totalEvents: {
      cardId: 'matchupTotalEventsCard',
      title: 'Selected Events',
      emptyMessage: `No events are available for the current ${viewConfig.viewTitle} filters.`
    },
    trackedDecks: {
      cardId: 'matchupTrackedDecksCard',
      title: hasFocusedPlayer ? 'Opponents In Range' : `Tracked ${viewConfig.entityTitlePlural}`,
      emptyMessage: hasFocusedPlayer
        ? 'No opponents are available for the current Player Matchup filters.'
        : `No ${viewConfig.entityPlural} are available for the current ${viewConfig.viewTitle} filters.`
    },
    mostPlayedDeck: {
      cardId: 'matchupMostPlayedDeckCard',
      title: isFocusedPlayerMode ? 'Focus Player' : `Most Sampled ${viewConfig.entityTitleSingular}`,
      emptyMessage: isFocusedPlayerMode
        ? hasFocusedPlayer
          ? 'No focused matchup summary is available for the current Player Matchup filters.'
          : 'Search for a player to inspect the focused matchup summary.'
        : `No ${viewConfig.entitySingular} samples are available for the current ${viewConfig.viewTitle} filters.`
    },
    mostCommonPair: {
      cardId: 'matchupMostCommonPairCard',
      title: 'Most Common Pairing',
      emptyMessage: `No ${viewConfig.entitySingular}-vs-${viewConfig.entitySingular} pairings are available for the current ${viewConfig.viewTitle} filters.`
    },
    leastCommonPair: {
      cardId: 'matchupResultsHeroCard',
      title: isFocusedPlayerMode ? 'HERO' : 'Least Common Pairing',
      emptyMessage: isFocusedPlayerMode
        ? hasFocusedPlayer
          ? 'No deck-vs-deck pairings are available for the focused player in the current Player Matchup filters.'
          : 'Search for a player to inspect their hero matchup.'
        : `No ${viewConfig.entitySingular}-vs-${viewConfig.entitySingular} pairings are available for the current ${viewConfig.viewTitle} filters.`
    },
    bestWinRate: {
      cardId: 'matchupResultsVillainCard',
      title: isFocusedPlayerMode ? 'VILLAIN' : 'Best Win Rate',
      emptyMessage: isFocusedPlayerMode
        ? hasFocusedPlayer
          ? 'No decisive deck-vs-deck pairings are available for the focused player in the current Player Matchup filters.'
          : 'Search for a player to inspect their villain matchup.'
        : `No decisive ${viewConfig.entitySingular} samples are available for the current ${viewConfig.viewTitle} filters.`
    }
  };
}

function renderMatchupLoadingState(message = 'Loading matchup archive...') {
  updateElementText('matchupMatrixSummary', message);
  updateElementText('matchupTableTitle', 'Matchup Matrix');
  updateElementText('matchupTableHelper', message);
  updateElementText('matchupTotalEvents', '--');
  updateElementText('matchupTotalMatches', '--');
  updateElementText('matchupTrackedDecks', '--');
  updateElementText('matchupMostPlayedDeck', '--');
  updateElementText('matchupMostCommonPair', '--');
  updateElementText('matchupResultsHero', '--');
  updateElementText('matchupResultsVillain', '--');
  const tableHead = document.getElementById('matchupMatrixTableHead');
  const tableBody = document.getElementById('matchupMatrixTableBody');

  if (tableHead) {
    tableHead.innerHTML = `
      <tr>
        <th class="matchup-axis-corner">Matchup</th>
        <th>Loading</th>
      </tr>
    `;
  }

  if (tableBody) {
    tableBody.innerHTML = "<tr><td colspan='2'>Loading matchup data...</td></tr>";
  }
}

function renderMatchupErrorState(message = 'Unable to load matchup data.') {
  updateElementText('matchupMatrixSummary', message);
  updateElementText('matchupTableHelper', message);
  updateElementText('matchupTotalEvents', '--');
  updateElementText('matchupTotalMatches', '--');
  updateElementText('matchupTrackedDecks', '--');
  updateElementText('matchupMostPlayedDeck', '--');
  updateElementText('matchupMostCommonPair', '--');
  updateElementText('matchupResultsHero', '--');
  updateElementText('matchupResultsVillain', '--');
  const tableHead = document.getElementById('matchupMatrixTableHead');
  const tableBody = document.getElementById('matchupMatrixTableBody');

  if (tableHead) {
    tableHead.innerHTML = `
      <tr>
        <th class="matchup-axis-corner">Matchup</th>
        <th>Error</th>
      </tr>
    `;
  }

  if (tableBody) {
    tableBody.innerHTML = `<tr><td colspan='2'>${escapeHtml(message)}</td></tr>`;
  }
}

async function ensureMatchupCatalogUiReady() {
  if (!matchupCatalogUiPromise) {
    // Single-flight UI initialization: if multiple top-mode changes happen while
    // the catalog is loading, every caller awaits the same setup promise.
    matchupCatalogUiPromise = ensureMatchupCatalogLoaded()
      .then(() => {
        const quickViewRows = getMatchupQuickViewRows();
        updateMatchupViewCopy();
        activeQuickViewYear = getDefaultQuickViewYear(quickViewRows);
        setMatchupEventType(DEFAULT_EVENT_TYPE);
        renderQuickViewButtons();
        setMatchupPresetButtonState(getLatestSetQuickViewPresetId(quickViewRows));
        ensureDefaultMatchupPreset();
        updateMatchupDateOptions();
        applyActiveMatchupPresetDateRange();
      })
      .catch(error => {
        matchupCatalogUiPromise = null;
        throw error;
      });
  }

  return matchupCatalogUiPromise;
}

function getMatchupSection() {
  return document.getElementById('matchupSection');
}

function getMatchupQuickViewRoot() {
  return document.getElementById('matchupQuickViewButtons');
}

function getMatchupSelectionElements() {
  return {
    panels: document.getElementById('matchupSelectionPanels'),
    summary: document.getElementById('matchupSelectionSummary'),
    summaryContent: document.getElementById('matchupSelectionSummaryContent'),
    listBox: document.getElementById('matchupSelectionListBox'),
    list: document.getElementById('matchupSelectionList')
  };
}

function getMatchupDrilldownElements() {
  return {
    overlay: document.getElementById('matchupStatDrilldownOverlay'),
    title: document.getElementById('matchupStatDrilldownTitle'),
    subtitle: document.getElementById('matchupStatDrilldownSubtitle'),
    content: document.getElementById('matchupStatDrilldownContent'),
    closeButton: document.getElementById('matchupStatDrilldownClose')
  };
}

function getMatchupEventTypeButtons() {
  return Array.from(getMatchupSection()?.querySelectorAll('.matchup-event-type-filter') || []);
}

function getSelectedMatchupEventTypes() {
  return getMatchupEventTypeButtons()
    .filter(button => button.classList.contains('active'))
    .map(button => String(button.dataset.type || '').toLowerCase())
    .filter(Boolean);
}

function setMatchupEventType(nextType = DEFAULT_EVENT_TYPE) {
  const normalizedType = String(nextType || '').toLowerCase();
  const buttons = getMatchupEventTypeButtons();
  const fallbackType =
    buttons.find(button => String(button.dataset.type || '').toLowerCase() === DEFAULT_EVENT_TYPE)?.dataset.type?.toLowerCase()
    || buttons[0]?.dataset.type?.toLowerCase()
    || '';
  const resolvedType = buttons.some(button => String(button.dataset.type || '').toLowerCase() === normalizedType)
    ? normalizedType
    : fallbackType;

  buttons.forEach(button => {
    button.classList.toggle('active', String(button.dataset.type || '').toLowerCase() === resolvedType);
  });
}

function getMatchupStartDateSelect() {
  return document.getElementById('matchupStartDateSelect');
}

function getMatchupEndDateSelect() {
  return document.getElementById('matchupEndDateSelect');
}

function getMatchupPlayerFocusElements() {
  return {
    playerSection: document.getElementById('matchupPlayerFocusSection'),
    playerSelect: document.getElementById('matchupPlayerFocusSelect'),
    playerStatus: document.getElementById('matchupPlayerFocusStatus'),
    matrixToolbar: document.getElementById('matchupMatrixToolbar')
  };
}

function getMatchupPlayerTableElements() {
  return {
    primaryContainer: document.getElementById('matchupPrimaryTableContainer'),
    primaryTitle: document.getElementById('matchupTableTitle'),
    primaryHelper: document.getElementById('matchupTableHelper'),
    primaryHead: document.getElementById('matchupMatrixTableHead'),
    primaryBody: document.getElementById('matchupMatrixTableBody'),
    primaryFullscreenButton: document.getElementById('matchupPrimaryFullscreenButton'),
    secondaryContainer: document.getElementById('matchupSecondaryTableContainer'),
    secondaryTitle: document.getElementById('matchupSecondaryTableTitle'),
    secondaryHelper: document.getElementById('matchupSecondaryTableHelper'),
    secondaryHead: document.getElementById('matchupSecondaryMatrixTableHead'),
    secondaryBody: document.getElementById('matchupSecondaryMatrixTableBody'),
    secondaryFullscreenButton: document.getElementById('matchupSecondaryFullscreenButton')
  };
}

function updateMatchupFullscreenButtonState() {
  // Both primary and secondary matrix tables can enter fullscreen. The button
  // text follows whichever table currently owns document.fullscreenElement.
  const tableElements = getMatchupPlayerTableElements();
  const buttonPairs = [
    { button: tableElements.primaryFullscreenButton, container: tableElements.primaryContainer },
    { button: tableElements.secondaryFullscreenButton, container: tableElements.secondaryContainer }
  ];

  buttonPairs.forEach(({ button, container }) => {
    if (!button || !container) {
      return;
    }

    button.textContent = document.fullscreenElement === container ? 'Exit Full Screen' : 'Full Screen';
  });
}

async function toggleMatchupTableFullscreen(container) {
  if (!container) {
    return;
  }

  if (document.fullscreenElement === container) {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
    }
    return;
  }

  if (container.requestFullscreen) {
    await container.requestFullscreen();
  }
}

function setupMatchupFullscreenListeners() {
  const tableElements = getMatchupPlayerTableElements();
  const buttonPairs = [
    { button: tableElements.primaryFullscreenButton, container: tableElements.primaryContainer },
    { button: tableElements.secondaryFullscreenButton, container: tableElements.secondaryContainer }
  ];

  buttonPairs.forEach(({ button, container }) => {
    if (!button || !container || button.dataset.listenerAdded === 'true') {
      return;
    }

    button.addEventListener('click', () => {
      toggleMatchupTableFullscreen(container).catch(error => {
        console.error('Failed to toggle matchup fullscreen mode.', error);
      });
    });
    button.dataset.listenerAdded = 'true';
  });

  if (document.body.dataset.matchupFullscreenBound !== 'true') {
    document.addEventListener('fullscreenchange', updateMatchupFullscreenButtonState);
    document.body.dataset.matchupFullscreenBound = 'true';
  }

  updateMatchupFullscreenButtonState();
}

function getMatchupPlayerKey(match, side = 'a') {
  return normalizeMatchupEntityKey(
    side === 'a'
      ? match?.player_a_key || match?.player_a
      : match?.player_b_key || match?.player_b
  );
}

function getMatchupPlayerName(match, side = 'a') {
  return normalizePlayerName(side === 'a' ? match?.player_a : match?.player_b);
}

function getMatchupPlayerDeck(match, playerKey = '') {
  const normalizedPlayerKey = normalizeMatchupEntityKey(playerKey);
  if (!normalizedPlayerKey) {
    return '';
  }

  if (getMatchupPlayerKey(match, 'a') === normalizedPlayerKey) {
    return normalizeDeckName(match?.deck_a);
  }

  if (getMatchupPlayerKey(match, 'b') === normalizedPlayerKey) {
    return normalizeDeckName(match?.deck_b);
  }

  return '';
}

function matchIncludesPlayer(match, playerKey = '') {
  const normalizedPlayerKey = normalizeMatchupEntityKey(playerKey);
  if (!normalizedPlayerKey) {
    return false;
  }

  return getMatchupPlayerKey(match, 'a') === normalizedPlayerKey || getMatchupPlayerKey(match, 'b') === normalizedPlayerKey;
}

function buildMatchupPlayerOptions(matches = []) {
  // Player focus search options need both label quality and sample counts, so
  // collect every side of every match before sorting.
  const playerMap = new Map();

  (matches || []).forEach(match => {
    ['a', 'b'].forEach(side => {
      const playerKey = getMatchupPlayerKey(match, side);
      const playerName = getMatchupPlayerName(match, side);
      const eventId = String(match?.event_id || '').trim();

      if (!playerKey || !playerName) {
        return;
      }

      if (!playerMap.has(playerKey)) {
        playerMap.set(playerKey, {
          key: playerKey,
          label: playerName,
          matches: 0,
          eventIds: new Set()
        });
      }

      const playerSummary = playerMap.get(playerKey);
      playerSummary.matches += 1;
      if (eventId) {
        playerSummary.eventIds.add(eventId);
      }
    });
  });

  return Array.from(playerMap.values()).sort((left, right) => {
    return (
      right.matches - left.matches ||
      right.eventIds.size - left.eventIds.size ||
      left.label.localeCompare(right.label)
    );
  });
}

function populateMatchupPlayerFocusSelect(playerOptions = []) {
  const { playerSelect } = getMatchupPlayerFocusElements();
  if (!playerSelect) {
    return;
  }

  const activePlayerSet = new Set(playerOptions.map(option => option.key));
  if (!activePlayerSet.has(activeMatchupPlayerFocusKey)) {
    activeMatchupPlayerFocusKey = '';
    activeMatchupPlayerFocusLabel = '';
  } else {
    activeMatchupPlayerFocusLabel = playerOptions.find(option => option.key === activeMatchupPlayerFocusKey)?.label || activeMatchupPlayerFocusLabel;
  }

  playerSelect.innerHTML = '';

  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = playerOptions.length > 0 ? 'Search for a player' : 'No players available';
  playerSelect.appendChild(placeholderOption);

  playerOptions.forEach(option => {
    const optionElement = document.createElement('option');
    optionElement.value = option.key;
    optionElement.textContent = option.label;
    optionElement.selected = option.key === activeMatchupPlayerFocusKey;
    playerSelect.appendChild(optionElement);
  });

  playerSelect.value = activeMatchupPlayerFocusKey;
}

async function ensureDefaultMatchupPlayerFocus(resolvedMatches = []) {
  if (!isPlayerMatchupMode() || activeMatchupPlayerFocusKey || hasAppliedDefaultMatchupPlayerFocus) {
    return;
  }

  const playerOptions = buildMatchupPlayerOptions(resolvedMatches);
  if (playerOptions.length === 0) {
    return;
  }

  try {
    const availableDates = getRankingsAvailableDates([DEFAULT_EVENT_TYPE]);
    const defaultRange = getDefaultRankingsRange(availableDates);
    if (!defaultRange.startDate || !defaultRange.endDate) {
      return;
    }

    const rankingsDataset = await buildRankingsDataset({
      eventTypes: [DEFAULT_EVENT_TYPE],
      startDate: defaultRange.startDate,
      endDate: defaultRange.endDate
    }, {
      resetByYear: true
    });
    const defaultLeaderKey = String(
      rankingsDataset?.summary?.leader?.playerKey
      || rankingsDataset?.seasonRows?.[0]?.playerKey
      || ''
    ).trim();

    if (!defaultLeaderKey) {
      return;
    }

    const defaultPlayerOption = playerOptions.find(option => option.key === defaultLeaderKey) || null;
    if (!defaultPlayerOption) {
      return;
    }

    activeMatchupPlayerFocusKey = defaultPlayerOption.key;
    activeMatchupPlayerFocusLabel = defaultPlayerOption.label;
    hasAppliedDefaultMatchupPlayerFocus = true;
  } catch (error) {
    console.error('Failed to resolve the default Player Matchup focus.', error);
  }
}

function initMatchupPlayerSearchDropdown() {
  const { playerSelect } = getMatchupPlayerFocusElements();
  if (!playerSelect || playerSelect.dataset.searchEnhanced === 'true') {
    return;
  }

  playerSelect.dataset.searchEnhanced = 'true';
  playerSelect.classList.add('player-filter-select-hidden');
  playerSelect.tabIndex = -1;
  playerSelect.setAttribute('aria-hidden', 'true');

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
  dropdown.id = 'matchupPlayerFocusDropdown';
  dropdown.className = 'player-search-dropdown';
  dropdown.setAttribute('role', 'listbox');

  searchInput.setAttribute('aria-controls', dropdown.id);

  searchSelect.appendChild(searchInput);
  searchSelect.appendChild(dropdown);
  playerSelect.insertAdjacentElement('afterend', searchSelect);

  let filteredOptions = [];
  let activeIndex = -1;

  const getSelectableOptions = () =>
    Array.from(playerSelect.options)
      .filter(option => option.value && !option.disabled)
      .map(option => ({
        label: option.textContent || option.value,
        value: option.value
      }));

  const getSelectedLabel = () => {
    const selectedOption = playerSelect.selectedOptions[0];
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

  const syncInputFromSelect = (options = {}) => {
    const { preserveTypedValue = false } = options;
    const selectableOptions = getSelectableOptions();
    const selectedLabel = getSelectedLabel();
    const emptyMessage = playerSelect.options.length > 0
      ? playerSelect.options[0].textContent || 'No Players Available'
      : 'No Players Available';

    if (selectableOptions.length === 0) {
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

    if (!preserveTypedValue) {
      searchInput.value = selectedLabel;
    }

    if (dropdown.classList.contains('open')) {
      renderOptions(searchInput.value.trim().toLowerCase());
    }
  };

  const selectOption = option => {
    if (!option) {
      return;
    }

    const didChange = playerSelect.value !== option.value;
    playerSelect.value = option.value;
    searchInput.value = option.label;
    activeIndex = -1;
    setDropdownOpen(false);

    if (didChange) {
      playerSelect.dispatchEvent(new Event('change', { bubbles: true }));
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

    const selectedIndex = filteredOptions.findIndex(option => option.value === playerSelect.value);
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

    renderOptions(searchInput.value);
    searchInput.select();
  });

  searchInput.addEventListener('click', () => {
    if (searchInput.disabled) {
      return;
    }

    renderOptions(searchInput.value);
  });

  searchInput.addEventListener('input', event => {
    activeIndex = -1;
    if (playerSelect.value) {
      playerSelect.value = '';
    }
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
      if (dropdown.classList.contains('open') && activeIndex >= 0 && filteredOptions[activeIndex]) {
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

  playerSelect.addEventListener('change', () => {
    syncInputFromSelect();
  });

  const observer = new MutationObserver(() => {
    activeIndex = -1;
    syncInputFromSelect({ preserveTypedValue: dropdown.classList.contains('open') });
  });

  observer.observe(playerSelect, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled']
  });

  syncInputFromSelect();
}

function buildPlayerMatchupFocusState(snapshot, resolvedMatches = []) {
  // Builds the focused-player model used by Player Matchup mode, including
  // opponent and deck-pair summaries from the selected player's perspective.
  const { playerStatus } = getMatchupPlayerFocusElements();
  const playerOptions = buildMatchupPlayerOptions(resolvedMatches);
  populateMatchupPlayerFocusSelect(playerOptions);

  const selectedPlayerOption = playerOptions.find(option => option.key === activeMatchupPlayerFocusKey) || null;
  const matchesForPlayer = selectedPlayerOption
    ? resolvedMatches.filter(match => matchIncludesPlayer(match, selectedPlayerOption.key))
    : [];
  const contributingEventIds = new Set(
    matchesForPlayer
      .map(match => String(match?.event_id || '').trim())
      .filter(Boolean)
  );

  if (playerStatus) {
    if (playerOptions.length === 0) {
      playerStatus.textContent = 'No player matchup results are available for this event range.';
    } else if (!selectedPlayerOption) {
      playerStatus.textContent = `Search ${playerOptions.length} available ${pluralize(playerOptions.length, 'player')} to inspect matchup results.`;
    } else {
      const playedDeckCount = new Set(
        matchesForPlayer
          .map(match => getMatchupPlayerDeck(match, selectedPlayerOption.key))
          .filter(Boolean)
      ).size;
      playerStatus.textContent = `${selectedPlayerOption.label}: ${matchesForPlayer.length} ${pluralize(matchesForPlayer.length, 'match')} across ${contributingEventIds.size || selectedPlayerOption.eventIds.size} ${pluralize(contributingEventIds.size || selectedPlayerOption.eventIds.size, 'event')} with ${playedDeckCount} ${pluralize(playedDeckCount, 'deck')} played.`;
    }
  }

  return {
    selectedPlayerKey: selectedPlayerOption?.key || '',
    selectedPlayerLabel: selectedPlayerOption?.label || '',
    playerOptions,
    matchesForPlayer,
    filteredMatches: matchesForPlayer,
    contributingEventIds
  };
}

function setMatchupCardTitle(cardId, title) {
  const titleElement = document.querySelector(`#${cardId} .stat-title`);
  if (titleElement) {
    titleElement.textContent = title;
  }
}

function setMatchupCardIcon(cardId, icon) {
  const iconElement = document.querySelector(`#${cardId} .stat-icon`);
  if (iconElement) {
    iconElement.textContent = icon;
  }
}

function cleanupStaticMatchupCard(cardId) {
  const card = document.getElementById(cardId);
  if (!card) {
    return;
  }

  card.classList.remove('drilldown-card', 'drilldown-disabled');
  card.removeAttribute('role');
  card.removeAttribute('aria-disabled');
  card.removeAttribute('tabindex');
  card.removeAttribute('title');
}

function formatMatchupToneLabel(tone) {
  switch (tone) {
    case 'above-average':
      return 'Above Average';
    case 'below-average':
      return 'Below Average';
    default:
      return 'Mixed';
  }
}

function buildMatchupPerformanceBandBadge(tone) {
  return `<span class="player-drilldown-event-list-tone player-drilldown-event-list-tone-${tone}">${escapeHtml(formatMatchupToneLabel(tone))}</span>`;
}

function updateMatchupViewCopy() {
  const viewConfig = getActiveMatchupViewConfig();
  const { playerSection, matrixToolbar } = getMatchupPlayerFocusElements();
  const { secondaryContainer } = getMatchupPlayerTableElements();
  const isPlayerMode = isPlayerMatchupMode();
  const hasFocusedPlayer = Boolean(currentMatchupPlayerFocus?.selectedPlayerKey);
  const focusedPlayerLabel = currentMatchupPlayerFocus?.selectedPlayerLabel || 'Player';

  if (playerSection) {
    playerSection.style.display = isPlayerMode ? 'block' : 'none';
  }

  if (matrixToolbar) {
    matrixToolbar.style.display = 'none';
  }

  if (secondaryContainer) {
    secondaryContainer.style.display = isPlayerMode ? 'block' : 'none';
  }

  updateElementText(
    'matchupTrackedEntitiesLabel',
    isPlayerMode && hasFocusedPlayer ? 'Opponents In Range' : viewConfig.trackedEntitiesTitle
  );
  updateElementText(
    'matchupMostSampledEntityLabel',
    isPlayerMode ? 'Focus Player' : viewConfig.mostSampledTitle
  );
  updateElementText(
    'matchupPrimaryTitle',
    isPlayerMode
      ? 'Player Matchup Explorer'
      : viewConfig.primaryTitle
  );
  updateElementText('matchupTableTitle', viewConfig.matrixTitleBase);
  updateElementText(
    'matchupTableHelper',
    isPlayerMode
      ? hasFocusedPlayer
        ? `Each row is one deck played by ${focusedPlayerLabel}, and each column is an opponent.`
        : 'Search for a player to populate the matchup table.'
      : `Each cell shows the row ${viewConfig.entitySingular}'s match win rate against the column ${viewConfig.entitySingular}. Diagonal cells count same-${viewConfig.entitySingular} pairings.`
  );
  updateElementText(
    'matchupMatrixSummary',
    isPlayerMode
      ? 'Search for a player to see two tables: one for each deck they played versus opponents, and another for each deck they played versus opposing decks.'
      : viewConfig.emptyMatrixSummary
  );
  updateElementText('matchupTotalMatchesDetails', viewConfig.resolvedMatchCopy);
  updateElementText('matchupTrackedDecksDetails', viewConfig.noEntitiesAvailableCopy);
  updateElementText('matchupMostPlayedDeckDetails', isPlayerMode ? 'Search for a player' : viewConfig.noEntitySamplesCopy);
  updateElementText('matchupMostCommonPairDetails', isPlayerMode ? 'Search for a player' : 'No sampled pairings');
  updateElementText('matchupResultsHeroDetails', isPlayerMode ? 'Search for a player' : 'No sampled pairings');
  updateElementText('matchupResultsVillainDetails', isPlayerMode ? 'Search for a player' : viewConfig.noEntitySamplesCopy);

  setMatchupCardTitle('matchupTotalEventsCard', 'Total Events');
  setMatchupCardTitle('matchupTotalMatchesCard', 'Resolved Matches');
  setMatchupCardTitle('matchupTrackedDecksCard', isPlayerMode && hasFocusedPlayer ? 'Opponents In Range' : viewConfig.trackedEntitiesTitle);
  setMatchupCardTitle('matchupMostPlayedDeckCard', isPlayerMode ? 'Focus Player' : viewConfig.mostSampledTitle);
  setMatchupCardTitle('matchupMostCommonPairCard', 'Most Common Pairing');
  setMatchupCardTitle('matchupResultsHeroCard', isPlayerMode ? 'HERO' : 'Least Common Pairing');
  setMatchupCardTitle('matchupResultsVillainCard', isPlayerMode ? 'VILLAIN' : 'Best Win Rate');
  setMatchupCardIcon('matchupResultsHeroCard', isPlayerMode ? '🦸' : '🪶');
  setMatchupCardIcon('matchupResultsVillainCard', isPlayerMode ? '🦹' : '🥇');
  updateMatchupExportButtons();
}

function shouldIncludeMatchupEvent(eventName = '') {
  return !(
    isUnknownHeavyBelowTop32FilterEnabled()
    && getUnknownHeavyBelowTop32ExcludedEventNames().has(String(eventName || '').trim())
  );
}

function getQualityFilteredMatchupEvents() {
  return getMatchupEvents().filter(event => shouldIncludeMatchupEvent(event.event));
}

function getMatchupQuickViewRows() {
  return getQualityFilteredMatchupEvents().map(event => ({
    Date: String(event.date || '').trim(),
    EventType: String(event.event_type || '').trim().toLowerCase()
  }));
}

function getActiveMatchupPreset() {
  const activePresetValue = getMatchupQuickViewRoot()?.dataset.activePreset || '';
  if (activePresetValue) {
    return activePresetValue;
  }

  return Array.from(document.querySelectorAll('.matchup-preset-button.active'))
    .map(button => button.dataset.matchupPreset)
    .filter(Boolean)
    .join(',');
}

function getActiveMatchupPresetIds() {
  return normalizeQuickViewPresetIds(getActiveMatchupPreset());
}

function getResolvedQuickViewYear(activePresetIds = []) {
  const quickViewRows = getMatchupQuickViewRows();
  const yearOptions = getQuickViewPresetYearOptions(quickViewRows);
  if (yearOptions.length === 0) {
    return '';
  }

  const activePreset = activePresetIds
    .map(presetId => getQuickViewPresetDefinitionById(presetId, quickViewRows, { includeFuture: true }))
    .find(Boolean);
  const presetYear = activePreset?.releaseYear || '';
  const currentYear = activeQuickViewYear || getDefaultQuickViewYear(quickViewRows);

  if (currentYear && yearOptions.includes(currentYear)) {
    return currentYear;
  }

  if (presetYear && yearOptions.includes(presetYear)) {
    return presetYear;
  }

  return yearOptions[0] || '';
}

function createQuickViewButton(preset) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bubble-button matchup-preset-button';
  button.dataset.matchupPreset = preset.id;
  button.textContent = preset.buttonLabel || preset.label;

  if (preset.kind === 'set-window') {
    const displayEndDate = preset.nextReleaseDate ? shiftDateByDays(preset.nextReleaseDate, -1) : 'Present';
    button.title = `${preset.label}: ${preset.releaseDate} to ${displayEndDate}`;
  } else if (preset.kind === 'calendar-year') {
    button.title = `${preset.label}: ${preset.startDate} to ${preset.endDate}`;
  } else {
    button.title = preset.label;
  }

  return button;
}

function createQuickViewYearButton(year, isActive) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `bubble-button quick-view-year-button${isActive ? ' active' : ''}`;
  button.dataset.quickViewYear = year;
  button.textContent = year;
  return button;
}

function renderQuickViewButtons() {
  const container = getMatchupQuickViewRoot();
  if (!container) {
    return;
  }

  container.innerHTML = '';
  const quickViewRows = getMatchupQuickViewRows();
  const activePresetIds = getActiveMatchupPresetIds();
  const activePresets = activePresetIds
    .map(presetId => getQuickViewPresetDefinitionById(presetId, quickViewRows, { includeFuture: true }))
    .filter(Boolean);
  const staticPresets = getStaticQuickViewPresetDefinitions();
  const setPresetDefinitions = getSetQuickViewPresetDefinitions(quickViewRows);
  const yearOptions = getQuickViewPresetYearOptions(quickViewRows);
  const resolvedYear = getResolvedQuickViewYear(activePresetIds);
  const yearPresets = setPresetDefinitions.filter(preset => preset.releaseYear === resolvedYear);
  const hasAllPeriodPreset = activePresets.some(preset => preset.kind === 'static');
  const activeCalendarYearPresets = activePresets.filter(preset => preset.kind === 'calendar-year');
  const activeSetWindowPresets = activePresets.filter(preset => preset.kind === 'set-window');
  const highlightedYears = new Set();
  const highlightedSetWindowIds = new Set();

  if (!hasAllPeriodPreset) {
    if (activeCalendarYearPresets.length > 0) {
      activeCalendarYearPresets.forEach(preset => {
        if (preset.releaseYear) {
          highlightedYears.add(preset.releaseYear);
          setPresetDefinitions.forEach(setPreset => {
            if (setPreset.releaseYear === preset.releaseYear) {
              highlightedSetWindowIds.add(setPreset.id);
            }
          });
        }
      });
    } else {
      activeSetWindowPresets.forEach(preset => {
        if (preset.releaseYear) {
          highlightedYears.add(preset.releaseYear);
        }
        highlightedSetWindowIds.add(preset.id);
      });
    }
  }

  activeQuickViewYear = resolvedYear;
  container.dataset.activePreset = activePresetIds.join(',');

  if (staticPresets.length > 0) {
    const staticRow = document.createElement('div');
    staticRow.className = 'bubble-menu quick-view-static-list';

    staticPresets.forEach(preset => {
      const button = createQuickViewButton(preset);
      button.classList.toggle('active', activePresetIds.includes(preset.id));
      staticRow.appendChild(button);
    });

    container.appendChild(staticRow);
  }

  if (yearOptions.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'quick-view-divider';
    divider.innerHTML = `
      <span class="quick-view-divider-line"></span>
      <span class="quick-view-divider-label">Specific Sets</span>
      <span class="quick-view-divider-line"></span>
    `;
    container.appendChild(divider);

    const setHelper = document.createElement('div');
    setHelper.className = 'quick-view-set-helper';
    setHelper.textContent = 'Choose a set year, then select one or more set windows.';
    container.appendChild(setHelper);

    const yearSection = document.createElement('div');
    yearSection.className = 'quick-view-year-section';

    const yearLabel = document.createElement('div');
    yearLabel.className = 'event-calendar-summary-label';
    yearLabel.textContent = 'Choose Set Year';
    yearSection.appendChild(yearLabel);

    const yearRow = document.createElement('div');
    yearRow.className = 'bubble-menu quick-view-year-list';
    yearOptions.forEach(year => {
      yearRow.appendChild(createQuickViewYearButton(year, highlightedYears.has(year)));
    });

    yearSection.appendChild(yearRow);
    container.appendChild(yearSection);
  }

  const setSection = document.createElement('div');
  setSection.className = 'quick-view-set-section';

  if (resolvedYear) {
    const setLabel = document.createElement('div');
    setLabel.className = 'event-calendar-summary-label';
    setLabel.textContent = `${resolvedYear} Set Windows`;
    setSection.appendChild(setLabel);
  }

  const setRow = document.createElement('div');
  setRow.className = 'bubble-menu quick-view-set-list';

  yearPresets.forEach(preset => {
    const button = createQuickViewButton(preset);
    button.classList.toggle('active', highlightedSetWindowIds.has(preset.id));
    setRow.appendChild(button);
  });

  if (yearPresets.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'quick-view-empty';
    emptyState.textContent = 'No set windows available.';
    setRow.appendChild(emptyState);
  }

  setSection.appendChild(setRow);
  container.appendChild(setSection);
}

function setMatchupPresetButtonState(activePresetId = '') {
  const root = getMatchupQuickViewRoot();
  const quickViewRows = getMatchupQuickViewRows();
  const activePresetIds = normalizeQuickViewPresetIds(activePresetId);
  const serializedPresetIds = activePresetIds.join(',');

  if (root) {
    root.dataset.activePreset = serializedPresetIds;
  }

  const preset = activePresetIds
    .map(presetId => getQuickViewPresetDefinitionById(presetId, quickViewRows, { includeFuture: true }))
    .find(candidate => candidate?.releaseYear);
  if (preset?.releaseYear) {
    activeQuickViewYear = preset.releaseYear;
  }

  renderQuickViewButtons();
}

function clearMatchupPresetButtonState() {
  setMatchupPresetButtonState('');
}

function ensureDefaultMatchupPreset() {
  const activePresetId = getActiveMatchupPreset();
  if (activePresetId) {
    return activePresetId;
  }

  const defaultPresetId = getLatestSetQuickViewPresetId(getMatchupQuickViewRows());
  setMatchupPresetButtonState(defaultPresetId);
  return defaultPresetId;
}

function resolvePresetEventTypeSelection(currentTypes = [], presetEventTypes = [], defaultType = DEFAULT_EVENT_TYPE) {
  const normalizedCurrentType = currentTypes.map(type => String(type || '').toLowerCase()).find(Boolean) || '';
  const normalizedPresetTypes = (Array.isArray(presetEventTypes) ? presetEventTypes : [presetEventTypes])
    .map(type => String(type || '').toLowerCase())
    .filter(Boolean);

  if (normalizedPresetTypes.length === 0) {
    return normalizedCurrentType || defaultType;
  }

  if (normalizedCurrentType && normalizedPresetTypes.includes(normalizedCurrentType)) {
    return normalizedCurrentType;
  }

  return normalizedPresetTypes[0] || defaultType;
}

function getPresetScopedMatchupEvents(selectedEventTypes = getSelectedMatchupEventTypes()) {
  return filterMatchupRecords(getQualityFilteredMatchupEvents(), {
    eventTypes: selectedEventTypes,
    quickViewPresetId: getActiveMatchupPreset()
  });
}

function applyActiveMatchupPresetDateRange() {
  const activePreset = getActiveMatchupPreset();
  const startDateSelect = getMatchupStartDateSelect();
  const endDateSelect = getMatchupEndDateSelect();

  if (!activePreset || !startDateSelect || !endDateSelect) {
    return false;
  }

  const range = getQuickViewPresetSuggestedRange({
    selectedEventTypes: getSelectedMatchupEventTypes(),
    presetId: activePreset,
    rows: getMatchupQuickViewRows()
  });

  if (!range.startDate || !range.endDate) {
    startDateSelect.value = '';
    endDateSelect.value = '';
    updateMatchupDateOptions();
    return false;
  }

  startDateSelect.value = range.startDate;
  endDateSelect.value = range.endDate;
  updateMatchupDateOptions();
  return true;
}

function applyMatchupPreset(presetId) {
  const quickViewRows = getMatchupQuickViewRows();
  const preset = getQuickViewPresetDefinitionById(presetId, quickViewRows, { includeFuture: true });
  const presetEventTypes = getQuickViewPresetEventTypes(presetId, quickViewRows);

  if (presetEventTypes) {
    const nextType = resolvePresetEventTypeSelection(getSelectedMatchupEventTypes(), presetEventTypes);
    setMatchupEventType(nextType);
  }

  if (!preset) {
    return;
  }

  const fallbackPresetId = getStaticQuickViewPresetDefinitions()[0]?.id || '';
  let nextPresetIds = [];

  if (preset.kind !== 'set-window') {
    nextPresetIds = [preset.id];
  } else {
    const activeSetWindowIds = getActiveMatchupPresetIds().filter(activePresetId => {
      const activePreset = getQuickViewPresetDefinitionById(activePresetId, quickViewRows, { includeFuture: true });
      return activePreset?.kind === 'set-window' && activePreset.releaseYear === preset.releaseYear;
    });
    const nextPresetIdSet = new Set(activeSetWindowIds);

    if (nextPresetIdSet.has(preset.id)) {
      nextPresetIdSet.delete(preset.id);
    } else {
      nextPresetIdSet.add(preset.id);
    }

    nextPresetIds = Array.from(nextPresetIdSet);
    if (nextPresetIds.length === 0 && fallbackPresetId) {
      nextPresetIds = [fallbackPresetId];
    }
  }

  setMatchupPresetButtonState(nextPresetIds);
  resetMatchupDateRange();
  updateMatchupDateOptions();
  applyActiveMatchupPresetDateRange();

  if (isMatchupTopMode()) {
    updateMatchupAnalytics();
  }
}

function setQuickViewYearSelection(year) {
  activeQuickViewYear = year;
  renderQuickViewButtons();
}

function syncMatchupGroupDataset() {
  const panels = document.getElementById('matchupSelectionPanels');
  if (!panels) {
    return;
  }

  panels.dataset.groupFilterInitialized = matchupGroupSelectionInitialized ? 'true' : 'false';
  panels.dataset.activeGroupKeys = Array.from(activeMatchupGroupKeys).join(',');
}

function resetMatchupGroupFilterState() {
  matchupGroupSelectionInitialized = false;
  activeMatchupGroupKeys = new Set();
  matchupGroupSelectionContextKey = '';
  syncMatchupGroupDataset();
}

function resetMatchupDateRange() {
  const startDateSelect = getMatchupStartDateSelect();
  const endDateSelect = getMatchupEndDateSelect();

  if (startDateSelect) {
    startDateSelect.value = '';
  }

  if (endDateSelect) {
    endDateSelect.value = '';
  }

  resetMatchupGroupFilterState();
}

function getDefaultMatchupRange(dates = []) {
  if (dates.length === 0) {
    return { startDate: '', endDate: '' };
  }

  return {
    startDate: dates[0],
    endDate: dates[dates.length - 1]
  };
}

function buildMatchupSelectionListHTML(entries = []) {
  if (!entries.length) {
    return '<div>No events selected</div>';
  }

  return entries
    .map(entry => {
      const formattedEventName = formatEventName(entry.name) || entry.name || 'Unknown Event';
      const dateLabel = entry.date ? formatDate(entry.date) : '--';
      const metaLabel = entry.groupShortLabel || entry.groupLabel || '--';

      return `
        <div
          class="player-event-history-item"
          aria-label="${escapeHtml(`${formattedEventName} on ${dateLabel} in ${metaLabel}`)}"
        >
          <span class="player-event-history-item-date">${escapeHtml(dateLabel)}</span>
          <span class="player-event-history-item-main">${escapeHtml(formattedEventName)}</span>
          <span class="player-event-history-item-meta">${escapeHtml(metaLabel)}</span>
        </div>
      `;
    })
    .join('');
}

function getBaseMatchupEvents() {
  const startDate = getMatchupStartDateSelect()?.value || '';
  const endDate = getMatchupEndDateSelect()?.value || '';
  const selectedEventTypes = getSelectedMatchupEventTypes();
  const scopedEvents = getPresetScopedMatchupEvents(selectedEventTypes);

  if (!startDate || !endDate || selectedEventTypes.length === 0) {
    return [];
  }

  return scopedEvents.filter(event => event.date >= startDate && event.date <= endDate);
}

function getMatchupSelectedEventEntries(events = getBaseMatchupEvents()) {
  const selectedEvents = new Map();

  events.forEach(event => {
    const eventKey = String(event.event_id || `${event.date || ''}::${event.event || ''}`);
    if (selectedEvents.has(eventKey)) {
      return;
    }

    const groupInfo = getEventGroupInfo(event.event);
    selectedEvents.set(eventKey, {
      name: event.event,
      date: event.date || '',
      groupKey: groupInfo.key,
      groupLabel: groupInfo.label,
      groupShortLabel: groupInfo.shortLabel,
      groupOrder: groupInfo.order
    });
  });

  return Array.from(selectedEvents.values()).sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
}

function getMatchupEventGroupSummaries(events = getBaseMatchupEvents()) {
  const groups = new Map();

  getMatchupSelectedEventEntries(events).forEach(entry => {
    if (!groups.has(entry.groupKey)) {
      groups.set(entry.groupKey, {
        key: entry.groupKey,
        label: entry.groupLabel,
        order: entry.groupOrder,
        count: 0
      });
    }

    groups.get(entry.groupKey).count += 1;
  });

  return Array.from(groups.values()).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

function getMatchupGroupContextKey(events = getBaseMatchupEvents()) {
  const startDate = getMatchupStartDateSelect()?.value || '';
  const endDate = getMatchupEndDateSelect()?.value || '';
  const selectedEventTypes = getSelectedMatchupEventTypes().slice().sort().join(',');
  const activePreset = getActiveMatchupPreset();
  const eventKeys = getMatchupSelectedEventEntries(events)
    .map(entry => `${entry.date || ''}::${entry.name || ''}`)
    .join('|');

  return [startDate, endDate, selectedEventTypes, activePreset, eventKeys].join('@@');
}

function syncMatchupGroupFilterState(groupSummaries, contextKey = '') {
  // Preserve existing group selections while the same event universe is active,
  // but reset to all groups when event type/date/preset changes the universe.
  if (groupSummaries.length === 0) {
    resetMatchupGroupFilterState();
    return;
  }

  const availableKeys = new Set(groupSummaries.map(group => group.key));
  const hasContextChanged = Boolean(contextKey) && contextKey !== matchupGroupSelectionContextKey;

  if (!matchupGroupSelectionInitialized || hasContextChanged) {
    activeMatchupGroupKeys = new Set(availableKeys);
    matchupGroupSelectionInitialized = true;
    matchupGroupSelectionContextKey = contextKey;
    syncMatchupGroupDataset();
    return;
  }

  activeMatchupGroupKeys = new Set(
    Array.from(activeMatchupGroupKeys).filter(groupKey => availableKeys.has(groupKey))
  );
  matchupGroupSelectionContextKey = contextKey || matchupGroupSelectionContextKey;
  syncMatchupGroupDataset();
}

function buildMatchupSelectionSnapshot() {
  // The snapshot is the single source for the selection summary, active matches,
  // and matrix data so the pills, list, and table cannot drift apart.
  const baseEvents = getBaseMatchupEvents();
  if (baseEvents.length === 0) {
    resetMatchupGroupFilterState();
    return {
      startDate: getMatchupStartDateSelect()?.value || '',
      endDate: getMatchupEndDateSelect()?.value || '',
      selectedEventTypes: getSelectedMatchupEventTypes(),
      baseEvents: [],
      filteredEvents: [],
      filteredMatches: [],
      groupSummaries: []
    };
  }

  const groupSummaries = getMatchupEventGroupSummaries(baseEvents);
  const contextKey = getMatchupGroupContextKey(baseEvents);
  syncMatchupGroupFilterState(groupSummaries, contextKey);

  const filteredEvents = baseEvents.filter(event => activeMatchupGroupKeys.has(getEventGroupInfo(event.event).key));
  const filteredEventIds = new Set(filteredEvents.map(event => String(event.event_id || '').trim()).filter(Boolean));
  const selectedEventTypes = getSelectedMatchupEventTypes();
  const startDate = getMatchupStartDateSelect()?.value || '';
  const endDate = getMatchupEndDateSelect()?.value || '';
  const baseMatches = filterMatchupRecords(getMatchupMatches(), {
    eventTypes: selectedEventTypes,
    startDate,
    endDate,
    quickViewPresetId: getActiveMatchupPreset()
  });

  const filteredMatches = filteredEventIds.size > 0
    ? baseMatches.filter(match => filteredEventIds.has(String(match.event_id || '').trim()))
    : [];

  return {
    startDate,
    endDate,
    selectedEventTypes,
    baseEvents,
    filteredEvents,
    filteredMatches,
    groupSummaries
  };
}

function toggleMatchupEventGroupFilter(groupKey) {
  const baseEvents = getBaseMatchupEvents();
  const groupSummaries = getMatchupEventGroupSummaries(baseEvents);
  const contextKey = getMatchupGroupContextKey(baseEvents);
  syncMatchupGroupFilterState(groupSummaries, contextKey);

  if (activeMatchupGroupKeys.has(groupKey)) {
    activeMatchupGroupKeys.delete(groupKey);
  } else {
    activeMatchupGroupKeys.add(groupKey);
  }

  matchupGroupSelectionInitialized = true;
  matchupGroupSelectionContextKey = contextKey;
  syncMatchupGroupDataset();
  updateMatchupSelectionSummary();

  if (isMatchupTopMode()) {
    updateMatchupAnalytics();
  }
}

function updateMatchupSelectionSummary(snapshot = buildMatchupSelectionSnapshot()) {
  // Group chips are interactive filters. They are rebuilt from the snapshot each
  // time so counts always reflect the current date/type/preset scope.
  const { panels, summary, summaryContent, listBox, list } = getMatchupSelectionElements();
  if (!panels || !summary || !summaryContent || !listBox || !list) {
    return;
  }

  const shouldShow = isMatchupTopMode();
  panels.style.display = shouldShow ? 'flex' : 'none';

  if (!shouldShow) {
    return;
  }

  const { baseEvents, groupSummaries, filteredEvents } = snapshot;
  const contextKey = getMatchupGroupContextKey(baseEvents);
  syncMatchupGroupFilterState(groupSummaries, contextKey);

  if (groupSummaries.length === 0) {
    summaryContent.innerHTML = 'No events selected';
    list.innerHTML = '<div>No events selected</div>';
    triggerUpdateAnimation('matchupSelectionSummary');
    triggerUpdateAnimation('matchupSelectionListBox');
    return;
  }

  summaryContent.innerHTML = groupSummaries
    .map(group => {
      const isActive = activeMatchupGroupKeys.has(group.key);
      const countLabel = formatGroupDisplayLabel(group.count === 1 ? group.label : `${group.label}s`);

      return `
        <button type="button" class="multi-event-group-card ${isActive ? 'active' : ''}" data-group-key="${group.key}">
          <span class="multi-event-group-card-count">${group.count}</span>
          <span class="multi-event-group-card-label">${countLabel}</span>
        </button>
      `;
    })
    .join('');

  summaryContent.querySelectorAll('.multi-event-group-card').forEach(button => {
    button.addEventListener('click', () => toggleMatchupEventGroupFilter(button.dataset.groupKey));
  });

  if (!groupSummaries.some(group => activeMatchupGroupKeys.has(group.key))) {
    const emptyState = document.createElement('div');
    emptyState.className = 'multi-event-group-empty';
    emptyState.textContent = 'No events selected';
    summaryContent.appendChild(emptyState);
  }

  list.innerHTML = buildMatchupSelectionListHTML(getMatchupSelectedEventEntries(filteredEvents));
  triggerUpdateAnimation('matchupSelectionSummary');
  triggerUpdateAnimation('matchupSelectionListBox');
}

function setMatchupDateSelection(type, value, options = {}) {
  const { clearPreset = false } = options;
  const startDateSelect = getMatchupStartDateSelect();
  const endDateSelect = getMatchupEndDateSelect();

  if (!startDateSelect || !endDateSelect) {
    return;
  }

  if (clearPreset) {
    clearMatchupPresetButtonState();
  }

  if (type === 'start') {
    startDateSelect.value = value;
  } else {
    endDateSelect.value = value;
  }

  updateMatchupDateOptions();

  if (isMatchupTopMode()) {
    updateMatchupAnalytics();
  }
}

function updateMatchupDateOptions() {
  // Date selectors are constrained to dates that exist after event-type and
  // quick-view preset scoping, preventing impossible empty windows.
  const startDateSelect = getMatchupStartDateSelect();
  const endDateSelect = getMatchupEndDateSelect();

  if (!startDateSelect || !endDateSelect) {
    return;
  }

  const selectedEventTypes = getSelectedMatchupEventTypes();
  const scopedEvents = getPresetScopedMatchupEvents(selectedEventTypes);
  const dates = [...new Set(scopedEvents.map(event => event.date))].sort((a, b) => new Date(a) - new Date(b));
  const activePreset = getActiveMatchupPreset();

  if (dates.length === 0) {
    startDateSelect.innerHTML = '<option value="">Select Offline or Online Event first</option>';
    endDateSelect.innerHTML = '<option value="">Select Offline or Online Event first</option>';
    renderDateRangeCalendar({
      containerId: 'matchupDateRangeCalendar',
      dates: [],
      startDate: '',
      endDate: '',
      emptyMessage: 'Select an Event Type first.',
      onSelectStartDate: dateString => setMatchupDateSelection('start', dateString, { clearPreset: true }),
      onSelectEndDate: dateString => setMatchupDateSelection('end', dateString, { clearPreset: true })
    });
    updateMatchupSelectionSummary();
    return;
  }

  let currentStartDate = dates.includes(startDateSelect.value) ? startDateSelect.value : '';
  let currentEndDate = dates.includes(endDateSelect.value) ? endDateSelect.value : '';
  const presetRange = activePreset
    ? getQuickViewPresetSuggestedRange({
        selectedEventTypes,
        presetId: activePreset,
        rows: getMatchupQuickViewRows()
      })
    : null;

  if (
    activePreset &&
    presetRange?.startDate &&
    presetRange?.endDate &&
    dates.includes(presetRange.startDate) &&
    dates.includes(presetRange.endDate)
  ) {
    currentStartDate = presetRange.startDate;
    currentEndDate = presetRange.endDate;
  } else if (!currentStartDate && !currentEndDate) {
    const defaultRange = getDefaultMatchupRange(dates);
    currentStartDate = defaultRange.startDate;
    currentEndDate = defaultRange.endDate;
  } else if (!currentStartDate) {
    currentStartDate = currentEndDate;
  } else if (!currentEndDate) {
    currentEndDate = currentStartDate;
  }

  if (currentStartDate) {
    const validEndDates = dates.filter(date => date >= currentStartDate);
    endDateSelect.innerHTML =
      '<option value="">Select End Date</option>' +
      validEndDates
        .map(date => `<option value="${date}" ${date === currentEndDate ? 'selected' : ''}>${date}</option>`)
        .join('');
  } else {
    endDateSelect.innerHTML =
      '<option value="">Select End Date</option>' +
      dates
        .map(date => `<option value="${date}" ${date === currentEndDate ? 'selected' : ''}>${date}</option>`)
        .join('');
  }

  if (currentEndDate) {
    const validStartDates = dates.filter(date => date <= currentEndDate);
    startDateSelect.innerHTML =
      '<option value="">Select Start Date</option>' +
      validStartDates
        .map(date => `<option value="${date}" ${date === currentStartDate ? 'selected' : ''}>${date}</option>`)
        .join('');
  } else {
    startDateSelect.innerHTML =
      '<option value="">Select Start Date</option>' +
      dates
        .map(date => `<option value="${date}" ${date === currentStartDate ? 'selected' : ''}>${date}</option>`)
        .join('');
  }

  startDateSelect.value = currentStartDate;
  endDateSelect.value = currentEndDate;

  renderDateRangeCalendar({
    containerId: 'matchupDateRangeCalendar',
    dates,
    startDate: currentStartDate,
    endDate: currentEndDate,
    onSelectStartDate: dateString => setMatchupDateSelection('start', dateString, { clearPreset: true }),
    onSelectEndDate: dateString => setMatchupDateSelection('end', dateString, { clearPreset: true })
  });

  updateMatchupSelectionSummary();
}

function getActivePresetDisplayLabel() {
  const presets = getQuickViewPresetDefinitionsByIds(
    getActiveMatchupPresetIds(),
    getMatchupQuickViewRows(),
    { includeFuture: true }
  );

  if (presets.length === 0) {
    return 'Manual Range';
  }

  if (presets.some(preset => preset.kind === 'static')) {
    return presets[0]?.label || 'All Period';
  }

  return presets.map(preset => preset.buttonLabel || preset.label).join(' + ');
}

function isResolvedMatchupMatch(match) {
  const entityA = getMatchEntityInfo(match, 'a');
  const entityB = getMatchEntityInfo(match, 'b');
  const outcome = String(match.outcome || '').trim();
  const pairingQuality = String(match.pairing_quality || '').trim().toLowerCase();

  return Boolean(entityA.name && entityB.name && pairingQuality !== 'conflict' && (outcome === 'player_a_win' || outcome === 'player_b_win'));
}

function getDeckRecordSummary(deckStats) {
  if (!deckStats) {
    return '--';
  }

  if (deckStats.decisiveMatches > 0) {
    return `${deckStats.wins}-${deckStats.losses} / ${formatMatchupPercentage((deckStats.wins / deckStats.decisiveMatches) * 100)} WR`;
  }

  if (deckStats.mirrors > 0) {
    return `${deckStats.mirrors} ${pluralize(deckStats.mirrors, 'mirror')}`;
  }

  return '--';
}

function ensureMatrixCell(cellMap, rowKey, columnKey) {
  if (!cellMap.has(rowKey)) {
    cellMap.set(rowKey, new Map());
  }

  if (!cellMap.get(rowKey).has(columnKey)) {
    cellMap.get(rowKey).set(columnKey, {
      wins: 0,
      losses: 0,
      total: 0,
      isMirror: false
    });
  }

  return cellMap.get(rowKey).get(columnKey);
}

function ensureDeckStats(deckStatsMap, entityKey, entityName) {
  if (!deckStatsMap.has(entityKey)) {
    deckStatsMap.set(entityKey, {
      key: entityKey,
      deck: entityName,
      matches: 0,
      pilotAppearances: 0,
      decisiveMatches: 0,
      wins: 0,
      losses: 0,
      mirrors: 0,
      eventIds: new Set()
    });
  }

  return deckStatsMap.get(entityKey);
}

function calculateMatchupMatrix(matches = []) {
  const deckStatsMap = new Map();
  const cellMap = new Map();
  const pairStatsMap = new Map();

  matches.forEach(match => {
    const entityA = getMatchEntityInfo(match, 'a');
    const entityB = getMatchEntityInfo(match, 'b');
    const outcome = String(match.outcome || '').trim();
    const eventId = String(match.event_id || '').trim();
    const matchDate = String(match.date || '').trim();

    if (!entityA.name || !entityB.name || (outcome !== 'player_a_win' && outcome !== 'player_b_win')) {
      return;
    }

    const deckStatsA = ensureDeckStats(deckStatsMap, entityA.key, entityA.name);
    const deckStatsB = ensureDeckStats(deckStatsMap, entityB.key, entityB.name);

    deckStatsA.pilotAppearances += 1;
    deckStatsB.pilotAppearances += 1;
    if (eventId) {
      deckStatsA.eventIds.add(eventId);
      deckStatsB.eventIds.add(eventId);
    }

    if (entityA.key === entityB.key) {
      deckStatsA.matches += 1;
      deckStatsA.mirrors += 1;

      const mirrorCell = ensureMatrixCell(cellMap, entityA.key, entityA.key);
      mirrorCell.total += 1;
      mirrorCell.isMirror = true;
      return;
    }

    deckStatsA.matches += 1;
    deckStatsB.matches += 1;
    deckStatsA.decisiveMatches += 1;
    deckStatsB.decisiveMatches += 1;

    const cellAB = ensureMatrixCell(cellMap, entityA.key, entityB.key);
    const cellBA = ensureMatrixCell(cellMap, entityB.key, entityA.key);
    cellAB.total += 1;
    cellBA.total += 1;

    const sortedPair = [
      { key: entityA.key, name: entityA.name },
      { key: entityB.key, name: entityB.name }
    ].sort((left, right) => left.key.localeCompare(right.key));
    const pairKey = sortedPair.map(item => item.key).join('|||');
    if (!pairStatsMap.has(pairKey)) {
      pairStatsMap.set(pairKey, {
        deckOne: sortedPair[0].name,
        deckOneKey: sortedPair[0].key,
        deckTwo: sortedPair[1].name,
        deckTwoKey: sortedPair[1].key,
        winsOne: 0,
        winsTwo: 0,
        total: 0,
        eventIds: new Set(),
        firstDate: '',
        lastDate: ''
      });
    }

    const pairStats = pairStatsMap.get(pairKey);
    pairStats.total += 1;
    if (eventId) {
      pairStats.eventIds.add(eventId);
    }
    if (matchDate) {
      pairStats.firstDate = !pairStats.firstDate || matchDate < pairStats.firstDate ? matchDate : pairStats.firstDate;
      pairStats.lastDate = !pairStats.lastDate || matchDate > pairStats.lastDate ? matchDate : pairStats.lastDate;
    }

    if (outcome === 'player_a_win') {
      deckStatsA.wins += 1;
      deckStatsB.losses += 1;
      cellAB.wins += 1;
      cellBA.losses += 1;

      if (pairStats.deckOneKey === entityA.key) {
        pairStats.winsOne += 1;
      } else {
        pairStats.winsTwo += 1;
      }
    } else {
      deckStatsA.losses += 1;
      deckStatsB.wins += 1;
      cellAB.losses += 1;
      cellBA.wins += 1;

      if (pairStats.deckOneKey === entityA.key) {
        pairStats.winsTwo += 1;
      } else {
        pairStats.winsOne += 1;
      }
    }
  });

  const deckOrder = Array.from(deckStatsMap.values())
    .sort((a, b) => {
      return (
        b.matches - a.matches ||
        b.decisiveMatches - a.decisiveMatches ||
        b.wins - a.wins ||
        a.deck.localeCompare(b.deck)
      );
    })
    .map(deckStats => deckStats.key);

  const topPair = Array.from(pairStatsMap.values()).sort((a, b) => {
    return (
      b.total - a.total ||
      Math.max(b.winsOne, b.winsTwo) - Math.max(a.winsOne, a.winsTwo) ||
      a.deckOne.localeCompare(b.deckOne) ||
      a.deckTwo.localeCompare(b.deckTwo)
    );
  })[0] || null;

  const leastPair = Array.from(pairStatsMap.values()).sort((a, b) => {
    return (
      a.total - b.total ||
      Math.max(b.winsOne, b.winsTwo) - Math.max(a.winsOne, a.winsTwo) ||
      a.deckOne.localeCompare(b.deckOne) ||
      a.deckTwo.localeCompare(b.deckTwo)
    );
  })[0] || null;

  return {
    deckStatsMap,
    cellMap,
    deckOrder,
    topPair,
    leastPair,
    pairStatsList: Array.from(pairStatsMap.values())
  };
}

function getMostPlayedDeck(deckStatsMap = new Map()) {
  return Array.from(deckStatsMap.values()).sort((a, b) => {
    return (
      b.matches - a.matches ||
      b.decisiveMatches - a.decisiveMatches ||
      b.wins - a.wins ||
      a.deck.localeCompare(b.deck)
    );
  })[0] || null;
}

function getBestWinRateDeck(deckStatsMap = new Map()) {
  return Array.from(deckStatsMap.values())
    .filter(deckStats => deckStats.decisiveMatches > 0)
    .sort((a, b) => {
      const aWinRate = a.decisiveMatches > 0 ? a.wins / a.decisiveMatches : -1;
      const bWinRate = b.decisiveMatches > 0 ? b.wins / b.decisiveMatches : -1;

      return (
        bWinRate - aWinRate ||
        b.decisiveMatches - a.decisiveMatches ||
        b.wins - a.wins ||
        a.deck.localeCompare(b.deck)
      );
    })[0] || null;
}

function describePairLead(pairStats) {
  if (!pairStats) {
    return '--';
  }

  if (pairStats.winsOne === pairStats.winsTwo) {
    return `${pairStats.winsOne}-${pairStats.winsTwo} split`;
  }

  return pairStats.winsOne > pairStats.winsTwo
    ? `${pairStats.deckOne} leads ${pairStats.winsOne}-${pairStats.winsTwo}`
    : `${pairStats.deckTwo} leads ${pairStats.winsTwo}-${pairStats.winsOne}`;
}

function buildDeckAxisLabel(deckStats) {
  const matchesLabel = `${deckStats.matches} ${pluralize(deckStats.matches, 'match')}`;
  const detailLabel = deckStats.decisiveMatches > 0
    ? `${formatMatchupPercentage((deckStats.wins / deckStats.decisiveMatches) * 100)} WR`
    : deckStats.mirrors > 0
      ? `${deckStats.mirrors} ${pluralize(deckStats.mirrors, 'mirror')}`
      : '--';

  return `
    <div class="matchup-axis-label">
      <span class="matchup-axis-deck">${escapeHtml(deckStats.deck)}</span>
      <span class="matchup-axis-meta">${escapeHtml(matchesLabel)} | ${escapeHtml(detailLabel)}</span>
    </div>
  `;
}

function getMatchupCellTone(winRate, sampleSize) {
  const normalizedSample = Math.min(sampleSize, 12) / 12;
  const alpha = 0.14 + (normalizedSample * 0.34);
  const hue = Math.round((Math.max(0, Math.min(100, winRate)) / 100) * 120);

  return {
    background: `hsla(${hue}, 72%, 42%, ${alpha.toFixed(3)})`,
    border: `hsla(${hue}, 72%, 60%, ${Math.min(alpha + 0.18, 0.85).toFixed(3)})`
  };
}

function buildMatrixCellHtml(cell, rowDeck, columnDeck, { allowMirror = true } = {}) {
  const viewConfig = getActiveMatchupViewConfig();

  if (!cell || cell.total === 0) {
    return `
      <td class="matchup-matrix-cell matchup-matrix-cell-empty">
        <span class="matchup-matrix-empty">--</span>
      </td>
    `;
  }

  if (allowMirror && (rowDeck === columnDeck || cell.isMirror)) {
    return `
      <td class="matchup-matrix-cell matchup-matrix-cell-mirror">
        <span class="matchup-matrix-rate">${escapeHtml(viewConfig.sameEntityCellLabel)}</span>
        <span class="matchup-matrix-record">${cell.total} ${pluralize(cell.total, 'match')}</span>
        <span class="matchup-matrix-sample">${escapeHtml(viewConfig.sameEntityPairingsLabel)}</span>
      </td>
    `;
  }

  const winRate = cell.total > 0 ? (cell.wins / cell.total) * 100 : 0;
  const tone = getMatchupCellTone(winRate, cell.total);

  return `
    <td
      class="matchup-matrix-cell matchup-matrix-cell-data"
      style="--matchup-cell-bg: ${tone.background}; --matchup-cell-border: ${tone.border};"
      title="${escapeHtml(`${rowDeck} vs ${columnDeck}: ${cell.wins}-${cell.losses} (${formatMatchupPercentage(winRate)}) across ${cell.total} ${pluralize(cell.total, 'match')}`)}"
    >
      <span class="matchup-matrix-rate">${formatMatchupPercentage(winRate)}</span>
      <span class="matchup-matrix-record">${cell.wins}-${cell.losses}</span>
      <span class="matchup-matrix-sample">${cell.total} ${pluralize(cell.total, 'match')}</span>
    </td>
  `;
}

function buildFocusedPlayerPerspectiveMatches(matches = [], playerKey = '') {
  const normalizedPlayerKey = normalizeMatchupEntityKey(playerKey);
  if (!normalizedPlayerKey) {
    return [];
  }

  return (matches || [])
    .filter(match => matchIncludesPlayer(match, normalizedPlayerKey))
    .map(match => {
      const playerIsA = getMatchupPlayerKey(match, 'a') === normalizedPlayerKey;
      const playerDeck = playerIsA ? normalizeDeckName(match?.deck_a) : normalizeDeckName(match?.deck_b);
      const opponentPlayerKey = playerIsA ? getMatchupPlayerKey(match, 'b') : getMatchupPlayerKey(match, 'a');
      const opponentPlayer = playerIsA ? getMatchupPlayerName(match, 'b') : getMatchupPlayerName(match, 'a');
      const opponentDeck = playerIsA ? normalizeDeckName(match?.deck_b) : normalizeDeckName(match?.deck_a);
      const playerWon = playerIsA
        ? String(match?.outcome || '').trim() === 'player_a_win'
        : String(match?.outcome || '').trim() === 'player_b_win';

      return {
        eventId: String(match?.event_id || '').trim(),
        event: String(match?.event || '').trim(),
        eventType: String(match?.event_type || '').trim().toLowerCase(),
        date: String(match?.date || '').trim(),
        playerDeck,
        opponentPlayerKey,
        opponentPlayer,
        opponentDeck,
        playerWon
      };
    })
    .filter(entry => entry.playerDeck && entry.opponentPlayerKey && entry.opponentPlayer && entry.opponentDeck);
}

function formatSignedMatchupSpread(value = 0) {
  const numericValue = Number(value || 0);
  if (numericValue > 0) {
    return `+${numericValue}`;
  }

  if (numericValue < 0) {
    return `${numericValue}`;
  }

  return '0';
}

function formatRecordWithWinRate(wins = 0, losses = 0, winRate = 0) {
  return `${wins}-${losses} (${formatMatchupPercentage(winRate)})`;
}

function formatCompactMatchupNameList(values = [], singularLabel = 'deck') {
  if (!values.length) {
    return '--';
  }

  if (values.length <= 2) {
    return values.join(', ');
  }

  return `${values.length} ${pluralize(values.length, singularLabel)}`;
}

function getFocusedPlayerDeckPairSummaries(
  resolvedMatches = currentResolvedMatchupMatches,
  focusPlayerKey = currentMatchupPlayerFocus?.selectedPlayerKey
) {
  const normalizedPlayerKey = normalizeMatchupEntityKey(focusPlayerKey);
  if (!normalizedPlayerKey) {
    return [];
  }

  const pairMap = new Map();
  const perspectiveMatches = buildFocusedPlayerPerspectiveMatches(resolvedMatches, normalizedPlayerKey);

  perspectiveMatches.forEach(entry => {
    const playerDeckKey = normalizeMatchupEntityKey(entry.playerDeck);
    const opponentDeckKey = normalizeMatchupEntityKey(entry.opponentDeck);
    if (!playerDeckKey || !opponentDeckKey) {
      return;
    }

    const pairKey = `${playerDeckKey}|||${opponentDeckKey}`;
    if (!pairMap.has(pairKey)) {
      pairMap.set(pairKey, {
        key: pairKey,
        playerDeck: entry.playerDeck,
        opponentDeck: entry.opponentDeck,
        wins: 0,
        losses: 0,
        total: 0,
        eventIds: new Set(),
        firstDate: '',
        lastDate: ''
      });
    }

    const summary = pairMap.get(pairKey);
    summary.total += 1;

    if (entry.playerWon) {
      summary.wins += 1;
    } else {
      summary.losses += 1;
    }

    if (entry.eventId) {
      summary.eventIds.add(entry.eventId);
    }
    if (entry.date) {
      summary.firstDate = !summary.firstDate || entry.date < summary.firstDate ? entry.date : summary.firstDate;
      summary.lastDate = !summary.lastDate || entry.date > summary.lastDate ? entry.date : summary.lastDate;
    }
  });

  return Array.from(pairMap.values())
    .map(summary => ({
      ...summary,
      eventCount: summary.eventIds.size,
      winRate: summary.total > 0 ? (summary.wins / summary.total) * 100 : 0,
      spread: summary.wins - summary.losses
    }))
    .sort((left, right) => {
      return (
        right.total - left.total ||
        right.winRate - left.winRate ||
        right.spread - left.spread ||
        left.playerDeck.localeCompare(right.playerDeck) ||
        left.opponentDeck.localeCompare(right.opponentDeck)
      );
    });
}

function getFocusedPlayerOpponentSpreadSummaries(
  resolvedMatches = currentResolvedMatchupMatches,
  focusPlayerKey = currentMatchupPlayerFocus?.selectedPlayerKey
) {
  const normalizedPlayerKey = normalizeMatchupEntityKey(focusPlayerKey);
  if (!normalizedPlayerKey) {
    return [];
  }

  const opponentMap = new Map();
  const perspectiveMatches = buildFocusedPlayerPerspectiveMatches(resolvedMatches, normalizedPlayerKey);

  perspectiveMatches.forEach(entry => {
    if (!opponentMap.has(entry.opponentPlayerKey)) {
      opponentMap.set(entry.opponentPlayerKey, {
        key: entry.opponentPlayerKey,
        deck: entry.opponentPlayer,
        wins: 0,
        losses: 0,
        total: 0,
        eventIds: new Set(),
        playerDecks: new Set(),
        opponentDecks: new Set(),
        firstDate: '',
        lastDate: ''
      });
    }

    const summary = opponentMap.get(entry.opponentPlayerKey);
    summary.total += 1;

    if (entry.playerWon) {
      summary.wins += 1;
    } else {
      summary.losses += 1;
    }

    if (entry.eventId) {
      summary.eventIds.add(entry.eventId);
    }
    if (entry.playerDeck) {
      summary.playerDecks.add(entry.playerDeck);
    }
    if (entry.opponentDeck) {
      summary.opponentDecks.add(entry.opponentDeck);
    }
    if (entry.date) {
      summary.firstDate = !summary.firstDate || entry.date < summary.firstDate ? entry.date : summary.firstDate;
      summary.lastDate = !summary.lastDate || entry.date > summary.lastDate ? entry.date : summary.lastDate;
    }
  });

  return Array.from(opponentMap.values())
    .map(summary => ({
      ...summary,
      eventCount: summary.eventIds.size,
      playerDecks: Array.from(summary.playerDecks).sort((left, right) => left.localeCompare(right)),
      opponentDecks: Array.from(summary.opponentDecks).sort((left, right) => left.localeCompare(right)),
      winRate: summary.total > 0 ? (summary.wins / summary.total) * 100 : 0,
      spread: summary.wins - summary.losses,
      lossSpread: summary.losses - summary.wins
    }))
    .sort((left, right) => {
      return (
        right.total - left.total ||
        right.spread - left.spread ||
        left.deck.localeCompare(right.deck)
      );
    });
}

function getFocusedPlayerHeroMatchups(
  resolvedMatches = currentResolvedMatchupMatches,
  focusPlayerKey = currentMatchupPlayerFocus?.selectedPlayerKey
) {
  return getFocusedPlayerOpponentSpreadSummaries(resolvedMatches, focusPlayerKey)
    .filter(summary => summary.spread > 0)
    .sort((left, right) => {
      return (
        right.spread - left.spread ||
        right.total - left.total ||
        right.wins - left.wins ||
        left.deck.localeCompare(right.deck)
      );
    });
}

function getFocusedPlayerVillainMatchups(
  resolvedMatches = currentResolvedMatchupMatches,
  focusPlayerKey = currentMatchupPlayerFocus?.selectedPlayerKey
) {
  return getFocusedPlayerOpponentSpreadSummaries(resolvedMatches, focusPlayerKey)
    .filter(summary => summary.lossSpread > 0)
    .sort((left, right) => {
      return (
        right.lossSpread - left.lossSpread ||
        right.total - left.total ||
        right.losses - left.losses ||
        left.deck.localeCompare(right.deck)
      );
    });
}

function getFocusedPlayerOpponentEventBreakdown(
  opponentKey = '',
  resolvedMatches = currentResolvedMatchupMatches,
  focusPlayerKey = currentMatchupPlayerFocus?.selectedPlayerKey
) {
  const normalizedOpponentKey = normalizeMatchupEntityKey(opponentKey);
  const normalizedPlayerKey = normalizeMatchupEntityKey(focusPlayerKey);
  if (!normalizedOpponentKey || !normalizedPlayerKey) {
    return [];
  }

  const eventMap = new Map();

  buildFocusedPlayerPerspectiveMatches(resolvedMatches, normalizedPlayerKey)
    .filter(entry => entry.opponentPlayerKey === normalizedOpponentKey)
    .forEach(entry => {
      const eventKey = entry.eventId || `${entry.date || ''}::${entry.event || ''}`;
      if (!eventMap.has(eventKey)) {
        eventMap.set(eventKey, {
          event: entry.event,
          date: entry.date,
          eventType: entry.eventType,
          total: 0,
          wins: 0,
          losses: 0,
          playerDecks: new Set(),
          opponentDecks: new Set()
        });
      }

      const summary = eventMap.get(eventKey);
      summary.total += 1;
      if (entry.playerWon) {
        summary.wins += 1;
      } else {
        summary.losses += 1;
      }
      if (entry.playerDeck) {
        summary.playerDecks.add(entry.playerDeck);
      }
      if (entry.opponentDeck) {
        summary.opponentDecks.add(entry.opponentDeck);
      }
    });

  return Array.from(eventMap.values())
    .map(summary => ({
      ...summary,
      playerDecks: Array.from(summary.playerDecks).sort((left, right) => left.localeCompare(right)),
      opponentDecks: Array.from(summary.opponentDecks).sort((left, right) => left.localeCompare(right))
    }))
    .sort((left, right) => {
      return (
        String(right.date || '').localeCompare(String(left.date || '')) ||
        String(left.event || '').localeCompare(String(right.event || ''))
      );
    });
}

function getFocusedPlayerDeckPairEventBreakdown(
  pairKey = '',
  resolvedMatches = currentResolvedMatchupMatches,
  focusPlayerKey = currentMatchupPlayerFocus?.selectedPlayerKey
) {
  const normalizedPairKey = String(pairKey || '').trim();
  const normalizedPlayerKey = normalizeMatchupEntityKey(focusPlayerKey);
  if (!normalizedPairKey || !normalizedPlayerKey) {
    return [];
  }

  const eventMap = new Map();

  buildFocusedPlayerPerspectiveMatches(resolvedMatches, normalizedPlayerKey)
    .filter(entry => `${normalizeMatchupEntityKey(entry.playerDeck)}|||${normalizeMatchupEntityKey(entry.opponentDeck)}` === normalizedPairKey)
    .forEach(entry => {
      const eventKey = entry.eventId || `${entry.date || ''}::${entry.event || ''}`;
      if (!eventMap.has(eventKey)) {
        eventMap.set(eventKey, {
          event: entry.event,
          date: entry.date,
          eventType: entry.eventType,
          total: 0,
          wins: 0,
          losses: 0,
          playerDecks: new Set(),
          opponentDecks: new Set()
        });
      }

      const summary = eventMap.get(eventKey);
      summary.total += 1;
      if (entry.playerWon) {
        summary.wins += 1;
      } else {
        summary.losses += 1;
      }
      if (entry.playerDeck) {
        summary.playerDecks.add(entry.playerDeck);
      }
      if (entry.opponentDeck) {
        summary.opponentDecks.add(entry.opponentDeck);
      }
    });

  return Array.from(eventMap.values())
    .map(summary => ({
      ...summary,
      playerDecks: Array.from(summary.playerDecks).sort((left, right) => left.localeCompare(right)),
      opponentDecks: Array.from(summary.opponentDecks).sort((left, right) => left.localeCompare(right))
    }))
    .sort((left, right) => {
      return (
        String(right.date || '').localeCompare(String(left.date || '')) ||
        String(left.event || '').localeCompare(String(right.event || ''))
      );
    });
}

function aggregateFocusedPlayerDimensionMatrix(entries = [], {
  getColumnKey,
  getColumnLabel,
  allowMirror = false
} = {}) {
  const rowStatsMap = new Map();
  const columnStatsMap = new Map();
  const cellMap = new Map();

  (entries || []).forEach(entry => {
    const rowKey = normalizeMatchupEntityKey(entry.playerDeck);
    const rowLabel = entry.playerDeck;
    const columnKey = normalizeMatchupEntityKey(getColumnKey(entry));
    const columnLabel = getColumnLabel(entry);

    if (!rowKey || !rowLabel || !columnKey || !columnLabel) {
      return;
    }

    const rowStats = ensureDeckStats(rowStatsMap, rowKey, rowLabel);
    const columnStats = ensureDeckStats(columnStatsMap, columnKey, columnLabel);
    const cell = ensureMatrixCell(cellMap, rowKey, columnKey);

    rowStats.matches += 1;
    rowStats.decisiveMatches += 1;
    columnStats.matches += 1;
    columnStats.decisiveMatches += 1;
    cell.total += 1;

    if (entry.eventId) {
      rowStats.eventIds.add(entry.eventId);
      columnStats.eventIds.add(entry.eventId);
    }

    if (allowMirror && rowLabel === columnLabel) {
      rowStats.mirrors += 1;
      columnStats.mirrors += 1;
      cell.isMirror = true;
    }

    if (entry.playerWon) {
      rowStats.wins += 1;
      columnStats.wins += 1;
      cell.wins += 1;
    } else {
      rowStats.losses += 1;
      columnStats.losses += 1;
      cell.losses += 1;
    }
  });

  const rowOrder = Array.from(rowStatsMap.values())
    .sort((left, right) => {
      return (
        right.matches - left.matches ||
        right.wins - left.wins ||
        left.deck.localeCompare(right.deck)
      );
    })
    .map(item => item.key);

  const columnOrder = Array.from(columnStatsMap.values())
    .sort((left, right) => {
      return (
        right.matches - left.matches ||
        right.wins - left.wins ||
        left.deck.localeCompare(right.deck)
      );
    })
    .map(item => item.key);

  return {
    rowStatsMap,
    columnStatsMap,
    cellMap,
    rowOrder,
    columnOrder
  };
}

function renderFocusedPlayerDimensionTable({
  titleElement,
  helperElement,
  headElement,
  bodyElement,
  title,
  helper,
  emptyMessage,
  cornerLabel,
  matrixData,
  allowMirror = false
}) {
  // Renders one focused-player matrix, either focus decks vs opponent decks or
  // focus decks vs opponents.
  if (!titleElement || !helperElement || !headElement || !bodyElement) {
    return;
  }

  updateElementText(titleElement.id, title);
  updateElementText(helperElement.id, helper);

  if (!matrixData || matrixData.rowOrder.length === 0 || matrixData.columnOrder.length === 0) {
    headElement.innerHTML = `
      <tr>
        <th class="matchup-axis-corner">${escapeHtml(cornerLabel)}</th>
        <th>No data</th>
      </tr>
    `;
    bodyElement.innerHTML = `<tr><td colspan="2">${escapeHtml(emptyMessage)}</td></tr>`;
    return;
  }

  headElement.innerHTML = `
    <tr>
      <th scope="col" class="matchup-axis-corner">${escapeHtml(cornerLabel)}</th>
      ${matrixData.columnOrder.map(columnKey => {
        const columnStats = matrixData.columnStatsMap.get(columnKey);
        return `<th scope="col" class="matchup-matrix-column-header">${buildDeckAxisLabel(columnStats)}</th>`;
      }).join('')}
    </tr>
  `;

  bodyElement.innerHTML = matrixData.rowOrder
    .map(rowKey => {
      const rowStats = matrixData.rowStatsMap.get(rowKey);
      const rowLabel = rowStats?.deck || rowKey;
      const rowCells = matrixData.columnOrder
        .map(columnKey => {
          const columnLabel = matrixData.columnStatsMap.get(columnKey)?.deck || columnKey;
          return buildMatrixCellHtml(
            matrixData.cellMap.get(rowKey)?.get(columnKey),
            rowLabel,
            columnLabel,
            { allowMirror }
          );
        })
        .join('');

      return `
        <tr>
          <th scope="row" class="matchup-matrix-row-header">${buildDeckAxisLabel(rowStats)}</th>
          ${rowCells}
        </tr>
      `;
    })
    .join('');
}

function getExportFilename(playerLabel, suffix) {
  const baseLabel = sanitizeCsvFilename(playerLabel || 'player-matchup');
  return `${baseLabel}-${suffix}.csv`;
}

function buildDeckMatchupCsvMatrixData(matchupMatrix) {
  return {
    rowStatsMap: matchupMatrix?.deckStatsMap || new Map(),
    columnStatsMap: matchupMatrix?.deckStatsMap || new Map(),
    cellMap: matchupMatrix?.cellMap || new Map(),
    rowOrder: Array.isArray(matchupMatrix?.deckOrder) ? matchupMatrix.deckOrder : [],
    columnOrder: Array.isArray(matchupMatrix?.deckOrder) ? matchupMatrix.deckOrder : []
  };
}

function getMatchupCsvVariantSettings(variant = 'record') {
  return variant === 'winrate'
    ? { format: 'winrate', filenameSuffix: 'wr', label: 'WR', summaryLabel: 'Total WR%' }
    : { format: 'record', filenameSuffix: 'wl', label: 'W-L', summaryLabel: 'Total W-L' };
}

function getCurrentMatchupCsvMetadata({
  tableLabel = '',
  playerLabel = '',
  variant = 'record'
} = {}) {
  const variantSettings = getMatchupCsvVariantSettings(variant);
  const metadataRows = [];

  if (tableLabel) {
    metadataRows.push(['Table', tableLabel]);
  }

  metadataRows.push(['Metric', variantSettings.label]);

  if (playerLabel) {
    metadataRows.push(['Player', playerLabel]);
  }

  const eventCount = currentMatchupSnapshot?.filteredEvents?.length ?? 0;
  if (eventCount > 0) {
    metadataRows.push(['Events', String(eventCount)]);
  }

  const resolvedMatchCount = currentResolvedMatchupMatches?.length ?? 0;
  if (resolvedMatchCount > 0) {
    metadataRows.push(['Resolved Matches', String(resolvedMatchCount)]);
  }

  if (currentMatchupSnapshot?.startDate || currentMatchupSnapshot?.endDate) {
    const rangeLabel = currentMatchupSnapshot?.startDate && currentMatchupSnapshot?.endDate
      ? `${formatDate(currentMatchupSnapshot.startDate)} to ${formatDate(currentMatchupSnapshot.endDate)}`
      : currentMatchupSnapshot?.startDate || currentMatchupSnapshot?.endDate || '';
    metadataRows.push(['Date Range', rangeLabel]);
  }

  const activeWindowLabel = getActivePresetDisplayLabel();
  if (activeWindowLabel) {
    metadataRows.push(['Window', activeWindowLabel]);
  }

  return metadataRows;
}

function buildCompactMatchupCsv(matrixData, rowHeaderLabel, {
  variant = 'record',
  excludeDiagonal = false,
  metadataRows = []
} = {}) {
  const variantSettings = getMatchupCsvVariantSettings(variant);
  return buildCrossTabMatrixCsv(
    matrixData,
    rowHeaderLabel,
    metadataRows,
    {
      format: variantSettings.format,
      blankValue: '',
      excludeDiagonal,
      includeSummaryRow: true,
      includeSummaryColumn: true,
      summaryLabel: variantSettings.summaryLabel,
      summaryCornerValue: ''
    }
  );
}

function getDeckMatchupExportFilename(variant = 'record') {
  const { filenameSuffix } = getMatchupCsvVariantSettings(variant);
  const windowLabel = sanitizeCsvFilename(getActivePresetDisplayLabel());
  if (windowLabel) {
    return `deck-matchup-${windowLabel}-${filenameSuffix}.csv`;
  }

  const startDate = String(currentMatchupSnapshot?.startDate || '').trim();
  const endDate = String(currentMatchupSnapshot?.endDate || '').trim();
  const fallbackLabel = sanitizeCsvFilename(
    startDate && endDate
      ? `${startDate}-${endDate}`
      : startDate || endDate || 'matrix'
  );

  return `deck-matchup-${fallbackLabel}-${filenameSuffix}.csv`;
}

function exportDeckMatchupCsv(variant = 'record') {
  const matrixData = buildDeckMatchupCsvMatrixData(currentMatchupMatrix);
  if (matrixData.rowOrder.length === 0 || matrixData.columnOrder.length === 0) {
    return;
  }

  const tableLabel = getActiveMatchupViewConfig().primaryTitle;
  const metadataRows = getCurrentMatchupCsvMetadata({
    tableLabel,
    variant
  });

  const csvText = buildCompactMatchupCsv(
    matrixData,
    getActiveMatchupViewConfig().entityTitleSingular,
    {
      variant,
      excludeDiagonal: true,
      metadataRows
    }
  );

  downloadCsvFile(getDeckMatchupExportFilename(variant), csvText);
}

function getPlayerMatchupExportFilename(playerLabel, suffix, variant = 'record') {
  const variantSettings = getMatchupCsvVariantSettings(variant);
  return getExportFilename(playerLabel, `${suffix}-${variantSettings.filenameSuffix}`);
}

function exportPlayerMatchupCsv(matrixData, playerLabel, suffix, {
  variant = 'record',
  excludeDiagonal = false,
  tableLabel = ''
} = {}) {
  if (!matrixData || matrixData.rowOrder.length === 0 || matrixData.columnOrder.length === 0) {
    return;
  }

  const metadataRows = getCurrentMatchupCsvMetadata({
    tableLabel,
    playerLabel,
    variant
  });

  const csvText = buildCompactMatchupCsv(
    matrixData,
    'Played Deck',
    {
      variant,
      excludeDiagonal,
      metadataRows
    }
  );
  downloadCsvFile(getPlayerMatchupExportFilename(playerLabel, suffix, variant), csvText);
}

function exportPlayerMatchupPrimaryCsv(variant = 'record') {
  if (!currentMatchupPlayerFocus?.selectedPlayerKey) {
    return;
  }

  const perspectiveMatches = buildFocusedPlayerPerspectiveMatches(currentResolvedMatchupMatches, currentMatchupPlayerFocus.selectedPlayerKey);
  const matrixData = aggregateFocusedPlayerDimensionMatrix(perspectiveMatches, {
    getColumnKey: entry => entry.opponentPlayerKey,
    getColumnLabel: entry => entry.opponentPlayer,
    allowMirror: false
  });

  exportPlayerMatchupCsv(matrixData, currentMatchupPlayerFocus.selectedPlayerLabel, 'deck-vs-opponents', {
    variant,
    excludeDiagonal: false,
    tableLabel: 'Deck vs Opponents'
  });
}

function exportPlayerMatchupSecondaryCsv(variant = 'record') {
  if (!currentMatchupPlayerFocus?.selectedPlayerKey) {
    return;
  }

  const perspectiveMatches = buildFocusedPlayerPerspectiveMatches(currentResolvedMatchupMatches, currentMatchupPlayerFocus.selectedPlayerKey);
  const matrixData = aggregateFocusedPlayerDimensionMatrix(perspectiveMatches, {
    getColumnKey: entry => entry.opponentDeck,
    getColumnLabel: entry => entry.opponentDeck,
    allowMirror: false
  });

  exportPlayerMatchupCsv(matrixData, currentMatchupPlayerFocus.selectedPlayerLabel, 'deck-vs-opposing-decks', {
    variant,
    excludeDiagonal: true,
    tableLabel: 'Deck vs Opposing Decks'
  });
}

function updateMatchupExportButtons() {
  const primaryRecordButton = document.getElementById('matchupDownloadPrimaryRecordCsv');
  const primaryWinRateButton = document.getElementById('matchupDownloadPrimaryWinRateCsv');
  const secondaryRecordButton = document.getElementById('matchupDownloadSecondaryRecordCsv');
  const secondaryWinRateButton = document.getElementById('matchupDownloadSecondaryWinRateCsv');
  const isPlayerMode = isPlayerMatchupMode();
  const hasSelectedPlayer = Boolean(currentMatchupPlayerFocus?.selectedPlayerKey);
  const hasDeckMatrixData = Boolean(currentMatchupMatrix?.deckOrder?.length);
  const hasPlayerMatchupData = hasSelectedPlayer && currentResolvedMatchupMatches.length > 0;

  [primaryRecordButton, primaryWinRateButton].forEach(button => {
    if (!button) {
      return;
    }

    button.style.display = 'inline-flex';
    button.disabled = isPlayerMode ? !hasPlayerMatchupData : !hasDeckMatrixData;
  });

  [secondaryRecordButton, secondaryWinRateButton].forEach(button => {
    if (!button) {
      return;
    }

    button.style.display = isPlayerMode ? 'inline-flex' : 'none';
    button.disabled = !hasPlayerMatchupData;
  });
}

function setupMatchupCsvExportListeners() {
  const primaryRecordButton = document.getElementById('matchupDownloadPrimaryRecordCsv');
  const primaryWinRateButton = document.getElementById('matchupDownloadPrimaryWinRateCsv');
  const secondaryRecordButton = document.getElementById('matchupDownloadSecondaryRecordCsv');
  const secondaryWinRateButton = document.getElementById('matchupDownloadSecondaryWinRateCsv');

  if (primaryRecordButton && primaryRecordButton.dataset.listenerAdded !== 'true') {
    primaryRecordButton.addEventListener('click', () => {
      if (isPlayerMatchupMode()) {
        exportPlayerMatchupPrimaryCsv('record');
        return;
      }

      exportDeckMatchupCsv('record');
    });
    primaryRecordButton.dataset.listenerAdded = 'true';
  }

  if (primaryWinRateButton && primaryWinRateButton.dataset.listenerAdded !== 'true') {
    primaryWinRateButton.addEventListener('click', () => {
      if (isPlayerMatchupMode()) {
        exportPlayerMatchupPrimaryCsv('winrate');
        return;
      }

      exportDeckMatchupCsv('winrate');
    });
    primaryWinRateButton.dataset.listenerAdded = 'true';
  }

  if (secondaryRecordButton && secondaryRecordButton.dataset.listenerAdded !== 'true') {
    secondaryRecordButton.addEventListener('click', () => exportPlayerMatchupSecondaryCsv('record'));
    secondaryRecordButton.dataset.listenerAdded = 'true';
  }

  if (secondaryWinRateButton && secondaryWinRateButton.dataset.listenerAdded !== 'true') {
    secondaryWinRateButton.addEventListener('click', () => exportPlayerMatchupSecondaryCsv('winrate'));
    secondaryWinRateButton.dataset.listenerAdded = 'true';
  }
}

function renderFocusedPlayerMatchupTables(resolvedMatches = [], focusState = currentMatchupPlayerFocus) {
  // Renders the secondary matrices that appear only in Player Matchup mode.
  const tableElements = getMatchupPlayerTableElements();
  const selectedPlayerKey = focusState?.selectedPlayerKey || '';
  const selectedPlayerLabel = focusState?.selectedPlayerLabel || 'Selected Player';

  if (!selectedPlayerKey) {
    renderFocusedPlayerDimensionTable({
      titleElement: tableElements.primaryTitle,
      helperElement: tableElements.primaryHelper,
      headElement: tableElements.primaryHead,
      bodyElement: tableElements.primaryBody,
      title: 'Player Deck vs Opponents',
      helper: 'Each row is one deck the selected player used, and each column is an opponent.',
      emptyMessage: 'Search for a player to inspect deck-by-opponent results across the selected events.',
      cornerLabel: 'Played Deck',
      matrixData: null
    });

    renderFocusedPlayerDimensionTable({
      titleElement: tableElements.secondaryTitle,
      helperElement: tableElements.secondaryHelper,
      headElement: tableElements.secondaryHead,
      bodyElement: tableElements.secondaryBody,
      title: 'Player Deck vs Opposing Decks',
      helper: 'Each row is one deck the selected player used, and each column is an opposing deck.',
      emptyMessage: 'Search for a player to inspect deck-by-opposing-deck results across the selected events.',
      cornerLabel: 'Played Deck',
      matrixData: null
    });
    return;
  }

  const perspectiveMatches = buildFocusedPlayerPerspectiveMatches(resolvedMatches, selectedPlayerKey);
  const opponentPlayerMatrix = aggregateFocusedPlayerDimensionMatrix(perspectiveMatches, {
    getColumnKey: entry => entry.opponentPlayerKey,
    getColumnLabel: entry => entry.opponentPlayer,
    allowMirror: false
  });
  const opponentDeckMatrix = aggregateFocusedPlayerDimensionMatrix(perspectiveMatches, {
    getColumnKey: entry => entry.opponentDeck,
    getColumnLabel: entry => entry.opponentDeck,
    allowMirror: false
  });

  const eventCount = currentMatchupSnapshot?.filteredEvents?.length || 0;
  const rangeLabel = currentMatchupSnapshot?.startDate && currentMatchupSnapshot?.endDate
    ? ` from ${formatDate(currentMatchupSnapshot.startDate)} to ${formatDate(currentMatchupSnapshot.endDate)}`
    : '';
  const eventSummary = eventCount > 0
    ? ` Across ${eventCount} ${pluralize(eventCount, 'event')}${rangeLabel}.`
    : ' No events selected for the current filters.';

  renderFocusedPlayerDimensionTable({
    titleElement: tableElements.primaryTitle,
    helperElement: tableElements.primaryHelper,
    headElement: tableElements.primaryHead,
    bodyElement: tableElements.primaryBody,
    title: `${selectedPlayerLabel}: Deck vs Opponents`,
    helper: `Each row is one deck played by ${selectedPlayerLabel}, and each column is an opponent.${eventSummary}`,
    emptyMessage: `No deck-by-opponent results were found for ${selectedPlayerLabel} in the current range.`,
    cornerLabel: 'Played Deck',
    matrixData: opponentPlayerMatrix,
    allowMirror: false
  });

  renderFocusedPlayerDimensionTable({
    titleElement: tableElements.secondaryTitle,
    helperElement: tableElements.secondaryHelper,
    headElement: tableElements.secondaryHead,
    bodyElement: tableElements.secondaryBody,
    title: `${selectedPlayerLabel}: Deck vs Opposing Decks`,
    helper: `Each row is one deck played by ${selectedPlayerLabel}, and each column is an opposing deck.${eventSummary}`,
    emptyMessage: `No deck-by-opposing-deck results were found for ${selectedPlayerLabel} in the current range.`,
    cornerLabel: 'Played Deck',
    matrixData: opponentDeckMatrix,
    allowMirror: false
  });
}

function renderMatchupMatrixTable(matchupMatrix, resolvedMatches = [], focusState = currentMatchupPlayerFocus) {
  // Renders the primary deck/player matrix table for the active matchup mode.
  if (isPlayerMatchupMode()) {
    renderFocusedPlayerMatchupTables(resolvedMatches, focusState);
    return;
  }

  const viewConfig = getActiveMatchupViewConfig();
  const tableHead = document.getElementById('matchupMatrixTableHead');
  const tableBody = document.getElementById('matchupMatrixTableBody');
  const startDate = getMatchupStartDateSelect()?.value || '';
  const endDate = getMatchupEndDateSelect()?.value || '';
  const totalDeckCount = matchupMatrix.deckOrder.length;
  const displayedDecks = matchupMatrix.deckOrder;
  const activeWindowLabel = getActivePresetDisplayLabel();

  if (!tableHead || !tableBody) {
    return;
  }

  updateElementText(
    'matchupTableTitle',
    displayedDecks.length > 0
      ? `${viewConfig.matrixTitleBase} for ${activeWindowLabel}`
      : viewConfig.matrixTitleBase
  );

  updateElementText(
    'matchupTableHelper',
    resolvedMatches.length > 0 && startDate && endDate
      ? `Each cell shows the row ${viewConfig.entitySingular}'s match win rate against the column ${viewConfig.entitySingular}. Diagonal cells count same-${viewConfig.entitySingular} pairings. Covering ${totalDeckCount} ${pluralize(totalDeckCount, viewConfig.entitySingular)} from ${formatDate(startDate)} to ${formatDate(endDate)}.`
      : `Each cell shows the row ${viewConfig.entitySingular}'s match win rate against the column ${viewConfig.entitySingular}. Diagonal cells count same-${viewConfig.entitySingular} pairings.`
  );

  if (displayedDecks.length === 0) {
    tableHead.innerHTML = `
      <tr>
        <th class="matchup-axis-corner">${escapeHtml(viewConfig.entityTitleSingular)}</th>
        <th>No data</th>
      </tr>
    `;
    tableBody.innerHTML = "<tr><td colspan='2'>No matchup data available for the selected filters.</td></tr>";
    return;
  }

  tableHead.innerHTML = `
    <tr>
      <th scope="col" class="matchup-axis-corner">${escapeHtml(viewConfig.entityTitleSingular)}</th>
      ${displayedDecks.map(deckKey => {
        const deckStats = matchupMatrix.deckStatsMap.get(deckKey);
        return `<th scope="col" class="matchup-matrix-column-header">${buildDeckAxisLabel(deckStats)}</th>`;
      }).join('')}
    </tr>
  `;

  tableBody.innerHTML = displayedDecks
    .map(rowDeck => {
      const rowStats = matchupMatrix.deckStatsMap.get(rowDeck);
      const rowCells = displayedDecks
        .map(columnDeck => {
          const rowLabel = matchupMatrix.deckStatsMap.get(rowDeck)?.deck || rowDeck;
          const columnLabel = matchupMatrix.deckStatsMap.get(columnDeck)?.deck || columnDeck;
          return buildMatrixCellHtml(matchupMatrix.cellMap.get(rowDeck)?.get(columnDeck), rowLabel, columnLabel);
        })
        .join('');

      return `
        <tr>
          <th scope="row" class="matchup-matrix-row-header">${buildDeckAxisLabel(rowStats)}</th>
          ${rowCells}
        </tr>
      `;
    })
    .join('');
}

function renderMatchupSummary(snapshot, matchupMatrix, resolvedMatches = [], focusState = currentMatchupPlayerFocus) {
  // Populates matchup stat cards and helper text from the current matrix.
  const viewConfig = getActiveMatchupViewConfig();
  const summaryElement = document.getElementById('matchupMatrixSummary');
  if (!summaryElement) {
    return;
  }

  if (isPlayerMatchupMode()) {
    if (!focusState?.selectedPlayerKey) {
      summaryElement.textContent = 'Search for a player to see two tables: deck versus opponents, and deck versus opposing decks, across all selected events.';
      return;
    }

    const opponentCount = Math.max(0, matchupMatrix.deckOrder.filter(key => key !== focusState.selectedPlayerKey).length);
    const playedDeckCount = new Set(
      resolvedMatches
        .map(match => getMatchupPlayerDeck(match, focusState.selectedPlayerKey))
        .filter(Boolean)
    ).size;
    const rangeLabel = snapshot.startDate && snapshot.endDate
      ? `${formatDate(snapshot.startDate)} to ${formatDate(snapshot.endDate)}`
      : 'the selected range';

    summaryElement.innerHTML = `
      <strong>${escapeHtml(focusState.selectedPlayerLabel)}</strong> has
      <strong>${resolvedMatches.length}</strong> resolved ${pluralize(resolvedMatches.length, 'match')}
      across <strong>${snapshot.filteredEvents.length}</strong> ${pluralize(snapshot.filteredEvents.length, 'event')}
      against <strong>${opponentCount}</strong> ${pluralize(opponentCount, 'opponent')}
      using <strong>${playedDeckCount}</strong> ${pluralize(playedDeckCount, 'deck')}
      from <strong>${escapeHtml(rangeLabel)}</strong>.
    `;
    return;
  }

  const excludedMatchCount = Math.max(0, snapshot.filteredMatches.length - resolvedMatches.length);
  const totalDeckCount = matchupMatrix.deckOrder.length;
  const eventCount = snapshot.filteredEvents.length;
  const activeWindowLabel = getActivePresetDisplayLabel();

  if (!snapshot.startDate || !snapshot.endDate || eventCount === 0) {
    summaryElement.textContent = viewConfig.emptyMatrixSummary;
    return;
  }

  const rangeLabel = `${formatDate(snapshot.startDate)} to ${formatDate(snapshot.endDate)}`;
  const exclusionLabel = excludedMatchCount > 0
    ? `${excludedMatchCount} filtered pairing${excludedMatchCount === 1 ? '' : 's'} were excluded because a ${viewConfig.entitySingular} name or winner was missing, or the pairing was conflicting.`
    : viewConfig.allResolvedSummaryCopy;

  summaryElement.innerHTML = `
    <strong>${eventCount}</strong> ${pluralize(eventCount, 'event')} from
    <strong>${escapeHtml(activeWindowLabel)}</strong> between
    <strong>${escapeHtml(rangeLabel)}</strong>.
    The matrix is using <strong>${resolvedMatches.length}</strong> resolved ${viewConfig.entitySingular}-vs-${viewConfig.entitySingular}
    ${pluralize(resolvedMatches.length, 'match')} across
    <strong>${totalDeckCount}</strong> ${viewConfig.entityPlural}.
    ${escapeHtml(exclusionLabel)}
  `;
}

function populateMatchupStats(snapshot, matchupMatrix, resolvedMatches = [], focusState = currentMatchupPlayerFocus) {
  const viewConfig = getActiveMatchupViewConfig();
  const mostPlayedDeck = getMostPlayedDeck(matchupMatrix.deckStatsMap);
  const bestWinRateDeck = getBestWinRateDeck(matchupMatrix.deckStatsMap);
  const topPair = matchupMatrix.topPair;
  const leastPair = matchupMatrix.leastPair;
  const totalDeckCount = matchupMatrix.deckOrder.length;
  const topPairLeader = describePairLead(topPair);
  const leastPairLeader = describePairLead(leastPair);

  if (isPlayerMatchupMode()) {
    const opponentCount = focusState?.selectedPlayerKey
      ? Math.max(0, matchupMatrix.deckOrder.filter(key => key !== focusState.selectedPlayerKey).length)
      : 0;
    const focusPlayerStats = focusState?.selectedPlayerKey
      ? matchupMatrix?.deckStatsMap?.get(focusState.selectedPlayerKey) || null
      : null;
    const focusPlayerWinRate = focusPlayerStats?.decisiveMatches > 0
      ? (focusPlayerStats.wins / focusPlayerStats.decisiveMatches) * 100
      : 0;
    const heroMatchup = getFocusedPlayerHeroMatchups(resolvedMatches, focusState?.selectedPlayerKey || '')[0] || null;
    const villainMatchup = getFocusedPlayerVillainMatchups(resolvedMatches, focusState?.selectedPlayerKey || '')[0] || null;
    const playedDeckCount = new Set(
      resolvedMatches
        .map(match => getMatchupPlayerDeck(match, focusState?.selectedPlayerKey || ''))
        .filter(Boolean)
    ).size;

    updateElementText('matchupTotalEvents', String(snapshot.filteredEvents.length || 0));
    updateElementText(
      'matchupTotalEventsDetails',
      focusState?.selectedPlayerKey
        ? `${focusState.selectedPlayerLabel}`
        : 'Search for a player'
    );

    updateElementText('matchupTotalMatches', String(resolvedMatches.length || 0));
    updateElementText(
      'matchupTotalMatchesDetails',
      focusState?.selectedPlayerKey
        ? `Across ${playedDeckCount} ${pluralize(playedDeckCount, 'deck')}`
        : 'Search for a player'
    );

    updateElementText('matchupTrackedDecks', String(opponentCount || 0));
    updateElementText(
      'matchupTrackedDecksDetails',
      focusState?.selectedPlayerKey
        ? `${opponentCount} ${pluralize(opponentCount, 'opponent')} in range`
        : 'No player selected'
    );

    updateElementText('matchupMostPlayedDeckName', focusState?.selectedPlayerLabel || '--');
    updateElementText(
      'matchupMostPlayedDeckDetails',
      focusState?.selectedPlayerKey && focusPlayerStats
        ? `${formatRecordWithWinRate(focusPlayerStats.wins, focusPlayerStats.losses, focusPlayerWinRate)} across ${playedDeckCount} ${pluralize(playedDeckCount, 'deck')}`
        : focusState?.selectedPlayerKey
          ? 'No resolved matches'
          : 'Search for a player'
    );

    updateElementText(
      'matchupMostCommonPairName',
      topPair ? `${topPair.deckOne} vs ${topPair.deckTwo}` : '--'
    );
    updateElementText(
      'matchupMostCommonPairDetails',
      topPair
        ? `${topPair.total} ${pluralize(topPair.total, 'match')} / ${topPairLeader}`
        : focusState?.selectedPlayerKey
          ? 'No sampled pairings'
          : 'Search for a player'
    );

    updateElementText(
      'matchupResultsHeroName',
      heroMatchup?.deck || '--'
    );
    updateElementText(
      'matchupResultsHeroDetails',
      heroMatchup
        ? `${focusState.selectedPlayerLabel} is ${formatRecordWithWinRate(heroMatchup.wins, heroMatchup.losses, heroMatchup.winRate)}, ${formatSignedMatchupSpread(heroMatchup.spread)} spread`
        : focusState?.selectedPlayerKey
          ? 'No winning spread'
          : 'Search for a player'
    );

    updateElementText(
      'matchupResultsVillainName',
      villainMatchup?.deck || '--'
    );
    updateElementText(
      'matchupResultsVillainDetails',
      villainMatchup
        ? `${focusState.selectedPlayerLabel} is ${formatRecordWithWinRate(villainMatchup.wins, villainMatchup.losses, villainMatchup.winRate)}, ${formatSignedMatchupSpread(villainMatchup.spread)} spread`
        : focusState?.selectedPlayerKey
          ? 'No losing spread'
          : 'Search for a player'
    );

    MATCHUP_STAT_CARD_IDS.forEach(triggerUpdateAnimation);
    return;
  }

  updateElementText('matchupTotalEvents', String(snapshot.filteredEvents.length || 0));
  updateElementText(
    'matchupTotalEventsDetails',
    snapshot.startDate && snapshot.endDate
      ? formatDateRange(snapshot.startDate, snapshot.endDate)
      : 'Select a set window'
  );

  updateElementText('matchupTotalMatches', String(resolvedMatches.length || 0));
  updateElementText(
    'matchupTotalMatchesDetails',
    resolvedMatches.length > 0
      ? viewConfig.resolvedMatchCopy
      : 'No resolved matches in range'
  );

  updateElementText('matchupTrackedDecks', String(totalDeckCount || 0));
  updateElementText(
    'matchupTrackedDecksDetails',
    totalDeckCount > 0
      ? `${totalDeckCount} in matrix`
      : viewConfig.noEntitiesAvailableCopy
  );

  updateElementText('matchupMostPlayedDeckName', mostPlayedDeck?.deck || '--');
  updateElementText(
    'matchupMostPlayedDeckDetails',
    mostPlayedDeck
      ? `${mostPlayedDeck.matches} ${pluralize(mostPlayedDeck.matches, 'match')} / ${getDeckRecordSummary(mostPlayedDeck)}`
      : viewConfig.noEntitySamplesCopy
  );

  updateElementText(
    'matchupMostCommonPairName',
    topPair ? `${topPair.deckOne} vs ${topPair.deckTwo}` : '--'
  );
  updateElementText(
    'matchupMostCommonPairDetails',
    topPair
      ? `${topPair.total} ${pluralize(topPair.total, 'match')} / ${topPairLeader}`
      : 'No sampled pairings'
  );

  updateElementText(
    'matchupResultsHeroName',
    leastPair ? `${leastPair.deckOne} vs ${leastPair.deckTwo}` : '--'
  );
  updateElementText(
    'matchupResultsHeroDetails',
    leastPair
      ? `${leastPair.total} ${pluralize(leastPair.total, 'match')} / ${leastPairLeader}`
      : 'No sampled pairings'
  );

  updateElementText('matchupResultsVillainName', bestWinRateDeck?.deck || '--');
  updateElementText(
    'matchupResultsVillainDetails',
    bestWinRateDeck
      ? `${formatMatchupPercentage((bestWinRateDeck.wins / bestWinRateDeck.decisiveMatches) * 100)} WR / ${bestWinRateDeck.wins}-${bestWinRateDeck.losses} in ${bestWinRateDeck.decisiveMatches} ${pluralize(bestWinRateDeck.decisiveMatches, 'match')}`
      : `No decisive ${viewConfig.entitySingular} samples`
  );

  MATCHUP_STAT_CARD_IDS.forEach(triggerUpdateAnimation);
}

function getExtremeItems(items = [], getValue, mode = 'max') {
  if (!items.length) {
    return [];
  }

  const comparator = mode === 'min' ? Math.min : Math.max;
  const targetValue = comparator(...items.map(item => getValue(item)));

  return items.filter(item => getValue(item) === targetValue);
}

function getMatchPairKey(deckOne = '', deckTwo = '') {
  return [normalizeMatchupEntityKey(deckOne), normalizeMatchupEntityKey(deckTwo)]
    .sort((left, right) => left.localeCompare(right))
    .join('|||');
}

function getPairKeyFromMatch(match) {
  const entityA = getMatchEntityInfo(match, 'a');
  const entityB = getMatchEntityInfo(match, 'b');
  return getMatchPairKey(entityA.key, entityB.key);
}

function getMatchupToneClass(winRate) {
  if (winRate >= 55) {
    return 'above-average';
  }

  if (winRate <= 45) {
    return 'below-average';
  }

  return 'mixed-average';
}

function getDeckOpponentSummaries(deckKey = '', matchupMatrix = currentMatchupMatrix) {
  const rowCells = matchupMatrix?.cellMap?.get(deckKey);
  if (!rowCells) {
    return [];
  }

  return Array.from(rowCells.entries())
    .filter(([opponentKey, cell]) => opponentKey !== deckKey && cell?.total > 0)
    .map(([opponentKey, cell]) => ({
      key: opponentKey,
      deck: matchupMatrix?.deckStatsMap?.get(opponentKey)?.deck || opponentKey,
      wins: cell.wins,
      losses: cell.losses,
      total: cell.total,
      winRate: cell.total > 0 ? (cell.wins / cell.total) * 100 : 0
    }))
    .sort((a, b) => {
      return (
        b.total - a.total ||
        b.winRate - a.winRate ||
        a.deck.localeCompare(b.deck)
      );
    });
}

function getMatchupDeckSummaries(matchupMatrix = currentMatchupMatrix) {
  if (!matchupMatrix?.deckOrder?.length) {
    return [];
  }

  return matchupMatrix.deckOrder
    .map(deckKey => {
      const deckStats = matchupMatrix.deckStatsMap.get(deckKey);
      const opponents = getDeckOpponentSummaries(deckKey, matchupMatrix);
      const bestOpponent = [...opponents].sort((a, b) => {
        return (
          b.winRate - a.winRate ||
          b.total - a.total ||
          a.deck.localeCompare(b.deck)
        );
      })[0] || null;
      const worstOpponent = [...opponents].sort((a, b) => {
        return (
          a.winRate - b.winRate ||
          b.total - a.total ||
          a.deck.localeCompare(b.deck)
        );
      })[0] || null;

      return {
        ...deckStats,
        eventCount: deckStats?.eventIds?.size || 0,
        winRate: deckStats?.decisiveMatches > 0 ? (deckStats.wins / deckStats.decisiveMatches) * 100 : 0,
        bestOpponent,
        worstOpponent,
        opponents
      };
    })
    .filter(Boolean);
}

function getMatchupPairSummaries(matchupMatrix = currentMatchupMatrix) {
  return (matchupMatrix?.pairStatsList || [])
    .map(pairStats => ({
      ...pairStats,
      key: getMatchPairKey(pairStats.deckOneKey || pairStats.deckOne, pairStats.deckTwoKey || pairStats.deckTwo),
      eventCount: pairStats?.eventIds?.size || 0,
      leaderText: describePairLead(pairStats),
      deckOneWinRate: pairStats.total > 0 ? (pairStats.winsOne / pairStats.total) * 100 : 0,
      deckTwoWinRate: pairStats.total > 0 ? (pairStats.winsTwo / pairStats.total) * 100 : 0
    }))
    .sort((a, b) => {
      return (
        b.total - a.total ||
        Math.max(b.winsOne, b.winsTwo) - Math.max(a.winsOne, a.winsTwo) ||
        a.deckOne.localeCompare(b.deckOne) ||
        a.deckTwo.localeCompare(b.deckTwo)
      );
    });
}

function getMatchupEventSummaries(snapshot = currentMatchupSnapshot, resolvedMatches = currentResolvedMatchupMatches) {
  if (!snapshot?.filteredEvents?.length) {
    return [];
  }

  const viewConfig = getActiveMatchupViewConfig();
  const eventSummaryMap = new Map(
    snapshot.filteredEvents.map(event => [
      String(event.event_id || '').trim(),
      {
        ...event,
        matchCount: 0,
        deckSet: new Set(),
        deckNameMap: new Map(),
        pairCounts: new Map()
      }
    ])
  );

  (resolvedMatches || []).forEach(match => {
    const eventId = String(match?.event_id || '').trim();
    const summary = eventSummaryMap.get(eventId);
    if (!summary) {
      return;
    }

    summary.matchCount += 1;

    const entityA = getMatchEntityInfo(match, 'a');
    const entityB = getMatchEntityInfo(match, 'b');
    if (entityA.key) {
      summary.deckSet.add(entityA.key);
      summary.deckNameMap.set(entityA.key, entityA.name);
    }
    if (entityB.key) {
      summary.deckSet.add(entityB.key);
      summary.deckNameMap.set(entityB.key, entityB.name);
    }

    if (entityA.key && entityB.key && entityA.key !== entityB.key) {
      const pairLabel = [entityA.name, entityB.name].sort((left, right) => left.localeCompare(right)).join(' vs ');
      summary.pairCounts.set(pairLabel, (summary.pairCounts.get(pairLabel) || 0) + 1);
    }
  });

  return Array.from(eventSummaryMap.values())
    .map(summary => {
      const topPairEntry = Array.from(summary.pairCounts.entries()).sort((a, b) => {
        return b[1] - a[1] || a[0].localeCompare(b[0]);
      })[0] || null;

      return {
        ...summary,
        deckCount: summary.deckSet.size,
        deckLabel: viewConfig.eventSampleEntityLabel,
        topPairLabel: topPairEntry ? `${topPairEntry[0]} (${topPairEntry[1]})` : '--'
      };
    })
    .sort((a, b) => {
      return (
        String(b.date || '').localeCompare(String(a.date || '')) ||
        String(a.event || '').localeCompare(String(b.event || ''))
      );
    });
}

function buildMatchupSummaryItem(label, value) {
  return `
    <div class="player-rank-drilldown-summary-item">
      <span class="player-rank-drilldown-summary-label">${escapeHtml(label)}</span>
      <strong class="player-rank-drilldown-summary-value">${escapeHtml(value)}</strong>
    </div>
  `;
}

function buildMatchupSummaryBadgeItem(label, badgeHtml) {
  return `
    <div class="player-rank-drilldown-summary-item">
      <span class="player-rank-drilldown-summary-label">${escapeHtml(label)}</span>
      <strong class="player-rank-drilldown-summary-value">${badgeHtml}</strong>
    </div>
  `;
}

function buildMatchupEventListHtml(entries = []) {
  if (!entries.length) {
    return '<div class="player-rank-drilldown-empty">No events found.</div>';
  }

  const viewConfig = getActiveMatchupViewConfig();
  const playerSummaryLabel = viewConfig.mode === 'player-matchup' ? 'Event Players' : 'Players';

  return `
    <div class="event-stat-drilldown-toolbar">
      <div class="event-stat-drilldown-toolbar-note">Each event card summarizes the resolved matchup sample that is currently feeding the matrix.</div>
    </div>
    ${entries.map(entry => {
      const formattedEventName = formatEventName(entry.event) || entry.event || 'Unknown Event';
      const dateLabel = entry.date ? formatDate(entry.date) : '--';
      const groupLabel = formatGroupDisplayLabel(getEventGroupInfo(entry.event).shortLabel || entry.event_display_name || '--');

      return `
        <article class="player-rank-drilldown-event">
          <div class="player-rank-drilldown-event-header">
            <div>
              <div class="player-rank-drilldown-event-date">${escapeHtml(`${dateLabel} | ${groupLabel}`)}</div>
              <h4 class="player-rank-drilldown-event-name">${escapeHtml(formattedEventName)}</h4>
            </div>
            <span class="player-rank-drilldown-rank-badge">${escapeHtml(`${entry.matchCount} ${pluralize(entry.matchCount, 'match')}`)}</span>
          </div>
          <div class="player-rank-drilldown-summary-grid">
            ${buildMatchupSummaryItem('Resolved Matches', `${entry.matchCount}`)}
            ${buildMatchupSummaryItem(viewConfig.eventSampleEntityLabel, `${entry.deckCount}`)}
            ${buildMatchupSummaryItem(playerSummaryLabel, `${entry.player_count || entry.input_player_count || 0}`)}
            ${buildMatchupSummaryItem('Most Sampled Pair', entry.topPairLabel)}
          </div>
          <div class="event-stat-drilldown-toolbar">
            <button
              type="button"
              class="bubble-button"
              data-matchup-open-event-analysis="${escapeHtml(String(entry.event || '').trim())}"
              data-matchup-open-event-type="${escapeHtml(String(entry.event_type || '').trim().toLowerCase())}"
            >
              Open in Event Analysis
            </button>
          </div>
        </article>
      `;
    }).join('')}
  `;
}

function buildMatchupDeckListHtml(deckSummaries = [], noteText = '') {
  if (!deckSummaries.length) {
    return '<div class="player-rank-drilldown-empty">No matchup summaries found.</div>';
  }

  const viewConfig = getActiveMatchupViewConfig();
  const resolvedNoteText = noteText || viewConfig.listRankingNote;

  return `
    <div class="event-stat-drilldown-toolbar">
      <div class="event-stat-drilldown-toolbar-note">${escapeHtml(resolvedNoteText)}</div>
    </div>
    <div class="player-drilldown-event-list">
      ${deckSummaries.map(summary => {
        const tone = getMatchupToneClass(summary.winRate);
        return `
          <div class="player-drilldown-event-list-item player-drilldown-event-list-item-${tone}">
            <div class="player-drilldown-event-list-main">
              <strong>${escapeHtml(summary.deck)}</strong>
              <div class="player-drilldown-event-list-main-lines">
                <span>${escapeHtml(`${summary.matches} ${pluralize(summary.matches, 'match')} | ${summary.eventCount} ${pluralize(summary.eventCount, 'event')}`)}</span>
                <span>${escapeHtml(`Best: ${summary.bestOpponent ? `${summary.bestOpponent.deck} (${formatMatchupPercentage(summary.bestOpponent.winRate)})` : '--'} | Worst: ${summary.worstOpponent ? `${summary.worstOpponent.deck} (${formatMatchupPercentage(summary.worstOpponent.winRate)})` : '--'}`)}</span>
              </div>
            </div>
            <div class="player-drilldown-event-list-meta">
              <span class="player-drilldown-event-list-tone player-drilldown-event-list-tone-${tone}">${escapeHtml(formatMatchupPercentage(summary.winRate))}</span>
              <span>${escapeHtml(`${summary.wins}-${summary.losses}`)}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function buildMatchupDeckDetailHtml(summary) {
  // Builds tracked-entity drilldown detail for one deck/player summary.
  if (!summary) {
    return '<div class="player-rank-drilldown-empty">Matchup details are unavailable.</div>';
  }

  const viewConfig = getActiveMatchupViewConfig();
  const tone = getMatchupToneClass(summary.winRate);
  const opponentRows = summary.opponents.slice(0, 10);

  return `
    <article class="player-rank-drilldown-event">
      <div class="player-rank-drilldown-event-header">
        <div>
          <div class="player-rank-drilldown-event-date">${escapeHtml(`${summary.eventCount} ${pluralize(summary.eventCount, 'event')} | ${summary.matches} ${pluralize(summary.matches, 'match')}`)}</div>
          <h4 class="player-rank-drilldown-event-name">${escapeHtml(summary.deck)}</h4>
        </div>
        <span class="player-rank-drilldown-rank-badge">${escapeHtml(formatMatchupPercentage(summary.winRate))}</span>
      </div>
      <div class="player-rank-drilldown-summary-grid">
        ${buildMatchupSummaryItem('Record', `${summary.wins}-${summary.losses}`)}
        ${buildMatchupSummaryItem('Decisive Matches', `${summary.decisiveMatches}`)}
        ${buildMatchupSummaryItem(viewConfig.sameEntityMetricTitle, `${summary.mirrors}`)}
        ${buildMatchupSummaryItem('Best Opponent', summary.bestOpponent ? `${summary.bestOpponent.deck} (${formatMatchupPercentage(summary.bestOpponent.winRate)})` : '--')}
        ${buildMatchupSummaryItem('Worst Opponent', summary.worstOpponent ? `${summary.worstOpponent.deck} (${formatMatchupPercentage(summary.worstOpponent.winRate)})` : '--')}
        ${buildMatchupSummaryBadgeItem('Performance Band', buildMatchupPerformanceBandBadge(tone))}
      </div>
      <div class="player-rank-drilldown-context">
        <div class="player-rank-drilldown-context-title">Opponent Breakdown</div>
        ${
          opponentRows.length > 0
            ? `
              <div class="player-drilldown-event-list">
                ${opponentRows.map(opponent => {
                  const opponentTone = getMatchupToneClass(opponent.winRate);
                  return `
                    <div class="player-drilldown-event-list-item player-drilldown-event-list-item-${opponentTone}">
                      <div class="player-drilldown-event-list-main">
                        <strong>${escapeHtml(opponent.deck)}</strong>
                        <div class="player-drilldown-event-list-main-lines">
                          <span>${escapeHtml(`${opponent.total} ${pluralize(opponent.total, 'match')} sampled`)}</span>
                          <span>${escapeHtml(`${opponent.wins}-${opponent.losses} record`)}</span>
                        </div>
                      </div>
                      <div class="player-drilldown-event-list-meta">
                        <span class="player-drilldown-event-list-tone player-drilldown-event-list-tone-${opponentTone}">${escapeHtml(formatMatchupPercentage(opponent.winRate))}</span>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `
            : '<div class="player-drilldown-event-list-empty">No opponent splits are available.</div>'
        }
      </div>
    </article>
  `;
}

function buildMatchupPairListHtml(pairSummaries = [], noteText = 'Pairings are ranked by how often they appear in the current filters.') {
  if (!pairSummaries.length) {
    return '<div class="player-rank-drilldown-empty">No pairings found.</div>';
  }

  return `
    <div class="event-stat-drilldown-toolbar">
      <div class="event-stat-drilldown-toolbar-note">${escapeHtml(noteText)}</div>
    </div>
    <div class="player-drilldown-event-list">
      ${pairSummaries.map(summary => {
        const dominantWinRate = Math.max(summary.deckOneWinRate, summary.deckTwoWinRate);
        const tone = getMatchupToneClass(dominantWinRate);
        return `
          <div class="player-drilldown-event-list-item player-drilldown-event-list-item-${tone}">
            <div class="player-drilldown-event-list-main">
              <strong>${escapeHtml(`${summary.deckOne} vs ${summary.deckTwo}`)}</strong>
              <div class="player-drilldown-event-list-main-lines">
                <span>${escapeHtml(`${summary.total} ${pluralize(summary.total, 'match')} | ${summary.eventCount} ${pluralize(summary.eventCount, 'event')}`)}</span>
                <span>${escapeHtml(summary.leaderText)}</span>
              </div>
            </div>
            <div class="player-drilldown-event-list-meta">
              <span class="player-drilldown-event-list-tone player-drilldown-event-list-tone-${tone}">${escapeHtml(formatMatchupPercentage(dominantWinRate))}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function getPairEventBreakdown(pairSummary) {
  if (!pairSummary?.key) {
    return [];
  }

  const eventMap = new Map();

  currentResolvedMatchupMatches
    .filter(match => getPairKeyFromMatch(match) === pairSummary.key)
    .forEach(match => {
      const eventId = String(match.event_id || '').trim();
      const eventKey = eventId || `${match.date || ''}::${match.event || ''}`;

      if (!eventMap.has(eventKey)) {
        eventMap.set(eventKey, {
          event: match.event,
          date: match.date,
          eventType: match.event_type,
          total: 0,
          winsOne: 0,
          winsTwo: 0
        });
      }

      const summary = eventMap.get(eventKey);
      summary.total += 1;

      const winnerEntity = String(match.outcome || '') === 'player_a_win'
        ? getMatchEntityInfo(match, 'a')
        : getMatchEntityInfo(match, 'b');

      if (winnerEntity.key === pairSummary.deckOneKey) {
        summary.winsOne += 1;
      } else if (winnerEntity.key === pairSummary.deckTwoKey) {
        summary.winsTwo += 1;
      }
    });

  return Array.from(eventMap.values()).sort((a, b) => {
    return String(b.date || '').localeCompare(String(a.date || '')) || String(a.event || '').localeCompare(String(b.event || ''));
  });
}

function buildMatchupPairDetailHtml(summary) {
  // Builds drilldown detail for one matchup pair.
  if (!summary) {
    return '<div class="player-rank-drilldown-empty">Pairing details are unavailable.</div>';
  }

  const eventBreakdown = getPairEventBreakdown(summary);
  const dominantWinRate = Math.max(summary.deckOneWinRate, summary.deckTwoWinRate);
  const tone = getMatchupToneClass(dominantWinRate);

  return `
    <article class="player-rank-drilldown-event">
      <div class="player-rank-drilldown-event-header">
        <div>
          <div class="player-rank-drilldown-event-date">${escapeHtml(`${summary.eventCount} ${pluralize(summary.eventCount, 'event')} | ${summary.firstDate || '--'} to ${summary.lastDate || '--'}`)}</div>
          <h4 class="player-rank-drilldown-event-name">${escapeHtml(`${summary.deckOne} vs ${summary.deckTwo}`)}</h4>
        </div>
        <span class="player-rank-drilldown-rank-badge">${escapeHtml(`${summary.total} ${pluralize(summary.total, 'match')}`)}</span>
      </div>
      <div class="player-rank-drilldown-summary-grid">
        ${buildMatchupSummaryItem(summary.deckOne, `${summary.winsOne}-${summary.winsTwo} | ${formatMatchupPercentage(summary.deckOneWinRate)}`)}
        ${buildMatchupSummaryItem(summary.deckTwo, `${summary.winsTwo}-${summary.winsOne} | ${formatMatchupPercentage(summary.deckTwoWinRate)}`)}
        ${buildMatchupSummaryItem('Leader', summary.leaderText)}
        ${buildMatchupSummaryBadgeItem('Performance Band', buildMatchupPerformanceBandBadge(tone))}
      </div>
      <div class="player-rank-drilldown-context">
        <div class="player-rank-drilldown-context-title">Event Breakdown</div>
        ${
          eventBreakdown.length > 0
            ? `
              <div class="player-drilldown-event-list">
                ${eventBreakdown.map(entry => `
                  <div class="player-drilldown-event-list-item">
                    <div class="player-drilldown-event-list-main">
                      <strong>${escapeHtml(formatEventName(entry.event) || entry.event || 'Unknown Event')}</strong>
                      <div class="player-drilldown-event-list-main-lines">
                        <span>${escapeHtml(entry.date ? formatDate(entry.date) : '--')}</span>
                        <span>${escapeHtml(`${summary.deckOne} ${entry.winsOne}-${entry.winsTwo} ${summary.deckTwo}`)}</span>
                      </div>
                    </div>
                    <div class="player-drilldown-event-list-meta">
                      <span>${escapeHtml(`${entry.total} ${pluralize(entry.total, 'match')}`)}</span>
                    </div>
                  </div>
                `).join('')}
              </div>
            `
            : '<div class="player-drilldown-event-list-empty">No event breakdown is available.</div>'
        }
      </div>
    </article>
  `;
}

function buildFocusedPlayerSpreadDetailHtml(summary) {
  if (!summary) {
    return '<div class="player-rank-drilldown-empty">Matchup details are unavailable.</div>';
  }

  const focusPlayerLabel = currentMatchupPlayerFocus?.selectedPlayerLabel || 'Focused Player';
  const eventBreakdown = getFocusedPlayerOpponentEventBreakdown(summary.key);
  const tone = getMatchupToneClass(summary.winRate);
  const spreadLabel = `${formatSignedMatchupSpread(summary.spread)} spread`;

  return `
    <article class="player-rank-drilldown-event">
      <div class="player-rank-drilldown-event-header">
        <div>
          <div class="player-rank-drilldown-event-date">${escapeHtml(`${summary.eventCount} ${pluralize(summary.eventCount, 'event')} | ${summary.firstDate ? formatDate(summary.firstDate) : '--'} to ${summary.lastDate ? formatDate(summary.lastDate) : '--'}`)}</div>
          <h4 class="player-rank-drilldown-event-name">${escapeHtml(summary.deck)}</h4>
        </div>
        <span class="player-rank-drilldown-rank-badge">${escapeHtml(spreadLabel)}</span>
      </div>
      <div class="player-rank-drilldown-summary-grid">
        ${buildMatchupSummaryItem('Focus Player', focusPlayerLabel)}
        ${buildMatchupSummaryItem('Record', `${summary.wins}-${summary.losses}`)}
        ${buildMatchupSummaryItem('Win Rate', formatMatchupPercentage(summary.winRate))}
        ${buildMatchupSummaryItem('Spread', spreadLabel)}
        ${buildMatchupSummaryItem('Played Decks', formatCompactMatchupNameList(summary.playerDecks))}
        ${buildMatchupSummaryItem('Opposing Decks', formatCompactMatchupNameList(summary.opponentDecks))}
        ${buildMatchupSummaryBadgeItem('Performance Band', buildMatchupPerformanceBandBadge(tone))}
      </div>
      <div class="player-rank-drilldown-context">
        <div class="player-rank-drilldown-context-title">Event Breakdown</div>
        ${
          eventBreakdown.length > 0
            ? `
              <div class="player-drilldown-event-list">
                ${eventBreakdown.map(entry => {
                  const eventWinRate = entry.total > 0 ? (entry.wins / entry.total) * 100 : 0;
                  const eventTone = getMatchupToneClass(eventWinRate);
                  return `
                    <div class="player-drilldown-event-list-item player-drilldown-event-list-item-${eventTone}">
                      <div class="player-drilldown-event-list-main">
                        <strong>${escapeHtml(formatEventName(entry.event) || entry.event || 'Unknown Event')}</strong>
                        <div class="player-drilldown-event-list-main-lines">
                          <span>${escapeHtml(entry.date ? formatDate(entry.date) : '--')}</span>
                          <span>${escapeHtml(`${entry.wins}-${entry.losses} record`)}</span>
                          <span>${escapeHtml(`Played: ${formatCompactMatchupNameList(entry.playerDecks)}`)}</span>
                          <span>${escapeHtml(`Opponent: ${formatCompactMatchupNameList(entry.opponentDecks)}`)}</span>
                        </div>
                      </div>
                      <div class="player-drilldown-event-list-meta">
                        <span class="player-drilldown-event-list-tone player-drilldown-event-list-tone-${eventTone}">${escapeHtml(formatMatchupPercentage(eventWinRate))}</span>
                        <span>${escapeHtml(`${entry.total} ${pluralize(entry.total, 'match')}`)}</span>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `
            : '<div class="player-drilldown-event-list-empty">No event breakdown is available.</div>'
        }
      </div>
    </article>
  `;
}

function buildFocusedPlayerDeckPairDetailHtml(summary) {
  if (!summary) {
    return '<div class="player-rank-drilldown-empty">Matchup details are unavailable.</div>';
  }

  const focusPlayerLabel = currentMatchupPlayerFocus?.selectedPlayerLabel || 'Focused Player';
  const eventBreakdown = getFocusedPlayerDeckPairEventBreakdown(summary.key);
  const tone = getMatchupToneClass(summary.winRate);
  const spreadLabel = `${formatSignedMatchupSpread(summary.spread)} spread`;

  return `
    <article class="player-rank-drilldown-event">
      <div class="player-rank-drilldown-event-header">
        <div>
          <div class="player-rank-drilldown-event-date">${escapeHtml(`${summary.eventCount} ${pluralize(summary.eventCount, 'event')} | ${summary.firstDate ? formatDate(summary.firstDate) : '--'} to ${summary.lastDate ? formatDate(summary.lastDate) : '--'}`)}</div>
          <h4 class="player-rank-drilldown-event-name">${escapeHtml(`${summary.playerDeck} vs ${summary.opponentDeck}`)}</h4>
        </div>
        <span class="player-rank-drilldown-rank-badge">${escapeHtml(formatMatchupPercentage(summary.winRate))}</span>
      </div>
      <div class="player-rank-drilldown-summary-grid">
        ${buildMatchupSummaryItem('Focus Player', focusPlayerLabel)}
        ${buildMatchupSummaryItem('Record', `${summary.wins}-${summary.losses}`)}
        ${buildMatchupSummaryItem('Win Rate', formatMatchupPercentage(summary.winRate))}
        ${buildMatchupSummaryItem('Spread', spreadLabel)}
        ${buildMatchupSummaryItem('Played Deck', summary.playerDeck)}
        ${buildMatchupSummaryItem('Opponent Deck', summary.opponentDeck)}
        ${buildMatchupSummaryBadgeItem('Performance Band', buildMatchupPerformanceBandBadge(tone))}
      </div>
      <div class="player-rank-drilldown-context">
        <div class="player-rank-drilldown-context-title">Event Breakdown</div>
        ${
          eventBreakdown.length > 0
            ? `
              <div class="player-drilldown-event-list">
                ${eventBreakdown.map(entry => {
                  const eventWinRate = entry.total > 0 ? (entry.wins / entry.total) * 100 : 0;
                  const eventTone = getMatchupToneClass(eventWinRate);
                  return `
                    <div class="player-drilldown-event-list-item player-drilldown-event-list-item-${eventTone}">
                      <div class="player-drilldown-event-list-main">
                        <strong>${escapeHtml(formatEventName(entry.event) || entry.event || 'Unknown Event')}</strong>
                        <div class="player-drilldown-event-list-main-lines">
                          <span>${escapeHtml(entry.date ? formatDate(entry.date) : '--')}</span>
                          <span>${escapeHtml(`${entry.wins}-${entry.losses} record`)}</span>
                          <span>${escapeHtml(`Played: ${formatCompactMatchupNameList(entry.playerDecks)}`)}</span>
                          <span>${escapeHtml(`Opponent: ${formatCompactMatchupNameList(entry.opponentDecks)}`)}</span>
                        </div>
                      </div>
                      <div class="player-drilldown-event-list-meta">
                        <span class="player-drilldown-event-list-tone player-drilldown-event-list-tone-${eventTone}">${escapeHtml(formatMatchupPercentage(eventWinRate))}</span>
                        <span>${escapeHtml(`${entry.total} ${pluralize(entry.total, 'match')}`)}</span>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `
            : '<div class="player-drilldown-event-list-empty">No event breakdown is available.</div>'
        }
      </div>
    </article>
  `;
}

function getMatchupDrilldownItems(categoryKey) {
  const eventSummaries = getMatchupEventSummaries();
  const deckSummaries = getMatchupDeckSummaries();
  const pairSummaries = getMatchupPairSummaries();
  const focusedPlayerKey = currentMatchupPlayerFocus?.selectedPlayerKey || '';
  const hasFocusedPlayer = isPlayerMatchupMode() && Boolean(focusedPlayerKey);
  const heroMatchups = hasFocusedPlayer ? getFocusedPlayerHeroMatchups(currentResolvedMatchupMatches, focusedPlayerKey) : [];
  const villainMatchups = hasFocusedPlayer ? getFocusedPlayerVillainMatchups(currentResolvedMatchupMatches, focusedPlayerKey) : [];

  switch (categoryKey) {
    case 'totalEvents':
      return eventSummaries;
    case 'trackedDecks':
      return isPlayerMatchupMode() && currentMatchupPlayerFocus?.selectedPlayerKey
        ? deckSummaries.filter(item => item.key !== currentMatchupPlayerFocus.selectedPlayerKey)
        : deckSummaries;
    case 'mostPlayedDeck':
      if (hasFocusedPlayer) {
        return deckSummaries.filter(item => item.key === focusedPlayerKey);
      }
      return getExtremeItems(deckSummaries, item => item.matches, 'max');
    case 'mostCommonPair':
      return getExtremeItems(pairSummaries, item => item.total, 'max');
    case 'leastCommonPair':
      if (hasFocusedPlayer) {
        return getExtremeItems(heroMatchups, item => item.spread, 'max');
      }
      return getExtremeItems(pairSummaries, item => item.total, 'min');
    case 'bestWinRate':
      if (hasFocusedPlayer) {
        return getExtremeItems(villainMatchups, item => item.lossSpread, 'max');
      }
      return getExtremeItems(
        deckSummaries.filter(item => item.decisiveMatches > 0),
        item => item.winRate,
        'max'
      );
    default:
      return [];
  }
}

function updateMatchupDrilldownCardStates() {
  cleanupStaticMatchupCard('matchupTotalMatchesCard');

  Object.entries(getMatchupDrilldownConfig()).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card) {
      return;
    }

    const itemCount = getMatchupDrilldownItems(categoryKey).length;
    const isDisabled = itemCount === 0;

    card.classList.add('drilldown-card');
    card.classList.toggle('drilldown-disabled', isDisabled);
    card.setAttribute('role', 'button');
    card.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
    card.tabIndex = isDisabled ? -1 : 0;
    card.title = isDisabled ? config.emptyMessage : `Open ${config.title.toLowerCase()} details`;
  });
}

function renderMatchupDrilldown(categoryKey) {
  // Rebuilds the matchup stat-card modal for the requested category.
  const elements = getMatchupDrilldownElements();
  const drilldownConfig = getMatchupDrilldownConfig();
  const config = drilldownConfig[categoryKey];
  const viewConfig = getActiveMatchupViewConfig();
  const hasFocusedPlayer = isPlayerMatchupMode() && Boolean(currentMatchupPlayerFocus?.selectedPlayerKey);
  if (!config || !elements.overlay || !elements.title || !elements.subtitle || !elements.content) {
    return;
  }

  const items = getMatchupDrilldownItems(categoryKey);
  elements.title.textContent = config.title;

  if (categoryKey === 'totalEvents') {
    elements.subtitle.textContent = items.length > 0
      ? `${items.length} event${items.length === 1 ? '' : 's'} contributing to the current matchup matrix`
      : config.emptyMessage;
    elements.content.innerHTML = items.length > 0
      ? buildMatchupEventListHtml(items)
      : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
    return;
  }

  if (categoryKey === 'trackedDecks') {
    elements.subtitle.textContent = items.length > 0
      ? `${items.length} tracked ${viewConfig.entitySingular}${items.length === 1 ? '' : 's'} in the current matchup matrix`
      : config.emptyMessage;
    elements.content.innerHTML = items.length > 0
      ? buildMatchupDeckListHtml(items)
      : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
    return;
  }

  if (hasFocusedPlayer && categoryKey === 'mostPlayedDeck') {
    elements.subtitle.textContent = items.length > 0
      ? `${currentMatchupPlayerFocus.selectedPlayerLabel}'s aggregate matchup record across the current filters`
      : config.emptyMessage;
    elements.content.innerHTML = items.length > 0
      ? items.map(buildMatchupDeckDetailHtml).join('')
      : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
    return;
  }

  if (hasFocusedPlayer && (categoryKey === 'leastCommonPair' || categoryKey === 'bestWinRate')) {
    elements.subtitle.textContent = items.length > 0
      ? `${items.length} matchup${items.length === 1 ? '' : 's'} matched the current ${config.title.toLowerCase()} spread`
      : config.emptyMessage;
    elements.content.innerHTML = items.length > 0
      ? items.map(buildFocusedPlayerSpreadDetailHtml).join('')
      : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
    return;
  }

  if (categoryKey === 'mostPlayedDeck' || categoryKey === 'bestWinRate') {
    const deckCount = items.length;
    elements.subtitle.textContent = deckCount > 0
      ? `${deckCount} ${viewConfig.entitySingular}${deckCount === 1 ? '' : 's'} matched the current ${config.title.toLowerCase()} filter`
      : config.emptyMessage;
    elements.content.innerHTML = deckCount > 0
      ? items.map(buildMatchupDeckDetailHtml).join('')
      : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
    return;
  }

  const pairCount = items.length;
  elements.subtitle.textContent = pairCount > 0
    ? `${pairCount} pairing${pairCount === 1 ? '' : 's'} matched the current ${config.title.toLowerCase()} filter`
    : config.emptyMessage;
  elements.content.innerHTML = pairCount > 0
    ? items.map(buildMatchupPairDetailHtml).join('')
    : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
}

function openMatchupDrilldown(categoryKey) {
  const elements = getMatchupDrilldownElements();
  if (!elements.overlay || !getMatchupDrilldownConfig()[categoryKey]) {
    return;
  }

  activeMatchupDrilldownCategory = categoryKey;
  renderMatchupDrilldown(categoryKey);
  elements.overlay.hidden = false;
  document.body.classList.add('modal-open');
}

function closeMatchupDrilldown() {
  const { overlay } = getMatchupDrilldownElements();
  if (!overlay) {
    return;
  }

  overlay.hidden = true;
  activeMatchupDrilldownCategory = '';
  document.body.classList.remove('modal-open');
}

function openMatchupEventInAnalysis(eventName = '', eventType = '') {
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

  import('./filters/filter-index.js').then(module => {
    if (normalizedEventType) {
      module.setSingleEventType(normalizedEventType);
    }
    module.updateEventFilter(normalizedEventName, true);

    const eventFilterMenu = document.getElementById('eventFilterMenu');
    if (eventFilterMenu) {
      eventFilterMenu.dispatchEvent(new Event('change'));
    }

    closeMatchupDrilldown();
    window.scrollTo(0, 0);
  });
}

function setupMatchupDrilldownModal() {
  const { overlay, closeButton, content } = getMatchupDrilldownElements();
  if (!overlay || overlay.dataset.initialized === 'true') {
    return;
  }

  overlay.dataset.initialized = 'true';

  closeButton?.addEventListener('click', closeMatchupDrilldown);

  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      closeMatchupDrilldown();
    }
  });

  content?.addEventListener('click', event => {
    const openEventAnalysisButton = event.target.closest('[data-matchup-open-event-analysis]');
    if (!openEventAnalysisButton) {
      return;
    }

    openMatchupEventInAnalysis(
      openEventAnalysisButton.dataset.matchupOpenEventAnalysis,
      openEventAnalysisButton.dataset.matchupOpenEventType
    );
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) {
      closeMatchupDrilldown();
    }
  });
}

function setupMatchupDrilldownCards() {
  Object.entries(getMatchupDrilldownConfig()).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card || card.dataset.drilldownBound === 'true') {
      return;
    }

    card.dataset.drilldownBound = 'true';

    const openIfEnabled = () => {
      if (card.getAttribute('aria-disabled') === 'true') {
        return;
      }

      openMatchupDrilldown(categoryKey);
    };

    card.addEventListener('click', openIfEnabled);
    card.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && card.getAttribute('aria-disabled') !== 'true') {
        event.preventDefault();
        openMatchupDrilldown(categoryKey);
      }
    });
  });
}

function setupMatchupFilterListeners() {
  // Wires event-type, date, quick-view, player-focus, and fullscreen controls.
  const eventTypeButtons = getMatchupEventTypeButtons();
  const quickViewRoot = getMatchupQuickViewRoot();
  const startDateSelect = getMatchupStartDateSelect();
  const endDateSelect = getMatchupEndDateSelect();
  const { playerSelect } = getMatchupPlayerFocusElements();

  eventTypeButtons.forEach(button => {
    button.addEventListener('click', () => {
      setMatchupEventType(button.dataset.type.toLowerCase());
      resetMatchupDateRange();
      updateMatchupDateOptions();
      if (getActiveMatchupPreset()) {
        applyActiveMatchupPresetDateRange();
      }

      if (isMatchupTopMode()) {
        updateMatchupAnalytics();
      }
    });
  });

  if (quickViewRoot && quickViewRoot.dataset.listenerAdded !== 'true') {
    quickViewRoot.addEventListener('click', event => {
      const yearButton = event.target.closest('.quick-view-year-button');
      if (yearButton) {
        setQuickViewYearSelection(yearButton.dataset.quickViewYear || '');
        return;
      }

      const presetButton = event.target.closest('.matchup-preset-button');
      if (presetButton) {
        applyMatchupPreset(presetButton.dataset.matchupPreset);
      }
    });

    quickViewRoot.dataset.listenerAdded = 'true';
  }

  if (startDateSelect && startDateSelect.dataset.listenerAdded !== 'true') {
    startDateSelect.addEventListener('change', () => setMatchupDateSelection('start', startDateSelect.value, { clearPreset: true }));
    startDateSelect.dataset.listenerAdded = 'true';
  }

  if (endDateSelect && endDateSelect.dataset.listenerAdded !== 'true') {
    endDateSelect.addEventListener('change', () => setMatchupDateSelection('end', endDateSelect.value, { clearPreset: true }));
    endDateSelect.dataset.listenerAdded = 'true';
  }

  if (playerSelect && playerSelect.dataset.listenerAdded !== 'true') {
    playerSelect.addEventListener('change', () => {
      activeMatchupPlayerFocusKey = playerSelect.value || '';
      activeMatchupPlayerFocusLabel = playerSelect.selectedOptions[0]?.textContent || '';

      if (isPlayerMatchupMode()) {
        updateMatchupAnalytics();
      }
    });
    playerSelect.dataset.listenerAdded = 'true';
  }
}

// Wires matchup date/type/preset controls, fullscreen actions, drilldowns, and
// CSV exports.
export function initMatchupAnalysis() {
  initMatchupPlayerSearchDropdown();
  renderMatchupLoadingState();
  updateMatchupViewCopy();
  setupMatchupFilterListeners();
  setupMatchupCsvExportListeners();
  setupMatchupFullscreenListeners();
  setupMatchupDrilldownModal();
  setupMatchupDrilldownCards();
  updateMatchupDrilldownCardStates();
  ensureMatchupCatalogUiReady()
    .catch(error => {
      console.error('Failed to load matchup catalog.', error);
      renderMatchupErrorState('Unable to load matchup catalog.');
    });
  console.log('Matchup Analysis initialized');
}

// Loads matchup data for the active window, rebuilds summaries/matrices, and
// protects against stale async responses.
export async function updateMatchupAnalytics() {
  const requestId = matchupAnalyticsRequestId + 1;
  matchupAnalyticsRequestId = requestId;
  currentMatchupSnapshot = null;
  currentMatchupMatrix = null;
  currentResolvedMatchupMatches = [];
  updateMatchupExportButtons();
  renderMatchupLoadingState();

  try {
    await ensureMatchupCatalogUiReady();

    renderQuickViewButtons();
    if (getActiveMatchupPreset()) {
      applyActiveMatchupPresetDateRange();
    } else {
      updateMatchupDateOptions();
    }

    await ensureMatchupWindowLoaded({
      startDate: getMatchupStartDateSelect()?.value || '',
      endDate: getMatchupEndDateSelect()?.value || '',
      includeMatches: true,
      includeRounds: false
    });
  } catch (error) {
    if (requestId !== matchupAnalyticsRequestId) {
      return;
    }

    console.error('Failed to load matchup window data.', error);
    currentMatchupSnapshot = null;
    currentMatchupMatrix = null;
    currentResolvedMatchupMatches = [];
    currentMatchupPlayerFocus = null;
    updateMatchupDrilldownCardStates();
    updateMatchupExportButtons();
    renderMatchupErrorState('Unable to load matchup data for the selected filters.');
    return;
  }

  if (requestId !== matchupAnalyticsRequestId) {
    return;
  }

  const selectionSnapshot = buildMatchupSelectionSnapshot();
  const baseResolvedMatches = selectionSnapshot.filteredMatches.filter(isResolvedMatchupMatch);
  if (isPlayerMatchupMode()) {
    await ensureDefaultMatchupPlayerFocus(baseResolvedMatches);
  }
  currentMatchupPlayerFocus = isPlayerMatchupMode()
    ? buildPlayerMatchupFocusState(selectionSnapshot, baseResolvedMatches)
    : null;

  updateMatchupViewCopy();

  const snapshot = currentMatchupPlayerFocus?.selectedPlayerKey
    ? {
        ...selectionSnapshot,
        filteredEvents: selectionSnapshot.filteredEvents.filter(event =>
          currentMatchupPlayerFocus.contributingEventIds.has(String(event?.event_id || '').trim())
        ),
        filteredMatches: currentMatchupPlayerFocus.filteredMatches
      }
    : isPlayerMatchupMode()
      ? {
          ...selectionSnapshot,
          filteredEvents: [],
          filteredMatches: []
        }
      : selectionSnapshot;
  const resolvedMatches = isPlayerMatchupMode()
    ? currentMatchupPlayerFocus?.filteredMatches || []
    : baseResolvedMatches;
  const matchupMatrix = calculateMatchupMatrix(resolvedMatches);
  currentMatchupSnapshot = snapshot;
  currentResolvedMatchupMatches = resolvedMatches;
  currentMatchupMatrix = matchupMatrix;
  updateMatchupExportButtons();

  populateMatchupStats(snapshot, matchupMatrix, resolvedMatches, currentMatchupPlayerFocus);
  renderMatchupSummary(snapshot, matchupMatrix, resolvedMatches, currentMatchupPlayerFocus);
  renderMatchupMatrixTable(matchupMatrix, resolvedMatches, currentMatchupPlayerFocus);
  updateMatchupSelectionSummary(selectionSnapshot);
  updateMatchupDrilldownCardStates();

  if (activeMatchupDrilldownCategory) {
    renderMatchupDrilldown(activeMatchupDrilldownCategory);
  }
}
