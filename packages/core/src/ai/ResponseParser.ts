import { VoiceLayerError, ErrorCode } from '../errors.js';
import type { PageIntentMap } from '../scanner/types.js';
import type { AIIntent, ActionType } from './types.js';

const VALID_ACTIONS = new Set<ActionType>([
  'navigate',
  'click',
  'fill_form',
  'speak_only',
  'clarify',
  'filter',
  'focus',
]);

/**
 * ResponseParser — converts a raw LLM text response into a typed, validated AIIntent.
 *
 * Defences:
 *  - Strips markdown code fences
 *  - Validates required fields and enum values
 *  - Verifies navigate/click targets exist in the page map
 *  - Clamps confidence to [0, 1]
 */
export class ResponseParser {
  /**
   * Parse `rawText` (the LLM's output) into a typed AIIntent.
   *
   * @param rawText  — raw string from the LLM
   * @param pageMap  — current page snapshot; used to validate action targets
   * @throws VoiceLayerError(API_ERROR) when JSON is missing or malformed
   */
  parse(rawText: string, pageMap: PageIntentMap): AIIntent {
    // 1. Strip markdown code fences
    const json = ResponseParser.extractJSON(rawText);

    // 2. Parse JSON
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(json) as Record<string, unknown>;
    } catch (err) {
      throw new VoiceLayerError(
        ErrorCode.API_ERROR,
        `Invalid JSON from AI: ${json.slice(0, 120)}`,
        err,
      );
    }

    // 3. Validate shape — fall back gracefully rather than throwing for bad fields
    const rawAction = parsed['action'];
    const action: ActionType =
      typeof rawAction === 'string' && VALID_ACTIONS.has(rawAction as ActionType)
        ? (rawAction as ActionType)
        : 'clarify';

    const speak =
      typeof parsed['speak'] === 'string' && parsed['speak'].trim()
        ? parsed['speak']
        : "I didn't understand that. Could you try again?";

    // 4. Clamp confidence to [0, 1]; default to 0.5
    const rawConf = parsed['confidence'];
    const confidence =
      typeof rawConf === 'number' ? Math.max(0, Math.min(1, rawConf)) : 0.5;

    const target =
      typeof parsed['target'] === 'string' && parsed['target'] !== 'null'
        ? parsed['target']
        : null;

    const rawData = parsed['data'];
    const data: Record<string, string> | null =
      rawData &&
      typeof rawData === 'object' &&
      !Array.isArray(rawData) &&
      rawData !== null
        ? (rawData as Record<string, string>)
        : null;

    // 5. For actions that target DOM elements, verify the target exists in the page map.
    //    navigate targets are route paths — they don't appear as CSS selectors in the
    //    page map, so we skip selector-validation for them and let the executor handle routing.
    let resolvedAction = action;
    let resolvedSpeak = speak;

    if (action === 'click' || action === 'focus' || action === 'filter') {
      if (!target) {
        resolvedAction = 'clarify';
        resolvedSpeak = "I couldn't find that on this page.";
      } else {
        const allActions = [
          ...pageMap.availableActions,
          ...(pageMap.hiddenActions ?? []),
          ...(pageMap.openModals ?? []),
        ];
        const found = allActions.some(
          (a) => a.selector === target || a.target === target,
        );
        if (!found) {
          resolvedAction = 'clarify';
          resolvedSpeak = "I couldn't find that on this page.";
        }
      }
    } else if (action === 'navigate') {
      // navigate only needs a non-empty target — executor handles routing
      if (!target) {
        resolvedAction = 'clarify';
        resolvedSpeak = "I couldn't find that on this page.";
      }
    }

    // 6. Return typed AIIntent with rawResponse attached for debugging
    return {
      action: resolvedAction,
      target,
      data,
      speak: resolvedSpeak,
      confidence,
      rawResponse: rawText,
    };
  }

  // ── Static helpers ─────────────────────────────────────────────────────────

  /**
   * Extract the first well-formed JSON object from a raw LLM string.
   * Handles markdown code fences like ```json { ... } ```.
   */
  private static extractJSON(raw: string): string {
    // Strip markdown code fences
    const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
    if (fenceMatch?.[1]) return fenceMatch[1].trim();

    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1 || start >= end) {
      throw new VoiceLayerError(
        ErrorCode.API_ERROR,
        `No JSON object found in AI response: "${raw.slice(0, 120)}"`,
      );
    }
    return raw.slice(start, end + 1);
  }

  /** Safe fallback intent — used by IntentEngine when all retries fail. */
  static clarifyFallback(speak = "I didn't understand that. Could you try again?"): AIIntent {
    return {
      action: 'clarify',
      target: null,
      data: null,
      speak,
      confidence: 0,
    };
  }
}
