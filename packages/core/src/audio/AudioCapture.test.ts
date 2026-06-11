import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioCapture } from './AudioCapture.js';
import { VoiceLayerError, ErrorCode } from '../errors.js';

// ── MediaStream / MediaRecorder fakes ────────────────────────────────────────

/** Minimal fake MediaStreamTrack */
function makeTrack(): MediaStreamTrack {
  return { stop: vi.fn() } as unknown as MediaStreamTrack;
}

/** Minimal fake MediaStream */
function makeStream(): MediaStream {
  const track = makeTrack();
  return {
    getTracks: vi.fn(() => [track]),
    _track: track,
  } as unknown as MediaStream;
}

type RecorderListener = (event: Event | BlobEvent) => void;

/**
 * Controllable fake MediaRecorder.
 *
 * Call `.simulateData(blob)` to fire a 'dataavailable' event,
 * and `.simulateStop()` to fire the 'stop' event after .stop() is called.
 */
class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true);

  mimeType = 'audio/webm';
  private listeners: Map<string, RecorderListener[]> = new Map();

  // Exposed so tests can trigger events
  simulateData(blob: Blob): void {
    const ev = { data: blob } as BlobEvent;
    this.listeners.get('dataavailable')?.forEach((cb) => cb(ev));
  }

  simulateStop(): void {
    const ev = new Event('stop');
    this.listeners.get('stop')?.forEach((cb) => cb(ev));
  }

  // MediaRecorder interface
  start = vi.fn((_timeslice?: number) => {});

  stop = vi.fn(() => {
    // Auto-fire 'stop' on the next microtask, like the real browser does
    Promise.resolve().then(() => this.simulateStop());
  });

  addEventListener = vi.fn((type: string, cb: RecorderListener) => {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(cb);
  });

  removeEventListener = vi.fn();
}

// ── Test setup ────────────────────────────────────────────────────────────────

let fakeRecorder: FakeMediaRecorder;

beforeEach(() => {
  fakeRecorder = new FakeMediaRecorder();

  // Patch global MediaRecorder
  vi.stubGlobal('MediaRecorder', vi.fn(() => fakeRecorder) as unknown as typeof MediaRecorder);
  (MediaRecorder as unknown as { isTypeSupported: ReturnType<typeof vi.fn> }).isTypeSupported =
    FakeMediaRecorder.isTypeSupported;

  // Default: permission granted
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue(makeStream()),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── requestPermission ─────────────────────────────────────────────────────────

describe('AudioCapture.requestPermission()', () => {
  it('returns true when the browser grants mic access', async () => {
    const capture = new AudioCapture();
    const result = await capture.requestPermission();
    expect(result).toBe(true);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it('returns false when the user denies the permission prompt', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(
          Object.assign(new DOMException('Denied'), { name: 'NotAllowedError' }),
        ),
      },
    });

    const capture = new AudioCapture();
    const result = await capture.requestPermission();
    expect(result).toBe(false);
  });

  it('throws BROWSER_NOT_SUPPORTED when getUserMedia is absent', async () => {
    vi.stubGlobal('navigator', { mediaDevices: null });

    const capture = new AudioCapture();
    await expect(capture.requestPermission()).rejects.toMatchObject({
      code: ErrorCode.BROWSER_NOT_SUPPORTED,
    });
  });

  it('throws BROWSER_NOT_SUPPORTED when navigator is undefined', async () => {
    vi.stubGlobal('navigator', undefined);

    const capture = new AudioCapture();
    await expect(capture.requestPermission()).rejects.toMatchObject({
      code: ErrorCode.BROWSER_NOT_SUPPORTED,
    });
  });

  it('throws PERMISSION_DENIED for non-NotAllowedError DOMException', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(
          Object.assign(new DOMException('No mic'), { name: 'NotFoundError' }),
        ),
      },
    });

    const capture = new AudioCapture();
    await expect(capture.requestPermission()).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
    });
  });
});

// ── startRecording ────────────────────────────────────────────────────────────

