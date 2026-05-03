import { getEventGroupInfo } from './event-groups.js';

function pluralizeEventTypeLabel(label = '', count = 0) {
  const normalizedLabel = String(label || '').trim();
  if (!normalizedLabel || count === 1) {
    return normalizedLabel;
  }

  if (/[bcdfghjklmnpqrstvwxyz]y$/i.test(normalizedLabel)) {
    return `${normalizedLabel.slice(0, -1)}ies`;
  }

  if (/(s|x|z|ch|sh)$/i.test(normalizedLabel)) {
    return `${normalizedLabel}es`;
  }

  return `${normalizedLabel}s`;
}

function parseDateParts(dateStr = '') {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  return { year, month, day };
}

function formatRangeDate(dateStr = '', { includeYear = false } = {}) {
  const parts = parseDateParts(dateStr);
  if (!parts) {
    return '';
  }

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return date.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'long',
    ...(includeYear ? { year: 'numeric' } : {})
  });
}

function buildYearLabel(startDate = '', endDate = '') {
  if (!startDate || !endDate) {
    return '';
  }

  const startYear = String(startDate).slice(0, 4);
  const endYear = String(endDate).slice(0, 4);
  return startYear === endYear ? startYear : `${startYear}–${endYear}`;
}

function buildDateRangeLabel(startDate = '', endDate = '') {
  if (!startDate || !endDate) {
    return '';
  }

  const startYear = String(startDate).slice(0, 4);
  const endYear = String(endDate).slice(0, 4);
  const sameYear = startYear === endYear;

  return sameYear
    ? `${formatRangeDate(startDate)}–${formatRangeDate(endDate)}`
    : `${formatRangeDate(startDate, { includeYear: true })}–${formatRangeDate(endDate, { includeYear: true })}`;
}

function getUniqueMultiEventEntries(rows = []) {
  const uniqueEvents = new Map();

  (Array.isArray(rows) ? rows : []).forEach(row => {
    const eventName = String(row?.Event || '').trim();
    const eventDate = String(row?.Date || '').trim();
    if (!eventName || !eventDate) {
      return;
    }

    const eventKey = `${eventDate}:::${eventName}`;
    if (!uniqueEvents.has(eventKey)) {
      uniqueEvents.set(eventKey, {
        name: eventName,
        date: eventDate,
        groupInfo: getEventGroupInfo(eventName)
      });
    }
  });

  return Array.from(uniqueEvents.values());
}

function buildEventTypeLabels(rows = []) {
  const groupedCounts = new Map();

  getUniqueMultiEventEntries(rows).forEach(entry => {
    const groupKey = String(entry?.groupInfo?.key || 'other').trim() || 'other';
    if (!groupedCounts.has(groupKey)) {
      groupedCounts.set(groupKey, {
        key: groupKey,
        label: String(entry?.groupInfo?.label || 'Other').trim() || 'Other',
        order: Number(entry?.groupInfo?.order) || 100,
        count: 0
      });
    }

    groupedCounts.get(groupKey).count += 1;
  });

  return Array.from(groupedCounts.values())
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map(group => `${group.count} ${pluralizeEventTypeLabel(group.label, group.count)}`);
}

export function getMultiEventPeriodBadgeParts(rows = [], { startDate = '', endDate = '' } = {}) {
  if (!startDate || !endDate || !Array.isArray(rows) || rows.length === 0) {
    return {
      badges: ['No events selected'],
      yearLabel: '',
      dateRangeLabel: '',
      eventTypeLabels: []
    };
  }

  const yearLabel = buildYearLabel(startDate, endDate);
  const dateRangeLabel = buildDateRangeLabel(startDate, endDate);
  const eventTypeLabels = buildEventTypeLabels(rows);

  const badges = [
    yearLabel,
    dateRangeLabel,
    ...eventTypeLabels
  ].filter(Boolean);

  return {
    badges: badges.length > 0 ? badges : ['No events selected'],
    yearLabel,
    dateRangeLabel,
    eventTypeLabels
  };
}

export function renderMultiEventPeriodSummaryBadge({
  container = null,
  insertAfter = null,
  badgeId = '',
  rows = [],
  startDate = '',
  endDate = ''
} = {}) {
  if (!container || !badgeId) {
    return null;
  }

  let badgeRow = container.querySelector(`#${badgeId}`);
  if (!badgeRow) {
    badgeRow = document.createElement('div');
    badgeRow.id = badgeId;
    badgeRow.className = 'leaderboard-info-badge-row multi-event-period-badge-row';
  }

  if (insertAfter?.parentNode) {
    insertAfter.insertAdjacentElement('afterend', badgeRow);
  } else if (!badgeRow.parentNode) {
    container.prepend(badgeRow);
  }

  const { badges } = getMultiEventPeriodBadgeParts(rows, { startDate, endDate });
  badgeRow.innerHTML = badges
    .map(label => `<span class="leaderboard-info-badge">${label}</span>`)
    .join('');

  return badgeRow;
}
