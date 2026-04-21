const PDF_PAGE_WIDTH = 612;
const PDF_PAGE_HEIGHT = 792;
const PDF_MARGIN_LEFT = 54;
const PDF_MARGIN_RIGHT = 54;
const PDF_MARGIN_TOP = 54;
const PDF_MARGIN_BOTTOM = 54;
const PDF_BODY_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN_LEFT - PDF_MARGIN_RIGHT;
const PDF_FOOTER_HEIGHT = 28;
const PDF_LINE_HEIGHT_FACTOR = 1.35;
const PDF_TEXT_ENCODER = new TextEncoder();

const PDF_COLORS = {
  text: '#1f2430',
  muted: '#6f7886',
  border: '#d6dce4',
  borderStrong: '#c3cad4',
  surface: '#fbfcfd',
  surfaceAlt: '#f5f7fa',
  accent: '#d4a657',
  accentSoft: '#f6efdf',
  accentText: '#87631f',
  success: '#2f7d57',
  danger: '#a14848',
  chartSecondary: '#3b9c93',
  chartGrid: '#d6dde7'
};

function getByteLength(text = '') {
  return PDF_TEXT_ENCODER.encode(String(text || '')).length;
}

function normalizePdfText(value = '') {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u2026/g, '...')
    .replace(/\u2022/g, '-')
    .replace(/\t/g, '  ')
    .normalize('NFKD')
    .replace(/[^\x0A\x20-\x7E]/g, '');
}

function escapePdfText(value = '') {
  return normalizePdfText(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function sanitizeHexColor(color = '') {
  const normalized = String(color || '').trim().replace('#', '');
  if (/^[\da-f]{8}$/i.test(normalized)) {
    return normalized.slice(0, 6);
  }
  if (/^[\da-f]{6}$/i.test(normalized)) {
    return normalized;
  }
  if (/^[\da-f]{3}$/i.test(normalized)) {
    return normalized.split('').map(char => `${char}${char}`).join('');
  }
  return '000000';
}

function getPdfColorChannels(color = '') {
  const hex = sanitizeHexColor(color);
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255
  ];
}

function getPdfFillColor(color = PDF_COLORS.text) {
  const [red, green, blue] = getPdfColorChannels(color);
  return `${red.toFixed(3)} ${green.toFixed(3)} ${blue.toFixed(3)} rg`;
}

function getPdfStrokeColor(color = PDF_COLORS.text) {
  const [red, green, blue] = getPdfColorChannels(color);
  return `${red.toFixed(3)} ${green.toFixed(3)} ${blue.toFixed(3)} RG`;
}

function estimateMaxCharactersForWidth(width = PDF_BODY_WIDTH, fontSize = 12) {
  return Math.max(10, Math.floor(width / Math.max(fontSize * 0.54, 4)));
}

function splitLongWord(word = '', maxCharacters = 80) {
  const segments = [];
  let index = 0;

  while (index < word.length) {
    segments.push(word.slice(index, index + maxCharacters));
    index += maxCharacters;
  }

  return segments;
}

function wrapPdfText(text = '', maxCharacters = 80) {
  const normalizedText = normalizePdfText(text);
  const paragraphs = normalizedText.split('\n');
  const wrappedLines = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const normalizedParagraph = paragraph.replace(/\s+/g, ' ').trim();

    if (!normalizedParagraph) {
      wrappedLines.push('');
      return;
    }

    const words = normalizedParagraph.split(' ').flatMap(word => {
      return word.length > maxCharacters
        ? splitLongWord(word, maxCharacters)
        : [word];
    });

    let currentLine = '';
    words.forEach(word => {
      const nextLine = currentLine ? `${currentLine} ${word}` : word;
      if (nextLine.length <= maxCharacters) {
        currentLine = nextLine;
        return;
      }

      if (currentLine) {
        wrappedLines.push(currentLine);
      }
      currentLine = word;
    });

    if (currentLine) {
      wrappedLines.push(currentLine);
    }

    if (paragraphIndex < paragraphs.length - 1) {
      wrappedLines.push('');
    }
  });

  return wrappedLines.length > 0 ? wrappedLines : [''];
}

function wrapPdfTextToWidth(text = '', width = PDF_BODY_WIDTH, fontSize = 11) {
  return wrapPdfText(text, estimateMaxCharactersForWidth(width, fontSize));
}

function getLineHeight(fontSize = 11, lineHeightFactor = PDF_LINE_HEIGHT_FACTOR) {
  return Number(fontSize) * Number(lineHeightFactor || PDF_LINE_HEIGHT_FACTOR);
}

function createPdfLayout() {
  return {
    pages: [[]],
    currentY: PDF_PAGE_HEIGHT - PDF_MARGIN_TOP,
    bookmarks: []
  };
}

function startNewPage(layout) {
  layout.pages.push([]);
  layout.currentY = PDF_PAGE_HEIGHT - PDF_MARGIN_TOP;
}

function getCurrentPageIndex(layout) {
  return Math.max(0, (Array.isArray(layout?.pages) ? layout.pages.length : 1) - 1);
}

function addPdfBookmark(layout, title = '', {
  level = 0,
  top = layout?.currentY
} = {}) {
  const resolvedTitle = String(title || '').trim();
  if (!resolvedTitle || !layout) {
    return;
  }

  layout.bookmarks.push({
    title: resolvedTitle,
    level: Math.max(0, Math.floor(Number(level) || 0)),
    pageIndex: getCurrentPageIndex(layout),
    top: Number.isFinite(Number(top))
      ? Number(top)
      : layout.currentY
  });
}

function registerSectionBookmark(layout, section = {}) {
  if (section?.bookmark === false) {
    return;
  }

  const bookmarkTitle = String(section?.bookmarkTitle ?? section?.title ?? '').trim();
  if (!bookmarkTitle) {
    return;
  }

  addPdfBookmark(layout, bookmarkTitle, {
    level: section?.bookmarkLevel,
    top: section?.bookmarkTop
  });
}

function forceNewPage(layout) {
  const currentPage = layout.pages[layout.pages.length - 1];
  if (Array.isArray(currentPage) && currentPage.length > 0) {
    startNewPage(layout);
  }
}

function addCommand(layout, command = '') {
  const currentPage = layout.pages[layout.pages.length - 1];
  currentPage.push(command);
}

function ensureSpace(layout, height = 0) {
  if ((layout.currentY - Number(height || 0)) < (PDF_MARGIN_BOTTOM + PDF_FOOTER_HEIGHT)) {
    startNewPage(layout);
    return true;
  }

  return false;
}

function drawRect(layout, {
  x = PDF_MARGIN_LEFT,
  y = PDF_MARGIN_BOTTOM,
  width = PDF_BODY_WIDTH,
  height = 20,
  fillColor = '',
  borderColor = '',
  lineWidth = 1
} = {}) {
  const commands = ['q'];

  if (fillColor) {
    commands.push(getPdfFillColor(fillColor));
  }
  if (borderColor) {
    commands.push(getPdfStrokeColor(borderColor));
    commands.push(`${Number(lineWidth || 1).toFixed(2)} w`);
  }

  commands.push(
    `${Number(x).toFixed(2)} ${Number(y).toFixed(2)} ${Number(width).toFixed(2)} ${Number(height).toFixed(2)} re`
  );

  if (fillColor && borderColor) {
    commands.push('B');
  } else if (fillColor) {
    commands.push('f');
  } else {
    commands.push('S');
  }

  commands.push('Q');
  addCommand(layout, commands.join(' '));
}

