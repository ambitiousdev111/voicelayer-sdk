// ─────────────────────────────────────────────────────────────────────────────
// VoiceLayer RN — Transcriber
//
// Two-tier STT:
//   Primary:  whisper.rn  — on-device, ~100ms, no server call, works offline
//   Fallback: /api/voice  — server-side Whisper when model isn't loaded yet
//
// The model is a one-time 39MB download (ggml-tiny.bin). After that every
// transcription is local and instant.
// ─────────────────────────────────────────────────────────────────────────────

import * as FileSystem from 'expo-file-system'
import { initWhisper, type WhisperContext } from 'whisper.rn'

export type TranscriberLanguage = 'hi' | 'en' | 'auto'

const WHISPER_TINY_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin'

const MODEL_FILENAME = 'ggml-tiny.bin'

export class Transcriber {
  private ctx: WhisperContext | null = null
  private modelReady = false
  private initPromise: Promise<void> | null = null

  constructor(
    private readonly language: TranscriberLanguage,
    /** Pass require('../assets/ggml-tiny.bin') if bundled, or omit to auto-download. */
    private readonly modelPath?: number | string,
    private readonly debug = false,
  ) {}

  /**
   * Initialise the on-device Whisper model.
   * Call this early (e.g. on component mount) to warm up before first use.
   * Safe to call multiple times — initialises only once.
   */
  async init(): Promise<void> {
    if (this.modelReady) return
    if (this.initPromise) return this.initPromise

    this.initPromise = this._init()
    return this.initPromise
  }

  /** Returns true if the on-device model is ready. */
  get isReady(): boolean {
    return this.modelReady
  }

  /**
   * Transcribe an audio file URI.
   * Uses on-device model if ready, otherwise returns null
   * (caller should fall back to server).
   */
  async transcribe(audioUri: string): Promise<string | null> {
    if (!this.ctx) return null

    try {
      const { promise } = this.ctx.transcribe(audioUri, {
        language: this.language === 'auto' ? undefined : this.language,
        maxLen: 1,
        // Suppress blank audio tokens
        suppressBlank: true,
        temperature: 0,
      })
      const { result } = await promise
      return result?.trim() ?? null
    } catch (err) {
      if (this.debug) console.warn('[VoiceLayer/Transcriber] whisper.rn error:', err)
      return null
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async _init(): Promise<void> {
    try {
      const filePath = await this.resolveModelPath()
      if (!filePath) {
        if (this.debug) console.log('[VoiceLayer/Transcriber] No model path — will use server STT')
        return
      }

      this.ctx = await initWhisper({ filePath })
      this.modelReady = true
      if (this.debug) console.log('[VoiceLayer/Transcriber] on-device Whisper ready')
    } catch (err) {
      if (this.debug) console.warn('[VoiceLayer/Transcriber] init failed, falling back to server:', err)
    }
  }

  private async resolveModelPath(): Promise<string | number | null> {
    // Developer passed require('../assets/ggml-tiny.bin') or a file URI
    if (this.modelPath !== undefined) return this.modelPath

    // Auto-download to DocumentDirectory
    const dest = `${FileSystem.documentDirectory}${MODEL_FILENAME}`
    const info = await FileSystem.getInfoAsync(dest)
    if (info.exists) return dest

    if (this.debug) console.log('[VoiceLayer/Transcriber] Downloading Whisper tiny model (~39MB)…')

    try {
      const { status } = await FileSystem.downloadAsync(WHISPER_TINY_URL, dest)
      if (status === 200) {
        if (this.debug) console.log('[VoiceLayer/Transcriber] Model downloaded to', dest)
        return dest
      }
    } catch (err) {
      if (this.debug) console.warn('[VoiceLayer/Transcriber] Model download failed:', err)
    }

    return null
  }
}
