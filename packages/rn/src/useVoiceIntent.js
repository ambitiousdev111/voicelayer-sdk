/**
 * useVoiceIntent — sends voice context to VoiceLayer server and returns navigation intent.
 *
 * Default server: https://voicelayer-sdk-production.up.railway.app
 * Override:       pass serverUrl prop on VoiceLayerButton, or call setVoiceLayerServer()
 *                 e.g. for local dev: setVoiceLayerServer('http://10.0.2.2:3001')
 */

import { useState, useCallback } from 'react';
import { conversationStore }     from './conversationStore';

// ── Server URL ─────────────────────────────────────────────────────────────
let _serverUrl = 'https://voicelayer-sdk-production.up.railway.app';

/**
 * Override the VoiceLayer server URL.
 * Call once in App.js before any voice commands are issued.
 *
 * Examples:
 *   setVoiceLayerServer('http://10.0.2.2:3001')     // Android emulator → local server
 *   setVoiceLayerServer('http://localhost:3001')      // iOS Simulator  → local server
 *   setVoiceLayerServer('http://192.168.1.5:3001')   // Real device    → local server
 *   setVoiceLayerServer('https://api.voicelayer.dev') // Default (no call needed)
 */
export function setVoiceLayerServer(url) {
  _serverUrl = url.replace(/\/$/, '');
}

// ── Hook ───────────────────────────────────────────────────────────────────
/**
 * @param {{ apiKey: string, appId?: string, language?: string }}
 */
export function useVoiceIntent({ apiKey, appId = 'app', language = 'hi' }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  /**
   * Resolve a voice transcript to a navigation route.
   * @param {string} transcript
   * @param {object} ctx — context snapshot from VoiceLayerButton
   */
  const resolve = useCallback(async (transcript, ctx = {}) => {
    setLoading(true);
    setError(null);

    const {
      allRoutes     = [],
      currentRoute  = null,
      screenMeta    = null,
      recentScreens = [],
    } = ctx;

    const conversationHistory = conversationStore.getHistory();

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const res = await fetch(`${_serverUrl}/api/voice`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          transcript,
          routes:              allRoutes,
          currentScreen:       currentRoute?.name   ?? null,
          currentScreenParams: currentRoute?.params ?? {},
          screenHints:         screenMeta?.hints    ?? [],
          screenElements:      screenMeta?.elements ?? [],
          recentScreens,
          conversationHistory,
          appId,
          language,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `VoiceLayer error ${res.status}`);
      }

      return await res.json();
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [apiKey, appId, language]);

  return { resolve, loading, error };
}
