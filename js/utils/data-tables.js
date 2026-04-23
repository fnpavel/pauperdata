// Table builders shared by the dashboard. The goal is to keep one stable row
// contract per table type so sorting/export/rendering logic can stay generic.
import { getAnalysisRows } from './analysis-data.js';
import { getPlayerIdentityKey } from './player-names.js';

// Single Event Tables
// Converts one event's rows into the raw row shape used by the single-event
// table and CSV export.
export function calculateSingleEventRawTable(data, {
  eloPlayerLookup = new Map()
} = {}) {
  return data.map(row => {
    const eloSummary = eloPlayerLookup instanceof Map
      ? eloPlayerLookup.get(`${String(row.Date || '').trim()}|||${String(row.Event || '').trim()}|||${getPlayerIdentityKey(row.Player)}`) || null
      : null;

    return {
      rank: row.Rank,
      player: row.Player,
      deck: row.Deck,
      wins: row.Wins,
      losses: row.Losses,
      winRate: (row.Wins + row.Losses) > 0 ? (row.Wins / (row.Wins + row.Losses)) * 100 : 0,
      seasonEloDelta: Number.isFinite(Number(eloSummary?.seasonEloDelta)) ? Number(eloSummary.seasonEloDelta) : Number.NaN,
      seasonElo: Number.isFinite(Number(eloSummary?.seasonElo)) ? Number(eloSummary.seasonElo) : Number.NaN,
      runningEloDelta: Number.isFinite(Number(eloSummary?.runningEloDelta)) ? Number(eloSummary.runningEloDelta) : Number.NaN,
      runningElo: Number.isFinite(Number(eloSummary?.runningElo)) ? Number(eloSummary.runningElo) : Number.NaN
    };
  });
}

// Aggregates one event by deck for the single-event aggregate table.
export function calculateSingleEventAggregateTable(data) {
  const totalPlayers = data.length;
  // Aggregate tables keep counts and conversion rates side by side so the UI
  // can switch between absolute and percentage display modes without recalculating.
  const deckStats = data.reduce((acc, row) => {
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

  return Object.entries(deckStats).map(([deck, stats]) => ({
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
}

// Multi-Event Tables
// Aggregates all selected events by deck for the multi-event aggregate table.
export function calculateMultiEventAggregateTable(data) {
  const totalPlayers = data.length;
  // This mirrors the single-event aggregate shape on purpose. Sharing the same
  // columns lets the multi-event table reuse the same rendering controls.
  const deckStats = data.reduce((acc, row) => {
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

  return Object.entries(deckStats).map(([deck, stats]) => ({
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
}

// Builds a per-event timeline table for one focused deck.
export function calculateMultiEventDeckTable(data, deckName) {
  // Group by event date because the drilldown is a per-event timeline for one
  // deck, not a single rollup across the whole selected range.
  const deckDataByDate = data.reduce((acc, row) => {
    const date = row.Date;
    if (!acc[date]) {
      acc[date] = { event: row.Event, deckCount: 0, totalPlayers: 0, wins: 0, losses: 0, top8: 0, top16: 0, top32: 0, belowTop32: 0, winner: null, winnerDeck: null };
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

  return Object.entries(deckDataByDate).map(([date, stats]) => ({
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
}

// Player Tables
// Builds the selected player's event-history table rows.
export function calculatePlayerEventTable(data, {
  eloEventLookup = new Map()
} = {}) {
  return data.map(row => {
    // Tooltips and deck meta need the full event field, not just the selected
    // player's rows, so this lookup intentionally goes back to analysis rows.
    const eventData = getAnalysisRows().filter(r => r.Event === row.Event);
    const deckData = eventData.filter(r => r.Deck === row.Deck);
    const totalWins = deckData.reduce((sum, r) => sum + r.Wins, 0);
    const totalLosses = deckData.reduce((sum, r) => sum + r.Losses, 0);
    const deckWinRate = (totalWins + totalLosses) > 0 ? (totalWins / (totalWins + totalLosses)) * 100 : 0;
    const deckMeta = eventData.length > 0 ? (deckData.length / eventData.length) * 100 : 0;
    const winner = eventData.reduce((best, r) => r.Rank < best.Rank ? r : best, eventData[0]);
    const winnerWinRate = (winner.Wins + winner.Losses) > 0 ? (winner.Wins / (winner.Wins + winner.Losses)) * 100 : 0;
    const winnerDeckPlayers = eventData.filter(r => r.Deck === winner.Deck).length;
    const winnerMeta = eventData.length > 0 ? (winnerDeckPlayers / eventData.length) * 100 : 0;
    const eloSummary = eloEventLookup instanceof Map
      ? eloEventLookup.get(`${String(row.Date || '').trim()}|||${String(row.Event || '').trim()}`) || null
      : null;

    return {
      date: row.Date,
      event: row.Event,
      players: eventData.length,
      rank: row.Rank,
      deck: row.Deck,
      seasonEloDelta: Number.isFinite(Number(eloSummary?.seasonEloDelta)) ? Number(eloSummary.seasonEloDelta) : Number.NaN,
      seasonElo: Number.isFinite(Number(eloSummary?.seasonElo)) ? Number(eloSummary.seasonElo) : Number.NaN,
      runningEloDelta: Number.isFinite(Number(eloSummary?.runningEloDelta)) ? Number(eloSummary.runningEloDelta) : Number.NaN,
      runningElo: Number.isFinite(Number(eloSummary?.runningElo)) ? Number(eloSummary.runningElo) : Number.NaN,
      wins: row.Wins,
      losses: row.Losses,
      winRate: (row.Wins + row.Losses) > 0 ? (row.Wins / (row.Wins + row.Losses)) * 100 : 0,
      deckWinRate,
      deckMeta,
      tooltip: `Event won by ${winner.Player} with ${winner.Deck} (${winnerWinRate.toFixed(1)}% Overall WR and ${winnerMeta.toFixed(1)}%)`
    };
  });
}

// Aggregates the selected player's results by deck.
export function calculatePlayerDeckTable(data, {
  deckEloLookup = new Map()
} = {}) {
  // Player deck tables collapse multiple event appearances into one row per deck
  // while preserving best/worst single-event snapshots for quick comparison.
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

  return Object.keys(deckStats).map(deck => {
    const stats = deckStats[deck];
    const totalGames = stats.wins + stats.losses;
    const overallWinRate = totalGames > 0 ? (stats.wins / totalGames) * 100 : 0;
    const bestEvent = stats.eventData.reduce((best, event) => event.winRate > (best.winRate || 0) ? event : best, {});
    const worstEvent = stats.eventData.length > 0 ? stats.eventData.reduce((worst, event) => event.winRate < worst.winRate ? event : worst, stats.eventData[0]) : { winRate: 0, event: "--", date: "--" };
    const deckEloSummary = deckEloLookup instanceof Map ? deckEloLookup.get(deck) || null : null;
    return {
      deck,
      deckElo: Number.isFinite(Number(deckEloSummary?.deckElo)) ? Number(deckEloSummary.deckElo) : Number.NaN,
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
}
