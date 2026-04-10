import { setChartLoading } from '../utils/dom.js';

let leaderboardOverviewChart = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatLeaderboardPercentage(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return `${Number(value).toFixed(2)}%`;
}

function formatAverageFinish(value) {
  if (!Number.isFinite(value) || value === Number.POSITIVE_INFINITY) {
    return '--';
  }

  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `#${rounded}` : `#${rounded.toFixed(1)}`;
}

export function renderLeaderboardOverviewChart(
  leaderboardRows = [],
  filteredRows = [],
  startDate = '',
  endDate = '',
  activeWindowLabel = '',
  onBarClick = null
) {
  setChartLoading('leaderboardOverviewChart', true);
  const chartCanvas = document.getElementById('leaderboardOverviewChart');
  const chartDetails = document.getElementById('leaderboardChartDetails');

  if (!chartCanvas || !chartDetails) {
    setChartLoading('leaderboardOverviewChart', false);
    return;
  }

  if (leaderboardOverviewChart) {
    leaderboardOverviewChart.destroy();
    leaderboardOverviewChart = null;
  }

  const topRows = leaderboardRows.slice(0, 10);
  if (topRows.length === 0) {
    chartDetails.textContent = 'No leaderboard data available for the selected filters.';
    setChartLoading('leaderboardOverviewChart', false);
    return;
  }

  const ctx = chartCanvas.getContext('2d');
  const maxScore = Math.max(...topRows.map(row => row.score));
  const suggestedMax = maxScore > 50 ? maxScore + 10 :maxScore + 5; // Ensure bars are not too long, min 60 for visibility
  leaderboardOverviewChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: topRows.map(row => row.player.length > 20 ? row.player.substring(0, 17) + '...' : row.player),
      datasets: [
        {
          label: 'Leaderboard Score',
          data: topRows.map(row => row.score),
          backgroundColor: topRows.map((_, index) => {
            if (index === 0) return 'rgba(217, 164, 65, 0.95)';
            if (index === 1) return 'rgba(111, 153, 178, 0.92)';
            if (index === 2) return 'rgba(174, 123, 91, 0.9)';
            return 'rgba(91, 126, 171, 0.82)';
          }),
          borderColor: topRows.map((_, index) => {
            if (index === 0) return 'rgba(255, 221, 102, 1)';
            if (index === 1) return 'rgba(173, 214, 238, 1)';
            if (index === 2) return 'rgba(214, 164, 134, 1)';
            return 'rgba(142, 184, 230, 1)';
          }),
          borderWidth: 1.5,
          borderRadius: 8,
          maxBarThickness: 40 // Limit bar thickness for better visibility
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_event, elements) => {
        if (!Array.isArray(elements) || elements.length === 0 || typeof onBarClick !== 'function') {
          return;
        }

        const row = topRows[elements[0].index];
        if (row) {
          onBarClick(row);
        }
      },
      plugins: {
        title: {
          display: true,
          text: [
            'Score Charts',
            'Scoring: Top 1 = 10 pts, Top 2-8 = 6 pts, Top 9-16 = 3 pts, Top 17-32 = 1 pt.'
          ],
          color: '#f7f3ea',
          font: {
            size: 16,
            weight: 'bold'
          },
          padding: {
            bottom: 20
          }
        },
        legend: {
          display: false
        },
        datalabels: {
          color: '#f7f3ea',
          anchor: 'end',
          align: 'right',
          clamp: true,
          formatter: value => `${value}`
        },
        tooltip: {
          callbacks: {
            title: context => topRows[context[0]?.dataIndex]?.player || '',
            label: context => {
              const row = topRows[context.dataIndex];
              return `Score: ${row.score}`;
            },
            afterBody: context => {
              const row = topRows[context[0]?.dataIndex];
              if (!row) {
                return [];
              }

              const pct = (count, total) => total > 0 ? formatLeaderboardPercentage((count / total) * 100) : '--';

              return [
                `Top 1: ${row.top1} (${pct(row.top1, row.events)})`,
                `Top 2-8: ${row.top8 - row.top1} (${pct(row.top8 - row.top1, row.events)})`,
                `Top 9-16: ${row.top9_16} (${pct(row.top9_16, row.events)})`,
                `Top 17-32: ${row.top17_32} (${pct(row.top17_32, row.events)})`,
                `Top 33+: ${row.top33Plus} (${pct(row.top33Plus, row.events)})`,
                `Events: ${row.events}`,
                `Win Rate: ${formatLeaderboardPercentage(row.winRate)}`,
                `Avg Finish: ${formatAverageFinish(row.averageFinish)}`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          suggestedMax,
          ticks: {
            color: '#f7f3ea'
          },
          grid: {
            color: 'rgba(255, 255, 255, 0.08)'
          }
        },
        y: {
          ticks: {
            color: '#f7f3ea'
          },
          grid: {
            display: false
          }
        }
      }
    }
  });

  const leader = topRows[0];
  const eventCount = new Set(filteredRows.map(row => String(row.Event || '').trim()).filter(Boolean)).size;
  chartDetails.innerHTML = `
    <strong>${escapeHtml(activeWindowLabel)}</strong>
    ${startDate && endDate ? ` | ${escapeHtml(startDate)} to ${escapeHtml(endDate)}` : ''}
    ${eventCount ? ` | ${eventCount} event${eventCount === 1 ? '' : 's'}` : ''}
    <br>
    Leader: <strong>${escapeHtml(leader.player)}</strong> with <strong>${leader.score} pts</strong>,
    ${leader.top1} Top 1 finish${leader.top1 === 1 ? '' : 'es'},
    and ${formatLeaderboardPercentage(leader.winRate)} overall win rate.
  `;
  setChartLoading('leaderboardOverviewChart', false);
}
