// js/modules/filters.js
import { cleanedData } from '../data.js';
import { updateEventAnalytics, updateMultiEventAnalytics } from './event-analysis.js';
import { updatePlayerAnalytics } from './player-analysis.js';
import { updateEventMetaWinRateChart } from '../charts/single-meta-win-rate.js';
import { updateMultiMetaWinRateChart } from '../charts/multi-meta-win-rate.js';
import { updateMultiPlayerWinRateChart } from '../charts/multi-player-win-rate.js';
import { updateEventFunnelChart } from '../charts/single-funnel.js';
import { updateDeckEvolutionChart } from '../charts/multi-deck-evolution.js';
import { updatePlayerDeckPerformanceChart } from '../charts/player-deck-performance.js';
import { updatePlayerWinRateChart } from '../charts/player-win-rate.js';
import { hideAboutSection } from './about.js';

// Global variable to hold filtered data
let filteredData = [];

export function setupFilters() {
  console.log("Setting up filters...");

  // Determine the initial mode on page load
  const activeTopMode = document.querySelector(".top-mode-button.active")?.dataset.topMode || "event";
  const eventTypeButtons = document.querySelectorAll(".event-type-filter");

  // Set "online" as the default active Event Type for both modes on page load
  eventTypeButtons.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.type === "online");
  });
  console.log(`Initial mode is ${activeTopMode}: Set 'online' as default active Event Type`);

  // Event Filter Menu
  const eventFilterMenu = document.getElementById("eventFilterMenu");
  const events = [...new Set(cleanedData.map(row => row.Event))].sort((a, b) => {
    const getEventDate = (event) => {
      const match = event.match(/\((\d{4}-\d{2}-\d{2})\)$/);
      const dateStr = match ? match[1] : cleanedData.find(row => row.Event === event).Date;
      return new Date(dateStr);
    };

    const dateA = getEventDate(a);
    const dateB = getEventDate(b);
    return dateA - dateB; // Latest dates last
  });

  eventFilterMenu.innerHTML = events.map(event => `<option value="${event}">${event}</option>`).join("");
  eventFilterMenu.value = events[0] || "";
  updateEventFilter();

  // Player Filter Menu
  const playerFilterMenu = document.getElementById("playerFilterMenu");
  playerFilterMenu.innerHTML = `<option value="">Select Event Type First</option>`;
  playerFilterMenu.value = "";

  // Date Selects for Multi-Event
  const startDateSelect = document.getElementById("startDateSelect");
  const endDateSelect = document.getElementById("endDateSelect");
  startDateSelect.innerHTML = `<option value="">Select Offline or Online Event first</option>`;
  endDateSelect.innerHTML = `<option value="">Select Offline or Online Event first</option}`;

  // Date Selects for Player Analysis
  const playerStartDateSelect = document.getElementById("playerStartDateSelect");
  const playerEndDateSelect = document.getElementById("playerEndDateSelect");
  playerStartDateSelect.innerHTML = `<option value="">Select Player and Event Type first</option>`;
  playerEndDateSelect.innerHTML = `<option value="">Select Player and Event Type first</option}`;

  // Initial UI State
  const activeAnalysisMode = document.querySelector(".analysis-mode.active")?.dataset.mode || "single";
  const singleEventStats = document.getElementById("singleEventStats");
  const multiEventStats = document.getElementById("multiEventStats");
  const singleEventCharts = document.getElementById("singleEventCharts");
  const multiEventCharts = document.getElementById("multiEventCharts");
  const eventFilterSection = document.getElementById("eventFilterSection");

  singleEventStats.style.display = activeAnalysisMode === "single" ? "grid" : "none";
  multiEventStats.style.display = activeAnalysisMode === "multi" ? "grid" : "none";
  singleEventCharts.style.display = activeAnalysisMode === "single" ? "block" : "none";
  multiEventCharts.style.display = activeAnalysisMode === "multi" ? "block" : "none";
  eventFilterSection.style.display = activeAnalysisMode === "single" ? "block" : "none";

  // Initial update
  updateAllCharts();
}

