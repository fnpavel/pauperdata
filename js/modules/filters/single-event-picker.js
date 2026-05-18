// Renders the single-event picker used by the event filter and keeps its local selection state in sync.
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_VISIBLE_MARKERS = 4;

const calendarState = {
  entries: [],
  selectedEvent: '',
  viewYear: null,
  viewMonth: null,
  emptyMessage: 'No events available.',
  onSelectEvent: null,
  pickerView: 'calendar',
  chooserDateKey: '',
  cleanupDocumentListener: null,
  pendingFocusTarget: null
};

function getCurrentRealWorldMonthLimit() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth()
  };
}

export function resetEventFilterCalendarState() {
  calendarState.entries = [];
  calendarState.selectedEvent = '';
  calendarState.viewYear = null;
  calendarState.viewMonth = null;
  calendarState.emptyMessage = 'No events available.';
  calendarState.onSelectEvent = null;
  calendarState.pickerView = 'calendar';
  calendarState.chooserDateKey = '';
  if (typeof calendarState.cleanupDocumentListener === 'function') {
    calendarState.cleanupDocumentListener();
    calendarState.cleanupDocumentListener = null;
  }
  calendarState.pendingFocusTarget = null;
}

export function primeEventFilterCalendarSelection(selectedEvent, entries = []) {
  const sourceEntries = entries.length > 0 ? entries : calendarState.entries;
  if (!selectedEvent || sourceEntries.length === 0) {
    return;
  }

  const entry = sourceEntries.find(item => item.name === selectedEvent);
  if (!entry) {
    return;
  }

  calendarState.selectedEvent = entry.name;
  calendarState.viewYear = entry.year;
  calendarState.viewMonth = entry.month;
}

function compareEntriesByDateDesc(entryA, entryB) {
  return (
    entryB.date.localeCompare(entryA.date)
    || (entryB.playerCount || 0) - (entryA.playerCount || 0)
    || entryA.name.localeCompare(entryB.name)
  );
}

