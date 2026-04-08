import { cleanedData } from '../data.js';
import { updateEventAnalytics, updateMultiEventAnalytics } from './event-analysis.js';
import { updatePlayerAnalytics } from './player-analysis.js';
import { updateEventMetaWinRateChart } from '../charts/single-meta-win-rate.js';
import { updateMultiMetaWinRateChart } from '../charts/multi-meta-win-rate.js';
import { updateMultiPlayerWinRateChart } from '../charts/multi-player-win-rate.js';
import { updateEventFunnelChart } from '../charts/single-funnel.js';
import { updateDeckEvolutionChart } from '../charts/multi-deck-evolution.js';
import { updatePlayerDeckPerformanceChart } from '../charts/player-deck-performance.js';
import { updatePlayerWinRateChart } from '../charts/player-win-rate.js';
import { hideAboutSection } from './about.js';
import {
  renderEventFilterCalendar,
  resetEventFilterCalendarState,
  primeEventFilterCalendarSelection
} from './event-filter-calendar.js';
import { renderMultiEventDateRangeCalendar, renderPlayerDateRangeCalendar } from './date-range-calendar.js';

let filteredData = [];
let lastSingleEventType = '';
let multiEventGroupSelectionInitialized = false;
let activeMultiEventGroupKeys = new Set();

const EVENT_GROUPS = {
  'MTGO Challenge': {
    key: 'challenge',
    label: 'Challenge',
    order: 0,
    shortLabel: 'Challenge'
  },
  'MTGO Challenge 64': {
    key: 'challenge',
    label: 'Challenge',
    order: 0,
    shortLabel: 'Challenge 64'
  },
  'MTGO Qualifier': {
    key: 'qualifier',
    label: 'Qualifier',
    order: 1,
    shortLabel: 'Qualifier'
  },
  'MTGO Showcase': {
    key: 'showcase',
    label: 'Showcase',
    order: 2,
    shortLabel: 'Showcase'
  },
  'MTGO Super': {
    key: 'super',
    label: 'Super',
    order: 3,
    shortLabel: 'Super'
  }
};

function getTopMode() {
  return document.querySelector('.top-mode-button.active')?.dataset.topMode || 'event';
}

function getAnalysisMode() {
  return document.querySelector('.analysis-mode.active')?.dataset.mode || 'single';
}

function getEventAnalysisSection() {
  return document.getElementById('eventAnalysisSection');
}

function getPlayerAnalysisSection() {
  return document.getElementById('playerAnalysisSection');
}

function getSectionEventTypeButtons(sectionElement) {
  return Array.from(sectionElement?.querySelectorAll('.event-type-filter') || []);
}

function getActiveSectionEventTypes(sectionElement) {
  return getSectionEventTypeButtons(sectionElement)
    .filter(button => button.classList.contains('active'))
    .map(button => button.dataset.type.toLowerCase());
}

function setDefaultSectionEventType(sectionElement, defaultType = 'online') {
  const buttons = getSectionEventTypeButtons(sectionElement);
  buttons.forEach(button => {
    button.classList.toggle('active', button.dataset.type === defaultType);
  });
}

function clearSectionEventTypes(sectionElement) {
  const buttons = getSectionEventTypeButtons(sectionElement);
  buttons.forEach(button => {
    button.classList.remove('active');
  });
}

function getSingleEventSelectedType() {
  return getActiveSectionEventTypes(getEventAnalysisSection())[0] || '';
}

function getEventAnalysisSelectedTypes() {
  return getActiveSectionEventTypes(getEventAnalysisSection());
}

function getPlayerAnalysisSelectedTypes() {
  return getActiveSectionEventTypes(getPlayerAnalysisSection());
}

function getEventDate(eventName) {
  const match = eventName.match(/\((\d{4}-\d{2}-\d{2})\)$/);
  if (match) {
    return match[1];
  }

  return cleanedData.find(row => row.Event === eventName)?.Date || '';
}

