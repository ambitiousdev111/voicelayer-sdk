import { VoiceLayerError, ErrorCode } from '../errors.js';
import type { DOMWatcher, DOMChangeEvent } from '../observer/DOMWatcher.js';

/**
 * DOMInteractor — performs safe, event-driven DOM interactions on behalf of
 * the voice pipeline.
 *
 * All interactions go through the host app's own event system so React / Vue
 * synthetic event handlers fire correctly.  The constructor takes a DOMWatcher
 * to enable async operations that need to wait for DOM responses (modals,
 * dropdowns appearing after a click).
 */
export class DOMInteractor {
  private navigateStrategy: 'history' | 'hash' = 'history';

  constructor(private readonly watcher: DOMWatcher) {}

  /**
   * Switch the navigate strategy used for non-anchor, non-external hrefs.
   *  - `'history'` (default) — uses `history.pushState`.
   *  - `'hash'` — encodes the path inside `window.location.hash` so SPA routers
   *    that use `/#/route` style URLs receive the correct navigation signal.
   */
  setNavigateStrategy(strategy: 'history' | 'hash'): void {
    this.navigateStrategy = strategy;
  }

  // ── Basic interactions ─────────────────────────────────────────────────────

  /**
   * Click an element: dispatches mousedown → mouseup → click in order so that
   * React / Vue synthetic event handlers all fire as expected.
   *
   * @param label  Optional human-readable label used for smart fallback when the
   *               primary `selector` resolves to no element.
   */
  click(selector: string, label?: string): void {
    const el = this.findElementWithFallback(selector, label);
    this.fireClick(el);
  }

  /**
   * Bring keyboard focus to the element at `selector`.
   * Fires a 'focus' event so React controlled-component onFocus handlers run.
   */
  focus(selector: string): void {
    const el = this.require<HTMLElement>(selector);
    el.focus({ preventScroll: true });
  }

