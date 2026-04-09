const EVENT_GROUPS = {
  'MTGO Challenge': {
    key: 'challenge',
    label: 'Challenge',
    order: 0,
    shortLabel: 'Challenge'
  },
  'MTGO Challenge 64': {
    key: 'challenge',
    label: 'Challenge',
    order: 0,
    shortLabel: 'Challenge 64'
  },
  'MTGO Qualifier': {
    key: 'qualifier',
    label: 'Qualifier',
    order: 1,
    shortLabel: 'Qualifier'
  },
  'MTGO Showcase': {
    key: 'showcase',
    label: 'Showcase',
    order: 2,
    shortLabel: 'Showcase'
  },
  'MTGO Super': {
    key: 'super',
    label: 'Super',
    order: 3,
    shortLabel: 'Super'
  }
};

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toDisplayTitleCase(value) {
  return String(value || '').replace(/\b([A-Za-z])([A-Za-z']*)\b/g, (_, firstChar, rest) => {
    return `${firstChar.toUpperCase()}${rest.toLowerCase()}`;
  });
}

function stripEventDate(eventName) {
  return String(eventName || '').replace(/\s*\(\d{4}-\d{2}-\d{2}\)$/, '');
}

function normalizeEventBaseName(value) {
  return toDisplayTitleCase(String(value || '').trim().replace(/\s+/g, ' '));
}

export function formatGroupDisplayLabel(label) {
  return toDisplayTitleCase(String(label || '').replace(/^MTGO\s+/i, '').trim());
}

export function getEventGroupInfo(eventName) {
  const baseName = normalizeEventBaseName(stripEventDate(eventName));
  const predefinedGroup = EVENT_GROUPS[baseName];

  if (predefinedGroup) {
    return {
      ...predefinedGroup,
      label: formatGroupDisplayLabel(predefinedGroup.label),
      shortLabel: formatGroupDisplayLabel(predefinedGroup.shortLabel)
    };
  }

  const label = formatGroupDisplayLabel(baseName);

  return {
    key: slugify(baseName),
    label,
    order: 100,
    shortLabel: label
  };
}
