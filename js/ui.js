// Shared UI wiring used instead of inline on* attributes (keeps the pages CSP-compatible).
//
// Event delegation:
//   data-action="fnName"   click  -> window.fnName(...args)
//   data-submit="fnName"   submit -> window.fnName(event)
//   data-change="fnName"   change -> window.fnName(...args)
//   data-input="fnName"    input  -> window.fnName(...args)
//   data-args='["a", 1]'   optional JSON argument list; the tokens "$el", "$event",
//                          "$checked" and "$value" are replaced with the element,
//                          the event, element.checked and element.value.
//   data-activate          also fire the click action on Enter / Space (role="button" elements)
//
// Dialogs: every .slip-overlay / .del-modal-backdrop is treated as a modal dialog.
//   data-close="fnName"    function that closes it (backdrop click and Escape call it)
(function () {
  function resolveArgs(el, event) {
    let args = [];
    if (el.dataset.args) {
      try {
        args = JSON.parse(el.dataset.args);
      } catch (error) {
        console.error('Invalid data-args on', el, error);
        return null;
      }
    }
    return args.map(arg => {
      if (arg === '$el') return el;
      if (arg === '$event') return event;
      if (arg === '$checked') return el.checked;
      if (arg === '$value') return el.value;
      return arg;
    });
  }

  function invoke(name, el, event, defaultArgs) {
    const fn = window[name];
    if (typeof fn !== 'function') {
      console.error(`UI action "${name}" is not defined.`);
      return;
    }
    const args = el.dataset.args ? resolveArgs(el, event) : defaultArgs;
    if (args) fn.apply(el, args);
  }

  document.addEventListener('click', event => {
    const el = event.target.closest('[data-action]');
    if (!el || el.disabled) return;
    invoke(el.dataset.action, el, event, []);
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const el = event.target.closest('[data-activate][data-action]');
    if (!el || el !== event.target) return;
    event.preventDefault();
    invoke(el.dataset.action, el, event, []);
  });

  document.addEventListener('submit', event => {
    const form = event.target.closest('[data-submit]');
    if (!form) return;
    invoke(form.dataset.submit, form, event, [event]);
  });

  document.addEventListener('change', event => {
    const el = event.target.closest('[data-change]');
    if (!el) return;
    invoke(el.dataset.change, el, event, []);
  });

  document.addEventListener('input', event => {
    const el = event.target.closest('[data-input]');
    if (!el) return;
    invoke(el.dataset.input, el, event, []);
  });

  // ── Dialogs ────────────────────────────────────────────────────────────────
  const OVERLAY = '.slip-overlay, .del-modal-backdrop';
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const openStack = [];
  const returnFocus = new WeakMap();
  let labelCounter = 0;
  // Last control used outside any dialog: openers often move focus themselves before
  // the dialog is observed as open, so document.activeElement is not reliable then.
  let lastOutsideControl = null;

  function rememberOutside(event) {
    const control = event.target.closest?.(FOCUSABLE);
    if (control && !control.closest(OVERLAY)) lastOutsideControl = control;
  }
  document.addEventListener('focusin', rememberOutside, true);
  document.addEventListener('pointerdown', rememberOutside, true);
  document.addEventListener('click', rememberOutside, true);

  function isVisible(el) {
    return el.offsetParent !== null || el.getClientRects().length > 0;
  }

  function panelOf(overlay) {
    return overlay.querySelector('[role="dialog"]') || overlay.firstElementChild;
  }

  function prepare(overlay) {
    const panel = panelOf(overlay);
    if (!panel || panel.dataset.dialogReady) return;
    panel.dataset.dialogReady = 'true';
    panel.setAttribute('role', panel.getAttribute('role') || 'dialog');
    panel.setAttribute('aria-modal', 'true');
    if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
    if (!panel.hasAttribute('aria-labelledby') && !panel.hasAttribute('aria-label')) {
      const heading = panel.querySelector('h1, h2, h3');
      if (heading) {
        if (!heading.id) heading.id = `dialog-title-${++labelCounter}`;
        panel.setAttribute('aria-labelledby', heading.id);
      }
    }
  }

  function closeOverlay(overlay) {
    const closeName = overlay.dataset.close;
    if (closeName && typeof window[closeName] === 'function') window[closeName]();
    else overlay.classList.remove('open');
  }

  function handleOpened(overlay) {
    if (openStack.includes(overlay)) return;
    prepare(overlay);
    const active = document.activeElement;
    const activeIsOutside = active && active !== document.body && !active.closest(OVERLAY);
    returnFocus.set(overlay, activeIsOutside ? active : lastOutsideControl);
    openStack.push(overlay);
    // Wait a frame so content filled in by the opener is in place before focusing.
    requestAnimationFrame(() => {
      if (!overlay.classList.contains('open')) return;
      const panel = panelOf(overlay);
      const field = [...panel.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]), select, textarea')]
        .find(el => !el.disabled && isVisible(el));
      if (!panel.contains(document.activeElement)) (field || panel).focus({ preventScroll: true });
    });
  }

  function handleClosed(overlay) {
    const index = openStack.indexOf(overlay);
    if (index === -1) return;
    openStack.splice(index, 1);
    const previous = returnFocus.get(overlay);
    returnFocus.delete(overlay);
    if (previous && previous.isConnected && isVisible(previous) && !openStack.length) {
      previous.focus({ preventScroll: true });
    }
  }

  function watch(overlay) {
    if (overlay.dataset.dialogWatched) return;
    overlay.dataset.dialogWatched = 'true';
    prepare(overlay);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeOverlay(overlay);
    });
    new MutationObserver(() => {
      if (overlay.classList.contains('open')) handleOpened(overlay);
      else handleClosed(overlay);
    }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
    if (overlay.classList.contains('open')) handleOpened(overlay);
  }

  document.addEventListener('keydown', event => {
    const top = openStack[openStack.length - 1];
    if (!top) return;
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      closeOverlay(top);
      return;
    }
    if (event.key !== 'Tab') return;
    // Keep keyboard focus inside the open dialog.
    const panel = panelOf(top);
    const focusable = [...panel.querySelectorAll(FOCUSABLE)].filter(isVisible);
    if (!focusable.length) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!panel.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  });

  function init() {
    document.querySelectorAll(OVERLAY).forEach(watch);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Escape a value list for use inside a data-args="..." attribute in HTML templates.
  window.actionArgs = (...args) => JSON.stringify(args)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
})();
