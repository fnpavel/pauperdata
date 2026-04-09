import { cleanedData } from '../data.js';
import {
  getQuickViewPresetEventTypes,
  getQuickViewPresetRows,
  getQuickViewPresetSuggestedRange
} from './quick-view-presets.js';

export function getMultiEventPresetEventTypes(presetId) {
  return getQuickViewPresetEventTypes(presetId, cleanedData);
}

export function getMultiEventPresetRows(selectedEventTypes = [], presetId = '', rows = cleanedData) {
  return getQuickViewPresetRows(selectedEventTypes, presetId, rows);
}

export function getMultiEventPresetSuggestedRange({ selectedEventTypes = [], presetId = '', rows = cleanedData } = {}) {
  return getQuickViewPresetSuggestedRange({
    selectedEventTypes,
    presetId,
    rows
  });
}
