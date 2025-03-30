import { setChartLoading } from '../utils/dom.js';
import { getMultiEventChartData } from '../modules/filters.js';
import { calculateMetaWinRateStats } from "../utils/data-chart.js";

export let metaWinRateChart = null;

export function updateMultiMetaWinRateChart(viewType = 'bar', sortBy = 'meta') {
  console.log("updateMultiMetaWinRateChart called...", { viewType, sortBy });
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

    const deckNames = sortedDecks.map(d => d.deck);
    const metaPercentages = sortedDecks.map(d => d.meta);
    const winRates = sortedDecks.map(d => d.winRate);
    const metaMin = Math.max(0, Math.min(...metaPercentages) - 5);
    const metaMax = Math.max(...metaPercentages) + 5;

    if (deckNames.length === 0) {
      console.log("No decks, skipping chart creation...");
      if (metaWinRateChart) metaWinRateChart.destroy();
      setChartLoading("metaWinRateChart", false);
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
    const scatterData = deckData.map(d => ({
      x: d.meta,
      y: d.winRate,
      label: d.deck,
      count: d.count
    }));

    const metaMax = Math.max(...deckData.map(d => d.meta));
    const winRateMax = Math.max(...deckData.map(d => d.winRate));

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
          ticks: { color: '#fff', stepSize: Math.ceil(metaMax / 10) },
          min: 0,
          max: Math.ceil(metaMax / 5) * 5 + 5
        },
        y: {
          title: { display: true, text: "Win Rate %", color: '#fff' },
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
          ticks: { color: '#fff', stepSize: 10 },
          min: 0,
          max: Math.min(100, Math.ceil(winRateMax / 10) * 10 + 10)
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: context => `${context.raw.label}: Copies ${context.raw.count}, Win Rate ${context.raw.y.toFixed(2)}%`
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

  if (metaWinRateChart) metaWinRateChart.destroy();
  const metaWinRateMultiCtx = document.getElementById("metaWinRateChart");
  if (!metaWinRateMultiCtx) {
    console.error("Meta Win Rate Chart (Multi-Event) canvas not found!");
    setChartLoading("metaWinRateChart", false);
    return;
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
            limits: viewType === 'bar' 
              ? { y: { min: options.scales.y.min, max: options.scales.y.max }, y2: { min: 0, max: 100 } }
              : { x: { min: 0, max: options.scales.x.max }, y: { min: 0, max: options.scales.y.max } }
          }
        },
        animation: { duration: 1000, easing: 'easeOutQuart' },
        elements: viewType === 'bar' ? { bar: { borderRadius: 4, borderSkipped: false } } : { point: { pointStyle: 'circle' } }
      }
    });

    metaWinRateMultiCtx.ondblclick = () => metaWinRateChart.resetZoom();
  } catch (error) {
    console.error("Error initializing Multi-Event Meta/Win Rate Chart:", error);
  }

  const chartContainer = document.querySelector('#metaWinRateChartContainer') || document.querySelector('#multiEventCharts');
  if (!chartContainer) {
    console.error("Chart container not found!");
    setChartLoading("metaWinRateChart", false);
    return;
  }

  let toggleDiv = chartContainer.querySelector('.sort-toggle');
  if (!toggleDiv) {
    toggleDiv = document.createElement('div');
    toggleDiv.className = 'sort-toggle';
    toggleDiv.innerHTML = `
      <button class="table-toggle-btn ${viewType === 'bar' ? 'active' : ''}" data-view="bar">Bar View</button>
      <button class="table-toggle-btn ${viewType === 'scatter' ? 'active' : ''}" data-view="scatter">Scatter View</button>
    `;
    chartContainer.insertBefore(toggleDiv, metaWinRateMultiCtx);

    toggleDiv.querySelectorAll('.table-toggle-btn').forEach(button => {
      button.addEventListener('click', () => {
        toggleDiv.querySelectorAll('.table-toggle-btn').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        const newViewType = button.dataset.view;
        console.log("View toggled to:", newViewType);
        updateMultiMetaWinRateChart(newViewType, newViewType === 'bar' ? sortBy : null);
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
    console.log("Creating .bar-sort-options div");
    sortOptionsDiv = document.createElement('div');
    sortOptionsDiv.className = 'bar-sort-options';
    sortOptionsDiv.innerHTML = `
      <span class="sort-label">Sort by:</span>
      <label><input type="radio" name="barSortMulti" value="meta" ${sortBy === 'meta' ? 'checked' : ''}> Meta</label>
      <label><input type="radio" name="barSortMulti" value="winRate" ${sortBy === 'winRate' ? 'checked' : ''}> Win Rate</label>
    `;
    chartContainer.insertBefore(sortOptionsDiv, metaWinRateMultiCtx);

    sortOptionsDiv.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const newSortBy = radio.value;
        console.log("Radio changed, calling update with sortBy:", newSortBy);
        updateMultiMetaWinRateChart('bar', newSortBy);
      });
    });
  } else {
    sortOptionsDiv.querySelector(`input[value="meta"]`).checked = sortBy === 'meta';
    sortOptionsDiv.querySelector(`input[value="winRate"]`).checked = sortBy === 'winRate';
  }

  console.log("Updating sort options visibility for viewType:", viewType);
  updateSortOptionsVisibility(viewType);

  setChartLoading("metaWinRateChart", false);
}

function updateSortOptionsVisibility(viewType) {
  const sortOptionsDiv = document.querySelector('#metaWinRateChartContainer .bar-sort-options');
  if (sortOptionsDiv) {
    console.log("Setting .bar-sort-options display to:", viewType === 'bar' ? 'block' : 'none');
    sortOptionsDiv.style.display = viewType === 'bar' ? 'block' : 'none';
  } else {
    console.log("No .bar-sort-options div found in #metaWinRateChartContainer");
  }
}