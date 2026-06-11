/**
 * PageAction — a single interactive element discovered on the host page.
 */
export interface PageAction {
  /** Stable identifier assigned during scanning: "action_0", "action_1", … */
  id: string;
  /** Human-readable label derived from text/aria/placeholder/alt. Max 60 chars. */
  label: string;
  /** Semantic type used by the executor to choose the right interaction strategy. */
  type: 'navigate' | 'click' | 'input' | 'select' | 'submit';
  /**
   * Fine-grained element classification — used for richer AI prompting and
   * DOMInteractor routing decisions.
   */
  elementType:
    | 'button'
    | 'link'
    | 'input'
    | 'select'
    | 'checkbox'
    | 'radio'
    | 'tab'
    | 'accordion'
    | 'dropdown-trigger'
    | 'modal-trigger'
    | 'nav-item'
    | 'search'
    | 'date-input'
    | 'custom-select'
    | 'form-submit'
    | 'other';
  /**
   * Where on the page this element lives — guides prompt grouping and the AI's
   * understanding of layout context.
   */
  context: 'navbar' | 'modal' | 'sidebar' | 'main' | 'footer' | 'floating' | 'unknown';
  /** True when the element is disabled (HTML disabled attr, aria-disabled, or .disabled class). */
  isDisabled: boolean;
  /**
   * CSS selector guaranteed to uniquely identify this element.
   * Priority: #id > [data-testid] > :nth-child path
   */
  selector: string;
  /** `href` value for navigate actions, undefined otherwise. */
  target?: string;
  /** Raw value of the element's aria-label attribute, if present. */
  ariaLabel?: string;
  /** True if the element is visible; false for hidden actions in hiddenActions list. */
  isVisible: boolean;
  /** Bounding box in viewport-relative pixels, if available. */
  boundingBox?: { top: number; left: number; width: number; height: number };
  /** Current value for text inputs, selects, and checkboxes (stringified). */
  currentValue?: string;
  /** Up to 10 option labels for select / combobox / custom-dropdown elements. */
  options?: string[];
  /** Placeholder text for input and textarea elements. */
  placeholder?: string;
}

/**
 * PageIntentMap — a snapshot of the host page at a moment in time.
 */
export interface PageIntentMap {
  /** Best human name for this page: h1 text → document.title → route. */
  currentPage: string;
  /** Current pathname + search string, e.g. "/dashboard?tab=orders". */
  currentRoute: string;
  /** Deduplicated, sorted list of all interactive elements in the current focus context. */
  availableActions: PageAction[];
  /**
   * Key/value pairs of semantically meaningful visible data.
   * E.g. { "total_orders": 42, "wallet_balance": "₹150" }.
   */
  visibleData: Record<string, string | number>;
  /** Unix timestamp (ms) when scan() was called. */
  scannedAt: number;
  /** Raw document.title at scan time. */
  pageTitle: string;
  /**
   * Interactive elements that are currently hidden (display:none / aria-hidden).
   * These may appear after a user action — AI can reference them as potential targets.
   */
  hiddenActions: PageAction[];
  /**
   * Describes where the user's keyboard focus is, which determines which
   * subset of actions is active.
   */
  focusContext: 'page' | 'modal' | 'dropdown' | 'drawer';
  /** Interactive elements inside currently-visible modal/dialog containers. */
  openModals: PageAction[];
  /** Option items inside currently-open dropdown menus or listboxes. */
  activeDropdowns: PageAction[];
  /** Text content of visible toast / snackbar / alert elements (max 100 chars each). */
  toasts: string[];
}
