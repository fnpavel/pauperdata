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

  // Aggregate deck stats
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
  const percentages = topDecks.map(deck => {
    const stats = deckConversionStats[deck] || { total: 0, rank1_8: 0, rank9_16: 0, rank17_32: 0, rank33_worse: 0 };
    const total = stats.total;
    return {
      deck,
      rank1_8: total > 0 ? (stats.rank1_8 / total) * 100 : 0,
      rank9_16: total > 0 ? (stats.rank9_16 / total) * 100 : 0,
      rank17_32: total > 0 ? (stats.rank17_32 / total) * 100 : 0,
      rank33_worse: total > 0 ? (stats.rank33_worse / total) * 100 : 0
    };
  });

  // Sort by 1st-8th conversion rate (highest to lowest)
  const sortedDecksData = percentages
    .sort((a, b) => b.rank1_8 - a.rank1_8 || a.deck.localeCompare(b.deck))
    .map(item => ({
      deck: item.deck,
      data: [item.rank1_8, item.rank9_16, item.rank17_32, item.rank33_worse]
    }));

  const labels = sortedDecksData.map(item => item.deck);
  const datasets = [
    {
      label: "1st–8th",
      data: sortedDecksData.map(item => item.data[0]),
      backgroundColor: '#CCAC00', // Muted Gold (less bright than #FFD700)
      borderColor: '#B59400', // Darker muted gold outline
      borderWidth: 1
    },
    {
      label: "9th–16th",
      data: sortedDecksData.map(item => item.data[1]),
      backgroundColor: '#00CCCC', // Muted Cyan (softer than #00FFFF)
      borderColor: '#00A3A3', // Darker muted cyan outline
      borderWidth: 1
    },
    {
      label: "17th–32nd",
      data: sortedDecksData.map(item => item.data[2]),
      backgroundColor: '#CC3700', // Muted Orange Red (less vivid than #FF4500)
      borderColor: '#A32C00', // Darker muted orange outline
      borderWidth: 1
    },
    {
      label: "33rd+",
      data: sortedDecksData.map(item => item.data[3]),
      backgroundColor: '#A9A9A9', // Muted Gray (darker than #D3D3D3)
      borderColor: '#808080', // Darker gray outline
      borderWidth: 1
    }
  ];

  if (eventFunnelChart) eventFunnelChart.destroy();
  const eventFunnelCtx = document.getElementById("eventFunnelChart");
  if (!eventFunnelCtx) {
    console.error("Event Funnel Chart canvas not found!");
    setChartLoading("eventFunnelChart", false);
    return;
  }

  try {
    eventFunnelChart = new Chart(eventFunnelCtx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: datasets
      },
      options: {
        indexAxis: 'y', // Horizontal bars
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            max: 100,
            title: {
              display: true,
              text: "Conversion Rate (%)",
              color: '#FFFFFF',
              font: { size: 16, weight: 'bold', family: "'Bitter', serif" }
            },
            ticks: {
              color: '#FFFFFF',
              font: { size: 12, family: "'Bitter', serif" },
              callback: value => `${value}%`
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)',
              borderDash: [5, 5],
              borderColor: '#FFFFFF'
            }
          },
          y: {
            stacked: true,
            title: {
              display: true,
              text: "Decks",
              color: '#FFFFFF',
              font: { size: 16, weight: 'bold', family: "'Bitter', serif" }
            },
            ticks: {
              color: '#FFFFFF',
              font: { size: 12, family: "'Bitter', serif" }
            },
            grid: { display: false }
          }
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#e0e0e0',
              font: { size: 12, family: "'Bitter', serif" },
              padding: 10,
              boxWidth: 20,
              usePointStyle: true
            }
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleFont: { family: "'Bitter', serif", size: 14, weight: 'bold' },
            bodyFont: { family: "'Bitter', serif", size: 12 },
            titleColor: '#FFFFFF',
            bodyColor: '#FFFFFF',
            callbacks: {
              label: context => {
                const value = context.raw.toFixed(2);
                return `${context.dataset.label}: ${value}%`;
              }
            },
            borderColor: '#FFD700',
            borderWidth: 1,
            padding: 10
          },
          datalabels: { // Optional
            display: context => context.dataset.data[context.dataIndex] > 5,
            color: '#000000',
            font: { size: 10, weight: 'bold', family: "'Bitter', serif" },
            formatter: value => `${value.toFixed(0)}%`
          }
        },
        animation: {
          duration: 1000,
          easing: 'easeOutQuart'
        },
        elements: {
          bar: {
            borderRadius: 4,
            borderSkipped: false
          }
        }
      }
    });
  } catch (error) {
    console.error("Error initializing Event Funnel Chart:", error);
  }
  setChartLoading("eventFunnelChart", false);
}