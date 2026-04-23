// Provides cross-module callbacks so focused filter modules can trigger shared coordinator behavior.
export const filterRuntime = {
  updateAllCharts: () => {},
  updateDateOptions: () => {},
  updatePlayerDateOptions: () => {},
  updateMultiEventSelectionSummary: () => {},
  updatePlayerSelectionSummary: () => {},
  resetMultiDateRange: () => {},
  resetPlayerDateRange: () => {}
};

// Allows the filter coordinator to inject callbacks used by split filter modules.
export function configureFilterRuntime(overrides = {}) {
  Object.assign(filterRuntime, overrides);
}
