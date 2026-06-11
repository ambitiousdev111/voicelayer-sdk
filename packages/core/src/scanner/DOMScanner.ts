import type { PageAction, PageIntentMap } from './types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Combined CSS selector that matches every element a user could plausibly
 * interact with — explicit HTML elements, ARIA roles, custom patterns, and
 * trigger-hint attributes.
 */
const INTERACTIVE_SELECTOR = [
  // ── Explicit HTML elements ────────────────────────────────────────────────
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  // ── ARIA roles ────────────────────────────────────────────────────────────
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="combobox"]',
  '[role="searchbox"]',
  '[role="spinbutton"]',
  '[role="slider"]',
  // ── Custom interactive patterns ───────────────────────────────────────────
  '[tabindex]:not([tabindex="-1"])',
  '[onclick]',
  '[data-action]',
  '[data-href]',
  '[class*="btn"]:not(script):not(style)',
  '[class*="button"]:not(script):not(style)',
  // ── Trigger-hint attributes ───────────────────────────────────────────────
  '[data-toggle]',
  '[data-target]',
  '[aria-haspopup]',
  '[aria-controls]',
].join(', ');

/** CSS selectors for elements that hold page-level data we surface to the AI. */
const DATA_SELECTORS = [
  '[data-voice-data]',
  '.stat',
  '.count',
  '.metric',
  '.badge',
  '.summary',
  '[data-count]',
  '[data-value]',
].join(', ');

const NUMERIC_RE = /^[\d,.\s₹$€£¥]+$/;
const QUANTITY_RE = /^(\d[\d,]*)\s+\w+$/;

const MAX_LABEL = 60;
const MAX_DATA = 20;
const MAX_ANCESTORS = 3;

// ── DOMScanner ────────────────────────────────────────────────────────────────

/**
 * DOMScanner — reads the live DOM and produces a structured `PageIntentMap`.
 *
 * Completely read-only: it never mutates the host page.
 * SPA-safe: call `scan()` after every route change to get a fresh snapshot.
 */
export class DOMScanner {
  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Scan `root` and return a full `PageIntentMap` snapshot.
   *
   * Priority: if the user's focus is inside a modal/dropdown, available actions
   * are scoped to that container only. Otherwise the full page is scanned.
   *
   * @param root — defaults to `document.body`. Pass a subtree for partial scans.
   */
  scan(root: Element = document.body): PageIntentMap {
    // 1. Try focused context — constrains actions to the active modal/dropdown
    const focused = this.scanFocusedContext();

    let availableActions: PageAction[];
    let focusContext: PageIntentMap['focusContext'];

    if (focused.length > 0) {
      availableActions = focused;
      focusContext = this.scanFocusContext();
    } else {
      const elements = this.findInteractiveElements(root);
      const actions = elements.map((el, i) => this.elementToAction(el, i));
      const deduped = DOMScanner.deduplicateActions(actions);
      availableActions = DOMScanner.sortActions(deduped);
      focusContext = 'page';
    }

    const hiddenActions = this.scanHiddenInteractive(root);

    const currentPage = (
      document.querySelector('h1')?.textContent?.trim() ?? document.title
    ).slice(0, 80);

    return {
      currentPage,
      currentRoute: window.location.pathname + window.location.search,
      availableActions,
      visibleData: this.extractVisibleData(root),
      scannedAt: Date.now(),
      pageTitle: document.title,
      hiddenActions,
      focusContext,
      openModals: this.scanOpenModals(),
      activeDropdowns: this.scanActiveDropdowns(),
      toasts: this.scanToasts(),
    };
  }

  /**
   * Return interactive elements scoped to the current focus container
   * (modal, dropdown, or drawer) if the user's focus is inside one.
   *
   * Returns an empty array when focus is on the main page, signalling that
   * `scan()` should fall back to a full-page scan.
   */
  scanFocusedContext(): PageAction[] {
    const active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement) {
      return [];
    }

    const container = DOMScanner.findFocusContainer(active);
    if (!container) return [];

