// Small DOM helpers shared by modules and charts. Keeping these defensive
// wrappers in one place makes missing-element warnings consistent during UI work.

// ChartDataLabels is loaded globally from the CDN in index.html before modules run.
Chart.register(ChartDataLabels);
// Shows or hides the loading indicator paired with a chart canvas id.
export function setChartLoading(chartId, isLoading) {
  const loadingElement = document.getElementById(`${chartId}Loading`);
  if (loadingElement) {
    loadingElement.style.display = isLoading ? 'block' : 'none';
  }
}

// Hides stat cards when their backing data is empty while keeping layout rules in
// CSS.
export function toggleStatCardVisibility(cardId, hasData) {
  const card = document.getElementById(cardId);
  if (card) {
    card.classList.toggle('hidden', !hasData);
  }
}

// Safely updates textContent and warns when a caller targets a missing element.
export function updateElementText(elementId, text) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = text;
  } else {
    console.warn(`Element with ID '${elementId}' not found`);
  }
}

// Safely updates innerHTML and warns when a caller targets a missing element.
export function updateElementHTML(elementId, html) {
  const element = document.getElementById(elementId);
  if (element) {
    element.innerHTML = html;
  } else {
    console.warn(`Element with ID '${elementId}' not found`);
  }
}

// Restarts the CSS "updated" animation for cards/summaries after data refreshes.
export function triggerUpdateAnimation(elementId) {
  const element = document.getElementById(elementId);
  if (!element) return;

  element.classList.remove('updated');
  // Reading offsetWidth forces a reflow so re-adding the class restarts the CSS
  // animation even when the same card updates repeatedly.
  void element.offsetWidth;
  element.classList.add('updated');

  if (element.updateAnimationTimeoutId) {
    clearTimeout(element.updateAnimationTimeoutId);
  }

  element.updateAnimationTimeoutId = window.setTimeout(() => {
    element.classList.remove('updated');
    element.updateAnimationTimeoutId = null;
  }, 500);
}
