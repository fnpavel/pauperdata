import { formatEventName } from './format.js';
import { getEventGroupInfo } from './event-groups.js';

function parseDateParts(dateStr = '') {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  return { year, month, day };
}

function getSingleEventDateLabel(dateStr = '') {
  const parts = parseDateParts(dateStr);
  if (!parts) {
    return '';
  }

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return date.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long'
  });
}

function resolveEventDate(eventName = '', rows = []) {
  const dateMatch = String(eventName || '').match(/\((\d{4}-\d{2}-\d{2})\)$/);
  if (dateMatch) {
    return dateMatch[1];
  }

  return String(rows?.[0]?.Date || '').trim();
}

export function getSingleEventBadgeParts(eventName = '', rows = []) {
  const resolvedEventName = String(eventName || rows?.[0]?.Event || '').trim();
  const resolvedDate = resolveEventDate(resolvedEventName, rows);
  const dateParts = parseDateParts(resolvedDate);

  if (!resolvedEventName || !dateParts) {
    return {
      badges: ['No event selected'],
      yearLabel: '',
      dateLabel: '',
      eventTypeLabel: ''
    };
  }

  const yearLabel = String(dateParts.year);
  const dateLabel = getSingleEventDateLabel(resolvedDate);
  const eventTypeLabel = getEventGroupInfo(resolvedEventName)?.label || formatEventName(resolvedEventName) || resolvedEventName;
  const badges = [yearLabel, dateLabel, eventTypeLabel].filter(Boolean);

  return {
    badges: badges.length > 0 ? badges : ['No event selected'],
    yearLabel,
    dateLabel,
    eventTypeLabel
  };
}

export function renderSingleEventSummaryBadge({
  container = null,
  insertAfter = null,
  badgeId = '',
  eventName = '',
  rows = []
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

  const { badges } = getSingleEventBadgeParts(eventName, rows);
  badgeRow.innerHTML = badges
    .map(label => `<span class="leaderboard-info-badge">${label}</span>`)
    .join('');

  return badgeRow;
}
