// js/utils/data.js
export function calculateDeckStats(data, deck, totalPlayers) {
  const deckData = data.filter(row => row.Deck === deck);
  const totalWins = deckData.reduce((sum, row) => sum + (row.Wins || 0), 0);
  const totalLosses = deckData.reduce((sum, row) => sum + (row.Losses || 0), 0);
  const winRate = totalWins + totalLosses > 0 ? (totalWins / (totalWins + totalLosses)) * 100 : 0;
  const metaShare = totalPlayers > 0 ? (deckData.length / totalPlayers) * 100 : 0;
  return { winRate, metaShare, totalMatches: totalWins + totalLosses };
}

export function calculateTopDecks(data) {
  const ranges = {
    "Top 8": data.filter(row => row.Rank <= 8),
    "Top 16": data.filter(row => row.Rank <= 16),
    "Top 32": data.filter(row => row.Rank <= 32),
    "Below Top 32": data.filter(row => row.Rank > 32)
  };

  return Object.fromEntries(
    Object.entries(ranges).map(([range, filtered]) => {
      const counts = filtered.reduce((acc, row) => {
        acc[row.Deck] = (acc[row.Deck] || 0) + 1;
        return acc;
      }, {});

      const maxCount = Math.max(...Object.values(counts), 0);
      const topDecks = Object.entries(counts)
        .filter(([_, count]) => count === maxCount)
        .map(([deck]) => deck);

      return [range, topDecks.length > 0 ? topDecks : [null]];
    })
  );
}