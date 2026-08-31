import { describe, it, expect } from 'vitest';
import { nextFocusable } from '../src/hooks/useFocusTrap';

/**
 * Pure half of the auth dialog's focus trap. Runs in vitest's node
 * environment, so only the DOM-free `nextFocusable` is covered here; the
 * hook itself needs a browser.
 */

const items = ['token-input', 'unlock-button', 'help-link'] as const;

describe('nextFocusable', () => {
  it('returns null when the dialog has nothing focusable', () => {
    expect(nextFocusable([], null, false)).toBeNull();
    expect(nextFocusable([], 'stray', true)).toBeNull();
  });

  it('moves forward and backward between neighbours', () => {
    expect(nextFocusable(items, 'token-input', false)).toBe('unlock-button');
    expect(nextFocusable(items, 'unlock-button', false)).toBe('help-link');
    expect(nextFocusable(items, 'help-link', true)).toBe('unlock-button');
    expect(nextFocusable(items, 'unlock-button', true)).toBe('token-input');
  });

  it('wraps at both ends', () => {
    expect(nextFocusable(items, 'help-link', false)).toBe('token-input');
    expect(nextFocusable(items, 'token-input', true)).toBe('help-link');
  });

  it('pulls focus that is outside the dialog back to the first or last element', () => {
    expect(nextFocusable(items, 'page-behind', false)).toBe('token-input');
    expect(nextFocusable(items, 'page-behind', true)).toBe('help-link');
    expect(nextFocusable(items, null, false)).toBe('token-input');
    expect(nextFocusable(items, undefined, true)).toBe('help-link');
  });

  it('keeps focus on the only element when there is just one', () => {
    expect(nextFocusable(['token-input'], 'token-input', false)).toBe('token-input');
    expect(nextFocusable(['token-input'], 'token-input', true)).toBe('token-input');
    expect(nextFocusable(['token-input'], null, true)).toBe('token-input');
  });
});
