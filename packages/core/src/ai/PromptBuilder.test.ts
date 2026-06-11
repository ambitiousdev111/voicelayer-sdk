import { describe, it, expect } from 'vitest';
import { PromptBuilder } from './PromptBuilder.js';
import type { PageIntentMap } from '../scanner/types.js';
import type { IntentRequest } from './types.js';

const builder = new PromptBuilder();

function makeMap(overrides: Partial<PageIntentMap> = {}): PageIntentMap {
  return {
    currentPage: 'Home',
    currentRoute: '/',
    pageTitle: 'Home',
    visibleData: { orders: 5 },
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
    ...overrides,
  };
}

describe('PromptBuilder.buildSystemPrompt', () => {
  it('includes the word "JSON"', () => {
    expect(builder.buildSystemPrompt()).toContain('JSON');
  });

  it('includes all valid action types', () => {
    const prompt = builder.buildSystemPrompt();
    expect(prompt).toContain('navigate');
    expect(prompt).toContain('click');
    expect(prompt).toContain('fill_form');
    expect(prompt).toContain('speak_only');
    expect(prompt).toContain('clarify');
  });

  it('mentions the confidence threshold for clarify', () => {
    expect(builder.buildSystemPrompt()).toContain('0.7');
  });

  it('mentions same-language reply rule', () => {
    expect(builder.buildSystemPrompt()).toContain('SAME language');
  });
});

describe('PromptBuilder.buildUserMessage', () => {
  const map = makeMap();

  it('includes the transcribedText', () => {
    const req: IntentRequest = { transcribedText: 'open my wallet', pageMap: map };
    expect(builder.buildUserMessage(req)).toContain('open my wallet');
  });

  it('includes the current page name', () => {
    const req: IntentRequest = { transcribedText: 'hello', pageMap: map };
    expect(builder.buildUserMessage(req)).toContain('Home');
  });

  it('includes the current route', () => {
    const req: IntentRequest = { transcribedText: 'hello', pageMap: map };
    expect(builder.buildUserMessage(req)).toContain('/');
  });

  it('includes action labels from availableActions', () => {
    const req: IntentRequest = { transcribedText: 'test', pageMap: map };
    expect(builder.buildUserMessage(req)).toContain('Wallet');
  });

  it('includes visible page data', () => {
    const req: IntentRequest = { transcribedText: 'test', pageMap: map };
    expect(builder.buildUserMessage(req)).toContain('orders');
  });

  it('wraps transcribedText in quotes', () => {
    const req: IntentRequest = { transcribedText: 'show balance', pageMap: map };
    const msg = builder.buildUserMessage(req);
    expect(msg).toContain('"show balance"');
  });
});
