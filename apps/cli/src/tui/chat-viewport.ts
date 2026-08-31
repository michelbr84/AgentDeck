/**
 * Pure viewport math for the TUI chat view. Ink has no clipping primitive, so
 * overflow control depends entirely on pre-slicing rendered lines — and the
 * logic lives outside the JSX so it can be unit-tested (ink-testing-library is
 * not a dependency of this repo).
 */

export interface ViewportMessage {
  senderDisplayName: string;
  content: string;
}

export interface ViewportSlice {
  visible: string[];
  hiddenAbove: number;
  hiddenBelow: number;
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter() : null;

function graphemes(text: string): string[] {
  if (segmenter) {
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/**
 * Terminal cell width of one grapheme. An approximation of wcwidth good
 * enough for the UI's emoji avatars and CJK text — a `String.slice`-based
 * wrap would misalign every line that carries one of them.
 */
function graphemeWidth(grapheme: string): number {
  const cp = grapheme.codePointAt(0);
  if (cp === undefined) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0; // control chars
  if (/^\p{M}+$/u.test(grapheme)) return 0; // bare combining marks
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK radicals … Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f000 && cp <= 0x1ffff) || // emoji & symbols planes
    (cp >= 0x2600 && cp <= 0x27bf) // misc symbols / dingbats
  ) {
    return 2;
  }
  return 1;
}

export function stringWidth(text: string): number {
  let width = 0;
  for (const g of graphemes(text)) width += graphemeWidth(g);
  return width;
}

/** Hard-wraps text into lines of at most `width` terminal cells. */
export function wrapToWidth(text: string, width: number): string[] {
  const safeWidth = Math.max(4, width);
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    if (rawLine === '') {
      lines.push('');
      continue;
    }
    let current = '';
    let currentWidth = 0;
    for (const g of graphemes(rawLine)) {
      const w = graphemeWidth(g);
      if (currentWidth + w > safeWidth && current !== '') {
        lines.push(current);
        current = '';
        currentWidth = 0;
      }
      current += g;
      currentWidth += w;
    }
    lines.push(current);
  }
  return lines;
}

/**
 * Expands one message into display lines: `[sender]: ` prefix on the first
 * line, embedded newlines honored, everything hard-wrapped to `width`.
 */
export function formatMessageLines(message: ViewportMessage, width: number): string[] {
  return wrapToWidth(`[${message.senderDisplayName}]: ${message.content}`, width);
}

/**
 * Cuts a window of `height` lines out of the full line list.
 * `scrollOffset` counts lines hidden BELOW the window (0 = pinned to the
 * newest line); it is clamped, so callers can scroll blindly.
 */
export function sliceViewport(lines: string[], scrollOffset: number, height: number): ViewportSlice {
  const safeHeight = Math.max(1, height);
  const maxOffset = Math.max(0, lines.length - safeHeight);
  const offset = Math.min(Math.max(0, scrollOffset), maxOffset);
  const end = lines.length - offset;
  const start = Math.max(0, end - safeHeight);
  return {
    visible: lines.slice(start, end),
    hiddenAbove: start,
    hiddenBelow: offset,
  };
}

/** Highest valid scrollOffset for a given line count and window height. */
export function maxScrollOffset(totalLines: number, height: number): number {
  return Math.max(0, totalLines - Math.max(1, height));
}
