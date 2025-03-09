// js/charts/multi-meta-win-rate.js
import { setChartLoading } from '../utils/dom.js';
import { cleanedData } from '../data.js';

export let metaWinRateChart = null;

export function updateMultiMetaWinRateChart() {
  console.log("updateMultiMetaWinRateChart called...");
  setChartLoading("metaWinRateChart", true);

  const startDate = document.getElementById("startDateSelect").value;
  const endDate = document.getElementById("endDateSelect").value;
  const selectedEventTypes = Array.from(document.querySelectorAll('.event-type-filter.active'))
    .map(button => button.dataset.type);
  const positionStart = parseInt(document.getElementById("positionStartSelect")?.value) || 1;
  const positionEnd = parseInt(document.getElementById("positionEndSelect")?.value) || Infinity;
  const positionType = document.querySelector('.position-type.active')?.dataset.type || "meta";

  const filteredData = (startDate && endDate && selectedEventTypes.length > 0) 
    ? cleanedData.filter(row => row.Date >= startDate && row.Date <= endDate && selectedEventTypes.includes(row.EventType))
    : [];

  if (filteredData.length === 0) {
    console.log("No filtered data, skipping chart creation...");
    if (metaWinRateChart) metaWinRateChart.destroy();
    setChartLoading("metaWinRateChart", false);
    return;
  }

  const totalPlayers = filteredData.length;
  const deckStats = filteredData.reduce((acc, row) => {
    if (!acc[row.Deck]) acc[row.Deck] = { wins: 0, losses: 0, count: 0 };
    acc[row.Deck].wins += row.Wins;
    acc[row.Deck].losses += row.Losses;
    acc[row.Deck].count += 1;
    return acc;
  }, {});
  const decks = Object.keys(deckStats);
  const metaPercentages = decks.map(deck => (deckStats[deck].count / totalPlayers) * 100);
  const winRates = decks.map(deck => {
    const { wins, losses } = deckStats[deck];
    return (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;
  });

  // Sort and filter by positionType
  const deckData = decks.map((deck, i) => ({
    deck,
    meta: metaPercentages[i],
    winRate: winRates[i]
  }));
  const sortedDecks = positionType === "meta"
    ? deckData.sort((a, b) => b.meta - a.meta || a.deck.localeCompare(b.deck))
    : deckData.sort((a, b) => b.winRate - a.winRate || a.deck.localeCompare(b.deck));
  const filteredDecks = sortedDecks.slice(positionStart - 1, positionEnd);
  const filteredDeckNames = filteredDecks.map(d => d.deck);

  // Update dropdown options dynamically
  const positionStartSelect = document.getElementById("positionStartSelect");
  const positionEndSelect = document.getElementById("positionEndSelect");
  const maxPosition = decks.length;
  const positionOptions = Array.from({ length: maxPosition }, (_, i) => i + 1)
    .map(rank => `<option value="${rank}">${rank}</option>`).join("");
  positionStartSelect.innerHTML = `<option value="">All</option>${positionOptions}`;
  positionEndSelect.innerHTML = `<option value="">All</option>${positionOptions}`;
  positionStartSelect.value = positionStart <= maxPosition ? positionStart : "";
  positionEndSelect.value = positionEnd <= maxPosition ? positionEnd : "";

  if (filteredDeckNames.length === 0) {
    console.log("No decks in range, skipping chart creation...");
    if (metaWinRateChart) metaWinRateChart.destroy();
    setChartLoading("metaWinRateChart", false);
    return;
  }

  const filteredMetaPercentages = filteredDecks.map(d => d.meta);
  const filteredWinRates = filteredDecks.map(d => d.winRate);
  const metaMin = Math.max(0, Math.min(...filteredMetaPercentages) - 5);
  const metaMax = Math.max(...filteredMetaPercentages) + 5;

  const datasets = [
    {
      type: 'bar',
      label: 'Meta %',
      data: filteredMetaPercentages,
      backgroundColor: '#FF6347', // Single color for Meta %
      yAxisID: 'y',
      order: 2
    },
    {
      type: 'bar',
      label: 'Win Rate %',
      data: filteredWinRates,
      backgroundColor: '#4682B4', // Single color for Win Rate %
      yAxisID: 'y2',
      order: 1
    }
  ];

  if (metaWinRateChart) metaWinRateChart.destroy();
  const metaWinRateMultiCtx = document.getElementById("metaWinRateChart");
  if (!metaWinRateMultiCtx) {
    console.error("Meta Win Rate Chart (Multi-Event) canvas not found!");
    setChartLoading("metaWinRateChart", false);
    return;
  }

  try {
    metaWinRateChart = new Chart(metaWinRateMultiCtx, {
      data: { labels: filteredDeckNames, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { 
            min: metaMin, 
            max: metaMax, 
            title: { display: true, text: "Meta %", color: '#fff' }, 
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
            title: { display: true, text: "Decks", color: '#fff' }, 
            grid: { borderDash: [5, 5], color: 'rgba(255, 255, 255, 0.1)' }, 
            ticks: { color: '#fff', autoSkip: false, maxRotation: 45, minRotation: 45 } 
          }
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { 
              color: '#e0e0e0', 
              font: { size: 14, weight: 'bold' },
              boxWidth: 20,
              padding: 10
            }
          },
          tooltip: {
            callbacks: {
              label: context => `${context.dataset.label}: ${context.raw.toFixed(2)}%`
            }
          }
        }
      }
    });
  } catch (error) {
    console.error("Error initializing Multi-Event Meta/Win Rate Chart:", error);
  }
  setChartLoading("metaWinRateChart", false);
}