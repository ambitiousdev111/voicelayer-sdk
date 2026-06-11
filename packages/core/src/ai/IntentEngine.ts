import { VoiceLayerError, ErrorCode } from '../errors.js';
import type { AIIntent, IntentRequest } from './types.js';
import { PromptBuilder } from './PromptBuilder.js';
import type { AgentStep } from './PromptBuilder.js';
import { ResponseParser } from './ResponseParser.js';

const DEFAULT_ANTHROPIC_BASE = 'https://api.anthropic.com';
const DEFAULT_OPENAI_BASE = 'https://api.openai.com';

export interface IntentEngineOptions {
  /**
   * API base URL for Claude. Use a same-origin proxy in the browser
   * (e.g. `/api/anthropic`) — direct calls to api.anthropic.com fail CORS.
   */
  anthropicBaseUrl?: string;
  /** API base URL for OpenAI (e.g. `/api/openai` via dev proxy). */
  openaiBaseUrl?: string;
  /**
   * SDK API key for the VoiceLayer proxy server.
   * Sent as `Authorization: Bearer <sdkApiKey>` on proxy requests.
   * Not needed for direct Anthropic/OpenAI calls.
   */
  sdkApiKey?: string;
}

/**
 * IntentEngine — sends the page context + transcript to an LLM and returns
 * a typed AIIntent describing the action to take.
 *
 * Supports Claude (default) and OpenAI GPT-4o.
 * Falls back to a clarify intent when the AI response cannot be parsed.
 */
export class IntentEngine {
  private readonly promptBuilder = new PromptBuilder();
  private readonly responseParser = new ResponseParser();
  private readonly anthropicBaseUrl: string;
  private readonly openaiBaseUrl: string;
  private readonly sdkApiKey: string | undefined;

