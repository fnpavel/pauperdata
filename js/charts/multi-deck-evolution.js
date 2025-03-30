import { setChartLoading } from '../utils/dom.js';
import { getDeckEvolutionChartData } from '../modules/filters.js';
import { calculateDeckEvolutionStats } from "../utils/data-chart.js";
import { updateMultiEventTables } from '../modules/event-analysis.js';

export let deckEvolutionChart = null;

export function updateDeckEvolutionChart() {
  console.log("updateDeckEvolutionChart called...");
  setChartLoading("deckEvolutionChart", true);

  const filteredData = getDeckEvolutionChartData();
  const deckSelect = document.getElementById("deckEvolutionSelect");
  if (!deckSelect) {
    console.error("Deck selection dropdown not found!");
    setChartLoading("deckEvolutionChart", false);
    return;
  }

  const decks = [...new Set(filteredData.map(row => row.Deck))].sort((a, b) => a.localeCompare(b));
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

  if (filteredData.length === 0 || !currentDeck) {
    deckEvolutionChart = new Chart(deckEvolutionCtx, {
      type: 'bar',
      data: {
        labels: ["No Data"],
        datasets: [{ label: "Meta Share %", data: [0], backgroundColor: '#808080' }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { display: false }, x: { ticks: { color: '#fff' } } }
      }
    });
    updateMultiEventTables(filteredData, 'deck', currentDeck);
    setChartLoading("deckEvolutionChart", false);
    return;
  }

  const { dates, metaShares, winRates } = calculateDeckEvolutionStats(filteredData, currentDeck);
  const maxMetaShare = Math.max(...metaShares, 1);
  const metaShareMax = Math.ceil(maxMetaShare / 10) * 10;

  const datasets = [
    {
      label: `Meta Share %`,
      data: metaShares,
      backgroundColor: '#FF6347',
      borderColor: '#FF6347',
      borderWidth: 1,
      barPercentage: 0.5,
      categoryPercentage: 0.8,
      yAxisID: 'y'
    },
    {
      type: 'line',
      label: `Win Rate %`,
      data: winRates,
      borderColor: '#FFD700',
      backgroundColor: '#FFD700',
      pointBackgroundColor: '#FFD700',
      pointBorderColor: '#FFD700',
      pointRadius: 4,
      pointHoverRadius: 6,
      fill: false,
      tension: 0.2,
      yAxisID: 'y2'
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
          y: { 
            beginAtZero: true, 
            max: metaShareMax,
            title: { display: true, text: "Meta Share %", color: '#fff' }, 
            grid: { color: 'rgba(255, 255, 255, 0.1)' }, 
            ticks: { color: '#fff' } 
          },
          y2: { 
            position: 'right', 
            beginAtZero: true, 
            max: 100,
            title: { display: true, text: "Win Rate %", color: '#fff' }, 
            grid: { color: 'rgba(255, 255, 255, 0.1)' }, 
            ticks: { color: '#fff' } 
          },
          x: { 
            title: { display: true, text: "Date", color: '#fff' }, 
            grid: { borderDash: [5, 5], color: 'rgba(255, 255, 255, 0.1)' }, 
            ticks: { color: '#fff', autoSkip: true, maxRotation: 45, minRotation: 0 } 
          }
        },
        plugins: {
          legend: { 
            position: 'top', 
            labels: { color: '#e0e0e0', font: { size: 12 }, boxWidth: 20, padding: 10 } 
          },
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

                const eventData = filteredData.filter(row => row.Date === date);
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

  updateMultiEventTables(filteredData, 'deck', currentDeck);

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