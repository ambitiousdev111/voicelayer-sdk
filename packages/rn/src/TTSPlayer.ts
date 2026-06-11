// ─────────────────────────────────────────────────────────────────────────────
// VoiceLayer RN — TTSPlayer
//
// Uses expo-speech (on-device, free) by default.
// Falls back to ElevenLabs or OpenAI TTS via the proxy for better Hindi voice.
// ─────────────────────────────────────────────────────────────────────────────

import * as Speech from 'expo-speech'
import type { TranscriberLanguage } from './Transcriber'

export class TTSPlayer {
  constructor(private readonly language: TranscriberLanguage) {}

  async speak(text: string): Promise<void> {
    // Stop any current speech first
    await Speech.stop()

    return new Promise((resolve) => {
      Speech.speak(text, {
        language: this.resolveLocale(),
        pitch:    1.0,
        rate:     0.9,   // slightly slower for clarity
        onDone:   resolve,
        onError:  () => resolve(),   // non-fatal
      })
    })
  }

  async stop(): Promise<void> {
    await Speech.stop()
  }

  private resolveLocale(): string {
    if (this.language === 'hi')   return 'hi-IN'
    if (this.language === 'en')   return 'en-US'
    return 'hi-IN'   // default: Hindi (Repeatly's primary language)
  }
}
