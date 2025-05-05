import { cleanedData } from '../data.js';
import { updateEventMetaWinRateChart } from '../charts/single-meta-win-rate.js';
import { updateEventFunnelChart } from '../charts/single-funnel.js';
import { updateMultiMetaWinRateChart } from '../charts/multi-meta-win-rate.js';
import { updateMultiPlayerWinRateChart } from '../charts/multi-player-win-rate.js';
import { updateDeckEvolutionChart } from '../charts/multi-deck-evolution.js';
import { toggleStatCardVisibility, updateElementText, updateElementHTML } from '../utils/dom.js';
import { calculateSingleEventStats, calculateMultiEventStats, calculateDeckStats } from '../utils/data-cards.js';
import { calculateSingleEventRawTable, calculateSingleEventAggregateTable, calculateMultiEventAggregateTable, calculateMultiEventDeckTable } from '../utils/data-tables.js';
import { formatDate, formatPercentage, formatDateRange, formatEventName } from '../utils/format.js';

export function initEventAnalysis() {
  console.log('Event Analysis initialized');
}

export function updateSingleEventAnalysis(data, totalPlayers) {
  updateEventMetaWinRateChart();
  updateEventFunnelChart();
  updateSingleEventTables(data, 'raw');
  populateSingleEventStats(data);
}

export function updateMultiEventAnalysis(data) {
  updateMultiMetaWinRateChart();
  updateMultiPlayerWinRateChart();
  updateDeckEvolutionChart();
  updateMultiEventTables(data, 'aggregate');
  populateMultiEventStats(data);
}

export function updateEventAnalytics() {
  console.log("Updating event analytics...");
  const selectedEventType = document.querySelector('.event-type-filter.active')?.dataset.type || "";
  const eventFilterMenu = document.getElementById("eventFilterMenu");
  const selectedEvents = eventFilterMenu && eventFilterMenu.value ? [eventFilterMenu.value] : [];
  const eventData = cleanedData.filter(row => row.EventType === selectedEventType && (selectedEvents.length === 0 || selectedEvents.includes(row.Event)));
  updateSingleEventAnalysis(eventData, eventData.length);
}

export function updateMultiEventAnalytics() {
  console.log("Updating multi-event analytics...");
  const startDate = document.getElementById("startDateSelect").value;
  const endDate = document.getElementById("endDateSelect").value;
  const selectedEventTypes = Array.from(document.querySelectorAll('.event-type-filter.active')).map(button => button.dataset.type);
  const filteredData = (startDate && endDate && selectedEventTypes.length > 0) 
    ? cleanedData.filter(row => row.Date >= startDate && row.Date <= endDate && selectedEventTypes.includes(row.EventType))
    : [];
  updateMultiEventAnalysis(filteredData);
}

