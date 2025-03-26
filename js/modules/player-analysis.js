// js/modules/player-analysis.js
// Handles everything for the PLAYER ANALYSIS when changing the filtered data: Cards, Charts and Tables
// The Event Analysis is handled in event-analysis.js

import { updatePlayerWinRateChart } from '../charts/player-win-rate.js';
import { updatePlayerDeckPerformanceChart } from '../charts/player-deck-performance.js';
import { updateElementText, updateElementHTML } from '../utils/dom.js';
import { cleanedData } from '../data.js';

export function initPlayerAnalysis() {
  console.log('Player Analysis initialized');
}

export function updatePlayerAnalysis(data) {
  updatePlayerWinRateChart();
  updatePlayerDeckPerformanceChart();
  populatePlayerAnalysisRawData(data);
  populatePlayerStats(data);
}

export function updatePlayerAnalytics() {
  console.log("Updating player analytics...");
  const startDate = document.getElementById("playerStartDateSelect").value;
  const endDate = document.getElementById("playerEndDateSelect").value;
  const playerFilterMenu = document.getElementById("playerFilterMenu");
  const selectedPlayer = playerFilterMenu ? playerFilterMenu.value : null;
  const selectedEventTypes = Array.from(document.querySelectorAll('.event-type-filter.active'))
    .map(button => button.dataset.type);

  console.log("Player Analytics Filters:", { startDate, endDate, selectedPlayer, selectedEventTypes });

  if (playerFilterMenu && !playerFilterMenu.dataset.initialized) {
    const players = [...new Set(cleanedData.map(row => row.Player))].sort((a, b) => a.localeCompare(b));
    playerFilterMenu.innerHTML = `<option value="">Select EVENT TYPE First</option>` + 
      players.map(player => `<option value="${player}">${player}</option>`).join("");
    playerFilterMenu.dataset.initialized = "true";
  }

  const baseFilteredData = selectedPlayer && startDate && endDate && selectedEventTypes.length > 0
    ? cleanedData.filter(row => 
        row.Date >= startDate && 
        row.Date <= endDate && 
        row.Player === selectedPlayer && 
        selectedEventTypes.includes(row.EventType)
      )
    : [];

  console.log("baseFilteredData length in player-analysis:", baseFilteredData.length);

  updatePlayerAnalysis(baseFilteredData);
}

