// Builds and maintains multi-event and player selection summaries plus their group-based filtering state.
import { buildPlayerEventHistoryHTML } from '../../utils/data-cards.js';
import { triggerUpdateAnimation } from '../../utils/dom.js';
import { formatDate, formatEventName } from '../../utils/format.js';
import { formatGroupDisplayLabel, getEventGroupInfo } from '../../utils/event-groups.js';
import { rowMatchesPlayerKey } from '../../utils/player-names.js';
import { getPlayerAnalysisActivePreset } from '../../utils/player-analysis-presets.js';
import { filterState } from './state.js';
import { filterRuntime } from './runtime.js';
import {
  escapeHtml,
  getTopMode,
  getAnalysisMode,
  getEventAnalysisSelectedTypes,
  getPlayerAnalysisSelectedTypes
} from './shared.js';
import {
  getScopedMultiEventRows,
  getScopedPlayerAnalysisRows,
  clearMultiEventPresetButtonState
} from './quick-view.js';
import { getEventDate } from './single-event.js';

// Clears the multi-event group-chip state.
export function resetMultiEventGroupFilterState() {
  filterState.multiEventGroupSelectionInitialized = false;
  filterState.activeMultiEventGroupKeys = new Set();
}

function getMultiEventSelectionSummaryElements() {
  return {
    panels: document.getElementById('multiEventSelectionPanels'),
    summaryBox: document.getElementById('multiEventSelectionSummary'),
    listBox: document.getElementById('multiEventSelectionListBox'),
    content: document.getElementById('multiEventSelectionSummaryContent'),
    list: document.getElementById('multiEventSelectionList')
  };
}

function getPlayerSelectionSummaryElements() {
  return {
    panels: document.getElementById('playerSelectionPanels'),
    summaryBox: document.getElementById('playerSelectionSummary'),
    listBox: document.getElementById('playerEventHistoryBox'),
    content: document.getElementById('playerSelectionSummaryContent'),
    list: document.getElementById('playerEventsDetails')
  };
}