  /**
   * Simulate a mouse hover (mouseover + mouseenter) on an element.
   * Useful for triggering CSS :hover tooltips or opening hover-driven menus.
   */
  hover(selector: string): void {
    const el = this.require(selector);
    el.dispatchEvent(
      new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }),
    );
    el.dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: false, cancelable: false, view: window }),
    );
  }

  /**
   * Dispatch a keydown + keyup for the given key.
   * If `selector` is provided the events are fired on that element;
   * otherwise they go to the currently focused element (or document.body).
   */
  keyPress(key: string, selector?: string): void {
    const target: Element =
      selector
        ? this.require(selector)
        : ((document.activeElement as Element) ?? document.documentElement);

    const opts: KeyboardEventInit = {
      key,
      code: key,
      bubbles: true,
      cancelable: true,
    };
    target.dispatchEvent(new KeyboardEvent('keydown', opts));
    target.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  /**
   * Navigate to `href`.
   * Internal routes use history.pushState so SPA routers keep their state.
   * External URLs (http/https/protocol-relative) use a full page assignment.
   */
  navigate(href: string): void {
    if (!href) return;

    const isExternal =
      href.startsWith('http://') ||
      href.startsWith('https://') ||
      href.startsWith('//');

    if (isExternal) {
      window.location.href = href;
      return;
    }

    // For hash navigation (#section), prefer clicking the matching <a> element
    // so the host app's own click handlers (SPA routers, tab managers) fire normally.
    if (href.startsWith('#')) {
      const link = document.querySelector<HTMLElement>(`a[href="${CSS.escape(href).replace(/^\\#/, '#')}"]`) ??
                   document.querySelector<HTMLElement>(`a[href="${href}"]`);
      if (link) {
        this.fireClick(link);
        return;
      }
      // No matching link — update the hash directly and let the browser handle it
      window.location.hash = href.slice(1);
      return;
    }

    // Hash-router strategy: encode the path inside the hash (#/path)
    if (this.navigateStrategy === 'hash') {
      const hashPath = href.startsWith('/') ? href : `/${href}`;
      window.location.hash = hashPath;
      return;
    }

    try {
      history.pushState(null, '', href);
      window.dispatchEvent(new Event('voicelayer:routechange'));
    } catch {
      window.location.href = href;
    }
  }

  /**
   * Scroll an element smoothly into the centre of the viewport.
   * Non-throwing — silently skips if the element doesn't exist.
   */
  scroll(selector: string): void {
    document
      .querySelector(selector)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /**
   * Scroll the page by a fixed amount in a given direction.
   * @param direction 'up' | 'down' | 'left' | 'right'
   * @param amount    pixels to scroll (default 300)
   */
  scrollBy(direction: 'up' | 'down' | 'left' | 'right', amount = 300): void {
    const x = direction === 'right' ? amount : direction === 'left' ? -amount : 0;
    const y = direction === 'down' ? amount : direction === 'up' ? -amount : 0;
    window.scrollBy({ left: x, top: y, behavior: 'smooth' });
  }

  // ── Form interactions ──────────────────────────────────────────────────────

  /**
   * Fill a text-like input or textarea.
   *
   * Uses the React-aware native value setter so controlled components re-render,
   * then fires focus → input → change in sequence to cover all framework event
   * wiring (React onChange, Vue v-model, vanilla listeners).
   *
   * @param label  Optional human-readable label for smart fallback resolution.
   */
  fillInput(selector: string, value: string, label?: string): void {
    const el = this.findElementWithFallback(selector, label) as HTMLInputElement | HTMLTextAreaElement;
    el.focus({ preventScroll: true });
    this.setNativeValue(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Select an option from a native `<select>` element.
   * Matches by option value OR visible label text (case-insensitive).
   * Dispatches a 'change' event afterwards so React/Vue notice the change.
   */
  selectOption(selector: string, value: string): void {
    const el = this.require<HTMLSelectElement>(selector);
    const lower = value.toLowerCase();
    let found = false;

    for (const opt of Array.from(el.options)) {
      const label = (opt.textContent ?? opt.text ?? '').trim().toLowerCase();
      if (opt.value.toLowerCase() === lower || label === lower) {
        el.value = opt.value;
        found = true;
        break;
      }
    }

    if (!found) {
      console.warn(`[VoiceLayer] DOMInteractor: no option matching "${value}" in <select>`);
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Fill a search / autocomplete input, wait for the dropdown to appear, then
   * click the best-matching option.
   *
   * @param inputSelector — CSS selector for the search input
   * @param value         — text to type and match against
   * @param optionSelector — optional: explicit CSS selector for the option to
   *                         click (skips text-matching when provided)
   */
  async fillSearchAndSelect(
    inputSelector: string,
    value: string,
    optionSelector?: string,
  ): Promise<void> {
    // Register the watcher BEFORE filling so we don't miss an immediately-
    // appearing dropdown (some components react synchronously to input events).
    const dropdownPromise = this.watcher
      .waitForChange(['dropdown_opened'], 2_000)
      .catch(() => null);

    this.fillInput(inputSelector, value);

    await dropdownPromise;

    if (optionSelector) {
      const opt = document.querySelector(optionSelector);
      if (opt) {
        this.fireClick(opt);
        return;
      }
    }

    // Auto-select the first option whose text contains the query
    const lower = value.toLowerCase();
    const items = Array.from(
      document.querySelectorAll<Element>('[role="option"], [role="menuitem"]'),
    );
    const match = items.find((item) =>
      (item.textContent ?? '').trim().toLowerCase().includes(lower),
    );
    if (match) this.fireClick(match);
  }

  /**
   * Set the checked state of a checkbox or radio input.
   * @param state defaults to true (check); pass false to uncheck
   */
  checkCheckbox(selector: string, state = true): void {
    const el = this.require<HTMLInputElement>(selector);
    el.checked = state;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Set the value of a date / datetime-local / time / month / week input.
   * Uses the React-aware native setter then fires input + change.
   */
  setDateInput(selector: string, value: string): void {
    const el = this.require<HTMLInputElement>(selector);
    this.setNativeValue(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── Dropdown interactions ──────────────────────────────────────────────────

  /**
   * Click the trigger element that opens a custom dropdown / popover.
   * For simple cases where you don't need to wait for the options to render.
   */
  openDropdown(triggerSelector: string): void {
    this.click(triggerSelector);
  }

  /**
   * Click a dropdown trigger, wait for the listbox / menu to appear in the DOM,
   * then click the item whose visible text matches `optionText`.
   *
   * Throws DROPDOWN_NOT_FOUND if no dropdown appears within 1 500 ms.
   * Throws ELEMENT_NOT_FOUND if the dropdown appeared but no option matched.
   */
  async selectFromDropdown(triggerSelector: string, optionText: string): Promise<void> {
    // Register before clicking to avoid missing fast-appearing dropdowns
    const changePromise = this.watcher.waitForChange(['dropdown_opened'], 1_500);

    this.click(triggerSelector);

    let dropdownEl: Element | null = null;
    try {
      const event = await changePromise;
      dropdownEl = document.querySelector(event.selector);
    } catch {
      // Timeout — last-chance fallback: look for any already-visible menu
      dropdownEl =
        document.querySelector('[role="listbox"]') ??
        document.querySelector('[role="menu"]') ??
        null;
    }

    if (!dropdownEl) {
      throw new VoiceLayerError(
        ErrorCode.DROPDOWN_NOT_FOUND,
        `No dropdown appeared after clicking "${triggerSelector}"`,
      );
    }

    const lower = optionText.toLowerCase();
    const items = Array.from(
      dropdownEl.querySelectorAll<Element>(
        '[role="option"], [role="menuitem"], li, option',
      ),
    );
    const match = items.find(
      (item) => (item.textContent ?? '').trim().toLowerCase() === lower,
    );

    if (!match) {
      throw new VoiceLayerError(
        ErrorCode.ELEMENT_NOT_FOUND,
        `No option matching "${optionText}" found in dropdown`,
      );
    }

    this.fireClick(match);
  }

  // ── Modal interactions ─────────────────────────────────────────────────────

  /**
   * Wait for a modal / dialog to appear in the DOM.
   * Returns the DOMChangeEvent that describes what opened.
   * Rejects if no modal appears within `timeoutMs` (default 2 000 ms).
   */
  waitForModal(timeoutMs = 2_000): Promise<DOMChangeEvent> {
    return this.watcher.waitForChange(['modal_opened'], timeoutMs);
  }

  /**
   * Dismiss the currently-open modal by dispatching an Escape keydown event
   * on the focused element (which bubbles to the document).
   * Most modal implementations listen for Escape on document or the dialog.
   */
  closeModal(): void {
    const target = (document.activeElement as Element) ?? document.documentElement;
    const opts: KeyboardEventInit = {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      bubbles: true,
      cancelable: true,
    };
    target.dispatchEvent(new KeyboardEvent('keydown', opts));
    target.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  /**
   * Click an element and wait for a modal to open — a common pattern for
   * "Open dialog" buttons.  Registers the watcher BEFORE clicking so the race
   * window is zero.
   *
   * @param selector   — the trigger button / link
   * @param timeoutMs  — how long to wait for the modal (default 2 000 ms)
   */
  async clickAndWaitForModal(
    selector: string,
    timeoutMs = 2_000,
  ): Promise<DOMChangeEvent> {
    const modalPromise = this.watcher.waitForChange(['modal_opened'], timeoutMs);
    this.click(selector);
    return modalPromise;
  }

  // ── Tabs & Accordion ───────────────────────────────────────────────────────

  /**
   * Click a tab panel trigger.
   * Equivalent to a regular click but semantically named so the ActionExecutor
   * can route 'tab' intents here.
   */
  clickTab(selector: string): void {
    const el = this.require(selector);
    this.fireClick(el);
  }

  /**
   * Click an accordion header to expand / collapse it.
   */
  clickAccordion(selector: string): void {
    const el = this.require(selector);
    this.fireClick(el);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Require an element or throw ELEMENT_NOT_FOUND.
   * Used by operations that don't benefit from label-based fallbacks
   * (e.g. dropdown / modal methods that receive fully-qualified selectors).
   */
  private require<T extends Element = Element>(selector: string): T {
    const el = document.querySelector<T>(selector);
    if (!el) {
      throw new VoiceLayerError(
        ErrorCode.ELEMENT_NOT_FOUND,
        `VoiceLayer: element not found for selector "${selector}"`,
      );
    }
    return el;
  }

  /**
   * Find an element using a 5-step fallback chain — used by click() and
   * fillInput() so that stale nth-child selectors or renamed elements don't
   * silently fail.
   *
   * Resolution order:
   *  1. Direct `querySelector(selector)` — fast path, no change from before.
   *  2. Selector with `:nth-child(N)` parts stripped — handles layout shifts.
   *  3. `[aria-label="<label>"]` — relies on descriptive ARIA attributes.
   *  4. First `button | a | [role=button] | [role=link]` whose trimmed
   *     `textContent` exactly matches `label` — handles pure-text buttons.
   *  5. `[data-voice-label="<label>"]` — explicit opt-in for dynamic apps.
   *  6. Throw `ELEMENT_NOT_FOUND`.
   */
  private findElementWithFallback(selector: string, label?: string): Element {
    // ── Step 1: direct lookup ──────────────────────────────────────────────
    const direct = document.querySelector(selector);
    if (direct) return direct;

    // ── Step 2: strip :nth-child(N) qualifiers ─────────────────────────────
    const stripped = selector.replace(/:nth-child\(\d+\)/g, '').trim();
    if (stripped && stripped !== selector) {
      const byStripped = document.querySelector(stripped);
      if (byStripped) return byStripped;
    }

    if (label) {
      const escaped = CSS.escape(label);

      // ── Step 3: aria-label ───────────────────────────────────────────────
      const byAria = document.querySelector(`[aria-label="${escaped}"]`);
      if (byAria) return byAria;

      // ── Step 4: visible text content match ────────────────────────────────
      const clickables = Array.from(
        document.querySelectorAll<Element>('button, a, [role="button"], [role="link"]'),
      );
      const byText = clickables.find(
        (el) => (el.textContent ?? '').trim() === label,
      );
      if (byText) return byText;

      // ── Step 5: data-voice-label ──────────────────────────────────────────
      const byVoiceLabel = document.querySelector(`[data-voice-label="${escaped}"]`);
      if (byVoiceLabel) return byVoiceLabel;
    }

    // ── Step 6: give up ───────────────────────────────────────────────────
    throw new VoiceLayerError(
      ErrorCode.ELEMENT_NOT_FOUND,
      `VoiceLayer: element not found for selector "${selector}"${label ? ` (label: "${label}")` : ''}`,
    );
  }

  /**
   * Fire mousedown → mouseup → click on an element in the correct order so
   * that React, Vue, and native event listeners all receive the full sequence.
   */
  private fireClick(el: Element): void {
    const opts: MouseEventInit = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  /**
   * Use the React-aware native value setter so that React controlled components
   * notice the change and re-render (bypasses React's synthetic value tracking).
   */
  private setNativeValue(
    el: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ): void {
    const proto =
      el.tagName.toLowerCase() === 'textarea'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }
  }
}