// Updates all charts for filter changes
export function updateAllCharts() {
  const activeTopMode = document.querySelector(".top-mode-button.active")?.dataset.topMode || "event";
  const activeAnalysisMode = document.querySelector(".analysis-mode.active")?.dataset.mode || "single";

  if (activeTopMode === "event") {
    if (activeAnalysisMode === "single") {
      const selectedEventType = document.querySelector('.event-type-filter.active')?.dataset.type || "";
      const eventFilterMenu = document.getElementById("eventFilterMenu");
      const selectedEvents = eventFilterMenu && eventFilterMenu.value ? [eventFilterMenu.value] : [];
      filteredData = cleanedData.filter(row => 
        row.EventType === selectedEventType && selectedEvents.includes(row.Event)
      );
      updateEventMetaWinRateChart();
      updateEventFunnelChart();
      updateEventAnalytics();
    } else if (activeAnalysisMode === "multi") {
      const startDate = document.getElementById("startDateSelect").value;
      const endDate = document.getElementById("endDateSelect").value;
      const selectedEventTypes = Array.from(document.querySelectorAll('.event-type-filter.active'))
        .map(button => button.dataset.type);
      filteredData = (startDate && endDate && selectedEventTypes.length > 0) 
        ? cleanedData.filter(row => row.Date >= startDate && row.Date <= endDate && selectedEventTypes.includes(row.EventType))
        : [];
      updateMultiMetaWinRateChart();
      updateMultiPlayerWinRateChart();
      updateDeckEvolutionChart();
      updateMultiEventAnalytics();
    }
  } else if (activeTopMode === "player") {
    const startDate = document.getElementById("playerStartDateSelect").value;
    const endDate = document.getElementById("playerEndDateSelect").value;
    const playerFilterMenu = document.getElementById("playerFilterMenu");
    const selectedPlayer = playerFilterMenu ? playerFilterMenu.value : null;
    const selectedEventTypes = Array.from(document.querySelectorAll('.event-type-filter.active'))
      .map(button => button.dataset.type);
    filteredData = selectedPlayer && startDate && endDate && selectedEventTypes.length > 0
      ? cleanedData.filter(row => 
          row.Date >= startDate && 
          row.Date <= endDate && 
          row.Player === selectedPlayer && 
          selectedEventTypes.includes(row.EventType)
        )
      : [];
    updatePlayerAnalytics();
    updatePlayerDeckPerformanceChart();
    updatePlayerWinRateChart();
  }
}

// function to get filtered data for funnel chart
export function getFunnelChartData() {
  const selectedEventType = document.querySelector('.event-type-filter.active')?.dataset.type || "";
  const eventFilterMenu = document.getElementById("eventFilterMenu");
  const selectedEvents = eventFilterMenu && eventFilterMenu.value ? [eventFilterMenu.value] : [];
  const positionStart = parseInt(document.getElementById("positionStartSelect")?.value) || 1;
  const positionEnd = parseInt(document.getElementById("positionEndSelect")?.value) || Infinity;

  const filtered = cleanedData.filter(row => 
    row.EventType === selectedEventType &&
    selectedEvents.includes(row.Event)
  );
  return filtered.filter(row => row.Rank >= positionStart && row.Rank <= positionEnd);
}

// function to get filtered data for meta win rate chart
export function getMetaWinRateChartData() {
  const selectedEventType = document.querySelector('.event-type-filter.active')?.dataset.type || "";
  const eventFilterMenu = document.getElementById("eventFilterMenu");
  const selectedEvents = eventFilterMenu && eventFilterMenu.value ? [eventFilterMenu.value] : [];

  return cleanedData.filter(row => 
    row.EventType === selectedEventType &&
    selectedEvents.includes(row.Event)
  );
}

// multi-event filter functions
export function getMultiEventChartData() {
  const startDate = document.getElementById("startDateSelect").value;
  const endDate = document.getElementById("endDateSelect").value;
  const selectedEventTypes = Array.from(document.querySelectorAll('.event-type-filter.active'))
    .map(button => button.dataset.type);
  return (startDate && endDate && selectedEventTypes.length > 0)
    ? cleanedData.filter(row => row.Date >= startDate && row.Date <= endDate && selectedEventTypes.includes(row.EventType))
    : [];
}
// deck evolution filter functions
export function getDeckEvolutionChartData() {
  const positionStart = parseInt(document.getElementById("positionStartSelect")?.value) || 1;
  const positionEnd = parseInt(document.getElementById("positionEndSelect")?.value) || Infinity;
  const filteredData = getMultiEventChartData();
  return filteredData.filter(row => row.Rank >= positionStart && row.Rank <= positionEnd);
}

