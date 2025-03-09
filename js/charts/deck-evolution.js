// js/charts/deck-evolution.js
import { setChartLoading } from '../utils/dom.js';
import { cleanedData } from '../data.js';
import { updateMultiEventTables } from '../modules/event-analysis.js';

export let deckEvolutionChart = null;

export function updateDeckEvolutionChart() {
  console.log("updateDeckEvolutionChart called...");
  setChartLoading("deckEvolutionChart", true);

  const startDate = document.getElementById("startDateSelect").value;
  const endDate = document.getElementById("endDateSelect").value;
  const selectedEventTypes = Array.from(document.querySelectorAll('.event-type-filter.active'))
    .map(button => button.dataset.type);
  const positionStart = parseInt(document.getElementById("positionStartSelect")?.value) || 1;
  const positionEnd = parseInt(document.getElementById("positionEndSelect")?.value) || Infinity;

  const filteredData = (startDate && endDate && selectedEventTypes.length > 0)
    ? cleanedData.filter(row => row.Date >= startDate && row.Date <= endDate && selectedEventTypes.includes(row.EventType))
    : [];
  const chartData = filteredData.filter(row => row.Rank >= positionStart && row.Rank <= positionEnd);

  const deckSelect = document.getElementById("deckEvolutionSelect");
  if (!deckSelect) {
    console.error("Deck selection dropdown not found!");
    setChartLoading("deckEvolutionChart", false);
    return;
  }

  const decks = [...new Set(filteredData.map(row => row.Deck))].sort((a, b) => a.localeCompare(b)); // Use unfiltered for deck options
  const currentDeck = deckSelect.value || (decks.length > 0 ? decks[0] : "");
  deckSelect.innerHTML = decks.map(deck => 
    `<option value="${deck}" ${deck === currentDeck ? 'selected' : ''}>${deck}</option>`
  ).join("");

  if (!deckSelect.dataset.listenerAdded) {
    deckSelect.addEventListener("change", () => updateDeckEvolutionChart());
    deckSelect.dataset.listenerAdded = "true";
  }

  if (deckEvolutionChart) deckEvolutionChart.destroy();
  const deckEvolutionCtx = document.getElementById("deckEvolutionChart");
  if (!deckEvolutionCtx) {
    console.error("Deck Evolution Chart canvas not found!");
    setChartLoading("deckEvolutionChart", false);
    return;
  }

  if (chartData.length === 0 || !currentDeck) {
    deckEvolutionChart = new Chart(deckEvolutionCtx, {
      type: 'bar',
      data: {
        labels: ["No Data"],
        datasets: [{ label: "Meta Share %", data: [0], borderColor: '#808080', backgroundColor: '#808080' }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { display: false }, x: { ticks: { color: '#fff' } } }
      }
    });
    updateMultiEventTables(filteredData, 'deck', currentDeck); // Unfiltered for tables
    setChartLoading("deckEvolutionChart", false);
    return;
  }

  const deckDataByDate = chartData.reduce((acc, row) => {
    if (row.Deck === currentDeck) {
      const date = row.Date;
      if (!acc[date]) acc[date] = { wins: 0, losses: 0, count: 0, totalPlayers: 0 };
      acc[date].wins += row.Wins;
      acc[date].losses += row.Losses;
      acc[date].count += 1;
    }
    acc[row.Date] = acc[row.Date] || { wins: 0, losses: 0, count: 0, totalPlayers: 0 };
    acc[row.Date].totalPlayers += 1;
    return acc;
  }, {});

  const dates = Object.keys(deckDataByDate).sort((a, b) => new Date(a) - new Date(b));
  const metaShares = dates.map(date => (deckDataByDate[date].count / (deckDataByDate[date].totalPlayers || 1)) * 100);
  const winRates = dates.map(date => {
    const { wins, losses } = deckDataByDate[date];
    return (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;
  });

  const datasets = [
    {
      label: `Meta Share %`,
      data: metaShares,
      borderColor: '#FF6347',
      backgroundColor: '#FF6347',
      fill: false,
      tension: 0.1,
      yAxisID: 'y',
      pointBackgroundColor: '#FF6347',
      pointBorderColor: '#FF6347'
    },
    {
      label: `Win Rate %`,
      data: winRates,
      borderColor: '#4682B4',
      backgroundColor: '#4682B4',
      fill: false,
      tension: 0.1,
      yAxisID: 'y2',
      pointBackgroundColor: '#4682B4',
      pointBorderColor: '#4682B4'
    }
  ];

  try {
    deckEvolutionChart = new Chart(deckEvolutionCtx, {
      type: 'bar',
      data: { labels: dates, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, max: 100, title: { display: true, text: "Meta Share %", color: '#fff' }, grid: { color: 'rgba(255, 255, 255, 0.1)' }, ticks: { color: '#fff' } },
          y2: { position: 'right', beginAtZero: true, max: 100, title: { display: true, text: "Win Rate %", color: '#fff' }, grid: { color: 'rgba(255, 255, 255, 0.1)' }, ticks: { color: '#fff' } },
          x: { title: { display: true, text: "Date", color: '#fff' }, grid: { borderDash: [5, 5], color: 'rgba(255, 255, 255, 0.1)' }, ticks: { color: '#fff', autoSkip: true, maxRotation: 45, minRotation: 0 } }
        },
        plugins: {
          legend: { position: 'top', labels: { color: '#e0e0e0', font: { size: 12 }, boxWidth: 20, padding: 10 } },
          tooltip: {
            mode: 'nearest',
            intersect: true,
            callbacks: {
              title: tooltipItems => tooltipItems[0].label,
              label: context => {
                const date = context.chart.data.labels[context.dataIndex];
                const metaShare = context.chart.data.datasets[0].data[context.dataIndex].toFixed(2);
                const winRate = context.chart.data.datasets[1].data[context.dataIndex].toFixed(2);
                const isMetaShare = context.datasetIndex === 0;

                const eventData = filteredData.filter(row => row.Date === date); // Unfiltered for tooltip details
                const detailsEl = document.getElementById('deckEvolutionEventDetails');
                if (eventData.length && detailsEl) {
                  const winnerRow = eventData.reduce((prev, curr) => {
                    const prevWinRate = (prev.Wins + prev.Losses) > 0 ? prev.Wins / (prev.Wins + prev.Losses) : 0;
                    const currWinRate = (curr.Wins + curr.Losses) > 0 ? curr.Wins / (curr.Wins + curr.Losses) : 0;
                    return currWinRate > prevWinRate ? curr : prev;
                  }, eventData[0]);
                  const winner = winnerRow.Player || "Unknown";
                  const winnerDeck = winnerRow.Deck || "Unknown";
                  const winnerDeckCount = eventData.filter(row => row.Deck === winnerDeck).length;
                  const totalPlayers = eventData.length;
                  const winnerMetaShare = ((winnerDeckCount / totalPlayers) * 100).toFixed(2);
                  const totalWins = eventData.reduce((sum, row) => sum + row.Wins, 0);
                  const totalLosses = eventData.reduce((sum, row) => sum + row.Losses, 0);
                  const overallWinRate = (totalWins + totalLosses) > 0 ? ((totalWins / (totalWins + totalLosses)) * 100).toFixed(2) : "0.00";
                  const eventName = eventData[0].Event || "Unnamed Event";
                  detailsEl.innerHTML = `
                    ${eventName} (${date})<br>
                    Won by ${winner} w/ ${winnerDeck}<br>
                    ${winnerMetaShare}% Meta, ${overallWinRate}% Win Rate
                  `;
                } else if (detailsEl) {
                  detailsEl.innerHTML = "No Event Data available";
                }

                return isMetaShare ? `Meta Share: ${metaShare}%` : `Win Rate: ${winRate}%`;
              },
              afterBody: function() {
                const detailsEl = document.getElementById('deckEvolutionEventDetails');
                if (detailsEl && this._active.length === 0) {
                  detailsEl.innerHTML = "";
                }
              }
            },
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleFont: { size: 14, weight: 'bold' },
            bodyFont: { size: 12 },
            padding: 10
          }
        }
      }
    });
  } catch (error) {
    console.error("Error initializing Deck Evolution Chart:", error);
  }

  updateMultiEventTables(filteredData, 'deck', currentDeck); // Unfiltered for tables

  const toggleButtons = document.querySelectorAll('#multiEventCharts .table-toggle-btn');
  toggleButtons.forEach(button => {
    button.addEventListener('click', () => {
      toggleButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      const tableType = button.dataset.table;
      updateMultiEventTables(filteredData, tableType, currentDeck);
    });
  });

  setChartLoading("deckEvolutionChart", false);
}