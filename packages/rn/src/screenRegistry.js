/**
 * screenRegistry — global store for per-screen context from useVoiceLayerScreen.
 *
 * Screens register on mount, unregister on unmount. VoiceLayerButton reads
 * the current screen's registration at command-submit time to enrich Claude's context.
 */

const _registry = new Map();

export const screenRegistry = {
  register(screenName, { hints = [], elements = [] } = {}) {
    _registry.set(screenName, { hints: [...hints], elements: [...elements] });
  },
  unregister(screenName) {
    _registry.delete(screenName);
  },
  get(screenName) {
    return _registry.get(screenName) ?? null;
  },
  clear() {
    _registry.clear();
  },
};
