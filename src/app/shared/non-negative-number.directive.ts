import { Directive, HostListener } from '@angular/core';

/**
 * nonNegativeNumber directive
 * Usage: <input type="number" dwNonNegative>
 * Prevents typing or pasting negative values and coerces value to >= 0.
 */
@Directive({
  selector: 'input[type=number][dwNonNegative]',
  standalone: true
})
export class NonNegativeNumberDirective {
  @HostListener('keydown', ['$event']) onKeyDown(ev: KeyboardEvent) {
    // Block minus sign and 'e' (scientific notation) to keep integers only
    if (ev.key === '-' || ev.key === 'e' || ev.key === 'E' || ev.key === '+') {
      ev.preventDefault();
    }
  }

  @HostListener('paste', ['$event']) onPaste(ev: ClipboardEvent) {
    const data = ev.clipboardData?.getData('text') ?? '';
    if (/^-/.test(data)) {
      ev.preventDefault();
    }
  }

  @HostListener('input', ['$event']) onInput(ev: Event) {
    const el = ev.target as HTMLInputElement;
    if (!el) return;
    if (el.value === '') return; // allow empty
    const num = Number(el.value);
    if (!Number.isFinite(num) || num < 0) {
      el.value = '0';
      const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      if (native && native.set) native.set.call(el, '0');
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
}
