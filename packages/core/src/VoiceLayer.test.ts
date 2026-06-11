/**
 * VoiceLayer end-to-end tests.
 *
 * All sub-systems are mocked so the suite runs in happy-dom without real
 * microphones, API keys, or network.  They verify:
 *   1. init() wires sub-systems correctly.
 *   2. A talk-press (×2 in Whisper mode) fires the pipeline in order.
 *   3. A modal-opened domChange updates the overlay context hint.
 *   4. The context badge follows open-modal / dropdown / none state.
 *   5. destroy() tears everything down.
 *
 * All mock instances are declared via vi.hoisted() so they're available
 * inside vi.mock() factory functions (which vitest hoists above imports).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoist mock instances above vi.mock() hoisting boundary ───────────────────

const {
  mockAudioCapture,
  mockTranscriber,
  mockTTS,
  mockBuildMap,
  mockInstallAutoRescan,
  mockUnderstand,
  mockClarifyFallback,
  mockExecute,
  mockNetworkObserver,
  mockDOMWatcher,
  mockAnnouncer,
  mockButton,
  mockOverlay,
} = vi.hoisted(() => {
  const noop = () => undefined;

  const defaultPageMap = () => ({
    currentPage: 'dashboard', currentRoute: '/', focusContext: 'main' as const,
    availableActions: [], openModals: [], activeDropdowns: [],
    toasts: [], visibleData: {}, hiddenActions: [], pageTitle: 'Dashboard',
  });

  return {
    mockAudioCapture: {
      requestPermission: vi.fn().mockResolvedValue(true),
      startRecording:    vi.fn().mockResolvedValue(undefined),
      stopRecording:     vi.fn().mockResolvedValue(
        new Blob(['x'.repeat(2_000)], { type: 'audio/webm' }),
      ),
      destroy: vi.fn(),
      isRecording: false,
    },
    mockTranscriber: {
      transcribe: vi.fn().mockResolvedValue('aaj ke orders dikhao'),
    },
    mockTTS: {
      speak: vi.fn().mockResolvedValue(undefined),
      stop:  vi.fn().mockResolvedValue(undefined),
    },
    mockBuildMap: vi.fn().mockReturnValue(defaultPageMap()),
    mockInstallAutoRescan: vi.fn().mockReturnValue(noop),
    mockUnderstand: vi.fn().mockResolvedValue({
      action: 'navigate', target: '/orders', data: null,
      speak: 'Navigating to orders', confidence: 0.95,
    }),
    mockClarifyFallback: vi.fn().mockReturnValue({
      action: 'clarify', target: null, data: null,
      speak: 'No AI configured.', confidence: 0,
    }),
    mockExecute: vi.fn().mockResolvedValue({
      success: true,
      intent: { action: 'navigate', target: '/orders', data: null, speak: 'Navigating', confidence: 0.9 },
      networkEvents: [],
      domChange: undefined,
    }),
    mockNetworkObserver: {
      install:      vi.fn(),
      uninstall:    vi.fn(),
      startCapture: vi.fn(),
      stopCapture:  vi.fn().mockReturnValue([]),
      getFullLog:   vi.fn().mockReturnValue([]),
    },
    mockDOMWatcher: {
      install:       vi.fn(),
      uninstall:     vi.fn(),
      onChange:      vi.fn().mockReturnValue(noop),
      waitForChange: vi.fn().mockResolvedValue(undefined),
    },
    mockAnnouncer: {
      install:   vi.fn().mockReturnValue(noop),
      silence:   vi.fn(),
      uninstall: vi.fn(),
    },
    mockButton: {
      setState:         vi.fn(),
      setAriaLabel:     vi.fn(),
      showContextBadge: vi.fn(),
      hideContextBadge: vi.fn(),
      destroy:          vi.fn(),
    },
    mockOverlay: {
      show:             vi.fn(),
      setTranscript:    vi.fn(),
      setResponse:      vi.fn(),
      hide:             vi.fn(),
      showModalContext: vi.fn(),
      showActionResult: vi.fn(),
      destroy:          vi.fn(),
    },
  };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('./audio/AudioCapture.js',  () => ({ AudioCapture:  vi.fn(() => mockAudioCapture) }));
vi.mock('./audio/Transcriber.js',   () => ({ Transcriber:   vi.fn(() => mockTranscriber) }));
vi.mock('./audio/TTSPlayer.js',     () => ({ TTSPlayer:     vi.fn(() => mockTTS) }));
vi.mock('./scanner/DOMScanner.js',  () => ({ DOMScanner:    vi.fn(() => ({ scan: vi.fn() })) }));
vi.mock('./scanner/IntentMapper.js',() => ({
  IntentMapper: vi.fn(() => ({
    buildMap:          mockBuildMap,
    installAutoRescan: mockInstallAutoRescan,
    toPromptString:    vi.fn(() => ''),
  })),
}));
vi.mock('./scanner/RouteDetector.js', () => ({
  RouteDetector: vi.fn(() => ({
    getCurrentRoute: vi.fn(() => '/'),
    getPageName:     vi.fn(() => 'dashboard'),
    onRouteChange:   vi.fn(() => () => undefined),
  })),
}));
vi.mock('./ai/IntentEngine.js', () => ({
  IntentEngine: vi.fn(() => ({
    understand:           mockUnderstand,
    understandWithOpenAI: vi.fn().mockResolvedValue({
      action: 'speak_only', target: null, data: null,
      speak: 'OpenAI reply', confidence: 0.9,
    }),
  })),
}));
vi.mock('./ai/ResponseParser.js', () => ({
  ResponseParser: { clarifyFallback: mockClarifyFallback },
}));
vi.mock('./executor/ActionExecutor.js', () => ({ ActionExecutor: vi.fn(() => ({ execute: mockExecute })) }));
vi.mock('./executor/DOMInteractor.js',  () => ({ DOMInteractor:  vi.fn(() => ({})) }));
vi.mock('./executor/FormFiller.js',     () => ({ FormFiller:     vi.fn(() => ({})) }));
vi.mock('./observer/NetworkObserver.js',() => ({ NetworkObserver: vi.fn(() => mockNetworkObserver) }));
vi.mock('./observer/DOMWatcher.js',     () => ({ DOMWatcher:     vi.fn(() => mockDOMWatcher) }));
vi.mock('./ui/AnnouncerBar.js',  () => ({ AnnouncerBar:  vi.fn(() => mockAnnouncer) }));
vi.mock('./ui/TalkButton.js',    () => ({ TalkButton:    vi.fn(() => mockButton) }));
vi.mock('./ui/VoiceOverlay.js',  () => ({ VoiceOverlay:  vi.fn(() => mockOverlay) }));

// ── Import class under test ───────────────────────────────────────────────────

import { VoiceLayer } from './VoiceLayer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_MAP = {
  currentPage: 'dashboard', currentRoute: '/', focusContext: 'main' as const,
  availableActions: [], openModals: [], activeDropdowns: [],
  toasts: [], visibleData: {}, hiddenActions: [], pageTitle: 'Dashboard',
};

function fireTap(): void {
  window.dispatchEvent(new CustomEvent('voicelayer:tap'));
}

/** Drain N event-loop turns (flushes microtasks + one macrotask each). */
const tick = (n = 1): Promise<void> =>
  Array.from({ length: n }).reduce(
    (p) => (p as Promise<void>).then(() => new Promise<void>((r) => setTimeout(r, 0))),
    Promise.resolve() as Promise<void>,
  );

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('VoiceLayer', () => {
  let vl: VoiceLayer;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Re-apply implementations cleared by clearAllMocks
    mockAudioCapture.requestPermission.mockResolvedValue(true);
    mockAudioCapture.startRecording.mockResolvedValue(undefined);
    mockAudioCapture.stopRecording.mockResolvedValue(
      new Blob(['x'.repeat(2_000)], { type: 'audio/webm' }),
    );
    mockTranscriber.transcribe.mockResolvedValue('aaj ke orders dikhao');
    mockTTS.speak.mockResolvedValue(undefined);
    mockTTS.stop.mockResolvedValue(undefined);
    mockBuildMap.mockReturnValue({ ...DEFAULT_PAGE_MAP });
    mockInstallAutoRescan.mockReturnValue(() => undefined);
    mockNetworkObserver.getFullLog.mockReturnValue([]);
    mockUnderstand.mockResolvedValue({
      action: 'navigate', target: '/orders', data: null,
      speak: 'Navigating to orders', confidence: 0.95,
    });
    mockExecute.mockResolvedValue({
      success: true,
      intent: { action: 'navigate', target: '/orders', data: null, speak: 'Navigating', confidence: 0.9 },
      networkEvents: [],
      domChange: undefined,
    });
    mockClarifyFallback.mockReturnValue({
      action: 'clarify', target: null, data: null, speak: 'No AI.', confidence: 0,
    });
    mockAnnouncer.install.mockReturnValue(() => undefined);

    vl = new VoiceLayer({ anthropicKey: 'sk-ant-test', openaiKey: 'sk-oai-test' });
    await vl.init();
  });

  afterEach(() => {
    try { vl.destroy(); } catch { /* some tests destroy early */ }
  });

  // ── init() ────────────────────────────────────────────────────────────────

  describe('init()', () => {
    it('installs DOMWatcher', () => {
      expect(mockDOMWatcher.install).toHaveBeenCalledOnce();
    });

    it('installs NetworkObserver', () => {
      expect(mockNetworkObserver.install).toHaveBeenCalledOnce();
    });

    it('performs an initial page scan and populates currentPageMap', () => {
      expect(mockBuildMap).toHaveBeenCalled();
      expect(vl.currentPageMap).not.toBeNull();
    });

    it('calls installAutoRescan', () => {
      expect(mockInstallAutoRescan).toHaveBeenCalledOnce();
    });

    it('installs announcer when announce flags are not false', () => {
      expect(mockAnnouncer.install).toHaveBeenCalledOnce();
    });

    it('skips announcer when both announce flags are false', async () => {
      vi.clearAllMocks();
      mockBuildMap.mockReturnValue({ ...DEFAULT_PAGE_MAP });
      mockInstallAutoRescan.mockReturnValue(() => undefined);
      mockAudioCapture.requestPermission.mockResolvedValue(true);

      const vl2 = new VoiceLayer({
        anthropicKey: 'k',
        announceToasts: false,
        announceModals: false,
      });
      await vl2.init();

      expect(mockAnnouncer.install).not.toHaveBeenCalled();
      vl2.destroy();
    });
  });

  // ── Talk-press pipeline (Whisper mode: tap once to start, once to stop) ───

  describe('talk press → pipeline', () => {
    it('transitions button idle → listening → processing → speaking → idle', async () => {
      fireTap();       // start listening
      await tick(4);
      fireTap();       // stop + process
      await tick(20);

      const states = mockButton.setState.mock.calls.map((c) => c[0] as string);
      expect(states).toContain('listening');
      expect(states).toContain('processing');
      expect(states).toContain('speaking');
      expect(states.at(-1)).toBe('idle');
    });

    it('shows Listening status in overlay on first tap', async () => {
      fireTap();
      await tick(3);
      expect(mockOverlay.show).toHaveBeenCalledWith(expect.stringContaining('Listening'));
    });

    it('silences the announcer at the start of each session', async () => {
      fireTap();
      await tick(3);
      expect(mockAnnouncer.silence).toHaveBeenCalled();
    });

    it('calls audioCapture.startRecording', async () => {
      fireTap();
      await tick(4);
      expect(mockAudioCapture.startRecording).toHaveBeenCalled();
    });

    it('calls audioCapture.stopRecording on second tap', async () => {
      fireTap();
      await tick(4);
      fireTap();
      await tick(10);
      expect(mockAudioCapture.stopRecording).toHaveBeenCalled();
    });

    it('passes transcribed text to IntentEngine.understand', async () => {
      fireTap();
      await tick(4);
      fireTap();
      await tick(20);
      expect(mockUnderstand).toHaveBeenCalledWith(
        expect.objectContaining({ transcribedText: 'aaj ke orders dikhao' }),
      );
    });

    it('calls actionExecutor.execute with the resolved intent', async () => {
      fireTap();
      await tick(4);
      fireTap();
      await tick(20);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'navigate' }),
      );
    });

    it('speaks the intent reply via TTSPlayer', async () => {
      fireTap();
      await tick(4);
      fireTap();
      await tick(20);
      expect(mockTTS.speak).toHaveBeenCalledWith('Navigating to orders');
    });

    it('hides overlay after TTS completes', async () => {
      fireTap();
      await tick(4);
      fireTap();
      await tick(20);
      expect(mockOverlay.hide).toHaveBeenCalled();
    });

    it('shows "Didn\'t catch that" when audio blob is too small', async () => {
      mockAudioCapture.stopRecording.mockResolvedValueOnce(
        new Blob(['x'], { type: 'audio/webm' }), // < 1000 bytes
      );

      fireTap();
      await tick(4);
      fireTap();
      await tick(10);

      const showCalls = mockOverlay.show.mock.calls.map((c) => c[0] as string);
      expect(showCalls.some((s) => s.toLowerCase().includes('catch'))).toBe(true);
      // AI should NOT be called for too-small blobs
      expect(mockUnderstand).not.toHaveBeenCalled();
    });
  });

  // ── Modal context hint ────────────────────────────────────────────────────

  describe('modal opened after action', () => {
    it('calls overlay.showModalContext when domChange is modal_opened', async () => {
      mockExecute.mockResolvedValueOnce({
        success: true,
        intent: { action: 'click', target: '#btn', data: null, speak: 'Done', confidence: 1 },
        networkEvents: [],
        domChange: {
          type: 'modal_opened',
          selector: '#modal',
          textContent: 'Add Order',
          timestamp: Date.now(),
        },
      });

      fireTap();
      await tick(4);
      fireTap();
      await tick(20);

      expect(mockOverlay.showModalContext).toHaveBeenCalledWith('Add Order');
    });

    it('does NOT call showModalContext when domChange is content_added', async () => {
      mockExecute.mockResolvedValueOnce({
        success: true,
        intent: { action: 'click', target: '#btn', data: null, speak: 'Done', confidence: 1 },
        networkEvents: [],
        domChange: {
          type: 'content_added',
          selector: '#row',
          textContent: 'New item',
          timestamp: Date.now(),
        },
      });

      fireTap();
      await tick(4);
      fireTap();
      await tick(20);

      expect(mockOverlay.showModalContext).not.toHaveBeenCalled();
    });
  });

  // ── Auto-rescan context badge ─────────────────────────────────────────────

  describe('auto-rescan context badge', () => {
    /** Grab the rescan callback passed to installAutoRescan during init(). */
    function getRescanCb() {
      return mockInstallAutoRescan.mock.calls[0][1] as (map: unknown) => void;
    }

    it('shows "Modal open" badge when open modals are detected', () => {
      getRescanCb()({
        ...DEFAULT_PAGE_MAP,
        focusContext: 'modal' as const,
        openModals: [{
          label: 'Add Order', selector: '#modal',
          elementType: 'modal-trigger', context: 'modal', type: 'click', isDisabled: false,
        }],
      });
      expect(mockButton.showContextBadge).toHaveBeenCalledWith('Modal open');
    });

    it('shows "Dropdown open" badge when active dropdowns are detected', () => {
      getRescanCb()({
        ...DEFAULT_PAGE_MAP,
        activeDropdowns: [{
          label: 'Status', selector: '#dd',
          elementType: 'dropdown-trigger', context: 'main', type: 'click', isDisabled: false,
        }],
      });
      expect(mockButton.showContextBadge).toHaveBeenCalledWith('Dropdown open');
    });

    it('hides badge when no modals or dropdowns are open', () => {
      getRescanCb()({ ...DEFAULT_PAGE_MAP });
      expect(mockButton.hideContextBadge).toHaveBeenCalled();
    });
  });

  // ── destroy() ─────────────────────────────────────────────────────────────

  describe('destroy()', () => {
    it('uninstalls DOMWatcher', () => {
      vl.destroy();
      expect(mockDOMWatcher.uninstall).toHaveBeenCalled();
    });

    it('uninstalls NetworkObserver', () => {
      vl.destroy();
      expect(mockNetworkObserver.uninstall).toHaveBeenCalled();
    });

    it('destroys TalkButton', () => {
      vl.destroy();
      expect(mockButton.destroy).toHaveBeenCalled();
    });

    it('destroys VoiceOverlay', () => {
      vl.destroy();
      expect(mockOverlay.destroy).toHaveBeenCalled();
    });

    it('uninstalls AnnouncerBar', () => {
      vl.destroy();
      expect(mockAnnouncer.uninstall).toHaveBeenCalled();
    });

    it('releases AudioCapture resources', () => {
      vl.destroy();
      expect(mockAudioCapture.destroy).toHaveBeenCalled();
    });
  });
});
