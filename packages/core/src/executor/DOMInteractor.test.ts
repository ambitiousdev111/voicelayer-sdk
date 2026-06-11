import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOMInteractor } from './DOMInteractor.js';
import { DOMWatcher } from '../observer/DOMWatcher.js';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Yield one task tick so MutationObserver callbacks can fire. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('DOMInteractor', () => {
  let watcher: DOMWatcher;
  let interactor: DOMInteractor;

  beforeEach(() => {
    watcher = new DOMWatcher();
    watcher.install();
    interactor = new DOMInteractor(watcher);
    document.body.innerHTML = '';
  });

  afterEach(() => {
    watcher.uninstall();
    document.body.innerHTML = '';
  });

  // ── click event order ──────────────────────────────────────────────────

  it('fires mousedown, mouseup, click in order', () => {
    const events: string[] = [];
    const btn = document.createElement('button');
    btn.id = 'order-btn';
    btn.addEventListener('mousedown', () => events.push('mousedown'));
    btn.addEventListener('mouseup', () => events.push('mouseup'));
    btn.addEventListener('click', () => events.push('click'));
    document.body.appendChild(btn);

    interactor.click('#order-btn');
    expect(events).toEqual(['mousedown', 'mouseup', 'click']);
  });

  it('throws ELEMENT_NOT_FOUND when selector matches nothing', () => {
    expect(() => interactor.click('#ghost')).toThrow('element not found');
  });

  // ── fillInput events ───────────────────────────────────────────────────

  it('fires focus, input, change events on fillInput', () => {
    const events: string[] = [];
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'fill-input';
    input.addEventListener('focus', () => events.push('focus'));
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));
    document.body.appendChild(input);

    interactor.fillInput('#fill-input', 'hello world');
    expect(events).toContain('focus');
    expect(events).toContain('input');
    expect(events).toContain('change');
    expect(input.value).toBe('hello world');
  });

  it('fillInput sets the value on a textarea', () => {
    const ta = document.createElement('textarea');
    ta.id = 'fill-ta';
    document.body.appendChild(ta);

    interactor.fillInput('#fill-ta', 'multi\nline');
    expect(ta.value).toBe('multi\nline');
  });

  // ── checkCheckbox ──────────────────────────────────────────────────────

  it('checkCheckbox checks and unchecks', () => {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'cb';
    document.body.appendChild(cb);

    interactor.checkCheckbox('#cb', true);
    expect(cb.checked).toBe(true);

    interactor.checkCheckbox('#cb', false);
    expect(cb.checked).toBe(false);
  });

  // ── selectOption (<select>) ────────────────────────────────────────────

  it('selectOption picks by value', () => {
    const sel = document.createElement('select');
    sel.id = 'sel';
    ['', 'one', 'two', 'three'].forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v || 'Pick one';
      sel.appendChild(opt);
    });
    document.body.appendChild(sel);

    interactor.selectOption('#sel', 'two');
    expect(sel.value).toBe('two');
  });

  it('selectOption picks by visible label (case-insensitive)', () => {
    const sel = document.createElement('select');
    sel.id = 'sel2';
    const opt = document.createElement('option');
    opt.value = 'veg';
    opt.textContent = 'Vegetarian';
    sel.appendChild(opt);
    document.body.appendChild(sel);

    interactor.selectOption('#sel2', 'vegetarian');
    expect(sel.value).toBe('veg');
  });

  // ── closeModal — Escape key ────────────────────────────────────────────

  it('closeModal dispatches Escape keydown that bubbles to document', () => {
    let escapePressed = false;
    document.addEventListener(
      'keydown',
      (e) => { if (e.key === 'Escape') escapePressed = true; },
      { once: true },
    );

    interactor.closeModal();
    expect(escapePressed).toBe(true);
  });

  // ── selectFromDropdown ─────────────────────────────────────────────────

  it('selectFromDropdown opens dropdown, finds item by text, clicks it', async () => {
    const trigger = document.createElement('button');
    trigger.id = 'dd-trigger';
    document.body.appendChild(trigger);

    let selected = '';

    // Append a menu when trigger is clicked
    trigger.addEventListener('click', () => {
      const menu = document.createElement('ul');
      menu.setAttribute('role', 'menu');
      ['Apple', 'Banana', 'Cherry'].forEach((label) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'menuitem');
        li.textContent = label;
        li.addEventListener('click', () => { selected = label; });
        menu.appendChild(li);
      });
      document.body.appendChild(menu);
    });

    await interactor.selectFromDropdown('#dd-trigger', 'Banana');
    expect(selected).toBe('Banana');
  });

  it('selectFromDropdown is case-insensitive', async () => {
    const trigger = document.createElement('button');
    trigger.id = 'dd-ci';
    document.body.appendChild(trigger);

    let selected = '';
    trigger.addEventListener('click', () => {
      const menu = document.createElement('ul');
      menu.setAttribute('role', 'menu');
      const li = document.createElement('li');
      li.setAttribute('role', 'menuitem');
      li.textContent = 'Red';
      li.addEventListener('click', () => { selected = 'Red'; });
      menu.appendChild(li);
      document.body.appendChild(menu);
    });

    await interactor.selectFromDropdown('#dd-ci', 'red');
    expect(selected).toBe('Red');
  });

  // ── clickAndWaitForModal ───────────────────────────────────────────────

  it('clickAndWaitForModal resolves with the modal change event', async () => {
    const btn = document.createElement('button');
    btn.id = 'modal-btn';
    document.body.appendChild(btn);

    btn.addEventListener('click', () => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.textContent = 'Confirm?';
      document.body.appendChild(dialog);
    });

    const change = await interactor.clickAndWaitForModal('#modal-btn');
    expect(change.type).toBe('modal_opened');
  });

  // ── keyPress ──────────────────────────────────────────────────────────

  it('keyPress fires keydown + keyup on the given selector', () => {
    const input = document.createElement('input');
    input.id = 'kp-input';
    document.body.appendChild(input);

    const keys: string[] = [];
    input.addEventListener('keydown', (e) => keys.push(`down:${e.key}`));
    input.addEventListener('keyup', (e) => keys.push(`up:${e.key}`));

    interactor.keyPress('Enter', '#kp-input');
    expect(keys).toEqual(['down:Enter', 'up:Enter']);
  });
});
