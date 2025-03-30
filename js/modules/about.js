// js/modules/about.js
export function setupAboutListeners() {
  const aboutButton = document.getElementById("aboutButton");
  const backToApp = document.getElementById("backToApp");
  const aboutSection = document.getElementById("aboutSection");
  const eventAnalysisSection = document.getElementById("eventAnalysisSection");
  const playerAnalysisSection = document.getElementById("playerAnalysisSection");
  const modeButtons = document.querySelectorAll(".top-mode-button[data-top-mode]");

  // Function to return to dashboard, reusable for both back link and mode buttons
  function returnToDashboard(targetMode = null) {
    console.log("Returning to dashboard...");
    aboutSection.style.display = "none";

    // Determine the mode to switch to
    let activeMode = targetMode;
    if (!activeMode) {
      // Fallback to the last active mode or default to "event"
      activeMode = document.querySelector(".top-mode-button[data-top-mode='event']").classList.contains("active")
        ? "event"
        : "player";
    }

    // Update section visibility and button states
    if (activeMode === "event") {
      eventAnalysisSection.style.display = "block";
      playerAnalysisSection.style.display = "none";
      document.querySelector(".top-mode-button[data-top-mode='event']").classList.add("active");
      document.querySelector(".top-mode-button[data-top-mode='player']").classList.remove("active");
    } else {
      playerAnalysisSection.style.display = "block";
      eventAnalysisSection.style.display = "none";
      document.querySelector(".top-mode-button[data-top-mode='player']").classList.add("active");
      document.querySelector(".top-mode-button[data-top-mode='event']").classList.remove("active");
    }
    aboutButton.classList.remove("active");
  }

  if (aboutButton) {
    aboutButton.addEventListener("click", () => {
      console.log("Showing About section...");
      aboutSection.style.display = "block";
      eventAnalysisSection.style.display = "none";
      playerAnalysisSection.style.display = "none";
      modeButtons.forEach(btn => btn.classList.remove("active"));
      aboutButton.classList.add("active");
    });
  }

  if (backToApp) {
    backToApp.addEventListener("click", (e) => {
      e.preventDefault();
      returnToDashboard();
    });
  }
}

// Exported function to hide About section and update button state, callable from filters.js
export function hideAboutSection(mode) {
  const aboutSection = document.getElementById("aboutSection");
  const aboutButton = document.getElementById("aboutButton");
  if (aboutSection && aboutSection.style.display !== "none") {
    console.log(`Hiding About section and switching to ${mode} mode...`);
    aboutSection.style.display = "none";
  }
  if (aboutButton && aboutButton.classList.contains("active")) {
    console.log("Removing active state from About button...");
    aboutButton.classList.remove("active");
  }
}