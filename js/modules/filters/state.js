// Stores shared mutable filter state used across the split filter modules.
export const filterState = {
  lastSingleEventType: '',
  selectedSingleEventName: '',
  multiEventGroupSelectionInitialized: false,
  activeMultiEventGroupKeys: new Set(),
  activeMultiEventQuickViewYear: '',
  activeMultiEventRangeInputSource: 'filter',
  activePlayerQuickViewYear: '',
  playerEventGroupSelectionInitialized: false,
  activePlayerEventGroupKeys: new Set(),
  playerEventGroupSelectionContextKey: '',
  playerSelectionInitialized: false,
  playerSelectionKey: ''
};
