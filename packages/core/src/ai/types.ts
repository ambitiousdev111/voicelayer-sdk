import type { PageIntentMap } from '../scanner/types.js';
import type { NetworkEvent } from '../observer/NetworkObserver.js';

export type { NetworkEvent };

export type ActionType =
  | 'navigate'
  | 'click'
  | 'fill_form'
  | 'speak_only'
  | 'clarify'
  | 'filter'
  | 'focus'
  | 'click_and_wait_modal'
  | 'open_dropdown'
  | 'select_option'
  | 'submit_form'
  | 'close_modal'
  | 'tab'
  | 'accordion'
  | 'scroll'
  | 'key'
  | 'done';  // Agent signals task complete — no further action needed

export interface AIIntent {
  action: ActionType;
  target: string | null;       // route path or CSS selector
  data: Record<string, string> | null;  // for fill_form: { selector: value }
  speak: string;               // what to say back to the user
  confidence: number;          // 0.0 – 1.0
  rawResponse?: string;        // original AI response string (for debugging)
}

export interface IntentRequest {
  transcribedText: string;
  pageMap: PageIntentMap;
  language?: string;           // 'hi' | 'en' | 'auto' (default: 'auto')
  conversationHistory?: { role: 'user' | 'assistant'; content: string }[];
  /** Recent network activity on this page — appended to the LLM prompt for richer context. */
  networkContext?: NetworkEvent[];
}
