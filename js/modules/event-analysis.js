// js/modules/event-analysis.js
// Handles everything for the EVENT ANALYSIS when changing the filtered data: Cards, Charts and Tables
// The Player Analysis is handled in player-analysis.js

import { cleanedData } from '../data.js';
import { updateEventMetaWinRateChart } from '../charts/event-meta-win-rate.js';
import { updateEventFunnelChart } from '../charts/event-funnel.js';
import { updateMultiMetaWinRateChart } from '../charts/multi-meta-win-rate.js';
import { updateMultiPlayerWinRateChart } from '../charts/multi-player-win-rate.js';
import { updateDeckEvolutionChart } from '../charts/deck-evolution.js';
import { toggleStatCardVisibility, updateElementText, updateElementHTML } from '../utils/dom.js';
import { calculateDeckStats, calculateTopDecks } from '../utils/data.js';
import { formatDate, formatPercentage, formatDateRange } from '../utils/format.js';

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
  const eventData = cleanedData.filter(row => 
    row.EventType === selectedEventType && selectedEvents.includes(row.Event)
  );
  updateSingleEventAnalysis(eventData, eventData.length);
}

export function updateMultiEventAnalytics() {
  console.log("Updating multi-event analytics...");
  const startDate = document.getElementById("startDateSelect").value;
  const endDate = document.getElementById("endDateSelect").value;
  const selectedEventTypes = Array.from(document.querySelectorAll('.event-type-filter.active'))
    .map(button => button.dataset.type);
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

  const totalPlayers = eventData.length;
  const deckStats = eventData.reduce((acc, row) => {
    acc[row.Deck] = acc[row.Deck] || { count: 0, wins: 0, losses: 0, top8: 0, top16: 0, top32: 0, belowTop32: 0 };
    acc[row.Deck].count += 1;
    acc[row.Deck].wins += row.Wins;
    acc[row.Deck].losses += row.Losses;
    if (row.Rank >= 1 && row.Rank <= 8) acc[row.Deck].top8 += 1;
    else if (row.Rank >= 9 && row.Rank <= 16) acc[row.Deck].top16 += 1;
    else if (row.Rank >= 17 && row.Rank <= 32) acc[row.Deck].top32 += 1;
    else if (row.Rank > 32) acc[row.Deck].belowTop32 += 1;
    return acc;
  }, {});

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
    updateElementText("singleEventTableTitle", eventData.length > 0
      ? `Raw Data for ${eventData[0].Event} on ${formatDate(eventData[0].Date)}`
      : "No Data Available");

    let rows = eventData.map(row => ({
      rank: row.Rank,
      player: row.Player,
      deck: row.Deck,
      wins: row.Wins,
      losses: row.Losses,
      winRate: (row.Wins + row.Losses) > 0 ? (row.Wins / (row.Wins + row.Losses)) * 100 : 0
    }));

    updateElementHTML("singleEventTableBody", rows.length === 0
      ? "<tr><td colspan='6'>No data available for the selected event.</td></tr>"
      : rows.map(row => `
        <tr>
          <td>${row.rank}</td>
          <td>${row.player}</td>
          <td>${row.deck}</td>
          <td>${row.wins}</td>
          <td>${row.losses}</td>
          <td>${row.winRate.toFixed(2)}%</td>
        </tr>
      `).join(""));

    const headers = tableHead.querySelectorAll('th[data-sort]');
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

        updateElementHTML("singleEventTableBody", rows.map(row => `
          <tr>
            <td>${row.rank}</td>
            <td>${row.player}</td>
            <td>${row.deck}</td>
            <td>${row.wins}</td>
            <td>${row.losses}</td>
            <td>${row.winRate.toFixed(2)}%</td>
          </tr>
        `).join(""));
      });
    });
  } else if (tableType === 'aggregate') {
    updateElementHTML("singleEventTableHead", `
      <tr>
        <th rowspan="2" data-sort="deck">Deck <span class="sort-arrow"></span></th>
        <th rowspan="2" data-sort="count">NumberOfPlayers <span class="sort-arrow"></span></th>
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
    updateElementText("singleEventTableTitle", eventData.length > 0
      ? `Aggregate Decks for ${eventData[0].Event} on ${formatDate(eventData[0].Date)}`
      : "No Data Available");

    let rows = Object.entries(deckStats).map(([deck, stats]) => ({
      deck,
      count: stats.count,
      metaShare: totalPlayers > 0 ? (stats.count / totalPlayers) * 100 : 0,
      winRate: (stats.wins + stats.losses) > 0 ? (stats.wins / (stats.wins + stats.losses)) * 100 : 0,
      top8: stats.top8,
      top16: stats.top16,
      top32: stats.top32,
      belowTop32: stats.belowTop32,
      top8Percent: stats.count > 0 ? (stats.top8 / stats.count) * 100 : 0,
      top16Percent: stats.count > 0 ? (stats.top16 / stats.count) * 100 : 0,
      top32Percent: stats.count > 0 ? (stats.top32 / stats.count) * 100 : 0,
      belowTop32Percent: stats.count > 0 ? (stats.belowTop32 / stats.count) * 100 : 0
    }));

    let displayMode = 'percent'; // Default to percent
    const renderTableBody = () => {
      updateElementHTML("singleEventTableBody", rows.length === 0
        ? "<tr><td colspan='8'>No data available for the selected event.</td></tr>"
        : rows.map(row => `
<tr>
        <td>${row.deck}</td>
        <td>${row.count}</td>
        <td>${row.metaShare.toFixed(1)}%</td>
        <td>${row.winRate.toFixed(1)}%</td>
        <td>${displayMode === 'raw' ? row.top8 : (row.top8 === 0 ? '--' : row.top8Percent.toFixed(1) + '%')}</td>
        <td>${displayMode === 'raw' ? row.top16 : (row.top16 === 0 ? '--' : row.top16Percent.toFixed(1) + '%')}</td>
        <td>${displayMode === 'raw' ? row.top32 : (row.top32 === 0 ? '--' : row.top32Percent.toFixed(1) + '%')}</td>
        <td>${displayMode === 'raw' ? row.belowTop32 : (row.belowTop32 === 0 ? '--' : row.belowTop32Percent.toFixed(1) + '%')}</td>
      </tr>
        `).join(""));
    };

    renderTableBody();

    const displayToggleButtons = tableHead.querySelectorAll('.display-toggle-btn');
    displayToggleButtons.forEach(button => {
      button.addEventListener('click', () => {
        displayToggleButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        displayMode = button.dataset.display;
        renderTableBody();
      });
    });

    const headers = tableHead.querySelectorAll('th[data-sort]');
    headers.forEach(header => {
      header.addEventListener('click', () => {
        const sortKey = header.dataset.sort;
        const isAscending = header.classList.contains('asc');
        headers.forEach(h => {
          h.classList.remove('asc', 'desc');
          h.querySelector('.sort-arrow').textContent = '';
        });

        rows.sort((a, b) => {
          const aVal = ['top8', 'top16', 'top32', 'belowTop32'].includes(sortKey) && displayMode === 'percent'
            ? a[sortKey + 'Percent']
            : a[sortKey];
          const bVal = ['top8', 'top16', 'top32', 'belowTop32'].includes(sortKey) && displayMode === 'percent'
            ? b[sortKey + 'Percent']
            : b[sortKey];
          const aSortVal = typeof aVal === 'string' ? aVal.toLowerCase() : aVal;
          const bSortVal = typeof bVal === 'string' ? bVal.toLowerCase() : bVal;
          return isAscending ? (aSortVal > bVal ? -1 : 1) : (aSortVal < bVal ? -1 : 1);
        });

        header.classList.add(isAscending ? 'desc' : 'asc');
        header.querySelector('.sort-arrow').textContent = isAscending ? '↓' : '↑';
        renderTableBody();
      });
    });
  }

  // Wire up table toggle buttons
  const toggleContainer = document.querySelector('.table-toggle');
  if (toggleContainer) {
    const toggleButtons = toggleContainer.querySelectorAll('.table-toggle-btn');
    toggleButtons.forEach(button => {
      button.addEventListener('click', () => {
        toggleButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        updateSingleEventTables(eventData, button.dataset.table);
      });
    });
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
    updateElementText("multiEventTableTitle", startDate && endDate
      ? `Data for ${uniqueEvents.length} Tournaments from ${formatDate(startDate)} to ${formatDate(endDate)}`
      : "Please Select a Date Range");

    const deckStats = filteredData.reduce((acc, row) => {
      acc[row.Deck] = acc[row.Deck] || { count: 0, wins: 0, losses: 0, top8: 0, top16: 0, top32: 0, belowTop32: 0 };
      acc[row.Deck].count += 1;
      acc[row.Deck].wins += row.Wins;
      acc[row.Deck].losses += row.Losses;
      if (row.Rank >= 1 && row.Rank <= 8) acc[row.Deck].top8 += 1;
      else if (row.Rank >= 9 && row.Rank <= 16) acc[row.Deck].top16 += 1;
      else if (row.Rank >= 17 && row.Rank <= 32) acc[row.Deck].top32 += 1;
      else if (row.Rank > 32) acc[row.Deck].belowTop32 += 1;
      return acc;
    }, {});

    const totalPlayers = filteredData.length;
    let deckRows = Object.entries(deckStats).map(([deck, stats]) => ({
      deck,
      metaShare: totalPlayers > 0 ? (stats.count / totalPlayers) * 100 : 0,
      winRate: (stats.wins + stats.losses) > 0 ? (stats.wins / (stats.wins + stats.losses)) * 100 : 0,
      top8: stats.top8,
      top16: stats.top16,
      top32: stats.top32,
      belowTop32: stats.belowTop32,
      top8Percent: stats.count > 0 ? (stats.top8 / stats.count) * 100 : 0,
      top16Percent: stats.count > 0 ? (stats.top16 / stats.count) * 100 : 0,
      top32Percent: stats.count > 0 ? (stats.top32 / stats.count) * 100 : 0,
      belowTop32Percent: stats.count > 0 ? (stats.belowTop32 / stats.count) * 100 : 0
    }));

    let displayMode = 'percent'; // Default to percent
    const renderTableBody = () => {
      updateElementHTML("multiEventTableBody", deckRows.length === 0
        ? "<tr><td colspan='7'>No data available for the selected filters.</td></tr>"
        : deckRows.map(row => `
          <tr>
            <td>${row.deck}</td>
            <td>${row.metaShare.toFixed(2)}%</td>
            <td>${row.winRate.toFixed(2)}%</td>
            <td>${displayMode === 'raw' ? row.top8 : (row.top8 === 0 ? '--' : row.top8Percent.toFixed(2) + '%')}</td>
            <td>${displayMode === 'raw' ? row.top16 : (row.top16 === 0 ? '--' : row.top16Percent.toFixed(2) + '%')}</td>
            <td>${displayMode === 'raw' ? row.top32 : (row.top32 === 0 ? '--' : row.top32Percent.toFixed(2) + '%')}</td>
            <td>${displayMode === 'raw' ? row.belowTop32 : (row.belowTop32 === 0 ? '--' : row.belowTop32Percent.toFixed(2) + '%')}</td>
          </tr>
        `).join(""));
    };

    renderTableBody();

    const displayToggleButtons = tableHead.querySelectorAll('.display-toggle-btn');
    displayToggleButtons.forEach(button => {
      button.addEventListener('click', () => {
        displayToggleButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        displayMode = button.dataset.display;
        renderTableBody();
      });
    });

    const headers = tableHead.querySelectorAll('th[data-sort]');
    headers.forEach(header => {
      header.addEventListener('click', () => {
        const sortKey = header.dataset.sort;
        const isAscending = header.classList.contains('asc');
        headers.forEach(h => {
          h.classList.remove('asc', 'desc');
          h.querySelector('.sort-arrow').textContent = '';
        });

        deckRows.sort((a, b) => {
          const aVal = ['top8', 'top16', 'top32', 'belowTop32'].includes(sortKey) && displayMode === 'percent'
            ? a[sortKey + 'Percent']
            : a[sortKey];
          const bVal = ['top8', 'top16', 'top32', 'belowTop32'].includes(sortKey) && displayMode === 'percent'
            ? b[sortKey + 'Percent']
            : b[sortKey];
          const aSortVal = typeof aVal === 'string' ? aVal.toLowerCase() : aVal;
          const bSortVal = typeof bVal === 'string' ? bVal.toLowerCase() : bVal;
          return isAscending ? (aSortVal > bVal ? -1 : 1) : (aSortVal < bVal ? -1 : 1);
        });

        header.classList.add(isAscending ? 'desc' : 'asc');
        header.querySelector('.sort-arrow').textContent = isAscending ? '↓' : '↑';
        renderTableBody();
      });
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
    updateElementText("multiEventTableTitle", startDate && endDate && deckName
      ? `Data for ${deckName} from ${formatDate(startDate)} to ${formatDate(endDate)}`
      : "Please Select a Date Range and Deck");

    const deckDataByDate = filteredData.reduce((acc, row) => {
      const date = row.Date;
      if (!acc[date]) {
        acc[date] = { 
          event: row.Event,
          deckCount: 0, 
          totalPlayers: 0, 
          wins: 0, 
          losses: 0, 
          top8: 0,
          top16: 0, 
          top32: 0, 
          belowTop32: 0, 
          winner: null,
          winnerDeck: null
        };
      }
      acc[date].totalPlayers += 1;
      if (row.Deck === deckName) {
        acc[date].deckCount += 1;
        acc[date].wins += row.Wins;
        acc[date].losses += row.Losses;
        if (row.Rank >= 1 && row.Rank <= 8) acc[date].top8 += 1;
        else if (row.Rank >= 9 && row.Rank <= 16) acc[date].top16 += 1;
        else if (row.Rank >= 17 && row.Rank <= 32) acc[date].top32 += 1;
        else if (row.Rank > 32) acc[date].belowTop32 += 1;
      }
      if (row.Rank === 1) {
        acc[date].winner = row.Player;
        acc[date].winnerDeck = row.Deck;
      }
      return acc;
    }, {});

    let deckRows = Object.entries(deckDataByDate).map(([date, stats]) => ({
      date,
      event: stats.event,
      metaShare: stats.totalPlayers > 0 ? (stats.deckCount / stats.totalPlayers) * 100 : 0,
      winRate: (stats.wins + stats.losses) > 0 ? (stats.wins / (stats.wins + stats.losses)) * 100 : 0,
      top8: stats.top8,
      top16: stats.top16,
      top32: stats.top32,
      belowTop32: stats.belowTop32,
      top8Percent: stats.deckCount > 0 ? (stats.top8 / stats.deckCount) * 100 : 0,
      top16Percent: stats.deckCount > 0 ? (stats.top16 / stats.deckCount) * 100 : 0,
      top32Percent: stats.deckCount > 0 ? (stats.top32 / stats.deckCount) * 100 : 0,
      belowTop32Percent: stats.deckCount > 0 ? (stats.belowTop32 / stats.deckCount) * 100 : 0,
      totalPlayers: stats.totalPlayers,
      winner: stats.winner || "--",
      winnerDeck: stats.winnerDeck || "--"
    }));

    let displayMode = 'percent'; // Default to percent
    const renderTableBody = () => {
      updateElementHTML("multiEventTableBody", deckRows.length === 0
        ? "<tr><td colspan='8'>No data available for the selected deck and filters.</td></tr>"
        : deckRows.map(row => `
          <tr>
            <td>${formatDate(row.date)}</td>
            <td class="event-tooltip" data-tooltip="${row.event} had ${row.totalPlayers} Players, won by ${row.winner} w/ ${row.winnerDeck}">${row.event}</td>
            <td>${row.metaShare.toFixed(2)}%</td>
            <td>${row.winRate.toFixed(2)}%</td>
            <td>${displayMode === 'raw' ? row.top8 : (row.top8 === 0 ? '--' : row.top8Percent.toFixed(2) + '%')}</td>
            <td>${displayMode === 'raw' ? row.top16 : (row.top16 === 0 ? '--' : row.top16Percent.toFixed(2) + '%')}</td>
            <td>${displayMode === 'raw' ? row.top32 : (row.top32 === 0 ? '--' : row.top32Percent.toFixed(2) + '%')}</td>
            <td>${displayMode === 'raw' ? row.belowTop32 : (row.belowTop32 === 0 ? '--' : row.belowTop32Percent.toFixed(2) + '%')}</td>
          </tr>
        `).join(""));
    };

    renderTableBody();

    const displayToggleButtons = tableHead.querySelectorAll('.display-toggle-btn');
    displayToggleButtons.forEach(button => {
      button.addEventListener('click', () => {
        displayToggleButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        displayMode = button.dataset.display;
        renderTableBody();
      });
    });

    const headers = tableHead.querySelectorAll('th[data-sort]');
    headers.forEach(header => {
      header.addEventListener('click', () => {
        const sortKey = header.dataset.sort;
        const isAscending = header.classList.contains('asc');
        headers.forEach(h => {
          h.classList.remove('asc', 'desc');
          h.querySelector('.sort-arrow').textContent = '';
        });

        deckRows.sort((a, b) => {
          const aVal = ['top8', 'top16', 'top32', 'belowTop32'].includes(sortKey) && displayMode === 'percent'
            ? a[sortKey + 'Percent']
            : a[sortKey];
          const bVal = ['top8', 'top16', 'top32', 'belowTop32'].includes(sortKey) && displayMode === 'percent'
            ? b[sortKey + 'Percent']
            : b[sortKey];
          const aSortVal = typeof aVal === 'string' ? aVal.toLowerCase() : aVal;
          const bSortVal = typeof bVal === 'string' ? bVal.toLowerCase() : bVal;
          return isAscending ? (aSortVal > bVal ? -1 : 1) : (aSortVal < bVal ? -1 : 1);
        });

        header.classList.add(isAscending ? 'desc' : 'asc');
        header.querySelector('.sort-arrow').textContent = isAscending ? '↓' : '↑';
        renderTableBody();
      });
    });
  }
}

export function populateSingleEventStats(filteredData) {
  
  toggleStatCardVisibility("singleEventInfoCard", true);
  updateElementText("eventInfoName", filteredData.length > 0 ? filteredData[0].Event : "No Event Selected"); // New element for event name
  updateElementText("eventInfoDate", filteredData.length > 0 ? formatDate(filteredData[0].Date) : "No Data");
  updateElementText("eventInfoPlayers", filteredData.length > 0 ? `${filteredData.length} Players` : "--");

  toggleStatCardVisibility("singleTopPlayerCard", true);
  const topPlayer = filteredData.find(row => row.Rank === 1);
  updateElementText("singleTopPlayer", topPlayer?.Player || "No Data");
  updateElementText("singleTopPlayerDetails", topPlayer ? `${topPlayer.Deck} / ${(topPlayer["Win Rate"] * 100).toFixed(1)}% Win Rate` : "-- / --");

  toggleStatCardVisibility("singleRunnerUpCard", true);
  const runnerUp = filteredData.find(row => row.Rank === 2);
  updateElementText("singleRunnerUp", runnerUp?.Player || "No Data");
  updateElementText("singleRunnerUpDetails", runnerUp ? `${runnerUp.Deck} / ${(runnerUp["Win Rate"] * 100).toFixed(1)}% Win Rate` : "-- / --");

  toggleStatCardVisibility("singleTopDecksCard", true);
  const totalPlayers = filteredData.length;
  updateElementHTML("singleTopDecksDetails", filteredData.length === 0 ? "No Data" : Object.entries(calculateTopDecks(filteredData))
    .map(([range, deck]) => deck ? `<div><span class="label">${range}:</span> <span class="value">${deck} (${formatPercentage(calculateDeckStats(filteredData, deck, totalPlayers).winRate)} WR / ${formatPercentage(calculateDeckStats(filteredData, deck, totalPlayers).metaShare)} Meta)</span></div>` : "")
    .filter(Boolean)
    .join("") || "No Data");

  toggleStatCardVisibility("singleMostCopiesCard", true);
  const deckCounts = filteredData.reduce((acc, row) => { acc[row.Deck] = (acc[row.Deck] || 0) + 1; return acc; }, {});
  const mostCopiesDeck = filteredData.length > 0 ? Object.keys(deckCounts).reduce((a, b) => deckCounts[a] > deckCounts[b] ? a : b, null) : "No Data";
  updateElementText("singleMostCopiesDeck", mostCopiesDeck);
  updateElementText("singleMostCopiesDetails", mostCopiesDeck === "No Data" ? "--" : `${deckCounts[mostCopiesDeck]} Copies`);
}

export function populateMultiEventStats(filteredData) {
  const uniqueEvents = [...new Set(filteredData.map(row => row.Event))];
  updateElementText("totalEvents", uniqueEvents.length);

  const startDateStr = document.getElementById("startDateSelect")?.value;
  const endDateStr = document.getElementById("endDateSelect")?.value;
  const card = document.getElementById("multiTotalEventsCard");
  if (card) {
    const statChange = card.querySelector('.stat-change');
    if (statChange) statChange.textContent = formatDateRange(startDateStr, endDateStr);
  }

  const eventPlayerCounts = uniqueEvents.map(event => ({
    event,
    count: filteredData.filter(row => row.Event === event).length
  }));
  const mostPlayersEvent = eventPlayerCounts.length > 0 ? eventPlayerCounts.reduce((a, b) => a.count > b.count ? a : b) : { event: "--", count: 0 };
  const leastPlayersEvent = eventPlayerCounts.length > 0 ? eventPlayerCounts.reduce((a, b) => a.count < b.count ? a : b) : { event: "--", count: 0 };
  updateElementText("mostPlayersEvent", mostPlayersEvent.event);
  updateElementText("mostPlayersCount", `${mostPlayersEvent.count} Players`);
  updateElementText("leastPlayersEvent", leastPlayersEvent.event);
  updateElementText("leastPlayersCount", `${leastPlayersEvent.count} Players`);

  const totalPlayers = filteredData.length;
  updateElementHTML("multiTopDecksDetails", Object.entries(calculateTopDecks(filteredData))
    .map(([range, deck]) => deck ? `<div><span class="label">${range}:</span> <span class="value">${deck} (${formatPercentage(calculateDeckStats(filteredData, deck, totalPlayers).winRate)} WR / ${formatPercentage(calculateDeckStats(filteredData, deck, totalPlayers).metaShare)} Meta)</span></div>` : "")
    .filter(Boolean)
    .join("") || "--");

  const deckCounts = filteredData.reduce((acc, row) => { acc[row.Deck] = (acc[row.Deck] || 0) + 1; return acc; }, {});
  const mostCopiesDeck = Object.keys(deckCounts).reduce((a, b) => deckCounts[a] > deckCounts[b] ? a : b, "--");
  updateElementText("multiMostCopiesDeck", mostCopiesDeck);
  updateElementText("multiMostCopiesDetails", mostCopiesDeck === "--" ? "0 Copies" : `${deckCounts[mostCopiesDeck]} Copies`);
}