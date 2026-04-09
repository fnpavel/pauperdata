import { getAnalysisRows } from './analysis-data.js';
import {
  getQuickViewPresetEventTypes,
  getQuickViewPresetRows,
  getQuickViewPresetSuggestedRange
} from './quick-view-presets.js';

export function getMultiEventPresetEventTypes(presetId) {
  return getQuickViewPresetEventTypes(presetId, getAnalysisRows());
}

export function getMultiEventPresetRows(selectedEventTypes = [], presetId = '', rows = getAnalysisRows()) {
  return getQuickViewPresetRows(selectedEventTypes, presetId, rows);
}

export function getMultiEventPresetSuggestedRange({ selectedEventTypes = [], presetId = '', rows = getAnalysisRows() } = {}) {
  return getQuickViewPresetSuggestedRange({
    selectedEventTypes,
    presetId,
    rows
  });
}
