// js/utils/format.js
export function formatDate(dateStr) { // From utils.js
  // Split the date string to avoid timezone interpretation issues
  const [year, month, day] = dateStr.split('-').map(Number);
  // Create a date object using UTC values but interpret as local
  const date = new Date(Date.UTC(year, month - 1, day)); 
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: '2-digit', year: 'numeric' });
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

// The eventName for ONLINE Events is stored as "MTGO <type of Event> (YYYY-MM-DD)" so this function will remove the "(YYYY-MM-DD)" as to not clash with the date being displayed elsewhere.
// Example: Raw Data for MTGO Challenge (2025-04-05) on May 04, 2025 isntead becomes Raw Data for MTGO Challenge on May 04, 2025 
export function formatEventName(eventName) {
  if (!eventName) return "";
  const dateSuffixPattern = /\s*\(\d{4}-\d{2}-\d{2}\)$/;
  if (dateSuffixPattern.test(eventName)) {
    return eventName.replace(dateSuffixPattern, "");
  }
  return eventName;
}