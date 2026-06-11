import { describe, it, expect, vi, afterEach } from 'vitest';
import { IntentEngine } from './IntentEngine.js';
import { ErrorCode } from '../errors.js';
import type { PageIntentMap } from '../scanner/types.js';
import type { IntentRequest } from './types.js';

afterEach(() => vi.unstubAllGlobals());

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMap(): PageIntentMap {
  return {
    currentPage: 'Demo',
    currentRoute: '/',
    pageTitle: 'Demo',
    visibleData: {},
    scannedAt: Date.now(),
    availableActions: [
      {
        id: 'action_0',
        label: 'Wallet',
        type: 'navigate',
        selector: 'a[href="/wallet"]',
        target: '/wallet',
        isVisible: true,
      },
    ],
  };
}

function makeRequest(text: string): IntentRequest {
  return { transcribedText: text, pageMap: makeMap() };
}

function claudeOkResponse(intentJSON: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({
      content: [{ type: 'text', text: JSON.stringify(intentJSON) }],
    }),
    text: async () => '',
  };
}

function openAIOkResponse(intentJSON: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(intentJSON) } }],
    }),
    text: async () => '',
  };
}

const VALID_NAVIGATE = {
  action: 'navigate',
  target: '/wallet',
  data: null,
  speak: 'Navigating to wallet.',
  confidence: 0.95,
};

// ── Claude path ────────────────────────────────────────────────────────────

describe('IntentEngine.understand — Claude', () => {
  it('returns a parsed AIIntent on a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(claudeOkResponse(VALID_NAVIGATE)));
    const engine = new IntentEngine('sk-test');
    const result = await engine.understand(makeRequest('open wallet'));

    expect(result.action).toBe('navigate');
    expect(result.target).toBe('/wallet');
    expect(result.speak).toBe('Navigating to wallet.');
    expect(result.confidence).toBe(0.95);
  });

  it('sends x-api-key and anthropic-version headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue(claudeOkResponse(VALID_NAVIGATE));
    vi.stubGlobal('fetch', mockFetch);
    const engine = new IntentEngine('my-api-key');
    await engine.understand(makeRequest('open wallet'));

    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('my-api-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('throws TIMEOUT when fetch is aborted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValueOnce(
        Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }),
      ),
    );
    const engine = new IntentEngine('sk-test');
    await expect(engine.understand(makeRequest('test'))).rejects.toMatchObject({
      code: ErrorCode.TIMEOUT,
    });
  });

  it('throws API_ERROR on non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    }));
    const engine = new IntentEngine('bad-key');
    await expect(engine.understand(makeRequest('test'))).rejects.toMatchObject({
      code: ErrorCode.API_ERROR,
    });
  });

  it('retries with simple message when parser fails, returns clarify on double failure', async () => {
    const badResponse = { ok: true, json: async () => ({ content: [{ type: 'text', text: 'NOT JSON' }] }), text: async () => '' };
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(badResponse)   // first attempt — parse fails
      .mockResolvedValueOnce(badResponse);  // retry — parse fails again

    vi.stubGlobal('fetch', mockFetch);
    const engine = new IntentEngine('sk-test');
    const result = await engine.understand(makeRequest('test'));

    // Should not throw — should return clarify fallback
    expect(result.action).toBe('clarify');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('uses conversationHistory in messages array', async () => {
    const mockFetch = vi.fn().mockResolvedValue(claudeOkResponse(VALID_NAVIGATE));
    vi.stubGlobal('fetch', mockFetch);
    const engine = new IntentEngine('sk-test');

    await engine.understand({
      ...makeRequest('follow up'),
      conversationHistory: [
        { role: 'user', content: 'previous message' },
        { role: 'assistant', content: 'previous reply' },
      ],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages[0].content).toBe('previous message');
    expect(body.messages[1].content).toBe('previous reply');
    expect(body.messages).toHaveLength(3);
  });
});

// ── OpenAI path ────────────────────────────────────────────────────────────

describe('IntentEngine.understandWithOpenAI', () => {
  it('returns a parsed AIIntent from OpenAI', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(openAIOkResponse(VALID_NAVIGATE)));
    const engine = new IntentEngine('sk-claude');
    const result = await engine.understandWithOpenAI(makeRequest('open wallet'), 'sk-openai');

    expect(result.action).toBe('navigate');
    expect(result.speak).toBe('Navigating to wallet.');
  });

  it('sends Bearer auth header for OpenAI', async () => {
    const mockFetch = vi.fn().mockResolvedValue(openAIOkResponse(VALID_NAVIGATE));
    vi.stubGlobal('fetch', mockFetch);
    const engine = new IntentEngine('sk-claude');
    await engine.understandWithOpenAI(makeRequest('open wallet'), 'my-openai-key');

    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer my-openai-key');
  });

  it('sends response_format json_object to OpenAI', async () => {
    const mockFetch = vi.fn().mockResolvedValue(openAIOkResponse(VALID_NAVIGATE));
    vi.stubGlobal('fetch', mockFetch);
    const engine = new IntentEngine('sk-claude');
    await engine.understandWithOpenAI(makeRequest('test'), 'sk-openai');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
      response_format: { type: string };
    };
    expect(body.response_format.type).toBe('json_object');
  });

  it('throws TIMEOUT when OpenAI fetch is aborted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValueOnce(
        Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }),
      ),
    );
    const engine = new IntentEngine('sk-claude');
    await expect(
      engine.understandWithOpenAI(makeRequest('test'), 'sk-openai'),
    ).rejects.toMatchObject({ code: ErrorCode.TIMEOUT });
  });

  it('throws API_ERROR on non-200 OpenAI response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Rate limit exceeded',
    }));
    const engine = new IntentEngine('sk-claude');
    await expect(
      engine.understandWithOpenAI(makeRequest('test'), 'sk-openai'),
    ).rejects.toMatchObject({ code: ErrorCode.API_ERROR });
  });
});
