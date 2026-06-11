import type { IntentRequest, NetworkEvent, AIIntent } from './types.js';

export interface AgentStep {
  stepNumber: number;
  action: string;
  target: string | null;
  outcome: 'success' | 'failed';
  pageAfter: string;  // page name after the action
}

/**
 * PromptBuilder — assembles the system prompt and per-request user message
 * sent to the LLM.
 *
 * The system prompt is stable (cache-friendly across turns).
 * The user message changes every request.
 */
export class PromptBuilder {
  /**
   * Returns the stable VoiceLayer system prompt.
   * Must be returned verbatim — altering it breaks model behaviour.
   */
  buildSystemPrompt(): string {
    return `You are VoiceLayer, an AI voice assistant embedded inside a web application.
Your job is to understand what the user wants to do and map it to an available action on the current page.

RULES:
1. Only output valid JSON — no markdown, no explanation, no code fences.
2. The action must exist in the availableActions list. Never invent selectors or routes.
3. If the user's intent is unclear or confidence < 0.7, set action to "clarify" and ask a follow-up in speak.
4. The "speak" field must be in the SAME language the user spoke. If they spoke Hindi, respond in Hindi. If Hinglish, respond in Hinglish.
5. Keep "speak" concise — max 2 sentences.
6. For navigate actions, target must be a route path (e.g. "/orders/today").
7. For click/focus/filter actions, target must be the CSS selector from availableActions.
8. For speak_only, target is null.
9. Nav-item elements (context: "navbar" or "sidebar", elementType: "nav-item") are page navigation links — use action "click" with their selector to navigate between pages/sections.
10. Always prefer a matching nav-item over saying the functionality doesn't exist — the user may be asking to switch to a different page.

OUTPUT FORMAT (strict):
{
  "action": "navigate|click|fill_form|speak_only|clarify|filter|focus",
  "target": "/route-or-#selector or null",
  "data": null or { "selector": "value" },
  "speak": "Response in user's language",
  "confidence": 0.85
}`;
  }

  buildUserMessage(request: IntentRequest): string {
    const { pageMap, transcribedText, networkContext } = request;

    const actionsCompact = PromptBuilder.topActions(pageMap.availableActions, transcribedText).map((a) => ({
      id: a.id,
      label: a.label,
      type: a.type,
      elementType: a.elementType,
      context: a.context,
      selector: a.selector,
      target: a.target,
    }));

    let message = `Current page: ${pageMap.currentPage} (${pageMap.currentRoute})

Available actions:
${JSON.stringify(actionsCompact, null, 2)}

Visible data on page:
${JSON.stringify(pageMap.visibleData)}

User said: "${transcribedText}"`;

    if (networkContext && networkContext.length > 0) {
      message += `\n\nRecent API activity on this page:\n${PromptBuilder.formatNetworkContext(networkContext)}`;
    }

    return message;
  }

  // ── Agent loop (ReAct) ─────────────────────────────────────────────────────

  /**
   * System prompt for the ReAct agent loop.
   * Claude acts as a step-by-step agent: Observe → Think → Act → repeat.
   * It emits `done` when the user's goal is fully achieved.
   */
  buildAgentSystemPrompt(): string {
    return `You are VoiceLayer, an AI agent embedded in a web application.
You are executing a multi-step task on behalf of the user. Each turn you see the CURRENT state of the page and decide the single best next action to take.

RULES:
1. Only output valid JSON — no markdown, no explanation, no code fences.
2. Pick exactly ONE action per turn from the availableActions list. Never invent selectors or routes.
3. When the user's goal is fully achieved, output action "done" with a confirmation in "speak".
4. If you're stuck and can't make progress, output action "speak_only" explaining what you found.
5. The "speak" field must be in the SAME language the user originally spoke.
6. Keep "speak" concise — max 1 sentence per intermediate step; 1-2 sentences for "done".
7. Do NOT repeat an action you've already taken in this session (see stepHistory).
8. Semantic matching: "subscription end ho chuka" → look for tabs/filters labelled "Inactive", "Expired", "Churned", "Lapsed". "last payment" → sort headers. "dhundho" → search box.
9. For fill_form actions, "data" must be { "selector": "value to type" }.
10. Confidence < 0.65 → prefer "speak_only" over a wrong click.

AVAILABLE ACTIONS:
  navigate   — go to a route path
  click      — click a button, tab, link, or nav item
  fill_form  — type into an input/search box
  filter     — apply a dropdown or select filter
  focus      — focus an element
  scroll     — scroll the page
  speak_only — just say something, no DOM action
  done       — task complete, speak confirmation

OUTPUT FORMAT (strict JSON):
{
  "action": "navigate|click|fill_form|filter|focus|scroll|speak_only|done",
  "target": "/route or CSS-selector or null",
  "data":   null or { "selector": "value" },
  "speak":  "Response in user's language",
  "confidence": 0.85
}`;
  }

