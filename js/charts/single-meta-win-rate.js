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

  if (metaWinRateEventChart) metaWinRateEventChart.destroy();
  const metaWinRateCtx = document.getElementById("metaWinRateEventChart");
  if (!metaWinRateCtx) {
    console.error("Meta Win Rate Event Chart canvas not found!");
    setChartLoading("metaWinRateEventChart", false);
    return;
  }

  try {
    console.log("Creating new chart with viewType:", viewType, "sortBy:", sortBy);
    metaWinRateEventChart = new Chart(metaWinRateCtx, {
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
              drag: {
                enabled: true,
                backgroundColor: 'rgba(0, 0, 255, 0.3)',
                borderColor: 'rgba(0, 0, 255, 0.8)',
                borderWidth: 1
              },
              mode: 'xy'
            },
            pan: { enabled: false },
            limits: viewType === 'bar' 
              ? { y: { min: options.scales.y.min, max: options.scales.y.max }, y2: { min: 0, max: 100 } }
              : { x: { min: 0, max: options.scales.x.max }, y: { min: 0, max: options.scales.y.max } }
          }
        },
        animation: {
          duration: 1000,
          easing: 'easeOutQuart'
        },
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

  const chartContainer = document.querySelector('#metaWinRateEventChart').parentElement;
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

  const toggleButtons = document.querySelectorAll('.table-toggle-btn');
  toggleButtons.forEach(button => {
    button.addEventListener('click', () => {
      toggleButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      const tableType = button.dataset.table;
      updateSingleEventTables(eventData, tableType);
    });
  });

  setChartLoading("metaWinRateEventChart", false);
}

function updateSortOptionsVisibility(viewType) {
  const sortOptionsDiv = document.querySelector('.bar-sort-options');
  if (sortOptionsDiv) {
    sortOptionsDiv.style.display = viewType === 'bar' ? 'block' : 'none';
  }
}