/**
 * navigationHistory — tracks screen transitions for "wapas jaao" and pronoun resolution.
 *
 * Call navigationHistory.init(navigationRef) once after NavigationContainer is ready.
 * VoiceLayerButton does this automatically on mount.
 */

const MAX_HISTORY = 12;
let _history  = [];
let _listener = null;

export const navigationHistory = {
  /**
   * Start listening to navigation state changes.
   * Safe to call multiple times — only registers once.
   * @param {NavigationContainerRef} navRef
   */
  init(navRef) {
    if (_listener || !navRef?.isReady()) return;

    const handler = () => {
      const route = navRef.getCurrentRoute();
      if (!route?.name) return;
      // Deduplicate consecutive same-screen entries
      if (_history[_history.length - 1] === route.name) return;
      _history.push(route.name);
      if (_history.length > MAX_HISTORY) _history.shift();
    };

    _listener = navRef.addListener('state', handler);
    handler(); // seed with current screen immediately
  },

  /** Most recent n screen names, oldest first. */
  getRecent(n = 6) {
    return _history.slice(-n);
  },

  /** The screen visited before the current one, or null. */
  getPrevious() {
    return _history.length >= 2 ? _history[_history.length - 2] : null;
  },

  canGoBack() {
    return _history.length >= 2;
  },

  reset() {
    _history  = [];
    _listener = null;
  },
};
