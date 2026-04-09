import { cleanedData } from '../data.js';
import { rowMatchesPlayerKey } from './player-names.js';
import {
  getQuickViewPresetEventTypes,
  getQuickViewPresetRows,
  getQuickViewPresetSuggestedRange
} from './quick-view-presets.js';

export function getPlayerAnalysisActivePreset() {
  return document.getElementById('playerQuickViewButtons')?.dataset.activePreset
    || document.querySelector('.player-preset-button.active')?.dataset.playerPreset
    || '';
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