function drawLine(layout, {
  x1 = PDF_MARGIN_LEFT,
  y1 = PDF_MARGIN_BOTTOM,
  x2 = PDF_PAGE_WIDTH - PDF_MARGIN_RIGHT,
  y2 = PDF_MARGIN_BOTTOM,
  color = PDF_COLORS.border,
  lineWidth = 1,
  dash = []
} = {}) {
  const resolvedDash = Array.isArray(dash) ? dash.filter(value => Number(value) > 0).map(Number) : [];

  addCommand(
    layout,
    [
      'q',
      getPdfStrokeColor(color),
      `${Number(lineWidth || 1).toFixed(2)} w`,
      `${resolvedDash.length > 0 ? `[${resolvedDash.map(value => value.toFixed(2)).join(' ')}] 0 d` : '[] 0 d'}`,
      `${Number(x1).toFixed(2)} ${Number(y1).toFixed(2)} m`,
      `${Number(x2).toFixed(2)} ${Number(y2).toFixed(2)} l`,
      'S',
      'Q'
    ].join(' ')
  );
}

function drawPolyline(layout, points = [], {
  color = PDF_COLORS.accent,
  lineWidth = 1.8,
  dash = []
} = {}) {
  if (!Array.isArray(points) || points.length < 2) {
    return;
  }

  const resolvedDash = Array.isArray(dash) ? dash.filter(value => Number(value) > 0).map(Number) : [];
  const commands = [
    'q',
    getPdfStrokeColor(color),
    `${Number(lineWidth || 1.8).toFixed(2)} w`,
    `${resolvedDash.length > 0 ? `[${resolvedDash.map(value => value.toFixed(2)).join(' ')}] 0 d` : '[] 0 d'}`,
    `${Number(points[0].x).toFixed(2)} ${Number(points[0].y).toFixed(2)} m`
  ];

  points.slice(1).forEach(point => {
    commands.push(`${Number(point.x).toFixed(2)} ${Number(point.y).toFixed(2)} l`);
  });

  commands.push('S', 'Q');
  addCommand(layout, commands.join(' '));
}

function drawPolygon(layout, points = [], {
  fillColor = '',
  borderColor = '',
  lineWidth = 1
} = {}) {
  if (!Array.isArray(points) || points.length < 3) {
    return;
  }

  const commands = ['q'];

  if (fillColor) {
    commands.push(getPdfFillColor(fillColor));
  }
  if (borderColor) {
    commands.push(getPdfStrokeColor(borderColor));
    commands.push(`${Number(lineWidth || 1).toFixed(2)} w`);
  }

  commands.push(`${Number(points[0].x).toFixed(2)} ${Number(points[0].y).toFixed(2)} m`);
  points.slice(1).forEach(point => {
    commands.push(`${Number(point.x).toFixed(2)} ${Number(point.y).toFixed(2)} l`);
  });
  commands.push('h');

  if (fillColor && borderColor) {
    commands.push('B');
  } else if (fillColor) {
    commands.push('f');
  } else {
    commands.push('S');
  }

  commands.push('Q');
  addCommand(layout, commands.join(' '));
}

function drawCircle(layout, {
  x = PDF_MARGIN_LEFT,
  y = PDF_MARGIN_BOTTOM,
  radius = 3,
  fillColor = '',
  borderColor = '',
  lineWidth = 1
} = {}) {
  const resolvedRadius = Math.max(0.8, Number(radius) || 3);
  const kappa = 0.5522847498;
  const control = resolvedRadius * kappa;
  const commands = ['q'];

  if (fillColor) {
    commands.push(getPdfFillColor(fillColor));
  }
  if (borderColor) {
    commands.push(getPdfStrokeColor(borderColor));
    commands.push(`${Number(lineWidth || 1).toFixed(2)} w`);
  }

  commands.push(
    `${Number(x).toFixed(2)} ${(Number(y) + resolvedRadius).toFixed(2)} m`,
    `${(Number(x) + control).toFixed(2)} ${(Number(y) + resolvedRadius).toFixed(2)} ${(Number(x) + resolvedRadius).toFixed(2)} ${(Number(y) + control).toFixed(2)} ${(Number(x) + resolvedRadius).toFixed(2)} ${Number(y).toFixed(2)} c`,
    `${(Number(x) + resolvedRadius).toFixed(2)} ${(Number(y) - control).toFixed(2)} ${(Number(x) + control).toFixed(2)} ${(Number(y) - resolvedRadius).toFixed(2)} ${Number(x).toFixed(2)} ${(Number(y) - resolvedRadius).toFixed(2)} c`,
    `${(Number(x) - control).toFixed(2)} ${(Number(y) - resolvedRadius).toFixed(2)} ${(Number(x) - resolvedRadius).toFixed(2)} ${(Number(y) - control).toFixed(2)} ${(Number(x) - resolvedRadius).toFixed(2)} ${Number(y).toFixed(2)} c`,
    `${(Number(x) - resolvedRadius).toFixed(2)} ${(Number(y) + control).toFixed(2)} ${(Number(x) - control).toFixed(2)} ${(Number(y) + resolvedRadius).toFixed(2)} ${Number(x).toFixed(2)} ${(Number(y) + resolvedRadius).toFixed(2)} c`
  );

  if (fillColor && borderColor) {
    commands.push('B');
  } else if (fillColor) {
    commands.push('f');
  } else {
    commands.push('S');
  }

  commands.push('Q');
  addCommand(layout, commands.join(' '));
}

function drawPointMarker(layout, {
  x = PDF_MARGIN_LEFT,
  y = PDF_MARGIN_BOTTOM,
  size = 4,
  shape = 'square',
  fillColor = PDF_COLORS.accent,
  borderColor = PDF_COLORS.accent,
  lineWidth = 0.8
} = {}) {
  const resolvedSize = Math.max(2, Number(size) || 4);
  const halfSize = resolvedSize / 2;
  const resolvedShape = String(shape || 'square').trim().toLowerCase();

  switch (resolvedShape) {
    case 'circle':
      drawCircle(layout, {
        x,
        y,
        radius: halfSize,
        fillColor,
        borderColor,
        lineWidth
      });
      return;
    case 'diamond':
      drawPolygon(layout, [
        { x, y: y + halfSize },
        { x: x + halfSize, y },
        { x, y: y - halfSize },
        { x: x - halfSize, y }
      ], {
        fillColor,
        borderColor,
        lineWidth
      });
      return;
    case 'triangle':
      drawPolygon(layout, [
        { x, y: y + halfSize },
        { x: x + halfSize, y: y - halfSize },
        { x: x - halfSize, y: y - halfSize }
      ], {
        fillColor,
        borderColor,
        lineWidth
      });
      return;
    case 'triangle-down':
      drawPolygon(layout, [
        { x: x - halfSize, y: y + halfSize },
        { x: x + halfSize, y: y + halfSize },
        { x, y: y - halfSize }
      ], {
        fillColor,
        borderColor,
        lineWidth
      });
      return;
    case 'cross':
      drawLine(layout, {
        x1: x - halfSize,
        y1: y - halfSize,
        x2: x + halfSize,
        y2: y + halfSize,
        color: borderColor || fillColor,
        lineWidth: Math.max(0.9, Number(lineWidth) || 0.9)
      });
      drawLine(layout, {
        x1: x - halfSize,
        y1: y + halfSize,
        x2: x + halfSize,
        y2: y - halfSize,
        color: borderColor || fillColor,
        lineWidth: Math.max(0.9, Number(lineWidth) || 0.9)
      });
      return;
    default:
      drawRect(layout, {
        x: x - halfSize,
        y: y - halfSize,
        width: resolvedSize,
        height: resolvedSize,
        fillColor,
        borderColor,
        lineWidth
      });
  }
}

function drawTextLine(layout, {
  x = PDF_MARGIN_LEFT,
  y = PDF_PAGE_HEIGHT - PDF_MARGIN_TOP,
  text = '',
  font = 'F1',
  size = 11,
  color = PDF_COLORS.text
} = {}) {
  addCommand(
    layout,
    [
      'q',
      getPdfFillColor(color),
      'BT',
      `/${font} ${Number(size || 11).toFixed(2)} Tf`,
      `1 0 0 1 ${Number(x).toFixed(2)} ${Number(y).toFixed(2)} Tm`,
      `(${escapePdfText(text)}) Tj`,
      'ET',
      'Q'
    ].join(' ')
  );
}

