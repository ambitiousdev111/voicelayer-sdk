import type { DOMInteractor } from './DOMInteractor.js';

/**
 * FormFiller — fills form fields from extracted intent data.
 *
 * Delegates all actual DOM interaction to DOMInteractor so that the two classes
 * share one consistent interaction layer (correct event ordering, React-aware
 * value setters, etc.).
 *
 * Auto-detects the element type (text input, textarea, select, checkbox, radio,
 * date-like input) from the live DOM and routes each field to the right
 * DOMInteractor method.
 */
export class FormFiller {
  private static readonly FILLED_ATTR = 'data-voicelayer-filled';
  private static readonly HIGHLIGHT_STYLE = '2px solid #6C47FF';

  constructor(private readonly interactor: DOMInteractor) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Fill each field in `fields`.
   *
   * @param fields — `{ cssSelector: value }` pairs extracted from the AIIntent
   */
  fill(fields: Record<string, string>): void {
    for (const [selector, value] of Object.entries(fields)) {
      const el = document.querySelector<HTMLElement>(selector);

      if (!el) {
        console.warn(`[VoiceLayer] FormFiller: no element found for "${selector}"`);
        continue;
      }

      this.fillElement(el, selector, value);
      this.highlight(el);
    }
  }

  /**
   * Remove VoiceLayer highlight outlines from all previously filled fields.
   */
  clearHighlights(): void {
    document
      .querySelectorAll<HTMLElement>(`[${FormFiller.FILLED_ATTR}]`)
      .forEach((el) => {
        el.removeAttribute(FormFiller.FILLED_ATTR);
        el.style.outline = '';
        el.style.outlineOffset = '';
      });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Route `selector` to the correct DOMInteractor method based on element type.
   */
  private fillElement(el: HTMLElement, selector: string, value: string): void {
    const tag = el.tagName.toLowerCase();
    const type = ((el as HTMLInputElement).type ?? '').toLowerCase();

    // Native <select>
    if (tag === 'select') {
      this.interactor.selectOption(selector, value);
      return;
    }

    // Checkbox
    if (type === 'checkbox') {
      const checked = ['true', 'yes', '1', 'on', 'checked'].includes(
        value.toLowerCase(),
      );
      this.interactor.checkCheckbox(selector, checked);
      return;
    }

    // Radio — always check (caller supplies the right selector)
    if (type === 'radio') {
      this.interactor.checkCheckbox(selector, true);
      return;
    }

    // Date-family inputs
    if (
      type === 'date' ||
      type === 'datetime-local' ||
      type === 'time' ||
      type === 'month' ||
      type === 'week'
    ) {
      this.interactor.setDateInput(selector, value);
      return;
    }

    // Everything else: text, textarea, number, email, url, search, tel, …
    this.interactor.fillInput(selector, value);
  }

  private highlight(el: HTMLElement): void {
    el.setAttribute(FormFiller.FILLED_ATTR, '');
    el.style.outline = FormFiller.HIGHLIGHT_STYLE;
    el.style.outlineOffset = '2px';
  }
}
