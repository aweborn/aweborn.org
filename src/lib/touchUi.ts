/** Is the phone / tablet layout on (TouchInputAdapter adds `touch-ui` to <html>)? */
export function isTouchUi(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('touch-ui')
}

/**
 * Focus a text field for keyboard players only. On a phone, focusing on our own
 * (opening a sheet, switching a tab or a kind) pops the on-screen keyboard over the
 * sheet the player is still looking at; they tap the field when they want to type.
 */
export function focusForKeyboard(el: HTMLElement | null | undefined): void {
  if (!el || isTouchUi()) return
  el.focus()
}
