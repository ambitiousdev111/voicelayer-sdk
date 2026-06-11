import { describe, it, expect, beforeEach } from 'vitest';
import { DOMScanner } from './DOMScanner.js';
import type { PageAction } from './types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRoot(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

function cleanup(root: HTMLElement): void {
  root.remove();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DOMScanner', () => {
  let scanner: DOMScanner;

  beforeEach(() => {
    scanner = new DOMScanner();
  });

  // ── 1. Basic button is found ──────────────────────────────────────────────

  describe('findInteractiveElements — basic detection', () => {
    it('finds a visible button and maps it to a click action', () => {
      const root = makeRoot(`<button id="submit-btn">Place Order</button>`);

      const map = scanner.scan(root);
      cleanup(root);

      expect(map.availableActions.length).toBeGreaterThanOrEqual(1);

      const action = map.availableActions.find((a) => a.label === 'Place Order');
      expect(action).toBeDefined();
      expect(action?.type).toBe('click');
      expect(action?.selector).toBe('#submit-btn');
      expect(action?.isVisible).toBe(true);
    });

    it('finds a navigation link and marks it as navigate type', () => {
      const root = makeRoot(`<a href="/dashboard">Go to Dashboard</a>`);

      const map = scanner.scan(root);
      cleanup(root);

      const action = map.availableActions.find((a) => a.type === 'navigate');
      expect(action).toBeDefined();
      expect(action?.target).toBe('/dashboard');
      expect(action?.label).toBe('Go to Dashboard');
    });

    it('finds an input field and marks it as input type', () => {
      const root = makeRoot(
        `<input type="text" id="search" placeholder="Search orders" />`,
      );

      const map = scanner.scan(root);
      cleanup(root);

      const action = map.availableActions.find((a) => a.id === 'action_0');
      expect(action).toBeDefined();
      expect(action?.type).toBe('input');
      expect(action?.label).toBe('Search orders');
      expect(action?.selector).toBe('#search');
    });

    it('finds a select element and marks it as select type', () => {
      const root = makeRoot(`
        <select id="meal-type">
          <option value="veg">Vegetarian</option>
        </select>
      `);

      const map = scanner.scan(root);
      cleanup(root);

      const action = map.availableActions.find((a) => a.type === 'select');
      expect(action).toBeDefined();
      expect(action?.selector).toBe('#meal-type');
    });

    it('reads label from aria-label when innerText is empty (React icon button)', () => {
      const root = makeRoot(`
        <button id="close-btn" aria-label="Close dialog">
          <svg><path d="M0 0"/></svg>
        </button>
      `);

      const map = scanner.scan(root);
      cleanup(root);

      const action = map.availableActions.find((a) => a.selector === '#close-btn');
      expect(action?.ariaLabel).toBe('Close dialog');
      expect(action?.label).toBe('Close dialog');
    });

    it('falls back to textContent when innerText is empty (nested span)', () => {
      const root = makeRoot(
        `<button id="nested-btn"><span><span>Add to Cart</span></span></button>`,
      );

      const map = scanner.scan(root);
      cleanup(root);

      const action = map.availableActions.find((a) => a.selector === '#nested-btn');
      expect(action?.label).toContain('Add to Cart');
    });

    it('generates data-testid selector when no id is present', () => {
      const root = makeRoot(`<button data-testid="checkout-btn">Checkout</button>`);

      const map = scanner.scan(root);
      cleanup(root);

      const action = map.availableActions.find((a) => a.label === 'Checkout');
      expect(action?.selector).toBe('[data-testid="checkout-btn"]');
    });
  });

  // ── 2. Hidden elements are excluded ──────────────────────────────────────

  describe('findInteractiveElements — visibility filtering', () => {
    it('excludes a button with display:none inline style', () => {
      const root = makeRoot(`
        <button id="visible-btn">Visible</button>
        <button id="hidden-btn" style="display:none">Hidden</button>
      `);

      const map = scanner.scan(root);
      cleanup(root);

      const ids = map.availableActions.map((a) => a.selector);
      expect(ids).toContain('#visible-btn');
      expect(ids).not.toContain('#hidden-btn');
    });

    it('excludes a button with visibility:hidden inline style', () => {
      const root = makeRoot(`
        <button id="visible-btn">Visible</button>
        <button id="invis-btn" style="visibility:hidden">Invisible</button>
      `);

      const map = scanner.scan(root);
      cleanup(root);

      expect(map.availableActions.map((a) => a.selector)).not.toContain(
        '#invis-btn',
      );
    });

    it('excludes a button whose parent is display:none', () => {
      const root = makeRoot(`
        <div style="display:none">
          <button id="buried-btn">Buried</button>
        </div>
        <button id="ok-btn">OK</button>
      `);

      const map = scanner.scan(root);
      cleanup(root);

      const ids = map.availableActions.map((a) => a.selector);
      expect(ids).not.toContain('#buried-btn');
      expect(ids).toContain('#ok-btn');
    });

    it('excludes elements with the hidden attribute', () => {
      const root = makeRoot(`
        <button id="btn-a">Shown</button>
        <button id="btn-b" hidden>Attr Hidden</button>
      `);

      const map = scanner.scan(root);
      cleanup(root);

      const ids = map.availableActions.map((a) => a.selector);
      expect(ids).toContain('#btn-a');
      expect(ids).not.toContain('#btn-b');
    });

    it('excludes input[type="hidden"]', () => {
      const root = makeRoot(`
        <input type="hidden" id="csrf" value="token123" />
        <input type="text"   id="name" placeholder="Name" />
      `);

      const map = scanner.scan(root);
      cleanup(root);

      const ids = map.availableActions.map((a) => a.selector);
      expect(ids).not.toContain('#csrf');
      expect(ids).toContain('#name');
    });
  });

  // ── 3. SDK's own elements are excluded ───────────────────────────────────

  describe('findInteractiveElements — SDK element exclusion', () => {
    it('excludes a button with a voicelayer-* class', () => {
      const root = makeRoot(`
        <button id="app-btn">App Button</button>
        <button id="vl-btn" class="voicelayer-talk-btn">Talk</button>
      `);

      const map = scanner.scan(root);
      cleanup(root);

      const ids = map.availableActions.map((a) => a.selector);
      expect(ids).toContain('#app-btn');
      expect(ids).not.toContain('#vl-btn');
    });

    it('excludes a button nested inside a voicelayer-* container', () => {
      const root = makeRoot(`
        <div class="voicelayer-overlay">
          <button id="vl-inner-btn">Inner</button>
        </div>
        <button id="host-btn">Host</button>
      `);

      const map = scanner.scan(root);
      cleanup(root);

      const ids = map.availableActions.map((a) => a.selector);
      expect(ids).not.toContain('#vl-inner-btn');
      expect(ids).toContain('#host-btn');
    });

    it('excludes elements inside an element with id starting with "voicelayer"', () => {
      const root = makeRoot(`
        <div id="voicelayer-root">
          <button id="vl-sdk-btn">SDK Btn</button>
        </div>
        <button id="real-btn">Real</button>
      `);

      const map = scanner.scan(root);
      cleanup(root);

      const ids = map.availableActions.map((a) => a.selector);
      expect(ids).not.toContain('#vl-sdk-btn');
      expect(ids).toContain('#real-btn');
    });
  });

  // ── 4. Deduplication ─────────────────────────────────────────────────────

  describe('deduplication', () => {
    it('deduplicates when the same element matches multiple selectors', () => {
      const root = makeRoot(
        `<button id="dup-btn" role="button">Duplicate</button>`,
      );

      const map = scanner.scan(root);
      cleanup(root);

      const matches = map.availableActions.filter((a) => a.selector === '#dup-btn');
      expect(matches).toHaveLength(1);
    });
  });

  // ── 5. Sort order ─────────────────────────────────────────────────────────

  describe('action sort order', () => {
    it('returns navigate actions before click before input', () => {
      const root = makeRoot(`
        <input id="q" type="text" placeholder="Search" />
        <button id="btn">Click me</button>
        <a href="/home" id="link">Home</a>
      `);

      const map = scanner.scan(root);
      cleanup(root);

      const types = map.availableActions.map((a) => a.type);
      const navIdx = types.indexOf('navigate');
      const clickIdx = types.indexOf('click');
      const inputIdx = types.indexOf('input');

      expect(navIdx).toBeLessThan(clickIdx);
      expect(clickIdx).toBeLessThan(inputIdx);
    });
  });

  // ── 6. visibleData extraction ─────────────────────────────────────────────

  describe('extractVisibleData', () => {
    it('picks up [data-voice-data] elements', () => {
      const root = makeRoot(`
        <span data-voice-data="wallet_balance">₹250</span>
      `);

      const map = scanner.scan(root);
      cleanup(root);

      expect(map.visibleData['wallet_balance']).toBe(250);
    });

    it('parses numeric strings to numbers', () => {
      const root = makeRoot(`<span class="stat">42</span>`);

      const map = scanner.scan(root);
      cleanup(root);

      const values = Object.values(map.visibleData);
      expect(values).toContain(42);
    });
  });

  // ── 7. PageIntentMap shape ────────────────────────────────────────────────

  describe('scan() — map shape', () => {
    it('returns a map with all required fields', () => {
      const root = makeRoot(`<button id="x">X</button>`);

      const map = scanner.scan(root);
      cleanup(root);

      expect(map).toHaveProperty('currentPage');
      expect(map).toHaveProperty('currentRoute');
      expect(map).toHaveProperty('availableActions');
      expect(map).toHaveProperty('visibleData');
      expect(map).toHaveProperty('scannedAt');
      expect(map).toHaveProperty('pageTitle');
      expect(map).toHaveProperty('openModals');
      expect(map).toHaveProperty('activeDropdowns');
      expect(map).toHaveProperty('toasts');
      expect(typeof map.scannedAt).toBe('number');
      expect(Array.isArray(map.availableActions)).toBe(true);
      expect(Array.isArray(map.openModals)).toBe(true);
      expect(Array.isArray(map.activeDropdowns)).toBe(true);
      expect(Array.isArray(map.toasts)).toBe(true);
    });
  });

  // ── 8. elementType detection ──────────────────────────────────────────────

  describe('elementType detection', () => {
    it('marks input[type=checkbox] as checkbox', () => {
      const root = makeRoot(`<input type="checkbox" id="agree" />`);
      const map = scanner.scan(root);
      cleanup(root);
      expect(map.availableActions[0]?.elementType).toBe('checkbox');
    });

    it('marks input[type=radio] as radio', () => {
      const root = makeRoot(`<input type="radio" id="opt" />`);
      const map = scanner.scan(root);
      cleanup(root);
      expect(map.availableActions[0]?.elementType).toBe('radio');
    });

    it('marks input[type=search] as search', () => {
      const root = makeRoot(`<input type="search" id="q" />`);
      const map = scanner.scan(root);
      cleanup(root);
      expect(map.availableActions[0]?.elementType).toBe('search');
    });

    it('marks input[type=date] as date-input', () => {
      const root = makeRoot(`<input type="date" id="dob" />`);
      const map = scanner.scan(root);
      cleanup(root);
      expect(map.availableActions[0]?.elementType).toBe('date-input');
    });

    it('marks button[type=submit] as form-submit', () => {
      const root = makeRoot(`<button type="submit" id="sub">Submit</button>`);
      const map = scanner.scan(root);
      cleanup(root);
      const action = map.availableActions.find((a) => a.selector === '#sub');
      expect(action?.elementType).toBe('form-submit');
    });

    it('marks [role=tab] as tab', () => {
      const root = makeRoot(`<button id="tab1" role="tab">Orders</button>`);
      const map = scanner.scan(root);
      cleanup(root);
      const action = map.availableActions.find((a) => a.selector === '#tab1');
      expect(action?.elementType).toBe('tab');
    });

    it('marks [aria-haspopup] as dropdown-trigger', () => {
      const root = makeRoot(
        `<button id="dd" aria-haspopup="listbox">Filter</button>`,
      );
      const map = scanner.scan(root);
      cleanup(root);
      const action = map.availableActions.find((a) => a.selector === '#dd');
      expect(action?.elementType).toBe('dropdown-trigger');
    });

    it('marks a link as link elementType', () => {
      const root = makeRoot(`<a href="/about" id="about-link">About</a>`);
      const map = scanner.scan(root);
      cleanup(root);
      const action = map.availableActions.find((a) => a.selector === '#about-link');
      expect(action?.elementType).toBe('link');
    });
  });

  // ── 9. context detection ──────────────────────────────────────────────────

  describe('context detection', () => {
    it('marks elements inside <nav> as navbar context with nav-item elementType', () => {
      const root = makeRoot(`
        <nav id="main-nav">
          <a href="/home" id="nav-home">Home</a>
        </nav>
      `);
      const map = scanner.scan(root);
      cleanup(root);
      const action = map.availableActions.find((a) => a.selector === '#nav-home');
      expect(action?.context).toBe('navbar');
      expect(action?.elementType).toBe('nav-item');
    });

    it('marks elements inside <footer> as footer context', () => {
      const root = makeRoot(`
        <footer>
          <a href="/legal" id="legal-link">Legal</a>
        </footer>
      `);
      const map = scanner.scan(root);
      cleanup(root);
      const action = map.availableActions.find((a) => a.selector === '#legal-link');
      expect(action?.context).toBe('footer');
    });

    it('marks elements inside [role=dialog] as modal context', () => {
      const root = makeRoot(`
        <div role="dialog">
          <button id="confirm-btn">Confirm</button>
        </div>
      `);
      const map = scanner.scan(root);
      cleanup(root);
      const action = map.availableActions.find((a) => a.selector === '#confirm-btn');
      expect(action?.context).toBe('modal');
    });

    it('marks elements outside any special container as main context', () => {
      const root = makeRoot(`<button id="plain-btn">Click</button>`);
      const map = scanner.scan(root);
      cleanup(root);
      const action = map.availableActions.find((a) => a.selector === '#plain-btn');
      expect(action?.context).toBe('main');
    });
  });

  // ── 10. isDisabled detection ──────────────────────────────────────────────

  describe('isDisabled detection', () => {
    it('marks disabled button', () => {
      const root = makeRoot(`<button id="dis" disabled>Disabled</button>`);
      const map = scanner.scan(root);
      cleanup(root);
      const action = map.availableActions.find((a) => a.selector === '#dis');
      expect(action?.isDisabled).toBe(true);
    });

    it('marks aria-disabled="true" button', () => {
      const root = makeRoot(
        `<button id="aria-dis" aria-disabled="true">ARIA Disabled</button>`,
      );
      const map = scanner.scan(root);
      cleanup(root);
      const action = map.availableActions.find((a) => a.selector === '#aria-dis');
      expect(action?.isDisabled).toBe(true);
    });

    it('marks element with .disabled class', () => {
      const root = makeRoot(
        `<button id="cls-dis" class="disabled">Class Disabled</button>`,
      );
      const map = scanner.scan(root);
      cleanup(root);
      const action = map.availableActions.find((a) => a.selector === '#cls-dis');
      expect(action?.isDisabled).toBe(true);
    });

    it('does not mark a normal button as disabled', () => {
      const root = makeRoot(`<button id="enabled">Enabled</button>`);
      const map = scanner.scan(root);
      cleanup(root);
      const action = map.availableActions.find((a) => a.selector === '#enabled');
      expect(action?.isDisabled).toBe(false);
    });
  });

  // ── 11. currentValue / options / placeholder ──────────────────────────────

  describe('value info extraction', () => {
    it('extracts placeholder from input', () => {
      const root = makeRoot(
        `<input id="ph" type="text" placeholder="Enter name" />`,
      );
      const map = scanner.scan(root);
      cleanup(root);
      const action = map.availableActions.find((a) => a.selector === '#ph');
      expect(action?.placeholder).toBe('Enter name');
    });

    it('extracts options from <select>', () => {
      const root = makeRoot(`
        <select id="sel">
          <option value="a">Alpha</option>
          <option value="b">Beta</option>
        </select>
      `);
      const map = scanner.scan(root);
      cleanup(root);
      const action = map.availableActions.find((a) => a.selector === '#sel');
      expect(action?.options).toContain('Alpha');
      expect(action?.options).toContain('Beta');
    });

    it('extracts currentValue for checkbox (true/false string)', () => {
      const root = makeRoot(`<input type="checkbox" id="chk" />`);
      const el = document.querySelector<HTMLInputElement>('#chk')!;
      if (el) el.checked = true;

      const map = scanner.scan(root);
      cleanup(root);
      const action = map.availableActions.find((a) => a.selector === '#chk');
      // currentValue is a string representation of checked state
      expect(['true', 'false']).toContain(action?.currentValue);
    });
  });

  // ── 12. scanOpenModals ────────────────────────────────────────────────────

  describe('scanOpenModals()', () => {
    it('returns actions from a visible [role=dialog]', () => {
      const root = makeRoot(`
        <div role="dialog">
          <button id="modal-close">Close</button>
          <button id="modal-confirm">Confirm</button>
        </div>
      `);
      // Ensure element is visible (happy-dom: no CSS)
      document.body.appendChild(root);

      const modals = scanner.scanOpenModals();
      root.remove();

      const selectors = modals.map((a) => a.selector);
      expect(selectors).toContain('#modal-close');
      expect(selectors).toContain('#modal-confirm');
    });

    it('returns empty array when no modal is visible', () => {
      const root = makeRoot(`<button id="plain">Plain</button>`);
      const modals = scanner.scanOpenModals();
      cleanup(root);
      expect(modals).toHaveLength(0);
    });
  });

  // ── 13. scanToasts ────────────────────────────────────────────────────────

  describe('scanToasts()', () => {
    it('returns text from a visible [role=alert]', () => {
      const alert = document.createElement('div');
      alert.setAttribute('role', 'alert');
      alert.textContent = 'Order placed successfully!';
      document.body.appendChild(alert);

      const toasts = scanner.scanToasts();
      document.body.removeChild(alert);

      expect(toasts).toContain('Order placed successfully!');
    });

    it('truncates toast text to 100 chars', () => {
      const alert = document.createElement('div');
      alert.setAttribute('role', 'alert');
      alert.textContent = 'x'.repeat(200);
      document.body.appendChild(alert);

      const toasts = scanner.scanToasts();
      document.body.removeChild(alert);

      expect(toasts[0]!.length).toBe(100);
    });

    it('returns empty array when no toasts are present', () => {
      expect(scanner.scanToasts()).toHaveLength(0);
    });
  });
});