export function populatePlayerAnalysisRawData(data) {
  const rawTableHead = document.getElementById("playerRawTableHead");
  const rawTableBody = document.getElementById("playerRawTableBody");
  const rawTableTitle = document.getElementById("playerRawTableTitle");
  const playerFilterMenu = document.getElementById("playerFilterMenu");
  const selectedPlayer = playerFilterMenu ? playerFilterMenu.value : "No Player Selected";

  rawTableTitle.textContent = `${selectedPlayer} - Event Data`;
  console.log("Setting initial table title:", rawTableTitle.textContent);

  let toggleContainer = document.querySelector('.player-table-toggle');
  if (!toggleContainer) {
    console.log("Creating toggle buttons...");
    toggleContainer = document.createElement('div');
    toggleContainer.className = 'bubble-menu player-table-toggle';
    toggleContainer.innerHTML = `
      <button class="bubble-button table-toggle-btn active" data-table="event">Event Data</button>
      <button class="bubble-button table-toggle-btn" data-table="deck">Deck Data</button>
    `;
    rawTableTitle.insertAdjacentElement('afterend', toggleContainer);
  }

  const updateTable = (tableType) => {
    if (tableType === 'event') {
      rawTableTitle.textContent = `${selectedPlayer} - Event Data`;
      rawTableHead.innerHTML = `
        <tr>
          <th data-sort="date">Date <span class="sort-arrow"></span></th>
          <th data-sort="event">Event <span class="sort-arrow"></span></th>
          <th data-sort="players">Number of Players <span class="sort-arrow"></span></th>
          <th data-sort="rank">Rank <span class="sort-arrow"></span></th>
          <th data-sort="deck">Deck <span class="sort-arrow"></span></th>
          <th data-sort="wins">Wins <span class="sort-arrow"></span></th>
          <th data-sort="losses">Losses <span class="sort-arrow"></span></th>
          <th data-sort="winRate">Player Win Rate <span class="sort-arrow"></span></th>
          <th data-sort="deckWinRate">Deck's Overall Win Rate <span class="sort-arrow"></span></th>
          <th data-sort="deckMeta">Deck's Meta <span class="sort-arrow"></span></th>
        </tr>
      `;

      if (!data || data.length === 0) {
        rawTableBody.innerHTML = "<tr><td colspan='10'>No data available</td></tr>";
        return;
      }

      let rows = data.map(row => {
        const eventData = cleanedData.filter(r => r.Event === row.Event);
        const deckData = eventData.filter(r => r.Deck === row.Deck);
        const totalWins = deckData.reduce((sum, r) => sum + r.Wins, 0);
        const totalLosses = deckData.reduce((sum, r) => sum + r.Losses, 0);
        const deckWinRate = (totalWins + totalLosses) > 0 ? (totalWins / (totalWins + totalLosses)) * 100 : 0;
        const deckMeta = eventData.length > 0 ? (deckData.length / eventData.length) * 100 : 0;
        const winner = eventData.reduce((best, r) => r.Rank < best.Rank ? r : best, eventData[0]);
        const winnerWinRate = (winner.Wins + winner.Losses) > 0 ? (winner.Wins / (winner.Wins + winner.Losses)) * 100 : 0;
        const winnerDeckPlayers = eventData.filter(r => r.Deck === winner.Deck).length;
        const winnerMeta = eventData.length > 0 ? (winnerDeckPlayers / eventData.length) * 100 : 0;

        return {
          date: row.Date,
          event: row.Event,
          players: eventData.length,
          rank: row.Rank,
          deck: row.Deck,
          wins: row.Wins,
          losses: row.Losses,
          winRate: (row.Wins + row.Losses) > 0 ? (row.Wins / (row.Wins + row.Losses)) * 100 : 0,
          deckWinRate,
          deckMeta,
          tooltip: `Event won by ${winner.Player} with ${winner.Deck} (${winnerWinRate.toFixed(1)}% Overall WR and ${winnerMeta.toFixed(1)}%)`
        };
      });

      updateElementHTML("playerRawTableBody", rows.map(row => `
        <tr>
          <td>${row.date}</td>
          <td class="event-tooltip" data-tooltip="${row.tooltip}">${row.event}</td>
          <td>${row.players}</td>
          <td>${row.rank}</td>
          <td>${row.deck}</td>
          <td>${row.wins}</td>
          <td>${row.losses}</td>
          <td>${row.winRate.toFixed(1)}%</td>
          <td>${row.deckWinRate.toFixed(1)}%</td>
          <td>${row.deckMeta.toFixed(1)}%</td>
        </tr>
      `).join(""));

      const headers = rawTableHead.querySelectorAll('th[data-sort]');
      headers.forEach(header => {
        header.addEventListener('click', () => {
          const sortKey = header.dataset.sort;
          const isAscending = header.classList.contains('asc');
          headers.forEach(h => {
            h.classList.remove('asc', 'desc');
            h.querySelector('.sort-arrow').textContent = '';
          });

          rows.sort((a, b) => {
            const aVal = typeof a[sortKey] === 'string' ? a[sortKey].toLowerCase() : a[sortKey];
            const bVal = typeof b[sortKey] === 'string' ? b[sortKey].toLowerCase() : b[sortKey];
            return isAscending ? (aVal > bVal ? -1 : 1) : (aVal < bVal ? -1 : 1);
          });

          header.classList.add(isAscending ? 'desc' : 'asc');
          header.querySelector('.sort-arrow').textContent = isAscending ? '↓' : '↑';

          updateElementHTML("playerRawTableBody", rows.map(row => `
            <tr>
              <td>${row.date}</td>
              <td class="event-tooltip" data-tooltip="${row.tooltip}">${row.event}</td>
              <td>${row.players}</td>
              <td>${row.rank}</td>
              <td>${row.deck}</td>
              <td>${row.wins}</td>
              <td>${row.losses}</td>
              <td>${row.winRate.toFixed(1)}%</td>
              <td>${row.deckWinRate.toFixed(1)}%</td>
              <td>${row.deckMeta.toFixed(1)}%</td>
            </tr>
          `).join(""));
        });
      });
    } else if (tableType === 'deck') {
      rawTableTitle.textContent = `${selectedPlayer} - Deck Data`;
      rawTableHead.innerHTML = `
        <tr>
          <th data-sort="deck">Deck <span class="sort-arrow"></span></th>
          <th data-sort="events">Number of Events <span class="sort-arrow"></span></th>
          <th data-sort="wins">Wins <span class="sort-arrow"></span></th>
          <th data-sort="losses">Losses <span class="sort-arrow"></span></th>
          <th data-sort="overallWinRate">Overall Win Rate <span class="sort-arrow"></span></th>
          <th data-sort="bestWinRate">Best Win Rate <span class="sort-arrow"></span></th>
          <th data-sort="worstWinRate">Worst Win Rate <span class="sort-arrow"></span></th>
        </tr>
      `;

      if (!data || data.length === 0) {
        rawTableBody.innerHTML = "<tr><td colspan='7'>No data available</td></tr>";
        return;
      }

      const deckStats = data.reduce((acc, row) => {
        if (!acc[row.Deck]) {
          acc[row.Deck] = { events: [], wins: 0, losses: 0, eventData: [] };
        }
        acc[row.Deck].events.push(row.Event);
        acc[row.Deck].wins += row.Wins;
        acc[row.Deck].losses += row.Losses;
        acc[row.Deck].eventData.push({
          event: row.Event,
          date: row.Date,
          winRate: (row.Wins + row.Losses) > 0 ? (row.Wins / (row.Wins + row.Losses)) * 100 : 0
        });
        return acc;
      }, {});

      let deckRows = Object.keys(deckStats).map(deck => {
        const stats = deckStats[deck];
        const totalGames = stats.wins + stats.losses;
        const overallWinRate = totalGames > 0 ? (stats.wins / totalGames) * 100 : 0;
        const eventWinRates = stats.eventData.map(event => event.winRate);
        const bestEvent = stats.eventData.reduce((best, event) => event.winRate > (best.winRate || 0) ? event : best, {});
        const worstEvent = stats.eventData.length > 0 
          ? stats.eventData.reduce((worst, event) => (event.winRate < worst.winRate ? event : worst), stats.eventData[0])
          : { winRate: 0, event: "--", date: "--" };
        return {
          deck,
          events: [...new Set(stats.events)].length,
          wins: stats.wins,
          losses: stats.losses,
          overallWinRate,
          bestWinRate: bestEvent.winRate || 0,
          bestEvent: bestEvent.event || "--",
          bestDate: bestEvent.date || "--",
          worstWinRate: worstEvent.winRate || 0,
          worstEvent: worstEvent.event || "--",
          worstDate: worstEvent.date || "--"
        };
      });

      updateElementHTML("playerRawTableBody", deckRows.map(row => `
        <tr>
          <td>${row.deck}</td>
          <td>${row.events}</td>
          <td>${row.wins}</td>
          <td>${row.losses}</td>
          <td>${row.overallWinRate.toFixed(2)}%</td>
          <td class="event-tooltip" data-tooltip="${row.bestDate} - ${row.bestEvent}">${row.bestWinRate.toFixed(2)}%</td>
          <td class="event-tooltip" data-tooltip="${row.worstDate} - ${row.worstEvent}">${row.worstWinRate.toFixed(2)}%</td>
        </tr>
      `).join(""));

      const headers = rawTableHead.querySelectorAll('th[data-sort]');
      headers.forEach(header => {
        header.addEventListener('click', () => {
          const sortKey = header.dataset.sort;
          const isAscending = header.classList.contains('asc');
          headers.forEach(h => {
            h.classList.remove('asc', 'desc');
            h.querySelector('.sort-arrow').textContent = '';
          });

          deckRows.sort((a, b) => {
            const aVal = typeof a[sortKey] === 'string' ? a[sortKey].toLowerCase() : a[sortKey];
            const bVal = typeof b[sortKey] === 'string' ? b[sortKey].toLowerCase() : b[sortKey];
            return isAscending ? (aVal > bVal ? -1 : 1) : (aVal < bVal ? -1 : 1);
          });

          header.classList.add(isAscending ? 'desc' : 'asc');
          header.querySelector('.sort-arrow').textContent = isAscending ? '↓' : '↑';

          updateElementHTML("playerRawTableBody", deckRows.map(row => `
            <tr>
              <td>${row.deck}</td>
              <td>${row.events}</td>
              <td>${row.wins}</td>
              <td>${row.losses}</td>
              <td>${row.overallWinRate.toFixed(2)}%</td>
              <td class="event-tooltip" data-tooltip="${row.bestDate} - ${row.bestEvent}">${row.bestWinRate.toFixed(2)}%</td>
              <td class="event-tooltip" data-tooltip="${row.worstDate} - ${row.worstEvent}">${row.worstWinRate.toFixed(2)}%</td>
            </tr>
          `).join(""));
        });
      });
    }
  };

  updateTable('event');

  const toggleButtons = toggleContainer.querySelectorAll('.table-toggle-btn');
  toggleButtons.forEach(button => {
    button.addEventListener('click', () => {
      console.log(`Toggle clicked: ${button.dataset.table}`);
      toggleButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      const tableType = button.dataset.table;
      updateTable(tableType);
    });
  });
}

