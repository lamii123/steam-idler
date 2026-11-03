/**
 * Small DOM helpers shared by the UI modules.
 *
 * `byId` intentionally fails loudly: the markup and the module graph are
 * checked together, so a typo should surface immediately instead of producing
 * a silent `null` at runtime.
 */
export function byId(id) {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }

  return element;
}

/**
 * Keep the visual active state and `aria-pressed` in sync. The active class is
 * optional because some controls (list rows) style their parent element
 * instead of the button itself.
 */
export function setPressed(element, pressed, activeClass = 'active') {
  if (activeClass) {
    element.classList.toggle(activeClass, pressed);
  }

  element.setAttribute('aria-pressed', String(pressed));
}