describe('AudioCapture.startRecording()', () => {
  it('throws PERMISSION_DENIED if called before requestPermission()', async () => {
    const capture = new AudioCapture();
    await expect(capture.startRecording()).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
    });
  });

  it('throws PERMISSION_DENIED if permission was denied (no stream)', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(
          Object.assign(new DOMException('Denied'), { name: 'NotAllowedError' }),
        ),
      },
    });

    const capture = new AudioCapture();
    await capture.requestPermission(); // returns false, no stream stored

    await expect(capture.startRecording()).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
    });
  });

  it('throws ALREADY_RECORDING if called while recording', async () => {
    const capture = new AudioCapture();
    await capture.requestPermission();
    await capture.startRecording();

    await expect(capture.startRecording()).rejects.toMatchObject({
      code: ErrorCode.ALREADY_RECORDING,
    });
  });

  it('sets isRecording = true after a successful start', async () => {
    const capture = new AudioCapture();
    await capture.requestPermission();
    await capture.startRecording();
    expect(capture.isRecording).toBe(true);
  });

  it('calls MediaRecorder.start with a timeslice', async () => {
    const capture = new AudioCapture();
    await capture.requestPermission();
    await capture.startRecording();
    expect(fakeRecorder.start).toHaveBeenCalledWith(expect.any(Number));
  });
});

// ── stopRecording ─────────────────────────────────────────────────────────────

describe('AudioCapture.stopRecording()', () => {
  it('throws NOT_RECORDING if called before startRecording()', async () => {
    const capture = new AudioCapture();
    await expect(capture.stopRecording()).rejects.toMatchObject({
      code: ErrorCode.NOT_RECORDING,
    });
  });

  it('returns a Blob after a successful recording', async () => {
    const capture = new AudioCapture();
    await capture.requestPermission();
    await capture.startRecording();

    // Simulate one audio chunk arriving before stop
    fakeRecorder.simulateData(new Blob(['fake-audio'], { type: 'audio/webm' }));

    const blob = await capture.stopRecording();

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('resets isRecording to false after stopping', async () => {
    const capture = new AudioCapture();
    await capture.requestPermission();
    await capture.startRecording();
    await capture.stopRecording();
    expect(capture.isRecording).toBe(false);
  });

  it('clears chunks so a second recording starts fresh', async () => {
    const capture = new AudioCapture();
    await capture.requestPermission();

    // First recording
    await capture.startRecording();
    fakeRecorder.simulateData(new Blob(['first'], { type: 'audio/webm' }));
    const blob1 = await capture.stopRecording();

    // Second recording — must create a new FakeMediaRecorder instance
    fakeRecorder = new FakeMediaRecorder();
    (MediaRecorder as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => fakeRecorder);

    await capture.startRecording();
    fakeRecorder.simulateData(new Blob(['second-longer-audio'], { type: 'audio/webm' }));
    const blob2 = await capture.stopRecording();

    // blobs should be independent
    expect(blob1.size).not.toBe(blob2.size);
  });
});

// ── destroy ───────────────────────────────────────────────────────────────────

describe('AudioCapture.destroy()', () => {
  it('stops all stream tracks', async () => {
    const stream = makeStream();
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });

    const capture = new AudioCapture();
    await capture.requestPermission();
    capture.destroy();

    const [track] = stream.getTracks();
    expect((track as unknown as { stop: ReturnType<typeof vi.fn> }).stop).toHaveBeenCalled();
  });

  it('is idempotent — safe to call multiple times', async () => {
    const capture = new AudioCapture();
    await capture.requestPermission();
    expect(() => {
      capture.destroy();
      capture.destroy();
    }).not.toThrow();
  });

  it('sets isRecording to false', async () => {
    const capture = new AudioCapture();
    await capture.requestPermission();
    await capture.startRecording();
    capture.destroy();
    expect(capture.isRecording).toBe(false);
  });
});

// ── VoiceLayerError shape ─────────────────────────────────────────────────────

describe('VoiceLayerError', () => {
  it('has the correct name, code, and instanceof', async () => {
    vi.stubGlobal('navigator', { mediaDevices: null });
    const capture = new AudioCapture();

    try {
      await capture.requestPermission();
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(VoiceLayerError);
      expect(err).toBeInstanceOf(Error);
      expect((err as VoiceLayerError).name).toBe('VoiceLayerError');
      expect((err as VoiceLayerError).code).toBe(ErrorCode.BROWSER_NOT_SUPPORTED);
    }
  });
});
