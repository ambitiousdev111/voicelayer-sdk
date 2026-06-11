/**
 * RouteDetector — framework-agnostic SPA route detection.
 *
 * Patches `history.pushState` / `replaceState` to emit a custom
 * `voicelayer:routechange` event, so we catch React Router / Next.js
 * navigations that never fire a real `popstate`.
 */
export class RouteDetector {
  private static patched = false;

  constructor() {
    RouteDetector.patchHistory();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Returns the current route as `pathname + search`.
   * E.g. `/dashboard?tab=orders`
   */
  getCurrentRoute(): string {
    if (typeof window === 'undefined') return '/';
    return window.location.pathname + window.location.search;
  }

  /**
   * Returns a normalised page name derived from `document.title`.
   * - Trimmed, lowercased
   * - Spaces replaced with underscores
   * - Max 30 characters
   *
   * Falls back to the last path segment when title is empty.
   */
  getPageName(): string {
    if (typeof document === 'undefined') return 'unknown';

    const raw = document.title.trim();
    if (raw) {
      return raw
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 30);
    }

    // Fallback: last segment of the pathname
    const segments = window.location.pathname.split('/').filter(Boolean);
    return (segments[segments.length - 1] ?? 'home').slice(0, 30);
  }

  /**
   * Subscribe to route changes across all navigation strategies:
   * - `popstate` (browser back/forward)
   * - `hashchange` (hash-based SPAs)
   * - `voicelayer:routechange` (pushState/replaceState monkey-patch)
   *
   * @returns An unsubscribe function — call it to remove all listeners.
   */
  onRouteChange(callback: (route: string) => void): () => void {
    const handler = (): void => callback(this.getCurrentRoute());

    window.addEventListener('popstate', handler);
    window.addEventListener('hashchange', handler);
    window.addEventListener('voicelayer:routechange', handler);

    return () => {
      window.removeEventListener('popstate', handler);
      window.removeEventListener('hashchange', handler);
      window.removeEventListener('voicelayer:routechange', handler);
    };
  }

  // ── History patch ─────────────────────────────────────────────────────────

  /**
   * Monkey-patch `history.pushState` and `history.replaceState` once globally.
   *
   * These methods don't fire `popstate`, so React Router / Next.js navigations
   * would be invisible without this patch.  We only apply it once per page
   * (guarded by `RouteDetector.patched`).
   */
  private static patchHistory(): void {
    if (RouteDetector.patched || typeof window === 'undefined') return;
    RouteDetector.patched = true;

    const dispatch = (): void => {
      window.dispatchEvent(new Event('voicelayer:routechange'));
    };

    const originalPush = history.pushState.bind(history);
    history.pushState = function (
      ...args: Parameters<typeof history.pushState>
    ): void {
      originalPush(...args);
      dispatch();
    };

    const originalReplace = history.replaceState.bind(history);
    history.replaceState = function (
      ...args: Parameters<typeof history.replaceState>
    ): void {
      originalReplace(...args);
      dispatch();
    };
  }

  /**
   * Reset the patch flag — only needed in unit tests between test runs.
   * @internal
   */
  static _resetPatchForTests(): void {
    RouteDetector.patched = false;
  }
}