function renderWrappedText(layout, {
  x = PDF_MARGIN_LEFT,
  topY = PDF_PAGE_HEIGHT - PDF_MARGIN_TOP,
  width = PDF_BODY_WIDTH,
  text = '',
  font = 'F1',
  size = 11,
  color = PDF_COLORS.text,
  lineHeightFactor = PDF_LINE_HEIGHT_FACTOR
} = {}) {
  const lines = wrapPdfTextToWidth(text, width, size);
  const lineHeight = getLineHeight(size, lineHeightFactor);
  let cursorY = Number(topY);

  lines.forEach(line => {
    if (line) {
      drawTextLine(layout, {
        x,
        y: cursorY - Number(size || 11),
        text: line,
        font,
        size,
        color
      });
    }

    cursorY -= lineHeight;
  });

  return {
    lines,
    height: lines.length * lineHeight
  };
}

function renderTitleBlock(layout, report = {}) {
  const title = String(report?.title || 'PDF Report').trim();
  const subtitle = String(report?.subtitle || '').trim();

  ensureSpace(layout, subtitle ? 52 : 34);

  const titleBlock = renderWrappedText(layout, {
    text: title,
    font: 'F2',
    size: 21,
    color: PDF_COLORS.text
  });
  layout.currentY -= titleBlock.height;

  if (subtitle) {
    const subtitleBlock = renderWrappedText(layout, {
      topY: layout.currentY - 4,
      text: subtitle,
      size: 11,
      color: PDF_COLORS.muted
    });
    layout.currentY -= subtitleBlock.height + 8;
  } else {
    layout.currentY -= 8;
  }

  drawLine(layout, {
    x1: PDF_MARGIN_LEFT,
    y1: layout.currentY,
    x2: PDF_PAGE_WIDTH - PDF_MARGIN_RIGHT,
    y2: layout.currentY,
    color: PDF_COLORS.border,
    lineWidth: 1
  });
  layout.currentY -= 14;
}

function renderSummaryStats(layout, stats = []) {
  const resolvedStats = (Array.isArray(stats) ? stats : []).filter(item => item?.label || item?.value);
  if (resolvedStats.length === 0) {
    return;
  }

  const columns = Math.min(4, Math.max(2, resolvedStats.length));
  const gap = 10;
  const cardWidth = (PDF_BODY_WIDTH - ((columns - 1) * gap)) / columns;
  const rows = [];

  for (let index = 0; index < resolvedStats.length; index += columns) {
    rows.push(resolvedStats.slice(index, index + columns));
  }

  const cardHeights = rows.map(row => {
    return row.map(item => {
      const labelLines = wrapPdfTextToWidth(item.label || '', cardWidth - 22, 8.5);
      const valueLines = wrapPdfTextToWidth(item.value || '', cardWidth - 22, 15);
      return 12 + (labelLines.length * getLineHeight(8.5, 1.2)) + 4 + (valueLines.length * getLineHeight(15, 1.1)) + 12;
    });
  });

  const totalHeight = cardHeights.reduce((sum, rowHeights) => sum + Math.max(...rowHeights) + 10, 0);
  ensureSpace(layout, totalHeight);

  rows.forEach((row, rowIndex) => {
    const topY = layout.currentY;
    const rowHeight = Math.max(...cardHeights[rowIndex]);

    row.forEach((item, columnIndex) => {
      const x = PDF_MARGIN_LEFT + (columnIndex * (cardWidth + gap));
      const fillColor = item.fillColor || PDF_COLORS.accentSoft;
      const borderColor = item.borderColor || PDF_COLORS.border;
      const valueColor = item.valueColor || PDF_COLORS.accentText;

      drawRect(layout, {
        x,
        y: topY - rowHeight,
        width: cardWidth,
        height: rowHeight,
        fillColor,
        borderColor,
        lineWidth: 1
      });

      const labelBlock = renderWrappedText(layout, {
        x: x + 11,
        topY: topY - 10,
        width: cardWidth - 22,
        text: item.label || '',
        font: 'F2',
        size: 8.5,
        color: PDF_COLORS.muted,
        lineHeightFactor: 1.2
      });

      renderWrappedText(layout, {
        x: x + 11,
        topY: topY - 10 - labelBlock.height - 4,
        width: cardWidth - 22,
        text: item.value || '--',
        font: 'F2',
        size: 15,
        color: valueColor,
        lineHeightFactor: 1.1
      });
    });

    layout.currentY -= rowHeight + 10;
  });
}

function renderMetadataGrid(layout, metadata = []) {
  const resolvedMetadata = (Array.isArray(metadata) ? metadata : [])
    .map(item => Array.isArray(item) ? { label: item[0], value: item[1] } : item)
    .filter(item => item?.label || item?.value);

  if (resolvedMetadata.length === 0) {
    return;
  }

  const titleBlockHeight = 20;
  const columns = 2;
  const gap = 10;
  const cellWidth = (PDF_BODY_WIDTH - gap) / columns;
  const rows = [];

  for (let index = 0; index < resolvedMetadata.length; index += columns) {
    rows.push(resolvedMetadata.slice(index, index + columns));
  }

  const rowHeights = rows.map(row => {
    return Math.max(...row.map(item => {
      const valueLines = wrapPdfTextToWidth(item.value || '--', cellWidth - 20, 10.5);
      return 10 + getLineHeight(8.2, 1.15) + 4 + (valueLines.length * getLineHeight(10.5, 1.2)) + 10;
    }));
  });

  const totalHeight = titleBlockHeight + rowHeights.reduce((sum, value) => sum + value + 8, 0);
  ensureSpace(layout, totalHeight);

  renderWrappedText(layout, {
    topY: layout.currentY,
    text: 'Report Details',
    font: 'F2',
    size: 12,
    color: PDF_COLORS.text
  });
  layout.currentY -= titleBlockHeight;

  rows.forEach((row, rowIndex) => {
    const topY = layout.currentY;
    const rowHeight = rowHeights[rowIndex];

    row.forEach((item, columnIndex) => {
      const x = PDF_MARGIN_LEFT + (columnIndex * (cellWidth + gap));
      drawRect(layout, {
        x,
        y: topY - rowHeight,
        width: cellWidth,
        height: rowHeight,
        fillColor: PDF_COLORS.surface,
        borderColor: PDF_COLORS.border,
        lineWidth: 1
      });

      renderWrappedText(layout, {
        x: x + 10,
        topY: topY - 9,
        width: cellWidth - 20,
        text: String(item.label || 'Detail').toUpperCase(),
        font: 'F2',
        size: 8.2,
        color: PDF_COLORS.muted,
        lineHeightFactor: 1.15
      });

      renderWrappedText(layout, {
        x: x + 10,
        topY: topY - 9 - getLineHeight(8.2, 1.15) - 4,
        width: cellWidth - 20,
        text: item.value || '--',
        size: 10.5,
        color: PDF_COLORS.text,
        lineHeightFactor: 1.2
      });
    });

    layout.currentY -= rowHeight + 8;
  });
}

function renderSectionHeading(layout, title = '', subtitle = '') {
  const estimatedHeight = subtitle ? 34 : 20;
  ensureSpace(layout, estimatedHeight);

  const topY = layout.currentY;
  drawRect(layout, {
    x: PDF_MARGIN_LEFT,
    y: topY - 14,
    width: 4,
    height: 14,
    fillColor: PDF_COLORS.accent
  });

  const titleBlock = renderWrappedText(layout, {
    x: PDF_MARGIN_LEFT + 12,
    topY,
    width: PDF_BODY_WIDTH - 12,
    text: title,
    font: 'F2',
    size: 13,
    color: PDF_COLORS.text,
    lineHeightFactor: 1.15
  });

  layout.currentY -= titleBlock.height;

  if (subtitle) {
    const subtitleBlock = renderWrappedText(layout, {
      x: PDF_MARGIN_LEFT + 12,
      topY: layout.currentY - 3,
      width: PDF_BODY_WIDTH - 12,
      text: subtitle,
      size: 9.5,
      color: PDF_COLORS.muted,
      lineHeightFactor: 1.2
    });
    layout.currentY -= subtitleBlock.height;
  }

  layout.currentY -= 8;
}

