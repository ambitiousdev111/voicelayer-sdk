/**
 * VoiceLayer — top-level SDK class.
 *
 * Wires together every layer of the SDK:
 *   Audio → STT → AI → Executor → TTS
 *
 * Usage (IIFE / script tag):
 *   <script src="voicelayer.iife.js"
 *           data-anthropic-key="sk-ant-..."
 *           data-tts-provider="browser">
 *   </script>
 *
 * Usage (ES module):
 *   import { VoiceLayer } from 'voicelayer-sdk';
 *   const vl = new VoiceLayer({ anthropicKey: 'sk-ant-...' });
 *   await vl.init();
 */

import { AudioCapture } from './audio/AudioCapture.js';
import { Transcriber }  from './audio/Transcriber.js';
import { TTSPlayer }    from './audio/TTSPlayer.js';
import { DOMScanner }   from './scanner/DOMScanner.js';
import { IntentMapper } from './scanner/IntentMapper.js';
import { RouteDetector }from './scanner/RouteDetector.js';
import { IntentEngine } from './ai/IntentEngine.js';
import { ResponseParser }from './ai/ResponseParser.js';
import { ActionExecutor }from './executor/ActionExecutor.js';
import type { ExecutionResult } from './executor/ActionExecutor.js';
import { DOMInteractor }from './executor/DOMInteractor.js';
import { FormFiller }   from './executor/FormFiller.js';
import { NetworkObserver }from './observer/NetworkObserver.js';
import { DOMWatcher }   from './observer/DOMWatcher.js';
import { AnnouncerBar } from './ui/AnnouncerBar.js';
import { TalkButton }   from './ui/TalkButton.js';
import { VoiceOverlay } from './ui/VoiceOverlay.js';
import type { PageIntentMap } from './scanner/types.js';
import type { AIIntent } from './ai/types.js';
import { AppDetector }  from './config/AppDetector.js';
import { ConversationManager } from './session/ConversationManager.js';
import { AnalyticsEngine } from './analytics/AnalyticsEngine.js';
import { FounderDashboard } from './analytics/FounderDashboard.js';
import type { AnalyticsConfig } from './analytics/AnalyticsEngine.js';
import type { AgentStep } from './ai/PromptBuilder.js';
import { LearningStore } from './learning/LearningStore.js';
import { VariantGenerator } from './learning/VariantGenerator.js';
import type { StoredStep } from './learning/LearningStore.js';

// ── Minimal WebSpeech types (not in all DOM lib versions) ──────────────────────

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface SpeechRecognitionConstructor {
  new(): SpeechRecognitionInstance;
}
interface WindowWithSpeech extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

// ── Config ─────────────────────────────────────────────────────────────────────

export interface VoiceLayerConfig {
  /** Anthropic API key → Claude AI for intent resolution. */
  anthropicKey?: string;
  /** OpenAI API key → Whisper for STT and/or GPT-4o for AI. */
  openaiKey?: string;

  /**
   * Speech-to-text backend when `openaiKey` is set.
   * Default: `whisper`. Use `webspeech` to skip Whisper (Chrome Web Speech API).
   */
  stt?: 'whisper' | 'webspeech';
  /** ElevenLabs API key → high-quality multilingual TTS. */
  elevenLabsKey?: string;

  /** TTS backend override. Defaults to best available based on provided keys. */
  tts?: {
    provider: 'elevenlabs' | 'openai' | 'browser';
    voiceId?: string;
    speed?: number;
  };

  /** UI positioning and theming. */
  ui?: {
    buttonPosition?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    buttonColor?: string;
  };

  /** Speech language hint. 'auto' = detect from browser locale. Default: 'auto'. */
  language?: 'hi' | 'en' | 'auto';

  /**
   * Which LLM to use for intent resolution.
   * Default: 'claude' when anthropicKey is set, 'openai' otherwise.
   */
  aiProvider?: 'claude' | 'openai';

  /**
   * Same-origin proxy base for Claude (e.g. `/api/anthropic`).
   * Required for browser demos — api.anthropic.com blocks CORS preflight.
   */
  anthropicProxyUrl?: string;

  /**
   * Same-origin proxy base for OpenAI chat + Whisper (e.g. `/api/openai`).
   */
  openaiProxyUrl?: string;

  /**
   * SDK API key — must match SDK_API_KEY in your VoiceLayer server's .env.
   * Sent as `Authorization: Bearer <sdkApiKey>` on every proxy request.
   * Required when using data-proxy-url without a raw API key in the browser.
   */
  sdkApiKey?: string;

  /** Enable verbose console logging and network event overlay. */
  debug?: boolean;

  /**
   * Analytics configuration.
   * - `enabled`  — default: true. Set false to disable all tracking.
   * - `appId`    — identifier shown in the dashboard. Defaults to hostname.
   * - `endpoint` — optional POST URL for remote event collection.
   */
  analytics?: {
    enabled?: boolean;
    appId?:   string;
    endpoint?: string;
  };

  /**
   * Auto-speak toast messages as they appear on the page.
   * Default: true.
   */
  announceToasts?: boolean;

  /**
   * Announce modal open/close events via TTS.
   * Default: true.
   */
  announceModals?: boolean;

