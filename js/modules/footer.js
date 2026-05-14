import { getTopMode } from './filters/shared.js';

const TOP_MODE_LABELS = {
  event: 'Event Analysis',
  player: 'Player Analysis',
  'deck-matchup': 'Deck Matchup',
  'player-matchup': 'Player Matchup',
  leaderboard: 'Elo Leaderboards',
  about: 'About'
};

function getCurrentViewLabel() {
  const topMode = document.body.dataset.topMode || getTopMode();
  return TOP_MODE_LABELS[topMode] || TOP_MODE_LABELS.event;
}

function updateFooterCurrentView() {
  const currentViewValue = document.getElementById('footerCurrentViewValue');
  if (!currentViewValue) {
    return;
  }

  currentViewValue.textContent = getCurrentViewLabel();
}

function scrollToActiveView() {
  const topMode = document.body.dataset.topMode || getTopMode();
  const activeSectionMap = {
    event: document.getElementById('eventAnalysisSection'),
    player: document.getElementById('playerAnalysisSection'),
    'deck-matchup': document.getElementById('matchupSection'),
    'player-matchup': document.getElementById('matchupSection'),
    leaderboard: document.getElementById('leaderboardsSection'),
    about: document.getElementById('aboutSection')
  };

  const targetSection = activeSectionMap[topMode];
  if (targetSection instanceof HTMLElement) {
    targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  document.querySelector('.page-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function triggerCurrentViewAction() {
  const topMode = document.body.dataset.topMode || getTopMode();
  const activeButton = topMode === 'about'
    ? document.getElementById('aboutButton')
    : document.querySelector(`.top-mode-button[data-top-mode="${topMode}"]`);

  if (activeButton instanceof HTMLElement) {
    activeButton.click();
  }

  window.requestAnimationFrame(scrollToActiveView);
}

export function setupFooter() {
  const aboutButton = document.getElementById('footerAboutButton');
  const currentViewButton = document.getElementById('footerCurrentViewButton');
  const headerAboutButton = document.getElementById('aboutButton');
  const observedTargets = [
    document.body,
    ...document.querySelectorAll('.top-mode-button, .analysis-mode'),
    headerAboutButton
  ].filter(Boolean);

  if (aboutButton && headerAboutButton && aboutButton.dataset.listenerAdded !== 'true') {
    aboutButton.dataset.listenerAdded = 'true';
    aboutButton.addEventListener('click', () => {
      headerAboutButton.click();
      window.requestAnimationFrame(scrollToActiveView);
    });
  }

  if (currentViewButton && currentViewButton.dataset.listenerAdded !== 'true') {
    currentViewButton.dataset.listenerAdded = 'true';
    currentViewButton.addEventListener('click', triggerCurrentViewAction);
  }

  observedTargets.forEach(target => {
    if (!(target instanceof HTMLElement) || target.dataset.footerSyncListenerAdded === 'true') {
      return;
    }

    target.dataset.footerSyncListenerAdded = 'true';
    target.addEventListener('click', () => {
      window.requestAnimationFrame(updateFooterCurrentView);
    });
  });

  const observer = new MutationObserver(updateFooterCurrentView);
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-top-mode'] });

  updateFooterCurrentView();
}
