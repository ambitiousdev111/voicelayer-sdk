import type { PageIntentMap, PageAction } from './types.js';
import type { DOMWatcher } from '../observer/DOMWatcher.js';
import { DOMScanner } from './DOMScanner.js';
import { RouteDetector } from './RouteDetector.js';

/** Prompt character budget — drop optional sections before truncating hard. */
const PROMPT_LIMIT = 3000;

/**
 * IntentMapper — the bridge between a raw page scan and the AI prompt.
 *
 * Responsibilities:
 * 1. Orchestrate DOMScanner + RouteDetector into a single `PageIntentMap`.
 * 2. Provide `toPromptString()` — a human-readable, AI-optimised representation
 *    of the current page state.
 * 3. `installAutoRescan()` — debounced DOM-change listener for always-fresh maps.
 */
export class IntentMapper {
  constructor(
    private readonly scanner: DOMScanner,
    private readonly routeDetector: RouteDetector,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Build a fresh `PageIntentMap` by scanning the current page.
   */
  buildMap(): PageIntentMap {
    const map = this.scanner.scan();

    return {
      ...map,
      currentRoute: this.routeDetector.getCurrentRoute(),
      currentPage: IntentMapper.derivePageName(map, this.routeDetector),
    };
  }

  /**
   * Serialise a `PageIntentMap` to a structured, human-readable string that
   * fits comfortably in an LLM system prompt.
   *
   * Section priority (dropped first → last when approaching PROMPT_LIMIT):
   *   hidden actions → footer actions → rest
   */
  toPromptString(map: PageIntentMap): string {
    const CONTEXT_ORDER: Array<PageAction['context']> = [
      'navbar', 'modal', 'main', 'sidebar', 'floating', 'unknown',
    ];

    const lines: string[] = [];

    // ── Header ───────────────────────────────────────────────────────────────
    lines.push(`=== PAGE: ${map.currentPage} (${map.currentRoute}) ===`);
    lines.push(`FOCUS CONTEXT: ${map.focusContext}`);
    lines.push('');

    // ── Open modals ───────────────────────────────────────────────────────────
    lines.push('--- OPEN MODALS ---');
    if (map.openModals.length > 0) {
      for (const a of map.openModals) {
        lines.push(`[${a.elementType}] "${a.label}" → ${a.selector}`);
      }
    } else {
      lines.push('none');
    }
    lines.push('');

    // ── Active dropdowns ──────────────────────────────────────────────────────
    lines.push('--- ACTIVE DROPDOWNS ---');
    if (map.activeDropdowns.length > 0) {
      for (const a of map.activeDropdowns) {
        const opts = a.options?.length
          ? ` (options: ${a.options.slice(0, 5).join(', ')})`
          : '';
        lines.push(`[${a.elementType}] "${a.label}" → ${a.selector}${opts}`);
      }
    } else {
      lines.push('none');
    }
    lines.push('');

    // ── Toasts ────────────────────────────────────────────────────────────────
    lines.push('--- TOASTS ---');
    lines.push(map.toasts.length > 0 ? map.toasts.join(' | ') : 'none');
    lines.push('');

    // ── Main actions — grouped by context (footer handled separately) ─────────
    lines.push('--- MAIN ACTIONS ---');
    const byContext = IntentMapper.groupByContext(map.availableActions);

    for (const ctx of CONTEXT_ORDER) {
      const group = byContext.get(ctx);
      if (!group?.length) continue;
      lines.push(`[${ctx.toUpperCase()}]`);
      for (const a of group) {
        lines.push(IntentMapper.formatAction(a));
      }
    }
    lines.push('');

    // ── Visible data ──────────────────────────────────────────────────────────
    const dataEntries = Object.entries(map.visibleData);
    if (dataEntries.length > 0) {
      lines.push('--- VISIBLE DATA ---');
      for (const [k, v] of dataEntries) {
        lines.push(`${k}: ${v}`);
      }
      lines.push('');
    }

    // ── Build result; then try appending optional sections ────────────────────
    let result = lines.join('\n');

    // Optional: footer actions
    const footerGroup = byContext.get('footer');
    if (footerGroup?.length) {
      const footerStr = [
        '[FOOTER]',
        ...footerGroup.map((a) => IntentMapper.formatAction(a)),
        '',
      ].join('\n');
      if (result.length + footerStr.length <= PROMPT_LIMIT) {
        result = result + footerStr;
      }
    }

    // Optional: hidden actions summary
    if (map.hiddenActions.length > 0) {
      const hiddenLines = [
        '--- HIDDEN ACTIONS (appear after interaction) ---',
        ...map.hiddenActions
          .slice(0, 5)
          .map((a) => `[${a.elementType}] "${a.label}" → ${a.selector}`),
        '',
      ].join('\n');

      if (result.length + hiddenLines.length <= PROMPT_LIMIT) {
        result += '\n' + hiddenLines;
      } else {
        const compact = `\n--- HIDDEN ACTIONS ---\n${map.hiddenActions.length} hidden elements\n`;
        if (result.length + compact.length <= PROMPT_LIMIT) {
          result += compact;
        }
      }
    }

    // Hard truncate if still over budget
    if (result.length > PROMPT_LIMIT) {
      result = result.slice(0, PROMPT_LIMIT - 3) + '...';
    }

    return result;
  }

  /**
   * Install a debounced listener that rebuilds the `PageIntentMap` whenever
   * the DOM changes and calls `onRescan` with the fresh map.
   *
   * Useful for keeping the map current after modals open, navigation events,
   * dynamic content loads, etc.
   *
   * @param watcher   — an already-installed DOMWatcher instance
   * @param onRescan  — called with the new map after each debounced change
   * @returns         — unsubscribe function; call to stop auto-rescanning
   */
  installAutoRescan(
    watcher: DOMWatcher,
    onRescan: (map: PageIntentMap) => void,
  ): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const unsub = watcher.onChange(() => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onRescan(this.buildMap());
      }, 150);
    });

    return () => {
      unsub();
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private static derivePageName(map: PageIntentMap, route: RouteDetector): string {
    if (map.currentPage && map.currentPage !== map.pageTitle) {
      return map.currentPage;
    }
    if (map.pageTitle) return map.pageTitle;
    return route.getPageName();
  }

  private static groupByContext(
    actions: PageAction[],
  ): Map<PageAction['context'], PageAction[]> {
    const map = new Map<PageAction['context'], PageAction[]>();
    for (const a of actions) {
      const arr = map.get(a.context) ?? [];
      arr.push(a);
      map.set(a.context, arr);
    }
    return map;
  }

  /**
   * Format a single PageAction as a compact prompt line.
   *
   * Pattern: `  [{elementType}|{context}] "{label}" → {type}:{selector|target} {flags}`
   */
  private static formatAction(a: PageAction): string {
    const disabled = a.isDisabled ? ' (DISABLED)' : '';
    const value = a.currentValue ? ` [val:${a.currentValue}]` : '';
    const opts = a.options?.length
      ? ` (${a.options.slice(0, 5).join('/')})`
      : '';
    const dest = a.target ? `navigate:${a.target}` : `${a.type}:${a.selector}`;
    return `  [${a.elementType}|${a.context}] "${a.label}" → ${dest}${disabled}${value}${opts}`;
  }
}