  /**
   * Automatically rescan the DOM after mutations so the AI always
   * sees an up-to-date page map.
   * Default: true.
   */
  rescanOnMutation?: boolean;
}

// ── VoiceLayer ─────────────────────────────────────────────────────────────────

export class VoiceLayer {
  // ── Sub-systems (created in init()) ─────────────────────────────────────────
  private audioCapture!: AudioCapture;
  private transcriber: Transcriber | null = null;
  private ttsPlayer!: TTSPlayer;
  private intentMapper!: IntentMapper;
  private intentEngine: IntentEngine | null = null;
  private actionExecutor!: ActionExecutor;
  private networkObserver!: NetworkObserver;
  private domWatcher!: DOMWatcher;
  private announcer!: AnnouncerBar;
  private talkButton!: TalkButton;
  private overlay!: VoiceOverlay;
  private routeDetector!: RouteDetector;

  // ── Runtime state ────────────────────────────────────────────────────────────
  currentPageMap: PageIntentMap | null = null;
  private unsubscribeRescan?: () => void;
  private unsubscribeRoute?: () => void;
  private tapHandler?: EventListener;
  private spaceHandler?: (e: KeyboardEvent) => void;
  private isListening = false;
  private micGranted = false;
  private autoStopTimer?: number;
  private recognition: SpeechRecognitionInstance | null = null;

  // ── Analytics ────────────────────────────────────────────────────────────────
  analytics!: AnalyticsEngine;
  private dashboard!: FounderDashboard;

  // ── Conversation history ──────────────────────────────────────────────────────
  private conversationManager!: ConversationManager;

  // ── Learning ─────────────────────────────────────────────────────────────────
  private learningStore!: LearningStore;
  private variantGenerator: VariantGenerator | null = null;

  // ── Route-level map cache ─────────────────────────────────────────────────────
  /** Cached page map per route. Invalidated when DOMWatcher fires a mutation. */
  private mapCache = new Map<string, PageIntentMap>();
  private mapCacheDirty = true;

  constructor(private config: VoiceLayerConfig) {}

  /** Open the Founder Insights dashboard overlay. */
  openDashboard(): void { this.dashboard?.open() }
  /** Close the Founder Insights dashboard overlay. */
  closeDashboard(): void { this.dashboard?.close() }

