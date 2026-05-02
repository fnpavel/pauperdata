// Bootstraps the dashboard after the shared dataset is loaded and keeps a small
// set of globals available for legacy inline handlers declared in index.html.
import { ensureEventDataLoaded, getLastUpdatedTimestamp } from './utils/event-data.js';
import { setAnalysisDataRows } from './utils/analysis-data.js';
import { ensureMatchupCatalogLoaded } from './utils/matchup-data.js';
import { initEventAnalysis, updateEventAnalytics, updateMultiEventAnalytics } from './modules/event-analysis.js';
import { initPlayerAnalysis, updatePlayerAnalytics } from './modules/player-analysis.js';
import { initMatchupAnalysis, updateMatchupAnalytics } from './modules/matchup-analysis.js';
import { initLeaderboards, updateLeaderboardAnalytics } from './modules/leaderboards-analysis.js';
import { 
  setupFilters, 
  setupTopModeListeners, 
  setupAnalysisModeListeners, 
  setupEventTypeListeners, 
  setupEventFilterListeners, 
  setupPlayerFilterListeners,
  setupMultiEventPresetListeners,
  updateAllCharts
} from './modules/filters/filter-index.js';
import { setupAboutListeners } from './modules/about.js';
import { setupThemeToggle } from './utils/theme.js';

// These globals keep the existing HTML event hooks working without forcing the
// lazily loaded chart helpers into the initial bundle.
window.updateMultiEventAnalytics = updateMultiEventAnalytics;
window.updateDeckEvolutionChart = () => import('./charts/deck-evolution.js').then(module => module.updateDeckEvolutionChart());
window.updatePlayerAnalytics = updatePlayerAnalytics;
window.toggleDataset = (chart, index) => import('./utils/u-chart.js').then(module => module.toggleDataset(chart, index));
window.updatePlayerDeckPerformanceChart = () => import('./charts/player-deck-performance.js').then(module => module.updatePlayerDeckPerformanceChart());

function formatRelativeTimestamp(date) {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const absDiffMs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  let value;
  let unit;
  if (absDiffMs < hour) {
    value = Math.round(diffMs / minute);
    unit = 'minute';
  } else if (absDiffMs < day) {
    value = Math.round(diffMs / hour);
    unit = 'hour';
  } else {
    value = Math.round(diffMs / day);
    unit = 'day';
  }

  if (value === 0) {
    return 'just now';
  }

  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(value, unit);
}

function formatAbsoluteTimestamp(date) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

// Function to update the Last Updated date
function setLastUpdatedDate() {
  const dateElement = document.getElementById('lastUpdatedDate');
  const rawTimestamp = getLastUpdatedTimestamp();
  if (!dateElement) {
    return;
  }

  if (!rawTimestamp) {
    dateElement.textContent = 'Last updated: --';
    dateElement.removeAttribute('title');
    return;
  }

  const parsedDate = new Date(rawTimestamp);
  if (Number.isNaN(parsedDate.getTime())) {
    dateElement.textContent = `Last updated: ${rawTimestamp}`;
    dateElement.removeAttribute('title');
    return;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(rawTimestamp)) {
    dateElement.textContent = `Last updated: ${new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(parsedDate)}`;
    dateElement.removeAttribute('title');
    return;
  }

  const relativeLabel = formatRelativeTimestamp(parsedDate);
  const absoluteLabel = formatAbsoluteTimestamp(parsedDate);
  dateElement.textContent = `Last updated: ${relativeLabel} (${absoluteLabel})`;
  dateElement.title = parsedDate.toISOString();
}

async function initializeDashboard() {
  console.log('Initializing MTG Analytics Dashboard...');

  // Every analysis module reads from the shared analysis dataset, so the data
  // cache needs to be populated before any module computes its initial state.
  const [{ rows }] = await Promise.all([
    ensureEventDataLoaded(),
    ensureMatchupCatalogLoaded()
  ]);
  setAnalysisDataRows(rows);
  setLastUpdatedDate();
  window.setInterval(setLastUpdatedDate, 60 * 1000);

  // Initialize modules before wiring filters because many filter listeners call
  // back into these modules immediately.
  initEventAnalysis();
  initPlayerAnalysis();
  initMatchupAnalysis();
  initLeaderboards();

  setupAboutListeners();
  
  // Setup filters and listeners
  setupFilters();
  setupTopModeListeners();
  setupAnalysisModeListeners();
  setupEventTypeListeners();
  setupEventFilterListeners();
  setupPlayerFilterListeners();
  setupMultiEventPresetListeners();
  setupThemeToggle(() => {
    updateAllCharts();
  });
  
  // The top-mode switch decides which view owns the first render.
  const defaultTopMode = document.querySelector('.top-mode-button.active')?.dataset.topMode || 'event';
  if (defaultTopMode === 'event') {
    updateEventAnalytics(); // Default to single event analysis
  } else if (defaultTopMode === 'player') {
    updatePlayerAnalytics();
    window.updatePlayerDeckPerformanceChart(); // Initial call for Player Analysis
  } else if (defaultTopMode === 'deck-matchup' || defaultTopMode === 'player-matchup') {
    updateMatchupAnalytics();
  } else if (defaultTopMode === 'leaderboard') {
    updateLeaderboardAnalytics();
  }

  // This select lives outside the chart module, so the entry point owns the
  // bridge that asks the chart to refresh when the deck changes.
  const deckSelect = document.getElementById('playerDeckPerformanceSelect');
  if (deckSelect) {
    deckSelect.addEventListener('change', () => {
      import('./charts/player-deck-performance.js').then(module => module.updatePlayerDeckPerformanceChart());
    });
  }
}

// Initialize everything
document.addEventListener('DOMContentLoaded', () => {
  initializeDashboard().catch(error => {
    console.error('Failed to initialize MTG Analytics Dashboard.', error);
  });
});
