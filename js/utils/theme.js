// Centralizes all theme behavior for the dashboard. Keeping persistence,
// button state, custom events, and Chart.js color tokens here prevents each
// chart/module from duplicating light/dark mode logic.
export const THEME_STORAGE_KEY = 'mtg-tracker-theme';
const THEME_CHANGE_EVENT = 'mtg-theme-change';

function canUseLocalStorage() {
  // localStorage can throw in privacy modes or embedded contexts, so all theme
  // persistence goes through this guard before reading or writing.
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

// Reads the persisted explicit user preference, returning an empty string when
// storage is unavailable or the user has not chosen a theme.
export function getStoredThemePreference() {
  if (!canUseLocalStorage()) {
    return '';
  }

  return window.localStorage.getItem(THEME_STORAGE_KEY) || '';
}

// Resolves the theme currently driving the page, falling back to saved/system
// preference when the dataset has not been initialized yet.
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

// Mirrors the active theme into the header toggle's text, ARIA state, and next
// action label.
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

// Applies a theme to the document and optionally persists it for future visits.
export function applyTheme(theme, { persist = true } = {}) {
  const normalizedTheme = theme === 'light' ? 'light' : 'dark';

  // The CSS selectors and browser native controls both rely on these two values.
  document.documentElement.dataset.theme = normalizedTheme;
  document.documentElement.style.colorScheme = normalizedTheme;

  if (persist) {
    saveThemePreference(normalizedTheme);
  }

  syncThemeToggleButton();
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme: normalizedTheme } }));
}

// Flips between light and dark mode and returns the newly active theme.
export function toggleTheme() {
  const nextTheme = getActiveTheme() === 'light' ? 'dark' : 'light';
  applyTheme(nextTheme);
  return nextTheme;
}

// Wires the header toggle once and allows the caller to redraw charts after a
// theme change.
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

// Lets modules subscribe to theme changes without coupling to the toggle button.
export function onThemeChange(listener) {
  window.addEventListener(THEME_CHANGE_EVENT, listener);
}

// Reads CSS custom properties and converts them into the color bundle expected by
// Chart.js config builders.
export function getChartTheme() {
  const styles = getComputedStyle(document.documentElement);
  const readVar = name => styles.getPropertyValue(name).trim();

  // Chart helpers read this object on each redraw so theme changes can refresh
  // Chart.js colors without rebuilding theme constants in every chart file.
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
