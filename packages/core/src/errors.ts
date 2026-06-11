/**
 * ErrorCode — all possible failure modes in the VoiceLayer SDK.
 */
export enum ErrorCode {
  /** getUserMedia() was denied by the user or the OS */
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  /** startRecording() called while already recording */
  ALREADY_RECORDING = 'ALREADY_RECORDING',
  /** stopRecording() called before startRecording() */
  NOT_RECORDING = 'NOT_RECORDING',
  /** Required browser API (getUserMedia, MediaRecorder, etc.) not available */
  BROWSER_NOT_SUPPORTED = 'BROWSER_NOT_SUPPORTED',
  /** An external API (Whisper, ElevenLabs, OpenAI TTS) returned a non-2xx response */
  API_ERROR = 'API_ERROR',
  /** A network request timed out */
  TIMEOUT = 'TIMEOUT',
  /** playback failed — Audio element error or speechSynthesis error */
  PLAYBACK_ERROR = 'PLAYBACK_ERROR',
  /** A required DOM element could not be found by the given selector */
  ELEMENT_NOT_FOUND = 'ELEMENT_NOT_FOUND',
  /** A dropdown / listbox did not appear after the trigger was activated */
  DROPDOWN_NOT_FOUND = 'DROPDOWN_NOT_FOUND',
}

/**
 * VoiceLayerError — the single error type thrown by the VoiceLayer SDK.
 *
 * Always carries a machine-readable `code` so callers can branch without
 * string-matching `.message`.
 *
 * @example
 * try {
 *   await capture.startRecording();
 * } catch (err) {
 *   if (err instanceof VoiceLayerError && err.code === ErrorCode.PERMISSION_DENIED) {
 *     showPermissionPrompt();
 *   }
 * }
 */
export class VoiceLayerError extends Error {
  readonly code: ErrorCode;
  readonly originalError: unknown;

  constructor(code: ErrorCode, message: string, originalError?: unknown) {
    super(message);
    // Maintain proper prototype chain in transpiled environments
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'VoiceLayerError';
    this.code = code;
    this.originalError = originalError;
  }
}
