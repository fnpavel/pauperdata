// Thin adapter around quick-view presets for Multi-Event Analysis. Keeping this
// file small lets the filter code use multi-event names without knowing the
// lower-level preset implementation details.
import { getAnalysisRows } from './analysis-data.js';
import {
  getQuickViewPresetEventTypes,
  getQuickViewPresetRows,
  getQuickViewPresetSuggestedRange
} from './quick-view-presets.js';

// Returns event types declared by a multi-event preset.
export function getMultiEventPresetEventTypes(presetId) {
  return getQuickViewPresetEventTypes(presetId, getAnalysisRows());
}

// Returns rows selected by a multi-event preset and event-type scope.
export function getMultiEventPresetRows(selectedEventTypes = [], presetId = '', rows = getAnalysisRows()) {
  return getQuickViewPresetRows(selectedEventTypes, presetId, rows);
}

// Returns the date range suggested by a multi-event preset.
export function getMultiEventPresetSuggestedRange({ selectedEventTypes = [], presetId = '', rows = getAnalysisRows() } = {}) {
  return getQuickViewPresetSuggestedRange({
    selectedEventTypes,
    presetId,
    rows
  });
}
