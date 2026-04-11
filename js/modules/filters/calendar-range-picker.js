// Renders the interactive calendar UI used to choose start and end dates across range-based analysis views.
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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

const rangeCalendarStates = new Map();

function getRangeCalendarState(containerId) {
  if (!rangeCalendarStates.has(containerId)) {
    rangeCalendarStates.set(containerId, {
      startViewMonth: '',
      endViewMonth: ''
    });
  }

  return rangeCalendarStates.get(containerId);
}

function getMonthKey(dateString) {
  return dateString ? dateString.slice(0, 7) : '';
}

function getDateParts(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return { year, monthIndex: month - 1, day };
}

function buildMonthOptions(dateStrings) {
  return [...new Set(dateStrings.map(getMonthKey))].sort();
}

function shiftMonth(monthKey, direction, availableMonths) {
  const currentIndex = availableMonths.indexOf(monthKey);
  if (currentIndex === -1) {
    return monthKey;
  }

  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= availableMonths.length) {
    return monthKey;
  }

  return availableMonths[nextIndex];
}

function ensureViewMonth(currentMonth, fallbackMonth, availableMonths) {
  if (availableMonths.length === 0) {
    return '';
  }

  if (availableMonths.includes(currentMonth)) {
    return currentMonth;
  }

  if (fallbackMonth && availableMonths.includes(fallbackMonth)) {
    return fallbackMonth;
  }

  return availableMonths[availableMonths.length - 1];
}

function buildDayButton(label, className, onClick, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.disabled = disabled;
  if (!disabled) {
    button.addEventListener('click', onClick);
  }
  return button;
}

function buildMonthYearOptions(availableMonths) {
  const yearMap = new Map();

  availableMonths.forEach(monthKey => {
    const [yearString, monthString] = monthKey.split('-');
    if (!yearMap.has(yearString)) {
      yearMap.set(yearString, []);
    }
    yearMap.get(yearString).push(Number(monthString) - 1);
  });

  return {
    years: Array.from(yearMap.keys()).sort(),
    monthsByYear: yearMap
  };
}

function renderCalendarPanel({
  title,
  viewMonth,
  availableMonths,
  selectableDates,
  allDatesSet,
  selectedDate,
  onNavigateMonth,
  onSelectDate
}) {
  const panel = document.createElement('div');
  panel.className = 'range-calendar-panel';

  const { years, monthsByYear } = buildMonthYearOptions(availableMonths);
  const [yearString, monthString] = viewMonth.split('-');
  const availableMonthsForYear = monthsByYear.get(yearString) || [];

  const header = document.createElement('div');
  header.className = 'range-calendar-header';

  const prevButton = buildDayButton(
    '<',
    'range-calendar-nav',
    () => onNavigateMonth(shiftMonth(viewMonth, -1, availableMonths)),
    availableMonths.indexOf(viewMonth) <= 0
  );

  const nextButton = buildDayButton(
    '>',
    'range-calendar-nav',
    () => onNavigateMonth(shiftMonth(viewMonth, 1, availableMonths)),
    availableMonths.indexOf(viewMonth) === availableMonths.length - 1
  );

  const titleWrap = document.createElement('div');
  titleWrap.className = 'range-calendar-title-wrap';

  const label = document.createElement('div');
  label.className = 'range-calendar-label';
  label.textContent = title;

  const controls = document.createElement('div');
  controls.className = 'range-calendar-jump-controls';

  const monthSelect = document.createElement('select');
  monthSelect.className = 'range-calendar-select';
  availableMonthsForYear.forEach(monthIndex => {
    const option = document.createElement('option');
    option.value = String(monthIndex + 1).padStart(2, '0');
    option.textContent = MONTH_NAMES[monthIndex];
    option.selected = option.value === monthString;
    monthSelect.appendChild(option);
  });
  monthSelect.addEventListener('change', () => {
    onNavigateMonth(`${yearString}-${monthSelect.value}`);
  });

  const yearSelect = document.createElement('select');
  yearSelect.className = 'range-calendar-select';
  years.forEach(yearValue => {
    const option = document.createElement('option');
    option.value = yearValue;
    option.textContent = yearValue;
    option.selected = yearValue === yearString;
    yearSelect.appendChild(option);
  });
  yearSelect.addEventListener('change', () => {
    const nextYear = yearSelect.value;
    const nextAvailableMonths = monthsByYear.get(nextYear) || [];
    const nextMonth =
      nextAvailableMonths.includes(Number(monthSelect.value) - 1)
        ? monthSelect.value
        : String((nextAvailableMonths[0] ?? 0) + 1).padStart(2, '0');
    onNavigateMonth(`${nextYear}-${nextMonth}`);
  });

  titleWrap.appendChild(label);
  controls.appendChild(monthSelect);
  controls.appendChild(yearSelect);
  titleWrap.appendChild(controls);

  header.appendChild(prevButton);
  header.appendChild(titleWrap);
  header.appendChild(nextButton);
  panel.appendChild(header);

  const weekdayRow = document.createElement('div');
  weekdayRow.className = 'range-calendar-weekdays';
  WEEKDAY_NAMES.forEach(weekday => {
    const weekdayCell = document.createElement('div');
    weekdayCell.className = 'range-calendar-weekday';
    weekdayCell.textContent = weekday;
    weekdayRow.appendChild(weekdayCell);
  });
  panel.appendChild(weekdayRow);

  const grid = document.createElement('div');
  grid.className = 'range-calendar-grid';

  const { year, monthIndex } = getDateParts(`${viewMonth}-01`);
  const firstDay = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

  for (let index = 0; index < firstDay; index += 1) {
    const spacer = document.createElement('div');
    spacer.className = 'range-calendar-spacer';
    grid.appendChild(spacer);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateString = `${yearString}-${monthString}-${String(day).padStart(2, '0')}`;
    const isSelectable = selectableDates.has(dateString);
    const hasEvents = allDatesSet.has(dateString);
    const isSelected = selectedDate === dateString;

    const dayButton = document.createElement('button');
    dayButton.type = 'button';
    dayButton.className = [
      'range-calendar-day',
      isSelectable ? 'available' : '',
      hasEvents ? 'has-events' : '',
      isSelected ? 'active' : ''
    ]
      .filter(Boolean)
      .join(' ');
    dayButton.textContent = String(day);
    dayButton.disabled = !isSelectable;

    if (isSelectable) {
      dayButton.addEventListener('click', () => onSelectDate(dateString));
    }

    grid.appendChild(dayButton);
  }

  panel.appendChild(grid);
  return panel;
}

