// js/utils/data.js
export function calculateDeckStats(data, deck, totalPlayers) {
  const deckData = data.filter(row => row.Deck === deck);
  const totalWins = deckData.reduce((sum, row) => sum + (row.Wins || 0), 0); // Added || 0 for safety
  const totalLosses = deckData.reduce((sum, row) => sum + (row.Losses || 0), 0);
  const winRate = totalWins + totalLosses > 0 ? (totalWins / (totalWins + totalLosses)) * 100 : 0;
  const metaShare = totalPlayers > 0 ? (deckData.length / totalPlayers) * 100 : 0;
  return { winRate: winRate.toFixed(1), metaShare: metaShare.toFixed(1), totalMatches: totalWins + totalLosses };
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
      return [range, Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b, null)];
    })
  );
}