export function updateSingleEventTables(eventData, tableType = 'raw') {
  const tableHead = document.getElementById("singleEventTableHead");
  const tableBody = document.getElementById("singleEventTableBody");
  const tableTitle = document.getElementById("singleEventTableTitle");
  if (!tableHead || !tableBody || !tableTitle) {
    console.error("Single event table elements not found!");
    return;
  }

  if (tableType === 'raw') {
    updateElementHTML("singleEventTableHead", `
      <tr>
        <th data-sort="rank">Rank <span class="sort-arrow"></span></th>
        <th data-sort="player">Player <span class="sort-arrow"></span></th>
        <th data-sort="deck">Deck <span class="sort-arrow"></span></th>
        <th data-sort="wins">Wins <span class="sort-arrow"></span></th>
        <th data-sort="losses">Losses <span class="sort-arrow"></span></th>
        <th data-sort="winRate">Win Rate <span class="sort-arrow"></span></th>
      </tr>
    `);
    let rawEventName = eventData.length > 0 ? eventData[0].Event : "";
    const eventName = formatEventName(rawEventName);
    updateElementText("singleEventTableTitle", eventName ? `Raw Data for ${eventName} on ${formatDate(eventData[0].Date)}` : "No Data Available");

    const rows = calculateSingleEventRawTable(eventData);
    updateElementHTML("singleEventTableBody", rows.length === 0 ? "<tr><td colspan='6'>No data available for the selected event.</td></tr>" : rows.map(row => `
      <tr>
        <td>${row.rank}</td>
        <td>${row.player}</td>
        <td>${row.deck}</td>
        <td>${row.wins}</td>
        <td>${row.losses}</td>
        <td>${row.winRate.toFixed(2)}%</td>
      </tr>
    `).join(""));

    setupTableSorting(tableHead, tableBody, rows, tableType);
  } else if (tableType === 'aggregate') {
    updateElementHTML("singleEventTableHead", `
      <tr>
        <th rowspan="2" data-sort="deck">Deck <span class="sort-arrow"></span></th>
        <th rowspan="2" data-sort="count">Number of Players <span class="sort-arrow"></span></th>
        <th rowspan="2" data-sort="metaShare">% of Meta <span class="sort-arrow"></span></th>
        <th rowspan="2" data-sort="winRate">Win Rate % <span class="sort-arrow"></span></th>
        <th colspan="4" class="top-conversion-header">Top Conversion
          <div class="bubble-menu display-toggle">
            <button class="bubble-button display-toggle-btn raw-btn" data-display="raw">Raw</button>
            <button class="bubble-button display-toggle-btn percent-btn active" data-display="percent">Percent</button>
          </div>
        </th>
      </tr>
      <tr>
        <th data-sort="top8">Top 8 <span class="sort-arrow"></span></th>
        <th data-sort="top16">Top 9-16 <span class="sort-arrow"></span></th>
        <th data-sort="top32">Top 17-32 <span class="sort-arrow"></span></th>
        <th data-sort="belowTop32">Below Top 32 <span class="sort-arrow"></span></th>
      </tr>
    `);
    let rawEventName = eventData.length > 0 ? eventData[0].Event : "";
    const eventName = formatEventName(rawEventName);
    updateElementText("singleEventTableTitle", eventName ? `Aggregate Decks for ${eventName} on ${formatDate(eventData[0].Date)}` : "No Data Available");

    const rows = calculateSingleEventAggregateTable(eventData);
    let displayMode = 'percent';
    const renderTableBody = () => updateElementHTML("singleEventTableBody", rows.length === 0 ? "<tr><td colspan='8'>No data available for the selected event.</td></tr>" : rows.map(row => `
      <tr>
        <td>${row.deck}</td>
        <td>${row.count}</td>
        <td>${row.metaShare.toFixed(1)}%</td>
        <td>${row.winRate.toFixed(1)}%</td>
        <td>${displayMode === 'raw' ? row.top8 : row.top8Percent.toFixed(1) + '%'}</td>
        <td>${displayMode === 'raw' ? row.top16 : row.top16Percent.toFixed(1) + '%'}</td>
        <td>${displayMode === 'raw' ? row.top32 : row.top32Percent.toFixed(1) + '%'}</td>
        <td>${displayMode === 'raw' ? row.belowTop32 : row.belowTop32Percent.toFixed(1) + '%'}</td>
      </tr>
    `).join(""));

    renderTableBody();
    setupTableSorting(tableHead, tableBody, rows, tableType, () => renderTableBody());
    setupDisplayToggle(tableHead, () => { 
      displayMode = tableHead.querySelector('.display-toggle-btn.active').dataset.display; 
      renderTableBody(); 
    });
  }

  const toggleContainer = document.querySelector('.table-toggle');
  if (toggleContainer) {
    const toggleButtons = toggleContainer.querySelectorAll('.table-toggle-btn');
    toggleButtons.forEach(button => button.addEventListener('click', () => {
      toggleButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      updateSingleEventTables(eventData, button.dataset.table);
    }));
  }
}

