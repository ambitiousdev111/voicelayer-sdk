import type { DOMWatcher, DOMChangeEvent } from '../observer/DOMWatcher.js';
import type { TTSPlayer } from '../audio/TTSPlayer.js';

export interface AnnouncerConfig {
  /** Speak and display toast text when toasts appear. Default true. */
  announceToasts: boolean;
  /** Speak a cue when a modal opens or closes. Default true. */
  announceModals: boolean;
}

/**
 * AnnouncerBar — ambient accessibility layer for dynamic page changes.
 *
 * Listens for DOMWatcher events (toast, modal_opened, modal_closed) and:
 *  1. Speaks a short cue via TTSPlayer.
 *  2. Shows a brief visual indicator in a Shadow DOM toast-reader bar.
 *
 * Debounces rapid bursts of DOM events (300 ms window) so only the most
 * recent event in a burst is announced — prevents overwhelming the user
 * when a page shows several toasts in quick succession.
 */
export class AnnouncerBar {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private indicator: HTMLElement | null = null;

  private domUnsub: (() => void) | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingEvent: DOMChangeEvent | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ttsPlayer: TTSPlayer,
    private readonly config: AnnouncerConfig,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Start observing the DOM via `watcher`.
   * Returns an unsubscribe function; call it (or `uninstall()`) to stop.
   */
  install(watcher: DOMWatcher): () => void {
    this.mountIndicator();

    this.domUnsub = watcher.onChange((event: DOMChangeEvent) => {
      const relevant =
        (event.type === 'toast' && this.config.announceToasts) ||
        ((event.type === 'modal_opened' || event.type === 'modal_closed') &&
          this.config.announceModals);

      if (!relevant) return;

      // Debounce — keep the latest event in each burst
      this.pendingEvent = event;
      if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        if (this.pendingEvent) {
          this.processEvent(this.pendingEvent);
          this.pendingEvent = null;
        }
      }, 300);
    });

    const unsub = () => this.uninstall();
    return unsub;
  }

  /**
   * Cancel any in-progress TTS and hide the visual indicator immediately.
   * Does NOT uninstall the watcher subscription.
   */
  silence(): void {
    this.ttsPlayer.stop().catch(() => undefined);
    this.hideIndicatorNow();
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingEvent = null;
  }

  /**
   * Stop observing, cancel pending timers, and remove the visual indicator
   * from the DOM.
   */
  uninstall(): void {
    this.silence();
    if (this.domUnsub) {
      this.domUnsub();
      this.domUnsub = null;
    }
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.indicator = null;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /** Inject a Shadow DOM host with the toast-reader visual indicator. */
  private mountIndicator(): void {
    if (this.host) return; // already mounted

    this.host = document.createElement('div');
    this.host.id = 'voicelayer-announcer-host';
    this.shadow = this.host.attachShadow({ mode: 'open' });

    this.shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .vl-toast-reader {
          position: fixed;
          top: 20px;
          right: 24px;
          z-index: 100000;
          background: rgba(15, 15, 15, 0.88);
          color: #fff;
          border-radius: 10px;
          padding: 10px 16px;
          font-size: 13px;
          font-family: system-ui, -apple-system, sans-serif;
          max-width: 320px;
          opacity: 0;
          transform: translateY(-8px);
          transition: opacity 0.2s ease, transform 0.2s ease;
          pointer-events: none;
          line-height: 1.45;
        }
        .vl-toast-reader--visible {
          opacity: 1;
          transform: translateY(0);
        }
      </style>
      <div class="vl-toast-reader" role="status" aria-live="polite"></div>
    `;

    this.indicator = this.shadow.querySelector('.vl-toast-reader');
    document.body.appendChild(this.host);
  }

  /** Decide what to speak and display for each event type. */
  private processEvent(event: DOMChangeEvent): void {
    let speakText: string;
    let displayText: string;

    if (event.type === 'toast') {
      // Trim to first 15 words to keep the announcement short and natural
      const words = event.textContent.trim().split(/\s+/);
      const truncated = words.slice(0, 15).join(' ');
      speakText = truncated + (words.length > 15 ? '…' : '');
      displayText = `🔔 ${speakText}`;
    } else if (event.type === 'modal_opened') {
      speakText = 'A dialog has appeared. Use voice to interact with it.';
      displayText = '🗂️ Dialog opened';
    } else {
      // modal_closed
      speakText = 'Dialog closed.';
      displayText = '✅ Dialog closed';
    }

    this.showIndicator(displayText);
    this.ttsPlayer.speak(speakText).catch(() => undefined);
  }

  private showIndicator(text: string): void {
    if (!this.indicator) return;

    // Cancel any pending auto-hide from the previous announcement
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    this.indicator.textContent = text;
    this.indicator.classList.add('vl-toast-reader--visible');

    // Auto-hide after 3 s
    this.hideTimer = setTimeout(() => {
      this.hideIndicatorNow();
      this.hideTimer = null;
    }, 3_000);
  }

  private hideIndicatorNow(): void {
    this.indicator?.classList.remove('vl-toast-reader--visible');
  }
}
