import { ErrorCode, VoiceLayerError } from '../errors.js';

/**
 * AudioCapture — wraps the browser's MediaRecorder API to capture microphone audio.
 *
 * Lifecycle:
 *   1. await capture.requestPermission()   — prompt the user once
 *   2. await capture.startRecording()      — begin collecting chunks
 *   3. const blob = await capture.stopRecording()  — flush to Blob
 *   4. capture.destroy()                   — release mic track
 */
export class AudioCapture {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  isRecording = false;

  // ── Permission ────────────────────────────────────────────────────────────

  /**
   * Request microphone permission from the browser.
   *
   * @returns `true` if permission was granted, `false` if the user denied it.
   * @throws {VoiceLayerError} with code BROWSER_NOT_SUPPORTED if
   *   `navigator.mediaDevices.getUserMedia` is unavailable.
   */
  async requestPermission(): Promise<boolean> {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      throw new VoiceLayerError(
        ErrorCode.BROWSER_NOT_SUPPORTED,
        'navigator.mediaDevices.getUserMedia is not available in this environment. ' +
          'VoiceLayer requires a secure context (HTTPS or localhost).',
      );
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      return true;
    } catch (err) {
      // DOMException name is 'NotAllowedError' for user denial / OS block
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        return false;
      }
      // Any other getUserMedia failure (e.g. NotFoundError — no mic hardware)
      throw new VoiceLayerError(
        ErrorCode.PERMISSION_DENIED,
        `Failed to acquire microphone: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  // ── Recording ─────────────────────────────────────────────────────────────

  /**
   * Start recording audio from the previously-granted microphone stream.
   *
   * @throws {VoiceLayerError} PERMISSION_DENIED  — if requestPermission() was
   *   never called or returned false.
   * @throws {VoiceLayerError} ALREADY_RECORDING  — if called while recording.
   * @throws {VoiceLayerError} BROWSER_NOT_SUPPORTED — if MediaRecorder is absent.
   */
  async startRecording(): Promise<void> {
    if (!this.stream) {
      throw new VoiceLayerError(
        ErrorCode.PERMISSION_DENIED,
        'No active media stream. Call requestPermission() and ensure it returns true before recording.',
      );
    }

    if (this.isRecording) {
      throw new VoiceLayerError(
        ErrorCode.ALREADY_RECORDING,
        'Recording is already in progress. Call stopRecording() first.',
      );
    }

    if (typeof MediaRecorder === 'undefined') {
      throw new VoiceLayerError(
        ErrorCode.BROWSER_NOT_SUPPORTED,
        'MediaRecorder is not supported in this browser.',
      );
    }

    // Pick the best supported MIME type (webm/opus is widely supported)
    const mimeType = AudioCapture.pickMimeType();
    this.chunks = [];

    try {
      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
    } catch (err) {
      throw new VoiceLayerError(
        ErrorCode.BROWSER_NOT_SUPPORTED,
        `Could not create MediaRecorder with mimeType "${mimeType}": ${
          err instanceof Error ? err.message : String(err)
        }`,
        err,
      );
    }

    this.mediaRecorder.addEventListener('dataavailable', (event: BlobEvent) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    });

    // Request data every 250 ms so we get incremental chunks, not one giant blob
    this.mediaRecorder.start(250);
    this.isRecording = true;
  }

  /**
   * Stop the current recording and return the captured audio as a Blob.
   *
   * @returns A `Blob` of type `audio/webm` containing the full recording.
   * @throws {VoiceLayerError} NOT_RECORDING — if called before startRecording().
   */
  async stopRecording(): Promise<Blob> {
    if (!this.isRecording || !this.mediaRecorder) {
      throw new VoiceLayerError(
        ErrorCode.NOT_RECORDING,
        'No recording in progress. Call startRecording() first.',
      );
    }

    return new Promise<Blob>((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(
          new VoiceLayerError(ErrorCode.NOT_RECORDING, 'MediaRecorder was unexpectedly null.'),
        );
        return;
      }

      this.mediaRecorder.addEventListener(
        'stop',
        () => {
          const mimeType = this.mediaRecorder?.mimeType ?? 'audio/webm';
          const blob = new Blob(this.chunks, { type: mimeType });
          this.chunks = [];
          this.isRecording = false;
          resolve(blob);
        },
        { once: true },
      );

      this.mediaRecorder.addEventListener(
        'error',
        (event) => {
          this.isRecording = false;
          reject(
            new VoiceLayerError(
              ErrorCode.API_ERROR,
              `MediaRecorder error during stop: ${event.type}`,
              event,
            ),
          );
        },
        { once: true },
      );

      this.mediaRecorder.stop();
    });
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  /**
   * Release the microphone track and clean up all resources.
   * Safe to call multiple times.
   */
  destroy(): void {
    if (this.isRecording && this.mediaRecorder) {
      try {
        this.mediaRecorder.stop();
      } catch {
        // Best-effort — ignore errors during cleanup
      }
    }

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }

    this.mediaRecorder = null;
    this.chunks = [];
    this.isRecording = false;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Return the best MIME type supported by this browser's MediaRecorder.
   * Falls back to an empty string (browser picks its own default).
   */
  private static pickMimeType(): string {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    if (typeof MediaRecorder === 'undefined') return '';
    return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  }
}
