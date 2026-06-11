import type { VoiceLayerConfig } from '../VoiceLayer.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AppProfile {
  framework: 'react' | 'vue' | 'angular' | 'next' | 'vanilla' | 'unknown';
  routerType: 'react-router' | 'vue-router' | 'next-router' | 'hash' | 'history' | 'unknown';
  hasSSR: boolean;
  /** Dominant language detected from page content and html[lang]. */
  language: 'hi' | 'en' | 'mixed' | 'unknown';
}

// Convenience alias for the chaotic window cast we need throughout
type Win = Window & typeof globalThis & Record<string, unknown>;

// ── AppDetector ───────────────────────────────────────────────────────────────

/**
 * AppDetector — sniffs the host page at runtime to produce an `AppProfile`,
 * then translates that profile into a `Partial<VoiceLayerConfig>` that improves
 * default behaviour with no manual configuration from the user.
 *
 * Detection is best-effort and never throws; unknown values are safe fallbacks.
 */
export class AppDetector {
  // ── Public API ─────────────────────────────────────────────────────────────

  /** Run all detections and return a combined `AppProfile`. */
  detect(): AppProfile {
    return {
      framework: this.detectFramework(),
      routerType: this.detectRouterType(),
      hasSSR:     this.detectSSR(),
      language:   this.detectLanguage(),
    };
  }

  /**
   * Convert an `AppProfile` into VoiceLayerConfig defaults that work best for
   * the detected environment.  These are intentionally conservative — the user's
   * explicit config always wins via `{ ...suggestConfig(profile), ...userConfig }`.
   */
  suggestConfig(profile: AppProfile): Partial<VoiceLayerConfig> {
    const config: Partial<VoiceLayerConfig> = {};

    // Language hint — if the page is clearly Hindi, default the STT/TTS language
    if (profile.language === 'hi') {
      config.language = 'hi';
    }

    // Next.js pages are server-rendered; rescan on mutation to catch hydration
    // populating elements that aren't present in the initial SSR shell.
    if (profile.framework === 'next') {
      config.rescanOnMutation = true;
    }

    return config;
  }

  // ── Private detection helpers ──────────────────────────────────────────────

  private detectFramework(): AppProfile['framework'] {
    if (typeof window === 'undefined') return 'unknown';
    const win = window as Win;

    // Check Next.js first — it is built on React, so test it before React.
    if (win.__NEXT_DATA__) return 'next';

    // React: dev tools hook, data-reactroot attribute, or window.React object
    if (
      win.__REACT_DEVTOOLS_GLOBAL_HOOK__ ||
      document.querySelector('[data-reactroot]') ||
      win.React
    ) return 'react';

    // Vue 3: window.__VUE__; Vue 2: __vue__ on the root element
    const vueRootEl = document.querySelector('#app') as (Element & Record<string, unknown>) | null;
    if (win.__VUE__ || vueRootEl?.__vue__ || vueRootEl?.__vue_app__) return 'vue';

    // Angular: window.ng or the ng-version attribute
    if (win.ng || document.querySelector('[ng-version]')) return 'angular';

    return 'vanilla';
  }

  private detectRouterType(): AppProfile['routerType'] {
    if (typeof window === 'undefined') return 'unknown';
    const win = window as Win;

    // Next.js has its own router
    if (win.__NEXT_DATA__) return 'next-router';

    // Hash router: the SPA encodes paths inside the hash portion (#/path)
    if (window.location.hash.startsWith('#/')) return 'hash';

    // Vue Router (Vue detected + history API in use)
    const vueRootEl = document.querySelector('#app') as (Element & Record<string, unknown>) | null;
    if (win.__VUE__ || vueRootEl?.__vue__ || vueRootEl?.__vue_app__) return 'vue-router';

    // React Router (React detected + history API in use)
    if (win.__REACT_DEVTOOLS_GLOBAL_HOOK__ || win.React) return 'react-router';

    return 'history';
  }

  private detectSSR(): boolean {
    if (typeof window === 'undefined') return true;
    const win = window as Win;
    return !!(win.__NEXT_DATA__ || win.__NUXT__);
  }

  /**
   * Language detection strategy:
   *  1. Trust the `html[lang]` attribute first.
   *  2. Walk up to 10 text nodes, count Hindi Unicode codepoints (U+0900–U+097F).
   *     > 30 % Hindi → 'hi'  |  5–30 % → 'mixed'  |  < 5 % → 'en'
   */
  private detectLanguage(): AppProfile['language'] {
    if (typeof document === 'undefined') return 'unknown';

    // html[lang] is authoritative when present
    const htmlLang = document.documentElement.lang?.toLowerCase() ?? '';
    if (htmlLang === 'hi' || htmlLang.startsWith('hi-')) return 'hi';

    // Scan text content
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

      let totalChars = 0;
      let hindiChars = 0;
      let sampledNodes = 0;
      let node: Node | null;

      while ((node = walker.nextNode()) !== null && sampledNodes < 10) {
        const text = (node.textContent ?? '').trim();
        if (text.length < 2) continue;
        sampledNodes++;

        for (const char of text) {
          const cp = char.codePointAt(0) ?? 0;
          totalChars++;
          if (cp >= 0x0900 && cp <= 0x097f) hindiChars++;
        }
      }

      if (totalChars === 0) return 'unknown';
      const ratio = hindiChars / totalChars;
      if (ratio > 0.3)  return 'hi';
      if (ratio > 0.05) return 'mixed';
      return 'en';
    } catch {
      return 'unknown';
    }
  }
}