  constructor(
    private readonly apiKey: string,
    private readonly model = 'claude-sonnet-4-5',
    options: IntentEngineOptions = {},
  ) {
    this.anthropicBaseUrl = options.anthropicBaseUrl ?? DEFAULT_ANTHROPIC_BASE;
    this.openaiBaseUrl    = options.openaiBaseUrl    ?? DEFAULT_OPENAI_BASE;
    this.sdkApiKey        = options.sdkApiKey;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Resolve a voice request to an AIIntent using Claude.
   *
   * @throws VoiceLayerError(TIMEOUT)   — request took > 8 s
   * @throws VoiceLayerError(API_ERROR) — non-2xx from Claude
   */
  async understand(request: IntentRequest): Promise<AIIntent> {
    const systemPrompt = this.promptBuilder.buildSystemPrompt();
    const userMessage = this.promptBuilder.buildUserMessage(request);

    const messages = IntentEngine.buildMessages(request, userMessage);

    let rawText: string;
    try {
      rawText = await this.fetchClaude(systemPrompt, messages);
    } catch (err) {
      throw err; // Re-throw TIMEOUT / API_ERROR as-is
    }

    // Try parsing; on failure retry ONCE with a simpler message
    try {
      return this.responseParser.parse(rawText, request.pageMap);
    } catch {
      return this.retryClaudeSimple(request, systemPrompt);
    }
  }

  /**
   * Resolve a voice request to an AIIntent using OpenAI GPT-4o.
   *
   * @throws VoiceLayerError(TIMEOUT)   — request took > 8 s
   * @throws VoiceLayerError(API_ERROR) — non-2xx from OpenAI
   */
  async understandWithOpenAI(
    request: IntentRequest,
    openAIKey: string,
  ): Promise<AIIntent> {
    const systemPrompt = this.promptBuilder.buildSystemPrompt();
    const userMessage = this.promptBuilder.buildUserMessage(request);

    let rawText: string;
    try {
      rawText = await this.fetchOpenAI(systemPrompt, request, userMessage, openAIKey);
    } catch (err) {
      throw err;
    }

    try {
      return this.responseParser.parse(rawText, request.pageMap);
    } catch {
      return this.retryOpenAISimple(request, systemPrompt, openAIKey);
    }
  }

  /**
   * One step of the ReAct agent loop.
   * Claude sees the current DOM + step history and picks the next single action.
   */
  async understandAgentStep(
    originalTranscript: string,
    request: IntentRequest,
    stepHistory: AgentStep[],
  ): Promise<AIIntent> {
    const systemPrompt = this.promptBuilder.buildAgentSystemPrompt();
    const userMessage  = this.promptBuilder.buildAgentStepMessage(originalTranscript, request, stepHistory);
    const messages     = [{ role: 'user' as const, content: userMessage }];

    let rawText: string;
    try {
      rawText = await this.fetchClaude(systemPrompt, messages);
    } catch (err) {
      throw err;
    }

    try {
      return this.responseParser.parse(rawText, request.pageMap);
    } catch {
      return ResponseParser.clarifyFallback('Samajh nahi aaya, kya aap dobara bol sakte hain?');
    }
  }

  // ── Claude helpers ─────────────────────────────────────────────────────────

  /**
   * Call Claude with streaming enabled.
   *
   * Uses SSE to receive tokens as they arrive and returns as soon as a
   * complete JSON object is detected via brace-depth tracking — typically
   * 400-600 ms before the full response would be buffered.
   */
  private async fetchClaude(
    system: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);

    const usingProxy = this.anthropicBaseUrl !== DEFAULT_ANTHROPIC_BASE;
    const headers: Record<string, string> = {
      'content-type':      'application/json',
      'x-api-key':         this.apiKey,
      'anthropic-version': '2023-06-01',
    };
    if (!usingProxy) {
      // Direct browser → Anthropic requires this header
      headers['anthropic-dangerous-allow-browser'] = 'true';
    } else if (this.sdkApiKey) {
      // Proxy requires SDK API key as Bearer token
      headers['authorization'] = `Bearer ${this.sdkApiKey}`;
    }

    try {
      const res = await fetch(`${this.anthropicBaseUrl}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model:      this.model,
          max_tokens: 512,
          system,
          messages,
          stream:     true,   // ← SSE streaming
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new VoiceLayerError(
          ErrorCode.API_ERROR,
          `Claude returned ${res.status}: ${body.slice(0, 200)}`,
        );
      }

      if (!res.body) {
        throw new VoiceLayerError(ErrorCode.API_ERROR, 'Claude streaming response has no body');
      }

      return await IntentEngine.consumeAnthropicStream(res.body);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new VoiceLayerError(ErrorCode.TIMEOUT, 'Claude intent resolution timed out');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Consume an Anthropic SSE stream, accumulating `text_delta` chunks.
   *
   * Returns as soon as a complete top-level JSON object is detected using
   * brace-depth tracking — without waiting for the stream to close.
   * This saves 400-600 ms on typical responses.
   */
  private static async consumeAnthropicStream(
    body: ReadableStream<Uint8Array>,
  ): Promise<string> {
    const reader  = body.getReader();
    const decoder = new TextDecoder();

    let lineBuffer  = '';   // partial SSE line carried across read() calls
    let accumulated = '';   // full text built from text_delta events

    // JSON brace-depth tracker for early exit
    let depth       = 0;
    let inString    = false;
    let escape      = false;
    let jsonStarted = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer  = lines.pop() ?? '';   // keep any partial trailing line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') return accumulated.trim();

          let evt: { type: string; delta?: { type: string; text: string } };
          try { evt = JSON.parse(raw); } catch { continue; }

          if (evt.type !== 'content_block_delta' || evt.delta?.type !== 'text_delta') continue;

          const text = evt.delta.text;
          accumulated += text;

          // Track JSON brace depth character-by-character
          for (const ch of text) {
            if (escape)              { escape = false; continue; }
            if (ch === '\\' && inString) { escape = true;  continue; }
            if (ch === '"')          { inString = !inString; continue; }
            if (inString)            continue;
            if      (ch === '{')     { depth++; jsonStarted = true; }
            else if (ch === '}')     { depth--; }
          }

          // Complete JSON object received — cancel the rest of the stream early
          if (jsonStarted && depth === 0) {
            reader.releaseLock();
            body.cancel().catch(() => undefined);
            return accumulated.trim();
          }
        }
      }
    } finally {
      // Ensure lock is released if we exit via exception or normal completion
      try { reader.releaseLock(); } catch { /* already released */ }
    }

    return accumulated.trim();
  }

  private async retryClaudeSimple(
    request: IntentRequest,
    system: string,
  ): Promise<AIIntent> {
    try {
      const rawText = await this.fetchClaude(system, [
        { role: 'user', content: 'Just return a clarify action.' },
      ]);
      return this.responseParser.parse(rawText, request.pageMap);
    } catch {
      return ResponseParser.clarifyFallback();
    }
  }

  // ── OpenAI helpers ─────────────────────────────────────────────────────────

  private async fetchOpenAI(
    system: string,
    request: IntentRequest,
    userMessage: string,
    openAIKey: string,
  ): Promise<string> {
    const history = request.conversationHistory ?? [];
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: system },
      ...history.map((h) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user', content: userMessage },
    ];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);

    const openaiHeaders: Record<string, string> = {
      'content-type': 'application/json',
      authorization:  `Bearer ${openAIKey}`,
    };
    if (this.openaiBaseUrl !== DEFAULT_OPENAI_BASE && this.sdkApiKey) {
      openaiHeaders['authorization'] = `Bearer ${this.sdkApiKey}`;
    }

    try {
      const res = await fetch(`${this.openaiBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: openaiHeaders,
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 512,
          response_format: { type: 'json_object' },
          messages,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new VoiceLayerError(
          ErrorCode.API_ERROR,
          `OpenAI returned ${res.status}: ${body.slice(0, 200)}`,
        );
      }

      const data = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      return data.choices[0]?.message.content ?? '';
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new VoiceLayerError(ErrorCode.TIMEOUT, 'OpenAI intent resolution timed out');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async retryOpenAISimple(
    request: IntentRequest,
    system: string,
    openAIKey: string,
  ): Promise<AIIntent> {
    try {
      const rawText = await this.fetchOpenAI(
        system,
        { ...request, conversationHistory: [] },
        'Just return a clarify action.',
        openAIKey,
      );
      return this.responseParser.parse(rawText, request.pageMap);
    } catch {
      return ResponseParser.clarifyFallback();
    }
  }

  // ── Shared helpers ─────────────────────────────────────────────────────────

  private static buildMessages(
    request: IntentRequest,
    userMessage: string,
  ): { role: 'user' | 'assistant'; content: string }[] {
    const history = (request.conversationHistory ?? []).map((h) => ({
      role: h.role as 'user' | 'assistant',
      content: h.content,
    }));
    return [...history, { role: 'user', content: userMessage }];
  }
}
