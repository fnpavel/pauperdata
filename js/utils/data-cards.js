// js/utils/data-cards.js

export function calculateTopDecks(data) {
  return {
    "Top 8": [...new Set(data.filter(row => row.Rank >= 1 && row.Rank <= 8).map(row => row.Deck))],
    "Top 16": [...new Set(data.filter(row => row.Rank >= 9 && row.Rank <= 16).map(row => row.Deck))],
    "Top 32": [...new Set(data.filter(row => row.Rank >= 17 && row.Rank <= 32).map(row => row.Deck))],
    "Below Top 32": [...new Set(data.filter(row => row.Rank > 32).map(row => row.Deck))]
  };
}

// Single Event Stat Card
export function calculateDeckStats(data, deck, totalPlayers) {
  const deckData = data.filter(row => row.Deck === deck);
  const wins = deckData.reduce((sum, r) => sum + r.Wins, 0);
  const losses = deckData.reduce((sum, r) => sum + r.Losses, 0);
  return {
    winRate: (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0,
    metaShare: totalPlayers > 0 ? (deckData.length / totalPlayers) * 100 : 0
  };
}

// Single Event Stat Cards
export function calculateSingleEventStats(filteredData) {
  const totalPlayers = filteredData.length;
  const topPlayer = filteredData.find(row => row.Rank === 1);
  const runnerUp = filteredData.find(row => row.Rank === 2);
  const deckCounts = filteredData.reduce((acc, row) => {
    if (row.Deck !== "UNKNOWN" && row.Deck !== "No Show") {
      acc[row.Deck] = (acc[row.Deck] || 0) + 1;
    }
    return acc;
  }, {});
  const maxCopies = Math.max(...Object.values(deckCounts), 0);
  const mostCopiesDecks = Object.entries(deckCounts)
    .filter(([_, count]) => count === maxCopies)
    .map(([deck]) => deck);
  const topDecks = calculateTopDecks(filteredData);
  const deckCountsByRange = {
    "Top 8": filteredData.filter(row => row.Rank >= 1 && row.Rank <= 8).reduce((acc, row) => {
      if (row.Deck !== "UNKNOWN" && row.Deck !== "No Show") acc[row.Deck] = (acc[row.Deck] || 0) + 1;
      return acc;
    }, {}),
    "Top 16": filteredData.filter(row => row.Rank >= 9 && row.Rank <= 16).reduce((acc, row) => {
      if (row.Deck !== "UNKNOWN" && row.Deck !== "No Show") acc[row.Deck] = (acc[row.Deck] || 0) + 1;
      return acc;
    }, {}),
    "Top 32": filteredData.filter(row => row.Rank >= 17 && row.Rank <= 32).reduce((acc, row) => {
      if (row.Deck !== "UNKNOWN" && row.Deck !== "No Show") acc[row.Deck] = (acc[row.Deck] || 0) + 1;
      return acc;
    }, {}),
    "Below Top 32": filteredData.filter(row => row.Rank > 32).reduce((acc, row) => {
      if (row.Deck !== "UNKNOWN" && row.Deck !== "No Show") acc[row.Deck] = (acc[row.Deck] || 0) + 1;
      return acc;
    }, {})
  };

  return {
    eventName: filteredData.length > 0 ? filteredData[0].Event : "No Event Selected",
    eventDate: filteredData.length > 0 ? filteredData[0].Date : "No Data",
    totalPlayers: totalPlayers > 0 ? `${totalPlayers} Players` : "--",
    topPlayer: topPlayer?.Player || "No Data",
    topPlayerDetails: topPlayer ? `${topPlayer.Deck} / ${(topPlayer["Win Rate"] * 100).toFixed(1)}% Win Rate` : "-- / --",
    runnerUp: runnerUp?.Player || "No Data",
    runnerUpDetails: runnerUp ? `${runnerUp.Deck} / ${(runnerUp["Win Rate"] * 100).toFixed(1)}% Win Rate` : "-- / --",
    mostCopiesDeck: totalPlayers > 0 && mostCopiesDecks.length > 0 ? mostCopiesDecks.join(", ") : "No Data",
    mostCopiesDetails: totalPlayers > 0 && maxCopies > 0 ? `${maxCopies} Copies` : "--",
    topDecks,
    deckCountsByRange
  };
}

// Multi-Event Stat Cards
export function calculateMultiEventStats(filteredData) {
  const uniqueEvents = [...new Set(filteredData.map(row => row.Event))];
  const eventPlayerCounts = uniqueEvents.map(event => ({
    event,
    count: filteredData.filter(row => row.Event === event).length
  }));
  const mostPlayersEvent = eventPlayerCounts.length > 0 ? eventPlayerCounts.reduce((a, b) => a.count > b.count ? a : b) : { event: "--", count: 0 };
  const leastPlayersEvent = eventPlayerCounts.length > 0 ? eventPlayerCounts.reduce((a, b) => a.count < b.count ? a : b) : { event: "--", count: 0 };
  const deckCounts = filteredData.reduce((acc, row) => {
    if (row.Deck !== "UNKNOWN" && row.Deck !== "No Show") acc[row.Deck] = (acc[row.Deck] || 0) + 1;
    return acc;
  }, {});
  const maxCopies = Math.max(...Object.values(deckCounts), 0);
  const mostCopiesDecks = Object.entries(deckCounts)
    .filter(([_, count]) => count === maxCopies)
    .map(([deck]) => deck);
  const topDecks = calculateTopDecks(filteredData);
  const deckCountsByRange = {
    "Top 8": filteredData.filter(row => row.Rank >= 1 && row.Rank <= 8).reduce((acc, row) => {
      if (row.Deck !== "UNKNOWN" && row.Deck !== "No Show") acc[row.Deck] = (acc[row.Deck] || 0) + 1;
      return acc;
    }, {}),
    "Top 16": filteredData.filter(row => row.Rank >= 9 && row.Rank <= 16).reduce((acc, row) => {
      if (row.Deck !== "UNKNOWN" && row.Deck !== "No Show") acc[row.Deck] = (acc[row.Deck] || 0) + 1;
      return acc;
    }, {}),
    "Top 32": filteredData.filter(row => row.Rank >= 17 && row.Rank <= 32).reduce((acc, row) => {
      if (row.Deck !== "UNKNOWN" && row.Deck !== "No Show") acc[row.Deck] = (acc[row.Deck] || 0) + 1;
      return acc;
    }, {}),
    "Below Top 32": filteredData.filter(row => row.Rank > 32).reduce((acc, row) => {
      if (row.Deck !== "UNKNOWN" && row.Deck !== "No Show") acc[row.Deck] = (acc[row.Deck] || 0) + 1;
      return acc;
    }, {})
  };

  return {
    totalEvents: uniqueEvents.length,
    mostPlayersEvent: mostPlayersEvent.event,
    mostPlayersCount: `${mostPlayersEvent.count} Players`,
    leastPlayersEvent: leastPlayersEvent.event,
    leastPlayersCount: `${leastPlayersEvent.count} Players`,
    mostCopiesDeck: mostCopiesDecks.length > 0 ? mostCopiesDecks.join(", ") : "--",
    mostCopiesDetails: maxCopies > 0 ? `${maxCopies} Copies` : "0 Copies",
    topDecks,
    deckCountsByRange
  };
}

// Player Stat Cards
export function calculatePlayerStats(data) {
  const totalEvents = data.length > 0 ? [...new Set(data.map(row => row.Event))].length : 0;

  if (!data || data.length === 0) {
    return {
      totalEvents: "N/A",
      eventsDetails: "",
      uniqueDecks: "N/A",
      mostPlayedDecks: "N/A",
      mostPlayedCount: "",
      leastPlayedDecks: "N/A",
      leastPlayedCount: "",
      rankStats: {
        top1_8: "--",
        top9_16: "--",
        top17_32: "--",
        top33Plus: "--",
        top1_8Percent: "--",
        top9_16Percent: "--",
        top17_32Percent: "--",
        top33PlusPercent: "--"
      },
      overallWinRate: "--",
      bestDeckTitle: "Best Performing Deck",
      bestDecks: { name: "--", events: "--", winRate: "--", bestWinRate: "--", worstWinRate: "--" },
      worstDeckTitle: "Worst Performing Deck",
      worstDecks: { name: "--", events: "--", winRate: "--", bestWinRate: "--", worstWinRate: "--" },
      mostPlayedDeckTitle: "Most Played Deck",
      mostPlayedDecksData: { name: "--", events: "0", winRate: "0%", bestWinRate: "-- (Event: --)", worstWinRate: "-- (Event: --)" },
      leastPlayedDeckTitle: "Least Played Deck",
      leastPlayedDecksData: { name: "--", events: "0", winRate: "0%", bestWinRate: "-- (Event: --)", worstWinRate: "-- (Event: --)" },
      eventHistoryHTML: "<div>No events selected</div>"
    };
  }

  // Total Events
  const dates = data.map(row => new Date(row.Date));
  const minDate = new Date(Math.min(...dates));
  const maxDate = new Date(Math.max(...dates));
  const monthsSpan = (maxDate.getFullYear() - minDate.getFullYear()) * 12 + (maxDate.getMonth() - minDate.getMonth()) + 1;
  const years = [...new Set(dates.map(date => date.getFullYear()))].sort().join(", ");
  const eventsDetails = monthsSpan > 1 ? `${monthsSpan} Months (Years ${years})` : "Single Event";

  // Filter out "No Show" decks
  const filteredDataNoShow = data.filter(row => row.Deck !== "No Show");

  // Unique Decks
  const uniqueDecks = [...new Set(filteredDataNoShow.map(row => row.Deck))].length || "N/A";

  // Most and Least Played Decks (simple cards)
  const deckCounts = filteredDataNoShow.reduce((acc, row) => {
    acc[row.Deck] = (acc[row.Deck] || 0) + 1;
    return acc;
  }, {});
  const deckEntries = Object.entries(deckCounts);
  const maxCount = deckEntries.length > 0 ? Math.max(...deckEntries.map(([_, count]) => count)) : 0;
  const mostPlayedDecks = deckEntries.length > 0 ? deckEntries.filter(([_, count]) => count === maxCount).map(([deck]) => deck) : [];
  const mostPlayedDecksStr = mostPlayedDecks.length > 0 ? mostPlayedDecks.join(", ") : "--";
  const mostPlayedCount = maxCount > 0 ? `${maxCount}x` : "";
  const minCount = deckEntries.length > 0 ? Math.min(...deckEntries.map(([_, count]) => count)) : 0;
  const leastPlayedDecks = deckEntries.length > 0 ? deckEntries.filter(([_, count]) => count === minCount).map(([deck]) => deck) : [];
  const leastPlayedDecksStr = leastPlayedDecks.length > 0 ? leastPlayedDecks.join(", ") : "--";
  const leastPlayedCount = minCount > 0 ? `${minCount}x` : "";

  // Rank Stats
  const rankStats = { top1_8: 0, top9_16: 0, top17_32: 0, top33Plus: 0 };
  data.forEach(row => {
    if (row.Rank >= 1 && row.Rank <= 8) rankStats.top1_8 += 1;
    else if (row.Rank >= 9 && row.Rank <= 16) rankStats.top9_16 += 1;
    else if (row.Rank >= 17 && row.Rank <= 32) rankStats.top17_32 += 1;
    else rankStats.top33Plus += 1;
  });
  const conversion = (count) => totalEvents === 0 ? "--" : `${((count / totalEvents) * 100).toFixed(0)}%`;
  const rankStatsFormatted = {
    top1_8: rankStats.top1_8 || "--",
    top9_16: rankStats.top9_16 || "--",
    top17_32: rankStats.top17_32 || "--",
    top33Plus: rankStats.top33Plus || "--",
    top1_8Percent: conversion(rankStats.top1_8),
    top9_16Percent: conversion(rankStats.top9_16),
    top17_32Percent: conversion(rankStats.top17_32),
    top33PlusPercent: conversion(rankStats.top33Plus)
  };

  // Deck Performance
  const deckStats = filteredDataNoShow.reduce((acc, row) => {
    if (!acc[row.Deck]) {
      acc[row.Deck] = { wins: 0, losses: 0, events: new Set(), eventWinRates: [] };
    }
    acc[row.Deck].wins += row.Wins || 0;
    acc[row.Deck].losses += row.Losses || 0;
    acc[row.Deck].events.add(row.Event);
    const winRate = (row.Wins + row.Losses) > 0 ? (row.Wins / (row.Wins + row.Losses)) * 100 : 0;
    acc[row.Deck].eventWinRates.push({ winRate, event: row.Event });
    return acc;
  }, {});

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

  const validDecks = deckPerformance.filter(deck => deck.wins + deck.losses > 0);
  const bestWinRate = validDecks.length > 0 ? Math.max(...validDecks.map(deck => deck.overallWinRate)) : null;
  const bestDecks = bestWinRate !== null ? validDecks.filter(deck => deck.overallWinRate === bestWinRate) : [];
  const worstWinRate = validDecks.length > 0 ? Math.min(...validDecks.map(deck => deck.overallWinRate)) : null;
  const worstDecks = worstWinRate !== null ? validDecks.filter(deck => deck.overallWinRate === worstWinRate) : [];
  const mostPlayedDeckEntries = mostPlayedDecks.length > 0 ? deckPerformance.filter(deck => mostPlayedDecks.includes(deck.deck)) : [];
  const leastPlayedDeckEntries = leastPlayedDecks.length > 0 ? deckPerformance.filter(deck => leastPlayedDecks.includes(deck.deck)) : [];

  // Overall Win Rate
  const totalWins = filteredDataNoShow.reduce((sum, row) => sum + (row.Wins || 0), 0);
  const totalLosses = filteredDataNoShow.reduce((sum, row) => sum + (row.Losses || 0), 0);
  const overallWinRate = (totalWins + totalLosses) > 0 ? `${((totalWins / (totalWins + totalLosses)) * 100).toFixed(2)}%` : "--";

  // Deck Titles and Data
  const bestDeckTitle = bestDecks.length > 1 ? "Best (Tied) Performing Deck" : "Best Performing Deck";
  const bestDecksData = bestDecks.length > 0 ? {
    name: bestDecks.map(deck => deck.deck).join(", "),
    events: bestDecks[0].eventCount.toString(),
    winRate: `${bestDecks[0].overallWinRate.toFixed(2)}%`,
    bestWinRate: bestDecks.map(deck => `${deck.bestEventData.winRate.toFixed(2)}% (${deck.bestEventData.event})`).join(", "),
    worstWinRate: bestDecks.map(deck => `${deck.worstEventData.winRate.toFixed(2)}% (${deck.worstEventData.event})`).join(", ")
  } : { name: "--", events: "--", winRate: "--", bestWinRate: "--", worstWinRate: "--" };

  const worstDeckTitle = worstDecks.length > 1 ? "Worst (Tied) Performing Deck" : "Worst Performing Deck";
  const worstDecksData = worstDecks.length > 0 ? {
    name: worstDecks.map(deck => deck.deck).join(", "),
    events: worstDecks[0].eventCount.toString(),
    winRate: `${worstDecks[0].overallWinRate.toFixed(2)}%`,
    bestWinRate: worstDecks.map(deck => `${deck.bestEventData.winRate.toFixed(2)}% (${deck.bestEventData.event})`).join(", "),
    worstWinRate: worstDecks.map(deck => `${deck.worstEventData.winRate.toFixed(2)}% (${deck.worstEventData.event})`).join(", ")
  } : { name: "--", events: "--", winRate: "--", bestWinRate: "--", worstWinRate: "--" };

  const mostPlayedDeckTitle = mostPlayedDeckEntries.length > 1 ? "Most (Tied) Played Deck" : "Most Played Deck";
  const mostPlayedDecksData = mostPlayedDeckEntries.length > 0 ? {
    name: mostPlayedDeckEntries.map(deck => deck.deck).join(", "),
    events: mostPlayedDeckEntries[0].eventCount.toString(),
    winRate: mostPlayedDeckEntries.length === 1 
      ? `${mostPlayedDeckEntries[0].overallWinRate.toFixed(2)}%`
      : mostPlayedDeckEntries.map(deck => `${deck.overallWinRate.toFixed(2)}%`).join(", "),
    bestWinRate: mostPlayedDeckEntries.map(deck => `${deck.bestEventData.winRate.toFixed(2)}% (${deck.bestEventData.event})`).join(", "),
    worstWinRate: mostPlayedDeckEntries.map(deck => `${deck.worstEventData.winRate.toFixed(2)}% (${deck.worstEventData.event})`).join(", ")
  } : { name: "--", events: "0", winRate: "0%", bestWinRate: "-- (Event: --)", worstWinRate: "-- (Event: --)" };

  const leastPlayedDeckTitle = leastPlayedDeckEntries.length > 1 ? "Least (Tied) Played Deck" : "Least Played Deck";
  const leastPlayedDecksData = leastPlayedDeckEntries.length > 0 ? {
    name: leastPlayedDeckEntries.map(deck => deck.deck).join(", "),
    events: leastPlayedDeckEntries[0].eventCount.toString(),
    winRate: leastPlayedDeckEntries.length === 1 
      ? `${leastPlayedDeckEntries[0].overallWinRate.toFixed(2)}%`
      : leastPlayedDeckEntries.map(deck => `${deck.overallWinRate.toFixed(2)}%`).join(", "),
    bestWinRate: leastPlayedDeckEntries.map(deck => `${deck.bestEventData.winRate.toFixed(2)}% (${deck.bestEventData.event})`).join(", "),
    worstWinRate: leastPlayedDeckEntries.map(deck => `${deck.worstEventData.winRate.toFixed(2)}% (${deck.worstEventData.event})`).join(", ")
  } : { name: "--", events: "0", winRate: "0%", bestWinRate: "-- (Event: --)", worstWinRate: "-- (Event: --)" };

  // Event History with Rank
  const eventHistoryHTML = !data || data.length === 0 ? "<div>No events selected</div>" : (() => {
    const eventsByDate = data.reduce((acc, row) => {
      if (!acc[row.Date]) acc[row.Date] = [];
      acc[row.Date].push({ event: row.Event, deck: row.Deck, rank: row.Rank });
      return acc;
    }, {});
    const sortedDates = Object.keys(eventsByDate).sort();
    return sortedDates.map(date => {
      const eventDeckPairs = eventsByDate[date].map(item => `${item.event} (${item.deck}, Rank: ${item.rank})`);
      return `<div><span class="label">${date}:</span> <span class="value">${eventDeckPairs.join(", ")}</span></div>`;
    }).join("");
  })();

  return {
    totalEvents: totalEvents.toString(),
    eventsDetails,
    uniqueDecks,
    mostPlayedDecks: mostPlayedDecksStr,
    mostPlayedCount,
    leastPlayedDecks: leastPlayedDecksStr,
    leastPlayedCount,
    rankStats: rankStatsFormatted,
    overallWinRate,
    bestDeckTitle,
    bestDecks: bestDecksData,
    worstDeckTitle,
    worstDecks: worstDecksData,
    mostPlayedDeckTitle,
    mostPlayedDecksData,
    leastPlayedDeckTitle,
    leastPlayedDecksData,
    eventHistoryHTML
  };
}