export function populatePlayerStats(data) {
  console.log("populatePlayerStats called with data:", data);

  const totalEvents = data.length > 0 ? [...new Set(data.map(row => row.Event))].length : 0;

  // Helper function to safely update DOM elements
  const updateElement = (id, value, property = "textContent") => {
    const element = document.getElementById(id);
    if (element) {
      element[property] = value;
    } else {
      console.warn(`Element with ID '${id}' not found in the DOM`);
    }
  };

  const updateQueryElement = (id, selector, value, property = "innerHTML") => {
    const parent = document.getElementById(id);
    if (parent) {
      const element = parent.querySelector(selector);
      if (element) {
        element[property] = value;
      } else {
        console.warn(`Selector '${selector}' not found in element with ID '${id}'`);
      }
    } else {
      console.warn(`Parent element with ID '${id}' not found in the DOM`);
    }
  };

  if (!data || data.length === 0) {
    console.log("No data available, setting all stats to default");
    updateQueryElement("playerEventsCard", ".stat-value", "N/A");
    updateQueryElement("playerEventsCard", ".stat-change", "");
    updateQueryElement("playerUniqueDecksCard", ".stat-value", "N/A");
    updateQueryElement("playerMostPlayedCard", ".stat-value", "N/A");
    updateQueryElement("playerMostPlayedCard", ".stat-change", "");
    updateQueryElement("playerLeastPlayedCard", ".stat-value", "N/A");
    updateQueryElement("playerLeastPlayedCard", ".stat-change", "");
    updateElement("playerTop1_8", "--");
    updateElement("playerTop9_16", "--");
    updateElement("playerTop17_32", "--");
    updateElement("playerTop33Plus", "--");
    updateElement("playerTop1_8%", "--");
    updateElement("playerTop9_16%", "--");
    updateElement("playerTop17_32%", "--");
    updateElement("playerTop33Plus%", "--");
    updateElement("playerBestDeckName", "--");
    updateElement("playerBestDeckEvents", "--");
    updateElement("playerBestDeckWinRate", "--");
    updateElement("playerBestDeckBestWinRate", "--");
    updateElement("playerBestDeckWorstWinRate", "--");
    updateElement("playerWorstDeckName", "--");
    updateElement("playerWorstDeckEvents", "--");
    updateElement("playerWorstDeckWinRate", "--");
    updateElement("playerWorstDeckBestWinRate", "--");
    updateElement("playerWorstDeckWorstWinRate", "--");
    updateElement("playerMostPlayedDeckName", "--");
    updateElement("playerMostPlayedDeckEvents", "0");
    updateElement("playerMostPlayedDeckWinRate", "0%");
    updateElement("playerMostPlayedDeckBestWinRate", "-- (Event: --)");
    updateElement("playerMostPlayedDeckWorstWinRate", "-- (Event: --)");
    updateElement("playerLeastPlayedDeckName", "--");
    updateElement("playerLeastPlayedDeckEvents", "0");
    updateElement("playerLeastPlayedDeckWinRate", "0%");
    updateElement("playerLeastPlayedDeckBestWinRate", "-- (Event: --)");
    updateElement("playerLeastPlayedDeckWorstWinRate", "-- (Event: --)");
    updateElement("playerOverallWinRate", "--");
    const eventsDetails = document.getElementById("playerEventsDetails");
    if (eventsDetails) eventsDetails.innerHTML = "<div>No events selected</div>";
    // Ensure all four stat-cards are visible, even with no data
    document.getElementById("playerBestDeckCard").style.display = "block";
    document.getElementById("playerWorstDeckCard").style.display = "block";
    document.getElementById("playerMostPlayedDeckCard").style.display = "block";
    document.getElementById("playerLeastPlayedDeckCard").style.display = "block";
    return;
  }

  const dates = data.map(row => new Date(row.Date));
  const minDate = new Date(Math.min(...dates));
  const maxDate = new Date(Math.max(...dates));
  const monthsSpan = (maxDate.getFullYear() - minDate.getFullYear()) * 12 + (maxDate.getMonth() - minDate.getMonth()) + 1;
  const years = [...new Set(dates.map(date => date.getFullYear()))].sort().join(", ");
  updateQueryElement("playerEventsCard", ".stat-value", totalEvents);
  updateQueryElement("playerEventsCard", ".stat-change", monthsSpan > 1 ? `${monthsSpan} Months (Years ${years})` : "Single Event");

  const filteredDataNoShow = data.filter(row => row.Deck !== "No Show");
  console.log("Filtered data (excluding 'No Show'):", filteredDataNoShow);

  const uniqueDecks = [...new Set(filteredDataNoShow.map(row => row.Deck))].length;
  const deckCounts = filteredDataNoShow.reduce((acc, row) => {
    acc[row.Deck] = (acc[row.Deck] || 0) + 1;
    return acc;
  }, {});
  const deckEntries = Object.entries(deckCounts);
  const maxCount = deckEntries.length > 0 ? Math.max(...deckEntries.map(([_, count]) => count)) : 0;
  const mostPlayedDecks = deckEntries.length > 0 
    ? deckEntries.filter(([_, count]) => count === maxCount).map(([deck]) => deck)
    : [];
  const mostPlayedDecksStr = mostPlayedDecks.length > 0 ? mostPlayedDecks.join(", ") : "--";
  const minCount = deckEntries.length > 0 ? Math.min(...deckEntries.map(([_, count]) => count)) : 0;
  const leastPlayedDecks = deckEntries.length > 0 
    ? deckEntries.filter(([_, count]) => count === minCount).map(([deck]) => deck)
    : [];
  const leastPlayedDecksStr = leastPlayedDecks.length > 0 ? leastPlayedDecks.join(", ") : "--";

  updateQueryElement("playerUniqueDecksCard", ".stat-value", uniqueDecks || "N/A");
  updateQueryElement("playerMostPlayedCard", ".stat-value", mostPlayedDecksStr);
  updateQueryElement("playerMostPlayedCard", ".stat-change", maxCount > 0 ? `${maxCount}x` : "");
  updateQueryElement("playerLeastPlayedCard", ".stat-value", leastPlayedDecksStr);
  updateQueryElement("playerLeastPlayedCard", ".stat-change", minCount > 0 ? `${minCount}x` : "");

  const rankStats = { top1_8: 0, top9_16: 0, top17_32: 0, top33Plus: 0 };
  data.forEach(row => {
    if (row.Rank >= 1 && row.Rank <= 8) rankStats.top1_8 += 1;
    else if (row.Rank >= 9 && row.Rank <= 16) rankStats.top9_16 += 1;
    else if (row.Rank >= 17 && row.Rank <= 32) rankStats.top17_32 += 1;
    else rankStats.top33Plus += 1;
  });
  const conversion = (count) => totalEvents === 0 ? "--" : `${((count / totalEvents) * 100).toFixed(0)}%`;
  updateElement("playerTop1_8", rankStats.top1_8 || "--");
  updateElement("playerTop9_16", rankStats.top9_16 || "--");
  updateElement("playerTop17_32", rankStats.top17_32 || "--");
  updateElement("playerTop33Plus", rankStats.top33Plus || "--");
  updateElement("playerTop1_8%", conversion(rankStats.top1_8));
  updateElement("playerTop9_16%", conversion(rankStats.top9_16));
  updateElement("playerTop17_32%", conversion(rankStats.top17_32));
  updateElement("playerTop33Plus%", conversion(rankStats.top33Plus));

  // Calculate deck stats with event-specific win rates
  const deckStats = filteredDataNoShow.reduce((acc, row) => {
    if (!acc[row.Deck]) {
      acc[row.Deck] = { 
        wins: 0, 
        losses: 0, 
        events: new Set(), 
        eventWinRates: [] 
      };
    }
    acc[row.Deck].wins += row.Wins || 0;
    acc[row.Deck].losses += row.Losses || 0;
    acc[row.Deck].events.add(row.Event);
    const winRate = (row.Wins + row.Losses) > 0 ? (row.Wins / (row.Wins + row.Losses)) * 100 : 0;
    acc[row.Deck].eventWinRates.push({ winRate, event: row.Event });
    return acc;
  }, {});

  console.log("Calculated deckStats:", deckStats);

  const deckPerformance = Object.entries(deckStats).map(([deck, stats]) => {
    const overallWinRate = (stats.wins + stats.losses) > 0 ? (stats.wins / (stats.wins + stats.losses)) * 100 : 0;
    const validWinRates = stats.eventWinRates.filter(e => e.winRate !== null && !isNaN(e.winRate));
    const bestEvent = validWinRates.length > 0 
      ? validWinRates.reduce((best, curr) => curr.winRate > best.winRate ? curr : best)
      : { winRate: 0, event: "--" };
    const worstEvent = validWinRates.length > 0 
      ? validWinRates.reduce((worst, curr) => curr.winRate < worst.winRate ? curr : worst)
      : { winRate: 0, event: "--" };
    return {
      deck,
      eventCount: stats.events.size,
      wins: stats.wins,
      losses: stats.losses,
      overallWinRate,
      bestEventData: { winRate: bestEvent.winRate, event: bestEvent.event },
      worstEventData: { winRate: worstEvent.winRate, event: worstEvent.event }
    };
  });

  console.log("Deck performance array:", deckPerformance);

  const validDecks = deckPerformance.filter(deck => deck.wins + deck.losses > 0);
  console.log("Valid decks (with games played):", validDecks);

  // Find all decks tied for best and worst performing
  const bestWinRate = validDecks.length > 0 
    ? Math.max(...validDecks.map(deck => deck.overallWinRate))
    : null;
  const bestDecks = bestWinRate !== null 
    ? validDecks.filter(deck => deck.overallWinRate === bestWinRate)
    : [];
  const worstWinRate = validDecks.length > 0 
    ? Math.min(...validDecks.map(deck => deck.overallWinRate))
    : null;
  const worstDecks = worstWinRate !== null 
    ? validDecks.filter(deck => deck.overallWinRate === worstWinRate)
    : [];

  console.log("Best decks:", bestDecks);
  console.log("Worst decks:", worstDecks);

  // Find all decks tied for most played and least played
  const mostPlayedDeckEntries = mostPlayedDecks.length > 0 
    ? deckPerformance.filter(deck => mostPlayedDecks.includes(deck.deck))
    : [];
  const leastPlayedDeckEntries = leastPlayedDecks.length > 0 
    ? deckPerformance.filter(deck => leastPlayedDecks.includes(deck.deck))
    : [];

  console.log("Most played deck entries:", mostPlayedDeckEntries);
  console.log("Least played deck entries:", leastPlayedDeckEntries);

  // Calculate Overall Win Rate for the sidebar
  const totalWins = filteredDataNoShow.reduce((sum, row) => sum + (row.Wins || 0), 0);
  const totalLosses = filteredDataNoShow.reduce((sum, row) => sum + (row.Losses || 0), 0);
  const overallWinRate = (totalWins + totalLosses) > 0 ? (totalWins / (totalWins + totalLosses)) * 100 : 0;
  updateElement("playerOverallWinRate", overallWinRate ? `${overallWinRate.toFixed(2)}%` : "--");

  // Set card titles, indicating ties if applicable
  let bestDeckTitle = bestDecks.length > 1 ? "Best (Tied) Performing Deck" : "Best Performing Deck";
  let worstDeckTitle = worstDecks.length > 1 ? "Worst (Tied) Performing Deck" : "Worst Performing Deck";
  let mostPlayedDeckTitle = mostPlayedDeckEntries.length > 1 ? "Most (Tied) Played Deck" : "Most Played Deck";
  let leastPlayedDeckTitle = leastPlayedDeckEntries.length > 1 ? "Least (Tied) Played Deck" : "Least Played Deck";

  // Update Best Performing Deck card
  const bestDeckCard = document.getElementById("playerBestDeckCard");
  if (bestDeckCard) {
    bestDeckCard.querySelector(".stat-title").textContent = bestDeckTitle;
  }
  if (bestDecks.length > 0) {
    updateElement("playerBestDeckName", bestDecks.map(deck => deck.deck).join(", "));
    updateElement("playerBestDeckEvents", bestDecks[0].eventCount);
    updateElement("playerBestDeckWinRate", `${bestDecks[0].overallWinRate.toFixed(2)}%`);
    const bestWinRates = bestDecks.map(deck => deck.bestEventData.winRate);
    const bestEvents = bestDecks.map(deck => `${deck.bestEventData.winRate.toFixed(2)}% (${deck.bestEventData.event})`);
    updateElement("playerBestDeckBestWinRate", bestWinRates.every((rate, _, arr) => rate === arr[0]) 
      ? bestEvents[0] 
      : bestEvents.join(", "));
    const worstWinRates = bestDecks.map(deck => deck.worstEventData.winRate);
    const worstEvents = bestDecks.map(deck => `${deck.worstEventData.winRate.toFixed(2)}% (${deck.worstEventData.event})`);
    updateElement("playerBestDeckWorstWinRate", worstWinRates.every((rate, _, arr) => rate === arr[0]) 
      ? worstEvents[0] 
      : worstEvents.join(", "));
  } else {
    updateElement("playerBestDeckName", "--");
    updateElement("playerBestDeckEvents", "--");
    updateElement("playerBestDeckWinRate", "--");
    updateElement("playerBestDeckBestWinRate", "--");
    updateElement("playerBestDeckWorstWinRate", "--");
  }
  document.getElementById("playerBestDeckCard").style.display = "block";

  // Update Worst Performing Deck card
  const worstDeckCard = document.getElementById("playerWorstDeckCard");
  if (worstDeckCard) {
    worstDeckCard.querySelector(".stat-title").textContent = worstDeckTitle;
  }
  if (worstDecks.length > 0) {
    updateElement("playerWorstDeckName", worstDecks.map(deck => deck.deck).join(", "));
    updateElement("playerWorstDeckEvents", worstDecks[0].eventCount);
    updateElement("playerWorstDeckWinRate", `${worstDecks[0].overallWinRate.toFixed(2)}%`);
    const bestWinRates = worstDecks.map(deck => deck.bestEventData.winRate);
    const bestEvents = worstDecks.map(deck => `${deck.bestEventData.winRate.toFixed(2)}% (${deck.bestEventData.event})`);
    updateElement("playerWorstDeckBestWinRate", bestWinRates.every((rate, _, arr) => rate === arr[0]) 
      ? bestEvents[0] 
      : bestEvents.join(", "));
    const worstWinRates = worstDecks.map(deck => deck.worstEventData.winRate);
    const worstEvents = worstDecks.map(deck => `${deck.worstEventData.winRate.toFixed(2)}% (${deck.worstEventData.event})`);
    updateElement("playerWorstDeckWorstWinRate", worstWinRates.every((rate, _, arr) => rate === arr[0]) 
      ? worstEvents[0] 
      : worstEvents.join(", "));
  } else {
    updateElement("playerWorstDeckName", "--");
    updateElement("playerWorstDeckEvents", "--");
    updateElement("playerWorstDeckWinRate", "--");
    updateElement("playerWorstDeckBestWinRate", "--");
    updateElement("playerWorstDeckWorstWinRate", "--");
  }
  document.getElementById("playerWorstDeckCard").style.display = "block";

  // Update Most Played Deck card
  const mostPlayedDeckCard = document.getElementById("playerMostPlayedDeckCard");
  if (mostPlayedDeckCard) {
    mostPlayedDeckCard.querySelector(".stat-title").textContent = mostPlayedDeckTitle;
  }
  if (mostPlayedDeckEntries.length > 0) {
    updateElement("playerMostPlayedDeckName", mostPlayedDeckEntries.map(deck => deck.deck).join(", "));
    updateElement("playerMostPlayedDeckEvents", mostPlayedDeckEntries[0].eventCount);
    updateElement("playerMostPlayedDeckWinRate", mostPlayedDeckEntries.length === 1 
      ? `${mostPlayedDeckEntries[0].overallWinRate.toFixed(2)}%`
      : mostPlayedDeckEntries.map(deck => `${deck.overallWinRate.toFixed(2)}%`).join(", "));
    const bestWinRates = mostPlayedDeckEntries.map(deck => deck.bestEventData.winRate);
    const bestEvents = mostPlayedDeckEntries.map(deck => `${deck.bestEventData.winRate.toFixed(2)}% (${deck.bestEventData.event})`);
    updateElement("playerMostPlayedDeckBestWinRate", bestWinRates.every((rate, _, arr) => rate === arr[0]) 
      ? bestEvents[0] 
      : bestEvents.join(", "));
    const worstWinRates = mostPlayedDeckEntries.map(deck => deck.worstEventData.winRate);
    const worstEvents = mostPlayedDeckEntries.map(deck => `${deck.worstEventData.winRate.toFixed(2)}% (${deck.worstEventData.event})`);
    updateElement("playerMostPlayedDeckWorstWinRate", worstWinRates.every((rate, _, arr) => rate === arr[0]) 
      ? worstEvents[0] 
      : worstEvents.join(", "));
  } else {
    updateElement("playerMostPlayedDeckName", "--");
    updateElement("playerMostPlayedDeckEvents", "0");
    updateElement("playerMostPlayedDeckWinRate", "0%");
    updateElement("playerMostPlayedDeckBestWinRate", "-- (Event: --)");
    updateElement("playerMostPlayedDeckWorstWinRate", "-- (Event: --)");
  }
  document.getElementById("playerMostPlayedDeckCard").style.display = "block";

  // Update Least Played Deck card
  const leastPlayedDeckCard = document.getElementById("playerLeastPlayedDeckCard");
  if (leastPlayedDeckCard) {
    leastPlayedDeckCard.querySelector(".stat-title").textContent = leastPlayedDeckTitle;
  }
  if (leastPlayedDeckEntries.length > 0) {
    updateElement("playerLeastPlayedDeckName", leastPlayedDeckEntries.map(deck => deck.deck).join(", "));
    updateElement("playerLeastPlayedDeckEvents", leastPlayedDeckEntries[0].eventCount);
    updateElement("playerLeastPlayedDeckWinRate", leastPlayedDeckEntries.length === 1 
      ? `${leastPlayedDeckEntries[0].overallWinRate.toFixed(2)}%`
      : leastPlayedDeckEntries.map(deck => `${deck.overallWinRate.toFixed(2)}%`).join(", "));
    const bestWinRates = leastPlayedDeckEntries.map(deck => deck.bestEventData.winRate);
    const bestEvents = leastPlayedDeckEntries.map(deck => `${deck.bestEventData.winRate.toFixed(2)}% (${deck.bestEventData.event})`);
    updateElement("playerLeastPlayedDeckBestWinRate", bestWinRates.every((rate, _, arr) => rate === arr[0]) 
      ? bestEvents[0] 
      : bestEvents.join(", "));
    const worstWinRates = leastPlayedDeckEntries.map(deck => deck.worstEventData.winRate);
    const worstEvents = leastPlayedDeckEntries.map(deck => `${deck.worstEventData.winRate.toFixed(2)}% (${deck.worstEventData.event})`);
    updateElement("playerLeastPlayedDeckWorstWinRate", worstWinRates.every((rate, _, arr) => rate === arr[0]) 
      ? worstEvents[0] 
      : worstEvents.join(", "));
  } else {
    updateElement("playerLeastPlayedDeckName", "--");
    updateElement("playerLeastPlayedDeckEvents", "0");
    updateElement("playerLeastPlayedDeckWinRate", "0%");
    updateElement("playerLeastPlayedDeckBestWinRate", "-- (Event: --)");
    updateElement("playerLeastPlayedDeckWorstWinRate", "-- (Event: --)");
  }
  document.getElementById("playerLeastPlayedDeckCard").style.display = "block";

  const eventsDetails = document.getElementById("playerEventsDetails");
  if (eventsDetails) {
    if (!data || data.length === 0) {
      eventsDetails.innerHTML = "<div>No events selected</div>";
    } else {
      const eventsByDate = data.reduce((acc, row) => {
        if (!acc[row.Date]) acc[row.Date] = [];
        acc[row.Date].push({ event: row.Event, deck: row.Deck });
        return acc;
      }, {});
      const sortedDates = Object.keys(eventsByDate).sort();
      eventsDetails.innerHTML = sortedDates.map(date => {
        const eventDeckPairs = eventsByDate[date].map(item => `${item.event} (${item.deck})`);
        return `<div><span class="label">${date}:</span> <span class="value">${eventDeckPairs.join(", ")}</span></div>`;
      }).join("");
    }
  }
}