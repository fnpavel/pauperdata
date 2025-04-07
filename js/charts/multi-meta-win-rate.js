import { setChartLoading } from '../utils/dom.js';
import { getMultiEventChartData } from '../modules/filters.js';
import { calculateMetaWinRateStats } from "../utils/data-chart.js";

export let metaWinRateChart = null;

export function updateMultiMetaWinRateChart() {
  console.log("updateMultiMetaWinRateChart called...");
  setChartLoading("metaWinRateChart", true);

  const filteredData = getMultiEventChartData();
  if (filteredData.length === 0) {
    console.log("No filtered data, skipping chart creation...");
    if (metaWinRateChart) metaWinRateChart.destroy();
    setChartLoading("metaWinRateChart", false);
    return;
  }

  const deckData = calculateMetaWinRateStats(filteredData);
  let labels, datasets, options;

  // Scatter view logic
  const scatterData = deckData.map(d => ({
    x: d.meta,
    y: d.winRate,
    label: d.deck,
    count: d.count
  }));

  const metaMax = deckData.length > 0 ? Math.max(...deckData.map(d => d.meta)) : 0;
  const winRateMax = deckData.length > 0 ? Math.max(...deckData.map(d => d.winRate)) : 0;

  if (deckData.length === 0) {
    console.log("No decks, skipping chart creation...");
    if (metaWinRateChart) metaWinRateChart.destroy();
    setChartLoading("metaWinRateChart", false);
    return;
  }

  datasets = [
    {
      type: 'scatter',
      label: 'Decks',
      data: scatterData,
      backgroundColor: '#FFD700',
      borderColor: '#DAA520',
      borderWidth: 1,
      pointRadius: 8,
      pointHoverRadius: 10
    }
  ];

  options = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        title: { display: true, text: "Meta %", color: '#fff' },
        grid: { color: 'rgba(255, 255, 255, 0.1)' },
        ticks: { color: '#fff', stepSize: metaMax > 0 ? Math.ceil(metaMax / 10) : 1 },
        min: 0,
        max: metaMax > 0 ? Math.ceil(metaMax / 5) * 5 + 5 : 10
      },
      y: {
        title: { display: true, text: "Win Rate %", color: '#fff' },
        grid: { color: 'rgba(255, 255, 255, 0.1)' },
        ticks: { color: '#fff', stepSize: 10 },
        min: 0,
        max: winRateMax > 0 ? Math.min(100, Math.ceil(winRateMax / 10) * 10 + 10) : 100
      }
    },
    plugins: {
      tooltip: {
        callbacks: {
          label: context => [
            `${context.raw.label}`,
            `Copies: ${context.raw.count}`,
            `Win Rate: ${context.raw.y.toFixed(2)}%`
          ]
        }
      },
      datalabels: {
        display: true,
        color: '#e0e0e0',
        font: { size: 10, family: "'Bitter', serif" },
        formatter: (value) => value.label,
        align: 'top',
        offset: 4
      }
    }
  };

  labels = [];

  if (metaWinRateChart) metaWinRateChart.destroy();
  const metaWinRateMultiCtx = document.getElementById("metaWinRateChart");
  if (!metaWinRateMultiCtx) {
    console.error("Meta Win Rate Chart (Multi-Event) canvas not found!");
    setChartLoading("metaWinRateChart", false);
    return;
  }

  // Add searchable dropdown
  const chartContainer = metaWinRateMultiCtx.parentElement;
  let searchContainer = chartContainer.querySelector('.deck-search-container');
  if (!searchContainer) {
    searchContainer = document.createElement('div');
    searchContainer.className = 'deck-search-container';
    searchContainer.style.marginBottom = '15px';
    searchContainer.style.position = 'relative';
    
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search decks...';
    searchInput.className = 'deck-search-input';
    searchInput.style.width = '100%';
    searchInput.style.padding = '8px';
    searchInput.style.borderRadius = '4px';
    searchInput.style.backgroundColor = '#2a2a2a';
    searchInput.style.border = '1px solid #444';
    searchInput.style.color = '#fff';
    searchInput.style.fontFamily = "'Bitter', serif";
    
    const dropdown = document.createElement('div');
    dropdown.className = 'deck-dropdown';
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
    chartContainer.insertBefore(searchContainer, metaWinRateMultiCtx);

    // Add event listeners for search functionality
    searchInput.addEventListener('input', (e) => {
      if (!metaWinRateChart) return; // Ensure chart exists
      const searchTerm = e.target.value.toLowerCase();
      
      // If search input is cleared, reset the chart
      if (searchTerm === '') {
        const dataset = metaWinRateChart.data.datasets[0];
        // Reset all points to default size and color
        dataset.pointRadius = dataset.data.map(() => 8);
        dataset.pointHoverRadius = dataset.data.map(() => 10);
        dataset.backgroundColor = dataset.data.map(() => '#FFD700');
        dataset.borderColor = dataset.data.map(() => '#DAA520');
        dataset.pointStyle = dataset.data.map(() => 'circle'); // Reset point style
        
        // Reset zoom by setting axis limits directly
        metaWinRateChart.options.scales.x.min = 0;
        metaWinRateChart.options.scales.x.max = metaMax > 0 ? Math.ceil(metaMax / 5) * 5 + 5 : 10;
        metaWinRateChart.options.scales.y.min = 0;
        metaWinRateChart.options.scales.y.max = winRateMax > 0 ? Math.min(100, Math.ceil(winRateMax / 10) * 10 + 10) : 100;
        
        metaWinRateChart.update();
        dropdown.style.display = 'none';
        return;
      }
      
      // Get deck names from the chart's dataset
      const deckNames = metaWinRateChart.data.datasets[0].data.map(point => point.label);
      const filteredDecks = deckNames.filter(deck => 
        deck && deck.toLowerCase().includes(searchTerm)
      );
      
      dropdown.innerHTML = '';
      dropdown.style.display = filteredDecks.length > 0 ? 'block' : 'none';
      
      filteredDecks.forEach(deck => {
        const deckDiv = document.createElement('div');
        deckDiv.textContent = deck;
        deckDiv.style.padding = '8px';
        deckDiv.style.cursor = 'pointer';
        deckDiv.style.color = '#fff';
        deckDiv.style.fontFamily = "'Bitter', serif";
        deckDiv.style.fontWeight = 'bold';
        deckDiv.style.borderBottom = '1px solid #444';
        
        deckDiv.addEventListener('mouseover', () => {
          deckDiv.style.backgroundColor = '#444';
        });
        
        deckDiv.addEventListener('mouseout', () => {
          deckDiv.style.backgroundColor = 'transparent';
        });
        
        deckDiv.addEventListener('click', () => {
          if (!metaWinRateChart) return; // Ensure chart exists
          searchInput.value = deck;
          dropdown.style.display = 'none';
          
          // Find and highlight the selected deck's point
          const dataset = metaWinRateChart.data.datasets[0];
          const pointIndex = dataset.data.findIndex(d => d.label === deck);
          if (pointIndex !== -1) {
            // Reset all points to default
            dataset.pointRadius = dataset.data.map(() => 8);
            dataset.pointHoverRadius = dataset.data.map(() => 10);
            dataset.backgroundColor = dataset.data.map(() => '#FFD700');
            dataset.borderColor = dataset.data.map(() => '#DAA520');
            dataset.pointStyle = dataset.data.map(() => 'circle'); // Reset point style
            
            // Highlight selected point
            dataset.pointRadius[pointIndex] = 18;
            dataset.pointHoverRadius[pointIndex] = 20;
            dataset.backgroundColor[pointIndex] = '#FF0000';
            dataset.borderColor[pointIndex] = '#CC0000';
            dataset.pointStyle[pointIndex] = 'rectRot'; // Change shape to diamond
            
            // Center view on selected point
            const xValue = dataset.data[pointIndex].x;
            const yValue = dataset.data[pointIndex].y;
            metaWinRateChart.options.scales.x.min = Math.max(0, xValue - 5);
            metaWinRateChart.options.scales.x.max = xValue + 5;
            metaWinRateChart.options.scales.y.min = Math.max(0, yValue - 20);
            metaWinRateChart.options.scales.y.max = Math.min(100, yValue + 20);
          }
          
          metaWinRateChart.update();
        });
        
        dropdown.appendChild(deckDiv);
      });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!searchContainer.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });
  } else {
    // Update search functionality if container already exists
    const searchInput = searchContainer.querySelector('.deck-search-input');
    const dropdown = searchContainer.querySelector('.deck-dropdown');
    // We might need to re-attach listeners if the element is recreated, but for now assume it persists
  }

  try {
    metaWinRateChart = new Chart(metaWinRateMultiCtx, {
      data: { labels, datasets },
      options: {
        ...options,
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
            ...options.plugins?.tooltip,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleFont: { family: "'Bitter', serif", size: 14, weight: 'bold' },
            bodyFont: { family: "'Bitter', serif", size: 12 },
            titleColor: '#FFFFFF',
            bodyColor: '#FFFFFF',
            borderColor: '#FFD700',
            borderWidth: 1,
            padding: 10
          },
          datalabels: options.plugins?.datalabels || { display: false },
          zoom: {
            zoom: {
              wheel: { enabled: true, speed: 0.1 },
              drag: { enabled: true, backgroundColor: 'rgba(0, 0, 255, 0.3)', borderColor: 'rgba(0, 0, 255, 0.8)', borderWidth: 1 },
              mode: 'xy'
            },
            pan: { enabled: false },
            limits: {
              x: { min: 0, max: metaMax > 0 ? Math.ceil(metaMax / 5) * 5 + 5 : 10 },
              y: { min: 0, max: winRateMax > 0 ? Math.min(100, Math.ceil(winRateMax / 10) * 10 + 10) : 100 }
            }
          }
        },
        animation: { duration: 1000, easing: 'easeOutQuart' },
        elements: { point: { pointStyle: 'circle' } }
      }
    });

    metaWinRateMultiCtx.ondblclick = () => metaWinRateChart.resetZoom();
  } catch (error) {
    console.error("Error initializing Multi-Event Meta/Win Rate Chart:", error);
  }

  // Remove toggle buttons and sort options elements if they exist
  const existingToggleDiv = chartContainer.querySelector('.sort-toggle');
  if (existingToggleDiv) existingToggleDiv.remove();
  const existingSortOptionsDiv = chartContainer.querySelector('.bar-sort-options');
  if (existingSortOptionsDiv) existingSortOptionsDiv.remove();

  setChartLoading("metaWinRateChart", false);
}