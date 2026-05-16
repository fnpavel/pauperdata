export function getFocusableElements(root) {
  if (!root) {
    return [];
  }

  return [...root.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter(element => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');
}

export function setupModalOverlay({
  trigger,
  overlay,
  modal,
  closeButton,
  onBeforeOpen,
  onAfterOpen,
  onAfterClose,
  getInitialFocus,
  getRestoreFocusTarget
}) {
  if (!overlay || !modal || overlay.dataset.initialized === 'true') {
    return {
      open() {},
      close() {}
    };
  }

  overlay.dataset.initialized = 'true';
  let lastTrigger = null;

  function open() {
    if ((trigger && trigger.disabled) || !overlay || !modal) {
      return;
    }

    lastTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : trigger || null;
    onBeforeOpen?.();
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    trigger?.setAttribute('aria-expanded', 'true');
    document.body.classList.add('modal-open');

    window.requestAnimationFrame(() => {
      const focusTarget = getInitialFocus?.() || closeButton || getFocusableElements(modal)[0] || modal;
      focusTarget?.focus();
      onAfterOpen?.();
    });
  }

  function close() {
    if (!overlay) {
      return;
    }

    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    trigger?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('modal-open');
    onAfterClose?.();

    const focusTarget = getRestoreFocusTarget?.(lastTrigger) || lastTrigger || trigger;
    if (focusTarget instanceof HTMLElement && document.contains(focusTarget)) {
      focusTarget.focus();
    }
  }

  trigger?.addEventListener('click', open);
  closeButton?.addEventListener('click', close);

  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      close();
    }
  });

  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusableElements = getFocusableElements(modal);
    if (focusableElements.length === 0) {
      event.preventDefault();
      modal.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  });

  return { open, close };
}
