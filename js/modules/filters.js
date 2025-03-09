// js/modules/filters.js
import { cleanedData } from '../data.js';
import { updateEventAnalytics, updateMultiEventAnalytics } from './event-analysis.js';
import { updatePlayerAnalytics } from './player-analysis.js';
import { updateEventMetaWinRateChart } from '../charts/event-meta-win-rate.js';
import { updateMultiMetaWinRateChart } from '../charts/multi-meta-win-rate.js';
import { updateMultiPlayerWinRateChart } from '../charts/multi-player-win-rate.js';
import { updateEventFunnelChart } from '../charts/event-funnel.js';
import { updateDeckEvolutionChart } from '../charts/deck-evolution.js';

// Global variables to hold filtered data
let filteredData = [];
let slicedFilteredData = [];

export function setupFilters() {
  console.log("Setting up filters...");

  // Event Filter Menu
  const eventFilterMenu = document.getElementById("eventFilterMenu");
  const events = [...new Set(cleanedData.map(row => row.Event))].sort((a, b) => {
    const dateA = cleanedData.find(row => row.Event === a).Date;
    const dateB = cleanedData.find(row => row.Event === b).Date;
    return new Date(dateB) - new Date(dateA);
  });
  eventFilterMenu.innerHTML = events.map(event => `<option value="${event}">${event}</option>`).join("");
  eventFilterMenu.value = events[0] || "";
  updateEventFilter();

  // Player Filter Menu
  const playerFilterMenu = document.getElementById("playerFilterMenu");
  const players = [...new Set(cleanedData.map(row => row.Player))].sort((a, b) => a.localeCompare(b)); // Case-insensitive sort
  playerFilterMenu.innerHTML = `<option value="">No Player Selected</option>` + 
    players.map(player => `<option value="${player}">${player}</option>`).join("");
  playerFilterMenu.value = "";

  // Date Selects for Multi-Event
  const startDateSelect = document.getElementById("startDateSelect");
  const endDateSelect = document.getElementById("endDateSelect");
  startDateSelect.innerHTML = `<option value="">Select Offline or Online Event first</option>`;
  endDateSelect.innerHTML = `<option value="">Select Offline or Online Event first</option>`;

  // Date Selects for Player Analysis
  const playerStartDateSelect = document.getElementById("playerStartDateSelect");
  const playerEndDateSelect = document.getElementById("playerEndDateSelect");
  playerStartDateSelect.innerHTML = `<option value="">Select Player and Event Type first</option>`;
  playerEndDateSelect.innerHTML = `<option value="">Select Player and Event Type first</option>`;

  // Position Slicer
  setupPositionSlicer();

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

function setupPositionSlicer() {
  const maxRank = Math.max(...cleanedData.map(row => row.Rank));
  const positionOptions = Array.from({ length: maxRank }, (_, i) => i + 1)
    .map(rank => `<option value="${rank}">${rank}</option>`).join("");

  const positionStartSelect = document.getElementById("positionStartSelect");
  const positionEndSelect = document.getElementById("positionEndSelect");
  const positionTypeButtons = document.querySelectorAll(".position-type");

  positionStartSelect.innerHTML = `<option value="">All</option>${positionOptions}`;
  positionEndSelect.innerHTML = `<option value="">All</option>${positionOptions}`;
  positionStartSelect.value = "";
  positionEndSelect.value = "";

  // Position Start/End listeners
  positionStartSelect.addEventListener("change", () => {
    updateSlicedFilteredData();
    updatePositionSlicerCharts();
  });
  positionEndSelect.addEventListener("change", () => {
    updateSlicedFilteredData();
    updatePositionSlicerCharts();
  });

  // Meta/Win Rate toggle listeners
  positionTypeButtons.forEach(button => {
    button.addEventListener("click", () => {
      positionTypeButtons.forEach(btn => btn.classList.remove("active"));
      button.classList.add("active");
      console.log("Position type changed to:", button.dataset.type);
      updatePositionSlicerCharts();
    });
  });
}

// Updates slicedFilteredData based on position slicer
function updateSlicedFilteredData() {
  const positionStart = parseInt(document.getElementById("positionStartSelect")?.value) || 1;
  const positionEnd = parseInt(document.getElementById("positionEndSelect")?.value) || Infinity;
  slicedFilteredData = filteredData.filter(row => row.Rank >= positionStart && row.Rank <= positionEnd);
}

// Updates only slicer-affected charts
function updatePositionSlicerCharts() {
  const activeTopMode = document.querySelector(".top-mode-button.active")?.dataset.topMode || "event";
  const activeAnalysisMode = document.querySelector(".analysis-mode.active")?.dataset.mode || "single";

  if (activeTopMode === "event") {
    if (activeAnalysisMode === "single") {
      updateEventMetaWinRateChart(slicedFilteredData);
      //updateEventFunnelChart(slicedFilteredData);
    } else if (activeAnalysisMode === "multi") {
      updateMultiMetaWinRateChart(slicedFilteredData);
      updateMultiPlayerWinRateChart(slicedFilteredData);
    }
  }
}

// Updates all charts for non-slicer filter changes
export function updateAllCharts() {
  const activeTopMode = document.querySelector(".top-mode-button.active")?.dataset.topMode || "event";
  const activeAnalysisMode = document.querySelector(".analysis-mode.active")?.dataset.mode || "single";

  // Update filteredData based on current filters
  if (activeTopMode === "event") {
    if (activeAnalysisMode === "single") {
      const selectedEventType = document.querySelector('.event-type-filter.active')?.dataset.type || "";
      const eventFilterMenu = document.getElementById("eventFilterMenu");
      const selectedEvents = eventFilterMenu && eventFilterMenu.value ? [eventFilterMenu.value] : [];
      filteredData = cleanedData.filter(row => 
        row.EventType === selectedEventType && selectedEvents.includes(row.Event)
      );
      updateSlicedFilteredData(); // Update sliced data after updating filteredData
      updateEventMetaWinRateChart(slicedFilteredData);
      updateEventFunnelChart(slicedFilteredData);
      updateEventAnalytics();
    } else if (activeAnalysisMode === "multi") {
      const startDate = document.getElementById("startDateSelect").value;
      const endDate = document.getElementById("endDateSelect").value;
      const selectedEventTypes = Array.from(document.querySelectorAll('.event-type-filter.active'))
        .map(button => button.dataset.type);
      filteredData = (startDate && endDate && selectedEventTypes.length > 0) 
        ? cleanedData.filter(row => row.Date >= startDate && row.Date <= endDate && selectedEventTypes.includes(row.EventType))
        : [];
      updateSlicedFilteredData(); // Update sliced data after updating filteredData
      updateMultiMetaWinRateChart(slicedFilteredData);
      updateMultiPlayerWinRateChart();
      updateDeckEvolutionChart(filteredData); // Use filteredData, not sliced
      updateMultiEventAnalytics();
    }
  } else if (activeTopMode === "player") {
    updatePlayerAnalytics(); // Player analytics ignores slicer
  }
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

      if (mode === "event") {
        eventAnalysisSection.style.display = "block";
        playerAnalysisSection.style.display = "none";

        const eventTypeButtons = document.querySelectorAll(".event-type-filter");
        eventTypeButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.type === "offline"));
        console.log("Event Analytics: Event type filters reset to offline. Active types:", 
          Array.from(eventTypeButtons).filter(btn => btn.classList.contains("active")).map(btn => btn.dataset.type));

        const activeAnalysisMode = document.querySelector(".analysis-mode.active")?.dataset.mode || "single";
        singleEventStats.style.display = activeAnalysisMode === "single" ? "grid" : "none";
        multiEventStats.style.display = activeAnalysisMode === "multi" ? "grid" : "none";
        singleEventCharts.style.display = activeAnalysisMode === "single" ? "block" : "none";
        multiEventCharts.style.display = activeAnalysisMode === "multi" ? "block" : "none";

        updateEventFilter();
        updateDateOptions();      // Update Multi-Event dates
        updatePlayerDateOptions(); // Update Player Analysis dates
        updateAllCharts();
      } else if (mode === "player") {
        eventAnalysisSection.style.display = "none";
        playerAnalysisSection.style.display = "block";
        playerStats.style.display = "grid";
        playerCharts.style.display = "block";
        
        const eventTypeButtons = document.querySelectorAll(".event-type-filter");
        eventTypeButtons.forEach(button => button.classList.remove("active"));
        console.log("Player Analytics: Event type filters reset. Active types:", 
          Array.from(eventTypeButtons).filter(btn => btn.classList.contains("active")).map(btn => btn.dataset.type));
        
        updatePlayerDateOptions(); // Update player dates and player filter
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

      updateDateOptions();      // Update Multi-Event dates
      updatePlayerDateOptions(); // Update Player Analysis dates and player filter
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
        // Reset and update date dropdowns
        const startDateSelect = document.getElementById("startDateSelect");
        const endDateSelect = document.getElementById("endDateSelect");
        const playerStartDateSelect = document.getElementById("playerStartDateSelect");
        const playerEndDateSelect = document.getElementById("playerEndDateSelect");
        if (startDateSelect) startDateSelect.value = "";
        if (endDateSelect) endDateSelect.value = "";
        if (playerStartDateSelect) playerStartDateSelect.value = "";
        if (playerEndDateSelect) playerEndDateSelect.value = "";
        updateDateOptions();
        updatePlayerDateOptions(); // Also updates player filter
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
      updatePlayerDateOptions(); // Update dates when player changes
      updatePlayerAnalytics();
    });
  }
  if (playerStartDateSelect) {
    playerStartDateSelect.addEventListener("change", () => {
      updatePlayerDateOptions(); // Update end date options when start date changes
      updatePlayerAnalytics();
    });
  }
  if (playerEndDateSelect) {
    playerEndDateSelect.addEventListener("change", () => {
      updatePlayerDateOptions(); // Update start date options when end date changes
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
      const dateA = cleanedData.find(row => row.Event === a).Date;
      const dateB = cleanedData.find(row => row.Event === b).Date;
      return new Date(dateB) - new Date(dateA);
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

  // Reset if selected date is no longer valid
  if (selectedStartDate && !dates.includes(selectedStartDate)) startDateSelect.value = "";
  if (selectedEndDate && !dates.includes(selectedEndDate)) endDateSelect.value = "";

  const currentStartDate = startDateSelect.value;
  const currentEndDate = endDateSelect.value;

  // Enforce date range constraints
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

  // Update player filter: show all players if no event types selected, otherwise filter by event types
  const players = selectedEventTypes.length === 0
    ? [...new Set(cleanedData.map(row => row.Player))].sort((a, b) => a.localeCompare(b))
    : [...new Set(cleanedData
        .filter(row => selectedEventTypes.includes(row.EventType.toLowerCase()))
        .map(row => row.Player))].sort((a, b) => a.localeCompare(b));
  const currentPlayer = players.includes(selectedPlayer) ? selectedPlayer : "";
  playerFilterMenu.innerHTML = `<option value="">No Player Selected</option>` + 
    players.map(player => `<option value="${player}" ${player === currentPlayer ? 'selected' : ''}>${player}</option>`).join("");

  // Filter dates by selected player and event types (if any)
  const dates = selectedPlayer
    ? [...new Set(cleanedData
        .filter(row => row.Player === selectedPlayer && (selectedEventTypes.length === 0 || selectedEventTypes.includes(row.EventType.toLowerCase())))
        .map(row => row.Date))].sort((a, b) => new Date(a) - new Date(b))
    : [];

  console.log("Filtered dates for Player Analysis:", dates, "Selected Player:", selectedPlayer);

  if (!selectedPlayer || dates.length === 0) {
    startDateSelect.innerHTML = `<option value="">Select Player and Event Type first</option>`;
    endDateSelect.innerHTML = `<option value="">Select Player and Event Type first</option>`;
    return;
  }

  const selectedStartDate = startDateSelect.value;
  const selectedEndDate = endDateSelect.value;

  // Reset if selected date is no longer valid
  if (selectedStartDate && !dates.includes(selectedStartDate)) startDateSelect.value = "";
  if (selectedEndDate && !dates.includes(selectedEndDate)) endDateSelect.value = "";

  const currentStartDate = startDateSelect.value;
  const currentEndDate = endDateSelect.value;

  // Enforce date range constraints
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