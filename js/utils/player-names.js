export function normalizePlayerName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function getPlayerIdentityKey(value) {
  return normalizePlayerName(value).toLowerCase();
}

function comparePlayerVariantStats(a, b) {
  return (
    b.count - a.count ||
    String(b.latestDate).localeCompare(String(a.latestDate)) ||
    String(a.label).localeCompare(String(b.label), undefined, { sensitivity: 'base' }) ||
    String(a.label).localeCompare(String(b.label))
  );
}

export function buildPlayerFilterOptions(rows) {
  const groups = new Map();

  rows.forEach((row, index) => {
    const label = normalizePlayerName(row.Player);
    const key = getPlayerIdentityKey(label);

    if (!key) {
      return;
    }

    if (!groups.has(key)) {
      groups.set(key, new Map());
    }

    const variants = groups.get(key);
    const existingVariant = variants.get(label) || {
      label,
      count: 0,
      latestDate: '',
      latestIndex: -1
    };

    existingVariant.count += 1;

    const rowDate = String(row.Date || '');
    if (
      rowDate.localeCompare(existingVariant.latestDate) > 0 ||
      (rowDate === existingVariant.latestDate && index > existingVariant.latestIndex)
    ) {
      existingVariant.latestDate = rowDate;
      existingVariant.latestIndex = index;
    }

    variants.set(label, existingVariant);
  });

  return Array.from(groups.entries())
    .map(([key, variants]) => {
      const sortedVariants = Array.from(variants.values()).sort(comparePlayerVariantStats);
      return {
        key,
        label: sortedVariants[0]?.label || key,
        totalCount: sortedVariants.reduce((sum, variant) => sum + variant.count, 0),
        variants: sortedVariants.map(variant => variant.label)
      };
    })
    .sort((a, b) => {
      return (
        a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) ||
        a.label.localeCompare(b.label)
      );
    });
}

export function rowMatchesPlayerKey(row, playerKey) {
  return Boolean(playerKey) && getPlayerIdentityKey(row?.Player) === playerKey;
}

export function getSelectedPlayerLabel(playerFilterMenu) {
  if (!playerFilterMenu) {
    return '';
  }

  const selectedOption = playerFilterMenu.selectedOptions?.[0];
  if (!selectedOption || !selectedOption.value) {
    return '';
  }

  return normalizePlayerName(selectedOption.textContent || selectedOption.value);
}
