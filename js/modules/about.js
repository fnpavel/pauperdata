// js/modules/about.js
export function setupAboutListeners() {
    const aboutButton = document.getElementById("aboutButton");
    const backToApp = document.getElementById("backToApp");
    const aboutSection = document.getElementById("aboutSection");
    const eventAnalysisSection = document.getElementById("eventAnalysisSection");
    const playerAnalysisSection = document.getElementById("playerAnalysisSection");
  
    if (aboutButton) {
      aboutButton.addEventListener("click", () => {
        console.log("Showing About section...");
        aboutSection.style.display = "block";
        eventAnalysisSection.style.display = "none";
        playerAnalysisSection.style.display = "none";
        // Remove active class from mode buttons to indicate About mode
        document.querySelectorAll(".top-mode-button").forEach(btn => btn.classList.remove("active"));
        aboutButton.classList.add("active");
      });
    }
  
    if (backToApp) {
      backToApp.addEventListener("click", (e) => {
        e.preventDefault();
        console.log("Returning to dashboard...");
        aboutSection.style.display = "none";
        const lastActiveMode = document.querySelector(".top-mode-button[data-top-mode='event']").classList.contains("active") 
          ? "event" 
          : "player";
        if (lastActiveMode === "event") {
          eventAnalysisSection.style.display = "block";
          document.querySelector(".top-mode-button[data-top-mode='event']").classList.add("active");
        } else {
          playerAnalysisSection.style.display = "block";
          document.querySelector(".top-mode-button[data-top-mode='player']").classList.add("active");
        }
        aboutButton.classList.remove("active");
      });
    }
  }