import type { VoiceLayerConfig } from '../config/VoiceLayerConfig.js';
import type { NetworkEvent } from '../observer/NetworkObserver.js';

/**
 * VoiceOverlay — shows live transcript + assistant reply in a floating panel.
 *
 * Fully isolated in Shadow DOM.
 * Accessible: role="status" + aria-live="polite".
 * Auto-dismisses after TTS finishes; dismissable via Escape or click-outside.
 */
export class VoiceOverlay {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private panel: HTMLElement | null = null;
  private transcriptEl: HTMLElement | null = null;
  private responseEl: HTMLElement | null = null;
  private modalHintEl: HTMLElement | null = null;
  private networkHintEl: HTMLElement | null = null;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private outsideHandler: ((e: MouseEvent) => void) | null = null;
  private readonly debug: boolean;

  constructor(uiConfig: NonNullable<VoiceLayerConfig['ui']> = {}, debug = false) {
    this.debug = debug;
    this.host = document.createElement('div');
    this.host.id = 'voicelayer-overlay-host';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.render(uiConfig);
    document.body.appendChild(this.host);
    this.bindDismiss();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Show the overlay with a status label and optional body content in one call.
   * Useful for driving the overlay through pipeline stages
   * (e.g. "Listening…", "Transcribing…", "Speaking…").
   */
  show(status: string, content = ''): void {
    if (this.panel) this.panel.hidden = false;
    if (this.transcriptEl) this.transcriptEl.textContent = status;
    if (this.responseEl)   this.responseEl.textContent   = content;
    this.clearHints();
    this.cancelDismissTimer();
  }

  /**
   * Show or update the interim transcript (while the user is still speaking).
   * Clears any modal/network hint from the previous turn.
   */
  setTranscript(text: string): void {
    this.showPanel();
    if (this.transcriptEl) {
      this.transcriptEl.textContent = `"${text}"`;
    }
    if (this.responseEl) {
      this.responseEl.textContent = '';
    }
    this.clearHints();
    this.cancelDismissTimer();
  }

  /**
   * Show the final assistant reply.
   * Auto-dismisses after `autoDismissMs` (default 4 s).
   */
  setResponse(text: string, autoDismissMs = 4_000): void {
    this.showPanel();
    if (this.responseEl) {
      this.responseEl.textContent = text;
    }
    this.scheduleDismiss(autoDismissMs);
  }

  /**
   * Show a hint about the modal context the AI is acting inside.
   * Displays a truncated (≤80 char) preview below the response text.
   */
  showModalContext(modalContent: string): void {
    if (!this.modalHintEl) return;
    const preview = modalContent.length > 80
      ? modalContent.slice(0, 77) + '…'
      : modalContent;
    this.modalHintEl.textContent = `📋 Modal context: ${preview}`;
    this.modalHintEl.hidden = false;
  }

  /**
   * Show a compact debug summary of network activity triggered by the last action.
   * Only rendered when the overlay was constructed with `debug = true`.
   */
  showActionResult(networkEvents: NetworkEvent[]): void {
    if (!this.debug || !this.networkHintEl || networkEvents.length === 0) return;
    const lines = networkEvents.slice(0, 3).map((ev) => {
      const status = ev.status != null ? ` → ${ev.status}` : '';
      const ms = ev.durationMs != null ? ` (${ev.durationMs}ms)` : '';
      return `${ev.method} ${ev.url}${status}${ms}`;
    });
    this.networkHintEl.textContent = lines.join('\n');
    this.networkHintEl.hidden = false;
  }

  /**
   * Hide the overlay immediately.
   */
  hide(): void {
    this.cancelDismissTimer();
    this.clearHints();
    if (this.panel) this.panel.hidden = true;
  }

  /**
   * Remove the overlay and clean up.
   */
  destroy(): void {
    this.hide();
    this.cancelDismissTimer();
    if (this.escHandler) document.removeEventListener('keydown', this.escHandler);
    if (this.outsideHandler) document.removeEventListener('click', this.outsideHandler, true);
    this.host.remove();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private showPanel(): void {
    if (this.panel) this.panel.hidden = false;
  }

  private clearHints(): void {
    if (this.modalHintEl)   { this.modalHintEl.hidden = true;   this.modalHintEl.textContent = ''; }
    if (this.networkHintEl) { this.networkHintEl.hidden = true; this.networkHintEl.textContent = ''; }
  }

  private scheduleDismiss(ms: number): void {
    this.cancelDismissTimer();
    this.dismissTimer = setTimeout(() => this.hide(), ms);
  }

  private cancelDismissTimer(): void {
    if (this.dismissTimer !== null) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
  }

  private render(uiConfig: NonNullable<VoiceLayerConfig['ui']>): void {
    const bg = uiConfig.theme?.background ?? '#1A1A2E';
    const text = uiConfig.theme?.text ?? '#F0F0F0';
    const primary = uiConfig.theme?.primary ?? '#6C47FF';
    const pos = uiConfig.position ?? 'bottom-right';

    this.shadow.innerHTML = `
      <style>
        :host { all: initial; font-family: system-ui, -apple-system, sans-serif; }

        .vl-panel {
          position: fixed;
          ${VoiceOverlay.positionCSS(pos)}
          width: 340px;
          max-width: calc(100vw - 48px);
          background: ${bg};
          color: ${text};
          border-radius: 12px;
          padding: 16px 20px;
          z-index: 2147483646;
          box-shadow: 0 8px 48px rgba(0,0,0,0.5);
          animation: vl-in 0.2s ease;
          border: 1px solid rgba(255,255,255,0.08);
        }

        .vl-panel[hidden] { display: none; }

        .vl-transcript {
          font-size: 12px;
          opacity: 0.55;
          margin-bottom: 8px;
          font-style: italic;
          line-height: 1.4;
          min-height: 0;
        }

        .vl-response {
          font-size: 15px;
          line-height: 1.55;
          font-weight: 500;
        }

        .vl-accent {
          display: block;
          width: 28px;
          height: 3px;
          background: ${primary};
          border-radius: 2px;
          margin-bottom: 10px;
        }

        .vl-modal-hint {
          margin-top: 10px;
          padding: 8px 10px;
          background: rgba(108, 71, 255, 0.15);
          border-left: 2px solid ${primary};
          border-radius: 0 6px 6px 0;
          font-size: 12px;
          line-height: 1.4;
          color: rgba(240, 240, 240, 0.85);
        }
        .vl-modal-hint[hidden] { display: none; }

        .vl-network-hint {
          margin-top: 8px;
          font-size: 11px;
          color: rgba(240, 240, 240, 0.45);
          font-family: monospace;
          white-space: pre-line;
          line-height: 1.5;
        }
        .vl-network-hint[hidden] { display: none; }

        @keyframes vl-in {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      </style>
      <div class="vl-panel" role="status" aria-live="polite" hidden>
        <span class="vl-accent"></span>
        <div class="vl-transcript"></div>
        <div class="vl-response"></div>
        <div class="vl-modal-hint" hidden></div>
        <div class="vl-network-hint" hidden></div>
      </div>
    `;

    this.panel = this.shadow.querySelector('.vl-panel');
    this.transcriptEl = this.shadow.querySelector('.vl-transcript');
    this.responseEl = this.shadow.querySelector('.vl-response');
    this.modalHintEl = this.shadow.querySelector('.vl-modal-hint');
    this.networkHintEl = this.shadow.querySelector('.vl-network-hint');
  }

  private bindDismiss(): void {
    // Escape key
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.panel && !this.panel.hidden) {
        this.hide();
      }
    };
    document.addEventListener('keydown', this.escHandler);

    // Click outside the overlay panel
    this.outsideHandler = (e: MouseEvent) => {
      if (
        this.panel &&
        !this.panel.hidden &&
        !this.host.contains(e.target as Node)
      ) {
        this.hide();
      }
    };
    document.addEventListener('click', this.outsideHandler, true);
  }

  private static positionCSS(pos: string): string {
    const map: Record<string, string> = {
      'bottom-right': 'bottom: 100px; right: 24px;',
      'bottom-left':  'bottom: 100px; left: 24px;',
      'top-right':    'top: 100px; right: 24px;',
      'top-left':     'top: 100px; left: 24px;',
    };
    return map[pos] ?? map['bottom-right'];
  }
}