function measureSectionHeadingHeight(title = '', subtitle = '') {
  const titleLines = wrapPdfTextToWidth(title || '', PDF_BODY_WIDTH - 12, 13);
  const subtitleLines = subtitle
    ? wrapPdfTextToWidth(subtitle, PDF_BODY_WIDTH - 12, 9.5)
    : [];

  let height = titleLines.length * getLineHeight(13, 1.15);
  if (subtitleLines.length > 0) {
    height += 3 + (subtitleLines.length * getLineHeight(9.5, 1.2));
  }

  return height + 8;
}

function renderKeyValueTableSection(layout, section = {}) {
  const rows = (Array.isArray(section?.rows) ? section.rows : []).filter(row => row?.label || row?.value);
  const headingHeight = measureSectionHeadingHeight(section.title || 'Section', section.subtitle || '');
  const compact = Boolean(section?.compact);
  const reserveBelow = Number.isFinite(Number(section?.reserveBelow)) ? Number(section.reserveBelow) : 0;
  const trailingSpacing = Number.isFinite(Number(section?.trailingSpacing)) ? Number(section.trailingSpacing) : 12;

  const labelWidth = Math.min(compact ? 144 : 152, PDF_BODY_WIDTH * (compact ? 0.29 : 0.3));
  const tableWidth = PDF_BODY_WIDTH;
  const paddingX = compact ? 10 : 12;
  const paddingY = compact ? 6 : 8;
  const labelFontSize = compact ? 8.6 : 9.2;
  const valueFontSize = compact ? 9.8 : 10.5;
  const labelLineHeightFactor = compact ? 1.12 : 1.15;
  const valueLineHeightFactor = compact ? 1.18 : 1.22;
  const rowGap = 0;
  const rowHeights = rows.map(row => {
    const labelLines = wrapPdfTextToWidth(row.label || '', labelWidth - paddingX, labelFontSize);
    const valueLines = wrapPdfTextToWidth(row.value || '--', tableWidth - labelWidth - (paddingX * 2) - 8, valueFontSize);
    return Math.max(
      labelLines.length * getLineHeight(labelFontSize, labelLineHeightFactor),
      valueLines.length * getLineHeight(valueFontSize, valueLineHeightFactor)
    ) + (paddingY * 2);
  });
  const totalHeight = rowHeights.reduce((sum, height) => sum + height + rowGap, 0);
  const emptyStateHeight = compact ? 42 : 48;
  ensureSpace(layout, headingHeight + (rows.length === 0 ? emptyStateHeight : totalHeight) + reserveBelow);
  registerSectionBookmark(layout, section);
  renderSectionHeading(layout, section.title || 'Section', section.subtitle || '');

  if (rows.length === 0) {
    drawRect(layout, {
      x: PDF_MARGIN_LEFT,
      y: layout.currentY - 38,
      width: PDF_BODY_WIDTH,
      height: 38,
      fillColor: PDF_COLORS.surface,
      borderColor: PDF_COLORS.border
    });
    renderWrappedText(layout, {
      x: PDF_MARGIN_LEFT + 12,
      topY: layout.currentY - 10,
      width: PDF_BODY_WIDTH - 24,
      text: section.emptyText || 'No report data is available for this section.',
      size: 10,
      color: PDF_COLORS.muted
    });
    layout.currentY -= 48;
    return;
  }

  const topY = layout.currentY;
  drawRect(layout, {
    x: PDF_MARGIN_LEFT,
    y: topY - totalHeight,
    width: tableWidth,
    height: totalHeight,
    fillColor: PDF_COLORS.surface,
    borderColor: PDF_COLORS.borderStrong,
    lineWidth: 1
  });

  let cursorY = topY;
  rows.forEach((row, rowIndex) => {
    const rowHeight = rowHeights[rowIndex];
    const rowBottomY = cursorY - rowHeight;

    if (rowIndex % 2 === 1) {
      drawRect(layout, {
        x: PDF_MARGIN_LEFT,
        y: rowBottomY,
        width: tableWidth,
        height: rowHeight,
        fillColor: PDF_COLORS.surfaceAlt
      });
    }

    if (rowIndex > 0) {
      drawLine(layout, {
        x1: PDF_MARGIN_LEFT,
        y1: cursorY,
        x2: PDF_MARGIN_LEFT + tableWidth,
        y2: cursorY,
        color: PDF_COLORS.border
      });
    }

    renderWrappedText(layout, {
      x: PDF_MARGIN_LEFT + paddingX,
      topY: cursorY - paddingY,
      width: labelWidth - paddingX,
      text: row.label || '',
      font: 'F2',
      size: labelFontSize,
      color: PDF_COLORS.muted,
      lineHeightFactor: labelLineHeightFactor
    });

    renderWrappedText(layout, {
      x: PDF_MARGIN_LEFT + labelWidth + 8,
      topY: cursorY - paddingY,
      width: tableWidth - labelWidth - paddingX - 8,
      text: row.value || '--',
      size: valueFontSize,
      color: row.valueColor || PDF_COLORS.text,
      lineHeightFactor: valueLineHeightFactor
    });

    cursorY = rowBottomY;
  });

  layout.currentY -= totalHeight + trailingSpacing;
}

function drawChartLegend(layout, {
  x = PDF_MARGIN_LEFT,
  topY = PDF_PAGE_HEIGHT - PDF_MARGIN_TOP,
  width = PDF_BODY_WIDTH,
  series = [],
  compact = false
} = {}) {
  let cursorX = x;
  const maxX = x + width;
  let cursorY = topY;
  const rowHeight = compact ? 12 : 14;
  const lineLength = compact ? 12 : 14;
  const labelOffset = compact ? 16 : 18;
  const labelSize = compact ? 8 : 8.6;
  const lineOffset = compact ? 4.5 : 5;
  const labelYOffset = compact ? 8.2 : 9;
  const markerSize = compact ? 3.2 : 3.8;

  series.forEach(item => {
    const label = item?.label || 'Series';
    const itemWidth = Math.min(compact ? 150 : 170, (compact ? 24 : 28) + (label.length * (compact ? 4.9 : 5.4)));

    if ((cursorX + itemWidth) > maxX) {
      cursorX = x;
      cursorY -= rowHeight;
    }

    drawLine(layout, {
      x1: cursorX,
      y1: cursorY - lineOffset,
      x2: cursorX + lineLength,
      y2: cursorY - lineOffset,
      color: item?.color || PDF_COLORS.accent,
      lineWidth: compact ? 1.8 : 2,
      dash: item?.dash || []
    });
    drawPointMarker(layout, {
      x: cursorX + (lineLength / 2),
      y: cursorY - lineOffset,
      size: markerSize,
      shape: item?.pointShape || 'square',
      fillColor: item?.color || PDF_COLORS.accent,
      borderColor: item?.color || PDF_COLORS.accent,
      lineWidth: compact ? 0.7 : 0.8
    });
    drawTextLine(layout, {
      x: cursorX + labelOffset,
      y: cursorY - labelYOffset,
      text: label,
      size: labelSize,
      color: PDF_COLORS.text
    });

    cursorX += itemWidth;
  });

  return topY - cursorY + rowHeight;
}

function measureChartLegendHeight(series = [], width = PDF_BODY_WIDTH - 28, {
  compact = false
} = {}) {
  let cursorX = 0;
  let rows = 1;
  const rowHeight = compact ? 12 : 14;

  (Array.isArray(series) ? series : []).forEach(item => {
    const label = item?.label || 'Series';
    const itemWidth = Math.min(compact ? 150 : 170, (compact ? 24 : 28) + (label.length * (compact ? 4.9 : 5.4)));

    if (cursorX > 0 && (cursorX + itemWidth) > width) {
      rows += 1;
      cursorX = 0;
    }

    cursorX += itemWidth;
  });

  return rows * rowHeight;
}