    const elements = this.findInteractiveElements(container);
    const actions = elements.map((el, i) => this.elementToAction(el, i));
    return DOMScanner.sortActions(DOMScanner.deduplicateActions(actions));
  }

  /**
   * Determine the type of focus container for the currently active element.
   * Returns 'page' when there is no special container.
   */
  scanFocusContext(): PageIntentMap['focusContext'] {
    const active = document.activeElement;
    if (!active || active === document.body) return 'page';

    const container = DOMScanner.findFocusContainer(active);
    if (!container) return 'page';

    if (DOMScanner.isDropdownLike(container)) return 'dropdown';

    const cls = typeof container.className === 'string' ? container.className : '';
    if (/\b(drawer|sheet)\b/i.test(cls)) return 'drawer';

    return 'modal';
  }

  /**
   * Find interactive elements that are currently hidden (display:none /
   * aria-hidden=true) but match modal/dialog/drawer patterns.
   */
  scanHiddenInteractive(root: Element = document.body): PageAction[] {
    const HIDDEN_QUERY = [
      'dialog',
      '[role="dialog"]',
      '[role="alertdialog"]',
      '[aria-modal="true"]',
      '[aria-hidden="true"]',
    ].join(', ');

    const candidates = Array.from(root.querySelectorAll<Element>(HIDDEN_QUERY));
    const hidden = candidates.filter(
      (el) => !DOMScanner.isVisible(el) && !DOMScanner.isSdkElement(el),
    );

    const results: PageAction[] = [];
    let index = 1000;

    for (const container of hidden) {
      if (results.length >= 20) break;
      const action = this.elementToAction(container, index++);
      results.push({ ...action, isVisible: false });
    }

    return results;
  }

  /**
   * Find interactive elements inside currently-visible modal/dialog containers.
   * Returns them as PageAction entries with context = 'modal'.
   */
  scanOpenModals(): PageAction[] {
    const MODAL_QUERY = [
      '[role="dialog"]',
      '[role="alertdialog"]',
      '.modal',
      '.drawer',
      '.sheet',
    ].join(', ');

    const containers = Array.from(
      document.querySelectorAll<Element>(MODAL_QUERY),
    ).filter((el) => DOMScanner.isVisible(el) && !DOMScanner.isSdkElement(el));

    const results: PageAction[] = [];
    let index = 2000;

    for (const container of containers) {
      const elements = this.findInteractiveElements(container);
      for (const el of elements) {
        const action = this.elementToAction(el, index++);
        results.push({ ...action, context: 'modal' });
      }
    }

    return DOMScanner.deduplicateActions(results);
  }

  /**
   * Find option items inside currently-open dropdown menus or listboxes.
   */
  scanActiveDropdowns(): PageAction[] {
    const DROPDOWN_QUERY = '[role="menu"], [role="listbox"]';

    const containers = Array.from(
      document.querySelectorAll<Element>(DROPDOWN_QUERY),
    ).filter((el) => DOMScanner.isVisible(el) && !DOMScanner.isSdkElement(el));

    const results: PageAction[] = [];
    let index = 3000;

    for (const container of containers) {
      const items = Array.from(
        container.querySelectorAll<Element>(
          '[role="option"], [role="menuitem"], li',
        ),
      ).filter((el) => DOMScanner.isVisible(el) && !DOMScanner.isSdkElement(el));

      for (const el of items) {
        results.push(this.elementToAction(el, index++));
      }
    }

    return results;
  }

  /**
   * Return the text content of currently-visible toast / snackbar / alert
   * elements.  Each entry is trimmed and capped at 100 characters.
   */
  scanToasts(): string[] {
    const TOAST_QUERY = [
      '[role="alert"]',
      '[role="status"]',
      '.toast',
      '.snackbar',
    ].join(', ');

    return Array.from(document.querySelectorAll<Element>(TOAST_QUERY))
      .filter((el) => DOMScanner.isVisible(el) && !DOMScanner.isSdkElement(el))
      .map((el) => (el.textContent ?? '').trim().slice(0, 100))
      .filter((text) => text.length > 0);
  }

  // ── Interactive element discovery ─────────────────────────────────────────

  private findInteractiveElements(root: Element): Element[] {
    const candidates = Array.from(root.querySelectorAll<Element>(INTERACTIVE_SELECTOR));

    // ── DEBUG: log every candidate and its filter result ──────────────────
    if (typeof console !== 'undefined' && (window as unknown as Record<string, unknown>)['__vlDebugScan']) {
      console.log('[VL-SCAN] querySelectorAll count:', candidates.length);
      candidates.slice(0, 15).forEach((el, i) => {
        const sdk = DOMScanner.isSdkElement(el);
        const vis = DOMScanner.isVisible(el);
        const tag = el.tagName.toLowerCase();
        const id = el.getAttribute('id') ?? '';
        const cls = typeof el.className === 'string' ? el.className : '';
        console.log(`[VL-SCAN] [${i}] <${tag}#${id}.${cls}> isSdk=${sdk} isVisible=${vis}`);
      });
    }
    // ── END DEBUG ──────────────────────────────────────────────────────────

    return candidates.filter((el) => {
      if (DOMScanner.isSdkElement(el)) return false;
      if (!DOMScanner.isVisible(el)) return false;
      return true;
    });
  }

  // ── Element → PageAction conversion ──────────────────────────────────────

  private elementToAction(el: Element, index: number): PageAction {
    const tag = el.tagName.toLowerCase();
    const inputType = (el.getAttribute('type') ?? '').toLowerCase();
    const role = el.getAttribute('role') ?? '';
    const href = el.getAttribute('href') ?? '';

    // ── Context & elementType ─────────────────────────────────────────────
    const context = DOMScanner.detectContext(el);
    const elementType = DOMScanner.detectElementType(el, context);

    // ── Legacy type field (for executor routing) ──────────────────────────
    let type: PageAction['type'];
    if (tag === 'a' && href && !href.startsWith('#')) {
      type = 'navigate';
    } else if (
      tag === 'select' ||
      role === 'listbox' ||
      role === 'combobox'
    ) {
      type = 'select';
    } else if (tag === 'input' || tag === 'textarea') {
      type = inputType === 'submit' || inputType === 'button' ? 'submit' : 'input';
    } else if (
      inputType === 'submit' ||
      // Only treat a button as submit when the attribute is explicitly set;
      // the DOM .type property defaults to 'submit' even without the attribute.
      (tag === 'button' && el.getAttribute('type') === 'submit')
    ) {
      type = 'submit';
    } else {
      type = 'click';
    }

    // ── Label ─────────────────────────────────────────────────────────────
    const label = DOMScanner.extractLabel(el);

    // ── Bounding box (unavailable in jsdom / test env) ────────────────────
    let boundingBox: PageAction['boundingBox'];
    if (typeof (el as HTMLElement).getBoundingClientRect === 'function') {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        boundingBox = {
          top: r.top,
          left: r.left,
          width: r.width,
          height: r.height,
        };
      }
    }

    // ── Value / options / placeholder ─────────────────────────────────────
    const valueInfo = DOMScanner.extractValueInfo(el, tag, inputType, role);

    return {
      id: `action_${index}`,
      label,
      type,
      elementType,
      context,
      isDisabled: DOMScanner.isDisabledElement(el),
      selector: this.generateSelector(el),
      target: type === 'navigate' ? href : undefined,
      ariaLabel: el.getAttribute('aria-label') ?? undefined,
      isVisible: true,
      boundingBox,
      ...valueInfo,
    };
  }

  // ── Context & elementType detection ──────────────────────────────────────

  /**
   * Walk up the ancestor tree to determine where on the page the element sits.
   */
  private static detectContext(el: Element): PageAction['context'] {
    let node: Element | null = el.parentElement;

    while (node && node !== document.body) {
      const tag = node.tagName.toLowerCase();
      const role = node.getAttribute('role') ?? '';
      const cls = typeof node.className === 'string' ? node.className : '';

      if (tag === 'nav' || role === 'navigation') return 'navbar';
      if (tag === 'footer' || role === 'contentinfo') return 'footer';
      if (tag === 'aside' || /\bsidebar\b/i.test(cls)) return 'sidebar';

      if (
        tag === 'dialog' ||
        role === 'dialog' ||
        role === 'alertdialog' ||
        /\b(modal|dialog|drawer|sheet)\b/i.test(cls)
      ) {
        return 'modal';
      }

      node = node.parentElement;
    }

    // Best-effort floating check — only works in a real browser
    if (typeof getComputedStyle === 'function') {
      try {
        const cs = getComputedStyle(el as HTMLElement);
        if (cs.position === 'fixed') return 'floating';
      } catch {
        // no-op in test envs
      }
    }

    return 'main';
  }

  /**
   * Classify the element into a fine-grained elementType based on its tag,
   * type attribute, ARIA role, and semantic hints.
   */
  private static detectElementType(
    el: Element,
    context: PageAction['context'],
  ): PageAction['elementType'] {
    // nav-item wins when we're inside a navbar regardless of element kind
    if (context === 'navbar') return 'nav-item';

    const tag = el.tagName.toLowerCase();
    const inputType = ((el as HTMLInputElement).type ?? '').toLowerCase();
    const role = el.getAttribute('role') ?? '';

    // ── ARIA role overrides ───────────────────────────────────────────────
    if (role === 'tab') return 'tab';
    if (role === 'searchbox') return 'search';
    if (role === 'listbox') return 'select';
    if (role === 'combobox') return 'custom-select';

    // ── Trigger hints ─────────────────────────────────────────────────────
    if (el.hasAttribute('aria-haspopup')) {
      return el.getAttribute('aria-haspopup') === 'dialog'
        ? 'modal-trigger'
        : 'dropdown-trigger';
    }
    const toggle = el.getAttribute('data-toggle') ?? '';
    if (toggle === 'dropdown') return 'dropdown-trigger';
    if (toggle === 'modal') return 'modal-trigger';

    // ── Accordion: has aria-expanded but not aria-haspopup ────────────────
    if (el.hasAttribute('aria-expanded') && !el.hasAttribute('aria-haspopup')) {
      return 'accordion';
    }

    // ── Input variants ────────────────────────────────────────────────────
    if (tag === 'input') {
      if (inputType === 'submit') return 'form-submit';
      if (inputType === 'checkbox') return 'checkbox';
      if (inputType === 'radio') return 'radio';
      if (inputType === 'search') return 'search';
      if (
        inputType === 'date' ||
        inputType === 'datetime-local' ||
        inputType === 'time' ||
        inputType === 'month' ||
        inputType === 'week'
      ) {
        return 'date-input';
      }
      // aria-label date hint
      if (/date/i.test(el.getAttribute('aria-label') ?? '')) return 'date-input';
      return 'input';
    }

    // ── Button submit — check the attribute, not the DOM property default ────
    if (tag === 'button' && el.getAttribute('type') === 'submit') {
      return 'form-submit';
    }

    // ── Other semantics ───────────────────────────────────────────────────
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'input';
    if (tag === 'a') return 'link';
    if (tag === 'button' || role === 'button') return 'button';

    return 'other';
  }

  // ── Value extraction ──────────────────────────────────────────────────────

  private static extractValueInfo(
    el: Element,
    tag: string,
    inputType: string,
    role: string,
  ): { currentValue?: string; options?: string[]; placeholder?: string } {
    const result: { currentValue?: string; options?: string[]; placeholder?: string } = {};

    const placeholder = (el as HTMLInputElement).placeholder;
    if (placeholder) result.placeholder = placeholder;

    if (tag === 'input') {
      if (inputType === 'checkbox' || inputType === 'radio') {
        result.currentValue = String((el as HTMLInputElement).checked);
      } else {
        const val = (el as HTMLInputElement).value;
        if (val) result.currentValue = val;
      }
    } else if (tag === 'textarea') {
      const val = (el as HTMLTextAreaElement).value;
      if (val) result.currentValue = val;
    } else if (tag === 'select') {
      result.currentValue = (el as HTMLSelectElement).value;
      const opts = Array.from((el as HTMLSelectElement).querySelectorAll('option'))
        .slice(0, 10)
        .map((o) => (o.textContent ?? '').trim())
        .filter((t) => t.length > 0);
      if (opts.length > 0) result.options = opts;
    } else if (role === 'listbox' || role === 'combobox') {
      const opts = Array.from(el.querySelectorAll('[role="option"]'))
        .slice(0, 10)
        .map((o) => (o.textContent ?? '').trim())
        .filter((t) => t.length > 0);
      if (opts.length > 0) result.options = opts;
      // combobox may expose its current value via an internal input
      const inner = el.querySelector('input');
      if (inner) {
        if (inner.value) result.currentValue = inner.value;
        if (!result.placeholder && inner.placeholder) {
          result.placeholder = inner.placeholder;
        }
      }
    }

    return result;
  }

  // ── isDisabled ────────────────────────────────────────────────────────────

  private static isDisabledElement(el: Element): boolean {
    return (
      el.hasAttribute('disabled') ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.classList.contains('disabled')
    );
  }

  // ── Visible data extraction ───────────────────────────────────────────────

  private extractVisibleData(root: Element): Record<string, string | number> {
    const result: Record<string, string | number> = {};

    const candidates = Array.from(root.querySelectorAll<Element>(DATA_SELECTORS));

    for (const el of candidates) {
      if (Object.keys(result).length >= MAX_DATA) break;
      if (!DOMScanner.isVisible(el)) continue;

      const text = (el.textContent ?? '').trim();
      if (!text) continue;

      const key = DOMScanner.deriveDataKey(el);
      const value = DOMScanner.parseValue(text);
      if (value !== null) {
        result[key] = value;
      }
    }

    if (Object.keys(result).length < MAX_DATA) {
      const all = Array.from(
        root.querySelectorAll<Element>('p, span, td, dd, strong, b'),
      );
      for (const el of all) {
        if (Object.keys(result).length >= MAX_DATA) break;
        if (!DOMScanner.isVisible(el)) continue;
        if (DOMScanner.isSdkElement(el)) continue;

        const text = (el.textContent ?? '').trim();
        if (!text) continue;

        if (NUMERIC_RE.test(text) || QUANTITY_RE.test(text)) {
          const key = DOMScanner.deriveDataKey(el);
          if (!(key in result)) {
            result[key] = DOMScanner.parseValue(text) ?? text;
          }
        }
      }
    }

    return result;
  }

  // ── CSS selector generation ───────────────────────────────────────────────

  private generateSelector(el: Element): string {
    const id = el.getAttribute('id');
    if (id && /^[a-zA-Z][\w-]*$/.test(id)) {
      return `#${CSS.escape(id)}`;
    }

    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`;

    const dataId = el.getAttribute('data-id');
    if (dataId) return `[data-id="${CSS.escape(dataId)}"]`;

    return DOMScanner.nthChildPath(el, MAX_ANCESTORS);
  }

  // ── Static helpers ────────────────────────────────────────────────────────

  private static extractLabel(el: Element): string {
    const sources = [
      el.getAttribute('aria-label'),
      (el as HTMLElement).innerText,
      el.textContent,
      el.getAttribute('placeholder'),
      el.getAttribute('title'),
      el.getAttribute('alt'),
      el.getAttribute('id'),
    ];

    for (const src of sources) {
      const trimmed = src?.trim().replace(/\s+/g, ' ');
      if (trimmed) return trimmed.slice(0, MAX_LABEL);
    }

    return el.tagName.toLowerCase();
  }

  private static isSdkElement(el: Element): boolean {
    let node: Element | null = el;
    while (node) {
      const cls = node.className;
      const classStr = typeof cls === 'string' ? cls : '';
      if (
        classStr.split(' ').some((c) => c.startsWith('voicelayer')) ||
        node.id.startsWith('voicelayer')
      ) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  /**
   * Visibility check that works without a real layout engine.
   * In a real browser: `offsetParent` + `getComputedStyle`.
   * In jsdom / test env: checks inline `style` and `hidden` attribute only.
   */
  /**
   * Returns true when `el` and all its ancestors up to <body> are rendered
   * (i.e. none has display:none or visibility:hidden).
   *
   * Deliberately avoids the `offsetParent === null` heuristic — it is
   * unreliable across browsers for position:fixed elements and for <body>
   * itself (whose offsetParent is always null).
   */
  private static isVisible(el: Element): boolean {
    const htmlEl = el as HTMLElement;
    if (htmlEl.hidden) return false;

    let node: HTMLElement | null = htmlEl;
    while (node && node !== document.body && node !== document.documentElement) {
      // Fast path: check inline style first (no layout query needed)
      const s = node.style;
      if (s.display === 'none' || s.visibility === 'hidden') return false;

      // Reliable path: check computed style to catch CSS-class-driven hiding
      // (e.g. `.page { display:none }` on inactive sections)
      if (typeof getComputedStyle === 'function') {
        try {
          const cs = getComputedStyle(node);
          if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        } catch {
          // getComputedStyle unavailable in test envs — inline check above is enough
        }
      }

      node = node.parentElement;
    }

    return true;
  }

  private static deduplicateActions(actions: PageAction[]): PageAction[] {
    const seen = new Set<string>();
    return actions.filter((a) => {
      if (seen.has(a.selector)) return false;
      seen.add(a.selector);
      return true;
    });
  }

  private static sortActions(actions: PageAction[]): PageAction[] {
    const ORDER: Record<PageAction['type'], number> = {
      navigate: 0,
      click: 1,
      submit: 2,
      input: 3,
      select: 4,
    };
    return [...actions].sort((a, b) => ORDER[a.type] - ORDER[b.type]);
  }

  private static nthChildPath(el: Element, depth: number): string {
    const parts: string[] = [];
    let node: Element | null = el;

    for (let i = 0; i < depth && node; i++) {
      const parent: Element | null = node.parentElement;
      if (!parent) break;

      const siblings = Array.from(parent.children);
      const idx = siblings.indexOf(node) + 1;
      parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${idx})`);
      node = parent;
    }

    if (node && node !== el) {
      const rootTag = node.tagName.toLowerCase();
      const rootId = node.getAttribute('id');
      const anchor = rootId ? `#${CSS.escape(rootId)}` : rootTag;
      return `${anchor} > ${parts.join(' > ')}`;
    }

    return parts.join(' > ') || el.tagName.toLowerCase();
  }

  private static deriveDataKey(el: Element): string {
    const hint = el.getAttribute('data-voice-data');
    if (hint) return hint.toLowerCase().replace(/\s+/g, '_');

    const labelEl =
      el.closest('tr')?.querySelector('th') ??
      el.closest('dl')?.querySelector('dt') ??
      el.previousElementSibling ??
      el.parentElement?.querySelector('label, .label, [class*="label"]');

    const labelText = labelEl?.textContent?.trim();
    if (labelText && labelText.length < 40) {
      return labelText
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
    }

    const own = (el.textContent ?? '').trim().slice(0, 20);
    return own
      ? own
          .toLowerCase()
          .replace(/\s+/g, '_')
          .replace(/[^a-z0-9_]/g, '')
      : el.tagName.toLowerCase();
  }

  private static parseValue(text: string): string | number | null {
    if (!text) return null;

    const stripped = text.replace(/[₹$€£¥,\s]/g, '');
    const n = Number(stripped);
    if (!Number.isNaN(n) && stripped !== '') return n;

    const qMatch = QUANTITY_RE.exec(text);
    if (qMatch?.[1]) {
      const qn = Number(qMatch[1].replace(/,/g, ''));
      if (!Number.isNaN(qn)) return qn;
    }

    return text.length <= 100 ? text : null;
  }

  // ── Focus context helpers ─────────────────────────────────────────────────

  private static findFocusContainer(el: Element): Element | null {
    let node: Element | null = el;
    while (node && node !== document.body) {
      if (DOMScanner.isModalLike(node) || DOMScanner.isDropdownLike(node)) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  private static isModalLike(el: Element): boolean {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') ?? '';
    const cls = typeof el.className === 'string' ? el.className : '';
    return (
      tag === 'dialog' ||
      role === 'dialog' ||
      role === 'alertdialog' ||
      /\b(modal|dialog|overlay|backdrop|drawer|sheet|popup)\b/i.test(cls)
    );
  }

  private static isDropdownLike(el: Element): boolean {
    const role = el.getAttribute('role') ?? '';
    const cls = typeof el.className === 'string' ? el.className : '';
    return (
      role === 'listbox' ||
      role === 'menu' ||
      /\b(dropdown|popover|menu|options)\b/i.test(cls)
    );
  }
}
