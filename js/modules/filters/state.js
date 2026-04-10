// Stores shared mutable filter state used across the split filter modules.
export const filterState = {
  lastSingleEventType: '',
  multiEventGroupSelectionInitialized: false,
  activeMultiEventGroupKeys: new Set(),
  activeMultiEventQuickViewYear: '',
  activePlayerQuickViewYear: '',
  playerEventGroupSelectionInitialized: false,
  activePlayerEventGroupKeys: new Set(),
  playerEventGroupSelectionContextKey: '',
  playerSelectionInitialized: false,
  playerSelectionKey: ''
};
