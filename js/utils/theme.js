export const THEME_STORAGE_KEY = 'mtg-tracker-theme';
const THEME_CHANGE_EVENT = 'mtg-theme-change';

function canUseLocalStorage() {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch (error) {
    return false;
  }
}

function getSystemThemePreference() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function getStoredThemePreference() {
  if (!canUseLocalStorage()) {
    return '';
  }

  return window.localStorage.getItem(THEME_STORAGE_KEY) || '';
}

export function getActiveTheme() {
  return document.documentElement.dataset.theme || getStoredThemePreference() || getSystemThemePreference();
}

function saveThemePreference(theme) {
  if (!canUseLocalStorage()) {
    return;
  }

  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

function getThemeLabel(theme) {
  return theme === 'light' ? 'Light Mode' : 'Dark Mode';
}

export function syncThemeToggleButton() {
  const button = document.getElementById('themeToggleButton');
  if (!button) {
    return;
  }

  const label = button.querySelector('.theme-toggle-label');
  const activeTheme = getActiveTheme();
  const nextTheme = activeTheme === 'light' ? 'dark' : 'light';

  button.dataset.theme = activeTheme;
  button.setAttribute('aria-pressed', activeTheme === 'light' ? 'true' : 'false');
  button.setAttribute('aria-label', `Switch to ${getThemeLabel(nextTheme)}`);

  if (label) {
    label.textContent = getThemeLabel(activeTheme);
  }
}

export function applyTheme(theme, { persist = true } = {}) {
  const normalizedTheme = theme === 'light' ? 'light' : 'dark';

  document.documentElement.dataset.theme = normalizedTheme;
  document.documentElement.style.colorScheme = normalizedTheme;

  if (persist) {
    saveThemePreference(normalizedTheme);
  }

  syncThemeToggleButton();
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme: normalizedTheme } }));
}

export function toggleTheme() {
  const nextTheme = getActiveTheme() === 'light' ? 'dark' : 'light';
  applyTheme(nextTheme);
  return nextTheme;
}

export function setupThemeToggle(onThemeChange) {
  syncThemeToggleButton();

  const button = document.getElementById('themeToggleButton');
  if (!button || button.dataset.listenerAdded === 'true') {
    return;
  }

  button.dataset.listenerAdded = 'true';
  button.addEventListener('click', () => {
    const nextTheme = toggleTheme();
    if (typeof onThemeChange === 'function') {
      onThemeChange(nextTheme);
    }
  });
}

export function onThemeChange(listener) {
  window.addEventListener(THEME_CHANGE_EVENT, listener);
}

export function getChartTheme() {
  const styles = getComputedStyle(document.documentElement);
  const readVar = name => styles.getPropertyValue(name).trim();

  return {
    text: readVar('--chart-text') || readVar('--light') || '#ffffff',
    mutedText: readVar('--chart-muted-text') || readVar('--light') || '#e0e0e0',
    grid: readVar('--chart-grid') || 'rgba(255, 255, 255, 0.1)',
    tooltipBg: readVar('--tooltip-bg') || 'rgba(0, 0, 0, 0.8)',
    tooltipText: readVar('--tooltip-text') || '#ffffff',
    tooltipBorder: readVar('--tooltip-border') || readVar('--accent') || '#FFD700',
    inputBg: readVar('--input-bg') || readVar('--dark') || '#1a1a1a',
    inputBorder: readVar('--input-border') || '#444444',
    inputText: readVar('--input-text') || readVar('--light') || '#ffffff',
    inputHoverBg: readVar('--input-hover-bg') || '#3a3a4a',
    dropdownBg: readVar('--dropdown-bg') || readVar('--secondary') || '#1c2526',
    dropdownBorder: readVar('--dropdown-border') || readVar('--input-border') || '#444444',
    dropdownItemBorder: readVar('--dropdown-item-border') || readVar('--input-border') || '#444444'
  };
}