function renderLineChartSection(layout, section = {}) {
  const series = (Array.isArray(section?.series) ? section.series : [])
    .map(item => ({
      label: item?.label || 'Series',
      color: item?.color || PDF_COLORS.accent,
      dash: Array.isArray(item?.dash) ? item.dash : [],
      pointShape: item?.pointShape || 'square',
      lineWidth: Number(item?.lineWidth) || 2,
      data: Array.isArray(item?.data) ? item.data.map(value => {
        if (value === null || value === undefined || value === '') {
          return null;
        }
        const numericValue = Number(value);
        return Number.isFinite(numericValue) ? numericValue : null;
      }) : []
    }))
    .filter(item => item.data.some(value => Number.isFinite(value)));
  const compact = Boolean(section?.compact);
  const connectDiscontinuities = Boolean(section?.connectDiscontinuities);
  const hideHeading = Boolean(section?.hideHeading);
  const trailingSpacing = Number.isFinite(Number(section?.trailingSpacing)) ? Number(section.trailingSpacing) : 12;
  const headingHeight = hideHeading ? 0 : measureSectionHeadingHeight(section.title || 'Chart', section.subtitle || '');
  const noteFontSize = compact ? 8.5 : 9.3;
  const noteLineHeightFactor = compact ? 1.15 : 1.2;
  const noteTopOffset = compact ? 22 : 26;
  const chartHeight = compact ? 128 : 158;
  const chartTopOffset = compact ? 12 : 16;
  const chartLeftInset = compact ? 38 : 42;
  const chartRightInset = compact ? 52 : 58;
  const gridLabelSize = compact ? 7.8 : 8.4;
  const axisLabelSize = compact ? 7.8 : 8.3;

  const noteLines = section?.note
    ? wrapPdfTextToWidth(section.note, PDF_BODY_WIDTH - 28, noteFontSize)
    : [];
  const noteHeight = noteLines.length > 0 ? (noteLines.length * getLineHeight(noteFontSize, noteLineHeightFactor)) + (compact ? 6 : 8) : 0;
  const legendHeight = measureChartLegendHeight(series, PDF_BODY_WIDTH - 28, { compact });
  const chartBoxHeight = (compact ? 34 : 42) + legendHeight + chartHeight + noteHeight;

  ensureSpace(layout, headingHeight + chartBoxHeight);
  registerSectionBookmark(layout, section);
  if (!hideHeading) {
    renderSectionHeading(layout, section.title || 'Chart', section.subtitle || '');
  }

  const boxTopY = layout.currentY;
  drawRect(layout, {
    x: PDF_MARGIN_LEFT,
    y: boxTopY - chartBoxHeight,
    width: PDF_BODY_WIDTH,
    height: chartBoxHeight,
    fillColor: PDF_COLORS.surface,
    borderColor: PDF_COLORS.borderStrong
  });

  if (series.length === 0) {
    renderWrappedText(layout, {
      x: PDF_MARGIN_LEFT + 14,
      topY: boxTopY - 16,
      width: PDF_BODY_WIDTH - 28,
      text: section.emptyText || 'Not enough Elo history is available to draw a chart for this report.',
      size: 10,
      color: PDF_COLORS.muted
    });
    layout.currentY -= chartBoxHeight + 12;
    return;
  }

  drawChartLegend(layout, {
    x: PDF_MARGIN_LEFT + 14,
    topY: boxTopY - (compact ? 10 : 12),
    width: PDF_BODY_WIDTH - 28,
    series,
    compact
  });

  const chartX = PDF_MARGIN_LEFT + chartLeftInset;
  const chartTopY = boxTopY - chartTopOffset - legendHeight;
  const chartWidth = PDF_BODY_WIDTH - chartRightInset;
  const chartBottomY = chartTopY - chartHeight;
  const chartRightX = chartX + chartWidth;
  const numericValues = series.flatMap(item => item.data).filter(value => Number.isFinite(value));
  const rawMin = Math.min(...numericValues);
  const rawMax = Math.max(...numericValues);
  const valueSpan = Math.max(10, rawMax - rawMin);
  const yMin = Math.floor((rawMin - (valueSpan * 0.08)) / 10) * 10;
  const yMax = Math.ceil((rawMax + (valueSpan * 0.08)) / 10) * 10;
  const resolvedSpan = Math.max(10, yMax - yMin);
  const pointCount = Math.max(...series.map(item => item.data.length));
  const xStep = pointCount > 1 ? chartWidth / (pointCount - 1) : chartWidth;

  for (let gridIndex = 0; gridIndex <= 4; gridIndex += 1) {
    const ratio = gridIndex / 4;
    const y = chartBottomY + (chartHeight * ratio);
    const labelValue = yMin + (resolvedSpan * ratio);
    drawLine(layout, {
      x1: chartX,
      y1: y,
      x2: chartRightX,
      y2: y,
      color: PDF_COLORS.chartGrid,
      lineWidth: gridIndex === 0 ? 1 : 0.8
    });
    drawTextLine(layout, {
      x: PDF_MARGIN_LEFT + 2,
      y: y - (compact ? 2.5 : 3),
      text: String(Math.round(labelValue)),
      size: gridLabelSize,
      color: PDF_COLORS.muted
    });
  }

  drawLine(layout, {
    x1: chartX,
    y1: chartBottomY,
    x2: chartX,
    y2: chartTopY,
    color: PDF_COLORS.borderStrong,
    lineWidth: 1
  });
  drawLine(layout, {
    x1: chartX,
    y1: chartBottomY,
    x2: chartRightX,
    y2: chartBottomY,
    color: PDF_COLORS.borderStrong,
    lineWidth: 1
  });

  series.forEach(item => {
    const segments = [];
    let currentSegment = [];
    const resolvedPoints = [];

    item.data.forEach((value, index) => {
      if (!Number.isFinite(value)) {
        if (currentSegment.length > 1) {
          segments.push(currentSegment);
        }
        currentSegment = [];
        return;
      }

      const x = chartX + (xStep * index);
      const yRatio = (value - yMin) / resolvedSpan;
      const y = chartBottomY + (chartHeight * yRatio);
      const point = { x, y };
      currentSegment.push(point);
      resolvedPoints.push(point);
    });

    if (currentSegment.length > 1) {
      segments.push(currentSegment);
    }

    if (connectDiscontinuities) {
      if (resolvedPoints.length > 1) {
        drawPolyline(layout, resolvedPoints, {
          color: item.color,
          lineWidth: item.lineWidth || 2,
          dash: item.dash || []
        });
      }
    } else {
      segments.forEach(segment => {
        drawPolyline(layout, segment, {
          color: item.color,
          lineWidth: item.lineWidth || 2,
          dash: item.dash || []
        });
      });
    }

    const basePointSize = compact
      ? (item.lineWidth >= 2.8 ? 3.6 : 2.8)
      : (item.lineWidth >= 2.8 ? 4.2 : 3.4);
    resolvedPoints.forEach(point => {
      drawPointMarker(layout, {
        x: point.x,
        y: point.y,
        size: basePointSize,
        shape: item.pointShape || 'square',
        fillColor: item.color,
        borderColor: item.color,
        lineWidth: 0.6
      });
    });

    const finalPoint = resolvedPoints[resolvedPoints.length - 1];
    if (finalPoint) {
      const finalPointSize = basePointSize + (compact ? 1 : 1.2);
      drawPointMarker(layout, {
        x: finalPoint.x,
        y: finalPoint.y,
        size: finalPointSize,
        shape: item.pointShape || 'square',
        fillColor: item.color,
        borderColor: item.color,
        lineWidth: 0.8
      });
    }
  });

  if (section?.startLabel) {
    drawTextLine(layout, {
      x: chartX,
      y: chartBottomY - (compact ? 12 : 14),
      text: section.startLabel,
      size: axisLabelSize,
      color: PDF_COLORS.muted
    });
  }

  if (section?.endLabel) {
    const endLabel = String(section.endLabel || '');
    const endWidth = estimateMaxCharactersForWidth(90, 8.3);
    const endText = wrapPdfText(endLabel, endWidth)[0] || endLabel;
    drawTextLine(layout, {
      x: chartRightX - Math.min(80, endText.length * 4.2),
      y: chartBottomY - (compact ? 12 : 14),
      text: endText,
      size: axisLabelSize,
      color: PDF_COLORS.muted
    });
  }

  if (noteLines.length > 0) {
    renderWrappedText(layout, {
      x: PDF_MARGIN_LEFT + 14,
      topY: chartBottomY - noteTopOffset,
      width: PDF_BODY_WIDTH - 28,
      text: section.note,
      size: noteFontSize,
      color: PDF_COLORS.muted,
      lineHeightFactor: noteLineHeightFactor
    });
  }

  layout.currentY -= chartBoxHeight + trailingSpacing;
}

