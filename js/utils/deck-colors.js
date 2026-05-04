export const LEADERBOARD_TOP8_DECK_COLORS = Object.freeze({
  1: '#E6194B',
  2: '#3CB44B',
  3: '#4363D8',
  4: '#F58231',
  5: '#911EB4',
  6: '#46F0F0',
  7: '#F032E6',
  8: '#BCF60C',
  9: '#FABED4',
  10: '#008080',
  11: '#9A6324',
  12: '#A9A9A9'
});

export const LEADERBOARD_TOP8_DECK_COLOR_SEQUENCE = Object.freeze(
  Object.values(LEADERBOARD_TOP8_DECK_COLORS)
);

export function buildOrderedDeckColorMap(deckNames = [], preferredOrder = []) {
  const uniqueDecks = [...new Set(
    (Array.isArray(deckNames) ? deckNames : [])
      .map(deck => String(deck || '').trim())
      .filter(Boolean)
  )];
  const preferredDecks = Array.isArray(preferredOrder)
    ? preferredOrder.map(deck => String(deck || '').trim()).filter(Boolean)
    : [];
  const preferredIndex = new Map(preferredDecks.map((deck, index) => [deck, index]));
  const originalIndex = new Map(uniqueDecks.map((deck, index) => [deck, index]));
  const sortedDecks = [...uniqueDecks].sort((a, b) => {
    const aPreferred = preferredIndex.has(a);
    const bPreferred = preferredIndex.has(b);

    if (aPreferred && bPreferred) {
      return preferredIndex.get(a) - preferredIndex.get(b);
    }
    if (aPreferred) {
      return -1;
    }
    if (bPreferred) {
      return 1;
    }

    return (originalIndex.get(a) || 0) - (originalIndex.get(b) || 0);
  });

  return new Map(
    sortedDecks.map((deck, index) => [
      deck,
      LEADERBOARD_TOP8_DECK_COLOR_SEQUENCE[index % LEADERBOARD_TOP8_DECK_COLOR_SEQUENCE.length]
    ])
  );
}
