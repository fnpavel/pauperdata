// Contains shared DOM selectors and small helpers reused by multiple filter modules.
// Escapes text before inserting it into HTML strings.
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Reads the active top-level dashboard mode.
export function getTopMode() {
  return document.querySelector('.top-mode-button.active')?.dataset.topMode || 'event';
}

// Reads the active Event Analysis sub-mode.
export function getAnalysisMode() {
  return document.querySelector('.analysis-mode.active')?.dataset.mode || 'single';
}

// Returns the Event Analysis section root.
export function getEventAnalysisSection() {
  return document.getElementById('eventAnalysisSection');
}

// Returns the Player Analysis section root.
export function getPlayerAnalysisSection() {
  return document.getElementById('playerAnalysisSection');
}

// Returns event-type buttons inside a section.
export function getSectionEventTypeButtons(sectionElement) {
  return Array.from(sectionElement?.querySelectorAll('.event-type-filter') || []);
}

// Reads active event types inside a section.
export function getActiveSectionEventTypes(sectionElement) {
  return getSectionEventTypeButtons(sectionElement)
    .filter(button => button.classList.contains('active'))
    .map(button => button.dataset.type.toLowerCase());
}

// Sets exactly one active event type inside a section.
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

// Ensures a section has a valid default event type.
export function setDefaultSectionEventType(sectionElement, defaultType = 'online') {
  setSectionEventType(sectionElement, defaultType);
}

// Clears all event-type buttons inside a section.
export function clearSectionEventTypes(sectionElement) {
  getSectionEventTypeButtons(sectionElement).forEach(button => {
    button.classList.remove('active');
  });
}

// Reads the selected single-event event type.
export function getSingleEventSelectedType() {
  return getActiveSectionEventTypes(getEventAnalysisSection())[0] || '';
}

// Reads selected event types for Event Analysis.
export function getEventAnalysisSelectedTypes() {
  return getActiveSectionEventTypes(getEventAnalysisSection());
}

// Reads selected event types for Player Analysis.
export function getPlayerAnalysisSelectedTypes() {
  return getActiveSectionEventTypes(getPlayerAnalysisSection());
}

// Clears a select element by id when it exists.
export function resetSelectValue(selectId) {
  const select = document.getElementById(selectId);
  if (select) {
    select.value = '';
  }
}
