import { describe, it, expect } from 'vitest';
import { ResponseParser } from './ResponseParser.js';
import { VoiceLayerError, ErrorCode } from '../errors.js';
import type { PageIntentMap } from '../scanner/types.js';

const parser = new ResponseParser();

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMap(overrides: Partial<PageIntentMap> = {}): PageIntentMap {
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
      {
        id: 'action_1',
        label: 'Find Tiffin',
        type: 'click',
        selector: '#find-tiffin',
        isVisible: true,
      },
    ],
    ...overrides,
  };
}

function validResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    action: 'navigate',
    target: '/wallet',
    data: null,
    speak: 'Navigating to wallet.',
    confidence: 0.9,
    ...overrides,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ResponseParser.parse — valid input', () => {
  it('parses a valid navigate response', () => {
    const result = parser.parse(validResponse(), makeMap());
    expect(result.action).toBe('navigate');
    expect(result.target).toBe('/wallet');
    expect(result.speak).toBe('Navigating to wallet.');
    expect(result.confidence).toBe(0.9);
    expect(result.rawResponse).toContain('navigate');
  });

  it('parses a click response with selector target', () => {
    const raw = validResponse({ action: 'click', target: '#find-tiffin', speak: 'Clicking button.' });
    const result = parser.parse(raw, makeMap());
    expect(result.action).toBe('click');
    expect(result.target).toBe('#find-tiffin');
  });

  it('parses speak_only with null target', () => {
    const raw = validResponse({ action: 'speak_only', target: null, speak: 'You have 5 orders.' });
    const result = parser.parse(raw, makeMap());
    expect(result.action).toBe('speak_only');
    expect(result.target).toBeNull();
  });

  it('parses fill_form with data', () => {
    const raw = validResponse({
      action: 'fill_form',
      target: null,
      data: { '#name': 'Vardaan', '#city': 'Delhi' },
      speak: 'Filling in the form.',
    });
    const result = parser.parse(raw, makeMap());
    expect(result.action).toBe('fill_form');
    expect(result.data).toEqual({ '#name': 'Vardaan', '#city': 'Delhi' });
  });

  it('strips markdown code fences before parsing', () => {
    const raw = '```json\n' + validResponse() + '\n```';
    const result = parser.parse(raw, makeMap());
    expect(result.action).toBe('navigate');
  });

  it('extracts JSON from surrounding prose', () => {
    const raw = 'Here is my response: ' + validResponse() + ' Hope that helps!';
    const result = parser.parse(raw, makeMap());
    expect(result.action).toBe('navigate');
  });
});

describe('ResponseParser.parse — confidence clamping', () => {
  it('clamps confidence > 1 down to 1', () => {
    const result = parser.parse(validResponse({ confidence: 1.5 }), makeMap());
    expect(result.confidence).toBe(1);
  });

  it('clamps confidence < 0 up to 0', () => {
    const result = parser.parse(validResponse({ confidence: -0.3 }), makeMap());
    expect(result.confidence).toBe(0);
  });

  it('defaults to 0.5 when confidence is missing', () => {
    const obj = JSON.parse(validResponse()) as Record<string, unknown>;
    delete obj['confidence'];
    expect(parser.parse(JSON.stringify(obj), makeMap()).confidence).toBe(0.5);
  });
});

describe('ResponseParser.parse — invalid input', () => {
  it('throws API_ERROR when input has no JSON', () => {
    expect(() => parser.parse('not json at all', makeMap())).toThrow(
      expect.objectContaining({ code: ErrorCode.API_ERROR }),
    );
  });

  it('throws API_ERROR for malformed JSON', () => {
    expect(() => parser.parse('{ broken json: [', makeMap())).toThrow(
      expect.objectContaining({ code: ErrorCode.API_ERROR }),
    );
  });

  it('falls back to clarify when action is not a valid ActionType', () => {
    const raw = validResponse({ action: 'DANCE' });
    const result = parser.parse(raw, makeMap());
    expect(result.action).toBe('clarify');
  });

  it('allows navigate with a non-empty target even when not in pageMap (routes are not DOM selectors)', () => {
    // navigate targets are route paths (/orders, #dashboard) — they are never
    // CSS selectors in availableActions, so we intentionally skip page-map
    // validation for them and let the executor handle routing.
    const raw = validResponse({ action: 'navigate', target: '/secret-route' });
    const result = parser.parse(raw, makeMap());
    expect(result.action).toBe('navigate');
    expect(result.target).toBe('/secret-route');
  });

  it('falls back to clarify when click target selector is not in pageMap', () => {
    const raw = validResponse({ action: 'click', target: '#ghost-button' });
    const result = parser.parse(raw, makeMap());
    expect(result.action).toBe('clarify');
  });

  it('falls back to clarify when navigate target is null', () => {
    const raw = validResponse({ action: 'navigate', target: null });
    const result = parser.parse(raw, makeMap());
    expect(result.action).toBe('clarify');
  });
});

describe('ResponseParser.clarifyFallback', () => {
  it('returns a valid clarify AIIntent', () => {
    const fb = ResponseParser.clarifyFallback();
    expect(fb.action).toBe('clarify');
    expect(fb.target).toBeNull();
    expect(fb.confidence).toBe(0);
  });

  it('uses custom speak message when provided', () => {
    const fb = ResponseParser.clarifyFallback('Custom message.');
    expect(fb.speak).toBe('Custom message.');
  });
});
