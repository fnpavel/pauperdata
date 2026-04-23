// Handles single-event filter state, event selection, and calendar-backed event menu updates.
import {
  renderEventFilterCalendar,
  resetEventFilterCalendarState,
  primeEventFilterCalendarSelection
} from './single-event-picker.js';
import { getEventGroupInfo } from '../../utils/event-groups.js';
import { getAnalysisRows } from '../../utils/analysis-data.js';
import { filterState } from './state.js';
import { filterRuntime } from './runtime.js';
import {
  getAnalysisMode,
  getEventAnalysisSection,
  getSectionEventTypeButtons,
  getSingleEventSelectedType,
  clearSectionEventTypes
} from './shared.js';

// Extracts a YYYY-MM-DD date from an event name when a row date is unavailable.
export function getEventDate(eventName) {
  const match = eventName.match(/\((\d{4}-\d{2}-\d{2})\)$/);
  if (match) {
    return match[1];
  }

  return getAnalysisRows().find(row => row.Event === eventName)?.Date || '';
}

// Builds calendar-picker entries for the active single-event event type.
export function buildSingleEventCalendarEntries(selectedEventType) {
  const entries = new Map();

  getAnalysisRows().forEach(row => {
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

// Finds the latest available single-event entry for default selection.
export function getLatestSingleEventEntry() {
  const entries = new Map();

  getAnalysisRows().forEach(row => {
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

// Writes a selected single-event value into the hidden compatibility select.
export function setSelectedSingleEvent(eventName, dispatchChange = false) {
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
    eventTypeSection.style.display = 'block';
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
  return Boolean(getSingleEventSelectedType() && document.getElementById('eventFilterMenu')?.value);
}

// Selects the latest available event for first render.
export function applyLatestSingleEventSelection() {
  const latestEntry = getLatestSingleEventEntry();
  if (!latestEntry) {
    clearSectionEventTypes(getEventAnalysisSection());
    resetSingleEventSelectionState();
    updateSingleEventFilterVisibility();
    updateEventFilter();
    return;
  }

  setSingleEventType(latestEntry.eventType);
  resetSingleEventSelectionState();
  updateSingleEventFilterVisibility();
  updateEventFilter(latestEntry.name, true);
}

// Rebuilds the single-event picker and hidden select for the active event type.
export function updateEventFilter(preferredEvent = '', expandPreferredEvent = false) {
  const eventFilterMenu = document.getElementById('eventFilterMenu');
  if (!eventFilterMenu || getAnalysisMode() !== 'single') {
    return;
  }

  const selectedEventType = getSingleEventSelectedType();
  const eventTypeChanged = selectedEventType !== filterState.lastSingleEventType;

  if (!selectedEventType) {
    filterState.lastSingleEventType = '';
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
    resetSingleEventSelectionState();
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

  filterState.lastSingleEventType = selectedEventType;
  setSelectedSingleEvent(resolvedSelectedEvent, false);
}
