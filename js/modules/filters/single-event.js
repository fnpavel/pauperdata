// Handles single-event filter state, event selection, and calendar-backed event menu updates.
import {
  renderEventFilterCalendar,
  resetEventFilterCalendarState,
  primeEventFilterCalendarSelection
} from './single-event-picker.js';
import { getEventGroupInfo } from '../../utils/event-groups.js';
import {
  getAllAnalysisSingleEventEntries,
} from '../../utils/analysis-data.js';
import { filterState } from './state.js';
import { filterRuntime } from './runtime.js';
import {
  getAnalysisMode,
  getEventAnalysisSection,
  getSectionEventTypeButtons
} from './shared.js';

// Extracts a YYYY-MM-DD date from an event name when a row date is unavailable.
export function getEventDate(eventName) {
  const match = eventName.match(/\((\d{4}-\d{2}-\d{2})\)$/);
  if (match) {
    return match[1];
  }

  return '';
}

function getCurrentRealWorldMonthKey() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth()
  };
}

function isEntryInAllowedSingleEventMonth(entry) {
  if (!entry) {
    return false;
  }

  const { year, month } = getCurrentRealWorldMonthKey();
  return entry.year < year || (entry.year === year && entry.month <= month);
}

// Builds calendar-picker entries for all available single events.
export function buildSingleEventCalendarEntries() {
  return getAllAnalysisSingleEventEntries().map(entry => {
    const dateObject = new Date(`${entry.date}T00:00:00Z`);
    const groupInfo = getEventGroupInfo(entry.name);

    return {
      name: entry.name,
      date: entry.date || getEventDate(entry.name),
      eventType: entry.eventType,
      playerCount: entry.playerCount || 0,
      year: dateObject.getUTCFullYear(),
      month: dateObject.getUTCMonth(),
      groupKey: groupInfo.key,
      groupLabel: groupInfo.label,
      groupOrder: groupInfo.order,
      shortLabel: groupInfo.shortLabel
    };
  }).filter(isEntryInAllowedSingleEventMonth);
}

// Finds the latest available single-event entry for default selection.
export function getLatestSingleEventEntry(entries = buildSingleEventCalendarEntries()) {
  return entries[0] || null;
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

// Writes a selected single-event value into the hidden compatibility select.
export function setSelectedSingleEvent(eventName, dispatchChange = false) {
  const eventFilterMenu = document.getElementById('eventFilterMenu');
  if (!eventFilterMenu) {
    return;
  }

  const previousValue = eventFilterMenu.value;
  const hasOption = Array.from(eventFilterMenu.options).some(option => option.value === eventName);
  eventFilterMenu.value = hasOption ? eventName : '';
  filterState.selectedSingleEventName = eventFilterMenu.value || '';

  if (dispatchChange && eventFilterMenu.value !== previousValue) {
    eventFilterMenu.dispatchEvent(new Event('change'));
  }
}

// Sets the active event type for Single Event mode.
export function setSingleEventType(eventType) {
  getSectionEventTypeButtons(getEventAnalysisSection()).forEach(button => {
    button.classList.toggle('active', button.dataset.type === eventType);
  });
}

// Clears single-event type and event selection state.
export function resetSingleEventSelectionState() {
  resetEventFilterCalendarState();
  setSelectedSingleEvent('', false);
  filterState.lastSingleEventType = '';
}

// Clears only the calendar-backed selected event.
export function resetSingleEventCalendarSelection() {
  resetEventFilterCalendarState();
  setSelectedSingleEvent('', false);
}

// Shows or hides the single-event picker depending on active analysis mode.
export function updateSingleEventFilterVisibility() {
  const eventTypeSection = document.getElementById('eventTypeFilterSection');
  const eventFilterSection = document.getElementById('eventFilterSection');
  const multiEventPresetSection = document.getElementById('multiEventPresetSection');
  const isSingleMode = getAnalysisMode() === 'single';

  if (eventTypeSection) {
    eventTypeSection.style.display = isSingleMode ? 'none' : 'block';
  }

  if (eventFilterSection) {
    eventFilterSection.style.display = isSingleMode ? 'block' : 'none';
  }

  if (multiEventPresetSection) {
    multiEventPresetSection.style.display = isSingleMode ? 'none' : 'block';
  }

  filterRuntime.updateMultiEventSelectionSummary();
}

// Returns whether a valid single event is currently selected.
export function hasSelectedSingleEvent() {
  return Boolean(document.getElementById('eventFilterMenu')?.value);
}

// Selects the latest available event for first render.
export function applyLatestSingleEventSelection() {
  const entries = buildSingleEventCalendarEntries();
  const validStoredEntry = entries.find(entry => entry.name === filterState.selectedSingleEventName) || null;
  const latestEntry = validStoredEntry || getLatestSingleEventEntry(entries);
  if (!latestEntry) {
    resetSingleEventSelectionState();
    updateSingleEventFilterVisibility();
    updateEventFilter();
    return;
  }

  if (!getSectionEventTypeButtons(getEventAnalysisSection()).some(button => button.classList.contains('active'))) {
    setSingleEventType(latestEntry.eventType);
  }

  resetSingleEventSelectionState();
  updateSingleEventFilterVisibility();
  updateEventFilter(latestEntry.name, true);
}

// Rebuilds the single-event picker and hidden select for all available events.
export function updateEventFilter(preferredEvent = '', expandPreferredEvent = false) {
  const eventFilterMenu = document.getElementById('eventFilterMenu');
  if (!eventFilterMenu || getAnalysisMode() !== 'single') {
    return;
  }

  const entries = buildSingleEventCalendarEntries();

  if (expandPreferredEvent) {
    primeEventFilterCalendarSelection(preferredEvent, entries);
  }

  const currentSelectedEvent = preferredEvent || filterState.selectedSingleEventName || eventFilterMenu.value;

  populateEventFilterMenu(entries);

  const resolvedSelectedEvent = renderEventFilterCalendar({
    entries,
    selectedEvent: currentSelectedEvent,
    onSelectEvent: eventName => setSelectedSingleEvent(eventName, true),
    emptyMessage: 'No single events available.'
  });

  filterState.lastSingleEventType = '';
  setSelectedSingleEvent(resolvedSelectedEvent, false);
}
