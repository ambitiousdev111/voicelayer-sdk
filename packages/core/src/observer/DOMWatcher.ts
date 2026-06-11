/**
 * DOMWatcher — observes live DOM mutations and classifies them into semantic
 * events (modal opened, toast, dropdown, content change).
 *
 * Note: Named DOMWatcher to avoid collision with the browser's MutationObserver.
 *
 * Usage:
 *   const watcher = new DOMWatcher();
 *   watcher.install();
 *   const unsub = watcher.onChange(event => console.log(event));
 *   await watcher.waitForChange(['modal_opened'], 3000);
 */

export interface DOMChangeEvent {
  type: 'modal_opened' | 'modal_closed' | 'content_added' | 'content_removed' | 'toast' | 'dropdown_opened';
  /** Best CSS selector for the changed element. */
  selector: string;
  /** First 120 chars of the element's text content. */
  textContent: string;
  timestamp: number;
}

// ── Classification helpers ─────────────────────────────────────────────────

const MODAL_CLASS_RE = /\b(modal|dialog|overlay|backdrop|drawer|sheet|popup)\b/i;
const TOAST_CLASS_RE = /\b(toast|snackbar|notification|alert)\b/i;
const DROPDOWN_CLASS_RE = /\b(dropdown|popover|menu|options)\b/i;

function classOf(el: Element): string {
  const cls = el.className;
  return typeof cls === 'string' ? cls : '';
}

function isModal(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role') ?? '';
  return (
    tag === 'dialog' ||
    role === 'dialog' ||
    role === 'alertdialog' ||
    MODAL_CLASS_RE.test(classOf(el))
  );
}

function isToast(el: Element): boolean {
  const role = el.getAttribute('role') ?? '';
  return role === 'alert' || role === 'status' || TOAST_CLASS_RE.test(classOf(el));
}

function isDropdown(el: Element): boolean {
  const role = el.getAttribute('role') ?? '';
  return role === 'listbox' || role === 'menu' || DROPDOWN_CLASS_RE.test(classOf(el));
}

function classifyAdded(el: Element): DOMChangeEvent['type'] {
  if (isModal(el)) return 'modal_opened';
  if (isToast(el)) return 'toast';
  if (isDropdown(el)) return 'dropdown_opened';
  return 'content_added';
}

function classifyRemoved(el: Element): DOMChangeEvent['type'] {
  if (isModal(el)) return 'modal_closed';
  return 'content_removed';
}

/** Generate a minimal CSS selector for a DOM element. */
function selectorOf(el: Element): string {
  const id = el.getAttribute('id');
  if (id) return `#${id}`;
  const role = el.getAttribute('role');
  if (role) return `[role="${role}"]`;
  const firstClass = classOf(el).trim().split(/\s+/)[0];
  const tag = el.tagName.toLowerCase();
  return firstClass ? `${tag}.${firstClass}` : tag;
}

// ── DOMWatcher class ───────────────────────────────────────────────────────

export class DOMWatcher {
  private observer: MutationObserver | null = null;
  private listeners: ((event: DOMChangeEvent) => void)[] = [];
  private installed = false;

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Start observing document.body for DOM mutations.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  install(): void {
    if (this.installed || typeof document === 'undefined') return;
    this.installed = true;

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        this.handleMutation(mutation);
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-hidden', 'open', 'class', 'style'],
    });
  }

  /**
   * Register a callback that fires on every classified DOM change.
   * @returns An unsubscribe function.
   */
  onChange(cb: (event: DOMChangeEvent) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  /**
   * Return a Promise that resolves when any of the listed event types fires.
   * Rejects with a timeout error if no matching event fires within timeoutMs.
   *
   * Useful for waiting on a modal to appear after a button click:
   *   await watcher.waitForChange(['modal_opened'], 2000);
   */
  waitForChange(
    types: DOMChangeEvent['type'][],
    timeoutMs = 2000,
  ): Promise<DOMChangeEvent> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        unsub();
        reject(new Error(`waitForChange timed out after ${timeoutMs}ms (waiting for: ${types.join(', ')})`));
      }, timeoutMs);

      const unsub = this.onChange((event) => {
        if (!settled && types.includes(event.type)) {
          settled = true;
          clearTimeout(timer);
          unsub();
          resolve(event);
        }
      });
    });
  }

  /** Stop observing and disconnect the MutationObserver. */
  uninstall(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.installed = false;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private handleMutation(mutation: MutationRecord): void {
    if (mutation.type === 'childList') {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node as Element;
        this.emit({
          type: classifyAdded(el),
          selector: selectorOf(el),
          textContent: (el.textContent ?? '').trim().slice(0, 120),
          timestamp: Date.now(),
        });
      }

      for (const node of Array.from(mutation.removedNodes)) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node as Element;
        this.emit({
          type: classifyRemoved(el),
          selector: selectorOf(el),
          textContent: (el.textContent ?? '').trim().slice(0, 120),
          timestamp: Date.now(),
        });
      }
      return;
    }

    if (mutation.type === 'attributes') {
      const el = mutation.target as Element;
      const attr = mutation.attributeName ?? '';

      if (attr === 'aria-hidden') {
        const val = el.getAttribute('aria-hidden');
        if (val === 'false') {
          this.emit({
            type: 'modal_opened',
            selector: selectorOf(el),
            textContent: (el.textContent ?? '').trim().slice(0, 120),
            timestamp: Date.now(),
          });
        } else if (val === 'true') {
          this.emit({
            type: 'modal_closed',
            selector: selectorOf(el),
            textContent: '',
            timestamp: Date.now(),
          });
        }
        return;
      }

      if (attr === 'open') {
        const hasOpen = el.hasAttribute('open');
        const type = hasOpen
          ? isDropdown(el)
            ? 'dropdown_opened'
            : 'modal_opened'
          : 'modal_closed';
        this.emit({
          type,
          selector: selectorOf(el),
          textContent: (el.textContent ?? '').trim().slice(0, 120),
          timestamp: Date.now(),
        });
        return;
      }

      // class/style changes on modal-like elements
      if ((attr === 'class' || attr === 'style') && isModal(el)) {
        const visible = !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true';
        this.emit({
          type: visible ? 'modal_opened' : 'modal_closed',
          selector: selectorOf(el),
          textContent: (el.textContent ?? '').trim().slice(0, 120),
          timestamp: Date.now(),
        });
      }
    }
  }

  private emit(event: DOMChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Never let a listener error break observation
      }
    }
  }
}
