// js/main.js
import { ensureEventDataLoaded, getLastUpdatedDate } from './utils/event-data.js';
import { setAnalysisDataRows } from './utils/analysis-data.js';
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

// Expose global functions for HTML event handlers
window.updateMultiEventAnalytics = updateMultiEventAnalytics;
window.updateDeckEvolutionChart = () => import('./charts/deck-evolution.js').then(module => module.updateDeckEvolutionChart());
window.updatePlayerAnalytics = updatePlayerAnalytics;
window.toggleDataset = (chart, index) => import('./utils/u-chart.js').then(module => module.toggleDataset(chart, index));
window.updatePlayerDeckPerformanceChart = () => import('./charts/player-deck-performance.js').then(module => module.updatePlayerDeckPerformanceChart());

// Function to update the Last Updated date
function setLastUpdatedDate() {
  const dateElement = document.getElementById('lastUpdatedDate');
  if (dateElement) {
    dateElement.textContent = `Last updated: ${getLastUpdatedDate()}`;
  }
}

async function initializeDashboard() {
  console.log('Initializing MTG Analytics Dashboard...');

  const { rows } = await ensureEventDataLoaded();
  setAnalysisDataRows(rows);
  setLastUpdatedDate(); // Call the function to set the date

  // Initialize analysis modules
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
  
  // Initial updates based on default mode
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

  // Add event listener for playerDeckPerformanceSelect
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
