import { setChartLoading } from '../utils/dom.js';
import { getMetaWinRateChartData } from '../modules/filters.js';
import { calculateMetaWinRateStats } from "../utils/data-chart.js";
import { updateSingleEventTables } from '../modules/event-analysis.js';

export let metaWinRateEventChart = null;

export function updateEventMetaWinRateChart(viewType = 'scatter', sortBy = 'meta') {
  console.log("updateEventMetaWinRateChart called...", { viewType, sortBy });
  setChartLoading("metaWinRateEventChart", true);

  const eventData = getMetaWinRateChartData();
  if (eventData.length === 0) {
    console.log("No data, skipping chart creation...");
    if (metaWinRateEventChart) metaWinRateEventChart.destroy();
    updateSingleEventTables(eventData, 'raw');
    setChartLoading("metaWinRateEventChart", false);
    return;
  }

  const deckData = calculateMetaWinRateStats(eventData);
  let labels, datasets, options;
  
  // Declare variables needed for search outside the view type blocks
  let scatterData = [];
  let deckNames = []; // For bar view labels
  let metaMax = 0;
  let winRateMax = 0;
  let metaMin = 0; // For bar view y-axis

  if (viewType === 'bar') {
    console.log("Sorting bar view with sortBy:", sortBy);
    const sortedDecks = deckData.sort((a, b) => {
      if (sortBy === 'meta') {
        return b.meta - a.meta || a.deck.localeCompare(b.deck);
      } else {
        return b.winRate - a.winRate || a.deck.localeCompare(b.deck);
      }
    });
    console.log("Sorted decks:", sortedDecks.map(d => ({ deck: d.deck, meta: d.meta, winRate: d.winRate })));

    deckNames = sortedDecks.map(d => d.deck);
    const metaPercentages = sortedDecks.map(d => d.meta);
    const winRates = sortedDecks.map(d => d.winRate);
    metaMin = deckNames.length > 0 ? Math.max(0, Math.min(...metaPercentages) - 5) : 0;
    metaMax = deckNames.length > 0 ? Math.max(...metaPercentages) + 5 : 10;
    winRateMax = deckNames.length > 0 ? Math.max(...winRates) : 0; // Need this for zoom reset

    if (deckNames.length === 0) {
      console.log("No decks, skipping chart creation...");
      if (metaWinRateEventChart) metaWinRateEventChart.destroy();
      updateSingleEventTables(eventData, 'raw');
      setChartLoading("metaWinRateEventChart", false);
      return;
    }

    datasets = [
      {
        type: 'bar',
        label: 'Meta %',
        data: metaPercentages,
        backgroundColor: '#CC3700',
        borderColor: '#A32C00',
        borderWidth: 1,
        yAxisID: 'y',
        order: 2
      },
      {
        type: 'bar',
        label: 'Win Rate %',
        data: winRates,
        backgroundColor: '#326789',
        borderColor: '#2A566F',
        borderWidth: 1,
        yAxisID: 'y2',
        order: 1
      }
    ];

    options = {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { 
          min: metaMin, 
          max: metaMax, 
          title: { display: true, text: "Meta %", color: '#fff' }, 
          grid: { color: 'rgba(255, 255, 255, 0.1)' }, 
          ticks: { color: '#fff' } 
        },
        y2: { 
          position: 'right', 
          beginAtZero: true, 
          max: 100, 
          title: { display: true, text: "Win Rate %", color: '#fff' }, 
          grid: { color: 'rgba(255, 255, 255, 0.1)' }, 
          ticks: { color: '#fff' } 
        },
        x: { 
          title: { 
            display: true, 
            text: `Decks (Sorted by ${sortBy === 'meta' ? 'Meta %' : 'Win Rate %'})`, 
            color: '#fff' 
          }, 
          grid: { borderDash: [5, 5], color: 'rgba(255, 255, 255, 0.1)' }, 
          ticks: { color: '#fff', autoSkip: false, maxRotation: 45, minRotation: 45 } 
        }
      }
    };

    labels = deckNames;
  } else if (viewType === 'scatter') {
    scatterData = deckData.map(d => ({
      x: d.meta,
      y: d.winRate,
      label: d.deck,
      count: d.count
    }));

    metaMax = deckData.length > 0 ? Math.max(...deckData.map(d => d.meta)) : 0;
    winRateMax = deckData.length > 0 ? Math.max(...deckData.map(d => d.winRate)) : 0;

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

    // Scatter-specific options including its tooltip
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
            label: context => {
              if (!context.raw) return ''; // Handle cases where raw data might be missing
              return [
                `${context.raw.label}`,
                `Meta: ${context.raw.count} (${context.raw.x.toFixed(2)}%)`,
                `Win Rate: ${context.raw.y.toFixed(2)}%`
              ];
            }
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
  }

  // --- Tooltip callback specifically for Bar View ---
  const barTooltipLabelCallback = (context) => {
    if (!context) return '';
    const deckName = context.label;
    // Find the original deck data entry to get the count
    const originalDeck = deckData.find(d => d.deck === deckName);
    const count = originalDeck ? originalDeck.count : 'N/A';

    if (context.datasetIndex === 0) { // Meta % bar
      const metaPercent = context.raw.toFixed(2);
      return `Meta: ${count} (${metaPercent}%)`;
    } else if (context.datasetIndex === 1) { // Win Rate % bar
      const winRatePercent = context.raw.toFixed(2);
      return `Win Rate: ${winRatePercent}%`;
    }
    return ''; // Default empty label
  };

  if (metaWinRateEventChart) metaWinRateEventChart.destroy();
  const metaWinRateCtx = document.getElementById("metaWinRateEventChart");
  if (!metaWinRateCtx) {
    console.error("Meta Win Rate Event Chart canvas not found!");
    setChartLoading("metaWinRateEventChart", false);
    return;
  }

  // Add searchable dropdown
  const chartContainer = metaWinRateCtx.parentElement;
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
    chartContainer.insertBefore(searchContainer, metaWinRateCtx);

    // Add event listeners for search functionality
    searchInput.addEventListener('input', (e) => {
      if (!metaWinRateEventChart) return; // Ensure chart exists
      const searchTerm = e.target.value.toLowerCase();
      const currentViewType = chartContainer.dataset.currentView;

      // If search input is cleared, reset the chart
      if (searchTerm === '') {
        // Reset appearance
        if (currentViewType === 'scatter') {
          const dataset = metaWinRateEventChart.data.datasets[0];
          dataset.pointRadius = dataset.data.map(() => 8);
          dataset.pointHoverRadius = dataset.data.map(() => 10);
          dataset.backgroundColor = dataset.data.map(() => '#FFD700');
          dataset.borderColor = dataset.data.map(() => '#DAA520');
          dataset.pointStyle = dataset.data.map(() => 'circle'); // Reset point style
        } else { // bar view
          const metaDataset = metaWinRateEventChart.data.datasets[0];
          const winRateDataset = metaWinRateEventChart.data.datasets[1];
          
          // Reset Meta % bars
          metaDataset.backgroundColor = metaDataset.data.map(() => '#CC3700');
          metaDataset.borderColor = metaDataset.data.map(() => '#A32C00');
          metaDataset.borderWidth = metaDataset.data.map(() => 1);
          
          // Reset Win Rate % bars
          winRateDataset.backgroundColor = winRateDataset.data.map(() => '#326789');
          winRateDataset.borderColor = winRateDataset.data.map(() => '#2A566F');
          winRateDataset.borderWidth = winRateDataset.data.map(() => 1);
        }
        
        // Reset zoom based on current view type
        if (currentViewType === 'scatter') {
          metaWinRateEventChart.options.scales.x.min = 0;
          metaWinRateEventChart.options.scales.x.max = metaMax > 0 ? Math.ceil(metaMax / 5) * 5 + 5 : 10;
          metaWinRateEventChart.options.scales.y.min = 0;
          metaWinRateEventChart.options.scales.y.max = winRateMax > 0 ? Math.min(100, Math.ceil(winRateMax / 10) * 10 + 10) : 100;
        } else { // bar view
          const originalDeckNames = calculateMetaWinRateStats(eventData).map(d => d.deck); // Need original names for count
          metaWinRateEventChart.options.scales.x.min = undefined; // Use Chart.js default for category scale
          metaWinRateEventChart.options.scales.x.max = undefined;
          metaWinRateEventChart.options.scales.y.min = metaMin;
          metaWinRateEventChart.options.scales.y.max = metaMax;
          metaWinRateEventChart.options.scales.y2.min = 0;
          metaWinRateEventChart.options.scales.y2.max = 100;
        }
        
        metaWinRateEventChart.update();
        dropdown.style.display = 'none';
        return;
      }
      
      // Get deck names based on current view type
      let currentDeckNames;
      if (currentViewType === 'scatter') {
        currentDeckNames = metaWinRateEventChart.data.datasets[0].data.map(point => point.label);
      } else { // bar view
        currentDeckNames = metaWinRateEventChart.data.labels;
      }
      
      const filteredDecks = currentDeckNames.filter(deck => 
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
        
        deckDiv.addEventListener('mouseover', () => deckDiv.style.backgroundColor = '#444');
        deckDiv.addEventListener('mouseout', () => deckDiv.style.backgroundColor = 'transparent');
        
        deckDiv.addEventListener('click', () => {
          if (!metaWinRateEventChart) return; // Ensure chart exists
          searchInput.value = deck;
          dropdown.style.display = 'none';
          
          const currentViewTypeOnClick = chartContainer.dataset.currentView;
          
          // Find and highlight the selected deck
          if (currentViewTypeOnClick === 'scatter') {
            const dataset = metaWinRateEventChart.data.datasets[0];
            const pointIndex = dataset.data.findIndex(d => d.label === deck);
            if (pointIndex !== -1) {
              // Reset all points to default
              dataset.pointRadius = dataset.data.map(() => 8);
              dataset.pointHoverRadius = dataset.data.map(() => 10);
              dataset.backgroundColor = dataset.data.map(() => '#FFD700');
              dataset.borderColor = dataset.data.map(() => '#DAA520');
              dataset.pointStyle = dataset.data.map(() => 'circle'); // Reset point style
              
              // Highlight selected point (Red, Larger, Diamond)
              dataset.pointRadius[pointIndex] = 18;
              dataset.pointHoverRadius[pointIndex] = 20;
              dataset.backgroundColor[pointIndex] = '#FF0000';
              dataset.borderColor[pointIndex] = '#CC0000';
              dataset.pointStyle[pointIndex] = 'rectRot'; // Change shape to diamond
              
              // Center view on selected point
              const xValue = dataset.data[pointIndex].x;
              const yValue = dataset.data[pointIndex].y;
              metaWinRateEventChart.options.scales.x.min = Math.max(0, xValue - 5);
              metaWinRateEventChart.options.scales.x.max = xValue + 5;
              metaWinRateEventChart.options.scales.y.min = Math.max(0, yValue - 20);
              metaWinRateEventChart.options.scales.y.max = Math.min(100, yValue + 20);
            }
          } else { // bar view
            const barIndex = metaWinRateEventChart.data.labels.indexOf(deck);
            if (barIndex !== -1) {
              const metaDataset = metaWinRateEventChart.data.datasets[0];
              const winRateDataset = metaWinRateEventChart.data.datasets[1];

              // Reset all bars to default
              metaDataset.backgroundColor = metaDataset.data.map(() => '#CC3700');
              metaDataset.borderColor = metaDataset.data.map(() => '#A32C00');
              metaDataset.borderWidth = metaDataset.data.map(() => 1); // Reset border width
              winRateDataset.backgroundColor = winRateDataset.data.map(() => '#326789');
              winRateDataset.borderColor = winRateDataset.data.map(() => '#2A566F');
              winRateDataset.borderWidth = winRateDataset.data.map(() => 1); // Reset border width
              
              // Highlight selected bar (both meta and win rate) with AMBER and THICKER BORDER
              metaDataset.backgroundColor[barIndex] = '#E69F00'; // Amber background
              metaDataset.borderColor[barIndex] = '#B88000'; // Darker Amber border
              metaDataset.borderWidth[barIndex] = 3; // Increased border width
              winRateDataset.backgroundColor[barIndex] = '#E69F00'; // Use same highlight for consistency
              winRateDataset.borderColor[barIndex] = '#B88000'; // Darker Amber border
              winRateDataset.borderWidth[barIndex] = 3; // Increased border width
              
              // Center view on selected bar - adjust x-axis range
              metaWinRateEventChart.options.scales.x.min = Math.max(0, barIndex - 5);
              metaWinRateEventChart.options.scales.x.max = Math.min(metaWinRateEventChart.data.labels.length - 1, barIndex + 5);
              // Optionally adjust y-axes if needed, but focusing x is usually sufficient for bars
            }
          }
          
          metaWinRateEventChart.update();
        });
        
        dropdown.appendChild(deckDiv);
      });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const searchContainerElement = chartContainer.querySelector('.deck-search-container'); // Re-query in case it was recreated
      if (searchContainerElement && !searchContainerElement.contains(e.target)) {
        const dropdownElement = searchContainerElement.querySelector('.deck-dropdown');
        if (dropdownElement) dropdownElement.style.display = 'none';
      }
    });
  } else {
    // Update search functionality if container already exists?
    // This might be needed if the function is called multiple times without page refresh
    // For now, assume the listeners persist
  }

  try {
    console.log("Creating new chart with viewType:", viewType, "sortBy:", sortBy);
    metaWinRateEventChart = new Chart(metaWinRateCtx, {
      data: { labels, datasets },
      options: {
        // Start with base options determined by viewType
        ...options, 
        plugins: {
          // Merge common plugin settings
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
            // Apply view-specific tooltip callbacks
            callbacks: viewType === 'bar' ? { label: barTooltipLabelCallback } : options.plugins.tooltip.callbacks,
            // Common tooltip styling
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleFont: { family: "'Bitter', serif", size: 14, weight: 'bold' },
            bodyFont: { family: "'Bitter', serif", size: 12 },
            titleColor: '#FFFFFF',
            bodyColor: '#FFFFFF',
            borderColor: '#FFD700',
            borderWidth: 1,
            padding: 10
          },
          // Apply view-specific datalabels or common fallback
          datalabels: options.plugins?.datalabels || { display: false }, 
          // Apply view-specific zoom settings
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
            // View-specific zoom limits
            limits: viewType === 'bar' 
              ? { y: { min: metaMin, max: metaMax }, y2: { min: 0, max: 100 } }
              : { x: { min: 0, max: metaMax > 0 ? Math.ceil(metaMax / 5) * 5 + 5 : 10 }, 
                  y: { min: 0, max: winRateMax > 0 ? Math.min(100, Math.ceil(winRateMax / 10) * 10 + 10) : 100 } }
          }
        },
        // Common animation
        animation: {
          duration: 1000,
          easing: 'easeOutQuart'
        },
        // View-specific elements
        elements: viewType === 'bar' ? {
          bar: { borderRadius: 4, borderSkipped: false }
        } : {
          point: { pointStyle: 'circle' }
        }
      }
    });

    metaWinRateCtx.ondblclick = () => {
      metaWinRateEventChart.resetZoom();
    };
  } catch (error) {
    console.error("Error initializing Meta/Win Rate Chart:", error);
  }

  let toggleDiv = chartContainer.querySelector('.sort-toggle');
  if (!toggleDiv) {
    toggleDiv = document.createElement('div');
    toggleDiv.className = 'sort-toggle';
    toggleDiv.innerHTML = `
      <button class="table-toggle-btn ${viewType === 'scatter' ? 'active' : ''}" data-view="scatter">Scatter View</button>
      <button class="table-toggle-btn ${viewType === 'bar' ? 'active' : ''}" data-view="bar">Bar View</button>
    `;
    chartContainer.insertBefore(toggleDiv, metaWinRateCtx);

    toggleDiv.querySelectorAll('.table-toggle-btn').forEach(button => {
      button.addEventListener('click', () => {
        console.log("View toggled to:", button.dataset.view);
        toggleDiv.querySelectorAll('.table-toggle-btn').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        const newViewType = button.dataset.view;
        updateEventMetaWinRateChart(newViewType, newViewType === 'bar' ? sortBy : null);
        updateSortOptionsVisibility(newViewType);
      });
    });
  } else {
    toggleDiv.querySelectorAll('.table-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewType);
    });
  }

  let sortOptionsDiv = chartContainer.querySelector('.bar-sort-options');
  if (!sortOptionsDiv) {
    sortOptionsDiv = document.createElement('div');
    sortOptionsDiv.className = 'bar-sort-options';
    sortOptionsDiv.innerHTML = `
      <span class="sort-label">Sort by:</span>
      <label><input type="radio" name="barSort" value="meta" ${sortBy === 'meta' ? 'checked' : ''}> Meta</label>
      <label><input type="radio" name="barSort" value="winRate" ${sortBy === 'winRate' ? 'checked' : ''}> Win Rate</label>
    `;
    chartContainer.insertBefore(sortOptionsDiv, metaWinRateCtx);

    sortOptionsDiv.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const newSortBy = radio.value;
        console.log("Radio changed, calling update with sortBy:", newSortBy);
        updateEventMetaWinRateChart('bar', newSortBy);
      });
    });
  } else {
    sortOptionsDiv.querySelector(`input[value="meta"]`).checked = sortBy === 'meta';
    sortOptionsDiv.querySelector(`input[value="winRate"]`).checked = sortBy === 'winRate';
  }

  updateSortOptionsVisibility(viewType);
  updateSingleEventTables(eventData, 'raw');

  // Store the current view type on the container 
  if (chartContainer) {
    chartContainer.dataset.currentView = viewType;
  }

  setChartLoading("metaWinRateEventChart", false);
}

function updateSortOptionsVisibility(viewType) {
  // Implementation of updateSortOptionsVisibility function
}