function toDisplayTitleCase(value) {
  return value.replace(/\b([A-Za-z])([A-Za-z']*)\b/g, (_, firstChar, rest) => {
    return `${firstChar.toUpperCase()}${rest.toLowerCase()}`;
  });
}

function formatDisplayEventName(eventName) {
  if (!eventName) {
    return '';
  }

  const withoutMtgoPrefix = eventName.replace(/^MTGO\s+/i, '');
  return withoutMtgoPrefix.replace(/^([^(]+?)(\s*\(\d{4}-\d{2}-\d{2}\))?$/, (_, labelPart, datePart = '') => {
    return `${toDisplayTitleCase(labelPart.trim())}${datePart}`;
  });
}

function formatEventMetaLabel(entry) {
  const typeLabel = entry.eventType ? `${entry.eventType[0].toUpperCase()}${entry.eventType.slice(1)}` : 'Unknown';
  const groupLabel = entry.groupLabel || entry.shortLabel || 'Event';
  return `${groupLabel} | ${typeLabel}`;
}

function getEntryHighlightVariant(entry) {
  const normalizedGroup = String(entry?.groupLabel || entry?.shortLabel || entry?.name || '').toLowerCase();

  if (normalizedGroup.includes('challenge')) {
    return 'challenge';
  }

  if (
    normalizedGroup.includes('qualifier')
    || normalizedGroup.includes('showcase')
    || normalizedGroup.includes('super')
    || normalizedGroup.includes('championship')
  ) {
    return 'premier';
  }

  return 'default';
}

function buildDateKey(year, month, day) {
  const monthValue = String(month + 1).padStart(2, '0');
  const dayValue = String(day).padStart(2, '0');
  return `${year}-${monthValue}-${dayValue}`;
}

function getEntriesForVisibleMonth() {
  return calendarState.entries.filter(entry => entry.year === calendarState.viewYear && entry.month === calendarState.viewMonth);
}

function getEntriesByDateForVisibleMonth() {
  const entriesByDate = new Map();

  getEntriesForVisibleMonth().forEach(entry => {
    const dateKey = buildDateKey(entry.year, entry.month, entry.day);
    if (!entriesByDate.has(dateKey)) {
      entriesByDate.set(dateKey, []);
    }

    entriesByDate.get(dateKey).push(entry);
  });

  entriesByDate.forEach(entries => entries.sort(compareEntriesByDateDesc));
  return entriesByDate;
}

function getAvailableYears() {
  return [...new Set(calendarState.entries.map(entry => entry.year))].sort((yearA, yearB) => yearB - yearA);
}

function getAvailableMonthBounds() {
  if (calendarState.entries.length === 0) {
    return {
      minYear: null,
      minMonth: null,
      maxYear: null,
      maxMonth: null
    };
  }

  const sortedEntries = [...calendarState.entries].sort(compareEntriesByDateDesc);
  const oldestEntry = sortedEntries[sortedEntries.length - 1] || null;
  const currentLimit = getCurrentRealWorldMonthLimit();

  return {
    minYear: oldestEntry?.year ?? null,
    minMonth: oldestEntry?.month ?? null,
    maxYear: currentLimit.year,
    maxMonth: currentLimit.month
  };
}

function isFutureMonth(year, month) {
  const currentLimit = getCurrentRealWorldMonthLimit();
  return year > currentLimit.year || (year === currentLimit.year && month > currentLimit.month);
}

function clampViewToAllowedMonth() {
  const { minYear, minMonth, maxYear, maxMonth } = getAvailableMonthBounds();
  if (calendarState.viewYear === null || calendarState.viewMonth === null) {
    return;
  }

  if (maxYear !== null && (calendarState.viewYear > maxYear || (calendarState.viewYear === maxYear && calendarState.viewMonth > maxMonth))) {
    calendarState.viewYear = maxYear;
    calendarState.viewMonth = maxMonth;
  }

  if (minYear !== null && (calendarState.viewYear < minYear || (calendarState.viewYear === minYear && calendarState.viewMonth < minMonth))) {
    calendarState.viewYear = minYear;
    calendarState.viewMonth = minMonth;
  }
}

function canNavigateMonth(offset) {
  const { minYear, minMonth, maxYear, maxMonth } = getAvailableMonthBounds();
  if (calendarState.viewYear === null || calendarState.viewMonth === null) {
    return false;
  }

  const nextDate = new Date(Date.UTC(calendarState.viewYear, calendarState.viewMonth + offset, 1));
  const nextYear = nextDate.getUTCFullYear();
  const nextMonth = nextDate.getUTCMonth();
  const afterMinimum = minYear === null || nextYear > minYear || (nextYear === minYear && nextMonth >= minMonth);
  const beforeMaximum = maxYear === null || nextYear < maxYear || (nextYear === maxYear && nextMonth <= maxMonth);
  return afterMinimum && beforeMaximum;
}

function moveVisibleMonth(offset) {
  if (!canNavigateMonth(offset)) {
    return;
  }

  const nextDate = new Date(Date.UTC(calendarState.viewYear, calendarState.viewMonth + offset, 1));
  calendarState.viewYear = nextDate.getUTCFullYear();
  calendarState.viewMonth = nextDate.getUTCMonth();
  calendarState.pickerView = 'calendar';
  calendarState.chooserDateKey = '';
}

function resolveCalendarState(selectedEvent) {
  if (calendarState.entries.length === 0) {
    calendarState.selectedEvent = '';
    calendarState.viewYear = null;
    calendarState.viewMonth = null;
    calendarState.pickerView = 'calendar';
    calendarState.chooserDateKey = '';
    return null;
  }

  const entryByName = new Map(calendarState.entries.map(entry => [entry.name, entry]));
  const validSelectedEntry = entryByName.get(selectedEvent) || entryByName.get(calendarState.selectedEvent) || null;

  if (validSelectedEntry) {
    calendarState.selectedEvent = validSelectedEntry.name;
  } else if (!entryByName.has(calendarState.selectedEvent)) {
    calendarState.selectedEvent = '';
  }

  const availableYears = getAvailableYears();
  const latestEntry = calendarState.entries[0];
  if (!availableYears.includes(calendarState.viewYear)) {
    calendarState.viewYear = validSelectedEntry?.year ?? latestEntry?.year ?? null;
  }

  if (calendarState.viewMonth === null || calendarState.viewMonth < 0 || calendarState.viewMonth > 11) {
    calendarState.viewMonth = validSelectedEntry?.month ?? latestEntry?.month ?? null;
  }

  clampViewToAllowedMonth();

  if (calendarState.chooserDateKey) {
    const visibleEntriesByDate = getEntriesByDateForVisibleMonth();
    if (!visibleEntriesByDate.has(calendarState.chooserDateKey)) {
      calendarState.chooserDateKey = '';
    }
  }

  return validSelectedEntry;
}

function notifySelectionChange(eventName) {
  if (eventName && typeof calendarState.onSelectEvent === 'function') {
    calendarState.onSelectEvent(eventName);
  }
}

function closeEventChooser({ restoreFocus = true } = {}) {
  const focusDateKey = calendarState.chooserDateKey;
  calendarState.chooserDateKey = '';

  if (restoreFocus && focusDateKey) {
    calendarState.pendingFocusTarget = {
      type: 'day',
      dateKey: focusDateKey
    };
  }
}

function setSelectedEvent(entry, notify = true, focusDateKey = '') {
  if (!entry) {
    return;
  }

  calendarState.selectedEvent = entry.name;
  calendarState.viewYear = entry.year;
  calendarState.viewMonth = entry.month;
  calendarState.chooserDateKey = '';
  calendarState.pickerView = 'calendar';
  if (focusDateKey) {
    calendarState.pendingFocusTarget = {
      type: 'day',
      dateKey: focusDateKey
    };
  }
  rerenderCalendar(entry.name, notify);
}

function rerenderCalendar(nextSelectedEvent, notify = false) {
  const selectedEntry = resolveCalendarState(nextSelectedEvent);
  const container = document.getElementById('eventCalendarFilter');
  if (!container) {
    return;
  }

  drawCalendar(container, selectedEntry);

  if (notify) {
    notifySelectionChange(selectedEntry?.name || '');
  }
}

function createTextNodeElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function createIconButton(label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function createDayButton(day, entries = [], isSelectedDay = false) {
  const dateKey = buildDateKey(calendarState.viewYear, calendarState.viewMonth, day);
  const hasEvents = entries.length > 0;
  const isChooserOpen = calendarState.chooserDateKey === dateKey;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `event-calendar-day${hasEvents ? ' has-events' : ''}${isSelectedDay ? ' active' : ''}${isChooserOpen ? ' chooser-open' : ''}`;
  button.disabled = !hasEvents;
  button.dataset.dateKey = dateKey;
  button.setAttribute(
    'aria-label',
    hasEvents
      ? `${MONTH_NAMES[calendarState.viewMonth]} ${day}, ${calendarState.viewYear}. ${entries.length} event${entries.length === 1 ? '' : 's'} available.`
      : `${MONTH_NAMES[calendarState.viewMonth]} ${day}, ${calendarState.viewYear}. No events.`
  );
  button.setAttribute('aria-pressed', hasEvents && (isSelectedDay || isChooserOpen) ? 'true' : 'false');
  button.setAttribute('aria-haspopup', entries.length > 1 ? 'dialog' : 'false');
  button.setAttribute('aria-expanded', entries.length > 1 && isChooserOpen ? 'true' : 'false');

  button.addEventListener('click', () => {
    if (entries.length === 1) {
      setSelectedEvent(entries[0], true);
      return;
    }

    if (entries.length > 1) {
      const isOpeningChooser = calendarState.chooserDateKey !== dateKey;
      calendarState.chooserDateKey = isOpeningChooser ? dateKey : '';
      calendarState.pickerView = 'calendar';
      calendarState.pendingFocusTarget = isOpeningChooser
        ? { type: 'chooser', dateKey }
        : { type: 'day', dateKey };
      rerenderCalendar(calendarState.selectedEvent, false);
    }
  });

  const dayNumber = createTextNodeElement('span', 'event-calendar-day-number', String(day));
  button.appendChild(dayNumber);

  if (hasEvents) {
    const markerRow = document.createElement('span');
    markerRow.className = 'event-calendar-day-events';

    entries.slice(0, MAX_VISIBLE_MARKERS).forEach(entry => {
      const marker = document.createElement('span');
      const highlightVariant = getEntryHighlightVariant(entry);
      marker.className = `event-calendar-event-marker${entry.name === calendarState.selectedEvent ? ` active event-calendar-event-marker-${highlightVariant}` : ''}`;
      marker.title = formatDisplayEventName(entry.name);
      marker.setAttribute('aria-hidden', 'true');
      markerRow.appendChild(marker);
    });

    if (entries.length > MAX_VISIBLE_MARKERS) {
      const overflow = createTextNodeElement('span', 'event-calendar-event-overflow', `+${entries.length - MAX_VISIBLE_MARKERS}`);
      overflow.setAttribute('aria-hidden', 'true');
      markerRow.appendChild(overflow);
    }

    button.appendChild(markerRow);
  }

  return button;
}

function renderHeaderControls(container) {
  const headerRow = document.createElement('div');
  headerRow.className = 'event-calendar-header-row';

  const previousButton = createIconButton('<', 'event-calendar-nav', () => {
    moveVisibleMonth(-1);
    rerenderCalendar(calendarState.selectedEvent, false);
  });
  previousButton.setAttribute('aria-label', 'Show previous month');
  previousButton.disabled = !canNavigateMonth(-1);

  const nextButton = createIconButton('>', 'event-calendar-nav', () => {
    moveVisibleMonth(1);
    rerenderCalendar(calendarState.selectedEvent, false);
  });
  nextButton.setAttribute('aria-label', 'Show next month');
  nextButton.disabled = !canNavigateMonth(1);

  const monthHeaderButton = document.createElement('button');
  monthHeaderButton.type = 'button';
  monthHeaderButton.className = 'event-calendar-month-header';
  monthHeaderButton.setAttribute('aria-expanded', calendarState.pickerView !== 'calendar' ? 'true' : 'false');
  monthHeaderButton.setAttribute('aria-label', `Change month or year. Currently ${MONTH_NAMES[calendarState.viewMonth]} ${calendarState.viewYear}.`);
  monthHeaderButton.textContent = `${MONTH_NAMES[calendarState.viewMonth]} ${calendarState.viewYear}`;
  monthHeaderButton.addEventListener('click', () => {
    calendarState.pickerView = calendarState.pickerView === 'months' ? 'calendar' : 'months';
    calendarState.chooserDateKey = '';
    rerenderCalendar(calendarState.selectedEvent, false);
  });

  headerRow.append(previousButton, monthHeaderButton, nextButton);
  container.appendChild(headerRow);
}

function renderMonthPicker(container) {
  const picker = document.createElement('div');
  picker.className = 'event-calendar-picker-panel';
  picker.setAttribute('role', 'dialog');
  picker.setAttribute('aria-label', 'Choose a month');

  const pickerHeader = document.createElement('div');
  pickerHeader.className = 'event-calendar-picker-header';

  const yearButton = document.createElement('button');
  yearButton.type = 'button';
  yearButton.className = 'event-calendar-picker-year';
  yearButton.setAttribute('aria-label', `Change calendar year. Currently ${calendarState.viewYear}`);
  yearButton.addEventListener('click', () => {
    calendarState.pickerView = 'years';
    rerenderCalendar(calendarState.selectedEvent, false);
  });
  yearButton.append(
    createTextNodeElement('span', 'event-calendar-picker-year-value', String(calendarState.viewYear)),
    createTextNodeElement('span', 'event-calendar-picker-year-hint', 'Change year'),
    createTextNodeElement('span', 'event-calendar-picker-year-icon', 'v')
  );

  const closeButton = createIconButton('X', 'event-calendar-picker-close', () => {
    calendarState.pickerView = 'calendar';
    rerenderCalendar(calendarState.selectedEvent, false);
  });
  closeButton.setAttribute('aria-label', 'Close month picker');

  pickerHeader.append(yearButton, closeButton);
  picker.appendChild(pickerHeader);

  const monthGrid = document.createElement('div');
  monthGrid.className = 'event-calendar-month-picker-grid';

  MONTH_NAMES.forEach((monthName, monthIndex) => {
    const button = document.createElement('button');
    const isDisabled = isFutureMonth(calendarState.viewYear, monthIndex);
    button.type = 'button';
    button.className = `event-calendar-picker-option${monthIndex === calendarState.viewMonth ? ' active' : ''}${isDisabled ? ' disabled' : ''}`;
    button.textContent = monthName;
    button.disabled = isDisabled;
    button.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
    button.setAttribute(
      'aria-label',
      isDisabled
        ? `${monthName} ${calendarState.viewYear} is unavailable because it is in the future.`
        : `Show ${monthName} ${calendarState.viewYear}`
    );

    if (!isDisabled) {
      button.addEventListener('click', () => {
        calendarState.viewMonth = monthIndex;
        calendarState.pickerView = 'calendar';
        rerenderCalendar(calendarState.selectedEvent, false);
      });
    }

    monthGrid.appendChild(button);
  });

  picker.appendChild(monthGrid);
  container.appendChild(picker);
}

function getRenderableYears() {
  return getAvailableYears().filter(year => {
    return MONTH_NAMES.some((_, monthIndex) => !isFutureMonth(year, monthIndex));
  });
}

function renderYearPicker(container) {
  const years = getRenderableYears();
  const picker = document.createElement('div');
  picker.className = 'event-calendar-picker-panel';
  picker.setAttribute('role', 'dialog');
  picker.setAttribute('aria-label', 'Choose a year');

  const pickerHeader = document.createElement('div');
  pickerHeader.className = 'event-calendar-picker-header';

  const label = createTextNodeElement('div', 'event-calendar-picker-title', 'Available Years');
  const closeButton = createIconButton('X', 'event-calendar-picker-close', () => {
    calendarState.pickerView = 'calendar';
    rerenderCalendar(calendarState.selectedEvent, false);
  });
  closeButton.setAttribute('aria-label', 'Close year picker');

  pickerHeader.append(label, closeButton);
  picker.appendChild(pickerHeader);

  const yearGrid = document.createElement('div');
  yearGrid.className = 'event-calendar-year-picker-grid';

  years.forEach(year => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `event-calendar-picker-option${year === calendarState.viewYear ? ' active' : ''}`;
    button.textContent = String(year);
    button.setAttribute('aria-label', `Show month list for ${year}`);
    button.addEventListener('click', () => {
      calendarState.viewYear = year;
      if (isFutureMonth(calendarState.viewYear, calendarState.viewMonth)) {
        calendarState.viewMonth = getCurrentRealWorldMonthLimit().month;
      }
      calendarState.pickerView = 'months';
      rerenderCalendar(calendarState.selectedEvent, false);
    });
    yearGrid.appendChild(button);
  });

  picker.appendChild(yearGrid);
  container.appendChild(picker);
}

function renderEventChooser(container, entriesByDate) {
  if (!calendarState.chooserDateKey) {
    return;
  }

  const chooserEntries = entriesByDate.get(calendarState.chooserDateKey) || [];
  if (chooserEntries.length <= 1) {
    return;
  }

  const [year, month, day] = calendarState.chooserDateKey.split('-').map(Number);
  const overlay = document.createElement('div');
  overlay.className = 'event-calendar-chooser-overlay';

  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'event-calendar-chooser-backdrop';
  backdrop.setAttribute('aria-label', 'Close event chooser');
  backdrop.addEventListener('click', () => {
    closeEventChooser({ restoreFocus: true });
    rerenderCalendar(calendarState.selectedEvent, false);
  });

  const chooser = document.createElement('div');
  chooser.className = 'event-calendar-chooser';
  chooser.setAttribute('role', 'dialog');
  chooser.setAttribute('aria-modal', 'true');
  chooser.setAttribute('aria-label', `Choose an event on ${MONTH_NAMES[(month || 1) - 1]} ${day}, ${year}`);
  chooser.dataset.chooserDateKey = calendarState.chooserDateKey;
  chooser.tabIndex = -1;

  const chooserHeader = document.createElement('div');
  chooserHeader.className = 'event-calendar-chooser-header';
  chooserHeader.appendChild(
    createTextNodeElement(
      'div',
      'event-calendar-chooser-title',
      `${MONTH_NAMES[(month || 1) - 1]} ${day}, ${year} | ${chooserEntries.length} events`
    )
  );

  const closeButton = createIconButton('X', 'event-calendar-picker-close', () => {
    closeEventChooser({ restoreFocus: true });
    rerenderCalendar(calendarState.selectedEvent, false);
  });
  closeButton.setAttribute('aria-label', 'Close event chooser');
  chooserHeader.appendChild(closeButton);
  chooser.appendChild(chooserHeader);

  const chooserList = document.createElement('div');
  chooserList.className = 'event-calendar-chooser-list';

  chooserEntries.forEach(entry => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `event-calendar-chooser-option${entry.name === calendarState.selectedEvent ? ' active' : ''}`;
    button.setAttribute('aria-label', `Select ${formatDisplayEventName(entry.name)}`);
    button.addEventListener('click', () => {
      setSelectedEvent(entry, true, calendarState.chooserDateKey);
    });

    const title = createTextNodeElement('span', 'event-calendar-chooser-option-title', formatDisplayEventName(entry.name));
    const meta = createTextNodeElement('span', 'event-calendar-chooser-option-meta', formatEventMetaLabel(entry));
    button.append(title, meta);
    chooserList.appendChild(button);
  });

  chooser.appendChild(chooserList);
  overlay.append(backdrop, chooser);
  container.appendChild(overlay);
  positionChooserOverlay(container, chooser);
}

function positionChooserOverlay(container, chooser) {
  const anchorDateKey = chooser?.dataset?.chooserDateKey;
  if (!container || !chooser || !anchorDateKey) {
    return;
  }

  const anchorButton = container.querySelector(`.event-calendar-day[data-date-key="${anchorDateKey}"]`);
  const gridWrap = container.matches('.event-calendar-grid-wrap') ? container : container.querySelector('.event-calendar-grid-wrap');
  if (!anchorButton || !gridWrap) {
    return;
  }

  const gridRect = gridWrap.getBoundingClientRect();
  const anchorRect = anchorButton.getBoundingClientRect();
  const chooserRect = chooser.getBoundingClientRect();
  const horizontalPadding = 12;
  const verticalPadding = 12;
  const preferredTop = (anchorRect.top - gridRect.top) + anchorRect.height + 10;
  const fallbackTop = Math.max(verticalPadding, (anchorRect.top - gridRect.top) - chooserRect.height - 10);
  const maxTop = Math.max(verticalPadding, gridRect.height - chooserRect.height - verticalPadding);
  const top = Math.min(preferredTop <= maxTop ? preferredTop : fallbackTop, maxTop);
  const preferredLeft = (anchorRect.left - gridRect.left) + (anchorRect.width / 2) - (chooserRect.width / 2);
  const maxLeft = Math.max(horizontalPadding, gridRect.width - chooserRect.width - horizontalPadding);
  const left = Math.max(horizontalPadding, Math.min(preferredLeft, maxLeft));

  chooser.style.top = `${top}px`;
  chooser.style.left = `${left}px`;
}

function installDocumentCloseBehavior(container) {
  if (typeof calendarState.cleanupDocumentListener === 'function') {
    calendarState.cleanupDocumentListener();
    calendarState.cleanupDocumentListener = null;
  }

  const handlePointerDown = event => {
    if (container.contains(event.target)) {
      return;
    }

    if (calendarState.pickerView !== 'calendar' || calendarState.chooserDateKey) {
      calendarState.pickerView = 'calendar';
      if (calendarState.chooserDateKey) {
        closeEventChooser({ restoreFocus: true });
      }
      rerenderCalendar(calendarState.selectedEvent, false);
    }
  };

  document.addEventListener('mousedown', handlePointerDown);
  calendarState.cleanupDocumentListener = () => {
    document.removeEventListener('mousedown', handlePointerDown);
  };
}

function applyPendingFocus(container) {
  if (!calendarState.pendingFocusTarget) {
    return;
  }

  const focusTarget = calendarState.pendingFocusTarget;
  calendarState.pendingFocusTarget = null;

  requestAnimationFrame(() => {
    if (!container?.isConnected) {
      return;
    }

    if (focusTarget.type === 'chooser') {
      const activeOption = container.querySelector('.event-calendar-chooser-option.active');
      const firstOption = container.querySelector('.event-calendar-chooser-option');
      const closeButton = container.querySelector('.event-calendar-chooser .event-calendar-picker-close');
      (activeOption || firstOption || closeButton)?.focus();
      return;
    }

    if (focusTarget.type === 'day' && focusTarget.dateKey) {
      container.querySelector(`.event-calendar-day[data-date-key="${focusTarget.dateKey}"]`)?.focus();
    }
  });
}

function drawCalendar(container, selectedEntry) {
  if (typeof calendarState.cleanupDocumentListener === 'function') {
    calendarState.cleanupDocumentListener();
    calendarState.cleanupDocumentListener = null;
  }

  container.innerHTML = '';
  container.classList.toggle('event-calendar-filter-empty', calendarState.entries.length === 0);

  container.onkeydown = event => {
    if (event.key !== 'Escape') {
      return;
    }

    if (calendarState.chooserDateKey) {
      closeEventChooser({ restoreFocus: true });
      rerenderCalendar(calendarState.selectedEvent, false);
      event.preventDefault();
      return;
    }

    if (calendarState.pickerView !== 'calendar') {
      calendarState.pickerView = 'calendar';
      rerenderCalendar(calendarState.selectedEvent, false);
      event.preventDefault();
    }
  };

  if (calendarState.entries.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'event-calendar-empty';
    emptyState.textContent = calendarState.emptyMessage;
    container.appendChild(emptyState);
    return;
  }

  const displayedEventName = selectedEntry?.name || document.getElementById('eventFilterMenu')?.value || '';
  const summary = document.createElement('div');
  summary.className = 'event-calendar-summary';
  summary.innerHTML = displayedEventName
    ? `<span class="event-calendar-summary-label">Current Event Selected</span><strong>${formatDisplayEventName(displayedEventName)}</strong>`
    : '<span class="event-calendar-summary-label">Current Event Selected</span><strong>No event selected</strong>';
  container.appendChild(summary);

  renderHeaderControls(container);

  if (calendarState.pickerView === 'months') {
    renderMonthPicker(container);
    installDocumentCloseBehavior(container);
    return;
  }

  if (calendarState.pickerView === 'years') {
    renderYearPicker(container);
    installDocumentCloseBehavior(container);
    return;
  }

  const entriesByDate = getEntriesByDateForVisibleMonth();
  const monthEntries = getEntriesForVisibleMonth();
  const monthHeaderDescription = createTextNodeElement(
    'div',
    'event-calendar-month-subtitle',
    monthEntries.length > 0
      ? `${monthEntries.length} event${monthEntries.length === 1 ? '' : 's'} in view`
      : 'No single events in this month'
  );
  container.appendChild(monthHeaderDescription);

  const gridWrap = document.createElement('div');
  gridWrap.className = 'event-calendar-grid-wrap';

  const grid = document.createElement('div');
  grid.className = 'event-calendar-grid';

  WEEKDAY_NAMES.forEach(weekday => {
    grid.appendChild(createTextNodeElement('div', 'event-calendar-weekday', weekday));
  });

  const monthStart = new Date(Date.UTC(calendarState.viewYear, calendarState.viewMonth, 1));
  const daysInMonth = new Date(Date.UTC(calendarState.viewYear, calendarState.viewMonth + 1, 0)).getUTCDate();
  const firstWeekday = monthStart.getUTCDay();

  for (let index = 0; index < firstWeekday; index += 1) {
    grid.appendChild(createTextNodeElement('div', 'event-calendar-spacer', ''));
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = buildDateKey(calendarState.viewYear, calendarState.viewMonth, day);
    const dayEntries = entriesByDate.get(dateKey) || [];
    const isSelectedDay = dayEntries.some(entry => entry.name === calendarState.selectedEvent);
    grid.appendChild(createDayButton(day, dayEntries, isSelectedDay));
  }

  const totalCells = firstWeekday + daysInMonth;
  const trailingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let index = 0; index < trailingCells; index += 1) {
    grid.appendChild(createTextNodeElement('div', 'event-calendar-spacer', ''));
  }

  gridWrap.appendChild(grid);
  container.appendChild(gridWrap);
  renderEventChooser(gridWrap, entriesByDate);
  installDocumentCloseBehavior(container);
  applyPendingFocus(container);
}

export function renderEventFilterCalendar({
  entries = [],
  selectedEvent = '',
  onSelectEvent = null,
  emptyMessage = 'No events available.'
}) {
  const container = document.getElementById('eventCalendarFilter');
  if (!container) {
    return selectedEvent;
  }

  calendarState.entries = entries
    .map(entry => {
      const dateObject = new Date(`${entry.date}T00:00:00Z`);
      return {
        ...entry,
        year: dateObject.getUTCFullYear(),
        month: dateObject.getUTCMonth(),
        day: dateObject.getUTCDate()
      };
    })
    .filter(entry => !Number.isNaN(entry.year) && !Number.isNaN(entry.month) && !Number.isNaN(entry.day))
    .sort(compareEntriesByDateDesc);
  calendarState.emptyMessage = emptyMessage;
  calendarState.onSelectEvent = onSelectEvent;

  const selectedEntry = resolveCalendarState(selectedEvent);
  drawCalendar(container, selectedEntry);

  return selectedEntry?.name || '';
}