export function renderDateRangeCalendar({
  containerId,
  dates = [],
  startDate = '',
  endDate = '',
  startLabel = 'Start Date',
  endLabel = 'End Date',
  emptyMessage = 'Select an Event Type first.',
  onSelectStartDate,
  onSelectEndDate
}) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  container.innerHTML = '';
  const calendarState = getRangeCalendarState(containerId);

  if (dates.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'event-calendar-empty';
    emptyState.textContent = emptyMessage;
    container.appendChild(emptyState);
    calendarState.startViewMonth = '';
    calendarState.endViewMonth = '';
    return;
  }

  const allDatesSet = new Set(dates);
  const startSelectableDates = new Set(endDate ? dates.filter(date => date <= endDate) : dates);
  const endSelectableDates = new Set(startDate ? dates.filter(date => date >= startDate) : dates);
  const startMonths = buildMonthOptions([...startSelectableDates]);
  const endMonths = buildMonthOptions([...endSelectableDates]);

  calendarState.startViewMonth = ensureViewMonth(
    calendarState.startViewMonth,
    getMonthKey(startDate) || startMonths[0],
    startMonths
  );
  calendarState.endViewMonth = ensureViewMonth(
    calendarState.endViewMonth,
    getMonthKey(endDate) || endMonths[endMonths.length - 1],
    endMonths
  );

  const wrapper = document.createElement('div');
  wrapper.className = 'range-calendar-wrapper';

  wrapper.appendChild(
    renderCalendarPanel({
      title: startLabel,
      viewMonth: calendarState.startViewMonth,
      availableMonths: startMonths,
      selectableDates: startSelectableDates,
      allDatesSet,
      selectedDate: startDate,
      onNavigateMonth: monthKey => {
        calendarState.startViewMonth = monthKey;
        renderDateRangeCalendar({
          containerId,
          dates,
          startDate,
          endDate,
          startLabel,
          endLabel,
          emptyMessage,
          onSelectStartDate,
          onSelectEndDate
        });
      },
      onSelectDate: dateString => onSelectStartDate?.(dateString)
    })
  );

  wrapper.appendChild(
    renderCalendarPanel({
      title: endLabel,
      viewMonth: calendarState.endViewMonth,
      availableMonths: endMonths,
      selectableDates: endSelectableDates,
      allDatesSet,
      selectedDate: endDate,
      onNavigateMonth: monthKey => {
        calendarState.endViewMonth = monthKey;
        renderDateRangeCalendar({
          containerId,
          dates,
          startDate,
          endDate,
          startLabel,
          endLabel,
          emptyMessage,
          onSelectStartDate,
          onSelectEndDate
        });
      },
      onSelectDate: dateString => onSelectEndDate?.(dateString)
    })
  );

  container.appendChild(wrapper);
}

export function renderMultiEventDateRangeCalendar(options = {}) {
  return renderDateRangeCalendar({
    containerId: 'multiEventDateRangeCalendar',
    ...options
  });
}

export function renderPlayerDateRangeCalendar(options = {}) {
  return renderDateRangeCalendar({
    containerId: 'playerDateRangeCalendar',
    emptyMessage: 'Select a Player and Event Type first.',
    ...options
  });
}