// For Player Analysis -> Deck Performance
export function getPlayerDeckPerformanceChartData() {
  const startDate = document.getElementById("playerStartDateSelect").value;
  const endDate = document.getElementById("playerEndDateSelect").value;
  const playerFilterMenu = document.getElementById("playerFilterMenu");
  const selectedPlayer = playerFilterMenu ? playerFilterMenu.value : null;
  const selectedEventTypes = Array.from(document.querySelectorAll('.event-type-filter.active'))
    .map(button => button.dataset.type);

  return selectedPlayer && startDate && endDate && selectedEventTypes.length > 0
    ? cleanedData.filter(row => 
        row.Date >= startDate && 
        row.Date <= endDate && 
        row.Player === selectedPlayer && 
        selectedEventTypes.includes(row.EventType) &&
        row.Deck !== "No Show"
      )
    : [];
}

// For Player Analysis -> Win Rate across Time
export function getPlayerWinRateChartData() {
  const baseData = getPlayerDeckPerformanceChartData(); // Reuses base filtering
  const deckFilter = document.getElementById("playerDeckFilter");
  const selectedDeck = deckFilter ? deckFilter.value : "";
  return selectedDeck ? baseData.filter(row => row.Deck === selectedDeck) : baseData;
}

export function setupTopModeListeners() {
  const topModeButtons = document.querySelectorAll(".top-mode-button");
  const eventAnalysisSection = document.getElementById("eventAnalysisSection");
  const playerAnalysisSection = document.getElementById("playerAnalysisSection");
  const singleEventStats = document.getElementById("singleEventStats");
  const multiEventStats = document.getElementById("multiEventStats");
  const playerStats = document.getElementById("playerStats");
  const singleEventCharts = document.getElementById("singleEventCharts");
  const multiEventCharts = document.getElementById("multiEventCharts");
  const playerCharts = document.getElementById("playerCharts");

  topModeButtons.forEach(button => {
    button.addEventListener("click", () => {
      topModeButtons.forEach(btn => btn.classList.remove("active"));
      button.classList.add("active");

      const mode = button.dataset.topMode;
      console.log("Top mode changed to:", mode);

      // Hide the About section if visible
      hideAboutSection(mode);

      if (mode === "event") {
        eventAnalysisSection.style.display = "block";
        playerAnalysisSection.style.display = "none";

        const eventTypeButtons = document.querySelectorAll(".event-type-filter");
        eventTypeButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.type === "online"));
        console.log("Event Analytics: Event type filters set to 'online'. Active types:", 
          Array.from(eventTypeButtons).filter(btn => btn.classList.contains("active")).map(btn => btn.dataset.type));

        const activeAnalysisMode = document.querySelector(".analysis-mode.active")?.dataset.mode || "single";
        singleEventStats.style.display = activeAnalysisMode === "single" ? "grid" : "none";
        multiEventStats.style.display = activeAnalysisMode === "multi" ? "grid" : "none";
        singleEventCharts.style.display = activeAnalysisMode === "single" ? "block" : "none";
        multiEventCharts.style.display = activeAnalysisMode === "multi" ? "block" : "none";

        updateEventFilter();
        updateDateOptions();
        updatePlayerDateOptions();
        updateAllCharts();
      } else if (mode === "player") {
        eventAnalysisSection.style.display = "none";
        playerAnalysisSection.style.display = "block";
        playerStats.style.display = "grid";
        playerCharts.style.display = "block";
        
        const eventTypeButtons = document.querySelectorAll(".event-type-filter");
        // Change: Set "online" as the default active Event Type in Player Analysis
        eventTypeButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.type === "online"));
        console.log("Player Analytics: Event type filters set to 'online'. Active types:", 
          Array.from(eventTypeButtons).filter(btn => btn.classList.contains("active")).map(btn => btn.dataset.type));
        
        const playerFilterMenu = document.getElementById("playerFilterMenu");
        const playerStartDateSelect = document.getElementById("playerStartDateSelect");
        const playerEndDateSelect = document.getElementById("playerEndDateSelect");
        playerFilterMenu.value = "";
        playerStartDateSelect.innerHTML = `<option value="">Select Player and Event Type first</option>`;
        playerEndDateSelect.innerHTML = `<option value="">Select Player and Event Type first</option}`;

        updatePlayerDateOptions();
        updatePlayerAnalytics();
      }
    });
  });
}

