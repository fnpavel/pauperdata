import { updatePlayerWinRateChart } from '../charts/player-win-rate.js';
import { updatePlayerDeckPerformanceChart } from '../charts/player-deck-performance.js';
import { updateElementText, updateElementHTML } from '../utils/dom.js';
import { cleanedData } from '../data.js';
import { calculatePlayerStats } from '../utils/data-cards.js';
import { calculatePlayerEventTable, calculatePlayerDeckTable } from '../utils/data-tables.js';

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
  const selectedEventTypes = Array.from(document.querySelectorAll('.event-type-filter.active')).map(button => button.dataset.type);

  console.log("Player Analytics Filters:", { startDate, endDate, selectedPlayer, selectedEventTypes });

  if (playerFilterMenu && !playerFilterMenu.dataset.initialized) {
    const players = [...new Set(cleanedData.map(row => row.Player))].sort((a, b) => a.localeCompare(b));
    playerFilterMenu.innerHTML = `<option value="">Select EVENT TYPE First</option>` + players.map(player => `<option value="${player}">${player}</option>`).join("");
    playerFilterMenu.dataset.initialized = "true";
  }

  const baseFilteredData = selectedPlayer && startDate && endDate && selectedEventTypes.length > 0
    ? cleanedData.filter(row => row.Date >= startDate && row.Date <= endDate && row.Player === selectedPlayer && selectedEventTypes.includes(row.EventType))
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

      const rows = calculatePlayerEventTable(data);
      updateElementHTML("playerRawTableBody", rows.length === 0 ? "<tr><td colspan='10'>No data available</td></tr>" : rows.map(row => `
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

      setupTableSorting(rawTableHead, rawTableBody, rows);
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

      const rows = calculatePlayerDeckTable(data);
      updateElementHTML("playerRawTableBody", rows.length === 0 ? "<tr><td colspan='7'>No data available</td></tr>" : rows.map(row => `
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

      setupTableSorting(rawTableHead, rawTableBody, rows);
    }
  };

  updateTable('event');
  const toggleButtons = toggleContainer.querySelectorAll('.table-toggle-btn');
  toggleButtons.forEach(button => button.addEventListener('click', () => {
    console.log(`Toggle clicked: ${button.dataset.table}`);
    toggleButtons.forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    updateTable(button.dataset.table);
  }));
}

