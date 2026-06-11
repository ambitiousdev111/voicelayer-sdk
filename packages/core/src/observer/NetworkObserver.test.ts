import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NetworkObserver } from './NetworkObserver.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function mockJsonResponse(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
    clone() {
      return { text: async () => body };
    },
  };
}

function mockPlainResponse(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'text/html' }),
    clone() {
      return { text: async () => body };
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('NetworkObserver — fetch patching', () => {
  let observer: NetworkObserver;

  beforeEach(() => {
    observer = new NetworkObserver();
  });

  afterEach(() => {
    observer.uninstall();
    vi.unstubAllGlobals();
  });

  it('records a fetch event after startCapture()', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockPlainResponse('ok'));
    vi.stubGlobal('fetch', mockFetch);

    observer.install();
    observer.startCapture();
    await window.fetch('https://api.example.com/orders');
    const events = observer.stopCapture();

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('fetch');
    expect(events[0].url).toBe('https://api.example.com/orders');
    expect(events[0].method).toBe('GET');
    expect(events[0].status).toBe(200);
    expect(events[0].timestamp).toBeTypeOf('number');
  });

  it('records the HTTP method correctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockPlainResponse('created', 201)));
    observer.install();
    observer.startCapture();
    await window.fetch('https://api.example.com/orders', { method: 'POST' });
    const [event] = observer.stopCapture();
    expect(event.method).toBe('POST');
    expect(event.status).toBe(201);
  });

  it('attaches responsePreview for JSON responses', async () => {
    const jsonBody = '{"total": 42, "items": []}';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockJsonResponse(jsonBody)));
    observer.install();
    observer.startCapture();
    await window.fetch('https://api.example.com/data');
    // JSON preview is set asynchronously — wait a tick
    await new Promise((r) => setTimeout(r, 10));
    const events = observer.stopCapture();
    expect(events[0].responsePreview).toBe(jsonBody);
  });

  it('does NOT attach responsePreview for non-JSON responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockPlainResponse('<html>page</html>')));
    observer.install();
    observer.startCapture();
    await window.fetch('https://example.com/page');
    const [event] = observer.stopCapture();
    expect(event.responsePreview).toBeUndefined();
  });

  it('records nothing before startCapture()', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockPlainResponse('ok')));
    observer.install();
    // no startCapture()
    await window.fetch('https://api.example.com/orders');
    observer.startCapture();
    const events = observer.stopCapture();
    expect(events).toHaveLength(0);
  });

  it('records nothing after stopCapture()', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockPlainResponse('ok')));
    observer.install();
    observer.startCapture();
    observer.stopCapture(); // stop immediately
    await window.fetch('https://api.example.com/orders');
    // Full log should still be empty — capturing was off
    expect(observer.getFullLog()).toHaveLength(0);
  });

  it('stopCapture() returns a copy — mutating it does not affect the log', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockPlainResponse('ok')));
    observer.install();
    observer.startCapture();
    await window.fetch('https://api.example.com/a');
    const events = observer.stopCapture();
    events.push({ type: 'fetch', method: 'GET', url: 'injected', timestamp: 0 });
    // A new capture should not include the injected event
    observer.startCapture();
    const events2 = observer.stopCapture();
    expect(events2).toHaveLength(0);
  });

  it('uninstall() restores the original fetch', () => {
    const originalFetch = window.fetch;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockPlainResponse('ok')));
    const mockFetch = window.fetch;
    observer.install();
    const patchedFetch = window.fetch;
    expect(patchedFetch).not.toBe(mockFetch);
    observer.uninstall();
    expect(window.fetch).toBe(mockFetch);
    void originalFetch; // suppress unused warning
  });

  it('install() is idempotent — double-install does not double-wrap', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockPlainResponse('ok'));
    vi.stubGlobal('fetch', mockFetch);
    observer.install();
    observer.install(); // second call should be no-op
    observer.startCapture();
    await window.fetch('https://api.example.com/x');
    const events = observer.stopCapture();
    // Only one event despite double install
    expect(events).toHaveLength(1);
    // Original fetch called exactly once
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('records durationMs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockPlainResponse('ok')));
    observer.install();
    observer.startCapture();
    await window.fetch('https://api.example.com/slow');
    const [event] = observer.stopCapture();
    expect(typeof event.durationMs).toBe('number');
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('NetworkObserver — history patching', () => {
  let observer: NetworkObserver;

  beforeEach(() => {
    observer = new NetworkObserver();
    observer.install();
  });

  afterEach(() => {
    observer.uninstall();
  });

  it('records a PUSH navigate event on history.pushState', () => {
    observer.startCapture();
    history.pushState({}, '', '/new-route');
    const events = observer.stopCapture();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('navigate');
    expect(events[0].method).toBe('PUSH');
    expect(events[0].url).toBe('/new-route');
  });

  it('records a REPLACE navigate event on history.replaceState', () => {
    observer.startCapture();
    history.replaceState({}, '', '/replaced');
    const events = observer.stopCapture();
    expect(events[0].method).toBe('REPLACE');
    expect(events[0].url).toBe('/replaced');
  });
});
