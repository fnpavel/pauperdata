// Contains shared DOM selectors and small helpers reused by multiple filter modules.
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getTopMode() {
  return document.querySelector('.top-mode-button.active')?.dataset.topMode || 'event';
}

export function getAnalysisMode() {
  return document.querySelector('.analysis-mode.active')?.dataset.mode || 'single';
}

export function getEventAnalysisSection() {
  return document.getElementById('eventAnalysisSection');
}

export function getPlayerAnalysisSection() {
  return document.getElementById('playerAnalysisSection');
}

export function getSectionEventTypeButtons(sectionElement) {
  return Array.from(sectionElement?.querySelectorAll('.event-type-filter') || []);
}

export function getActiveSectionEventTypes(sectionElement) {
  return getSectionEventTypeButtons(sectionElement)
    .filter(button => button.classList.contains('active'))
    .map(button => button.dataset.type.toLowerCase());
}

export function setSectionEventType(sectionElement, nextType = 'online') {
  const buttons = getSectionEventTypeButtons(sectionElement);
  const normalizedRequestedType = String(nextType || '').toLowerCase();
  const hasRequestedType = buttons.some(button => button.dataset.type.toLowerCase() === normalizedRequestedType);
  const resolvedType = hasRequestedType
    ? normalizedRequestedType
    : buttons.find(button => button.dataset.type.toLowerCase() === 'online')?.dataset.type.toLowerCase()
      || buttons[0]?.dataset.type.toLowerCase()
      || '';

  buttons.forEach(button => {
    button.classList.toggle('active', button.dataset.type.toLowerCase() === resolvedType);
  });
}

export function setDefaultSectionEventType(sectionElement, defaultType = 'online') {
  setSectionEventType(sectionElement, defaultType);
}

export function clearSectionEventTypes(sectionElement) {
  getSectionEventTypeButtons(sectionElement).forEach(button => {
    button.classList.remove('active');
  });
}

export function getSingleEventSelectedType() {
  return getActiveSectionEventTypes(getEventAnalysisSection())[0] || '';
}

export function getEventAnalysisSelectedTypes() {
  return getActiveSectionEventTypes(getEventAnalysisSection());
}

export function getPlayerAnalysisSelectedTypes() {
  return getActiveSectionEventTypes(getPlayerAnalysisSection());
}

export function resetSelectValue(selectId) {
  const select = document.getElementById(selectId);
  if (select) {
    select.value = '';
  }
}
