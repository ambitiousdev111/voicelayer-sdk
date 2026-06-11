// ─────────────────────────────────────────────────────────────────────────────
// VoiceLayer RN — useVoiceLayer hook
//
// Orchestrates the full voice pipeline:
//   record → STT (on-device) → LearningStore → server fallback → execute
//
// Used internally by <VoiceLayer /> but exported so advanced users can
// build custom UIs on top of it.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Audio } from 'expo-av'
import * as FileSystem from 'expo-file-system'

import { LearningStore }         from './LearningStore'
import { Transcriber }           from './Transcriber'
import { TTSPlayer }             from './TTSPlayer'
import { resolveViaServer, resolveViaServerWithAudio } from './api'
import type { VLAction, VoiceState, VoiceLayerProps } from './types'

// ── Recording options ─────────────────────────────────────────────────────────
// 16kHz mono WAV is what Whisper expects. Same settings on iOS and Android.
const RECORDING_OPTIONS: Audio.RecordingOptions = {
  android: {
    extension:    '.wav',
    outputFormat: Audio.AndroidOutputFormat.DEFAULT,
    audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
    sampleRate:   16000,
    numberOfChannels: 1,
    bitRate:      128_000,
  },
  ios: {
    extension:    '.wav',
    outputFormat: Audio.IOSOutputFormat.LINEARPCM,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate:   16000,
    numberOfChannels: 1,
    bitRate:      128_000,
    linearPCMBitDepth:    16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat:     false,
  },
  web: {},   // not used — this is the RN SDK
  isMeteringEnabled: false,
}

const MAX_RECORD_MS  = 10_000   // auto-stop after 10 s of silence
const SILENCE_PAUSE  = 1_500    // stop if no new audio for 1.5 s (future: VAD)

export interface UseVoiceLayerReturn {
  state:      VoiceState
  transcript: string
  message:    string   // TTS message shown in overlay
  toggle:     () => Promise<void>   // start or stop listening
  isReady:    boolean  // true once LearningStore has hydrated
}