export function updateMultiEventTables(filteredData, tableType = 'aggregate', deckName = '') {
  const tableHead = document.getElementById("multiEventTableHead");
  const tableBody = document.getElementById("multiEventTableBody");
  const tableTitle = document.getElementById("multiEventTableTitle");
  const startDate = document.getElementById("startDateSelect")?.value;
  const endDate = document.getElementById("endDateSelect")?.value;
  if (!tableHead || !tableBody || !tableTitle) {
    console.error("Multi event table elements not found!");
    return;
  }

  const uniqueEvents = [...new Set(filteredData.map(row => row.Event))];

  if (tableType === 'aggregate') {
    updateElementHTML("multiEventTableHead", `
      <tr>
        <th rowspan="2" data-sort="deck">Deck <span class="sort-arrow"></span></th>
        <th rowspan="2" data-sort="metaShare">Aggregate Meta Share <span class="sort-arrow"></span></th>
        <th rowspan="2" data-sort="winRate">Aggregate Win Rate <span class="sort-arrow"></span></th>
        <th colspan="4" class="top-conversion-header">Top Conversion
          <div class="bubble-menu display-toggle">
            <button class="bubble-button display-toggle-btn raw-btn" data-display="raw">Raw</button>
            <button class="bubble-button display-toggle-btn percent-btn active" data-display="percent">Percent</button>
          </div>
        </th>
      </tr>
      <tr>
        <th data-sort="top8">Top 8 <span class="sort-arrow"></span></th>
        <th data-sort="top16">Top 9-16 <span class="sort-arrow"></span></th>
        <th data-sort="top32">Top 17-32 <span class="sort-arrow"></span></th>
        <th data-sort="belowTop32">Below Top 32 <span class="sort-arrow"></span></th>
      </tr>
    `);
    updateElementText("multiEventTableTitle", startDate && endDate ? `Data for ${uniqueEvents.length} Tournaments from ${formatDate(startDate)} to ${formatDate(endDate)}` : "Please Select a Date Range");

    const rows = calculateMultiEventAggregateTable(filteredData);
    let displayMode = 'percent';
    const renderTableBody = () => updateElementHTML("multiEventTableBody", rows.length === 0 ? "<tr><td colspan='7'>No data available for the selected filters.</td></tr>" : rows.map(row => `
      <tr>
        <td>${row.deck}</td>
        <td>${row.metaShare.toFixed(2)}%</td>
        <td>${row.winRate.toFixed(2)}%</td>
        <td>${displayMode === 'raw' ? row.top8 : row.top8Percent.toFixed(2) + '%'}</td>
        <td>${displayMode === 'raw' ? row.top16 : row.top16Percent.toFixed(2) + '%'}</td>
        <td>${displayMode === 'raw' ? row.top32 : row.top32Percent.toFixed(2) + '%'}</td>
        <td>${displayMode === 'raw' ? row.belowTop32 : row.belowTop32Percent.toFixed(2) + '%'}</td>
      </tr>
    `).join(""));

    renderTableBody();
    setupTableSorting(tableHead, tableBody, rows, tableType, () => renderTableBody());
    setupDisplayToggle(tableHead, () => { 
      displayMode = tableHead.querySelector('.display-toggle-btn.active').dataset.display; 
      renderTableBody(); 
    });
  } else if (tableType === 'deck') {
    updateElementHTML("multiEventTableHead", `
      <tr>
        <th rowspan="2" data-sort="date">Date <span class="sort-arrow"></span></th>
        <th rowspan="2" data-sort="event">Event <span class="sort-arrow"></span></th>
        <th rowspan="2" data-sort="metaShare">Meta Share <span class="sort-arrow"></span></th>
        <th rowspan="2" data-sort="winRate">Win Rate <span class="sort-arrow"></span></th>
        <th colspan="4" class="top-conversion-header">Top Conversion
          <div class="bubble-menu display-toggle">
            <button class="bubble-button display-toggle-btn raw-btn" data-display="raw">Raw</button>
            <button class="bubble-button display-toggle-btn percent-btn active" data-display="percent">Percent</button>
          </div>
        </th>
      </tr>
      <tr>
        <th data-sort="top8">Top 8 <span class="sort-arrow"></span></th>
        <th data-sort="top16">Top 9-16 <span class="sort-arrow"></span></th>
        <th data-sort="top32">Top 17-32 <span class="sort-arrow"></span></th>
        <th data-sort="belowTop32">Below Top 32 <span class="sort-arrow"></span></th>
      </tr>
    `);
    updateElementText("multiEventTableTitle", startDate && endDate && deckName ? `Data for ${deckName} from ${formatDate(startDate)} to ${formatDate(endDate)}` : "Please Select a Date Range and Deck");

    const rows = calculateMultiEventDeckTable(filteredData, deckName);
    let displayMode = 'percent';
    const renderTableBody = () => updateElementHTML("multiEventTableBody", rows.length === 0 ? "<tr><td colspan='8'>No data available for the selected deck and filters.</td></tr>" : rows.map(row => `
      <tr>
        <td>${formatDate(row.date)}</td>
        <td class="event-tooltip" data-tooltip="${row.event} had ${row.totalPlayers} Players, won by ${row.winner} w/ ${row.winnerDeck}">${row.event}</td>
        <td>${row.metaShare.toFixed(2)}%</td>
        <td>${row.winRate.toFixed(2)}%</td>
        <td>${displayMode === 'raw' ? row.top8 : row.top8Percent.toFixed(2) + '%'}</td>
        <td>${displayMode === 'raw' ? row.top16 : row.top16Percent.toFixed(2) + '%'}</td>
        <td>${displayMode === 'raw' ? row.top32 : row.top32Percent.toFixed(2) + '%'}</td>
        <td>${displayMode === 'raw' ? row.belowTop32 : row.belowTop32Percent.toFixed(2) + '%'}</td>
      </tr>
    `).join(""));

    renderTableBody();
    setupTableSorting(tableHead, tableBody, rows, tableType, () => renderTableBody());
    setupDisplayToggle(tableHead, () => { 
      displayMode = tableHead.querySelector('.display-toggle-btn.active').dataset.display; 
      renderTableBody(); 
    });
  }
}

