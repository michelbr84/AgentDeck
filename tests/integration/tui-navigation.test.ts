import { describe, it, expect } from 'vitest';
import {
  TUI_VIEWS,
  getNextView,
  resolveViewForKey,
  type TuiView,
} from '../../apps/cli/src/tui/navigation.js';

describe('TUI Navigation Module', () => {
  it('should define stable navigation views in correct order', () => {
    expect(TUI_VIEWS).toEqual([
      'dashboard', 'agents', 'personas', 'instances', 'rooms', 'chat', 'docs',
    ]);
  });

  it('should cycle forward through all views with getNextView (isShift=false)', () => {
    expect(getNextView('dashboard', false)).toBe('agents');
    expect(getNextView('agents', false)).toBe('personas');
    expect(getNextView('personas', false)).toBe('instances');
    expect(getNextView('instances', false)).toBe('rooms');
    expect(getNextView('rooms', false)).toBe('chat');
    expect(getNextView('chat', false)).toBe('docs');
    expect(getNextView('docs', false)).toBe('dashboard');
  });

  it('should cycle backward through all views with getNextView (isShift=true)', () => {
    expect(getNextView('dashboard', true)).toBe('docs');
    expect(getNextView('docs', true)).toBe('chat');
    expect(getNextView('chat', true)).toBe('rooms');
    expect(getNextView('rooms', true)).toBe('instances');
    expect(getNextView('instances', true)).toBe('personas');
    expect(getNextView('personas', true)).toBe('agents');
    expect(getNextView('agents', true)).toBe('dashboard');
  });

  it('should map numeric keys 1..7 to views via resolveViewForKey', () => {
    const expected: TuiView[] = [
      'dashboard', 'agents', 'personas', 'instances', 'rooms', 'chat', 'docs',
    ];
    for (let i = 1; i <= 7; i++) {
      expect(resolveViewForKey(String(i))).toBe(expected[i - 1]);
    }
  });

  it('should return null for non-numeric or out-of-range keys', () => {
    expect(resolveViewForKey('0')).toBeNull();
    expect(resolveViewForKey('8')).toBeNull();
    expect(resolveViewForKey('a')).toBeNull();
    expect(resolveViewForKey('')).toBeNull();
  });
});
