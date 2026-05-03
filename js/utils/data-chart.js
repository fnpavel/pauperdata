// Pure data transforms for Chart.js views. These helpers accept already-filtered
// rows and return display-ready arrays/objects without touching the DOM.

// Event Analysis -> Single Event: Event Top 8/16/32 Conversion.
// Returns stacked percentage bands per deck for the conversion funnel.
export function calculateDeckConversionStats(data) {
  // UNKNOWN rows represent incomplete deck data; charts omit them so percentages
  // reflect known archetypes only.
  const filteredData = data.filter(row => row.Deck.toUpperCase() !== "UNKNOWN");
  
  const deckConversionStats = filteredData.reduce((acc, row) => {
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

  const topDecks = [...new Set(filteredData.map(row => row.Deck))];
  const percentages = topDecks.map(deck => {
    const stats = deckConversionStats[deck] || { total: 0, rank1_8: 0, rank9_16: 0, rank17_32: 0, rank33_worse: 0 };
    const total = stats.total;
    return {
      deck,
      total,
      counts: {
        rank1_8: stats.rank1_8,
        rank9_16: stats.rank9_16,
        rank17_32: stats.rank17_32,
        rank33_worse: stats.rank33_worse
      },
      rank1_8: total > 0 ? (stats.rank1_8 / total) * 100 : 0,
      rank9_16: total > 0 ? (stats.rank9_16 / total) * 100 : 0,
      rank17_32: total > 0 ? (stats.rank17_32 / total) * 100 : 0,
      rank33_worse: total > 0 ? (stats.rank33_worse / total) * 100 : 0
    };
  });

  return percentages
    .sort((a, b) => b.rank1_8 - a.rank1_8 || a.deck.localeCompare(b.deck))
    .map(item => ({
      deck: item.deck,
      total: item.total,
      counts: item.counts,
      data: [item.rank1_8, item.rank9_16, item.rank17_32, item.rank33_worse]
    }));
}

// Single and Multiple Events: deck meta share plus aggregate match win rate.
// Returns one point/bar record per known deck with meta share and win rate.
export function calculateMetaWinRateStats(data) {
  const filteredData = data.filter(row => row.Deck.toUpperCase() !== "UNKNOWN");
  const totalPlayers = filteredData.length;
  
  const deckStats = filteredData.reduce((acc, row) => {
    if (!acc[row.Deck]) {
      acc[row.Deck] = { count: 0, wins: 0, losses: 0 };
    }
    acc[row.Deck].count += 1;
    acc[row.Deck].wins += row.Wins;
    acc[row.Deck].losses += row.Losses;
    return acc;
  }, {});

  const decks = Object.keys(deckStats);
  return decks.map(deck => ({
    deck,
    meta: (deckStats[deck].count / totalPlayers) * 100,
    winRate: (deckStats[deck].wins + deckStats[deck].losses) > 0
      ? (deckStats[deck].wins / (deckStats[deck].wins + deckStats[deck].losses)) * 100
      : 0,
    count: deckStats[deck].count
  }));
}

// Event Analysis -> Multiple Events: selected deck meta share and win rate over time.
// Returns date-aligned series for the selected deck's copies and match results.
export function calculateDeckEvolutionStats(data, selectedDeck) {
  const filteredData = data.filter(row => row.Deck.toUpperCase() !== "UNKNOWN");
  
  const deckDataByDate = filteredData.reduce((acc, row) => {
    if (row.Deck === selectedDeck) {
      const date = row.Date;
      if (!acc[date]) acc[date] = { wins: 0, losses: 0, count: 0, totalPlayers: 0 };
      acc[date].wins += row.Wins;
      acc[date].losses += row.Losses;
      acc[date].count += 1;
    }
    acc[row.Date] = acc[row.Date] || { wins: 0, losses: 0, count: 0, totalPlayers: 0 };
    acc[row.Date].totalPlayers += 1;
    return acc;
  }, {});

  const validDates = Object.keys(deckDataByDate)
    .filter(date => deckDataByDate[date].count > 0)
    .sort((a, b) => new Date(a) - new Date(b));

  return {
    dates: validDates,
    metaShares: validDates.map(date => (deckDataByDate[date].count / (deckDataByDate[date].totalPlayers || 1)) * 100),
    winRates: validDates.map(date => {
      const { wins, losses } = deckDataByDate[date];
      return (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;
    })
  };
}

// Event Analysis -> Multiple Events: aggregate player win rates used by multi-player-win-rate.js.
// Returns one aggregate record per player for multi-event scatter plotting.
export function calculateMultiPlayerWinRateStats(data) {
  const playerStats = data.reduce((acc, row) => {
    if (!acc[row.Player]) {
      acc[row.Player] = { totalWinRate: 0, eventCount: 0, events: new Set() };
    }
    acc[row.Player].totalWinRate += row["Win Rate"] * 100;
    acc[row.Player].events.add(row.Event);
    return acc;
  }, {});

  return Object.entries(playerStats)
    .map(([player, stats]) => {
      stats.eventCount = stats.events.size;
      const avgWinRate = stats.eventCount > 0 ? stats.totalWinRate / stats.eventCount : 0;
      return { player, avgWinRate, eventCount: stats.eventCount };
    });
}

// Player Analysis: deck performance scatter plot used by player-deck-performance.js.
// Returns one aggregate record per deck for the selected player.
export function calculatePlayerDeckPerformanceStats(data) {
  const filteredData = data.filter(row => row.Deck.toUpperCase() !== "UNKNOWN");
  
  const deckStats = filteredData.reduce((acc, row) => {
    if (!acc[row.Deck]) {
      acc[row.Deck] = {
        events: new Set(),
        wins: 0,
        losses: 0
      };
    }
    acc[row.Deck].events.add(row.Event);
    acc[row.Deck].wins += row.Wins || 0;
    acc[row.Deck].losses += row.Losses || 0;
    return acc;
  }, {});

  return Object.keys(deckStats).map(deck => {
    const stats = deckStats[deck];
    const totalGames = stats.wins + stats.losses;
    const winRate = totalGames > 0 ? (stats.wins / totalGames) * 100 : 0;
    return {
      deck,
      eventCount: stats.events.size,
      winRate,
      wins: stats.wins,
      losses: stats.losses
    };
  });
}

// Player Analysis: chronological player event points used by player-win-rate.js.
// Returns date-ordered win-rate points and hover metadata for one player.
export function calculatePlayerWinRateStats(data) {
  const filteredData = data.filter(row => row.Deck.toUpperCase() !== "UNKNOWN");
  
  const eventStats = filteredData.reduce((acc, row) => {
    if (!acc[row.Event]) {
      acc[row.Event] = {
        event: row.Event,
        date: row.Date,
        wins: 0,
        losses: 0,
        deck: row.Deck,
        rank: Number(row.Rank)
      };
    }
    acc[row.Event].wins += Number(row.Wins) || 0;
    acc[row.Event].losses += Number(row.Losses) || 0;
    return acc;
  }, {});

  const pointDetails = Object.values(eventStats)
    .map(stats => ({
      event: stats.event,
      date: stats.date,
      deck: stats.deck || "N/A",
      wins: stats.wins,
      losses: stats.losses,
      rank: Number.isFinite(stats.rank) ? stats.rank : null,
      winRate: (stats.wins + stats.losses) > 0 ? (stats.wins / (stats.wins + stats.losses)) * 100 : 0
    }))
    .sort((a, b) => {
      const dateComparison = String(a.date || '').localeCompare(String(b.date || ''));
      if (dateComparison !== 0) {
        return dateComparison;
      }

      return String(a.event || '').localeCompare(String(b.event || ''));
    });

  const dates = pointDetails.map(point => point.date);
  const eventByDate = {};
  pointDetails.forEach(point => {
    eventByDate[point.date] = point.event;
  });

  return {
    dates,
    winRates: pointDetails.map(point => point.winRate),
    decks: pointDetails.map(point => point.deck),
    eventByDate,
    pointDetails
  };
}