export function useVoiceLayer({
  proxyUrl,
  appId,
  actions,
  screenName,
  language = 'hi',
  modelPath,
  apiKey,
  debug = false,
  onError,
}: VoiceLayerProps): UseVoiceLayerReturn {
  const [state,      setState]      = useState<VoiceState>('idle')
  const [transcript, setTranscript] = useState('')
  const [message,    setMessage]    = useState('')
  const [isReady,    setReady]      = useState(false)

  const recordingRef   = useRef<Audio.Recording | null>(null)
  const autoStopRef    = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Stable singletons (don't recreate on every render) ───────────────────
  const store = useMemo(() => new LearningStore(appId), [appId])

  const transcriber = useMemo(
    () => new Transcriber(language, modelPath, debug),
    [language, modelPath, debug],
  )

  const tts = useMemo(() => new TTSPlayer(language), [language])

  // ── Initialise on mount ───────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      store.ready(),
      transcriber.init(),   // warm up Whisper — downloads model if needed
    ]).then(() => setReady(true))
  }, [store, transcriber])

  // ── Core pipeline ─────────────────────────────────────────────────────────

  const processAudio = useCallback(async (audioUri: string) => {
    setState('processing')
    setTranscript('')

    let resolvedTranscript: string | null = null
    let audioBase64: string | null = null

    // ── Step 1: STT ──────────────────────────────────────────────────────────
    if (transcriber.isReady) {
      // On-device Whisper — fast, no network
      resolvedTranscript = await transcriber.transcribe(audioUri)
      if (debug) console.log('[VoiceLayer] on-device transcript:', resolvedTranscript)
    }

    if (!resolvedTranscript) {
      // On-device model not ready — read audio for server upload
      audioBase64 = await FileSystem.readAsStringAsync(audioUri, {
        encoding: FileSystem.EncodingType.Base64,
      })
    }

    if (resolvedTranscript) setTranscript(resolvedTranscript)

    // ── Step 2: LearningStore (cache lookup) ──────────────────────────────────
    if (resolvedTranscript) {
      const hit = store.findMatch(resolvedTranscript, screenName)
      if (hit) {
        if (debug) console.log('[VoiceLayer] cache HIT:', hit)

        const action = actions.find((a) => a.id === hit.actionId)
        if (action) {
          setMessage(hit.speak)
          setState('speaking')
          await tts.speak(hit.speak)
          action.onTrigger(hit.params)
          setState('idle')
          setMessage('')
          return
        }
      }
    }

    // ── Step 3: Server fallback ───────────────────────────────────────────────
    try {
      const opts = { proxyUrl, appId, screenName, language, apiKey }

      let result: Awaited<ReturnType<typeof resolveViaServer>>
      let serverTranscript = resolvedTranscript ?? ''

      if (resolvedTranscript) {
        result = await resolveViaServer(resolvedTranscript, actions, opts)
      } else {
        // Send audio; server does STT + intent in one shot
        const r = await resolveViaServerWithAudio(audioBase64!, 'wav', actions, opts)
        result = r
        serverTranscript = r.transcript ?? ''
        setTranscript(serverTranscript)
      }

      if (debug) console.log('[VoiceLayer] server result:', result)

      // Cache for next time
      if (serverTranscript) {
        await store.store(serverTranscript, result, screenName)
      }

      const action = actions.find((a) => a.id === result.actionId)
      if (!action) {
        // Clarify — no matching action
        const clarify = (result as unknown as { speak: string }).speak
          ?? "Samajh nahi aaya, kya aap dobara bol sakte hain?"
        setMessage(clarify)
        setState('speaking')
        await tts.speak(clarify)
        setState('idle')
        setMessage('')
        return
      }

      setMessage(result.speak)
      setState('speaking')
      await tts.speak(result.speak)
      action.onTrigger(result.params)
      setState('idle')
      setMessage('')
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      if (debug) console.error('[VoiceLayer] server error:', error)
      onError?.(error)

      const msg = 'Kuch problem ho gayi. Please try again.'
      setMessage(msg)
      setState('error')
      await tts.speak(msg)
      setState('idle')
      setMessage('')
    }
  }, [
    transcriber, store, tts, actions, proxyUrl, appId,
    screenName, language, debug, onError,
  ])

  const stopAndProcess = useCallback(async () => {
    if (!recordingRef.current) return

    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current)
      autoStopRef.current = null
    }

    const rec = recordingRef.current
    recordingRef.current = null

    try {
      await rec.stopAndUnloadAsync()
    } catch { /* already stopped */ }

    await Audio.setAudioModeAsync({ allowsRecordingIOS: false })

    const uri = rec.getURI()
    if (!uri) return

    await processAudio(uri)
  }, [processAudio])

  const startListening = useCallback(async () => {
    // Request mic permission
    const { granted } = await Audio.requestPermissionsAsync()
    if (!granted) {
      const err = new Error('Microphone permission denied')
      onError?.(err)
      setState('error')
      setTimeout(() => setState('idle'), 2000)
      return
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS:  true,
      playsInSilentModeIOS: true,
    })

    const recording = new Audio.Recording()
    await recording.prepareToRecordAsync(RECORDING_OPTIONS)
    await recording.startAsync()
    recordingRef.current = recording
    setState('listening')

    // Auto-stop after MAX_RECORD_MS
    autoStopRef.current = setTimeout(stopAndProcess, MAX_RECORD_MS)
  }, [onError, stopAndProcess])

  const stopListening = useCallback(async () => {
    await stopAndProcess()
  }, [stopAndProcess])

  const toggle = useCallback(async () => {
    if (state === 'listening') {
      await stopListening()
    } else if (state === 'idle' || state === 'error') {
      await startListening()
    }
  }, [state, startListening, stopListening])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoStopRef.current) clearTimeout(autoStopRef.current)
      recordingRef.current?.stopAndUnloadAsync().catch(() => undefined)
    }
  }, [])

  return { state, transcript, message, toggle, isReady }
}
