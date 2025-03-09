// js/charts/event-funnel.js
import { setChartLoading } from '../utils/dom.js';
import { cleanedData } from '../data.js';

export let eventFunnelChart = null;

export function updateEventFunnelChart() {
  console.log("updateEventFunnelChart called...");
  setChartLoading("eventFunnelChart", true);

  const selectedEventType = document.querySelector('.event-type-filter.active')?.dataset.type || "";
  const eventFilterMenu = document.getElementById("eventFilterMenu");
  const selectedEvents = eventFilterMenu && eventFilterMenu.value ? [eventFilterMenu.value] : [];
  const positionStart = parseInt(document.getElementById("positionStartSelect")?.value) || 1;
  const positionEnd = parseInt(document.getElementById("positionEndSelect")?.value) || Infinity;

  let filteredData = cleanedData.filter(row => 
    row.EventType === selectedEventType &&
    selectedEvents.includes(row.Event)
  );
  let chartData = filteredData.filter(row => row.Rank >= positionStart && row.Rank <= positionEnd);

  if (chartData.length === 0 || selectedEvents.length === 0) {
    if (eventFunnelChart) eventFunnelChart.destroy();
    setChartLoading("eventFunnelChart", false);
    return;
  }

  const deckConversionStats = chartData.reduce((acc, row) => {
    if (!acc[row.Deck]) {
      acc[row.Deck] = {
        total: 0,
        rank1_8: 0,
        rank9_16: 0,
        rank17_32: 0,
        rank33_worse: 0
      };
    }
    acc[row.Deck].total += 1;
    if (row.Rank >= 1 && row.Rank <= 8) acc[row.Deck].rank1_8 += 1;
    else if (row.Rank >= 9 && row.Rank <= 16) acc[row.Deck].rank9_16 += 1;
    else if (row.Rank >= 17 && row.Rank <= 32) acc[row.Deck].rank17_32 += 1;
    else acc[row.Deck].rank33_worse += 1;
    return acc;
  }, {});

  const topDecks = [...new Set(chartData.map(row => row.Deck))];
  const percentages = {
    rank1_8: topDecks.map(deck => {
      const stats = deckConversionStats[deck] || { total: 0, rank1_8: 0 };
      return stats.total > 0 ? (stats.rank1_8 / stats.total) * 100 : 0;
    }),
    rank9_16: topDecks.map(deck => {
      const stats = deckConversionStats[deck] || { total: 0, rank9_16: 0 };
      return stats.total > 0 ? (stats.rank9_16 / stats.total) * 100 : 0;
    }),
    rank17_32: topDecks.map(deck => {
      const stats = deckConversionStats[deck] || { total: 0, rank17_32: 0 };
      return stats.total > 0 ? (stats.rank17_32 / stats.total) * 100 : 0;
    }),
    rank33_worse: topDecks.map(deck => {
      const stats = deckConversionStats[deck] || { total: 0, rank33_worse: 0 };
      return stats.total > 0 ? (stats.rank33_worse / stats.total) * 100 : 0;
    })
  };

  // Sort decks by 1st-8th conversion rate (highest to lowest)
  const sortedDeckIndices = topDecks
    .map((deck, index) => ({ deck, rank1_8: percentages.rank1_8[index] }))
    .sort((a, b) => b.rank1_8 - a.rank1_8 || a.deck.localeCompare(b.deck)) // Sort by rank1_8, tiebreak by deck name
    .map(item => topDecks.indexOf(item.deck));
  const sortedDecks = sortedDeckIndices.map(index => topDecks[index]);
  const sortedPercentages = {
    rank1_8: sortedDeckIndices.map(index => percentages.rank1_8[index]),
    rank9_16: sortedDeckIndices.map(index => percentages.rank9_16[index]),
    rank17_32: sortedDeckIndices.map(index => percentages.rank17_32[index]),
    rank33_worse: sortedDeckIndices.map(index => percentages.rank33_worse[index])
  };

  if (eventFunnelChart) eventFunnelChart.destroy();
  const eventFunnelCtx = document.getElementById("eventFunnelChart");
  if (!eventFunnelCtx) {
    console.error("Event Funnel Chart canvas not found!");
    setChartLoading("eventFunnelChart", false);
    return;
  }

  try {
    eventFunnelChart = new Chart(eventFunnelCtx, {
      type: "bar",
      data: {
        labels: sortedDecks,
        datasets: [
          { label: "1st–8th", data: sortedPercentages.rank1_8, backgroundColor: "#00CED1", barPercentage: 0.5 },
          { label: "9th–16th", data: sortedPercentages.rank9_16, backgroundColor: "#FF8C00", barPercentage: 0.5 },
          { label: "17th–32nd", data: sortedPercentages.rank17_32, backgroundColor: "#228B22", barPercentage: 0.5 },
          { label: "33rd or worse", data: sortedPercentages.rank33_worse, backgroundColor: "#FF0000", barPercentage: 0.5 }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            max: 100,
            title: { display: true, text: "Percentage (%)", color: '#fff' },
            ticks: { color: '#fff' },
            grid: { color: 'rgba(255, 255, 255, 0.1)' }
          },
          y: {
            stacked: true,
            title: { display: true, text: "Decks", color: '#fff' },
            ticks: { color: '#fff' },
            grid: { color: 'rgba(255, 255, 255, 0.1)' }
          }
        },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: '#e0e0e0', font: { size: 14, weight: 'bold' } }
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
    console.error("Error initializing Event Funnel Chart:", error);
  }
  setChartLoading("eventFunnelChart", false);
}