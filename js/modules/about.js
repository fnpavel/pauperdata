function getDashboardSections() {
  return {
    event: document.getElementById('eventAnalysisSection'),
    player: document.getElementById('playerAnalysisSection'),
    'deck-matchup': document.getElementById('matchupSection'),
    'player-matchup': document.getElementById('matchupSection'),
    leaderboard: document.getElementById('leaderboardsSection'),
    rankings: document.getElementById('rankingsSection')
  };
}

function hideDashboardSections() {
  const sections = getDashboardSections();
  Object.values(sections).forEach(section => {
    if (section) {
      section.style.display = 'none';
    }
  });
}

export function setupAboutListeners() {
  const aboutButton = document.getElementById('aboutButton');
  const backToApp = document.getElementById('backToApp');
  const aboutSection = document.getElementById('aboutSection');
  const modeButtons = Array.from(document.querySelectorAll('.top-mode-button[data-top-mode]'));
  let lastDashboardMode = document.querySelector('.top-mode-button.active')?.dataset.topMode || 'event';

  modeButtons.forEach(button => {
    button.addEventListener('click', () => {
      lastDashboardMode = button.dataset.topMode || lastDashboardMode;
    });
  });

  if (aboutButton) {
    aboutButton.addEventListener('click', () => {
      console.log('Showing About section...');
      hideDashboardSections();
      if (aboutSection) {
        aboutSection.style.display = 'block';
      }
      modeButtons.forEach(button => button.classList.remove('active'));
      aboutButton.classList.add('active');
    });
  }

  if (backToApp) {
    backToApp.addEventListener('click', event => {
      event.preventDefault();
      const targetButton = document.querySelector(`.top-mode-button[data-top-mode="${lastDashboardMode}"]`);
      if (targetButton instanceof HTMLElement) {
        targetButton.click();
      }
    });
  }
}

export function hideAboutSection(mode) {
  const aboutSection = document.getElementById('aboutSection');
  const aboutButton = document.getElementById('aboutButton');
  if (aboutSection && aboutSection.style.display !== 'none') {
    console.log(`Hiding About section and switching to ${mode} mode...`);
    aboutSection.style.display = 'none';
  }
  if (aboutButton && aboutButton.classList.contains('active')) {
    console.log('Removing active state from About button...');
    aboutButton.classList.remove('active');
  }
}
