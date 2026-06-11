/**
 * useVoiceLayerScreen — optional hook for per-screen voice context.
 *
 * Call this inside any screen component to give VoiceLayer richer context.
 * The SDK works perfectly without it — this hook makes intent resolution
 * and chips smarter for that specific screen.
 *
 * Usage (minimal):
 *   useVoiceLayerScreen({ hints: ['add customer', 'search', 'export'] })
 *
 * Usage (full):
 *   useVoiceLayerScreen({
 *     hints:    ['filter orders', 'mark delivered', 'view details'],
 *     elements: ['Pending (12)', 'Delivered (8)', 'Search bar'],
 *   })
 *
 * Rules:
 *   hints    — 3–6 short action phrases for this screen
 *   elements — labels of visible interactive elements (optional)
 *   Arrays can be defined inline — the hook handles ref stability.
 */

import { useEffect, useRef } from 'react';
import { useNavigationState } from '@react-navigation/native';
import { screenRegistry }    from './screenRegistry';

export function useVoiceLayerScreen({ hints = [], elements = [] } = {}) {
  // Auto-detect current screen name from navigation state
  const routeName = useNavigationState(state =>
    state?.routes[state.index]?.name ?? null
  );

  // Refs avoid re-firing the effect when arrays are redefined inline
  const hintsRef    = useRef(hints);
  const elementsRef = useRef(elements);
  hintsRef.current    = hints;
  elementsRef.current = elements;

  useEffect(() => {
    if (!routeName) return;
    screenRegistry.register(routeName, {
      hints:    hintsRef.current,
      elements: elementsRef.current,
    });
    return () => screenRegistry.unregister(routeName);
  }, [routeName]);
}