function stripEventDate(eventName) {
  return eventName.replace(/\s*\(\d{4}-\d{2}-\d{2}\)$/, '');
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toDisplayTitleCase(value) {
  return value.replace(/\b([A-Za-z])([A-Za-z']*)\b/g, (_, firstChar, rest) => {
    return `${firstChar.toUpperCase()}${rest.toLowerCase()}`;
  });
}

function normalizeEventBaseName(value) {
  return toDisplayTitleCase(value.trim().replace(/\s+/g, ' '));
}

function formatGroupDisplayLabel(label) {
  return toDisplayTitleCase((label || '').replace(/^MTGO\s+/i, '').trim());
}

function getEventGroupInfo(eventName) {
  const baseName = normalizeEventBaseName(stripEventDate(eventName));
  const predefinedGroup = EVENT_GROUPS[baseName];

  if (predefinedGroup) {
    return {
      ...predefinedGroup,
      label: formatGroupDisplayLabel(predefinedGroup.label),
      shortLabel: formatGroupDisplayLabel(predefinedGroup.shortLabel)
    };
  }

  const label = formatGroupDisplayLabel(baseName);

  return {
    key: slugify(baseName),
    label,
    order: 100,
    shortLabel: label
  };
}

function buildSingleEventCalendarEntries(selectedEventType) {
  const entries = new Map();

  cleanedData.forEach(row => {
    if (row.EventType.toLowerCase() !== selectedEventType || entries.has(row.Event)) {
      return;
    }

    const groupInfo = getEventGroupInfo(row.Event);

    entries.set(row.Event, {
      name: row.Event,
      date: row.Date || getEventDate(row.Event),
      groupKey: groupInfo.key,
      groupLabel: groupInfo.label,
      groupOrder: groupInfo.order,
      shortLabel: groupInfo.shortLabel
    });
  });

  return Array.from(entries.values()).sort((a, b) => {
    return b.date.localeCompare(a.date) || a.name.localeCompare(b.name);
  });
}

function getLatestSingleEventEntry() {
  const entries = new Map();

  cleanedData.forEach(row => {
    if (entries.has(row.Event)) {
      return;
    }

    entries.set(row.Event, {
      name: row.Event,
      date: row.Date || getEventDate(row.Event),
      eventType: row.EventType.toLowerCase()
    });
  });

  return Array.from(entries.values()).sort((a, b) => {
    return b.date.localeCompare(a.date) || a.name.localeCompare(b.name);
  })[0] || null;
}

function populateEventFilterMenu(entries) {
  const eventFilterMenu = document.getElementById('eventFilterMenu');
  if (!eventFilterMenu) {
    return null;
  }

  eventFilterMenu.innerHTML = '';

  if (entries.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No events available';
    eventFilterMenu.appendChild(option);
    eventFilterMenu.value = '';
    return eventFilterMenu;
  }

  entries.forEach(entry => {
    const option = document.createElement('option');
    option.value = entry.name;
    option.textContent = entry.name;
    eventFilterMenu.appendChild(option);
  });

  return eventFilterMenu;
}

function setSelectedSingleEvent(eventName, dispatchChange = false) {
  const eventFilterMenu = document.getElementById('eventFilterMenu');
  if (!eventFilterMenu) {
    return;
  }

  const previousValue = eventFilterMenu.value;
  const hasOption = Array.from(eventFilterMenu.options).some(option => option.value === eventName);
  eventFilterMenu.value = hasOption ? eventName : '';

  if (dispatchChange && eventFilterMenu.value !== previousValue) {
    eventFilterMenu.dispatchEvent(new Event('change'));
  }
}

function setSingleEventType(eventType) {
  const buttons = getSectionEventTypeButtons(getEventAnalysisSection());
  buttons.forEach(button => {
    button.classList.toggle('active', button.dataset.type === eventType);
  });
}

function resetSelectValue(selectId) {
  const select = document.getElementById(selectId);
  if (select) {
    select.value = '';
  }
}

function resetMultiDateRange() {
  resetSelectValue('startDateSelect');
  resetSelectValue('endDateSelect');
  multiEventGroupSelectionInitialized = false;
  activeMultiEventGroupKeys = new Set();
}

function resetPlayerDateRange() {
  resetSelectValue('playerStartDateSelect');
  resetSelectValue('playerEndDateSelect');
}

function getLatestPlayerDefaultSelection(selectedEventTypes = ['online']) {
  const normalizedEventTypes =
    selectedEventTypes.length > 0 ? selectedEventTypes : ['online'];

  const latestWinner = cleanedData
    .filter(row => {
      return normalizedEventTypes.includes(row.EventType.toLowerCase()) && Number(row.Rank) === 1;
    })
    .sort((a, b) => b.Date.localeCompare(a.Date) || a.Event.localeCompare(b.Event))[0];

  if (!latestWinner) {
    return {
      player: '',
      startDate: '',
      endDate: ''
    };
  }

  return {
    player: latestWinner.Player,
    startDate: latestWinner.Date,
    endDate: latestWinner.Date
  };
}

function getDefaultMultiEventRange(dates) {
  if (dates.length === 0) {
    return { startDate: '', endDate: '' };
  }

  return {
    startDate: dates[Math.max(0, dates.length - 2)],
    endDate: dates[dates.length - 1]
  };
}

function getMultiEventSelectionSummaryElements() {
  return {
    container: document.getElementById('multiEventSelectionSummary'),
    content: document.getElementById('multiEventSelectionSummaryContent'),
    list: document.getElementById('multiEventSelectionList')
  };
}

function getMultiEventSelectedEventEntries() {
  const startDate = document.getElementById('startDateSelect')?.value || '';
  const endDate = document.getElementById('endDateSelect')?.value || '';
  const selectedEventTypes = getEventAnalysisSelectedTypes();

  if (!startDate || !endDate || selectedEventTypes.length === 0) {
    return [];
  }

  const events = new Map();

  cleanedData.forEach(row => {
    if (
      row.Date >= startDate &&
      row.Date <= endDate &&
      selectedEventTypes.includes(row.EventType.toLowerCase()) &&
      !events.has(row.Event)
    ) {
      events.set(row.Event, row.Date || getEventDate(row.Event));
    }
  });

  return Array.from(events.entries())
    .map(([eventName, eventDate]) => {
      const groupInfo = getEventGroupInfo(eventName);
      return {
        name: eventName,
        date: eventDate,
        groupKey: groupInfo.key,
        groupLabel: groupInfo.label,
        groupOrder: groupInfo.order
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
}

function getMultiEventGroupSummaries() {
  const groups = new Map();

  getMultiEventSelectedEventEntries().forEach(entry => {
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

function syncMultiEventGroupFilterState(groupSummaries) {
  if (groupSummaries.length === 0) {
    multiEventGroupSelectionInitialized = false;
    activeMultiEventGroupKeys = new Set();
    return;
  }

  const availableKeys = new Set(groupSummaries.map(group => group.key));

  if (!multiEventGroupSelectionInitialized) {
    activeMultiEventGroupKeys = new Set(availableKeys);
    multiEventGroupSelectionInitialized = true;
    return;
  }

  activeMultiEventGroupKeys = new Set(
    Array.from(activeMultiEventGroupKeys).filter(groupKey => availableKeys.has(groupKey))
  );
}

function getFilteredMultiEventRows() {
  const startDate = document.getElementById('startDateSelect')?.value || '';
  const endDate = document.getElementById('endDateSelect')?.value || '';
  const selectedEventTypes = getEventAnalysisSelectedTypes();

  if (!startDate || !endDate || selectedEventTypes.length === 0) {
    return [];
  }

  const groupSummaries = getMultiEventGroupSummaries();
  syncMultiEventGroupFilterState(groupSummaries);

  return cleanedData.filter(row => {
    return (
      row.Date >= startDate &&
      row.Date <= endDate &&
      selectedEventTypes.includes(row.EventType.toLowerCase()) &&
      activeMultiEventGroupKeys.has(getEventGroupInfo(row.Event).key)
    );
  });
}

function getExactSelectedMultiEvents() {
  const events = new Map();

  getFilteredMultiEventRows().forEach(row => {
    if (!events.has(row.Event)) {
      events.set(row.Event, row.Date || getEventDate(row.Event));
    }
  });

  return Array.from(events.entries())
    .sort((a, b) => b[1].localeCompare(a[1]) || a[0].localeCompare(b[0]))
    .map(([eventName]) => eventName);
}

function toggleMultiEventGroupFilter(groupKey) {
  const groupSummaries = getMultiEventGroupSummaries();
  syncMultiEventGroupFilterState(groupSummaries);

  if (activeMultiEventGroupKeys.has(groupKey)) {
    activeMultiEventGroupKeys.delete(groupKey);
  } else {
    activeMultiEventGroupKeys.add(groupKey);
  }

  multiEventGroupSelectionInitialized = true;
  updateMultiEventSelectionSummary();
  updateAllCharts();
}

function updateMultiEventSelectionSummary() {
  const { container, content, list } = getMultiEventSelectionSummaryElements();
  if (!container || !content || !list) {
    return;
  }

  const shouldShow = getTopMode() === 'event' && getAnalysisMode() === 'multi';
  container.style.display = shouldShow ? 'flex' : 'none';

  if (!shouldShow) {
    return;
  }

  const groupSummaries = getMultiEventGroupSummaries();
  syncMultiEventGroupFilterState(groupSummaries);

  if (groupSummaries.length === 0) {
    content.innerHTML = 'No events selected';
    list.innerHTML = 'No events selected';
    return;
  }

  content.innerHTML = groupSummaries
    .map(group => {
      const isActive = activeMultiEventGroupKeys.has(group.key);
      const countLabel = formatGroupDisplayLabel(group.count === 1 ? group.label : `${group.label}s`);

      return `
        <button type="button" class="multi-event-group-card ${isActive ? 'active' : ''}" data-group-key="${group.key}">
          <span class="multi-event-group-card-count">${group.count}</span>
          <span class="multi-event-group-card-label">${countLabel}</span>
        </button>
      `;
    })
    .join('');

  content.querySelectorAll('.multi-event-group-card').forEach(button => {
    button.addEventListener('click', () => toggleMultiEventGroupFilter(button.dataset.groupKey));
  });

  if (!groupSummaries.some(group => activeMultiEventGroupKeys.has(group.key))) {
    const emptyState = document.createElement('div');
    emptyState.className = 'multi-event-group-empty';
    emptyState.textContent = 'No events selected';
    content.appendChild(emptyState);
  }

  const exactSelectedEvents = getExactSelectedMultiEvents();
  list.innerHTML = exactSelectedEvents.length > 0
    ? exactSelectedEvents.map(eventName => `<div>${eventName}</div>`).join('')
    : 'No events selected';
}

function updateSingleEventFilterVisibility() {
  const eventTypeSection = document.getElementById('eventTypeFilterSection');
  const eventFilterSection = document.getElementById('eventFilterSection');
  const isSingleMode = getAnalysisMode() === 'single';

  if (eventTypeSection) {
    eventTypeSection.style.display = 'block';
  }

  if (eventFilterSection) {
    eventFilterSection.style.display = isSingleMode ? 'block' : 'none';
  }

  updateMultiEventSelectionSummary();
}

function hasSelectedSingleEvent() {
  return Boolean(getSingleEventSelectedType() && document.getElementById('eventFilterMenu')?.value);
}

function applyLatestSingleEventSelection() {
  const latestEntry = getLatestSingleEventEntry();
  if (!latestEntry) {
    clearSectionEventTypes(getEventAnalysisSection());
    resetEventFilterCalendarState();
    setSelectedSingleEvent('', false);
    lastSingleEventType = '';
    updateSingleEventFilterVisibility();
    updateEventFilter();
    return;
  }

  setSingleEventType(latestEntry.eventType);
  resetEventFilterCalendarState();
  setSelectedSingleEvent('', false);
  lastSingleEventType = '';
  updateSingleEventFilterVisibility();
  updateEventFilter(latestEntry.name, true);
}

function setMultiEventDateSelection(type, value) {
  const startDateSelect = document.getElementById('startDateSelect');
  const endDateSelect = document.getElementById('endDateSelect');

  if (!startDateSelect || !endDateSelect) {
    return;
  }

  if (type === 'start') {
    startDateSelect.value = value;
  } else {
    endDateSelect.value = value;
  }

  updateDateOptions();
  updateAllCharts();
}

function setPlayerDateSelection(type, value) {
  const startDateSelect = document.getElementById('playerStartDateSelect');
  const endDateSelect = document.getElementById('playerEndDateSelect');

  if (!startDateSelect || !endDateSelect) {
    return;
  }

  if (type === 'start') {
    startDateSelect.value = value;
  } else {
    endDateSelect.value = value;
  }

  updatePlayerDateOptions();
  updateAllCharts();
}

export function setupFilters() {
  console.log('Setting up filters...');

  setDefaultSectionEventType(getPlayerAnalysisSection());
  console.log(`Initial mode is ${getTopMode()}: Event Analysis loads the latest registered event by default`);

  applyLatestSingleEventSelection();

  const playerFilterMenu = document.getElementById('playerFilterMenu');
  if (playerFilterMenu) {
    playerFilterMenu.innerHTML = '';
    playerFilterMenu.value = '';
  }

  const startDateSelect = document.getElementById('startDateSelect');
  const endDateSelect = document.getElementById('endDateSelect');
  if (startDateSelect) {
    startDateSelect.innerHTML = '<option value="">Select Offline or Online Event first</option>';
  }
  if (endDateSelect) {
    endDateSelect.innerHTML = '<option value="">Select Offline or Online Event first</option>';
  }

  const playerStartDateSelect = document.getElementById('playerStartDateSelect');
  const playerEndDateSelect = document.getElementById('playerEndDateSelect');
  if (playerStartDateSelect) {
    playerStartDateSelect.innerHTML = '';
  }
  if (playerEndDateSelect) {
    playerEndDateSelect.innerHTML = '';
  }
  renderPlayerDateRangeCalendar({
    dates: [],
    startDate: '',
    endDate: ''
  });
  updatePlayerDateOptions();

  const activeAnalysisMode = getAnalysisMode();
  const singleEventStats = document.getElementById('singleEventStats');
  const multiEventStats = document.getElementById('multiEventStats');
  const singleEventCharts = document.getElementById('singleEventCharts');
  const multiEventCharts = document.getElementById('multiEventCharts');
  const eventFilterSection = document.getElementById('eventFilterSection');

  if (singleEventStats) {
    singleEventStats.style.display = activeAnalysisMode === 'single' ? 'grid' : 'none';
  }
  if (multiEventStats) {
    multiEventStats.style.display = activeAnalysisMode === 'multi' ? 'grid' : 'none';
  }
  if (singleEventCharts) {
    singleEventCharts.style.display = activeAnalysisMode === 'single' ? 'block' : 'none';
  }
  if (multiEventCharts) {
    multiEventCharts.style.display = activeAnalysisMode === 'multi' ? 'block' : 'none';
  }
  if (eventFilterSection) {
    eventFilterSection.style.display = 'none';
  }

  updateSingleEventFilterVisibility();
  updateMultiEventSelectionSummary();
  updateAllCharts();
}

export function updateAllCharts() {
  const activeTopMode = getTopMode();
  const activeAnalysisMode = getAnalysisMode();

  if (activeTopMode === 'event') {
    if (activeAnalysisMode === 'single') {
      const selectedEventType = getSingleEventSelectedType();
      const selectedEvent = document.getElementById('eventFilterMenu')?.value || '';

      filteredData =
        selectedEventType && selectedEvent
          ? cleanedData.filter(row => {
              return row.EventType.toLowerCase() === selectedEventType && row.Event === selectedEvent;
            })
          : [];

      updateEventMetaWinRateChart();
      updateEventFunnelChart();
      updateEventAnalytics();
    } else {
      const startDate = document.getElementById('startDateSelect')?.value || '';
      const endDate = document.getElementById('endDateSelect')?.value || '';
      const selectedEventTypes = getEventAnalysisSelectedTypes();

      filteredData = startDate && endDate && selectedEventTypes.length > 0 ? getFilteredMultiEventRows() : [];

      updateMultiMetaWinRateChart();
      updateMultiPlayerWinRateChart();
      updateDeckEvolutionChart();
      updateMultiEventAnalytics();
    }
  } else if (activeTopMode === 'player') {
    const startDate = document.getElementById('playerStartDateSelect')?.value || '';
    const endDate = document.getElementById('playerEndDateSelect')?.value || '';
    const selectedPlayer = document.getElementById('playerFilterMenu')?.value || '';
    const selectedEventTypes = getPlayerAnalysisSelectedTypes();

    filteredData =
      selectedPlayer && startDate && endDate && selectedEventTypes.length > 0
        ? cleanedData.filter(row => {
            return (
              row.Date >= startDate &&
              row.Date <= endDate &&
              row.Player === selectedPlayer &&
              selectedEventTypes.includes(row.EventType.toLowerCase())
            );
          })
        : [];

    updatePlayerAnalytics();
    updatePlayerDeckPerformanceChart();
    updatePlayerWinRateChart();
  }
}

export function getFunnelChartData() {
  const selectedEventType = getSingleEventSelectedType();
  const selectedEvent = document.getElementById('eventFilterMenu')?.value || '';
  const positionStart = parseInt(document.getElementById('positionStartSelect')?.value, 10) || 1;
  const positionEnd = parseInt(document.getElementById('positionEndSelect')?.value, 10) || Infinity;

  const filtered = cleanedData.filter(row => {
    return row.EventType.toLowerCase() === selectedEventType && row.Event === selectedEvent;
  });

  return filtered.filter(row => row.Rank >= positionStart && row.Rank <= positionEnd);
}

export function getMetaWinRateChartData() {
  const selectedEventType = getSingleEventSelectedType();
  const selectedEvent = document.getElementById('eventFilterMenu')?.value || '';

  return cleanedData.filter(row => {
    return row.EventType.toLowerCase() === selectedEventType && row.Event === selectedEvent;
  });
}

export function getMultiEventChartData() {
  return getFilteredMultiEventRows();
}

export function getDeckEvolutionChartData() {
  const positionStart = parseInt(document.getElementById('positionStartSelect')?.value, 10) || 1;
  const positionEnd = parseInt(document.getElementById('positionEndSelect')?.value, 10) || Infinity;
  const multiEventData = getMultiEventChartData();

  return multiEventData.filter(row => row.Rank >= positionStart && row.Rank <= positionEnd);
}

export function getPlayerDeckPerformanceChartData() {
  const startDate = document.getElementById('playerStartDateSelect')?.value || '';
  const endDate = document.getElementById('playerEndDateSelect')?.value || '';
  const selectedPlayer = document.getElementById('playerFilterMenu')?.value || '';
  const selectedEventTypes = getPlayerAnalysisSelectedTypes();

  return selectedPlayer && startDate && endDate && selectedEventTypes.length > 0
    ? cleanedData.filter(row => {
        return (
          row.Date >= startDate &&
          row.Date <= endDate &&
          row.Player === selectedPlayer &&
          selectedEventTypes.includes(row.EventType.toLowerCase()) &&
          row.Deck !== 'No Show'
        );
      })
    : [];
}

export function getPlayerWinRateChartData() {
  const baseData = getPlayerDeckPerformanceChartData();
  const selectedDeck = document.getElementById('playerDeckFilter')?.value || '';
  return selectedDeck ? baseData.filter(row => row.Deck === selectedDeck) : baseData;
}

export function setupTopModeListeners() {
  const topModeButtons = document.querySelectorAll('.top-mode-button');
  const eventAnalysisSection = document.getElementById('eventAnalysisSection');
  const playerAnalysisSection = document.getElementById('playerAnalysisSection');
  const singleEventStats = document.getElementById('singleEventStats');
  const multiEventStats = document.getElementById('multiEventStats');
  const playerStats = document.getElementById('playerStats');
  const singleEventCharts = document.getElementById('singleEventCharts');
  const multiEventCharts = document.getElementById('multiEventCharts');
  const playerCharts = document.getElementById('playerCharts');

  topModeButtons.forEach(button => {
    button.addEventListener('click', () => {
      topModeButtons.forEach(modeButton => modeButton.classList.remove('active'));
      button.classList.add('active');

      const mode = button.dataset.topMode;
      console.log('Top mode changed to:', mode);

      hideAboutSection(mode);

      if (mode === 'event') {
        if (eventAnalysisSection) {
          eventAnalysisSection.style.display = 'block';
        }
        if (playerAnalysisSection) {
          playerAnalysisSection.style.display = 'none';
        }

        setDefaultSectionEventType(getEventAnalysisSection());
        console.log(
          "Event Analytics: Event type filters set to 'online'. Active types:",
          getEventAnalysisSelectedTypes()
        );

        const activeAnalysisMode = getAnalysisMode();
        if (activeAnalysisMode === 'single') {
          applyLatestSingleEventSelection();
        }

        if (singleEventStats) {
          singleEventStats.style.display = activeAnalysisMode === 'single' ? 'grid' : 'none';
        }
        if (multiEventStats) {
          multiEventStats.style.display = activeAnalysisMode === 'multi' ? 'grid' : 'none';
        }
        if (singleEventCharts) {
          singleEventCharts.style.display = activeAnalysisMode === 'single' ? 'block' : 'none';
        }
        if (multiEventCharts) {
          multiEventCharts.style.display = activeAnalysisMode === 'multi' ? 'block' : 'none';
        }

        updateSingleEventFilterVisibility();
        updateDateOptions();
        updateMultiEventSelectionSummary();
        updateAllCharts();
      } else if (mode === 'player') {
        if (eventAnalysisSection) {
          eventAnalysisSection.style.display = 'none';
        }
        if (playerAnalysisSection) {
          playerAnalysisSection.style.display = 'block';
        }
        if (playerStats) {
          playerStats.style.display = 'grid';
        }
        if (playerCharts) {
          playerCharts.style.display = 'block';
        }

        setDefaultSectionEventType(getPlayerAnalysisSection());
        console.log(
          "Player Analytics: Event type filters set to 'online'. Active types:",
          getPlayerAnalysisSelectedTypes()
        );

        resetPlayerDateRange();
        const playerFilterMenu = document.getElementById('playerFilterMenu');
        if (playerFilterMenu) {
          playerFilterMenu.value = '';
        }
        updatePlayerDateOptions();
        updatePlayerAnalytics();
      }
    });
  });
}

export function setupAnalysisModeListeners() {
  const analysisModeButtons = document.querySelectorAll('.analysis-mode');
  const singleEventStats = document.getElementById('singleEventStats');
  const multiEventStats = document.getElementById('multiEventStats');
  const singleEventCharts = document.getElementById('singleEventCharts');
  const multiEventCharts = document.getElementById('multiEventCharts');
  const eventFilterSection = document.getElementById('eventFilterSection');

  analysisModeButtons.forEach(button => {
    button.addEventListener('click', () => {
      analysisModeButtons.forEach(modeButton => modeButton.classList.remove('active'));
      button.classList.add('active');

      const mode = button.dataset.mode;
      console.log('Analysis mode changed to:', mode);

      if (singleEventStats) {
        singleEventStats.style.display = mode === 'single' ? 'grid' : 'none';
      }
      if (multiEventStats) {
        multiEventStats.style.display = mode === 'multi' ? 'grid' : 'none';
      }
      if (singleEventCharts) {
        singleEventCharts.style.display = mode === 'single' ? 'block' : 'none';
      }
      if (multiEventCharts) {
        multiEventCharts.style.display = mode === 'multi' ? 'block' : 'none';
      }
      if (eventFilterSection) {
        eventFilterSection.style.display = 'none';
      }

      if (mode === 'single') {
        applyLatestSingleEventSelection();
      } else {
        resetMultiDateRange();
      }

      updateSingleEventFilterVisibility();
      updateDateOptions();
      updatePlayerDateOptions();
      updateMultiEventSelectionSummary();
      updateAllCharts();
    });
  });
}

export function setupEventTypeListeners() {
  const eventAnalysisButtons = getSectionEventTypeButtons(getEventAnalysisSection());
  const playerAnalysisButtons = getSectionEventTypeButtons(getPlayerAnalysisSection());

  eventAnalysisButtons.forEach(button => {
    button.addEventListener('click', () => {
      if (getTopMode() === 'event' && getAnalysisMode() === 'single') {
        eventAnalysisButtons.forEach(eventButton => {
          eventButton.classList.toggle('active', eventButton === button);
        });
      } else {
        button.classList.toggle('active');
      }

      console.log(
        'After toggle - Event Analysis active Event Types:',
        getEventAnalysisSelectedTypes(),
        'Top Mode:',
        getTopMode(),
        'Analysis Mode:',
        getAnalysisMode()
      );

      if (getAnalysisMode() === 'single') {
        resetEventFilterCalendarState();
        setSelectedSingleEvent('', false);
        updateEventFilter();
      } else {
        resetMultiDateRange();
      }

      updateSingleEventFilterVisibility();
      updateDateOptions();
      updateMultiEventSelectionSummary();
      if (getAnalysisMode() !== 'single' || hasSelectedSingleEvent()) {
        updateAllCharts();
      }
    });
  });

  playerAnalysisButtons.forEach(button => {
    button.addEventListener('click', () => {
      button.classList.toggle('active');

      console.log(
        'After toggle - Player Analysis active Event Types:',
        getPlayerAnalysisSelectedTypes(),
        'Top Mode:',
        getTopMode()
      );

      resetPlayerDateRange();
      updatePlayerDateOptions();

      if (getTopMode() === 'player') {
        updateAllCharts();
      }
    });
  });
}

export function setupEventFilterListeners() {
  const eventFilterMenu = document.getElementById('eventFilterMenu');
  if (eventFilterMenu) {
    eventFilterMenu.addEventListener('change', updateAllCharts);
  }
}

export function setupPlayerFilterListeners() {
  const playerFilterMenu = document.getElementById('playerFilterMenu');
  const playerStartDateSelect = document.getElementById('playerStartDateSelect');
  const playerEndDateSelect = document.getElementById('playerEndDateSelect');

  if (playerFilterMenu) {
    playerFilterMenu.addEventListener('change', () => {
      updatePlayerDateOptions();
      updatePlayerAnalytics();
    });
  }

  if (playerStartDateSelect) {
    playerStartDateSelect.addEventListener('change', () => {
      updatePlayerDateOptions();
      updatePlayerAnalytics();
    });
  }

  if (playerEndDateSelect) {
    playerEndDateSelect.addEventListener('change', () => {
      updatePlayerDateOptions();
      updatePlayerAnalytics();
    });
  }
}

export function updateEventFilter(preferredEvent = '', expandPreferredEvent = false) {
  const eventFilterMenu = document.getElementById('eventFilterMenu');
  if (!eventFilterMenu || getAnalysisMode() !== 'single') {
    return;
  }

  const selectedEventType = getSingleEventSelectedType();
  const eventTypeChanged = selectedEventType !== lastSingleEventType;

  if (!selectedEventType) {
    lastSingleEventType = '';
    resetEventFilterCalendarState();
    setSelectedSingleEvent('', false);
    populateEventFilterMenu([]);
    renderEventFilterCalendar({
      entries: [],
      selectedEvent: '',
      onSelectEvent: eventName => setSelectedSingleEvent(eventName, true),
      emptyMessage: 'Select an Event Type first.'
    });
    return;
  }

  const entries = buildSingleEventCalendarEntries(selectedEventType);
  if (eventTypeChanged) {
    resetEventFilterCalendarState();
    setSelectedSingleEvent('', false);
  }

  if (expandPreferredEvent) {
    primeEventFilterCalendarSelection(preferredEvent, entries);
  }

  const currentSelectedEvent = preferredEvent || (eventTypeChanged ? '' : eventFilterMenu.value);

  populateEventFilterMenu(entries);

  const resolvedSelectedEvent = renderEventFilterCalendar({
    entries,
    selectedEvent: currentSelectedEvent,
    onSelectEvent: eventName => setSelectedSingleEvent(eventName, true),
    emptyMessage: 'No events available for the selected Event Type.'
  });

  lastSingleEventType = selectedEventType;
  setSelectedSingleEvent(resolvedSelectedEvent, false);
}

export function updateDateOptions() {
  const startDateSelect = document.getElementById('startDateSelect');
  const endDateSelect = document.getElementById('endDateSelect');

  if (!startDateSelect || !endDateSelect) {
    return;
  }

  const selectedEventTypes = getEventAnalysisSelectedTypes();
  const dates =
    selectedEventTypes.length > 0
      ? [
          ...new Set(
            cleanedData
              .filter(row => selectedEventTypes.includes(row.EventType.toLowerCase()))
              .map(row => row.Date)
          )
        ].sort((a, b) => new Date(a) - new Date(b))
      : [];

  console.log('Filtered dates for Multi-Event:', dates);

  if (dates.length === 0) {
    startDateSelect.innerHTML = '<option value="">Select Offline or Online Event first</option>';
    endDateSelect.innerHTML = '<option value="">Select Offline or Online Event first</option>';
    renderMultiEventDateRangeCalendar({
      dates: [],
      startDate: '',
      endDate: '',
      onSelectStartDate: dateString => setMultiEventDateSelection('start', dateString),
      onSelectEndDate: dateString => setMultiEventDateSelection('end', dateString)
    });
    return;
  }

  let currentStartDate = dates.includes(startDateSelect.value) ? startDateSelect.value : '';
  let currentEndDate = dates.includes(endDateSelect.value) ? endDateSelect.value : '';

  if (!currentStartDate && !currentEndDate) {
    const defaultRange = getDefaultMultiEventRange(dates);
    currentStartDate = defaultRange.startDate;
    currentEndDate = defaultRange.endDate;
  }

  if (currentStartDate) {
    const validEndDates = dates.filter(date => date >= currentStartDate);
    endDateSelect.innerHTML =
      '<option value="">Select End Date</option>' +
      validEndDates
        .map(date => {
          return `<option value="${date}" ${date === currentEndDate ? 'selected' : ''}>${date}</option>`;
        })
        .join('');
  } else {
    endDateSelect.innerHTML =
      '<option value="">Select End Date</option>' +
      dates
        .map(date => {
          return `<option value="${date}" ${date === currentEndDate ? 'selected' : ''}>${date}</option>`;
        })
        .join('');
  }

  if (currentEndDate) {
    const validStartDates = dates.filter(date => date <= currentEndDate);
    startDateSelect.innerHTML =
      '<option value="">Select Start Date</option>' +
      validStartDates
        .map(date => {
          return `<option value="${date}" ${date === currentStartDate ? 'selected' : ''}>${date}</option>`;
        })
        .join('');
  } else {
    startDateSelect.innerHTML =
      '<option value="">Select Start Date</option>' +
      dates
        .map(date => {
          return `<option value="${date}" ${date === currentStartDate ? 'selected' : ''}>${date}</option>`;
        })
        .join('');
  }

  startDateSelect.value = currentStartDate;
  endDateSelect.value = currentEndDate;

  renderMultiEventDateRangeCalendar({
    dates,
    startDate: currentStartDate,
    endDate: currentEndDate,
    onSelectStartDate: dateString => setMultiEventDateSelection('start', dateString),
    onSelectEndDate: dateString => setMultiEventDateSelection('end', dateString)
  });

  updateMultiEventSelectionSummary();
}

export function updatePlayerDateOptions() {
  const startDateSelect = document.getElementById('playerStartDateSelect');
  const endDateSelect = document.getElementById('playerEndDateSelect');
  const playerFilterMenu = document.getElementById('playerFilterMenu');

  if (!startDateSelect || !endDateSelect || !playerFilterMenu) {
    return;
  }

  const selectedEventTypes = getPlayerAnalysisSelectedTypes();
  const selectedPlayer = playerFilterMenu.value;

  if (selectedEventTypes.length === 0) {
    playerFilterMenu.innerHTML = '<option value="">No Players Available</option>';
    playerFilterMenu.value = '';
    startDateSelect.innerHTML = '<option value="">No Dates Available</option>';
    endDateSelect.innerHTML = '<option value="">No Dates Available</option>';
    renderPlayerDateRangeCalendar({
      dates: [],
      startDate: '',
      endDate: '',
      emptyMessage: 'No dates available.',
      onSelectStartDate: dateString => setPlayerDateSelection('start', dateString),
      onSelectEndDate: dateString => setPlayerDateSelection('end', dateString)
    });
    return;
  }

  const defaultSelection = getLatestPlayerDefaultSelection(selectedEventTypes);

  const players = [
    ...new Set(
      cleanedData
        .filter(row => selectedEventTypes.includes(row.EventType.toLowerCase()))
      .map(row => row.Player)
    )
  ].sort((a, b) => a.localeCompare(b));

  let currentPlayer = players.includes(selectedPlayer)
    ? selectedPlayer
    : players.includes(defaultSelection.player)
      ? defaultSelection.player
      : players[0] || '';

  if (players.length === 0) {
    playerFilterMenu.innerHTML = '<option value="">No Players Available</option>';
    playerFilterMenu.value = '';
    startDateSelect.innerHTML = '<option value="">No Dates Available</option>';
    endDateSelect.innerHTML = '<option value="">No Dates Available</option>';
    renderPlayerDateRangeCalendar({
      dates: [],
      startDate: '',
      endDate: '',
      emptyMessage: 'No dates available.',
      onSelectStartDate: dateString => setPlayerDateSelection('start', dateString),
      onSelectEndDate: dateString => setPlayerDateSelection('end', dateString)
    });
    return;
  }

  playerFilterMenu.innerHTML = players
    .map(player => {
      return `<option value="${player}" ${player === currentPlayer ? 'selected' : ''}>${player}</option>`;
    })
    .join('');
  playerFilterMenu.value = currentPlayer;

  const dates = [
    ...new Set(
      cleanedData
        .filter(row => {
          return row.Player === currentPlayer && selectedEventTypes.includes(row.EventType.toLowerCase());
        })
        .map(row => row.Date)
    )
  ].sort((a, b) => new Date(a) - new Date(b));

  console.log('Filtered dates for Player Analysis:', dates, 'Selected Player:', currentPlayer);

  if (dates.length === 0) {
    startDateSelect.innerHTML = '<option value="">No Dates Available</option>';
    endDateSelect.innerHTML = '<option value="">No Dates Available</option>';
    renderPlayerDateRangeCalendar({
      dates: [],
      startDate: '',
      endDate: '',
      emptyMessage: 'No dates available for this player.',
      onSelectStartDate: dateString => setPlayerDateSelection('start', dateString),
      onSelectEndDate: dateString => setPlayerDateSelection('end', dateString)
    });
    return;
  }

  const selectedStartDate = dates.includes(startDateSelect.value) ? startDateSelect.value : '';
  const selectedEndDate = dates.includes(endDateSelect.value) ? endDateSelect.value : '';
  const fallbackDate =
    currentPlayer === defaultSelection.player && dates.includes(defaultSelection.startDate)
      ? defaultSelection.startDate
      : dates[dates.length - 1];

  let currentStartDate = selectedStartDate;
  let currentEndDate = selectedEndDate;

  if (!currentStartDate && !currentEndDate) {
    currentStartDate = fallbackDate;
    currentEndDate = fallbackDate;
  } else if (!currentStartDate) {
    currentStartDate = currentEndDate;
  } else if (!currentEndDate) {
    currentEndDate = currentStartDate;
  }

  if (currentStartDate) {
    const validEndDates = dates.filter(date => date >= currentStartDate);
    endDateSelect.innerHTML =
      validEndDates
        .map(date => {
          return `<option value="${date}" ${date === currentEndDate ? 'selected' : ''}>${date}</option>`;
        })
        .join('');
  } else {
    endDateSelect.innerHTML = dates
      .map(date => {
        return `<option value="${date}" ${date === currentEndDate ? 'selected' : ''}>${date}</option>`;
      })
      .join('');
  }

  if (currentEndDate) {
    const validStartDates = dates.filter(date => date <= currentEndDate);
    startDateSelect.innerHTML =
      validStartDates
        .map(date => {
          return `<option value="${date}" ${date === currentStartDate ? 'selected' : ''}>${date}</option>`;
        })
        .join('');
  } else {
    startDateSelect.innerHTML = dates
      .map(date => {
        return `<option value="${date}" ${date === currentStartDate ? 'selected' : ''}>${date}</option>`;
      })
      .join('');
  }

  startDateSelect.value = currentStartDate;
  endDateSelect.value = currentEndDate;

  renderPlayerDateRangeCalendar({
    dates,
    startDate: currentStartDate,
    endDate: currentEndDate,
    onSelectStartDate: dateString => setPlayerDateSelection('start', dateString),
    onSelectEndDate: dateString => setPlayerDateSelection('end', dateString)
  });
}

export function populateDateDropdowns(eventType) {
  const filteredDates = [
    ...new Set(
      cleanedData
        .filter(row => row.EventType.toLowerCase() === eventType.toLowerCase())
        .map(row => row.Date)
    )
  ].sort();

  const startDateSelect = document.getElementById('startDateSelect');
  const endDateSelect = document.getElementById('endDateSelect');

  if (!startDateSelect || !endDateSelect) {
    console.error('Date select elements not found!');
    return;
  }

  const options =
    "<option value=''>--Select--</option>" +
    filteredDates.map(date => `<option value="${date}">${date}</option>`).join('');

  startDateSelect.innerHTML = options;
  endDateSelect.innerHTML = options;
}