function buildMultiEventSelectionListHTML(entries = []) {
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

function syncPlayerEventGroupFilterDataset() {
  // Player Analysis reads group filter state from both filterState and dataset
  // attributes because some rendering code lives outside this module.
  const panels = document.getElementById('playerSelectionPanels');
  if (!panels) {
    return;
  }

  panels.dataset.groupFilterInitialized = filterState.playerEventGroupSelectionInitialized ? 'true' : 'false';
  panels.dataset.activeGroupKeys = Array.from(filterState.activePlayerEventGroupKeys).join(',');
}

// Clears the Player Analysis group-chip state and mirrors it to DOM data attrs.
export function resetPlayerEventGroupFilterState() {
  filterState.playerEventGroupSelectionInitialized = false;
  filterState.activePlayerEventGroupKeys = new Set();
  filterState.playerEventGroupSelectionContextKey = '';
  syncPlayerEventGroupFilterDataset();
}

function getBasePlayerAnalysisRows() {
  // Base rows apply global Player Analysis filters but not the group-chip filter;
  // this lets the summary show all available groups before the user narrows them.
  const startDate = document.getElementById('playerStartDateSelect')?.value || '';
  const endDate = document.getElementById('playerEndDateSelect')?.value || '';
  const selectedPlayer = document.getElementById('playerFilterMenu')?.value || '';
  const selectedEventTypes = getPlayerAnalysisSelectedTypes();
  const scopedRows = getScopedPlayerAnalysisRows(selectedEventTypes);

  if (!selectedPlayer || !startDate || !endDate || selectedEventTypes.length === 0) {
    return [];
  }

  return scopedRows.filter(row => {
    return (
      row.Date >= startDate &&
      row.Date <= endDate &&
      rowMatchesPlayerKey(row, selectedPlayer) &&
      selectedEventTypes.includes(row.EventType.toLowerCase())
    );
  });
}

function getPlayerSelectedEventEntries(rows = getBasePlayerAnalysisRows()) {
  const events = new Map();

  rows.forEach(row => {
    const eventKey = `${row.Date || ''}::${row.Event || ''}`;
    if (events.has(eventKey)) {
      return;
    }

    const groupInfo = getEventGroupInfo(row.Event);
    events.set(eventKey, {
      name: row.Event,
      date: row.Date || getEventDate(row.Event),
      groupKey: groupInfo.key,
      groupLabel: groupInfo.label,
      groupOrder: groupInfo.order
    });
  });

  return Array.from(events.values()).sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
}

function getPlayerEventGroupSummaries(rows = getBasePlayerAnalysisRows()) {
  const groups = new Map();

  getPlayerSelectedEventEntries(rows).forEach(entry => {
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

function getPlayerEventGroupContextKey(rows = getBasePlayerAnalysisRows()) {
  const startDate = document.getElementById('playerStartDateSelect')?.value || '';
  const endDate = document.getElementById('playerEndDateSelect')?.value || '';
  const selectedPlayer = document.getElementById('playerFilterMenu')?.value || '';
  const selectedEventTypes = getPlayerAnalysisSelectedTypes().slice().sort().join(',');
  const activePreset = getPlayerAnalysisActivePreset();
  const eventKeys = getPlayerSelectedEventEntries(rows)
    .map(entry => `${entry.date || ''}::${entry.name || ''}`)
    .join('|');

  return [selectedPlayer, startDate, endDate, selectedEventTypes, activePreset, eventKeys].join('@@');
}

function syncPlayerEventGroupFilterState(groupSummaries, contextKey = '') {
  // Reset to all groups when the underlying event universe changes; otherwise
  // keep the user's active group choices and drop only groups that disappeared.
  if (groupSummaries.length === 0) {
    resetPlayerEventGroupFilterState();
    return;
  }

  const availableKeys = new Set(groupSummaries.map(group => group.key));
  const hasContextChanged = Boolean(contextKey) && contextKey !== filterState.playerEventGroupSelectionContextKey;

  if (!filterState.playerEventGroupSelectionInitialized || hasContextChanged) {
    filterState.activePlayerEventGroupKeys = new Set(availableKeys);
    filterState.playerEventGroupSelectionInitialized = true;
    filterState.playerEventGroupSelectionContextKey = contextKey;
    syncPlayerEventGroupFilterDataset();
    return;
  }

  filterState.activePlayerEventGroupKeys = new Set(
    Array.from(filterState.activePlayerEventGroupKeys).filter(groupKey => availableKeys.has(groupKey))
  );
  filterState.playerEventGroupSelectionContextKey = contextKey || filterState.playerEventGroupSelectionContextKey;
  syncPlayerEventGroupFilterDataset();
}

// Returns Player Analysis rows after global filters and group-chip filtering.
export function getFilteredPlayerAnalysisRows() {
  // This is the rows selector used by charts/cards after group-chip filtering.
  const baseRows = getBasePlayerAnalysisRows();
  if (baseRows.length === 0) {
    resetPlayerEventGroupFilterState();
    return [];
  }

  const groupSummaries = getPlayerEventGroupSummaries(baseRows);
  const contextKey = getPlayerEventGroupContextKey(baseRows);
  syncPlayerEventGroupFilterState(groupSummaries, contextKey);

  return baseRows.filter(row => filterState.activePlayerEventGroupKeys.has(getEventGroupInfo(row.Event).key));
}

function togglePlayerEventGroupFilter(groupKey) {
  const baseRows = getBasePlayerAnalysisRows();
  const groupSummaries = getPlayerEventGroupSummaries(baseRows);
  const contextKey = getPlayerEventGroupContextKey(baseRows);
  syncPlayerEventGroupFilterState(groupSummaries, contextKey);

  if (filterState.activePlayerEventGroupKeys.has(groupKey)) {
    filterState.activePlayerEventGroupKeys.delete(groupKey);
  } else {
    filterState.activePlayerEventGroupKeys.add(groupKey);
  }

  filterState.playerEventGroupSelectionInitialized = true;
  filterState.playerEventGroupSelectionContextKey = contextKey;
  syncPlayerEventGroupFilterDataset();
  updatePlayerSelectionSummary();
  filterRuntime.updateAllCharts();
}

// Renders Player Analysis group chips and selected-event history.
export function updatePlayerSelectionSummary() {
  // Rebuild both the compact group chips and the event-history list from the
  // same base rows so the two panels stay consistent.
  const { panels, summaryBox, listBox, content, list } = getPlayerSelectionSummaryElements();
  if (!panels || !summaryBox || !listBox || !content || !list) {
    return;
  }

  const shouldShow = getTopMode() === 'player';
  panels.style.display = shouldShow ? 'flex' : 'none';

  if (!shouldShow) {
    return;
  }

  const baseRows = getBasePlayerAnalysisRows();
  const groupSummaries = getPlayerEventGroupSummaries(baseRows);
  const contextKey = getPlayerEventGroupContextKey(baseRows);
  syncPlayerEventGroupFilterState(groupSummaries, contextKey);
  const filteredRows = getFilteredPlayerAnalysisRows();

  if (groupSummaries.length === 0) {
    content.innerHTML = 'No events selected';
    list.innerHTML = '<div>No events selected</div>';
    triggerUpdateAnimation('playerSelectionSummary');
    triggerUpdateAnimation('playerEventHistoryBox');
    return;
  }

  content.innerHTML = groupSummaries
    .map(group => {
      const isActive = filterState.activePlayerEventGroupKeys.has(group.key);
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
    button.addEventListener('click', () => togglePlayerEventGroupFilter(button.dataset.groupKey));
  });

  if (!groupSummaries.some(group => filterState.activePlayerEventGroupKeys.has(group.key))) {
    const emptyState = document.createElement('div');
    emptyState.className = 'multi-event-group-empty';
    emptyState.textContent = 'No events selected';
    content.appendChild(emptyState);
  }

  list.innerHTML = filteredRows.length > 0 ? buildPlayerEventHistoryHTML(filteredRows) : '<div>No events selected</div>';
  triggerUpdateAnimation('playerSelectionSummary');
  triggerUpdateAnimation('playerEventHistoryBox');
}

function getMultiEventSelectedEventEntries() {
  const startDate = document.getElementById('startDateSelect')?.value || '';
  const endDate = document.getElementById('endDateSelect')?.value || '';
  const selectedEventTypes = getEventAnalysisSelectedTypes();

  if (!startDate || !endDate || selectedEventTypes.length === 0) {
    return [];
  }

  const events = new Map();

  getScopedMultiEventRows(selectedEventTypes).forEach(row => {
    if (
      row.Date >= startDate &&
      row.Date <= endDate &&
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
        groupShortLabel: groupInfo.shortLabel,
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
    resetMultiEventGroupFilterState();
    return;
  }

  const availableKeys = new Set(groupSummaries.map(group => group.key));

  if (!filterState.multiEventGroupSelectionInitialized) {
    filterState.activeMultiEventGroupKeys = new Set(availableKeys);
    filterState.multiEventGroupSelectionInitialized = true;
    return;
  }

  filterState.activeMultiEventGroupKeys = new Set(
    Array.from(filterState.activeMultiEventGroupKeys).filter(groupKey => availableKeys.has(groupKey))
  );
}

// Returns Multi-Event rows after date/type/preset and group-chip filtering.
export function getFilteredMultiEventRows() {
  const startDate = document.getElementById('startDateSelect')?.value || '';
  const endDate = document.getElementById('endDateSelect')?.value || '';
  const selectedEventTypes = getEventAnalysisSelectedTypes();
  const scopedRows = getScopedMultiEventRows(selectedEventTypes);

  if (!startDate || !endDate || selectedEventTypes.length === 0) {
    return [];
  }

  const groupSummaries = getMultiEventGroupSummaries();
  syncMultiEventGroupFilterState(groupSummaries);

  return scopedRows.filter(row => {
    return (
      row.Date >= startDate &&
      row.Date <= endDate &&
      filterState.activeMultiEventGroupKeys.has(getEventGroupInfo(row.Event).key)
    );
  });
}

function getFilteredMultiEventSelectedEventEntries() {
  return getMultiEventSelectedEventEntries().filter(entry => filterState.activeMultiEventGroupKeys.has(entry.groupKey));
}

function toggleMultiEventGroupFilter(groupKey) {
  clearMultiEventPresetButtonState();
  const groupSummaries = getMultiEventGroupSummaries();
  syncMultiEventGroupFilterState(groupSummaries);

  if (filterState.activeMultiEventGroupKeys.has(groupKey)) {
    filterState.activeMultiEventGroupKeys.delete(groupKey);
  } else {
    filterState.activeMultiEventGroupKeys.add(groupKey);
  }

  filterState.multiEventGroupSelectionInitialized = true;
  updateMultiEventSelectionSummary();
  filterRuntime.updateAllCharts();
}

// Renders Multi-Event group chips and selected-event list.
export function updateMultiEventSelectionSummary() {
  const { panels, summaryBox, listBox, content, list } = getMultiEventSelectionSummaryElements();
  if (!panels || !summaryBox || !listBox || !content || !list) {
    return;
  }

  const shouldShow = getTopMode() === 'event' && getAnalysisMode() === 'multi';
  panels.style.display = shouldShow ? 'flex' : 'none';

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
      const isActive = filterState.activeMultiEventGroupKeys.has(group.key);
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

  if (!groupSummaries.some(group => filterState.activeMultiEventGroupKeys.has(group.key))) {
    const emptyState = document.createElement('div');
    emptyState.className = 'multi-event-group-empty';
    emptyState.textContent = 'No events selected';
    content.appendChild(emptyState);
  }

  const selectedEntries = getFilteredMultiEventSelectedEventEntries();
  list.innerHTML = buildMultiEventSelectionListHTML(selectedEntries);
}
