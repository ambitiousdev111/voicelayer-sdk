import { ErrorCode, VoiceLayerError } from '../errors.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TTSConfig {
  provider: 'elevenlabs' | 'openai' | 'browser';
  apiKey?: string;
  /** ElevenLabs voice ID. Defaults to a multilingual voice. */
  voiceId?: string;
  /** Playback speed multiplier (0.25 – 4.0). Default 1.0. */
  speed?: number;
  /** BCP-47 language for browser speechSynthesis (e.g. 'hi-IN'). */
  language?: string;
}

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';
/** Default ElevenLabs voice: "Aria" — supports 29 languages including Hindi */
const DEFAULT_VOICE_ID = '9BWtsMINqrJLrRacOk9x';

// ── TTSPlayer ─────────────────────────────────────────────────────────────────

/**
 * TTSPlayer — converts text to speech and plays it back.
 *
 * Supports three backends:
 *  - `browser`    — free, uses Web Speech API, works offline
 *  - `openai`     — high quality, requires OpenAI API key
 *  - `elevenlabs` — best quality + multilingual incl. Hindi
 *
 * @example
 * const tts = new TTSPlayer({ provider: 'browser', language: 'hi-IN' });
 * await tts.speak('नमस्ते! आप कैसे हैं?');
 */
export class TTSPlayer {
  private currentAudio: HTMLAudioElement | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  constructor(private readonly config: TTSConfig) {}

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Speak the given text using the configured TTS backend.
   * Any currently-playing audio is stopped first.
   *
   * @throws {VoiceLayerError} API_ERROR        — on non-2xx API responses.
   * @throws {VoiceLayerError} BROWSER_NOT_SUPPORTED — if provider === 'browser'
   *   and speechSynthesis is unavailable.
   * @throws {VoiceLayerError} PLAYBACK_ERROR   — if the Audio element fails.
   */
  async speak(text: string): Promise<void> {
    if (!text.trim()) return;

    // Stop any in-progress speech before starting a new one
    await this.stop();

    switch (this.config.provider) {
      case 'elevenlabs':
        return this.speakElevenLabs(text);
      case 'openai':
        return this.speakOpenAI(text);
      case 'browser':
        return this.speakBrowser(text);
      default: {
        const _exhaustive: never = this.config.provider;
        throw new VoiceLayerError(
          ErrorCode.API_ERROR,
          `Unknown TTS provider: ${_exhaustive}`,
        );
      }
    }
  }

  /**
   * Stop any currently-playing audio immediately.
   * Safe to call even when nothing is playing.
   */
  async stop(): Promise<void> {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = '';
      this.currentAudio = null;
    }

    if (this.currentUtterance && typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      this.currentUtterance = null;
    }
  }

  // ── Provider implementations ──────────────────────────────────────────────

  private async speakElevenLabs(text: string): Promise<void> {
    const { apiKey, voiceId = DEFAULT_VOICE_ID, speed = 1.0 } = this.config;

    if (!apiKey) {
      throw new VoiceLayerError(
        ErrorCode.API_ERROR,
        'ElevenLabs TTS requires an apiKey in TTSConfig.',
      );
    }

    const url = `${ELEVENLABS_BASE}/${encodeURIComponent(voiceId)}`;
    let response: Response;

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            speed: Math.max(0.25, Math.min(4.0, speed)),
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      });
    } catch (err) {
      throw new VoiceLayerError(
        ErrorCode.API_ERROR,
        `Network error contacting ElevenLabs: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    if (!response.ok) {
      const body = await TTSPlayer.safeReadText(response);
      throw new VoiceLayerError(
        ErrorCode.API_ERROR,
        `ElevenLabs API returned HTTP ${response.status} ${response.statusText}. Body: ${body}`,
      );
    }

    const blob = await response.blob();
    return this.playAudioBlob(blob);
  }

  private async speakOpenAI(text: string): Promise<void> {
    const { apiKey, speed = 1.0 } = this.config;

    if (!apiKey) {
      throw new VoiceLayerError(
        ErrorCode.API_ERROR,
        'OpenAI TTS requires an apiKey in TTSConfig.',
      );
    }

    let response: Response;
    try {
      response = await fetch(OPENAI_TTS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: text,
          voice: 'alloy',
          speed: Math.max(0.25, Math.min(4.0, speed)),
        }),
      });
    } catch (err) {
      throw new VoiceLayerError(
        ErrorCode.API_ERROR,
        `Network error contacting OpenAI TTS: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    if (!response.ok) {
      const body = await TTSPlayer.safeReadText(response);
      throw new VoiceLayerError(
        ErrorCode.API_ERROR,
        `OpenAI TTS API returned HTTP ${response.status} ${response.statusText}. Body: ${body}`,
      );
    }

    const blob = await response.blob();
    return this.playAudioBlob(blob);
  }

  private speakBrowser(text: string): Promise<void> {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      throw new VoiceLayerError(
        ErrorCode.BROWSER_NOT_SUPPORTED,
        'window.speechSynthesis is not available. Use provider "openai" or "elevenlabs" instead.',
      );
    }

    return new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);

      if (this.config.language) {
        utterance.lang = this.config.language;
      }
      if (this.config.speed !== undefined) {
        // speechSynthesis.rate range is 0.1–10; map our 0.25–4.0 directly
        utterance.rate = Math.max(0.1, Math.min(10, this.config.speed));
      }

      utterance.onend = () => {
        this.currentUtterance = null;
        resolve();
      };

      utterance.onerror = (event) => {
        this.currentUtterance = null;
        // 'interrupted' is not an error — it means stop() was called
        if (event.error === 'interrupted' || event.error === 'canceled') {
          resolve();
        } else {
          reject(
            new VoiceLayerError(
              ErrorCode.PLAYBACK_ERROR,
              `SpeechSynthesis error: ${event.error}`,
              event,
            ),
          );
        }
      };

      this.currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Create an object URL from a Blob, play it via an Audio element,
   * and resolve when playback ends. Revokes the URL afterwards.
   */
  private playAudioBlob(blob: Blob): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.currentAudio = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        this.currentAudio = null;
        resolve();
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        this.currentAudio = null;
        reject(
          new VoiceLayerError(
            ErrorCode.PLAYBACK_ERROR,
            `Audio playback failed (MediaError code ${audio.error?.code ?? '?'}): ${audio.error?.message ?? 'unknown'}`,
          ),
        );
      };

      // Some browsers require a user-gesture before playing audio.
      // audio.play() returns a Promise — catch it to surface autoplay blocks.
      audio.play().catch((err: unknown) => {
        URL.revokeObjectURL(url);
        this.currentAudio = null;
        reject(
          new VoiceLayerError(
            ErrorCode.PLAYBACK_ERROR,
            `audio.play() was rejected — possible autoplay policy block: ${
              err instanceof Error ? err.message : String(err)
            }`,
            err,
          ),
        );
      });
    });
  }

  /** Safely read response text without throwing if body is already consumed. */
  private static async safeReadText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '(could not read response body)';
    }
  }
}
