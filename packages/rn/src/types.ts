// ─────────────────────────────────────────────────────────────────────────────
// VoiceLayer RN — shared types
// ─────────────────────────────────────────────────────────────────────────────

/** A single action the user can trigger by voice on the current screen. */
export interface VLAction {
  /** Unique stable ID. Stored in LearningStore — never change after shipping. */
  id: string
  /** Plain English/Hindi description used by Claude for intent matching. */
  description: string
  /**
   * Parameter names Claude can extract from the voice command.
   * e.g. ['name', 'phone', 'plan'] for a registration action.
   * If empty / omitted, the action takes no parameters.
   */
  params?: string[]
  /**
   * Called when this action is resolved — either from cache (instant)
   * or from the server (first time).
   * Receives extracted params as a key→value map.
   */
  onTrigger: (params: Record<string, string>) => void
}

/** One learned command stored in AsyncStorage. */
export interface StoredCommand {
  /** Normalised transcript used for fuzzy matching. */
  transcript: string
  /** Original transcript as spoken (for debugging). */
  original: string
  actionId: string
  params: Record<string, string>
  speak: string
  hitCount: number
  lastUsed: number
  confidence: number
}

/** Response from the /api/voice server endpoint. */
export interface VoiceResult {
  actionId: string
  params: Record<string, string>
  speak: string
  confidence: number
}

/** Props for the <VoiceLayer /> component. */
export interface VoiceLayerProps {
  /**
   * Base URL of your VoiceLayer analytics server.
   * e.g. "https://your-server.com"
   * Used for the /api/voice fallback when a command isn't in local cache.
   */
  proxyUrl: string

  /**
   * SDK API key — must match SDK_API_KEY in your server's .env.
   * Passed as Authorization: Bearer <apiKey> on every server call.
   * Leave empty if SDK_API_KEY is not set on the server (open dev mode).
   */
  apiKey?: string

  /** App identifier — scopes the LearningStore so commands don't bleed between apps. */
  appId: string

  /** Voice commands registered for the current screen. */
  actions: VLAction[]

  /**
   * Current screen / route name — helps the server resolve ambiguous commands.
   * e.g. "CustomerList", "Dashboard", "OrderDetail"
   */
  screenName?: string

  /** Primary language of your users. Default: 'hi' */
  language?: 'hi' | 'en' | 'auto'

  /**
   * Absolute path to the ggml-tiny.bin Whisper model file.
   * Download it once via: npx whisper.rn download tiny
   * Then pass: modelPath={require('../assets/ggml-tiny.bin')}
   *
   * If omitted, STT falls back to the server (audio is sent to /api/voice).
   * The server path works but adds ~200ms latency.
   */
  modelPath?: number | string

  /** Floating button position. Default: 'bottom-right' */
  position?: 'bottom-right' | 'bottom-left' | 'bottom-center'

  /** Tint color for the mic button. Default: '#6C63FF' */
  color?: string

  /** Log debug output to console. Default: false */
  debug?: boolean

  /** Called on unrecoverable errors (permission denied, server down, etc.) */
  onError?: (error: Error) => void
}

/** States the mic button and overlay can be in. */
export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error'