export function setupAnalysisModeListeners() {
  const analysisModeButtons = document.querySelectorAll(".analysis-mode");
  const singleEventStats = document.getElementById("singleEventStats");
  const multiEventStats = document.getElementById("multiEventStats");
  const singleEventCharts = document.getElementById("singleEventCharts");
  const multiEventCharts = document.getElementById("multiEventCharts");
  const eventFilterSection = document.getElementById("eventFilterSection");

  analysisModeButtons.forEach(button => {
    button.addEventListener("click", () => {
      analysisModeButtons.forEach(btn => btn.classList.remove("active"));
      button.classList.add("active");

      const mode = button.dataset.mode;
      console.log("Analysis mode changed to:", mode);

      singleEventStats.style.display = mode === "single" ? "grid" : "none";
      multiEventStats.style.display = mode === "multi" ? "grid" : "none";
      singleEventCharts.style.display = mode === "single" ? "block" : "none";
      multiEventCharts.style.display = mode === "multi" ? "block" : "none";
      eventFilterSection.style.display = mode === "single" ? "block" : "none";

      updateDateOptions();
      updatePlayerDateOptions();
      updateAllCharts();
    });
  });
}

export function setupEventTypeListeners() {
  const eventTypeButtons = document.querySelectorAll(".event-type-filter");
  eventTypeButtons.forEach(button => {
    button.addEventListener("click", () => {
      const activeTopMode = document.querySelector(".top-mode-button.active")?.dataset.topMode || "event";
      const activeAnalysisMode = document.querySelector(".analysis-mode.active")?.dataset.mode || "single";
      
      if (activeTopMode === "event" && activeAnalysisMode === "single") {
        eventTypeButtons.forEach(btn => btn.classList.remove("active"));
        button.classList.add("active");
      } else {
        button.classList.toggle("active");
      }
      
      const currentActiveTypes = Array.from(eventTypeButtons)
        .filter(btn => btn.classList.contains("active"))
        .map(btn => btn.dataset.type);
      console.log("After toggle - Active Event Types:", currentActiveTypes, "Top Mode:", activeTopMode, "Analysis Mode:", activeAnalysisMode);

      setTimeout(() => {
        updateEventFilter();
        const startDateSelect = document.getElementById("startDateSelect");
        const endDateSelect = document.getElementById("endDateSelect");
        const playerStartDateSelect = document.getElementById("playerStartDateSelect");
        const playerEndDateSelect = document.getElementById("playerEndDateSelect");
        if (startDateSelect) startDateSelect.value = "";
        if (endDateSelect) endDateSelect.value = "";
        if (playerStartDateSelect) playerStartDateSelect.value = "";
        if (playerEndDateSelect) playerEndDateSelect.value = "";
        updateDateOptions();
        updatePlayerDateOptions();
        updateAllCharts();
      }, 0);
    });
  });
}

export function setupEventFilterListeners() {
  const eventFilterMenu = document.getElementById("eventFilterMenu");
  if (eventFilterMenu) {
    eventFilterMenu.addEventListener("change", updateAllCharts);
  }
}

export function setupPlayerFilterListeners() {
  const playerFilterMenu = document.getElementById("playerFilterMenu");
  const playerStartDateSelect = document.getElementById("playerStartDateSelect");
  const playerEndDateSelect = document.getElementById("playerEndDateSelect");

  if (playerFilterMenu) {
    playerFilterMenu.addEventListener("change", () => {
      updatePlayerDateOptions();
      updatePlayerAnalytics();
    });
  }
  if (playerStartDateSelect) {
    playerStartDateSelect.addEventListener("change", () => {
      updatePlayerDateOptions();
      updatePlayerAnalytics();
    });
  }
  if (playerEndDateSelect) {
    playerEndDateSelect.addEventListener("change", () => {
      updatePlayerDateOptions();
      updatePlayerAnalytics();
    });
  }
}

