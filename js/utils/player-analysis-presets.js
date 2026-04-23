// Thin adapter around quick-view presets for Player Analysis. It exposes the
// active preset selected in the DOM and resolves preset rows/ranges for the
// current player-focused filter controls.
import { getAnalysisRows } from './analysis-data.js';
import { rowMatchesPlayerKey } from './player-names.js';
import {
  normalizeQuickViewPresetIds,
  getQuickViewPresetEventTypes,
  getQuickViewPresetRows,
  getQuickViewPresetSuggestedRange
} from './quick-view-presets.js';

// Reads the active Player Analysis quick-view preset from the DOM.
export function getPlayerAnalysisActivePreset() {
  const activePresetValue = document.getElementById('playerQuickViewButtons')?.dataset.activePreset || '';
  if (activePresetValue) {
    return activePresetValue;
  }

  return Array.from(document.querySelectorAll('.player-preset-button.active'))
    .map(button => button.dataset.playerPreset)
    .filter(Boolean)
    .join(',');
}

// Returns all active Player Analysis preset ids.
export function getPlayerAnalysisActivePresetIds() {
  return normalizeQuickViewPresetIds(getPlayerAnalysisActivePreset());
}

// Returns event types declared by a Player Analysis preset.
export function getPlayerPresetEventTypes(presetId) {
  return getQuickViewPresetEventTypes(presetId, getAnalysisRows());
}

// Returns rows selected by a Player Analysis preset and event-type scope.
export function getPlayerPresetRows(selectedEventTypes = [], presetId = '', rows = getAnalysisRows()) {
  return getQuickViewPresetRows(selectedEventTypes, presetId, rows);
}

// Returns the date range suggested by a Player Analysis preset.
export function getPlayerPresetSuggestedRange({ selectedEventTypes = [], presetId = '', playerKey = '', rows = getAnalysisRows() } = {}) {
  const scopedRows = getPlayerPresetRows(selectedEventTypes, presetId, rows);
  const playerRows = playerKey ? scopedRows.filter(row => rowMatchesPlayerKey(row, playerKey)) : scopedRows;

  return getQuickViewPresetSuggestedRange({
    selectedEventTypes,
    presetId,
    rows: playerRows
  });
}
