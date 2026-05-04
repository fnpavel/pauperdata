const PLAYER_DECK_FILTER_EVENT = 'playerDeckFilterChanged';

function getPlayerEloDeckFilterRoot() {
  return document.getElementById('playerEloDeckFilter');
}

function getPlayerWinRateDeckFilterRoot() {
  return document.getElementById('playerWinRateDeckFilter');
}

function readSelectedDeckFromRoot(root) {
  if (!root) {
    return '';
  }

  const directSelection = String(root.dataset.selectedDeck || '').trim();
  if (directSelection) {
    return directSelection;
  }

  try {
    const parsed = JSON.parse(root.dataset.selectedDecks || '[]');
    return Array.isArray(parsed) ? String(parsed[0] || '').trim() : '';
  } catch {
    return '';
  }
}

function writeSelectedDeckToRoot(root, selectedDeck) {
  if (!root) {
    return;
  }

  const normalizedDeck = String(selectedDeck || '').trim();
  root.dataset.selectedDeck = normalizedDeck;
  root.dataset.selectedDecks = JSON.stringify(normalizedDeck ? [normalizedDeck] : []);
}

export function getSelectedPlayerDeck() {
  const eloDeck = readSelectedDeckFromRoot(getPlayerEloDeckFilterRoot());
  const winRateDeck = readSelectedDeckFromRoot(getPlayerWinRateDeckFilterRoot());
  const globalDeck = String(document.documentElement.dataset.playerSelectedDeck || '').trim();
  return eloDeck || winRateDeck || globalDeck;
}

export function setSelectedPlayerDeck(selectedDeck) {
  const normalizedDeck = String(selectedDeck || '').trim();
  writeSelectedDeckToRoot(getPlayerEloDeckFilterRoot(), normalizedDeck);
  writeSelectedDeckToRoot(getPlayerWinRateDeckFilterRoot(), normalizedDeck);
  document.documentElement.dataset.playerSelectedDeck = normalizedDeck;
}

export function dispatchPlayerDeckFilterChange() {
  const selectedDeck = getSelectedPlayerDeck();
  document.dispatchEvent(new CustomEvent(PLAYER_DECK_FILTER_EVENT, {
    detail: { selectedDeck }
  }));
}

export function getEloDeckOrder() {
  const root = getPlayerEloDeckFilterRoot();
  if (!root) {
    return [];
  }

  return Array.from(root.querySelectorAll('[data-player-elo-deck]'))
    .map(button => String(button.dataset.playerEloDeck || '').trim())
    .filter(Boolean);
}

export function onPlayerDeckFilterChange(listener) {
  document.addEventListener(PLAYER_DECK_FILTER_EVENT, listener);
}
