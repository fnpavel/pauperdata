// js/utils/format.js
export function formatDate(dateStr) { // From utils.js
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
}

export function formatPercentage(value) { // Existing from previous
  return `${parseFloat(value).toFixed(1)}%`;
}

export function formatDateRange(startDateStr, endDateStr) { // Existing from previous
  if (!startDateStr || !endDateStr) return "Select a date range";
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);
  const months = (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth()) + 1;
  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();
  return startYear === endYear
    ? `${months} month${months > 1 ? 's' : ''}, in ${startYear}`
    : `${months} month${months > 1 ? 's' : ''}, from ${startYear} to ${endYear}`;
}