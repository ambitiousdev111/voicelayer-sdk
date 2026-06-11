import type { IntentRequest } from '../ai/types.js';
import type { NetworkEvent } from '../observer/NetworkObserver.js';
import type { PageIntentMap } from '../scanner/types.js';

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * ConversationManager — tracks multi-turn conversation history so the LLM
 * has context from previous exchanges in the same session.
 *
 * Also assembles IntentRequest objects, combining the transcript, live page
 * map, conversation history, and optional network context into one cohesive
 * payload ready for IntentEngine.understand().
 *
 * Usage:
 *   const mgr = new ConversationManager();
 *   const req = mgr.buildRequest(transcript, pageMap, networkEvents);
 *   const intent = await engine.understand(req);
 *   mgr.addTurn(transcript, intent.speak);
 */
export class ConversationManager {
  private history: Turn[] = [];

  constructor(
    /** Maximum number of user+assistant turn-pairs to keep in history. */
    private readonly maxTurns = 10,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Build a complete `IntentRequest` for the current voice turn.
   *
   * @param transcribedText — final STT transcript
   * @param pageMap         — fresh scan from IntentMapper
   * @param networkContext  — recent fetch/XHR activity (from NetworkObserver)
   */
  buildRequest(
    transcribedText: string,
    pageMap: PageIntentMap,
    networkContext?: NetworkEvent[],
  ): IntentRequest {
    return {
      transcribedText,
      pageMap,
      conversationHistory: this.history.length > 0 ? [...this.history] : undefined,
      networkContext: networkContext && networkContext.length > 0 ? networkContext : undefined,
    };
  }

  /**
   * Record a completed turn.
   * Call this after the assistant has replied so the next turn has full context.
   */
  addTurn(userText: string, assistantReply: string): void {
    this.history.push({ role: 'user', content: userText });
    this.history.push({ role: 'assistant', content: assistantReply });

    // Keep only the most recent maxTurns pairs (2 messages per pair)
    if (this.history.length > this.maxTurns * 2) {
      this.history = this.history.slice(-this.maxTurns * 2);
    }
  }

  /** Clear all history — call between independent user sessions. */
  reset(): void {
    this.history = [];
  }

  /** Number of completed user+assistant turn pairs. */
  get turnCount(): number {
    return Math.floor(this.history.length / 2);
  }

  /** Read-only snapshot of the current history array. */
  getHistory(): Turn[] {
    return [...this.history];
  }
}
