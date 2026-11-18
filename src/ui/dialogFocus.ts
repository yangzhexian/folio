export function containTabFocus(event: KeyboardEvent, container: HTMLElement) {
  if (event.key !== 'Tab') return;
  const focusable = container.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]');
  const visible = [...focusable].filter(element => element.offsetParent !== null);
  const first = visible[0];
  const last = visible.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
