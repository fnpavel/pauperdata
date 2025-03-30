// js/utils/data-chart.js

// function for funnel chart deck conversion stats
export function calculateDeckConversionStats(data) {
  const deckConversionStats = data.reduce((acc, row) => {
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

  const topDecks = [...new Set(data.map(row => row.Deck))];
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

  return percentages
    .sort((a, b) => b.rank1_8 - a.rank1_8 || a.deck.localeCompare(b.deck))
    .map(item => ({
      deck: item.deck,
      data: [item.rank1_8, item.rank9_16, item.rank17_32, item.rank33_worse]
    }));
}

// function for meta win rate chart deck stats
export function calculateMetaWinRateStats(data) {
  const totalPlayers = data.length;
  const deckStats = data.reduce((acc, row) => {
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

// function for deck evolution chart
export function calculateDeckEvolutionStats(data, selectedDeck) {
  const deckDataByDate = data.reduce((acc, row) => {
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

// function for multi-player win rate chart
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

// function for player deck performance chart
export function calculatePlayerDeckPerformanceStats(data) {
  const deckStats = data.reduce((acc, row) => {
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

// function for player win rate chart
export function calculatePlayerWinRateStats(data) {
  const eventStats = data.reduce((acc, row) => {
    if (!acc[row.Event]) {
      acc[row.Event] = { date: row.Date, winRate: 0, wins: 0, losses: 0, deck: row.Deck };
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

  return {
    dates,
    winRates: dates.map(date => {
      const event = eventByDate[date];
      const stats = eventStats[event];
      return (stats.wins + stats.losses) > 0 ? (stats.wins / (stats.wins + stats.losses)) * 100 : 0;
    }),
    decks: dates.map(date => eventStats[eventByDate[date]].deck || "N/A"),
    eventByDate
  };
}