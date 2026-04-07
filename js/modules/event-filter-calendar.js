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

const calendarState = {
  entries: [],
  selectedEvent: '',
  selectedGroupKey: '',
  selectedYear: null,
  selectedMonth: null,
  emptyMessage: 'No events available.',
  onSelectEvent: null
};

export function resetEventFilterCalendarState() {
  calendarState.entries = [];
  calendarState.selectedEvent = '';
  calendarState.selectedGroupKey = '';
  calendarState.selectedYear = null;
  calendarState.selectedMonth = null;
  calendarState.emptyMessage = 'No events available.';
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
  calendarState.selectedGroupKey = entry.groupKey;
  calendarState.selectedYear = entry.year;
  calendarState.selectedMonth = entry.month;
}

function compareEntriesByDateDesc(entryA, entryB) {
  return entryB.date.localeCompare(entryA.date) || entryA.name.localeCompare(entryB.name);
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

function formatToolbarLabel(label) {
  return toDisplayTitleCase((label || '').replace(/^MTGO\s+/i, '').trim());
}

function buildGroupSummaries(entries) {
  const groupMap = new Map();

  entries.forEach(entry => {
    const currentGroup = groupMap.get(entry.groupKey);
    if (!currentGroup) {
      groupMap.set(entry.groupKey, {
        key: entry.groupKey,
        label: entry.groupLabel,
        order: entry.groupOrder ?? 100,
        latestDate: entry.date
      });
      return;
    }

    if (entry.date > currentGroup.latestDate) {
      currentGroup.latestDate = entry.date;
    }
  });

  return Array.from(groupMap.values()).sort((groupA, groupB) => {
    return (
      groupA.order - groupB.order ||
      groupB.latestDate.localeCompare(groupA.latestDate) ||
      groupA.label.localeCompare(groupB.label)
    );
  });
}

function getLatestEntry(entries) {
  return [...entries].sort(compareEntriesByDateDesc)[0] || null;
}

function getEntriesForCurrentMonth() {
  return calendarState.entries.filter(entry => {
    return (
      entry.groupKey === calendarState.selectedGroupKey &&
      entry.year === calendarState.selectedYear &&
      entry.month === calendarState.selectedMonth
    );
  });
}

function resolveCalendarState(selectedEvent) {
  if (calendarState.entries.length === 0) {
    calendarState.selectedEvent = '';
    calendarState.selectedGroupKey = '';
    calendarState.selectedYear = null;
    calendarState.selectedMonth = null;
    return null;
  }

  const entryByName = new Map(calendarState.entries.map(entry => [entry.name, entry]));
  const validSelectedEvent = entryByName.get(selectedEvent) || entryByName.get(calendarState.selectedEvent);

  if (validSelectedEvent) {
    calendarState.selectedEvent = validSelectedEvent.name;
    calendarState.selectedGroupKey = validSelectedEvent.groupKey;
    calendarState.selectedYear = validSelectedEvent.year;
    calendarState.selectedMonth = validSelectedEvent.month;
  }

  const groups = buildGroupSummaries(calendarState.entries);
  const availableGroupKeys = groups.map(group => group.key);
  if (!availableGroupKeys.includes(calendarState.selectedGroupKey)) {
    calendarState.selectedGroupKey = '';
  }

  if (!calendarState.selectedGroupKey) {
    calendarState.selectedYear = null;
    calendarState.selectedMonth = null;
    calendarState.selectedEvent = '';
    return null;
  }

  const groupEntries = calendarState.entries.filter(entry => entry.groupKey === calendarState.selectedGroupKey);
  const availableYears = [...new Set(groupEntries.map(entry => entry.year))].sort((yearA, yearB) => yearB - yearA);
  if (!availableYears.includes(calendarState.selectedYear)) {
    calendarState.selectedYear = null;
  }

  if (calendarState.selectedYear === null) {
    calendarState.selectedMonth = null;
    calendarState.selectedEvent = '';
    return null;
  }

  const yearEntries = groupEntries.filter(entry => entry.year === calendarState.selectedYear);
  const availableMonths = [...new Set(yearEntries.map(entry => entry.month))].sort((monthA, monthB) => monthB - monthA);
  if (!availableMonths.includes(calendarState.selectedMonth)) {
    calendarState.selectedMonth = availableMonths[0] ?? null;
  }

  const monthEntries = getEntriesForCurrentMonth();
  if (!monthEntries.some(entry => entry.name === calendarState.selectedEvent)) {
    calendarState.selectedEvent = '';
  }

  return entryByName.get(calendarState.selectedEvent) || null;
}

function notifySelectionChange(eventName) {
  if (eventName && typeof calendarState.onSelectEvent === 'function') {
    calendarState.onSelectEvent(eventName);
  }
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

function createToolbarButton(label, isActive, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `bubble-button${isActive ? ' active' : ''}`;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function createSectionLabel(text) {
  const label = document.createElement('div');
  label.className = 'event-calendar-label';
  label.textContent = text;
  return label;
}

function createSpacerCell() {
  const spacer = document.createElement('div');
  spacer.className = 'event-calendar-spacer';
  return spacer;
}

function getCurrentDisplayedEventName() {
  return document.getElementById('eventFilterMenu')?.value || '';
}

function drawCalendar(container, selectedEntry) {
  container.innerHTML = '';

  if (calendarState.entries.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'event-calendar-empty';
    emptyState.textContent = calendarState.emptyMessage;
    container.appendChild(emptyState);
    return;
  }

  const groups = buildGroupSummaries(calendarState.entries);
  const groupEntries = calendarState.entries.filter(entry => entry.groupKey === calendarState.selectedGroupKey);
  const years = [...new Set(groupEntries.map(entry => entry.year))].sort((yearA, yearB) => yearB - yearA);
  const months = [
    ...new Set(
      groupEntries
        .filter(entry => entry.year === calendarState.selectedYear)
        .map(entry => entry.month)
    )
  ].sort((monthA, monthB) => monthB - monthA);

  const selectedMonthEntries = getEntriesForCurrentMonth().sort(compareEntriesByDateDesc);
  const monthHeader = document.createElement('div');
  monthHeader.className = 'event-calendar-month-header';
  monthHeader.textContent = `${MONTH_NAMES[calendarState.selectedMonth]} ${calendarState.selectedYear}`;

  const displayedEventName = selectedEntry?.name || getCurrentDisplayedEventName();
  const summary = document.createElement('div');
  summary.className = 'event-calendar-summary';
  summary.innerHTML = displayedEventName
    ? `<span class="event-calendar-summary-label">Current Event Selected</span><strong>${formatDisplayEventName(displayedEventName)}</strong>`
    : '<span class="event-calendar-summary-label">Current Event Selected</span><strong>No event selected</strong>';

  const groupSection = document.createElement('div');
  groupSection.className = 'event-calendar-section';
  groupSection.appendChild(createSectionLabel('Group'));
  const groupToolbar = document.createElement('div');
  groupToolbar.className = 'event-calendar-toolbar';
  groups.forEach(group => {
    groupToolbar.appendChild(
      createToolbarButton(formatToolbarLabel(group.label), group.key === calendarState.selectedGroupKey, () => {
        const latestGroupEntry = getLatestEntry(
          calendarState.entries.filter(entry => entry.groupKey === group.key)
        );

        calendarState.selectedGroupKey = group.key;
        calendarState.selectedYear = latestGroupEntry?.year ?? null;
        calendarState.selectedMonth = latestGroupEntry?.month ?? null;
        calendarState.selectedEvent = latestGroupEntry?.name || '';
        rerenderCalendar(calendarState.selectedEvent, true);
      })
    );
  });
  groupSection.appendChild(groupToolbar);
  container.appendChild(groupSection);

  const yearSection = document.createElement('div');
  yearSection.className = 'event-calendar-section';
  yearSection.appendChild(createSectionLabel('Year'));
  const yearToolbar = document.createElement('div');
  yearToolbar.className = 'event-calendar-toolbar';
  years.forEach(year => {
    yearToolbar.appendChild(
      createToolbarButton(String(year), year === calendarState.selectedYear, () => {
        calendarState.selectedYear = year;
        calendarState.selectedMonth = null;
        calendarState.selectedEvent = '';
        rerenderCalendar('', true);
      })
    );
  });
  yearSection.appendChild(yearToolbar);
  container.appendChild(yearSection);

  const monthSection = document.createElement('div');
  monthSection.className = 'event-calendar-section';
  monthSection.appendChild(createSectionLabel('Month'));
  const monthToolbar = document.createElement('div');
  monthToolbar.className = 'event-calendar-toolbar';
  months.forEach(month => {
    monthToolbar.appendChild(
      createToolbarButton(MONTH_NAMES[month], month === calendarState.selectedMonth, () => {
        const nextEntry = getLatestEntry(
          calendarState.entries.filter(entry => {
            return (
              entry.groupKey === calendarState.selectedGroupKey &&
              entry.year === calendarState.selectedYear &&
              entry.month === month
            );
          })
        );
        if (!nextEntry) {
          return;
        }

        calendarState.selectedMonth = month;
        calendarState.selectedEvent = '';
        rerenderCalendar('', true);
      })
    );
  });
  monthSection.appendChild(monthToolbar);
  container.appendChild(monthSection);

  container.appendChild(summary);
  container.appendChild(monthHeader);

  const grid = document.createElement('div');
  grid.className = 'event-calendar-grid';

  WEEKDAY_NAMES.forEach(weekday => {
    const weekdayLabel = document.createElement('div');
    weekdayLabel.className = 'event-calendar-weekday';
    weekdayLabel.textContent = weekday;
    grid.appendChild(weekdayLabel);
  });

  const monthStart = new Date(Date.UTC(calendarState.selectedYear, calendarState.selectedMonth, 1));
  const daysInMonth = new Date(Date.UTC(calendarState.selectedYear, calendarState.selectedMonth + 1, 0)).getUTCDate();
  const firstWeekday = monthStart.getUTCDay();

  for (let index = 0; index < firstWeekday; index += 1) {
    grid.appendChild(createSpacerCell());
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dayCell = document.createElement('div');
    const dayEvents = selectedMonthEntries.filter(entry => entry.day === day);
    const isSelectedDay = dayEvents.some(entry => entry.name === calendarState.selectedEvent);
    dayCell.className = `event-calendar-day${isSelectedDay ? ' active' : ''}`;

    const dayNumber = document.createElement('div');
    dayNumber.className = 'event-calendar-day-number';
    dayNumber.textContent = String(day);
    dayCell.appendChild(dayNumber);

    if (dayEvents.length > 0) {
      const dayEventsWrapper = document.createElement('div');
      dayEventsWrapper.className = 'event-calendar-day-events';

      dayEvents.forEach(entry => {
        const eventButton = document.createElement('button');
        eventButton.type = 'button';
        eventButton.className = `event-calendar-event-button${entry.name === calendarState.selectedEvent ? ' active' : ''}`;
        eventButton.textContent = '';
        eventButton.title = formatDisplayEventName(entry.name);
        eventButton.setAttribute('aria-label', formatDisplayEventName(entry.name));
        eventButton.addEventListener('click', () => {
          calendarState.selectedEvent = entry.name;
          calendarState.selectedGroupKey = entry.groupKey;
          calendarState.selectedYear = entry.year;
          calendarState.selectedMonth = entry.month;
          rerenderCalendar(entry.name, true);
        });
        dayEventsWrapper.appendChild(eventButton);
      });

      dayCell.appendChild(dayEventsWrapper);
    }

    grid.appendChild(dayCell);
  }

  const totalCells = firstWeekday + daysInMonth;
  const trailingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let index = 0; index < trailingCells; index += 1) {
    grid.appendChild(createSpacerCell());
  }

  container.appendChild(grid);
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
      const dateObject = new Date(`${entry.date}T00:00:00`);
      return {
        ...entry,
        year: dateObject.getUTCFullYear(),
        month: dateObject.getUTCMonth(),
        day: dateObject.getUTCDate()
      };
    })
    .sort(compareEntriesByDateDesc);
  calendarState.emptyMessage = emptyMessage;
  calendarState.onSelectEvent = onSelectEvent;

  const selectedEntry = resolveCalendarState(selectedEvent);
  drawCalendar(container, selectedEntry);

  return selectedEntry?.name || '';
}
