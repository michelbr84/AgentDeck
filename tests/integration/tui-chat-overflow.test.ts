import { describe, it, expect } from 'vitest';
import {
  formatMessageLines,
  sliceViewport,
  wrapToWidth,
  stringWidth,
  maxScrollOffset,
} from '../../apps/cli/src/tui/chat-viewport.js';

describe('TUI chat viewport math', () => {
  it('hard-wraps long single-line messages to the given width', () => {
    const lines = formatMessageLines(
      { senderDisplayName: 'Bot', content: 'a'.repeat(25) },
      10
    );
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) {
      expect(stringWidth(line)).toBeLessThanOrEqual(10);
    }
    expect(lines.join('')).toBe(`[Bot]: ${'a'.repeat(25)}`);
  });

  it('honors embedded newlines', () => {
    const lines = formatMessageLines(
      { senderDisplayName: 'Bot', content: 'first\nsecond\nthird' },
      80
    );
    expect(lines).toEqual(['[Bot]: first', 'second', 'third']);
  });

  it('counts emoji as double-width so wrapped lines fit the terminal', () => {
    expect(stringWidth('🤖')).toBe(2);
    expect(stringWidth('ab🤖')).toBe(4);
    const wrapped = wrapToWidth('🤖🤖🤖🤖', 4);
    expect(wrapped).toEqual(['🤖🤖', '🤖🤖']);
  });

  it('slices a pinned-to-bottom window and reports hidden counts', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const pinned = sliceViewport(lines, 0, 10);
    expect(pinned.visible).toHaveLength(10);
    expect(pinned.visible[9]).toBe('line 29');
    expect(pinned.hiddenAbove).toBe(20);
    expect(pinned.hiddenBelow).toBe(0);
  });

  it('scrolls back through history and clamps at the top', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const mid = sliceViewport(lines, 5, 10);
    expect(mid.visible[0]).toBe('line 15');
    expect(mid.visible[9]).toBe('line 24');
    expect(mid.hiddenBelow).toBe(5);

    const clamped = sliceViewport(lines, 999, 10);
    expect(clamped.visible[0]).toBe('line 0');
    expect(clamped.hiddenAbove).toBe(0);
    expect(clamped.hiddenBelow).toBe(20);
    expect(maxScrollOffset(30, 10)).toBe(20);
  });

  it('handles fewer lines than the window without phantom scroll', () => {
    const lines = ['only', 'three', 'lines'];
    const slice = sliceViewport(lines, 4, 10);
    expect(slice.visible).toEqual(lines);
    expect(slice.hiddenAbove).toBe(0);
    expect(slice.hiddenBelow).toBe(0);
    expect(maxScrollOffset(3, 10)).toBe(0);
  });
});
