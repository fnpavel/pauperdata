// js/main.js
import { lastUpdatedDate } from './data.js'; // the date is stored in data.js because weekly I'm pushing only changes there.
import { initEventAnalysis, updateEventAnalytics, updateMultiEventAnalytics } from './modules/event-analysis.js';
import { initPlayerAnalysis, updatePlayerAnalytics } from './modules/player-analysis.js';
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
    dateElement.textContent = `Last updated: ${lastUpdatedDate}`;
  }
}

// Initialize everything
document.addEventListener('DOMContentLoaded', () => {
  console.log('Initializing MTG Analytics Dashboard...');
  
  setLastUpdatedDate(); // Call the function to set the date
  
  // Initialize analysis modules
  initEventAnalysis();
  initPlayerAnalysis();
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
});
