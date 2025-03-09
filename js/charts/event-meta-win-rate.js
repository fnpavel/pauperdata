// js/charts/event-meta-win-rate.js
import { setChartLoading } from '../utils/dom.js';
import { cleanedData } from '../data.js';
import { updateSingleEventTables } from '../modules/event-analysis.js';

export let metaWinRateEventChart = null;

export function updateEventMetaWinRateChart() {
  console.log("updateEventMetaWinRateChart called...");
  setChartLoading("metaWinRateEventChart", true);

  const selectedEventType = document.querySelector('.event-type-filter.active')?.dataset.type || "";
  const eventFilterMenu = document.getElementById("eventFilterMenu");
  const selectedEvents = eventFilterMenu && eventFilterMenu.value ? [eventFilterMenu.value] : [];
  const positionStart = parseInt(document.getElementById("positionStartSelect")?.value) || 1;
  const positionEnd = parseInt(document.getElementById("positionEndSelect")?.value) || Infinity;
  const positionType = document.querySelector('.position-type.active')?.dataset.type || "meta";

  let eventData = cleanedData.filter(row => 
    row.EventType === selectedEventType &&
    selectedEvents.includes(row.Event)
  );

  if (eventData.length === 0 || selectedEvents.length === 0) {
    console.log("No data, skipping chart creation...");
    if (metaWinRateEventChart) metaWinRateEventChart.destroy();
    updateSingleEventTables(eventData, 'raw');
    setChartLoading("metaWinRateEventChart", false);
    return;
  }

  const totalPlayers = eventData.length;
  const deckStats = eventData.reduce((acc, row) => {
    if (!acc[row.Deck]) {
      acc[row.Deck] = { count: 0, wins: 0, losses: 0 };
    }
    acc[row.Deck].count += 1;
    acc[row.Deck].wins += row.Wins;
    acc[row.Deck].losses += row.Losses;
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
    if (metaWinRateEventChart) metaWinRateEventChart.destroy();
    updateSingleEventTables(eventData, 'raw');
    setChartLoading("metaWinRateEventChart", false);
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

  if (metaWinRateEventChart) metaWinRateEventChart.destroy();
  const metaWinRateCtx = document.getElementById("metaWinRateEventChart");
  if (!metaWinRateCtx) {
    console.error("Meta Win Rate Event Chart canvas not found!");
    setChartLoading("metaWinRateEventChart", false);
    return;
  }

  try {
    metaWinRateEventChart = new Chart(metaWinRateCtx, {
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
    console.error("Error initializing Meta/Win Rate Chart:", error);
  }

  // Use unfiltered eventData for tables
  updateSingleEventTables(eventData, 'raw');

  const toggleButtons = document.querySelectorAll('.table-toggle-btn');
  toggleButtons.forEach(button => {
    button.addEventListener('click', () => {
      toggleButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      const tableType = button.dataset.table;
      updateSingleEventTables(eventData, tableType);
    });
  });

  setChartLoading("metaWinRateEventChart", false);
}