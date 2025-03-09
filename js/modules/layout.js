// js/modules/layout.js
export function resizeOverflowedCharts(){
  
  const charts = []; //Will store all charts to resize them after the layout stabilizes

  // Find all canvas elements within chart containers
  document.querySelectorAll('.chart-container canvas').forEach(canvas => {
    const ctx = canvas.getContext('2d');
    
    // Initialize each chart (customize data/options as needed)
    const chart = new Chart(ctx, {
      type: 'bar', // Adjust type based on your chart (bar, line, etc.)
      data: {
        labels: ['Example'], // Replace with your data
        datasets: [{
          label: 'Sample',
          data: [10], // Replace with your data
          backgroundColor: 'rgba(139, 0, 139, 0.5)' // Example color
        }]
      },
      options: {
        responsive: true, // Adapts to container size
        maintainAspectRatio: false // Allows custom height/width
      }
    });
    
    charts.push(chart); // Store the chart instance
  });

  // Force resize for all charts after layout stabilizes
  setTimeout(() => {
    charts.forEach(chart => chart.resize());
  }, 100); // 100ms delay, adjust if needed

  // Optional: Handle window resize for responsiveness
  window.addEventListener('resize', () => {
    charts.forEach(chart => chart.resize());
  });
}

export function resizePlayerCardsLayout() {
  ['singleEventStats', 'multiEventStats', 'playerStats'].forEach(setStatCardColumns);
  adjustPlayerStatsWidth();
}

export function setStatCardColumns(containerId) { 
  const statsContainer = document.getElementById(containerId);
  if (statsContainer) {
    const statCards = statsContainer.querySelectorAll('.stat-card').length;
    statsContainer.style.setProperty('--stat-card-count', statCards);
  }
}

function getChartsWidth() {
  const chartsContainer = document.querySelector('.charts-and-tables');
  if (chartsContainer) {
    const chartsWidth = chartsContainer.offsetWidth;
    console.log(`Charts width: ${chartsWidth}px`);
    return chartsWidth;
  } else {
    console.error('Charts container not found');
    return 0;
  }
}

// Fixed version of adjustPlayerStatsWidth from script.js
function adjustPlayerStatsWidth() {
  const sidebar = document.querySelector('.deck-stats-sidebar');
  const playerStats = document.querySelector('#playerStats.stats-container');
  const filters = document.querySelector('#playerDashboard .filters');
  const container = document.querySelector('.container');

  if (!sidebar || !playerStats || !filters || !container) {
    console.error('One or more layout elements not found');
    return;
  }

  const containerWidth = container.offsetWidth;
  const filtersWidth = filters.offsetWidth;
  const sidebarWidth = sidebar.offsetWidth;
  const chartsWidth = getChartsWidth();
  const gap = 100;

  // Fixed calculation: Width should be chartsWidth + gap, adjusted for sidebar and filters
  const statsWidth = filtersWidth + chartsWidth + gap; // Simplified, assuming sidebar is separate
  playerStats.style.width = `${statsWidth}px`;
  playerStats.style.marginLeft = `0px`; // Reset to 0 since containerPaddingLeft was 0

  console.log({ containerWidth, filtersWidth, sidebarWidth, chartsWidth, statsWidth });
}

// Event listeners from script.js
window.addEventListener('load', adjustPlayerStatsWidth);
window.addEventListener('resize', adjustPlayerStatsWidth);

// Hook into updatePlayerAnalytics
const originalUpdatePlayerAnalytics = window.updatePlayerAnalytics || function() {};
window.updatePlayerAnalytics = function() {
  originalUpdatePlayerAnalytics.apply(this, arguments);
  setTimeout(adjustPlayerStatsWidth, 0);
};