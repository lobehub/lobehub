/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import { shouldVetoMenuClose } from './menuCloseVeto';

const pressOn = (
  target: EventTarget | null,
  reason: string,
  relatedTarget?: EventTarget | null,
) => {
  const event =
    relatedTarget === undefined
      ? new Event('pointerdown')
      : new FocusEvent('focusout', { relatedTarget: relatedTarget ?? undefined });
  if (target) Object.defineProperty(event, 'target', { value: target });
  return { event, reason };
};

describe('shouldVetoMenuClose', () => {
  const buildDialog = (role: 'dialog' | 'alertdialog') => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', role);
    const button = document.createElement('button');
    dialog.append(button);
    document.body.append(dialog);
    return { button, dialog };
  };

  it('vetoes an outside-press whose target sits inside a dialog overlay', () => {
    const { button } = buildDialog('dialog');
    expect(shouldVetoMenuClose(pressOn(button, 'outside-press'))).toBe(true);
  });

  it('vetoes an outside-press inside an alertdialog (uninstall confirm)', () => {
    const { button } = buildDialog('alertdialog');
    expect(shouldVetoMenuClose(pressOn(button, 'outside-press'))).toBe(true);
  });

  it('vetoes a focus-out whose focus lands inside a dialog overlay', () => {
    const { button } = buildDialog('dialog');
    expect(shouldVetoMenuClose(pressOn(document.body, 'focus-out', button))).toBe(true);
  });

  it('does not veto a press on the page background', () => {
    const outside = document.createElement('div');
    document.body.append(outside);
    expect(shouldVetoMenuClose(pressOn(outside, 'outside-press'))).toBe(false);
  });

  it('does not veto escape-key or item-press closes', () => {
    const { button } = buildDialog('dialog');
    expect(shouldVetoMenuClose(pressOn(button, 'escape-key'))).toBe(false);
    expect(shouldVetoMenuClose(pressOn(button, 'item-press'))).toBe(false);
  });

  it('does not veto when details are missing', () => {
    expect(shouldVetoMenuClose(undefined)).toBe(false);
    expect(shouldVetoMenuClose({ reason: 'outside-press' })).toBe(false);
  });
});
