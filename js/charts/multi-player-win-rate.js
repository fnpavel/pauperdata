import { setChartLoading } from '../utils/dom.js';
import { getDeckEvolutionChartData } from '../modules/filters.js';
import { calculateMultiPlayerWinRateStats } from "../utils/data-chart.js";

export let multiPlayerWinRateChart = null;

export function updateMultiPlayerWinRateChart() {
  console.log("updateMultiPlayerWinRateChart called...");
  setChartLoading("multiPlayerWinRateChart", true);

  const chartData = getDeckEvolutionChartData();
  if (chartData.length === 0) {
    if (multiPlayerWinRateChart) multiPlayerWinRateChart.destroy();
    const multiPlayerWinRateCtx = document.getElementById("multiPlayerWinRateChart");
    if (multiPlayerWinRateCtx) {
      multiPlayerWinRateChart = new Chart(multiPlayerWinRateCtx, {
        type: 'scatter',
        data: {
          labels: ["No Data"],
          datasets: [{ label: "Average Win Rate (%)", data: [0], backgroundColor: '#808080' }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { display: false }, x: { ticks: { color: '#fff' } } }
        }
      });
    }
    setChartLoading("multiPlayerWinRateChart", false);
    return;
  }

  const playerData = calculateMultiPlayerWinRateStats(chartData);
  const sortedPlayerData = playerData.sort((a, b) => b.avgWinRate - a.avgWinRate || b.eventCount - a.eventCount);
  const labels = sortedPlayerData.map(p => p.player);
  const winRates = sortedPlayerData.map(p => p.avgWinRate);
  const eventCounts = sortedPlayerData.map(p => p.eventCount);

  if (multiPlayerWinRateChart) multiPlayerWinRateChart.destroy();
  const multiPlayerWinRateCtx = document.getElementById("multiPlayerWinRateChart");
  if (!multiPlayerWinRateCtx) {
    console.error("Multi-Event Player Win Rate Chart canvas not found!");
    setChartLoading("multiPlayerWinRateChart", false);
    return;
  }

  // Add searchable dropdown
  const chartContainer = multiPlayerWinRateCtx.parentElement;
  let searchContainer = chartContainer.querySelector('.player-search-container');
  if (!searchContainer) {
    searchContainer = document.createElement('div');
    searchContainer.className = 'player-search-container';
    searchContainer.style.marginBottom = '15px';
    searchContainer.style.position = 'relative';
    
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search players...';
    searchInput.className = 'player-search-input';
    searchInput.style.width = '100%';
    searchInput.style.padding = '8px';
    searchInput.style.borderRadius = '4px';
    searchInput.style.backgroundColor = '#2a2a2a';
    searchInput.style.border = '1px solid #444';
    searchInput.style.color = '#fff';
    searchInput.style.fontFamily = "'Bitter', serif";
    
    const dropdown = document.createElement('div');
    dropdown.className = 'player-dropdown';
    dropdown.style.display = 'none';
    dropdown.style.position = 'absolute';
    dropdown.style.top = '100%';
    dropdown.style.left = '0';
    dropdown.style.right = '0';
    dropdown.style.maxHeight = '200px';
    dropdown.style.overflowY = 'auto';
    dropdown.style.backgroundColor = '#2a2a2a';
    dropdown.style.border = '1px solid #444';
    dropdown.style.borderRadius = '4px';
    dropdown.style.zIndex = '1000';
    
    searchContainer.appendChild(searchInput);
    searchContainer.appendChild(dropdown);
    chartContainer.insertBefore(searchContainer, multiPlayerWinRateCtx);

    // Add event listeners for search functionality
    searchInput.addEventListener('input', (e) => {
      const searchTerm = e.target.value.toLowerCase();
      
      // If search input is cleared, reset the chart
      if (searchTerm === '') {
        const dataset = multiPlayerWinRateChart.data.datasets[0];
        // Reset all points to default size and color
        dataset.pointRadius = dataset.data.map(() => 8);
        dataset.pointHoverRadius = dataset.data.map(() => 10);
        dataset.backgroundColor = dataset.data.map(() => '#FFD700');
        dataset.borderColor = dataset.data.map(() => '#DAA520');
        dataset.pointStyle = dataset.data.map(() => 'circle'); // Reset point style
        
        // Reset zoom by setting axis limits directly
        multiPlayerWinRateChart.options.scales.x.min = 0;
        multiPlayerWinRateChart.options.scales.x.max = Math.max(...eventCounts) + 2;
        multiPlayerWinRateChart.options.scales.y.min = 0;
        multiPlayerWinRateChart.options.scales.y.max = Math.min(100, Math.ceil(Math.max(...winRates) / 10) * 10 + 10);
        
        multiPlayerWinRateChart.update();
        dropdown.style.display = 'none';
        return;
      }
      
      const filteredPlayers = labels.filter(player => 
        player.toLowerCase().includes(searchTerm)
      );
      
      dropdown.innerHTML = '';
      dropdown.style.display = filteredPlayers.length > 0 ? 'block' : 'none';
      
      filteredPlayers.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.textContent = player;
        playerDiv.style.padding = '8px';
        playerDiv.style.cursor = 'pointer';
        playerDiv.style.color = '#fff';
        playerDiv.style.fontFamily = "'Bitter', serif";
        playerDiv.style.fontWeight = 'bold';
        playerDiv.style.borderBottom = '1px solid #444';
        
        playerDiv.addEventListener('mouseover', () => {
          playerDiv.style.backgroundColor = '#444';
        });
        
        playerDiv.addEventListener('mouseout', () => {
          playerDiv.style.backgroundColor = 'transparent';
        });
        
        playerDiv.addEventListener('click', () => {
          searchInput.value = player;
          dropdown.style.display = 'none';
          
          // Find and highlight the selected player's point
          const dataset = multiPlayerWinRateChart.data.datasets[0];
          const pointIndex = dataset.data.findIndex(d => d.label === player);
          if (pointIndex !== -1) {
            // Reset all points to default size and color
            dataset.pointRadius = dataset.data.map(() => 8);
            dataset.pointHoverRadius = dataset.data.map(() => 10);
            dataset.backgroundColor = dataset.data.map(() => '#FFD700');
            dataset.borderColor = dataset.data.map(() => '#DAA520');
            dataset.pointStyle = dataset.data.map(() => 'circle'); // Reset point style
            
            // Make selected point larger and red
            dataset.pointRadius[pointIndex] = 18;
            dataset.pointHoverRadius[pointIndex] = 20;
            dataset.backgroundColor[pointIndex] = '#FF0000';
            dataset.borderColor[pointIndex] = '#CC0000';
            dataset.pointStyle[pointIndex] = 'rectRot'; // Change shape to diamond
            
            // Update chart
            multiPlayerWinRateChart.update();
            
            // Center the view on the selected point
            const xValue = dataset.data[pointIndex].x;
            const yValue = dataset.data[pointIndex].y;
            
            // Calculate the range to show around the point
            const xRange = 5; // Show 5 events on each side
            const yRange = 20; // Show 20% win rate on each side
            
            // Round the zoom values to 2 decimal places
            multiPlayerWinRateChart.options.scales.x.min = Number(Math.max(0, xValue - xRange).toFixed(2));
            multiPlayerWinRateChart.options.scales.x.max = Number((xValue + xRange).toFixed(2));
            multiPlayerWinRateChart.options.scales.y.min = Number(Math.max(0, yValue - yRange).toFixed(2));
            multiPlayerWinRateChart.options.scales.y.max = Number(Math.min(100, yValue + yRange).toFixed(2));
            
            multiPlayerWinRateChart.update();
          }
        });
        
        dropdown.appendChild(playerDiv);
      });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!searchContainer.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });
  }

  try {
    multiPlayerWinRateChart = new Chart(multiPlayerWinRateCtx, {
      type: 'scatter',
      data: {
        datasets: [{
          label: "Players",
          data: labels.map((label, i) => ({
            x: eventCounts[i],
            y: winRates[i],
            label: label,
            events: eventCounts[i],
            winRate: winRates[i]
          })),
          backgroundColor: '#FFD700',
          borderColor: '#DAA520',
          borderWidth: 1,
          pointRadius: 8,
          pointHoverRadius: 10
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            title: {
              display: true,
              text: "Events Played",
              color: '#fff',
              font: { size: 14, weight: 'bold', family: "'Bitter', serif" }
            },
            ticks: {
              color: '#fff',
              font: { size: 12, family: "'Bitter', serif" },
              stepSize: 1
            },
            grid: { color: 'rgba(255, 255, 255, 0.1)' },
            min: 0,
            max: Math.max(...eventCounts) + 1
          },
          y: {
            type: 'linear',
            title: {
              display: true,
              text: "Win Rate %",
              color: '#fff',
              font: { size: 14, weight: 'bold', family: "'Bitter', serif" }
            },
            ticks: {
              color: '#fff',
              font: { size: 12, family: "'Bitter', serif" },
              callback: value => `${value}%`,
              stepSize: 10
            },
            grid: { color: 'rgba(255, 255, 255, 0.1)' },
            min: 0,
            max: Math.min(100, Math.ceil(Math.max(...winRates) / 10) * 10 + 10)
          }
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { 
              color: '#e0e0e0', 
              font: { size: 14, family: "'Bitter', serif" },
              boxWidth: 20,
              padding: 10
            }
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleFont: { 
              family: "'Bitter', serif", 
              size: 14, 
              weight: 'bold',
              color: '#FFD700'
            },
            bodyFont: { 
              family: "'Bitter', serif", 
              size: 12,
              color: '#FFFFFF'
            },
            titleColor: '#FFD700',
            bodyColor: '#FFFFFF',
            callbacks: {
              label: context => {
                if (!context.raw) return [];
                return [
                  `${context.raw.label}`,
                  `Events Played: ${context.raw.x}`,
                  `Win Rate: ${context.raw.y.toFixed(2)}%`
                ];
              }
            },
            borderColor: '#FFD700',
            borderWidth: 1,
            padding: 10,
            displayColors: true
          },
          datalabels: {
            display: true,
            color: '#e0e0e0',
            font: { size: 10, family: "'Bitter', serif" },
            formatter: (value) => value.label,
            align: 'top',
            offset: 4
          },
          zoom: {
            zoom: {
              wheel: { enabled: true, speed: 0.1 },
              drag: {
                enabled: true,
                backgroundColor: 'rgba(0, 0, 255, 0.3)',
                borderColor: 'rgba(0, 0, 255, 0.8)',
                borderWidth: 1
              },
              mode: 'xy'
            },
            pan: { enabled: false },
            limits: {
              x: { min: 0, max: Math.max(...eventCounts) + 1 },
              y: { min: 0, max: Math.min(100, Math.ceil(Math.max(...winRates) / 10) * 10 + 10) }
            }
          }
        },
        animation: { duration: 1000, easing: 'easeOutQuart' }
      }
    });

    // Add double-click to reset zoom
    multiPlayerWinRateCtx.ondblclick = () => {
      multiPlayerWinRateChart.resetZoom();
    };
  } catch (error) {
    console.error("Error initializing Multi-Event Player Win Rate Chart:", error);
  }

  setChartLoading("multiPlayerWinRateChart", false);
}