function normalizeTableColumns(columns = []) {
  const resolvedColumns = (Array.isArray(columns) ? columns : []).filter(column => column?.key || column?.label);
  const totalWidth = resolvedColumns.reduce((sum, column) => {
    return sum + (Number(column?.width) > 0 ? Number(column.width) : 1);
  }, 0) || resolvedColumns.length || 1;

  return resolvedColumns.map(column => ({
    ...column,
    widthRatio: (Number(column?.width) > 0 ? Number(column.width) : 1) / totalWidth
  }));
}

function renderTableSection(layout, section = {}) {
  const rows = Array.isArray(section?.rows) ? section.rows : [];
  const columns = normalizeTableColumns(section?.columns);
  const title = section.title || 'Table';
  const subtitle = section.subtitle || '';
  const note = String(section?.note || '').trim();
  const headingHeight = measureSectionHeadingHeight(title, subtitle);

  const renderHeading = continuation => {
    renderSectionHeading(layout, continuation ? `${title} (cont.)` : title, continuation ? '' : subtitle);
  };

  if (columns.length === 0 || rows.length === 0) {
    ensureSpace(layout, headingHeight + 48);
    registerSectionBookmark(layout, section);
    renderHeading(false);
    drawRect(layout, {
      x: PDF_MARGIN_LEFT,
      y: layout.currentY - 38,
      width: PDF_BODY_WIDTH,
      height: 38,
      fillColor: PDF_COLORS.surface,
      borderColor: PDF_COLORS.border
    });
    renderWrappedText(layout, {
      x: PDF_MARGIN_LEFT + 12,
      topY: layout.currentY - 10,
      width: PDF_BODY_WIDTH - 24,
      text: section.emptyText || 'No table rows are available for this report section.',
      size: 10,
      color: PDF_COLORS.muted
    });
    layout.currentY -= 48;
    return;
  }

  const tableWidth = PDF_BODY_WIDTH;
  const headerHeight = 26;
  const cellPaddingX = 8;
  const cellPaddingY = 7;
  const columnPositions = [];
  let runningX = PDF_MARGIN_LEFT;

  columns.forEach(column => {
    const width = tableWidth * column.widthRatio;
    columnPositions.push({
      ...column,
      x: runningX,
      width
    });
    runningX += width;
  });

  const drawHeaderRow = topY => {
    drawRect(layout, {
      x: PDF_MARGIN_LEFT,
      y: topY - headerHeight,
      width: tableWidth,
      height: headerHeight,
      fillColor: PDF_COLORS.accentSoft,
      borderColor: PDF_COLORS.borderStrong
    });

    columnPositions.forEach((column, columnIndex) => {
      if (columnIndex > 0) {
        drawLine(layout, {
          x1: column.x,
          y1: topY - headerHeight,
          x2: column.x,
          y2: topY,
          color: PDF_COLORS.border
        });
      }

      renderWrappedText(layout, {
        x: column.x + cellPaddingX,
        topY: topY - 7,
        width: column.width - (cellPaddingX * 2),
        text: column.label || column.key || '',
        font: 'F2',
        size: 8.8,
        color: PDF_COLORS.accentText,
        lineHeightFactor: 1.15
      });
    });
  };

  const firstRowMetrics = columnPositions.map(column => {
    const value = rows?.[0]?.[column.key] ?? '';
    const lines = wrapPdfTextToWidth(String(value), column.width - (cellPaddingX * 2), 8.8);
    return Math.max(1, lines.length) * getLineHeight(8.8, 1.18);
  });
  const firstRowHeight = (rows.length > 0 ? Math.max(...firstRowMetrics) + (cellPaddingY * 2) : 0);
  ensureSpace(layout, headingHeight + headerHeight + firstRowHeight + 12);
  registerSectionBookmark(layout, section);
  renderHeading(false);
  drawHeaderRow(layout.currentY);
  layout.currentY -= headerHeight;

  rows.forEach((row, rowIndex) => {
    const cellMetrics = columnPositions.map(column => {
      const value = row?.[column.key] ?? '';
      const lines = wrapPdfTextToWidth(String(value), column.width - (cellPaddingX * 2), 8.8);
      return {
        lines,
        height: Math.max(1, lines.length) * getLineHeight(8.8, 1.18)
      };
    });

    const rowHeight = Math.max(...cellMetrics.map(metric => metric.height)) + (cellPaddingY * 2);

    if ((layout.currentY - rowHeight) < (PDF_MARGIN_BOTTOM + PDF_FOOTER_HEIGHT)) {
      startNewPage(layout);
      renderHeading(true);
      ensureSpace(layout, headerHeight + rowHeight + 12);
      drawHeaderRow(layout.currentY);
      layout.currentY -= headerHeight;
    }

    const topY = layout.currentY;
    const fillColor = rowIndex % 2 === 0 ? PDF_COLORS.surface : PDF_COLORS.surfaceAlt;
    drawRect(layout, {
      x: PDF_MARGIN_LEFT,
      y: topY - rowHeight,
      width: tableWidth,
      height: rowHeight,
      fillColor,
      borderColor: PDF_COLORS.border
    });

    columnPositions.forEach((column, columnIndex) => {
      if (columnIndex > 0) {
        drawLine(layout, {
          x1: column.x,
          y1: topY - rowHeight,
          x2: column.x,
          y2: topY,
          color: PDF_COLORS.border
        });
      }

      const cell = cellMetrics[columnIndex];
      cell.lines.forEach((line, lineIndex) => {
        if (!line) {
          return;
        }

        drawTextLine(layout, {
          x: column.x + cellPaddingX,
          y: topY - cellPaddingY - 8.8 - (lineIndex * getLineHeight(8.8, 1.18)),
          text: line,
          size: 8.8,
          color: PDF_COLORS.text
        });
      });
    });

    layout.currentY -= rowHeight;
  });

  if (note) {
    layout.currentY -= 6;
    renderWrappedText(layout, {
      x: PDF_MARGIN_LEFT + 4,
      topY: layout.currentY,
      width: PDF_BODY_WIDTH - 8,
      text: note,
      size: 9,
      color: PDF_COLORS.muted,
      lineHeightFactor: 1.2
    });
    layout.currentY -= (wrapPdfTextToWidth(note, PDF_BODY_WIDTH - 8, 9).length * getLineHeight(9, 1.2));
  }

  layout.currentY -= 12;
}

