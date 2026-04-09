import { cleanedData } from '../data.js';
import { rowMatchesPlayerKey } from './player-names.js';
import {
  normalizeQuickViewPresetIds,
  getQuickViewPresetEventTypes,
  getQuickViewPresetRows,
  getQuickViewPresetSuggestedRange
} from './quick-view-presets.js';

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

export function getPlayerAnalysisActivePresetIds() {
  return normalizeQuickViewPresetIds(getPlayerAnalysisActivePreset());
}

export function getPlayerPresetEventTypes(presetId) {
  return getQuickViewPresetEventTypes(presetId, cleanedData);
}

export function getPlayerPresetRows(selectedEventTypes = [], presetId = '', rows = cleanedData) {
  return getQuickViewPresetRows(selectedEventTypes, presetId, rows);
}

export function getPlayerPresetSuggestedRange({ selectedEventTypes = [], presetId = '', playerKey = '', rows = cleanedData } = {}) {
  const scopedRows = getPlayerPresetRows(selectedEventTypes, presetId, rows);
  const playerRows = playerKey ? scopedRows.filter(row => rowMatchesPlayerKey(row, playerKey)) : scopedRows;

  return getQuickViewPresetSuggestedRange({
    selectedEventTypes,
    presetId,
    rows: playerRows
  });
}
