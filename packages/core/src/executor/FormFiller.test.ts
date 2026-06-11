import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FormFiller } from './FormFiller.js';
import { DOMInteractor } from './DOMInteractor.js';
import { DOMWatcher } from '../observer/DOMWatcher.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeInput(type = 'text', id = 'test-input'): HTMLInputElement {
  const el = document.createElement('input');
  el.type = type;
  el.id = id;
  document.body.appendChild(el);
  return el;
}

function makeSelect(id = 'test-select'): HTMLSelectElement {
  const el = document.createElement('select');
  el.id = id;
  const OPTIONS = [
    { value: '',       label: 'Select…'         },
    { value: 'veg',    label: 'Vegetarian'       },
    { value: 'nonveg', label: 'Non-vegetarian'   },
    { value: 'vegan',  label: 'Vegan'            },
  ];
  OPTIONS.forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    el.appendChild(opt);
  });
  document.body.appendChild(el);
  return el;
}

describe('FormFiller', () => {
  let watcher: DOMWatcher;
  let interactor: DOMInteractor;
  let filler: FormFiller;

  beforeEach(() => {
    document.body.innerHTML = '';
    watcher = new DOMWatcher();
    watcher.install();
    interactor = new DOMInteractor(watcher);
    filler = new FormFiller(interactor);
  });

  afterEach(() => {
    watcher.uninstall();
    document.body.innerHTML = '';
  });

  it('fills a text input by ID selector', () => {
    const el = makeInput('text', 'name-field');
    filler.fill({ '#name-field': 'Vardaan' });
    expect(el.value).toBe('Vardaan');
  });

  it('fires input + change events on text fill', () => {
    const el = makeInput('text', 'city-field');
    const inputEvents: string[] = [];
    el.addEventListener('input', () => inputEvents.push('input'));
    el.addEventListener('change', () => inputEvents.push('change'));

    filler.fill({ '#city-field': 'Delhi' });
    expect(inputEvents).toContain('input');
    expect(inputEvents).toContain('change');
  });

  it('fills a select by option value (case-insensitive)', () => {
    const el = makeSelect('meal');
    filler.fill({ '#meal': 'veg' });
    expect(el.value).toBe('veg');
  });

  it('fills a select by option label (case-insensitive)', () => {
    const el = makeSelect('meal2');
    filler.fill({ '#meal2': 'Vegetarian' });
    expect(el.value).toBe('veg');
  });

  it('adds highlight outline to filled field', () => {
    const el = makeInput('text', 'hl-field');
    filler.fill({ '#hl-field': 'test' });
    expect(el.style.outline).toContain('6C47FF');
    expect(el.getAttribute('data-voicelayer-filled')).toBe('');
  });

  it('clearHighlights removes outline and attribute', () => {
    const el = makeInput('text', 'clr-field');
    filler.fill({ '#clr-field': 'hello' });
    filler.clearHighlights();
    expect(el.getAttribute('data-voicelayer-filled')).toBeNull();
    expect(el.style.outline).toBe('');
  });

  it('logs warning and skips missing selector', () => {
    expect(() => filler.fill({ '#does-not-exist': 'value' })).not.toThrow();
  });

  it('fills checkbox to checked for truthy value', () => {
    const el = makeInput('checkbox', 'chk');
    filler.fill({ '#chk': 'true' });
    expect(el.checked).toBe(true);
  });

  it('fills checkbox to unchecked for falsy value', () => {
    const el = makeInput('checkbox', 'chk2');
    el.checked = true;
    filler.fill({ '#chk2': 'false' });
    expect(el.checked).toBe(false);
  });
});
