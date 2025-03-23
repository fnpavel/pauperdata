// js/utils/u-chart.js

Chart.register(ChartDataLabels);

export function toggleDataset(chart, index) {
  const meta = chart.getDatasetMeta(index);
  meta.hidden = meta.hidden === null ? !chart.data.datasets[index].hidden : null;
  const legendItem = document.querySelector(`.custom-legend li[data-index="${index}"]`);
  if (legendItem) {
    legendItem.classList.toggle('hidden', meta.hidden);
  }
  chart.update();
}

export function destroyChart(chartInstance) {
  if (chartInstance) {
    chartInstance.destroy();
  }
}