export function updateEventFilter() {
  const activeAnalysisMode = document.querySelector(".analysis-mode.active")?.dataset.mode || "single";
  let selectedEventTypes;
  
  if (activeAnalysisMode === "single") {
    selectedEventTypes = [document.querySelector('.event-type-filter.active')?.dataset.type].filter(Boolean);
  } else {
    selectedEventTypes = Array.from(document.querySelectorAll('.event-type-filter.active'))
      .map(button => button.dataset.type);
  }
  console.log("Selected Event Types:", selectedEventTypes);

  const eventFilterMenu = document.getElementById("eventFilterMenu");
  if (selectedEventTypes.length === 0) {
    eventFilterMenu.innerHTML = '<option value="">No Event Type Selected</option>';
    eventFilterMenu.value = "";
  } else {
    const events = [...new Set(cleanedData
      .filter(row => selectedEventTypes.includes(row.EventType.toLowerCase()))
      .map(row => row.Event))
    ].sort((a, b) => {
      const getEventDate = (event) => {
        const match = event.match(/\((\d{4}-\d{2}-\d{2})\)$/);
        const dateStr = match ? match[1] : cleanedData.find(row => row.Event === event).Date;
        return new Date(dateStr);
      };

      const dateA = getEventDate(a);
      const dateB = getEventDate(b);
      return dateB - dateA; // descending order
    });

    eventFilterMenu.innerHTML = events.map(event => `<option value="${event}">${event}</option>`).join("");
    eventFilterMenu.value = events[0] || "";
  }
}

export function updateDateOptions() {
  const startDateSelect = document.getElementById("startDateSelect");
  const endDateSelect = document.getElementById("endDateSelect");
  const selectedEventTypes = Array.from(document.querySelectorAll('.event-type-filter.active'))
    .map(button => button.dataset.type.toLowerCase());
  const dates = selectedEventTypes.length > 0
    ? [...new Set(cleanedData
        .filter(row => selectedEventTypes.includes(row.EventType.toLowerCase()))
        .map(row => row.Date))].sort((a, b) => new Date(a) - new Date(b))
    : [];

  console.log("Filtered dates for Multi-Event:", dates);

  if (dates.length === 0) {
    startDateSelect.innerHTML = `<option value="">Select Offline or Online Event first</option>`;
    endDateSelect.innerHTML = `<option value="">Select Offline or Online Event first</option>`;
    return;
  }

  const selectedStartDate = startDateSelect.value;
  const selectedEndDate = endDateSelect.value;

  if (selectedStartDate && !dates.includes(selectedStartDate)) startDateSelect.value = "";
  if (selectedEndDate && !dates.includes(selectedEndDate)) endDateSelect.value = "";

  const currentStartDate = startDateSelect.value;
  const currentEndDate = endDateSelect.value;

  if (currentStartDate) {
    const validEndDates = dates.filter(date => date >= currentStartDate);
    endDateSelect.innerHTML = `<option value="">Select End Date</option>${validEndDates.map(date => `<option value="${date}" ${date === currentEndDate ? 'selected' : ''}>${date}</option>`).join("")}`;
  } else {
    endDateSelect.innerHTML = `<option value="">Select End Date</option>${dates.map(date => `<option value="${date}" ${date === currentEndDate ? 'selected' : ''}>${date}</option>`).join("")}`;
  }

  if (currentEndDate) {
    const validStartDates = dates.filter(date => date <= currentEndDate);
    startDateSelect.innerHTML = `<option value="">Select Start Date</option>${validStartDates.map(date => `<option value="${date}" ${date === currentStartDate ? 'selected' : ''}>${date}</option>`).join("")}`;
  } else {
    startDateSelect.innerHTML = `<option value="">Select Start Date</option>${dates.map(date => `<option value="${date}" ${date === currentStartDate ? 'selected' : ''}>${date}</option>`).join("")}`;
  }
}