export function populateSingleEventStats(filteredData) {
  const stats = calculateSingleEventStats(filteredData);
  toggleStatCardVisibility("singleEventInfoCard", true);
  updateElementText("eventInfoName", stats.eventName);
  updateElementText("eventInfoDate", formatDate(stats.eventDate));
  updateElementText("eventInfoPlayers", stats.totalPlayers);
  toggleStatCardVisibility("singleTopPlayerCard", true);
  updateElementText("singleTopPlayer", stats.topPlayer);
  updateElementText("singleTopPlayerDetails", stats.topPlayerDetails);
  toggleStatCardVisibility("singleRunnerUpCard", true);
  updateElementText("singleRunnerUp", stats.runnerUp);
  updateElementText("singleRunnerUpDetails", stats.runnerUpDetails);
  toggleStatCardVisibility("singleMostCopiesCard", true);
  updateElementText("singleMostCopiesDeck", stats.mostCopiesDeck);
  updateElementText("singleMostCopiesDetails", stats.mostCopiesDetails);
  toggleStatCardVisibility("singleTopDecksCard", true);
  updateElementHTML("singleTopDecksDetails", filteredData.length === 0 ? "No Data" : Object.entries(stats.topDecks)
    .map(([range, decks]) => {
      if (!decks || decks.length === 0) return "";
      const validDecks = decks.filter(deck => deck !== "UNKNOWN" && deck !== "No Show");
      if (validDecks.length === 0) return "";
      const deckCounts = stats.deckCountsByRange[range];
      const maxCopies = Math.max(...Object.values(deckCounts), 0);
      if (maxCopies === 0) return "";
      const mostPlayedDecks = Object.entries(deckCounts).filter(([_, count]) => count === maxCopies).map(([deck]) => deck);
      const rangeCount = {
        "Top 8": filteredData.filter(row => row.Rank >= 1 && row.Rank <= 8).length,
        "Top 16": filteredData.filter(row => row.Rank >= 9 && row.Rank <= 16).length,
        "Top 32": filteredData.filter(row => row.Rank >= 17 && row.Rank <= 32).length,
        "Below Top 32": filteredData.filter(row => row.Rank > 32).length
      }[range];
      const uniqueDecksCount = Object.keys(deckCounts).length;
      const maxEntries = range === "Top 8" ? 8 : range === "Top 16" ? 8 : range === "Top 32" ? 16 : rangeCount;
      const deckStatsText = rangeCount === maxEntries && uniqueDecksCount === rangeCount && maxCopies === 1 
        ? "All Unique Decks" 
        : mostPlayedDecks.map(deck => {
            const stats = calculateDeckStats(filteredData, deck, filteredData.length);
            return `${maxCopies} Copies of ${deck} (${formatPercentage(stats.winRate)} WR / ${formatPercentage(stats.metaShare)} Meta)`;
          }).join(", ");
      return `<div><span class="label">${range}:</span> <span class="value">${deckStatsText}</span></div>`;
    })
    .filter(Boolean)
    .join("") || "No Data");
}

