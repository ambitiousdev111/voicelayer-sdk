/**
 * NetworkObserver — silently records all network activity on the host page.
 *
 * Patches window.fetch, XMLHttpRequest, and history navigation.
 * Never throws — all patching errors are swallowed to protect the host app.
 *
 * Usage:
 *   const obs = new NetworkObserver();
 *   obs.install();
 *   obs.startCapture();
 *   // ... page interactions ...
 *   const events = obs.stopCapture();
 */

export interface NetworkEvent {
  type: 'fetch' | 'xhr' | 'navigate';
  method: string;
  url: string;
  status?: number;
  durationMs?: number;
  timestamp: number;
  /** First 200 chars of response text, if the Content-Type includes 'json'. */
  responsePreview?: string;
}

export class NetworkObserver {
  private log: NetworkEvent[] = [];
  private capturing = false;
  private installed = false;

  // Originals — stored so uninstall() can restore them
  private originalFetch!: typeof window.fetch;
  private originalXHROpen!: typeof XMLHttpRequest.prototype.open;
  private originalXHRSend!: typeof XMLHttpRequest.prototype.send;
  private originalPushState!: typeof history.pushState;
  private originalReplaceState!: typeof history.replaceState;

  // popstate handler reference (for removal)
  private popstateHandler!: () => void;

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Patch globals once. Safe to call multiple times — subsequent calls are
   * no-ops.
   */
  install(): void {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;

    this.patchFetch();
    this.patchXHR();
    this.patchHistory();
    this.listenPopstate();
  }

  /** Begin a capture session. Resets the per-session log. */
  startCapture(): void {
    this.log = [];
    this.capturing = true;
  }

  /** End the capture session and return all events recorded since startCapture(). */
  stopCapture(): NetworkEvent[] {
    this.capturing = false;
    return [...this.log];
  }

  /** Return every event recorded since install() (not just the last capture). */
  getFullLog(): NetworkEvent[] {
    return [...this.log];
  }

  /** Restore all patched globals. Primarily useful for tests. */
  uninstall(): void {
    if (!this.installed) return;

    if (this.originalFetch) window.fetch = this.originalFetch;

    if (this.originalXHROpen) XMLHttpRequest.prototype.open = this.originalXHROpen;
    if (this.originalXHRSend) XMLHttpRequest.prototype.send = this.originalXHRSend;

    if (this.originalPushState) history.pushState = this.originalPushState;
    if (this.originalReplaceState) history.replaceState = this.originalReplaceState;

    if (this.popstateHandler) {
      window.removeEventListener('popstate', this.popstateHandler);
    }

    this.installed = false;
  }

  // ── Private patchers ───────────────────────────────────────────────────────

  private patchFetch(): void {
    this.originalFetch = window.fetch;
    const self = this;
    const original = this.originalFetch;

    window.fetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const start = Date.now();

      // Let the real fetch run — errors propagate naturally
      const response = await original.call(window, input, init);

      try {
        if (self.capturing) {
          const url =
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.href
                : (input as Request).url;
          const method = (init?.method ?? 'GET').toUpperCase();
          const status = response.status;
          const durationMs = Date.now() - start;
          const ct = response.headers.get('content-type') ?? '';

          if (ct.includes('json')) {
            // Clone so the original response body stream is untouched
            response
              .clone()
              .text()
              .then((text) => {
                self.log.push({
                  type: 'fetch',
                  method,
                  url,
                  status,
                  durationMs,
                  timestamp: Date.now(),
                  responsePreview: text.slice(0, 200),
                });
              })
              .catch(() => {
                self.log.push({ type: 'fetch', method, url, status, durationMs, timestamp: Date.now() });
              });
          } else {
            self.log.push({ type: 'fetch', method, url, status, durationMs, timestamp: Date.now() });
          }
        }
      } catch {
        // Never break the host app
      }

      return response;
    };
  }

  private patchXHR(): void {
    if (typeof XMLHttpRequest === 'undefined') return;

    this.originalXHROpen = XMLHttpRequest.prototype.open;
    this.originalXHRSend = XMLHttpRequest.prototype.send;

    const self = this;
    const originalOpen = this.originalXHROpen;
    const originalSend = this.originalXHRSend;

    // WeakMap stores per-request metadata keyed by XHR instance
    const meta = new WeakMap<XMLHttpRequest, { method: string; url: string; startTime: number }>();

    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: Parameters<typeof XMLHttpRequest.prototype.open> extends [string, string | URL, ...infer R] ? R : never[]
    ) {
      meta.set(this, { method: method.toUpperCase(), url: url.toString(), startTime: 0 });
      return originalOpen.apply(this, [method, url, ...rest]);
    } as typeof XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.send = function (
      this: XMLHttpRequest,
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      const entry = meta.get(this);
      if (entry) {
        entry.startTime = Date.now();
        this.addEventListener('load', function (this: XMLHttpRequest) {
          try {
            if (!self.capturing) return;
            const ct = this.getResponseHeader('content-type') ?? '';
            const preview = ct.includes('json') ? this.responseText.slice(0, 200) : undefined;
            self.log.push({
              type: 'xhr',
              method: entry.method,
              url: entry.url,
              status: this.status,
              durationMs: Date.now() - entry.startTime,
              timestamp: Date.now(),
              responsePreview: preview || undefined,
            });
          } catch {
            // Never break the host app
          }
        });
      }
      return originalSend.apply(this, [body]);
    };
  }

  private patchHistory(): void {
    const self = this;

    this.originalPushState = history.pushState;
    history.pushState = function (
      ...args: Parameters<typeof history.pushState>
    ): void {
      self.originalPushState.apply(history, args);
      try {
        if (self.capturing) {
          self.log.push({
            type: 'navigate',
            method: 'PUSH',
            url: (args[2] ?? window.location.pathname)?.toString() ?? '',
            timestamp: Date.now(),
          });
        }
      } catch {
        // silent
      }
    };

    this.originalReplaceState = history.replaceState;
    history.replaceState = function (
      ...args: Parameters<typeof history.replaceState>
    ): void {
      self.originalReplaceState.apply(history, args);
      try {
        if (self.capturing) {
          self.log.push({
            type: 'navigate',
            method: 'REPLACE',
            url: (args[2] ?? window.location.pathname)?.toString() ?? '',
            timestamp: Date.now(),
          });
        }
      } catch {
        // silent
      }
    };
  }

  private listenPopstate(): void {
    const self = this;
    this.popstateHandler = () => {
      try {
        if (self.capturing) {
          self.log.push({
            type: 'navigate',
            method: 'POPSTATE',
            url: window.location.pathname + window.location.search,
            timestamp: Date.now(),
          });
        }
      } catch {
        // silent
      }
    };
    window.addEventListener('popstate', this.popstateHandler);
  }
}
