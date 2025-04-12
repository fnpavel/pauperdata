import { setChartLoading } from '../utils/dom.js';
import { getPlayerWinRateChartData } from '../modules/filters.js';
import { calculatePlayerWinRateStats } from "../utils/data-chart.js";
import { cleanedData } from '../data.js';

export let playerWinRateChart = null;

export function updatePlayerWinRateChart() {
  console.log("updatePlayerWinRateChart called...");
  setChartLoading("playerWinRateChart", true);

  const filteredData = getPlayerWinRateChartData();
  const deckFilter = document.getElementById("playerDeckFilter");
  if (deckFilter) {
    const decks = [...new Set(filteredData.map(row => row.Deck))].sort();
    const currentDeck = deckFilter.value;
    deckFilter.innerHTML = `<option value="">All Decks</option>` + 
      decks.map(deck => `<option value="${deck}" ${deck === currentDeck ? 'selected' : ''}>${deck}</option>`).join("");
    if (!deckFilter.dataset.listenerAdded) {
      deckFilter.addEventListener("change", () => updatePlayerWinRateChart());
      deckFilter.dataset.listenerAdded = "true";
    }
  }

  if (!filteredData.length) {
    if (playerWinRateChart) playerWinRateChart.destroy();
    const playerWinRateCtx = document.getElementById("playerWinRateChart");
    if (playerWinRateCtx) {
      const playerFilterMenu = document.getElementById("playerFilterMenu");
      const selectedPlayer = playerFilterMenu ? playerFilterMenu.value : null;
      const selectedEventTypes = Array.from(document.querySelectorAll('.event-type-filter.active')).length;
      const label = !selectedPlayer ? "No Player Selected" : 
                    selectedEventTypes === 0 ? "No Event Type Selected" : 
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
            y: { beginAtZero: true, max: 100, title: { display: true, text: "Win Rate %", color: '#fff' }, grid: { color: 'rgba(255, 255, 255, 0.1)' }, ticks: { color: '#fff' } },
            x: { title: { display: true, text: "Date", color: '#fff' }, grid: { borderDash: [5, 5], color: 'rgba(255, 255, 279, 0.1)' }, ticks: { color: '#fff', autoSkip: false, maxRotation: 45, minRotation: 45 } }
          },
          plugins: {
            legend: { position: 'top', labels: { color: '#e0e0e0', font: { size: 14, weight: 'bold' } } },
            tooltip: { enabled: false },
            datalabels: { display: false },
            zoom: {
              zoom: {
                wheel: { enabled: true, speed: 0.1 },
                drag: {
                  enabled: true,
                  backgroundColor: 'rgba(0, 0, 255, 0.3)',
                  borderColor: 'rgba(0, 0, 255, 0.8)',
                  borderWidth: 1
                },
                mode: 'xy'
              },
              pan: { enabled: false },
              limits: { y: { min: 0, max: 100 } }
            }
          },
          animation: { onComplete: () => triggerUpdateAnimation('playerWinRateChartContainer') }
        }
      });

      playerWinRateCtx.ondblclick = () => {
        playerWinRateChart.resetZoom();
      };
    }
    setChartLoading("playerWinRateChart", false);
    return;
  }

  ['playerEventsCard', 'playerUniqueDecksCard', 'playerMostPlayedCard', 'playerLeastPlayedCard', 
   'playerTop1_8Card', 'playerTop9_16Card', 'playerTop17_32Card', 'playerTop33PlusCard', 
   'playerBestDeckCard', 'playerWorstDeckCard', 'playerEventsHistory']
    .forEach(cardId => triggerUpdateAnimation(cardId));

  const { dates, winRates, decks, eventByDate } = calculatePlayerWinRateStats(filteredData);
  const playerFilterMenu = document.getElementById("playerFilterMenu");
  const selectedPlayer = playerFilterMenu ? playerFilterMenu.value : "Unknown";

  if (playerWinRateChart) playerWinRateChart.destroy();
  const playerWinRateCtx = document.getElementById("playerWinRateChart");
  if (!playerWinRateCtx) {
    console.error("Player Win Rate Chart canvas not found!");
    setChartLoading("playerWinRateChart", false);
    return;
  }

  try {
    playerWinRateChart = new Chart(playerWinRateCtx, {
      type: "line",
      data: {
        labels: dates,
        datasets: [{
          label: `${selectedPlayer} Win Rate %`,
          data: winRates,
          backgroundColor: '#FFD700',
          borderColor: '#FFD700',
          borderWidth: 2,
          pointRadius: 5,
          tension: 0.3,
          fill: false,
          linePercentage: 0.5,
          categoryPercentage: 0.8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, max: 100, title: { display: true, text: "Win Rate %", color: '#fff' }, grid: { color: 'rgba(255, 255, 255, 0.1)' }, ticks: { color: '#fff' } },
          x: { title: { display: true, text: "Date", color: '#fff' }, grid: { borderDash: [5, 5], color: 'rgba(255, 255, 279, 0.1)' }, ticks: { color: '#fff', autoSkip: false, maxRotation: 45, minRotation: 45 } }
        },
        plugins: {
          legend: { position: 'top', labels: { color: '#e0e0e0', font: { size: 14, weight: 'bold' } } },
          tooltip: {
            enabled: true,
            mode: 'nearest',
            intersect: true,
            callbacks: {
              label: function(context) {
                const index = context.dataIndex;
                const deck = decks[index];
                const winRate = winRates[index].toFixed(2);
                return `${deck} - Win Rate: ${winRate}%`;
              },
              afterBody: function(context) {
                const detailsEl = document.getElementById('playerEventDetails');
                if (!detailsEl) {
                  console.warn("playerEventDetails element not found in DOM!");
                  return;
                }

                const index = context[0].dataIndex;
                const date = dates[index];
                const event = eventByDate[date];
                
                const fullEventData = cleanedData.filter(row => row.Event === event);
                if (!fullEventData || fullEventData.length === 0) {
                  detailsEl.innerHTML = "Event data not found.";
                  return;
                }

                const analyzedPlayerRow = filteredData.find(row => row.Event === event);
                const playerDeck = analyzedPlayerRow ? analyzedPlayerRow.Deck : "N/A";
                
                const totalPlayers = fullEventData.length;
                const deckPlayersRows = fullEventData.filter(row => row.Deck === playerDeck);
                const deckPlayersCount = deckPlayersRows.length;
                const metaShare = totalPlayers > 0 ? ((deckPlayersCount / totalPlayers) * 100).toFixed(1) : 0;
                
                // Calculate win rate for the player's deck in this event
                const deckWins = deckPlayersRows.reduce((sum, row) => sum + row.Wins, 0);
                const deckLosses = deckPlayersRows.reduce((sum, row) => sum + row.Losses, 0);
                const playerDeckWinRate = (deckWins + deckLosses) > 0 ? ((deckWins / (deckWins + deckLosses)) * 100).toFixed(1) : 0;

                const winner = fullEventData.reduce((best, row) => row.Rank < best.Rank ? row : best, fullEventData[0]);
                const winnerDeckPlayers = fullEventData.filter(row => row.Deck === winner.Deck).length;
                const winnerMetaShare = totalPlayers > 0 ? ((winnerDeckPlayers / totalPlayers) * 100).toFixed(1) : 0;
                const winnerWinRate = (winner.Wins + winner.Losses) > 0 ? ((winner.Wins / (winner.Wins + winner.Losses)) * 100).toFixed(1) : 0;

                detailsEl.innerHTML = `
                  ${event} - ${date}<br>
                  ${deckPlayersCount} players out of ${totalPlayers} played ${playerDeck} (${metaShare}% Meta Share, ${playerDeckWinRate}% WR)<br>
                  Event Won by ${winner.Player} with ${winner.Deck} (${winnerMetaShare}% Meta Share, ${winnerWinRate}% WR)
                `;
                return "";
              }
            }
          },
          datalabels: { display: false },
          zoom: {
            zoom: {
              wheel: { enabled: true, speed: 0.1 },
              drag: {
                enabled: true,
                backgroundColor: 'rgba(0, 0, 255, 0.3)',
                borderColor: 'rgba(0, 0, 255, 0.8)',
                borderWidth: 1
              },
              mode: 'xy'
            },
            pan: { enabled: false },
            limits: { y: { min: 0, max: 100 } }
          }
        },
        hover: { mode: 'nearest', intersect: true },
        animation: { onComplete: () => triggerUpdateAnimation('playerWinRateChartContainer') }
      }
    });

    playerWinRateCtx.ondblclick = () => {
      playerWinRateChart.resetZoom();
    };
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