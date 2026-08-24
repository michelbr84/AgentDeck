/** All TUI views in display order. */
export type TuiView =
  | 'dashboard'
  | 'agents'
  | 'personas'
  | 'instances'
  | 'rooms'
  | 'chat'
  | 'docs';

/** Ordered list of all TUI views for cycling navigation. */
export const TUI_VIEWS: TuiView[] = [
  'dashboard',
  'agents',
  'personas',
  'instances',
  'rooms',
  'chat',
  'docs',
];

/**
 * Returns the next view when cycling forward (isShift=false) or backward (isShift=true).
 * Wraps around at both ends.
 */
export function getNextView(current: TuiView, isShift: boolean): TuiView {
  const idx = TUI_VIEWS.indexOf(current);
  const nextIdx = isShift
    ? (idx - 1 + TUI_VIEWS.length) % TUI_VIEWS.length
    : (idx + 1) % TUI_VIEWS.length;
  return TUI_VIEWS[nextIdx] ?? 'dashboard';
}

/**
 * Resolves a numeric key press (1-7) to the corresponding view.
 * Returns null if the key is not a valid view selector.
 */
export function resolveViewForKey(key: string): TuiView | null {
  const num = parseInt(key, 10);
  if (num >= 1 && num <= TUI_VIEWS.length) {
    return TUI_VIEWS[num - 1] ?? null;
  }
  return null;
}
