import type { VoiceLayerConfig } from './VoiceLayerConfig.js';

/**
 * defaults — applied when the host app doesn't specify a config option.
 *
 * Uses the free Web Speech API for both STT and TTS so VoiceLayer works
 * out-of-the-box in Chrome with zero API keys.
 */
export const defaults: Required<Pick<VoiceLayerConfig, 'stt' | 'tts' | 'ui'>> = {
  stt: {
    provider: 'webspeech',
    languages: ['en-IN', 'hi-IN', 'en-US'],
  },
  tts: {
    provider: 'webspeech',
    language: 'en-IN',
  },
  ui: {
    position: 'bottom-right',
    hotkey: 'Alt+KeyV',
    theme: {
      primary: '#6C47FF',
      background: '#1A1A2E',
      text: '#F0F0F0',
    },
  },
};
