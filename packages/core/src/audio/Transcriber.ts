import { ErrorCode, VoiceLayerError } from '../errors.js';

const DEFAULT_OPENAI_BASE = 'https://api.openai.com';
const TIMEOUT_MS = 10_000;

/**
 * Transcriber — sends an audio Blob to OpenAI Whisper and returns the transcript.
 *
 * @example
 * const transcriber = new Transcriber('sk-...', 'hi');
 * const text = await transcriber.transcribe(audioBlob);
 */
export class Transcriber {
  constructor(
    private readonly apiKey: string,
    /** BCP-47 language code passed to Whisper (e.g. 'hi', 'en', 'hi-IN'). */
    private readonly language = 'hi',
    /** OpenAI API base — use `/api/openai` when proxied through your dev server. */
    private readonly openaiBaseUrl = DEFAULT_OPENAI_BASE,
  ) {}

  /**
   * Transcribe an audio Blob using OpenAI Whisper.
   *
   * @param audioBlob — the recorded audio (any format Whisper accepts:
   *   webm, mp3, mp4, wav, etc.)
   * @returns The transcript as a plain string.
   * @throws {VoiceLayerError} API_ERROR    — on non-2xx HTTP responses.
   * @throws {VoiceLayerError} TIMEOUT      — if the request takes > 10 s.
   * @throws {VoiceLayerError} API_ERROR    — on network failures.
   */
  /**
   * Transcribe with one silent retry on transient network/5xx failures.
   * Timeout and 4xx errors are not retried (they indicate config problems).
   */
  async transcribe(audioBlob: Blob): Promise<string> {
    try {
      return await this._transcribeOnce(audioBlob);
    } catch (err) {
      if (err instanceof VoiceLayerError && err.code === ErrorCode.TIMEOUT) throw err;
      if (err instanceof VoiceLayerError && err.message.includes('HTTP 4')) throw err;
      // One silent retry for transient network / 5xx errors
      await new Promise((r) => setTimeout(r, 600));
      return this._transcribeOnce(audioBlob);
    }
  }

  private async _transcribeOnce(audioBlob: Blob): Promise<string> {
    const body = new FormData();
    // Whisper requires a filename with an extension it recognises
    const ext = Transcriber.extFromMime(audioBlob.type);
    body.append('file', audioBlob, `audio.${ext}`);
    body.append('model', 'whisper-1');
    body.append('language', Transcriber.normaliseLanguage(this.language));
    body.append('response_format', 'json');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.openaiBaseUrl}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          // Do NOT set Content-Type — the browser sets it with the multipart boundary
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new VoiceLayerError(
          ErrorCode.TIMEOUT,
          `Whisper transcription timed out after ${TIMEOUT_MS / 1000} s.`,
          err,
        );
      }
      throw new VoiceLayerError(
        ErrorCode.API_ERROR,
        `Network error contacting Whisper API: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        // ignore — just use status
      }
      throw new VoiceLayerError(
        ErrorCode.API_ERROR,
        `Whisper API returned HTTP ${response.status} ${response.statusText}. Body: ${errorBody}`,
      );
    }

    let data: { text: string };
    try {
      data = (await response.json()) as { text: string };
    } catch (err) {
      throw new VoiceLayerError(
        ErrorCode.API_ERROR,
        'Whisper API returned a non-JSON response body.',
        err,
      );
    }

    if (typeof data.text !== 'string') {
      throw new VoiceLayerError(
        ErrorCode.API_ERROR,
        `Unexpected Whisper response shape — "text" field missing. Got: ${JSON.stringify(data)}`,
      );
    }

    return data.text.trim();
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Map a MIME type to the file extension Whisper expects in the filename.
   * Defaults to 'webm' which Whisper handles well.
   */
  private static extFromMime(mimeType: string): string {
    const map: Record<string, string> = {
      'audio/webm': 'webm',
      'audio/ogg': 'ogg',
      'audio/mp4': 'mp4',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/flac': 'flac',
    };
    // Strip codec suffix: 'audio/webm;codecs=opus' → 'audio/webm'
    const base = mimeType.split(';')[0]?.trim() ?? '';
    return map[base] ?? 'webm';
  }

  /**
   * Whisper wants a plain 2-letter ISO 639-1 code ('hi', 'en', …).
   * Strip region variants: 'hi-IN' → 'hi', 'en-US' → 'en'.
   */
  private static normaliseLanguage(lang: string): string {
    return lang.split('-')[0]?.toLowerCase() ?? 'en';
  }
}