  /**
   * User-turn message for each step of the agent loop.
   * Includes the original transcript, what's been done so far, and current DOM.
   */
  buildAgentStepMessage(
    originalTranscript: string,
    request: IntentRequest,
    stepHistory: AgentStep[],
  ): string {
    const { pageMap, networkContext } = request;

    const actionsCompact = PromptBuilder.topActions(pageMap.availableActions, originalTranscript).map((a) => ({
      id:          a.id,
      label:       a.label,
      type:        a.type,
      elementType: a.elementType,
      context:     a.context,
      selector:    a.selector,
      target:      a.target,
    }));

    const priorTurns = (request.conversationHistory ?? [])
    const convText = priorTurns.length === 0
      ? ''
      : '\nPrior conversation context:\n' +
        priorTurns.map((t) => `  ${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`).join('\n') + '\n'

    const historyText = stepHistory.length === 0
      ? 'None yet — this is the first step.'
      : stepHistory.map((s) =>
          `  Step ${s.stepNumber}: ${s.action} → ${s.target ?? 'null'} [${s.outcome}] → now on "${s.pageAfter}"`
        ).join('\n');

    let message =
`User's original request: "${originalTranscript}"
${convText}
Steps taken so far:
${historyText}

CURRENT PAGE: ${pageMap.currentPage} (${pageMap.currentRoute})

Available actions on this page:
${JSON.stringify(actionsCompact, null, 2)}

Visible data:
${JSON.stringify(pageMap.visibleData)}

Decide the single best NEXT action to make progress toward the user's goal. If the goal is already achieved, use "done".`;

    if (networkContext && networkContext.length > 0) {
      message += `\n\nRecent API calls:\n${PromptBuilder.formatNetworkContext(networkContext)}`;
    }

    return message;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Score and rank page actions by semantic relevance to the transcript.
   * Always keeps navbar/modal elements (navigation context). For the rest,
   * ranks by token overlap with the transcript and returns the top N.
   *
   * This caps the JSON sent to Claude, dramatically reducing token cost on
   * pages with 100+ interactive elements.
   */
  private static topActions(
    actions: import('../scanner/types.js').PageAction[],
    transcript: string,
    maxTotal = 30,
  ): import('../scanner/types.js').PageAction[] {
    if (actions.length <= maxTotal) return actions;

    const words = new Set(
      transcript
        .toLowerCase()
        .replace(/[^\w\sऀ-ॿ]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );

    // Always include navbar / sidebar / modal items — needed for navigation
    const priority = actions.filter(
      (a) => a.context === 'navbar' || a.context === 'sidebar' || a.context === 'modal',
    );

    // Score the rest by label/id overlap with transcript words
    const scored = actions
      .filter((a) => a.context !== 'navbar' && a.context !== 'sidebar' && a.context !== 'modal')
      .map((a) => {
        const haystack = `${a.label ?? ''} ${a.id ?? ''} ${a.selector ?? ''}`.toLowerCase();
        let score = 0;
        for (const w of words) {
          if (haystack.includes(w)) score++;
        }
        // Boost tabs, selects, and search inputs — likely what the user wants
        if (a.elementType === 'tab' || a.elementType === 'select' || a.elementType === 'custom-select') score += 2;
        if (a.elementType === 'search') score += 2;
        return { action: a, score };
      })
      .sort((a, b) => b.score - a.score);

    const slots = Math.max(0, maxTotal - priority.length);
    return [...priority, ...scored.slice(0, slots).map((s) => s.action)];
  }

  private static formatNetworkContext(events: NetworkEvent[]): string {
    return events
      .map((e) => {
        const status = e.status !== undefined ? ` → ${e.status}` : '';
        return `${e.method} ${e.url}${status}`;
      })
      .join('\n');
  }
}
