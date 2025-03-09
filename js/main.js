// js/main.js
import { initEventAnalysis, updateEventAnalytics, updateMultiEventAnalytics } from './modules/event-analysis.js';
import { initPlayerAnalysis, updatePlayerAnalytics } from './modules/player-analysis.js';
import { 
  setupFilters, 
  setupTopModeListeners, 
  setupAnalysisModeListeners, 
  setupEventTypeListeners, 
  setupEventFilterListeners, 
  setupPlayerFilterListeners 
} from './modules/filters.js';
//import { resizeOverflowedCharts } from './modules/layout.js';

import { setupAboutListeners } from './modules/about.js';

// Expose global functions for HTML event handlers
window.updateMultiEventAnalytics = updateMultiEventAnalytics;
window.updateDeckEvolutionChart = () => import('./charts/deck-evolution.js').then(module => module.updateDeckEvolutionChart());
window.updatePlayerAnalytics = updatePlayerAnalytics;
window.toggleDataset = (chart, index) => import('./utils/chart.js').then(module => module.toggleDataset(chart, index));

// Initialize everything
document.addEventListener('DOMContentLoaded', () => {
  console.log('Initializing MTG Analytics Dashboard...');
  
  // Initialize analysis modules
  initEventAnalysis();
  initPlayerAnalysis();

  setupAboutListeners();
  
  // Setup filters and listeners
  setupFilters();
  setupTopModeListeners();
  setupAnalysisModeListeners();
  setupEventTypeListeners();
  setupEventFilterListeners();
  setupPlayerFilterListeners();
  
  // Initial updates
  updateEventAnalytics(); // Default to single event analysis

  //resizeOverflowedCharts(); //The charts have a wonky behavior on startup, this will resize them.
});