function normalizeDates(dates = []) {
  return [...new Set(
    (Array.isArray(dates) ? dates : [])
      .map(value => String(value || '').trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));
}

export function getRankingsPeriodDefinitions(dates = []) {
  const normalizedDates = normalizeDates(dates);
  if (normalizedDates.length === 0) {
    return [];
  }

  const years = [...new Set(normalizedDates.map(date => date.slice(0, 4)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const definitions = [
    {
      id: 'all-period',
      label: 'All Period',
      startDate: normalizedDates[0],
      endDate: normalizedDates[normalizedDates.length - 1],
      years
    }
  ];

  years.forEach(year => {
    const yearDates = normalizedDates.filter(date => date.startsWith(`${year}-`));
    if (yearDates.length === 0) {
      return;
    }

    definitions.push({
      id: `all-${year}`,
      label: `All of ${year}`,
      year,
      startDate: yearDates[0],
      endDate: yearDates[yearDates.length - 1],
      years: [year]
    });
  });

  return definitions;
}

export function getDefaultRankingsPeriodId(dates = []) {
  const definitions = getRankingsPeriodDefinitions(dates);
  if (definitions.length === 0) {
    return '';
  }

  return definitions[definitions.length - 1]?.id || definitions[0]?.id || '';
}
