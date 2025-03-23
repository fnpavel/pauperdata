// js/charts/player-win-rate.js
import { setChartLoading } from '../utils/dom.js';
import { cleanedData } from '../data.js';

export let playerWinRateChart = null;

export function updatePlayerWinRateChart() {
  console.log("updatePlayerWinRateChart called...");
  setChartLoading("playerWinRateChart", true);

  const startDate = document.getElementById("playerStartDateSelect").value;
  const endDate = document.getElementById("playerEndDateSelect").value;
  const playerFilterMenu = document.getElementById("playerFilterMenu");
  const selectedPlayer = playerFilterMenu ? playerFilterMenu.value : null;
  const selectedEventTypes = Array.from(document.querySelectorAll('.event-type-filter.active'))
    .map(button => button.dataset.type);

  const baseFilteredData = selectedPlayer && startDate && endDate && selectedEventTypes.length > 0
    ? cleanedData.filter(row => 
        row.Date >= startDate && 
        row.Date <= endDate && 
        row.Player === selectedPlayer && 
        selectedEventTypes.includes(row.EventType)
      )
    : [];

  // Filter out "No Show" decks for the chart
  const filteredDataNoShow = baseFilteredData.filter(row => row.Deck !== "No Show");

  const deckFilter = document.getElementById("playerDeckFilter");
  if (deckFilter) {
    const decks = [...new Set(filteredDataNoShow.map(row => row.Deck))].sort();
    const currentDeck = deckFilter.value;
    deckFilter.innerHTML = `<option value="">All Decks</option>` + 
      decks.map(deck => `<option value="${deck}" ${deck === currentDeck ? 'selected' : ''}>${deck}</option>`).join("");
    if (!deckFilter.dataset.listenerAdded) {
      deckFilter.addEventListener("change", () => updatePlayerWinRateChart());
      deckFilter.dataset.listenerAdded = "true";
    }
  }

  const selectedDeck = deckFilter ? deckFilter.value : "";
  const filteredData = selectedDeck ? filteredDataNoShow.filter(row => row.Deck === selectedDeck) : filteredDataNoShow;

  if (!selectedPlayer || !startDate || !endDate || selectedEventTypes.length === 0 || filteredData.length === 0) {
    if (playerWinRateChart) playerWinRateChart.destroy();
    const playerWinRateCtx = document.getElementById("playerWinRateChart");
    if (playerWinRateCtx) {
      const label = !selectedPlayer ? "No Player Selected" : 
                    selectedEventTypes.length === 0 ? "No Event Type Selected" : 
                    "No Data";
      playerWinRateChart = new Chart(playerWinRateCtx, {
        type: "line",
        data: {
          labels: [label],
          datasets: [{
            label: "Player Win Rate %",
            data: [0],
            backgroundColor: '#FFD700',
            borderColor: '#FFD700',       
            borderWidth: 2,               
            pointRadius: 5,               
            tension: 0.3,                 
            fill: false,                  
            linePercentage: 0.3,
            categoryPercentage: 0.8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              max: 100,
              title: { display: true, text: "Win Rate %", color: '#fff' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' },
              ticks: { color: '#fff' }
            },
            x: {
              title: { display: true, text: "Date", color: '#fff' },
              grid: { borderDash: [5, 5], color: 'rgba(255, 255, 279, 0.1)' },
              ticks: { color: '#fff', autoSkip: false, maxRotation: 45, minRotation: 45 }
            }
          },
          plugins: {
            legend: {
              position: 'top',
              labels: { color: '#e0e0e0', font: { size: 14, weight: 'bold' } }
            },
            tooltip: { enabled: false },
            datalabels: { display: false } // Explicitly disable data labels
          },
          animation: {
            onComplete: () => triggerUpdateAnimation('playerWinRateChartContainer')
          }
        }
      });
    }
    setChartLoading("playerWinRateChart", false);
    return;
  }

  ['playerEventsCard', 'playerUniqueDecksCard', 'playerMostPlayedCard', 'playerLeastPlayedCard', 
   'playerTop1_8Card', 'playerTop9_16Card', 'playerTop17_32Card', 'playerTop33PlusCard', 
   'playerBestDeckCard', 'playerWorstDeckCard', 'playerEventsHistory']
    .forEach(cardId => triggerUpdateAnimation(cardId));

  const eventStats = filteredData.reduce((acc, row) => {
    if (!acc[row.Event]) {
      acc[row.Event] = { date: row.Date, winRate: 0, wins: 0, losses: 0 };
    }
    acc[row.Event].wins += row.Wins;
    acc[row.Event].losses += row.Losses;
    return acc;
  }, {});

  const events = Object.keys(eventStats);
  const dates = events.map(event => eventStats[event].date).sort((a, b) => new Date(a) - new Date(b));
  const eventByDate = {};
  events.forEach(event => {
    eventByDate[eventStats[event].date] = event;
  });

  const playerWinRateData = dates.map(date => {
    const event = eventByDate[date];
    const stats = eventStats[event];
    const deck = filteredData.find(row => row.Event === event)?.Deck || "N/A";
    return {
      winRate: (stats.wins + stats.losses) > 0 ? (stats.wins / (stats.wins + stats.losses)) * 100 : null,
      deck
    };
  });
  const playerWinRates = playerWinRateData.map(p => p.winRate !== null ? p.winRate : 0);

  // Compute deck performance for stats cards
  const deckStats = filteredData.reduce((acc, row) => {
    if (!acc[row.Deck]) {
      acc[row.Deck] = { wins: 0, losses: 0, events: new Set(), eventData: [] };
    }
    acc[row.Deck].wins += row.Wins;
    acc[row.Deck].losses += row.Losses;
    acc[row.Deck].events.add(row.Event);
    acc[row.Deck].eventData.push({
      event: row.Event,
      date: row.Date,
      winRate: (row.Wins + row.Losses) > 0 ? (row.Wins / (row.Losses + row.Wins)) * 100 : null
    });
    return acc;
  }, {});
  const deckPerformance = Object.keys(deckStats).map(deck => ({
    deck,
    wins: deckStats[deck].wins,
    losses: deckStats[deck].losses,
    eventCount: deckStats[deck].events.size,
    overallWinRate: (deckStats[deck].wins + deckStats[deck].losses) > 0 
      ? (deckStats[deck].wins / (deckStats[deck].wins + deckStats[deck].losses)) * 100 
      : null,
    bestEventData: deckStats[deck].eventData.reduce((best, event) => 
      (event.winRate !== null && (!best.winRate || event.winRate > best.winRate)) ? event : best, { winRate: null }),
    worstEventData: deckStats[deck].eventData.reduce((worst, event) => 
      (event.winRate !== null && (!worst.winRate || event.winRate < worst.winRate)) ? event : worst, { winRate: null })
  }));

  window.playerDeckPerformance = deckPerformance;

  if (playerWinRateChart) playerWinRateChart.destroy();
  const playerWinRateCtx = document.getElementById("playerWinRateChart");
  if (!playerWinRateCtx) {
    console.error("Player Win Rate Chart canvas not found!");
    setChartLoading("playerWinRateChart", false);
    return;
  }

  const tooltipHandler = function(context) {
    const tooltipModel = context.tooltip;
    let tooltipEl = document.getElementById('chartjs-tooltip');
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.id = 'chartjs-tooltip';
      tooltipEl.style.background = 'rgba(0, 0, 0, 0.8)';
      tooltipEl.style.color = '#fff';
      tooltipEl.style.padding = '10px';
      tooltipEl.style.borderRadius = '5px';
      tooltipEl.style.position = 'absolute';
      tooltipEl.style.pointerEvents = 'none';
      tooltipEl.style.zIndex = '9999';
      tooltipEl.style.fontSize = '12px';
      tooltipEl.style.transition = 'all 0.1s ease';
      document.body.appendChild(tooltipEl);
    }

    const detailsEl = document.getElementById('playerEventDetails');
    if (!tooltipModel.opacity) {
      tooltipEl.style.opacity = 0;
      if (detailsEl) detailsEl.innerHTML = "";
      return;
    }

    tooltipEl.style.opacity = 1;
    const chartArea = context.chart.chartArea;
    const canvasPosition = context.chart.canvas.getBoundingClientRect();
    const tooltipWidth = tooltipEl.offsetWidth;
    const tooltipHeight = tooltipEl.offsetHeight;

    let left = canvasPosition.left + chartArea.left + tooltipModel.caretX + 10;
    let top = canvasPosition.top + chartArea.top + tooltipModel.caretY - (tooltipHeight / 2);

    if (left + tooltipWidth > canvasPosition.right) {
      left = canvasPosition.left + chartArea.left + tooltipModel.caretX - tooltipWidth - 10;
    }
    if (top < canvasPosition.top) {
      top = canvasPosition.top + 5;
    } else if (top + tooltipHeight > canvasPosition.bottom) {
      top = canvasPosition.bottom - tooltipHeight - 5;
    }

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;

    const index = tooltipModel.dataPoints[0].dataIndex;
    const deck = playerWinRateData[index].deck;
    const winRate = playerWinRateData[index].winRate !== null ? playerWinRateData[index].winRate.toFixed(2) : "--";
    tooltipEl.innerHTML = `${deck} - Win Rate: ${winRate}%`;

    if (detailsEl) {
      const date = dates[index];
      const event = eventByDate[date];
      const eventData = cleanedData.filter(row => row.Event === event);
      const playerDeck = filteredData.find(row => row.Event === event)?.Deck || "N/A";
      const deckPlayers = eventData.filter(row => row.Deck === playerDeck).length;
      const totalPlayers = eventData.length;
      const metaShare = totalPlayers > 0 ? ((deckPlayers / totalPlayers) * 100).toFixed(1) : 0;
      const deckWins = eventData.filter(row => row.Deck === playerDeck).reduce((sum, row) => sum + row.Wins, 0);
      const deckLosses = eventData.filter(row => row.Deck === playerDeck).reduce((sum, row) => sum + row.Losses, 0);
      const deckWinRate = (deckWins + deckLosses) > 0 ? ((deckWins / (deckWins + deckLosses)) * 100).toFixed(1) : 0;
      const winner = eventData.reduce((best, row) => row.Rank < best.Rank ? row : best, eventData[0]);
      const winnerDeckPlayers = eventData.filter(row => row.Deck === winner.Deck).length;
      const winnerMetaShare = totalPlayers > 0 ? ((winnerDeckPlayers / totalPlayers) * 100).toFixed(1) : 0;
      const winnerWinRate = (winner.Wins + winner.Losses) > 0 ? ((winner.Wins / (winner.Wins + winner.Losses)) * 100).toFixed(1) : 0;

      detailsEl.innerHTML = `
        ${event} - ${date}<br>
        ${deckPlayers} players out of ${totalPlayers} played with ${playerDeck} (${metaShare}% of the Meta and ${deckWinRate}% WR)<br>
        Event Won by ${winner.Player} with ${winner.Deck} (${winnerMetaShare}% of the Meta and ${winnerWinRate}% WR)
      `;
    }
  };

  try {
    playerWinRateChart = new Chart(playerWinRateCtx, {
      type: "line",
      data: {
        labels: dates,
        datasets: [
          {
            label: `${selectedPlayer} Win Rate %`,
            data: playerWinRates,
            backgroundColor: '#FFD700',
            borderColor: '#FFD700',       
            borderWidth: 2,               
            pointRadius: 5,               
            tension: 0.3,                 
            fill: false,                  
            linePercentage: 0.5,
            categoryPercentage: 0.8
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            title: { display: true, text: "Win Rate %", color: '#fff' },
            grid: { color: 'rgba(255, 255, 255, 0.1)' },
            ticks: { color: '#fff' }
          },
          x: {
            title: { display: true, text: "Date", color: '#fff' },
            grid: { borderDash: [5, 5], color: 'rgba(255, 255, 279, 0.1)' },
            ticks: { color: '#fff', autoSkip: false, maxRotation: 45, minRotation: 45 }
          }
        },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: '#e0e0e0', font: { size: 14, weight: 'bold' } }
          },
          tooltip: {
            enabled: false,
            external: tooltipHandler,
            mode: 'nearest',
            intersect: true
          },
          datalabels: { display: false } // Explicitly disable data labels
        },
        hover: { mode: 'nearest', intersect: true },
        animation: {
          onComplete: () => triggerUpdateAnimation('playerWinRateChartContainer')
        }
      }
    });
  } catch (error) {
    console.error("Error initializing Player Win Rate Chart:", error);
  }
  setChartLoading("playerWinRateChart", false);
}

function triggerUpdateAnimation(elementId) {
  const element = document.getElementById(elementId);
  if (element) {
    element.classList.add('updated');
    setTimeout(() => element.classList.remove('updated'), 500);
  }
}