  /**
   * On local HTTP dev servers, default API calls to same-origin Vite proxies
   * (`/api/anthropic`, `/api/openai`) so Whisper/Claude avoid CORS and 404s.
   */
  private static isLocalDevHost(): boolean {
    if (typeof window === 'undefined') return false;
    const { hostname, protocol } = window.location;
    if (protocol !== 'http:') return false;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname.endsWith('.localhost')
    );
  }

  private resolveDevProxyUrls(): {
    anthropicProxyUrl?: string;
    openaiProxyUrl?: string;
  } {
    if (!VoiceLayer.isLocalDevHost()) {
      return {
        anthropicProxyUrl: this.config.anthropicProxyUrl,
        openaiProxyUrl: this.config.openaiProxyUrl,
      };
    }
    return {
      anthropicProxyUrl:
        this.config.anthropicProxyUrl ??
        (this.config.anthropicKey ? '/api/anthropic' : undefined),
      openaiProxyUrl:
        this.config.openaiProxyUrl ??
        (this.config.openaiKey ? '/api/openai' : undefined),
    };
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Initialise all sub-systems and mount the UI.
   * Must be called once before any voice interactions begin.
   */
  async init(): Promise<void> {
    // ── 0. Analytics + Founder Dashboard ─────────────────────────────────────
    const analyticsEnabled = this.config.analytics?.enabled !== false;
    const analyticsConfig: AnalyticsConfig = {
      appId:      this.config.analytics?.appId ?? window.location.hostname,
      enabled:    analyticsEnabled,
      endpoint:   this.config.analytics?.endpoint,
      sdkVersion: '0.2.0',
    };
    this.analytics = new AnalyticsEngine(analyticsConfig);
    this.analytics.install();

    this.dashboard = new FounderDashboard(() =>
      this.analytics.getInsights(),
    );
    if (this.config.debug) this.dashboard.installShortcut();

    // Handle export requests posted back from the dashboard iframe
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.data?.type !== 'vl-export') return;
      if (e.data.format === 'csv')  this._downloadFile('voicelayer-events.csv',  this.analytics.exportCSV(),  'text/csv');
      if (e.data.format === 'json') this._downloadFile('voicelayer-events.json', this.analytics.exportJSON(), 'application/json');
    });

    // ── 0b. Learning store + variant generator + conversation ─────────────────
    const appId = this.config.analytics?.appId ?? window.location.hostname;
    this.learningStore       = new LearningStore(appId);
    this.conversationManager = new ConversationManager(10);

    const anthropicBase = this.config.anthropicProxyUrl ?? 'https://api.anthropic.com';
    const openaiBase    = this.config.openaiProxyUrl    ?? 'https://api.openai.com';
    if (this.config.anthropicKey || this.config.openaiKey) {
      this.variantGenerator = new VariantGenerator({
        anthropicKey: this.config.anthropicKey,
        openaiKey:    this.config.openaiKey,
        anthropicBase,
        openaiBase,
      });
    }

    // ── 1. Auto-detect framework, router, language ────────────────────────────
    //   Detected defaults are conservative; the user's explicit config always wins.
    const detector = new AppDetector();
    const profile = detector.detect();
    const detectedConfig = detector.suggestConfig(profile);
    this.config = { ...detectedConfig, ...this.config };

    if (this.config.debug) {
      console.log('[VoiceLayer] App profile:', profile);
    }

    // ── 1. Observers ───────────────────────────────────────────────────────────
    this.networkObserver = new NetworkObserver();
    this.networkObserver.install();

    this.domWatcher = new DOMWatcher();
    this.domWatcher.install();
    // Invalidate route map cache whenever the DOM mutates
    this.domWatcher.onChange(() => { this.mapCacheDirty = true; });

    // ── 2. Scanner / mapper ─────────────────────────────────────────────────
    const scanner = new DOMScanner();
    this.routeDetector = new RouteDetector();
    this.intentMapper = new IntentMapper(scanner, this.routeDetector);

    // ── 3. Executor ─────────────────────────────────────────────────────────
    const domInteractor = new DOMInteractor(this.domWatcher);

    // Auto-patch navigate strategy for hash-based SPA routers
    if (profile.routerType === 'hash') {
      domInteractor.setNavigateStrategy('hash');
    }

    const formFiller    = new FormFiller(domInteractor);
    this.actionExecutor = new ActionExecutor(
      domInteractor, formFiller, this.networkObserver, this.domWatcher,
    );

    // ── 4. AI ────────────────────────────────────────────────────────────────
    const useOpenAI =
      this.config.aiProvider === 'openai' ||
      (!this.config.anthropicKey && !!this.config.openaiKey);

    const { anthropicProxyUrl, openaiProxyUrl } = this.resolveDevProxyUrls();

    const engineOptions = {
      anthropicBaseUrl: anthropicProxyUrl,
      openaiBaseUrl:    openaiProxyUrl,
      sdkApiKey:        this.config.sdkApiKey,
    };

    if (useOpenAI && this.config.openaiKey) {
      this.intentEngine = new IntentEngine(this.config.openaiKey, undefined, engineOptions);
    } else if (this.config.anthropicKey) {
      this.intentEngine = new IntentEngine(this.config.anthropicKey, undefined, engineOptions);
    } else if (anthropicProxyUrl) {
      // Proxy-only mode: no key in browser, server holds the key.
      // Pass empty string — x-api-key is ignored by our proxy anyway.
      this.intentEngine = new IntentEngine('', undefined, engineOptions);
    }
    // else: intentEngine stays null → clarify fallback

    // ── 5. STT ───────────────────────────────────────────────────────────────
    this.audioCapture = new AudioCapture();

    // For Hindi, Chrome Web Speech accuracy is notoriously poor.
    // Override stt: 'webspeech' and always use Whisper when an OpenAI key is available.
    const isHindi    = this.config.language === 'hi';
    const useWhisper =
      !!this.config.openaiKey &&
      (isHindi || this.config.stt !== 'webspeech');   // Hindi ignores stt override

    if (useWhisper) {
      const lang = this.config.language === 'auto' || !this.config.language
        ? 'en'
        : this.config.language;
      this.transcriber = new Transcriber(
        this.config.openaiKey!,   // guarded by `useWhisper` check above
        lang,
        openaiProxyUrl,
      );
    }
    // If no openaiKey → fall back to WebSpeech recognition in startListening()

    // ── 6. TTS ───────────────────────────────────────────────────────────────
    const ttsProvider = this.resolveTTSProvider();
    const ttsApiKey   = this.resolveTTSApiKey(ttsProvider);
    this.ttsPlayer = new TTSPlayer({
      provider: ttsProvider,
      apiKey:   ttsApiKey,
      voiceId:  this.config.tts?.voiceId,
      speed:    this.config.tts?.speed,
    });

    // ── 7. UI ────────────────────────────────────────────────────────────────
    const uiConfig = {
      position: this.config.ui?.buttonPosition ?? 'bottom-right',
      theme:    this.config.ui?.buttonColor ? { primary: this.config.ui.buttonColor } : undefined,
    };
    this.talkButton = new TalkButton(uiConfig);
    this.overlay    = new VoiceOverlay(uiConfig, this.config.debug ?? false);

    // ── 8. Announcer ─────────────────────────────────────────────────────────
    const announceToasts  = this.config.announceToasts  !== false;
    const announceModals  = this.config.announceModals  !== false;
    this.announcer = new AnnouncerBar(this.ttsPlayer, { announceToasts, announceModals });
    if (announceToasts || announceModals) {
      this.announcer.install(this.domWatcher);
    }

    // ── 9. Mic permission (Whisper mode only — prompts user once) ────────────
    if (this.transcriber) {
      try {
        this.micGranted = await this.audioCapture.requestPermission();
        if (!this.micGranted && this.config.debug) {
          console.warn('[VoiceLayer] Microphone permission denied — will use WebSpeech fallback');
        }
      } catch (err) {
        if (this.config.debug) console.warn('[VoiceLayer] Could not request mic permission:', err);
        this.micGranted = false;
      }
    }

    // ── 10. Initial page scan ────────────────────────────────────────────────
    this.currentPageMap = this.intentMapper.buildMap();

    // ── 11. Auto-rescan on DOM mutations ─────────────────────────────────────
    if (this.config.rescanOnMutation !== false) {
      this.unsubscribeRescan = this.intentMapper.installAutoRescan(
        this.domWatcher,
        (map) => {
          this.currentPageMap = map;
          if (map.openModals.length > 0) {
            this.talkButton.showContextBadge('Modal open');
          } else if (map.activeDropdowns.length > 0) {
            this.talkButton.showContextBadge('Dropdown open');
          } else {
            this.talkButton.hideContextBadge();
          }
        },
      );
    }

    // ── 12. TalkButton click → voicelayer:tap event ──────────────────────────
    this.tapHandler = () => {
      this.handleTalkPress().catch((err) => {
        if (this.config.debug) console.error('[VoiceLayer] handleTalkPress error:', err);
      });
    };
    window.addEventListener('voicelayer:tap', this.tapHandler);

    // ── 13. Space bar shortcut (skips when an input has focus) ───────────────
    this.spaceHandler = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement;
      if (active) {
        const tag = active.tagName.toLowerCase();
        if (
          tag === 'input' || tag === 'textarea' || tag === 'select' ||
          (active as HTMLElement).isContentEditable
        ) return;
      }
      e.preventDefault();
      this.handleTalkPress().catch(() => undefined);
    };
    document.addEventListener('keydown', this.spaceHandler);

    // ── 14. Route change → rebuild map ───────────────────────────────────────
    this.unsubscribeRoute = this.routeDetector.onRouteChange(() => {
      this.currentPageMap = this.intentMapper.buildMap();
      if (this.config.debug) {
        console.log('[VoiceLayer] Route change → map rebuilt');
      }
    });

    // ── 14b. Next.js router — subscribe to routeChangeComplete ───────────────
    if (profile.framework === 'next') {
      type NextRouter = { events?: { on(e: string, cb: () => void): void } };
      const nextRouter = (window as unknown as { next?: { router?: NextRouter } }).next?.router;
      nextRouter?.events?.on('routeChangeComplete', () => {
        this.currentPageMap = this.intentMapper.buildMap();
        if (this.config.debug) {
          console.log('[VoiceLayer] Next.js routeChangeComplete → map rebuilt');
        }
      });
    }

    // ── 15. Debug log ────────────────────────────────────────────────────────
    if (this.config.debug) {
      console.log('[VoiceLayer] Ready');
      console.log('[VoiceLayer] Page map:', this.currentPageMap);
    }
  }

  /**
   * Tear down all sub-systems, remove DOM elements, and release the microphone.
   */
  destroy(): void {
    this.unsubscribeRescan?.();
    this.unsubscribeRoute?.();

    if (this.tapHandler) {
      window.removeEventListener('voicelayer:tap', this.tapHandler);
      this.tapHandler = undefined;
    }
    if (this.spaceHandler) {
      document.removeEventListener('keydown', this.spaceHandler);
      this.spaceHandler = undefined;
    }
    if (this.autoStopTimer !== undefined) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = undefined;
    }

    this.recognition?.stop();
    this.recognition = null;
    this.analytics?.uninstall();
    this.dashboard?.uninstall();
    this.audioCapture?.destroy();
    this.ttsPlayer?.stop().catch(() => undefined);
    this.domWatcher?.uninstall();
    this.networkObserver?.uninstall();
    this.announcer?.uninstall();
    this.talkButton?.destroy();
    this.overlay?.destroy();
  }

  // ── Static auto-init (for <script data-anthropic-key="..."> usage) ──────────

  /**
   * Called automatically when the SDK is loaded as an IIFE with data attributes
   * on the `<script>` tag.  Can also be called manually.
   *
   * @example — direct keys (dev only, key visible in HTML):
   * <script src="voicelayer.iife.js"
   *         data-anthropic-key="sk-ant-..."
   *         data-tts-provider="browser">
   * </script>
   *
   * @example — server-side proxy (production, no key in browser):
   * <script src="voicelayer.iife.js"
   *         data-proxy-url="https://yourserver.com/proxy"
   *         data-tts-provider="browser">
   * </script>
   */
  static autoInit(): void {
    const script = document.currentScript as HTMLScriptElement | null;
    if (!script) return;

    // data-proxy-url sets both proxy bases at once, e.g. "https://yourserver.com/proxy"
    // → anthropicProxyUrl = "https://yourserver.com/proxy/anthropic"
    // → openaiProxyUrl    = "https://yourserver.com/proxy/openai"
    // Individual overrides (data-anthropic-proxy-url / data-openai-proxy-url) take precedence.
    const proxyBase         = script.dataset.proxyUrl?.replace(/\/$/, '');
    const anthropicProxyUrl = script.dataset.anthropicProxyUrl ?? (proxyBase ? `${proxyBase}/anthropic` : undefined);
    const openaiProxyUrl    = script.dataset.openaiProxyUrl    ?? (proxyBase ? `${proxyBase}/openai`    : undefined);

    const config: VoiceLayerConfig = {
      anthropicKey:      script.dataset.anthropicKey,
      openaiKey:         script.dataset.openaiKey,
      elevenLabsKey:     script.dataset.elevenLabsKey,
      sdkApiKey:         script.dataset.apiKey,
      anthropicProxyUrl,
      openaiProxyUrl,
      tts: {
        provider: (script.dataset.ttsProvider ?? 'browser') as 'elevenlabs' | 'openai' | 'browser',
        voiceId:  script.dataset.voiceId,
      },
      language:       (script.dataset.language ?? 'auto') as VoiceLayerConfig['language'],
      aiProvider:     (script.dataset.aiProvider ?? undefined) as VoiceLayerConfig['aiProvider'],
      debug:          script.dataset.debug === 'true',
      announceToasts: script.dataset.announceToasts !== 'false',
      announceModals: script.dataset.announceModals !== 'false',
      analytics: {
        enabled:  script.dataset.analyticsEnabled !== 'false',
        appId:    script.dataset.appId,
        endpoint: script.dataset.analyticsEndpoint,
      },
    };

    const vl = new VoiceLayer(config);
    vl.init().catch((err: unknown) => {
      console.error('[VoiceLayer] autoInit failed:', err);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as unknown as Record<string, unknown>).voicelayer = vl;
  }

  // ── Private pipeline ──────────────────────────────────────────────────────

  /** Toggle: stop current session or start a new one. */
  private async handleTalkPress(): Promise<void> {
    if (this.isListening) {
      if (this.transcriber && this.micGranted) {
        // Whisper mode — flush recording
        await this.stopAndProcess();
      } else {
        // WebSpeech mode — stop recognition; onresult fires stopAndProcess chain
        this.recognition?.stop();
      }
    } else {
      await this.startListening();
    }
  }

  private async startListening(): Promise<void> {
    this.isListening = true;
    this.announcer.silence();
    this.talkButton.setState('listening');
    this.talkButton.setAriaLabel('VoiceLayer: listening...');
    this.overlay.show('🎤 Listening…');

    if (this.transcriber && this.micGranted) {
      // ── Whisper / AudioCapture mode ──────────────────────────────────────
      try {
        await this.audioCapture.startRecording();
      } catch (err) {
        this.isListening = false;
        this.talkButton.setState('error');
        this.overlay.show('⚠️ Mic error', err instanceof Error ? err.message : 'Recording failed.');
        setTimeout(() => {
          this.talkButton.setState('idle');
          this.overlay.hide();
        }, 2_500);
        return;
      }
      // Auto-stop after 10 s so users don't get stuck
      this.autoStopTimer = window.setTimeout(() => {
        this.stopAndProcess().catch(() => undefined);
      }, 10_000);
    } else {
      // ── WebSpeech mode ────────────────────────────────────────────────────
      this.startWebSpeech();
    }
  }

  /** Stop Whisper recording, transcribe, and process. */
  private async stopAndProcess(): Promise<void> {
    if (this.autoStopTimer !== undefined) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = undefined;
    }
    this.isListening = false;

    this.talkButton.setState('processing');
    this.overlay.show('💭 Transcribing…');

    let transcribedText: string;
    try {
      const audioBlob = await this.audioCapture.stopRecording();

      if (audioBlob.size < 1_000) {
        // Too short — likely silence
        this.overlay.show("Didn't catch that.", 'Please try again.');
        setTimeout(() => {
          this.talkButton.setState('idle');
          this.overlay.hide();
        }, 2_000);
        return;
      }

      transcribedText = await this.transcriber!.transcribe(audioBlob);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transcription failed.';
      if (this.config.debug) console.error('[VoiceLayer] STT error:', err);
      this.talkButton.setState('error');
      this.overlay.show('⚠️ Error', msg);
      setTimeout(() => {
        this.talkButton.setState('idle');
        this.overlay.hide();
      }, 3_000);
      return;
    }

    this.overlay.setTranscript(`"${transcribedText}"`);
    await this.processIntent(transcribedText);
  }

  // ── Route-level map cache ─────────────────────────────────────────────────

  /**
   * Returns a cached PageIntentMap for the current route.
   * Rebuilds only when the DOM has mutated since the last build.
   */
  private static readonly MAP_CACHE_MAX = 10;

  private buildMapCached(): PageIntentMap {
    const route = window.location.pathname + window.location.hash;
    if (!this.mapCacheDirty && this.mapCache.has(route)) {
      // Re-insert to mark as most-recently-used
      const cached = this.mapCache.get(route)!;
      this.mapCache.delete(route);
      this.mapCache.set(route, cached);
      return cached;
    }
    const fresh = this.intentMapper.buildMap();
    // LRU eviction: drop the oldest entry when at capacity
    if (this.mapCache.size >= VoiceLayer.MAP_CACHE_MAX) {
      const oldest = this.mapCache.keys().next().value;
      if (oldest) this.mapCache.delete(oldest);
    }
    this.mapCache.set(route, fresh);
    this.mapCacheDirty = false;
    this.currentPageMap = fresh;
    return fresh;
  }

  // ── Agent loop ────────────────────────────────────────────────────────────

  private static readonly MAX_AGENT_STEPS = 4;

  /**
   * Waits until the DOM has been quiet (no mutations) for `quietMs`,
   * or until `timeoutMs` total has elapsed — whichever comes first.
   * This replaces the old hardcoded setTimeout(800).
   */
  private waitForDOMSettle(quietMs = 300, timeoutMs = 2_500): Promise<void> {
    return new Promise((resolve) => {
      let quietTimer: number;
      const deadline = setTimeout(() => {
        unsub();
        clearTimeout(quietTimer);
        resolve();
      }, timeoutMs);

      const reset = () => {
        clearTimeout(quietTimer);
        quietTimer = window.setTimeout(() => {
          clearTimeout(deadline);
          unsub();
          resolve();
        }, quietMs);
      };

      const unsub = this.domWatcher.onChange(() => reset());
      reset(); // start the first quiet timer immediately
    });
  }

  /**
   * ReAct agent loop — runs up to MAX_AGENT_STEPS iterations.
   *
   * Each iteration:
   *   1. Observe: rebuild fresh page map
   *   2. Think:   ask Claude for the single best next action
   *   3. Act:     execute it
   *   4. Wait:    let DOM settle before the next observation
   *
   * Stops when Claude emits `done`, `speak_only`, `clarify`,
   * or when MAX_AGENT_STEPS is reached.
   *
   * Returns the final AIIntent (used for TTS + analytics).
   */
  private async runAgentLoop(transcribedText: string): Promise<{
    finalIntent:  AIIntent;
    totalAiMs:    number;
    totalExecMs:  number;
    lastRoute:    string;
    success:      boolean;
    stepHistory:  AgentStep[];
  }> {
    const stepHistory: AgentStep[] = [];
    let totalAiMs   = 0;
    let totalExecMs = 0;
    let lastRoute   = this.intentMapper.buildMap().currentRoute;
    let finalIntent: AIIntent = ResponseParser.clarifyFallback('Kuch samajh nahi aaya.');
    let overallSuccess = false;

    const TERMINAL = new Set(['done', 'speak_only', 'clarify']);

    for (let step = 0; step < VoiceLayer.MAX_AGENT_STEPS; step++) {
      // ── Observe ───────────────────────────────────────────────────────
      const pageMap = this.buildMapCached();
      this.currentPageMap = pageMap;
      lastRoute = pageMap.currentRoute;

      const request = {
        transcribedText,
        pageMap,
        language:            this.config.language,
        networkContext:      this.networkObserver.getFullLog().slice(-10),
        conversationHistory: this.conversationManager.getHistory(),
      };

      // ── Think ─────────────────────────────────────────────────────────
      if (this.config.debug) {
        console.log(`[VoiceLayer] Agent step ${step + 1}/${VoiceLayer.MAX_AGENT_STEPS}`, pageMap.currentPage);
      }

      let intent: AIIntent;
      const aiStart = Date.now();
      try {
        if (!this.intentEngine) {
          intent = ResponseParser.clarifyFallback('No AI provider configured.');
        } else {
          intent = await this.intentEngine.understandAgentStep(
            transcribedText, request, stepHistory,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'AI request failed.';
        if (this.config.debug) console.error('[VoiceLayer] Agent AI error:', err);
        this.analytics.trackError({ route: lastRoute, errorCode: 'AI_ERROR' });
        intent = ResponseParser.clarifyFallback(msg);
        finalIntent = intent;
        break;
      }
      totalAiMs += Date.now() - aiStart;
      finalIntent = intent;

      if (this.config.debug) console.log(`[VoiceLayer] Agent step ${step + 1} intent:`, intent);

      // ── Terminal check ────────────────────────────────────────────────
      if (TERMINAL.has(intent.action)) {
        overallSuccess = intent.action === 'done';
        break;
      }

      // ── Act ───────────────────────────────────────────────────────────
      const execStart = Date.now();
      let result: ExecutionResult = { success: false, intent };
      try {
        result = await this.actionExecutor.execute(intent);
        overallSuccess = result.success;
      } catch (err) {
        if (this.config.debug) console.warn('[VoiceLayer] Agent exec warning:', err);
      }
      totalExecMs += Date.now() - execStart;

      if (result.domChange?.type === 'modal_opened' && result.domChange.textContent) {
        this.overlay.showModalContext(result.domChange.textContent);
      }
      if (this.config.debug && result.networkEvents?.length) {
        this.overlay.showActionResult(result.networkEvents);
      }

      // Record step for Claude's history in the next iteration
      stepHistory.push({
        stepNumber: step + 1,
        action:     intent.action,
        target:     intent.target,
        outcome:    result.success ? 'success' : 'failed',
        pageAfter:  this.intentMapper.buildMap().currentPage,
      });

      // ── Wait ──────────────────────────────────────────────────────────
      // For actions that change the page, wait for DOM to settle.
      const changesPage = ['navigate', 'click', 'submit_form', 'select_option'].includes(intent.action);
      if (changesPage) {
        await this.waitForDOMSettle(300, 2_500);
      }

      // If this was the last allowed step, stop
      if (step === VoiceLayer.MAX_AGENT_STEPS - 1) {
        if (this.config.debug) console.log('[VoiceLayer] Agent reached max steps');
      }
    }

    return { finalIntent, totalAiMs, totalExecMs, lastRoute, success: overallSuccess, stepHistory };
  }

  /** Shared intent→execute→speak pipeline called by both STT backends. */
  private async processIntent(transcribedText: string): Promise<void> {
    const t0 = Date.now();

    if (!this.intentEngine) {
      const fallback = ResponseParser.clarifyFallback(
        'No AI provider configured. Please set anthropicKey or openaiKey.',
      );
      this.overlay.setResponse(fallback.speak);
      await this.ttsPlayer.speak(fallback.speak).catch(() => undefined);
      this.talkButton.setState('idle');
      this.overlay.hide();
      return;
    }

    const currentRoute = window.location.pathname + window.location.hash;

    // ── Fast path: LearningStore lookup ──────────────────────────────────
    // Check before any AI call. If a match is found and all selectors are
    // still in the DOM, replay the stored steps immediately.
    const stored = this.learningStore.findMatch(transcribedText, currentRoute);
    if (stored && this.learningStore.validateSteps(stored.steps)) {
      if (this.config.debug) {
        console.log(`[VoiceLayer] LearningStore HIT (${stored.source}):`, stored.originalTranscript);
      }

      // Replay each stored step
      let replaySuccess = true;
      for (const step of stored.steps) {
        const replayIntent: AIIntent = {
          action:     step.action,
          target:     step.target,
          data:       step.data,
          speak:      stored.speak,
          confidence: stored.confidence,
        };
        try {
          const r = await this.actionExecutor.execute(replayIntent);
          if (!r.success) { replaySuccess = false; break; }
          if (['navigate','click','submit_form','select_option'].includes(step.action)) {
            await this.waitForDOMSettle(300, 2_000);
          }
        } catch {
          replaySuccess = false;
          break;
        }
      }

      if (replaySuccess) {
        const totalMs = Date.now() - t0;
        this.analytics.trackCommand({
          action:    (stored.steps[0]?.action ?? 'speak_only') as import('./analytics/types.js').VLActionType,
          route:     currentRoute,
          success:   true,
          source:    'learned',
          lang:      (this.config.language === 'hi' ? 'hi' : this.config.language === 'en' ? 'en' : 'unknown') as import('./analytics/types.js').VLLang,
          whisperMs: 0,
          aiMs:      0,
          execMs:    totalMs,
          totalMs,
        });

        this.talkButton.setState('speaking');
        this.overlay.setResponse(stored.speak);
        await this.ttsPlayer.speak(stored.speak).catch(() => undefined);
        this.conversationManager.addTurn(transcribedText, stored.speak);
        this.talkButton.setState('idle');
        this.talkButton.setAriaLabel('VoiceLayer: tap to speak');
        this.overlay.hide();
        return;
      }

      // Replay failed (DOM changed) — fall through to agent loop
      if (this.config.debug) console.log('[VoiceLayer] LearningStore replay failed, falling through to agent loop');
    }

    // ── Parallel: kick off DOM scan while showing processing state ────────
    // buildMapCached is synchronous but we invoke it here so it runs
    // before the first agent-loop step rather than inside it.
    this.buildMapCached();

    // ── Agent loop ────────────────────────────────────────────────────────
    let agentResult: Awaited<ReturnType<typeof this.runAgentLoop>>;
    try {
      agentResult = await this.runAgentLoop(transcribedText);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Agent loop failed.';
      if (this.config.debug) console.error('[VoiceLayer] Agent error:', err);
      this.analytics.trackError({ route: currentRoute, errorCode: 'AGENT_ERROR' });
      this.talkButton.setState('error');
      this.overlay.show('⚠️ Error', msg);
      setTimeout(() => { this.talkButton.setState('idle'); this.overlay.hide(); }, 3_000);
      return;
    }

    const { finalIntent, totalAiMs, totalExecMs, lastRoute, success, stepHistory } = agentResult;
    const totalMs = Date.now() - t0;

    // ── Seed LearningStore async (fire-and-forget) ────────────────────────
    if (success && stepHistory.length > 0 && this.variantGenerator) {
      const storedSteps: StoredStep[] = stepHistory.map((s) => ({
        action: s.action as import('./ai/types.js').ActionType,
        target: s.target,
        data:   null,
      }));

      // Store the real transcript immediately (sync)
      this.learningStore.store(
        transcribedText, storedSteps, finalIntent.speak, currentRoute, finalIntent.confidence,
      );

      // Generate variants asynchronously — never blocks the response
      this.variantGenerator.seedAsync(
        transcribedText, storedSteps, finalIntent.speak, currentRoute, finalIntent.confidence,
        this.learningStore,
      );
    }

    // ── Track to analytics ────────────────────────────────────────────────
    this.analytics.trackCommand({
      action:    (finalIntent.action ?? 'speak_only') as import('./analytics/types.js').VLActionType,
      route:     lastRoute,
      success,
      source:    'ai',
      lang:      (this.config.language === 'hi' ? 'hi' : this.config.language === 'en' ? 'en' : 'unknown') as import('./analytics/types.js').VLLang,
      whisperMs: this.transcriber ? Math.max(0, totalMs - totalAiMs - totalExecMs) : 0,
      aiMs:      totalAiMs,
      execMs:    totalExecMs,
      totalMs,
    });

    // ── TTS ───────────────────────────────────────────────────────────────
    this.talkButton.setState('speaking');
    this.talkButton.setAriaLabel('VoiceLayer: speaking');
    this.overlay.setResponse(finalIntent.speak);

    try {
      await this.ttsPlayer.speak(finalIntent.speak);
    } catch {
      // TTS failure is non-fatal — text is already shown in the overlay
    }

    // Record turn so the next command has "woh wale" / pronoun resolution context
    this.conversationManager.addTurn(transcribedText, finalIntent.speak);

    this.talkButton.setState('idle');
    this.talkButton.setAriaLabel('VoiceLayer: tap to speak');
    this.overlay.hide();
  }

  /** WebSpeech recognition session. Calls processIntent() on final result. */
  private startWebSpeech(): void {
    const w = window as WindowWithSpeech;
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;

    if (!SR) {
      this.isListening = false;
      this.talkButton.setState('error');
      this.overlay.show('⚠️ Not supported', 'Speech recognition requires Chrome.');
      setTimeout(() => {
        this.talkButton.setState('idle');
        this.overlay.hide();
      }, 2_500);
      return;
    }

    const rec = new SR();
    this.recognition = rec;

    rec.continuous     = false;
    rec.interimResults = true;
    const langMap: Record<string, string> = {
      hi: 'hi-IN', en: 'en-US', auto: 'en-IN',
    };
    rec.lang = langMap[this.config.language ?? 'auto'] ?? 'en-IN';

    // Chrome's Hindi ASR model has low accuracy — surface a hint so the user
    // knows to speak slowly and clearly. The hint is replaced the moment any
    // transcript arrives, so it doesn't block the UI.
    if (this.config.language === 'hi') {
      this.overlay.show(
        '🎙 Hindi mode',
        'Browser mic accuracy is limited. Speak clearly and slowly, ya OpenAI key add karein better results ke liye.',
      );
    }

    rec.onresult = (event: SpeechRecognitionEvent) => {
      const parts = Array.from(
        { length: event.results.length },
        (_, i) => event.results[i][0].transcript,
      );
      const transcript = parts.join('');
      this.overlay.setTranscript(`"${transcript}"`);

      if (event.results[event.results.length - 1].isFinal) {
        this.isListening = false;
        if (this.autoStopTimer !== undefined) {
          clearTimeout(this.autoStopTimer);
          this.autoStopTimer = undefined;
        }
        this.talkButton.setState('processing');
        this.processIntent(transcript).catch((err) => {
          if (this.config.debug) console.error('[VoiceLayer]', err);
        });
      }
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      this.isListening = false;
      if (this.autoStopTimer !== undefined) {
        clearTimeout(this.autoStopTimer);
        this.autoStopTimer = undefined;
      }
      const msg =
        event.error === 'no-speech'   ? 'No speech detected.' :
        event.error === 'not-allowed' ? 'Microphone access denied.' :
        `Recognition error: ${event.error}`;
      this.talkButton.setState('error');
      this.overlay.show('⚠️ Error', msg);
      setTimeout(() => {
        this.talkButton.setState('idle');
        this.overlay.hide();
      }, 2_500);
    };

    rec.onend = () => {
      if (this.isListening) {
        // ended without a final result (e.g. no-speech timeout)
        this.isListening = false;
        this.talkButton.setState('idle');
        this.overlay.hide();
      }
    };

    rec.start();

    // Auto-stop after 10 s
    this.autoStopTimer = window.setTimeout(() => {
      rec.stop();
    }, 10_000);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _downloadFile(name: string, content: string, mime: string): void {
    const a   = document.createElement('a');
    a.href    = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1_000);
  }

  private resolveTTSProvider(): 'browser' | 'elevenlabs' | 'openai' {
    if (this.config.tts?.provider) return this.config.tts.provider;
    if (this.config.elevenLabsKey) return 'elevenlabs';
    if (this.config.openaiKey)     return 'openai';
    return 'browser';
  }

  private resolveTTSApiKey(provider: 'browser' | 'elevenlabs' | 'openai'): string | undefined {
    if (provider === 'elevenlabs') return this.config.elevenLabsKey;
    if (provider === 'openai')     return this.config.openaiKey;
    return undefined;
  }
}

// ── IIFE auto-init ─────────────────────────────────────────────────────────────
//
// Triggers when the script tag carries an API key OR a proxy URL.
// Using data-proxy-url keeps keys off the browser entirely.
if (typeof window !== 'undefined') {
  const _s = document.currentScript as HTMLScriptElement | null;
  if (_s?.dataset.anthropicKey || _s?.dataset.openaiKey || _s?.dataset.proxyUrl) {
    VoiceLayer.autoInit();
  }
}