export function populateMultiEventStats(filteredData) {
  const stats = calculateMultiEventStats(filteredData);
  updateElementText("totalEvents", stats.totalEvents);
  const card = document.getElementById("multiTotalEventsCard");
  if (card) card.querySelector('.stat-change').textContent = formatDateRange(document.getElementById("startDateSelect")?.value, document.getElementById("endDateSelect")?.value);
  updateElementText("mostPlayersEvent", stats.mostPlayersEvent);
  updateElementText("mostPlayersCount", stats.mostPlayersCount);
  updateElementText("leastPlayersEvent", stats.leastPlayersEvent);
  updateElementText("leastPlayersCount", stats.leastPlayersCount);
  updateElementText("multiMostCopiesDeck", stats.mostCopiesDeck);
  updateElementText("multiMostCopiesDetails", stats.mostCopiesDetails);
  updateElementHTML("multiTopDecksDetails", filteredData.length === 0 ? "--" : Object.entries(stats.topDecks)
    .map(([range, decks]) => {
      if (!decks || decks.length === 0) return "";
      const validDecks = decks.filter(deck => deck !== "UNKNOWN" && deck !== "No Show");
      if (validDecks.length === 0) return "";
      const deckCounts = stats.deckCountsByRange[range];
      const maxCopies = Math.max(...Object.values(deckCounts), 0);
      if (maxCopies === 0) return "";
      const mostPlayedDecks = Object.entries(deckCounts).filter(([_, count]) => count === maxCopies).map(([deck]) => deck);
      const rangeCount = {
        "Top 8": filteredData.filter(row => row.Rank >= 1 && row.Rank <= 8).length,
        "Top 16": filteredData.filter(row => row.Rank >= 9 && row.Rank <= 16).length,
        "Top 32": filteredData.filter(row => row.Rank >= 17 && row.Rank <= 32).length,
        "Below Top 32": filteredData.filter(row => row.Rank > 32).length
      }[range];
      const uniqueDecksCount = Object.keys(deckCounts).length;
      const maxEntries = range === "Top 8" ? 8 : range === "Top 16" ? 8 : range === "Top 32" ? 16 : rangeCount;
      const deckStatsText = rangeCount === maxEntries && uniqueDecksCount === rangeCount && maxCopies === 1 
        ? "All Unique Decks" 
        : mostPlayedDecks.map(deck => {
            const stats = calculateDeckStats(filteredData, deck, filteredData.length);
            return `${maxCopies} Copies of ${deck} (${formatPercentage(stats.winRate)} WR / ${formatPercentage(stats.metaShare)} Meta)`;
          }).join(", ");
      return `<div><span class="label">${range}:</span> <span class="value">${deckStatsText}</span></div>`;
    })
    .filter(Boolean)
    .join("") || "--");
}

// Helper Functions
function setupTableSorting(tableHead, tableBody, rows, tableType, renderCallback = null) {
  const headers = tableHead.querySelectorAll('th[data-sort]');
  headers.forEach(header => header.addEventListener('click', () => {
    const sortKey = header.dataset.sort;
    const isAscending = header.classList.contains('asc');
    headers.forEach(h => { h.classList.remove('asc', 'desc'); h.querySelector('.sort-arrow').textContent = ''; });
    rows.sort((a, b) => {
      const aVal = tableType === 'aggregate' && ['top8', 'top16', 'top32', 'belowTop32'].includes(sortKey) && tableHead.querySelector('.display-toggle-btn.active')?.dataset.display === 'percent' 
        ? a[sortKey + 'Percent'] 
        : a[sortKey];
      const bVal = tableType === 'aggregate' && ['top8', 'top16', 'top32', 'belowTop32'].includes(sortKey) && tableHead.querySelector('.display-toggle-btn.active')?.dataset.display === 'percent' 
        ? b[sortKey + 'Percent'] 
        : b[sortKey];
      const aSortVal = typeof aVal === 'string' ? aVal.toLowerCase() : aVal;
      const bSortVal = typeof bVal === 'string' ? bVal.toLowerCase() : bVal;
      return isAscending ? (aSortVal > bSortVal ? -1 : 1) : (aSortVal < bSortVal ? -1 : 1);
    });
    header.classList.add(isAscending ? 'desc' : 'asc');
    header.querySelector('.sort-arrow').textContent = isAscending ? '↓' : '↑';
    if (renderCallback) {
      renderCallback();
    } else {
      updateElementHTML(tableBody.id, rows.map(row => tableType === 'raw' ? `
        <tr>
          <td>${row.rank}</td>
          <td>${row.player}</td>
          <td>${row.deck}</td>
          <td>${row.wins}</td>
          <td>${row.losses}</td>
          <td>${row.winRate.toFixed(2)}%</td>
        </tr>
      ` : `
        <tr>
          <td>${row.deck}</td>
          <td>${row.count || row.metaShare.toFixed(2) + '%'}</td>
          <td>${row.metaShare.toFixed(1) || row.winRate.toFixed(2)}%</td>
          <td>${row.winRate.toFixed(1) || row.top8Percent.toFixed(1) + '%'}</td>
          <td>${row.top8 || row.top16Percent.toFixed(1) + '%'}</td>
          <td>${row.top16 || row.top32Percent.toFixed(1) + '%'}</td>
          <td>${row.top32 || row.belowTop32Percent.toFixed(1) + '%'}</td>
          <td>${row.belowTop32 || ''}</td>
        </tr>
      `).join(""));
    }
  }));
}

function setupDisplayToggle(tableHead, callback) {
  const displayToggleButtons = tableHead.querySelectorAll('.display-toggle-btn');
  displayToggleButtons.forEach(button => button.addEventListener('click', () => {
    displayToggleButtons.forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    callback();
  }));
}