function renderCardsSection(layout, section = {}) {
  const items = Array.isArray(section?.items) ? section.items : [];
  const title = section.title || 'Items';
  const subtitle = section.subtitle || '';
  const headingHeight = measureSectionHeadingHeight(title, subtitle);
  const compact = Boolean(section?.compact);
  const singlePage = Boolean(section?.singlePage);
  const trailingSpacing = Number.isFinite(Number(section?.trailingSpacing)) ? Number(section.trailingSpacing) : 0;
  const titleFontSize = compact ? 10 : 10.8;
  const titleLineHeightFactor = 1.2;
  const subtitleFontSize = compact ? 8.4 : 9;
  const subtitleLineHeightFactor = compact ? 1.15 : 1.18;
  const detailFontSize = compact ? 8.8 : 9.6;
  const detailLineHeightFactor = 1.2;
  const accentFontSize = compact ? 9.6 : 10.4;
  const accentLineHeightFactor = 1.1;
  const cardPadding = compact ? 8 : 10;
  const afterTitleGap = compact ? 3 : 4;
  const afterDetailGap = compact ? 5 : 6;
  const cardGap = compact ? 6 : 8;
  const accentWidth = compact ? 72 : 88;
  const titleWidth = PDF_BODY_WIDTH - (compact ? 102 : 116);
  const accentBarWidth = compact ? 4 : 5;

  const renderHeading = continuation => {
    renderSectionHeading(layout, continuation ? `${title} (cont.)` : title, continuation ? '' : subtitle);
  };

  if (items.length === 0) {
    ensureSpace(layout, headingHeight + 48);
    registerSectionBookmark(layout, section);
    renderHeading(false);
    drawRect(layout, {
      x: PDF_MARGIN_LEFT,
      y: layout.currentY - 38,
      width: PDF_BODY_WIDTH,
      height: 38,
      fillColor: PDF_COLORS.surface,
      borderColor: PDF_COLORS.border
    });
    renderWrappedText(layout, {
      x: PDF_MARGIN_LEFT + 12,
      topY: layout.currentY - 10,
      width: PDF_BODY_WIDTH - 24,
      text: section.emptyText || 'No items are available for this report section.',
      size: 10,
      color: PDF_COLORS.muted
    });
    layout.currentY -= 48;
    return;
  }

  const measureCardHeight = item => {
    const titleLines = wrapPdfTextToWidth(item?.title || '', titleWidth, titleFontSize);
    const subtitleLines = item?.subtitle
      ? wrapPdfTextToWidth(item.subtitle, PDF_BODY_WIDTH - 28, subtitleFontSize)
      : [];
    const detailLines = item?.detail
      ? wrapPdfTextToWidth(item.detail, PDF_BODY_WIDTH - 28, detailFontSize)
      : [];

    return cardPadding
      + (titleLines.length * getLineHeight(titleFontSize, titleLineHeightFactor))
      + (subtitleLines.length > 0 ? afterTitleGap + (subtitleLines.length * getLineHeight(subtitleFontSize, subtitleLineHeightFactor)) : 0)
      + (detailLines.length > 0 ? afterDetailGap + (detailLines.length * getLineHeight(detailFontSize, detailLineHeightFactor)) : 0)
      + cardPadding;
  };

  const firstItem = items[0] || {};
  const firstCardHeight = measureCardHeight(firstItem);
  ensureSpace(layout, headingHeight + firstCardHeight + 8);
  registerSectionBookmark(layout, section);
  renderHeading(false);

  items.forEach(item => {
    const titleLines = wrapPdfTextToWidth(item?.title || '', titleWidth, titleFontSize);
    const subtitleLines = item?.subtitle
      ? wrapPdfTextToWidth(item.subtitle, PDF_BODY_WIDTH - 28, subtitleFontSize)
      : [];
    const detailLines = item?.detail
      ? wrapPdfTextToWidth(item.detail, PDF_BODY_WIDTH - 28, detailFontSize)
      : [];
    const accentLines = item?.accentText
      ? wrapPdfTextToWidth(item.accentText, accentWidth, accentFontSize)
      : [];
    const cardHeight = measureCardHeight(item);

    if ((layout.currentY - cardHeight) < (PDF_MARGIN_BOTTOM + PDF_FOOTER_HEIGHT)) {
      if (singlePage) {
        return;
      }
      startNewPage(layout);
      renderHeading(true);
    }

    const topY = layout.currentY;
    drawRect(layout, {
      x: PDF_MARGIN_LEFT,
      y: topY - cardHeight,
      width: PDF_BODY_WIDTH,
      height: cardHeight,
      fillColor: PDF_COLORS.surface,
      borderColor: PDF_COLORS.borderStrong
    });
    drawRect(layout, {
      x: PDF_MARGIN_LEFT,
      y: topY - cardHeight,
      width: accentBarWidth,
      height: cardHeight,
      fillColor: item?.accentColor || PDF_COLORS.accent
    });

    let textTopY = topY - cardPadding;
    titleLines.forEach((line, index) => {
      drawTextLine(layout, {
        x: PDF_MARGIN_LEFT + 14,
        y: textTopY - titleFontSize - (index * getLineHeight(titleFontSize, titleLineHeightFactor)),
        text: line,
        font: 'F2',
        size: titleFontSize,
        color: PDF_COLORS.text
      });
    });

    if (accentLines.length > 0) {
      accentLines.forEach((line, index) => {
        drawTextLine(layout, {
          x: PDF_PAGE_WIDTH - PDF_MARGIN_RIGHT - 82,
          y: topY - titleFontSize - (index * getLineHeight(accentFontSize, accentLineHeightFactor)),
          text: line,
          font: 'F2',
          size: accentFontSize,
          color: item?.accentColor || PDF_COLORS.accentText
        });
      });
    }

    textTopY -= titleLines.length * getLineHeight(titleFontSize, titleLineHeightFactor);

    if (subtitleLines.length > 0) {
      textTopY -= afterTitleGap;
      subtitleLines.forEach((line, index) => {
        drawTextLine(layout, {
          x: PDF_MARGIN_LEFT + 14,
          y: textTopY - subtitleFontSize - (index * getLineHeight(subtitleFontSize, subtitleLineHeightFactor)),
          text: line,
          size: subtitleFontSize,
          color: PDF_COLORS.muted
        });
      });
      textTopY -= subtitleLines.length * getLineHeight(subtitleFontSize, subtitleLineHeightFactor);
    }

    if (detailLines.length > 0) {
      textTopY -= afterDetailGap;
      detailLines.forEach((line, index) => {
        drawTextLine(layout, {
          x: PDF_MARGIN_LEFT + 14,
          y: textTopY - detailFontSize - (index * getLineHeight(detailFontSize, detailLineHeightFactor)),
          text: line,
          size: detailFontSize,
          color: PDF_COLORS.text
        });
      });
    }

    layout.currentY -= cardHeight + cardGap;
  });

  layout.currentY -= trailingSpacing;
}

function renderLegacyTextSection(layout, section = {}) {
  const lines = Array.isArray(section?.lines) ? section.lines : [];
  const headingHeight = measureSectionHeadingHeight(section.title || 'Section', section.subtitle || '');
  const firstLine = lines[0] && typeof lines[0] === 'object' && !Array.isArray(lines[0])
    ? lines[0]
    : { text: String(lines[0] ?? '') };
  const firstLineHeight = firstLine?.text
    ? wrapPdfTextToWidth(firstLine.text || '', PDF_BODY_WIDTH, Number(firstLine.size) || 10.3).length * getLineHeight(Number(firstLine.size) || 10.3, 1.2)
    : 0;
  ensureSpace(layout, headingHeight + firstLineHeight + 4);
  registerSectionBookmark(layout, section);
  renderSectionHeading(layout, section.title || 'Section', section.subtitle || '');

  if (lines.length === 0) {
    layout.currentY -= 4;
    return;
  }

  lines.forEach(line => {
    const resolvedLine = line && typeof line === 'object' && !Array.isArray(line)
      ? line
      : { text: String(line ?? '') };
    const wrappedLines = wrapPdfTextToWidth(resolvedLine.text || '', PDF_BODY_WIDTH, Number(resolvedLine.size) || 10.3);
    const blockHeight = wrappedLines.length * getLineHeight(Number(resolvedLine.size) || 10.3, 1.2);

    ensureSpace(layout, blockHeight + 4);
    renderWrappedText(layout, {
      topY: layout.currentY,
      text: resolvedLine.text || '',
      font: resolvedLine.font || 'F1',
      size: Number(resolvedLine.size) || 10.3,
      color: resolvedLine.color || PDF_COLORS.text,
      lineHeightFactor: 1.2
    });
    layout.currentY -= blockHeight + 4;
  });

  layout.currentY -= 8;
}

