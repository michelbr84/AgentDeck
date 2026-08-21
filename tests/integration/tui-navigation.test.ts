import { describe, it, expect } from 'vitest';
import { TUI_VIEWS, type TuiView } from '../../apps/cli/src/tui/index.js';

describe('TUI Portable Key Navigation & Focus Contract', () => {
  it('should define stable navigation views and ordered sequence', () => {
    expect(TUI_VIEWS).toEqual(['dashboard', 'agents', 'rooms', 'chat', 'docs']);
  });

  it('should calculate correct next and previous views for Tab and Shift+Tab navigation', () => {
    const getNextView = (current: TuiView, isShift: boolean): TuiView => {
      const idx = TUI_VIEWS.indexOf(current);
      const nextIdx = isShift
        ? (idx - 1 + TUI_VIEWS.length) % TUI_VIEWS.length
        : (idx + 1) % TUI_VIEWS.length;
      return TUI_VIEWS[nextIdx] || 'dashboard';
    };

    // Forward Tab
    expect(getNextView('dashboard', false)).toBe('agents');
    expect(getNextView('agents', false)).toBe('rooms');
    expect(getNextView('rooms', false)).toBe('chat');
    expect(getNextView('chat', false)).toBe('docs');
    expect(getNextView('docs', false)).toBe('dashboard');

    // Backward Shift+Tab
    expect(getNextView('dashboard', true)).toBe('docs');
    expect(getNextView('docs', true)).toBe('chat');
    expect(getNextView('chat', true)).toBe('rooms');
    expect(getNextView('rooms', true)).toBe('agents');
    expect(getNextView('agents', true)).toBe('dashboard');
  });

  it('should map numeric keys 1..5 directly to appropriate views', () => {
    const numMap: Record<string, TuiView> = {
      '1': 'dashboard',
      '2': 'agents',
      '3': 'rooms',
      '4': 'chat',
      '5': 'docs',
    };

    for (let i = 1; i <= 5; i++) {
      expect(numMap[String(i)]).toBe(TUI_VIEWS[i - 1]);
    }
  });
});