export function updatePlayerDateOptions() {
  const startDateSelect = document.getElementById("playerStartDateSelect");
  const endDateSelect = document.getElementById("playerEndDateSelect");
  const playerFilterMenu = document.getElementById("playerFilterMenu");
  const selectedEventTypes = Array.from(document.querySelectorAll('.event-type-filter.active'))
    .map(button => button.dataset.type.toLowerCase());
  const selectedPlayer = playerFilterMenu.value;

  // Only populate Player dropdown if Event Type is selected
  if (selectedEventTypes.length === 0) {
    playerFilterMenu.innerHTML = `<option value="">Select Event Type First</option>`;
    playerFilterMenu.value = "";
    startDateSelect.innerHTML = `<option value="">Select Player and Event Type first</option>`;
    endDateSelect.innerHTML = `<option value="">Select Player and Event Type first</option>`;
    return;
  }

  // Populate Player dropdown based on selected Event Types
  const players = [...new Set(cleanedData
    .filter(row => selectedEventTypes.includes(row.EventType.toLowerCase()))
    .map(row => row.Player))].sort((a, b) => a.localeCompare(b));
  const currentPlayer = players.includes(selectedPlayer) ? selectedPlayer : "";
  playerFilterMenu.innerHTML = `<option value="">No Player Selected</option>` + 
    players.map(player => `<option value="${player}" ${player === currentPlayer ? 'selected' : ''}>${player}</option>`).join("");

  // Only populate Date dropdowns if both Event Type and Player are selected
  if (!selectedPlayer) {
    startDateSelect.innerHTML = `<option value="">Select Player and Event Type first</option>`;
    endDateSelect.innerHTML = `<option value="">Select Player and Event Type first</option>`;
    return;
  }

  // Populate Date dropdowns since both Event Type and Player are selected
  const dates = [...new Set(cleanedData
    .filter(row => row.Player === selectedPlayer && selectedEventTypes.includes(row.EventType.toLowerCase()))
    .map(row => row.Date))].sort((a, b) => new Date(a) - new Date(b));

  console.log("Filtered dates for Player Analysis:", dates, "Selected Player:", selectedPlayer);

  if (dates.length === 0) {
    startDateSelect.innerHTML = `<option value="">No Dates Available</option>`;
    endDateSelect.innerHTML = `<option value="">No Dates Available</option>`;
    return;
  }

  const selectedStartDate = startDateSelect.value;
  const selectedEndDate = endDateSelect.value;

  if (selectedStartDate && !dates.includes(selectedStartDate)) startDateSelect.value = "";
  if (selectedEndDate && !dates.includes(selectedEndDate)) endDateSelect.value = "";

  const currentStartDate = startDateSelect.value;
  const currentEndDate = endDateSelect.value;

  if (currentStartDate) {
    const validEndDates = dates.filter(date => date >= currentStartDate);
    endDateSelect.innerHTML = `<option value="">Select End Date</option>${validEndDates.map(date => `<option value="${date}" ${date === currentEndDate ? 'selected' : ''}>${date}</option>`).join("")}`;
  } else {
    endDateSelect.innerHTML = `<option value="">Select End Date</option>${dates.map(date => `<option value="${date}" ${date === currentEndDate ? 'selected' : ''}>${date}</option>`).join("")}`;
  }

  if (currentEndDate) {
    const validStartDates = dates.filter(date => date <= currentEndDate);
    startDateSelect.innerHTML = `<option value="">Select Start Date</option>${validStartDates.map(date => `<option value="${date}" ${date === currentStartDate ? 'selected' : ''}>${date}</option>`).join("")}`;
  } else {
    startDateSelect.innerHTML = `<option value="">Select Start Date</option>${dates.map(date => `<option value="${date}" ${date === currentStartDate ? 'selected' : ''}>${date}</option>`).join("")}`;
  }

  if (startDateSelect.value && endDateSelect.value) {
    updatePlayerAnalytics();
  }
}

export function populateDateDropdowns(eventType) {
  const filteredDates = [...new Set(cleanedData
    .filter(row => row.EventType.toLowerCase() === eventType.toLowerCase())
    .map(row => row.Date)
  )].sort();
  const startDateSelect = document.getElementById("startDateSelect");
  const endDateSelect = document.getElementById("endDateSelect");
  if (!startDateSelect || !endDateSelect) {
    console.error("Date select elements not found!");
    return;
  }
  const options = "<option value=''>--Select--</option>" + filteredDates.map(date => `<option value="${date}">${date}</option>`).join("");
  startDateSelect.innerHTML = options;
  endDateSelect.innerHTML = options;
}