import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOMWatcher } from './DOMWatcher.js';
import type { DOMChangeEvent } from './DOMWatcher.js';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Wait one task tick for MutationObserver callbacks to fire. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('DOMWatcher', () => {
  let watcher: DOMWatcher;

  beforeEach(() => {
    watcher = new DOMWatcher();
    watcher.install();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    watcher.uninstall();
    document.body.innerHTML = '';
  });

  // ── Modal detection ─────────────────────────────────────────────────────

  it('emits modal_opened when a dialog element is appended', async () => {
    const events: DOMChangeEvent[] = [];
    watcher.onChange((e) => events.push(e));

    const el = document.createElement('div');
    el.setAttribute('role', 'dialog');
    el.textContent = 'Checkout modal';
    document.body.appendChild(el);

    await tick();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('modal_opened');
    expect(events[0].textContent).toBe('Checkout modal');
  });

  it('emits modal_opened for a <dialog> tag', async () => {
    const events: DOMChangeEvent[] = [];
    watcher.onChange((e) => events.push(e));

    const el = document.createElement('dialog');
    el.textContent = 'Native dialog';
    document.body.appendChild(el);

    await tick();
    const modalEvents = events.filter((e) => e.type === 'modal_opened');
    expect(modalEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('emits modal_opened for element with modal class', async () => {
    const events: DOMChangeEvent[] = [];
    watcher.onChange((e) => events.push(e));

    const el = document.createElement('div');
    el.className = 'modal-container';
    document.body.appendChild(el);

    await tick();
    expect(events[0].type).toBe('modal_opened');
  });

  it('emits modal_closed when a dialog is removed', async () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'dialog');
    document.body.appendChild(el);
    await tick();

    const events: DOMChangeEvent[] = [];
    watcher.onChange((e) => events.push(e));
    document.body.removeChild(el);
    await tick();

    expect(events[0].type).toBe('modal_closed');
  });

  // ── Toast / Notification detection ─────────────────────────────────────

  it('emits toast for an element with role=alert', async () => {
    const events: DOMChangeEvent[] = [];
    watcher.onChange((e) => events.push(e));

    const el = document.createElement('div');
    el.setAttribute('role', 'alert');
    el.textContent = 'Order placed!';
    document.body.appendChild(el);

    await tick();
    expect(events[0].type).toBe('toast');
    expect(events[0].textContent).toBe('Order placed!');
  });

  it('emits toast for an element with toast class', async () => {
    const events: DOMChangeEvent[] = [];
    watcher.onChange((e) => events.push(e));

    const el = document.createElement('div');
    el.className = 'toast-message success';
    document.body.appendChild(el);

    await tick();
    expect(events[0].type).toBe('toast');
  });

  // ── Dropdown detection ──────────────────────────────────────────────────

  it('emits dropdown_opened for an element with role=menu', async () => {
    const events: DOMChangeEvent[] = [];
    watcher.onChange((e) => events.push(e));

    const el = document.createElement('ul');
    el.setAttribute('role', 'menu');
    document.body.appendChild(el);

    await tick();
    expect(events[0].type).toBe('dropdown_opened');
  });

  it('emits dropdown_opened for an element with dropdown class', async () => {
    const events: DOMChangeEvent[] = [];
    watcher.onChange((e) => events.push(e));

    const el = document.createElement('div');
    el.className = 'dropdown-list';
    document.body.appendChild(el);

    await tick();
    expect(events[0].type).toBe('dropdown_opened');
  });

  // ── Generic content changes ─────────────────────────────────────────────

  it('emits content_added for a plain div', async () => {
    const events: DOMChangeEvent[] = [];
    watcher.onChange((e) => events.push(e));

    const el = document.createElement('div');
    el.textContent = 'Hello world';
    document.body.appendChild(el);

    await tick();
    expect(events[0].type).toBe('content_added');
    expect(events[0].textContent).toBe('Hello world');
  });

  it('truncates textContent to 120 chars', async () => {
    const events: DOMChangeEvent[] = [];
    watcher.onChange((e) => events.push(e));

    const el = document.createElement('div');
    el.textContent = 'a'.repeat(200);
    document.body.appendChild(el);

    await tick();
    expect(events[0].textContent.length).toBe(120);
  });

  // ── aria-hidden attribute change ────────────────────────────────────────

  it('emits modal_opened when aria-hidden flips to false on a dialog', async () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    await tick();

    const events: DOMChangeEvent[] = [];
    watcher.onChange((e) => events.push(e));

    el.setAttribute('aria-hidden', 'false');
    await tick();

    const openEvents = events.filter((e) => e.type === 'modal_opened');
    expect(openEvents.length).toBeGreaterThanOrEqual(1);
  });

  // ── onChange unsubscribe ────────────────────────────────────────────────

  it('unsubscribe function stops the listener from firing', async () => {
    const events: DOMChangeEvent[] = [];
    const unsub = watcher.onChange((e) => events.push(e));

    unsub(); // immediately unsubscribe

    const el = document.createElement('div');
    document.body.appendChild(el);
    await tick();

    expect(events).toHaveLength(0);
  });

  // ── waitForChange ───────────────────────────────────────────────────────

  it('waitForChange resolves when the expected type fires', async () => {
    const promise = watcher.waitForChange(['modal_opened'], 500);

    const el = document.createElement('div');
    el.setAttribute('role', 'dialog');
    document.body.appendChild(el);

    const event = await promise;
    expect(event.type).toBe('modal_opened');
  });

  it('waitForChange rejects on timeout', async () => {
    await expect(watcher.waitForChange(['modal_opened'], 50)).rejects.toThrow('timed out');
  });

  // ── install idempotency ─────────────────────────────────────────────────

  it('install() is idempotent — double-install does not double-emit', async () => {
    watcher.install(); // second call
    const events: DOMChangeEvent[] = [];
    watcher.onChange((e) => events.push(e));

    const el = document.createElement('div');
    el.setAttribute('role', 'dialog');
    document.body.appendChild(el);
    await tick();

    expect(events).toHaveLength(1);
  });

  // ── selector generation ─────────────────────────────────────────────────

  it('uses #id as selector when element has an id', async () => {
    const events: DOMChangeEvent[] = [];
    watcher.onChange((e) => events.push(e));

    const el = document.createElement('div');
    el.id = 'checkout-modal';
    el.setAttribute('role', 'dialog');
    document.body.appendChild(el);

    await tick();
    expect(events[0].selector).toBe('#checkout-modal');
  });
});