export function populatePlayerStats(data) {
  console.log("populatePlayerStats called with data:", data);
  const stats = calculatePlayerStats(data);

  // Ensure all stat cards are visible
  ['playerEventsCard', 'playerUniqueDecksCard', 'playerMostPlayedCard', 'playerLeastPlayedCard',
   'playerBestDeckCard', 'playerWorstDeckCard', 'playerMostPlayedDeckCard', 'playerLeastPlayedDeckCard',
   'playerRankStatsCard', 'playerOverallWinRateCard'].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.style.display = "block";
  });

  // Helper function to safely update DOM elements
  const updateElement = (id, value, property = "textContent") => {
    const element = document.getElementById(id);
    if (element) element[property] = value;
    else console.warn(`Element with ID '${id}' not found in the DOM`);
  };

  const updateQueryElement = (id, selector, value, property = "innerHTML") => {
    const parent = document.getElementById(id);
    if (parent) {
      const element = parent.querySelector(selector);
      if (element) element[property] = value;
      else console.warn(`Selector '${selector}' not found in element with ID '${id}'`);
    } else console.warn(`Parent element with ID '${id}' not found in the DOM`);
  };

  // Simple Cards
  updateQueryElement("playerEventsCard", ".stat-value", stats.totalEvents);
  updateQueryElement("playerEventsCard", ".stat-change", stats.eventsDetails);
  updateQueryElement("playerUniqueDecksCard", ".stat-value", stats.uniqueDecks);
  updateQueryElement("playerMostPlayedCard", ".stat-value", stats.mostPlayedDecks);
  updateQueryElement("playerMostPlayedCard", ".stat-change", stats.mostPlayedCount);
  updateQueryElement("playerLeastPlayedCard", ".stat-value", stats.leastPlayedDecks);
  updateQueryElement("playerLeastPlayedCard", ".stat-change", stats.leastPlayedCount);

  // Rank Stats
  updateElement("playerTop1_8", stats.rankStats.top1_8);
  updateElement("playerTop9_16", stats.rankStats.top9_16);
  updateElement("playerTop17_32", stats.rankStats.top17_32);
  updateElement("playerTop33Plus", stats.rankStats.top33Plus);
  updateElement("playerTop1_8%", stats.rankStats.top1_8Percent);
  updateElement("playerTop9_16%", stats.rankStats.top9_16Percent);
  updateElement("playerTop17_32%", stats.rankStats.top17_32Percent);
  updateElement("playerTop33Plus%", stats.rankStats.top33PlusPercent);

  // Overall Win Rate
  updateElement("playerOverallWinRate", stats.overallWinRate);

  // Best Performing Deck
  updateQueryElement("playerBestDeckCard", ".stat-title", stats.bestDeckTitle);
  updateElement("playerBestDeckName", stats.bestDecks.name);
  updateElement("playerBestDeckEvents", stats.bestDecks.events);
  updateElement("playerBestDeckWinRate", stats.bestDecks.winRate);
  updateElement("playerBestDeckBestWinRate", stats.bestDecks.bestWinRate);
  updateElement("playerBestDeckWorstWinRate", stats.bestDecks.worstWinRate);

  // Worst Performing Deck
  updateQueryElement("playerWorstDeckCard", ".stat-title", stats.worstDeckTitle);
  updateElement("playerWorstDeckName", stats.worstDecks.name);
  updateElement("playerWorstDeckEvents", stats.worstDecks.events);
  updateElement("playerWorstDeckWinRate", stats.worstDecks.winRate);
  updateElement("playerWorstDeckBestWinRate", stats.worstDecks.bestWinRate);
  updateElement("playerWorstDeckWorstWinRate", stats.worstDecks.worstWinRate);

  // Most Played Deck
  updateQueryElement("playerMostPlayedDeckCard", ".stat-title", stats.mostPlayedDeckTitle);
  updateElement("playerMostPlayedDeckName", stats.mostPlayedDecksData.name);
  updateElement("playerMostPlayedDeckEvents", stats.mostPlayedDecksData.events);
  updateElement("playerMostPlayedDeckWinRate", stats.mostPlayedDecksData.winRate);
  updateElement("playerMostPlayedDeckBestWinRate", stats.mostPlayedDecksData.bestWinRate);
  updateElement("playerMostPlayedDeckWorstWinRate", stats.mostPlayedDecksData.worstWinRate);

  // Least Played Deck
  updateQueryElement("playerLeastPlayedDeckCard", ".stat-title", stats.leastPlayedDeckTitle);
  updateElement("playerLeastPlayedDeckName", stats.leastPlayedDecksData.name);
  updateElement("playerLeastPlayedDeckEvents", stats.leastPlayedDecksData.events);
  updateElement("playerLeastPlayedDeckWinRate", stats.leastPlayedDecksData.winRate);
  updateElement("playerLeastPlayedDeckBestWinRate", stats.leastPlayedDecksData.bestWinRate);
  updateElement("playerLeastPlayedDeckWorstWinRate", stats.leastPlayedDecksData.worstWinRate);

  // Event History with Rank
  updateElementHTML("playerEventsDetails", stats.eventHistoryHTML);
}

// Helper Function
function setupTableSorting(tableHead, tableBody, rows) {
  const headers = tableHead.querySelectorAll('th[data-sort]');
  headers.forEach(header => header.addEventListener('click', () => {
    const sortKey = header.dataset.sort;
    const isAscending = header.classList.contains('asc');
    headers.forEach(h => { h.classList.remove('asc', 'desc'); h.querySelector('.sort-arrow').textContent = ''; });
    rows.sort((a, b) => {
      const aVal = typeof a[sortKey] === 'string' ? a[sortKey].toLowerCase() : a[sortKey];
      const bVal = typeof b[sortKey] === 'string' ? b[sortKey].toLowerCase() : b[sortKey];
      return isAscending ? (aVal > bVal ? -1 : 1) : (aVal < bVal ? -1 : 1);
    });
    header.classList.add(isAscending ? 'desc' : 'asc');
    header.querySelector('.sort-arrow').textContent = isAscending ? '↓' : '↑';
    updateElementHTML("playerRawTableBody", rows.map(row => row.hasOwnProperty('players') ? `
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
    ` : `
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
  }));
}