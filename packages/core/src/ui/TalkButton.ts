import type { VoiceLayerConfig } from '../config/VoiceLayerConfig.js';

export type TalkButtonState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

/** Mic icon paths for different states */
const ICONS: Record<TalkButtonState, string> = {
  idle: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="white">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
  </svg>`,
  listening: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="white">
    <rect x="10" y="3" width="4" height="12" rx="2"/>
    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
  </svg>`,
  processing: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
    <circle cx="12" cy="12" r="9" stroke-dasharray="28 8" stroke-linecap="round"/>
  </svg>`,
  speaking: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="white">
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
    <path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
  </svg>`,
  error: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="white">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
  </svg>`,
};

/**
 * TalkButton — the floating microphone button injected into the host page.
 *
 * Fully isolated in a Shadow DOM container — cannot conflict with host CSS.
 * Dispatches `voicelayer:tap` on click and responds to the configured hotkey.
 */
export class TalkButton {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private button: HTMLButtonElement | null = null;
  private badge: HTMLSpanElement | null = null;
  private currentState: TalkButtonState = 'idle';
  private hotkeyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private readonly uiConfig: NonNullable<VoiceLayerConfig['ui']> = {}) {
    this.host = document.createElement('div');
    this.host.id = 'voicelayer-talk-host';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.render();
    document.body.appendChild(this.host);
    this.bindHotkey();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Update the visual state of the button. */
  setState(state: TalkButtonState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    if (this.button) {
      this.button.setAttribute('data-state', state);
      // Replace icon content but preserve the badge element
      const badgeHTML = this.badge ? this.badge.outerHTML : '';
      this.button.innerHTML = ICONS[state] + badgeHTML;
      this.badge = this.shadow.querySelector<HTMLSpanElement>('.vl-badge');
      this.button.setAttribute('aria-label', TalkButton.ariaLabel(state));
    }
  }

  /**
   * Show a small context badge above the button (e.g. "modal", "form").
   * The badge floats above the button at top-centre.
   */
  showContextBadge(text: string): void {
    if (this.badge) {
      this.badge.textContent = text;
      this.badge.hidden = false;
    }
  }

  /** Hide the context badge. */
  hideContextBadge(): void {
    if (this.badge) {
      this.badge.hidden = true;
    }
  }

  /**
   * Update the button's aria-label directly.
   * The spec labels map states to:
   *   idle       → "VoiceLayer: tap to speak"
   *   listening  → "VoiceLayer: listening..."
   *   processing → "VoiceLayer: processing your command"
   *   speaking   → "VoiceLayer: speaking"
   *   error      → "VoiceLayer: error — tap to retry"
   */
  setAriaLabel(text: string): void {
    this.button?.setAttribute('aria-label', text);
  }

  /** Remove the button and clean up listeners. */
  destroy(): void {
    this.unbindHotkey();
    this.host.remove();
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private render(): void {
    const pos = this.uiConfig.position ?? 'bottom-right';
    const primary = this.uiConfig.theme?.primary ?? '#6C47FF';

    this.shadow.innerHTML = `
      <style>
        :host { all: initial; }

        .vl-btn {
          position: fixed;
          ${TalkButton.positionCSS(pos)}
          width: 64px;
          height: 64px;
          border-radius: 50%;
          background: ${primary};
          border: none;
          cursor: pointer;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 24px rgba(108,71,255,0.4);
          transition: transform 0.15s ease, box-shadow 0.15s ease;
          outline: none;
        }

        .vl-btn:hover { transform: scale(1.08); }

        .vl-btn[data-state="listening"] {
          background: #E53935;
          animation: vl-pulse 1.2s ease-in-out infinite;
        }

        .vl-btn[data-state="processing"] {
          animation: vl-spin 0.8s linear infinite;
        }

        .vl-btn[data-state="speaking"] { background: #00B899; }

        .vl-btn[data-state="error"] { background: #FF6B35; }

        @keyframes vl-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(229,57,53,.5); }
          50%       { box-shadow: 0 0 0 14px rgba(229,57,53,0); }
        }

        @keyframes vl-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }

        .vl-badge {
          position: absolute;
          top: -8px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 9px;
          padding: 2px 6px;
          border-radius: 4px;
          white-space: nowrap;
          background: #FF6B35;
          color: white;
          pointer-events: none;
          font-weight: 600;
          line-height: 1.3;
          font-family: system-ui, -apple-system, sans-serif;
        }
      </style>
      <button
        class="vl-btn"
        data-state="idle"
        aria-label="VoiceLayer: tap to speak"
        type="button"
      >${ICONS.idle}<span class="vl-badge" hidden></span></button>
    `;

    this.button = this.shadow.querySelector<HTMLButtonElement>('.vl-btn');
    this.badge = this.shadow.querySelector<HTMLSpanElement>('.vl-badge');
    this.button?.addEventListener('click', () => this.dispatch());
  }

  // ── Keyboard shortcut ──────────────────────────────────────────────────────

  private bindHotkey(): void {
    const raw = this.uiConfig.hotkey ?? 'Alt+KeyV';
    const parts = raw.split('+');
    const key = parts[parts.length - 1]; // e.g. "KeyV" or "v"
    const needsAlt = parts.includes('Alt');
    const needsCtrl = parts.includes('Control') || parts.includes('Ctrl');
    const needsMeta = parts.includes('Meta') || parts.includes('Command');

    this.hotkeyHandler = (e: KeyboardEvent) => {
      const codeMatch = e.code === key || e.key === key;
      if (
        codeMatch &&
        (!needsAlt || e.altKey) &&
        (!needsCtrl || e.ctrlKey) &&
        (!needsMeta || e.metaKey)
      ) {
        e.preventDefault();
        this.dispatch();
      }
    };

    document.addEventListener('keydown', this.hotkeyHandler);
  }

  private unbindHotkey(): void {
    if (this.hotkeyHandler) {
      document.removeEventListener('keydown', this.hotkeyHandler);
      this.hotkeyHandler = null;
    }
  }

  private dispatch(): void {
    window.dispatchEvent(
      new CustomEvent('voicelayer:tap', {
        detail: { state: this.currentState },
        bubbles: false,
      }),
    );
  }

  // ── Static helpers ─────────────────────────────────────────────────────────

  private static positionCSS(pos: string): string {
    const map: Record<string, string> = {
      'bottom-right': 'bottom: 24px; right: 24px;',
      'bottom-left': 'bottom: 24px; left: 24px;',
      'top-right': 'top: 24px; right: 24px;',
      'top-left': 'top: 24px; left: 24px;',
    };
    return map[pos] ?? map['bottom-right'];
  }

  private static ariaLabel(state: TalkButtonState): string {
    const labels: Record<TalkButtonState, string> = {
      idle:       'VoiceLayer: tap to speak',
      listening:  'VoiceLayer: listening...',
      processing: 'VoiceLayer: processing your command',
      speaking:   'VoiceLayer: speaking',
      error:      'VoiceLayer: error — tap to retry',
    };
    return labels[state];
  }
}
