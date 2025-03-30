import { setChartLoading } from '../utils/dom.js';
import { getFunnelChartData } from '../modules/filters.js';
import { calculateDeckConversionStats } from "../utils/data-chart.js";

export let eventFunnelChart = null;

export function updateEventFunnelChart() {
  console.log("updateEventFunnelChart called...");
  setChartLoading("eventFunnelChart", true);

  const chartData = getFunnelChartData();
  if (chartData.length === 0) {
    if (eventFunnelChart) eventFunnelChart.destroy();
    setChartLoading("eventFunnelChart", false);
    return;
  }

  const sortedDecksData = calculateDeckConversionStats(chartData);
  const labels = sortedDecksData.map(item => item.deck);
  const datasets = [
    {
      label: "1st–8th",
      data: sortedDecksData.map(item => item.data[0]),
      backgroundColor: '#CCAC00',
      borderColor: '#B59400',
      borderWidth: 1
    },
    {
      label: "9th–16th",
      data: sortedDecksData.map(item => item.data[1]),
      backgroundColor: '#00CCCC',
      borderColor: '#00A3A3',
      borderWidth: 1
    },
    {
      label: "17th–32nd",
      data: sortedDecksData.map(item => item.data[2]),
      backgroundColor: '#CC3700',
      borderColor: '#A32C00',
      borderWidth: 1
    },
    {
      label: "33rd+",
      data: sortedDecksData.map(item => item.data[3]),
      backgroundColor: '#A9A9A9',
      borderColor: '#808080',
      borderWidth: 1
    }
  ];

  if (eventFunnelChart) eventFunnelChart.destroy();
  const eventFunnelCtx = document.getElementById("eventFunnelChart");
  if (!eventFunnelCtx) {
    console.error("Event Funnel Chart canvas not found!");
    setChartLoading("eventFunnelChart", false);
    return;
  }

  try {
    eventFunnelChart = new Chart(eventFunnelCtx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: datasets
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            max: 100,
            title: {
              display: true,
              text: "Conversion Rate (%)",
              color: '#FFFFFF',
              font: { size: 16, weight: 'bold', family: "'Bitter', serif" }
            },
            ticks: {
              color: '#FFFFFF',
              font: { size: 12, family: "'Bitter', serif" },
              callback: value => `${value}%`
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)',
              borderDash: [5, 5],
              borderColor: '#FFFFFF'
            }
          },
          y: {
            stacked: true,
            title: {
              display: true,
              text: "Decks",
              color: '#FFFFFF',
              font: { size: 16, weight: 'bold', family: "'Bitter', serif" }
            },
            ticks: {
              color: '#FFFFFF',
              font: { size: 12, family: "'Bitter', serif" }
            },
            grid: { display: false }
          }
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#e0e0e0',
              font: { size: 12, family: "'Bitter', serif" },
              padding: 10,
              boxWidth: 20,
              usePointStyle: true
            }
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleFont: { family: "'Bitter', serif", size: 14, weight: 'bold' },
            bodyFont: { family: "'Bitter', serif", size: 12 },
            titleColor: '#FFFFFF',
            bodyColor: '#FFFFFF',
            callbacks: {
              label: context => {
                const value = context.raw.toFixed(2);
                return `${context.dataset.label}: ${value}%`;
              }
            },
            borderColor: '#FFD700',
            borderWidth: 1,
            padding: 10
          },
          datalabels: {
            display: context => context.dataset.data[context.dataIndex] > 5,
            color: '#000000',
            font: { size: 12, weight: 'bold', family: "'Bitter', serif" },
            formatter: value => `${value.toFixed(0)}%`
          }
        },
        animation: {
          duration: 1000,
          easing: 'easeOutQuart'
        },
        elements: {
          bar: {
            borderRadius: 4,
            borderSkipped: false
          }
        }
      }
    });
  } catch (error) {
    console.error("Error initializing Event Funnel Chart:", error);
  }
  setChartLoading("eventFunnelChart", false);
}