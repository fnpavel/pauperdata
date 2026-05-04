// Shared visual config for the two Multi-Event scatter charts. This keeps the
// axis styling aligned while letting each chart keep its own natural X range.
export function buildSharedMultiScatterYAxis(theme) {
  return {
    type: 'linear',
    title: {
      display: true,
      text: 'Win Rate %',
      color: theme.text,
      font: { size: 14, weight: 'bold', family: "'Bitter', serif" }
    },
    ticks: {
      color: theme.text,
      font: { size: 12, family: "'Bitter', serif" },
      callback: value => `${value}%`,
      stepSize: 10
    },
    grid: { color: theme.grid },
    min: 0,
    max: 100
  };
}
