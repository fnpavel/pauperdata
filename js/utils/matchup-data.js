import { matchupEvents as rawMatchupEvents, matchupRounds as rawMatchupRounds, matchupMatches as rawMatchupMatches } from '../matchups-data.js';
import { getQuickViewPresetDefinitionsByIds } from './quick-view-presets.js';

function getRecordDate(record) {
  return String(record?.date || record?.Date || '').trim();
}

function getRecordEventType(record) {
  return String(record?.event_type || record?.EventType || '').trim().toLowerCase();
}

function matchesQuickViewPreset(record, presetId = '') {
  const presets = getQuickViewPresetDefinitionsByIds(presetId);
  if (presets.length === 0 || presets.some(preset => preset.kind === 'static')) {
    return true;
  }

  const recordDate = getRecordDate(record);
  if (!recordDate) {
    return false;
  }

  const calendarYearPresets = presets.filter(preset => preset.kind === 'calendar-year');
  if (calendarYearPresets.length > 0) {
    return calendarYearPresets.some(preset => recordDate >= preset.startDate && recordDate <= preset.endDate);
  }

  const setWindowPresets = presets.filter(preset => preset.kind === 'set-window');
  if (setWindowPresets.length > 0) {
    return setWindowPresets.some(preset => {
      return recordDate >= preset.releaseDate && (!preset.nextReleaseDate || recordDate < preset.nextReleaseDate);
    });
  }

  return true;
}

export function getMatchupEvents() {
  return rawMatchupEvents;
}

export function getMatchupRounds() {
  return rawMatchupRounds;
}

export function getMatchupMatches() {
  return rawMatchupMatches;
}

export function filterMatchupRecords(
  records = [],
  {
    eventTypes = [],
    startDate = '',
    endDate = '',
    quickViewPresetId = ''
  } = {}
) {
  const selectedEventTypes = Array.isArray(eventTypes)
    ? eventTypes.map(value => String(value || '').toLowerCase()).filter(Boolean)
    : [];

  return (records || []).filter(record => {
    const recordDate = getRecordDate(record);
    const recordEventType = getRecordEventType(record);

    if (selectedEventTypes.length > 0 && !selectedEventTypes.includes(recordEventType)) {
      return false;
    }

    if (startDate && recordDate < startDate) {
      return false;
    }

    if (endDate && recordDate > endDate) {
      return false;
    }

    if (quickViewPresetId && !matchesQuickViewPreset(record, quickViewPresetId)) {
      return false;
    }

    return true;
  });
}
