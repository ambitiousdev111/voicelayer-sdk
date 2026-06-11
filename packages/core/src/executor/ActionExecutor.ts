import type { AIIntent } from '../ai/types.js';
import type { DOMChangeEvent } from '../observer/DOMWatcher.js';
import type { NetworkEvent } from '../observer/NetworkObserver.js';
import type { DOMWatcher } from '../observer/DOMWatcher.js';
import type { NetworkObserver } from '../observer/NetworkObserver.js';
import { DOMInteractor } from './DOMInteractor.js';
import { FormFiller } from './FormFiller.js';

export interface ExecutionResult {
  success: boolean;
  intent: AIIntent;
  error?: Error;
  /**
   * Network events captured between action start and completion.
   * Only populated when at least one request was made.
   */
  networkEvents?: NetworkEvent[];
  /**
   * The first classified DOM change observed after the action fired
   * (modal, toast, dropdown, etc.).  Populated when the action touches
   * the DOM and a change is observed within 1 500 ms.
   */
  domChange?: DOMChangeEvent;
}

/**
 * ActionExecutor — dispatches a resolved AIIntent to the correct DOM operation,
 * wraps a NetworkObserver capture around it, and optionally awaits DOM feedback.
 *
 * Lifecycle events emitted on `window`:
 *  - `voicelayer:action:start`   — fired before execution begins
 *  - `voicelayer:action:success` — fired on successful completion
 *  - `voicelayer:action:error`   — fired on failure
 */
export class ActionExecutor {
  constructor(
    private readonly interactor: DOMInteractor,
    private readonly filler: FormFiller,
    private readonly networkObserver: NetworkObserver,
    private readonly watcher: DOMWatcher,
  ) {}

  /**
   * Execute a resolved AIIntent.
   *
   * Starts a NetworkObserver capture session for the duration of the action,
   * then waits up to 1 500 ms for a DOM change when the action is DOM-touching.
   */
  async execute(intent: AIIntent): Promise<ExecutionResult> {
    this.emit('voicelayer:action:start', { intent });
    this.networkObserver.startCapture();

    try {
      let domChange: DOMChangeEvent | undefined;

      switch (intent.action) {
        // ── Navigation ──────────────────────────────────────────────────────
        case 'navigate':
          if (intent.target) this.interactor.navigate(intent.target);
          break;

        // ── Click / Filter ───────────────────────────────────────────────────
        case 'click':
        case 'filter':
          if (intent.target) {
            this.interactor.scroll(intent.target);
            this.interactor.click(intent.target);
          }
          break;

        // ── Focus ────────────────────────────────────────────────────────────
        case 'focus':
          if (intent.target) {
            this.interactor.scroll(intent.target);
            this.interactor.focus(intent.target);
          }
          break;

        // ── Form fill ────────────────────────────────────────────────────────
        case 'fill_form':
          if (intent.data) this.filler.fill(intent.data);
          break;

        // ── Click + wait for modal ───────────────────────────────────────────
        case 'click_and_wait_modal':
          if (intent.target) {
            this.interactor.scroll(intent.target);
            domChange = await this.interactor
              .clickAndWaitForModal(intent.target)
              .catch(() => undefined);
          }
          break;

        // ── Dropdown ─────────────────────────────────────────────────────────
        case 'open_dropdown':
          if (intent.target) this.interactor.openDropdown(intent.target);
          break;

        // ── Select option (from dropdown or <select>) ─────────────────────────
        case 'select_option': {
          const optionValue = intent.data?.value ?? intent.data?.text ?? '';
          if (intent.target && optionValue) {
            await this.interactor
              .selectFromDropdown(intent.target, optionValue)
              .catch(() => {
                // Fall back to native <select> if no custom dropdown found
                if (intent.target && optionValue) {
                  this.interactor.selectOption(intent.target, optionValue);
                }
              });
          }
          break;
        }

        // ── Submit form ──────────────────────────────────────────────────────
        case 'submit_form':
          if (intent.target) {
            this.interactor.scroll(intent.target);
            this.interactor.click(intent.target);
          }
          break;

        // ── Close modal ──────────────────────────────────────────────────────
        case 'close_modal':
          this.interactor.closeModal();
          break;

        // ── Tab ──────────────────────────────────────────────────────────────
        case 'tab':
          if (intent.target) {
            this.interactor.scroll(intent.target);
            this.interactor.clickTab(intent.target);
          }
          break;

        // ── Accordion ────────────────────────────────────────────────────────
        case 'accordion':
          if (intent.target) {
            this.interactor.scroll(intent.target);
            this.interactor.clickAccordion(intent.target);
          }
          break;

        // ── Scroll ───────────────────────────────────────────────────────────
        case 'scroll':
          if (intent.target) {
            this.interactor.scroll(intent.target);
          } else if (intent.data?.direction) {
            this.interactor.scrollBy(
              intent.data.direction as 'up' | 'down' | 'left' | 'right',
              intent.data.amount !== undefined
                ? Number(intent.data.amount)
                : undefined,
            );
          }
          break;

        // ── Key press ────────────────────────────────────────────────────────
        case 'key':
          if (intent.data?.key) {
            this.interactor.keyPress(
              intent.data.key,
              intent.target ?? undefined,
            );
          }
          break;

        // ── Speak only / Clarify ─────────────────────────────────────────────
        case 'speak_only':
        case 'clarify':
          // No DOM side effect — the `speak` field carries the content
          break;
      }

      // For DOM-touching actions that didn't already resolve a domChange,
      // wait a short window for a toast, modal, or dropdown to appear.
      if (domChange === undefined && ActionExecutor.shouldObserve(intent.action)) {
        domChange = await this.watcher
          .waitForChange(
            ['modal_opened', 'toast', 'dropdown_opened', 'content_added'],
            1_500,
          )
          .catch(() => undefined);
      }

      const networkEvents = this.networkObserver.stopCapture();
      const result: ExecutionResult = {
        success: true,
        intent,
        domChange,
        networkEvents: networkEvents.length > 0 ? networkEvents : undefined,
      };
      this.emit('voicelayer:action:success', result);
      return result;
    } catch (error) {
      this.networkObserver.stopCapture();
      const result: ExecutionResult = {
        success: false,
        intent,
        error: error instanceof Error ? error : new Error(String(error)),
      };
      this.emit('voicelayer:action:error', result);
      return result;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Only wait for post-action DOM changes on actions that touch the DOM. */
  private static shouldObserve(action: AIIntent['action']): boolean {
    return (
      action === 'click' ||
      action === 'navigate' ||
      action === 'filter' ||
      action === 'focus' ||
      action === 'open_dropdown' ||
      action === 'select_option' ||
      action === 'submit_form' ||
      action === 'tab' ||
      action === 'accordion'
    );
  }

  private emit(eventName: string, detail: unknown): void {
    try {
      window.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: false }));
    } catch {
      // Never let event dispatch break the main flow
    }
  }
}