function renderSection(layout, section = {}) {
  if (section?.pageBreakBefore) {
    forceNewPage(layout);
  }

  switch (section?.type) {
    case 'keyValueTable':
      renderKeyValueTableSection(layout, section);
      return;
    case 'lineChart':
      renderLineChartSection(layout, section);
      return;
    case 'table':
      renderTableSection(layout, section);
      return;
    case 'cards':
      renderCardsSection(layout, section);
      return;
    default:
      renderLegacyTextSection(layout, section);
  }
}

function renderFooter(pageCommands = [], pageIndex = 0, pageCount = 1) {
  return [
    ...pageCommands,
    [
      'q',
      getPdfFillColor(PDF_COLORS.muted),
      'BT',
      '/F1 9.00 Tf',
      `1 0 0 1 ${PDF_MARGIN_LEFT.toFixed(2)} 28.00 Tm`,
      `(${escapePdfText(`Page ${pageIndex + 1} of ${pageCount}`)}) Tj`,
      'ET',
      'Q'
    ].join(' ')
  ].join('\n');
}

function buildBookmarkTree(bookmarks = []) {
  const root = { children: [] };
  const stack = [root];

  (Array.isArray(bookmarks) ? bookmarks : []).forEach(bookmark => {
    const normalizedLevel = Math.max(0, Math.floor(Number(bookmark?.level) || 0));
    const effectiveLevel = Math.min(normalizedLevel, stack.length - 1);
    stack.length = effectiveLevel + 1;

    const parent = stack[stack.length - 1] || root;
    const node = {
      title: String(bookmark?.title || '').trim(),
      pageIndex: Math.max(0, Math.floor(Number(bookmark?.pageIndex) || 0)),
      top: Number.isFinite(Number(bookmark?.top))
        ? Number(bookmark.top)
        : (PDF_PAGE_HEIGHT - PDF_MARGIN_TOP),
      children: []
    };

    if (!node.title) {
      return;
    }

    parent.children.push(node);
    stack.push(node);
  });

  return root.children;
}

function countOutlineDescendants(nodes = []) {
  return (Array.isArray(nodes) ? nodes : []).reduce((count, node) => {
    return count + 1 + countOutlineDescendants(node?.children || []);
  }, 0);
}

function assignOutlineObjectIds(nodes = [], nextObjectIdRef = { value: 1 }) {
  (Array.isArray(nodes) ? nodes : []).forEach(node => {
    node.objectId = nextObjectIdRef.value++;
    assignOutlineObjectIds(node.children || [], nextObjectIdRef);
  });
}

function buildOutlineObjects(objects, nodes = [], parentObjectId, pageObjectIds = []) {
  (Array.isArray(nodes) ? nodes : []).forEach((node, index, siblingNodes) => {
    const resolvedPageObjectId = pageObjectIds[Math.max(0, Math.min(pageObjectIds.length - 1, node.pageIndex || 0))]
      || pageObjectIds[0]
      || 0;
    const top = Math.max(0, Math.min(PDF_PAGE_HEIGHT, Number(node?.top) || (PDF_PAGE_HEIGHT - PDF_MARGIN_TOP)));
    const parts = [
      '<<',
      `/Title (${escapePdfText(node?.title || 'Section')})`,
      `/Parent ${parentObjectId} 0 R`
    ];

    if (index > 0) {
      parts.push(`/Prev ${siblingNodes[index - 1].objectId} 0 R`);
    }
    if (index < (siblingNodes.length - 1)) {
      parts.push(`/Next ${siblingNodes[index + 1].objectId} 0 R`);
    }

    parts.push(`/Dest [${resolvedPageObjectId} 0 R /XYZ null ${top.toFixed(2)} null]`);

    if (Array.isArray(node?.children) && node.children.length > 0) {
      parts.push(`/First ${node.children[0].objectId} 0 R`);
      parts.push(`/Last ${node.children[node.children.length - 1].objectId} 0 R`);
      parts.push(`/Count ${countOutlineDescendants(node.children)}`);
    }

    parts.push('>>');
    objects.set(node.objectId, parts.join(' '));
    buildOutlineObjects(objects, node.children || [], node.objectId, pageObjectIds);
  });
}

function buildPdfDocument(pageStreams = [], bookmarks = []) {
  const streams = Array.isArray(pageStreams) && pageStreams.length > 0 ? pageStreams : [''];
  const objects = new Map();
  const pageObjectIds = [];
  const bookmarkTree = buildBookmarkTree(bookmarks);
  const hasBookmarks = bookmarkTree.length > 0;
  let nextObjectId = 5;

  streams.forEach(stream => {
    const pageObjectId = nextObjectId++;
    const contentObjectId = nextObjectId++;
    pageObjectIds.push(pageObjectId);
    objects.set(pageObjectId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>`);
    objects.set(contentObjectId, `<< /Length ${getByteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });

  if (hasBookmarks) {
    const outlinesRootId = nextObjectId++;
    assignOutlineObjectIds(bookmarkTree, { value: nextObjectId });
    nextObjectId += countOutlineDescendants(bookmarkTree);
    buildOutlineObjects(objects, bookmarkTree, outlinesRootId, pageObjectIds);
    objects.set(
      outlinesRootId,
      `<< /Type /Outlines /First ${bookmarkTree[0].objectId} 0 R /Last ${bookmarkTree[bookmarkTree.length - 1].objectId} 0 R /Count ${countOutlineDescendants(bookmarkTree)} >>`
    );
    objects.set(1, `<< /Type /Catalog /Pages 2 0 R /Outlines ${outlinesRootId} 0 R /PageMode /UseOutlines >>`);
  } else {
    objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  }
  objects.set(2, `<< /Type /Pages /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>`);
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.set(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  const maxObjectId = nextObjectId - 1;
  let pdfText = '%PDF-1.4\n';
  const offsets = new Array(maxObjectId + 1).fill(0);

  for (let objectId = 1; objectId <= maxObjectId; objectId += 1) {
    offsets[objectId] = getByteLength(pdfText);
    pdfText += `${objectId} 0 obj\n${objects.get(objectId) || ''}\nendobj\n`;
  }

  const xrefOffset = getByteLength(pdfText);
  pdfText += `xref\n0 ${maxObjectId + 1}\n`;
  pdfText += '0000000000 65535 f \n';

  for (let objectId = 1; objectId <= maxObjectId; objectId += 1) {
    pdfText += `${String(offsets[objectId]).padStart(10, '0')} 00000 n \n`;
  }

  pdfText += `trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return pdfText;
}

export function buildTextPdfReportBlob(report = {}) {
  const layout = createPdfLayout();

  renderTitleBlock(layout, report);
  renderSummaryStats(layout, report?.summaryStats || []);
  renderMetadataGrid(layout, report?.metadata || []);

  (Array.isArray(report?.sections) ? report.sections : []).forEach(section => {
    renderSection(layout, section || {});
  });

  if (report?.footer) {
    ensureSpace(layout, 26);
    drawLine(layout, {
      x1: PDF_MARGIN_LEFT,
      y1: layout.currentY,
      x2: PDF_PAGE_WIDTH - PDF_MARGIN_RIGHT,
      y2: layout.currentY,
      color: PDF_COLORS.border
    });
    layout.currentY -= 10;
    renderWrappedText(layout, {
      topY: layout.currentY,
      text: report.footer,
      size: 9,
      color: PDF_COLORS.muted,
      lineHeightFactor: 1.2
    });
  }

  const pageStreams = layout.pages.map((page, index) => renderFooter(page, index, layout.pages.length));
  const pdfText = buildPdfDocument(pageStreams, layout.bookmarks);
  return new Blob([pdfText], { type: 'application/pdf' });
}

export function downloadTextPdfReport(filename = 'report.pdf', report = {}) {
  const blob = buildTextPdfReportBlob(report);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
