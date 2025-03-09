// js/utils/dom.js
export function setChartLoading(chartId, isLoading) {
  const loadingElement = document.getElementById(`${chartId}Loading`);
  if (loadingElement) {
    loadingElement.style.display = isLoading ? 'block' : 'none';
  }
}

export function toggleStatCardVisibility(cardId, hasData) {
  const card = document.getElementById(cardId);
  if (card) {
    card.classList.toggle('hidden', !hasData);
  }
}

export function updateElementText(elementId, text) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = text;
  } else {
    console.warn(`Element with ID '${elementId}' not found`);
  }
}

export function updateElementHTML(elementId, html) {
  const element = document.getElementById(elementId);
  if (element) {
    element.innerHTML = html;
  } else {
    console.warn(`Element with ID '${elementId}' not found`);
  }
}