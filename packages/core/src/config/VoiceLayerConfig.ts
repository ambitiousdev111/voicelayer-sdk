/**
 * VoiceLayerConfig — the single configuration object passed to VoiceLayer.init().
 *
 * All fields are optional; sensible defaults are applied from defaults.ts.
 */
export interface VoiceLayerConfig {
  /** LLM provider and credentials */
  ai?: {
    provider: 'claude' | 'openai';
    apiKey: string;
    model?: string;
    /** Proxy URL to avoid exposing the key in the browser bundle */
    proxyUrl?: string;
  };

  /** Speech-to-text backend */
  stt?: {
    provider: 'whisper' | 'deepgram' | 'webspeech';
    apiKey?: string;
    /** BCP-47 language hints, e.g. ['hi-IN', 'en-IN'] */
    languages?: string[];
  };

  /** Text-to-speech backend */
  tts?: {
    provider: 'webspeech' | 'elevenlabs' | 'openai';
    apiKey?: string;
    voiceId?: string;
    language?: string;
  };

  /** UI customisation */
  ui?: {
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    hotkey?: string;
    theme?: {
      primary?: string;
      background?: string;
      text?: string;
    };
  };

  /**
   * Enable debug mode — shows network activity in the VoiceOverlay panel
   * and logs extra diagnostic info to the console.
   */
  debug?: boolean;

  /** Optional explicit route map for better intent resolution */
  routes?: Array<{
    path: string;
    name: string;
    description?: string;
  }>;

  /** Called after every successful action — for analytics / logging */
  onAction?: (action: unknown) => void;

  /** Called when VoiceLayer encounters an unrecoverable error */
  onError?: (error: Error) => void;
}
