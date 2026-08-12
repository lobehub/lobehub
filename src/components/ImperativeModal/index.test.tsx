import { Input, MotionProvider } from '@lobehub/ui';
import { ModalHost } from '@lobehub/ui/base-ui';
import { act, render, screen } from '@testing-library/react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import ImperativeModal from '.';

/** A modal whose input is controlled by state living in the CALLER's tree. */
const Harness = ({ open = true }: { open?: boolean }) => {
  const [value, setValue] = useState('');
  return (
    <MotionProvider motion={motion}>
      <ImperativeModal open={open} title={'title'}>
        <Input
          autoFocus
          data-testid={'field'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </ImperativeModal>
      <ModalHost />
    </MotionProvider>
  );
};

const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
const nativeGet = valueDescriptor.get!;
const nativeSet = valueDescriptor.set!;

/** Records every write that actually changes the node's value. */
const recordValueWrites = (node: HTMLInputElement) => {
  const writes: { from: string; to: string }[] = [];
  Object.defineProperty(node, 'value', {
    configurable: true,
    get: () => nativeGet.call(node),
    set: (next: string) => {
      const from = nativeGet.call(node);
      if (from !== next) writes.push({ from, to: next });
      nativeSet.call(node, next);
    },
  });
  return writes;
};

/** Feeds `node` one composing keystroke, the way a browser IME does. */
const composeStep = async (node: HTMLInputElement, text: string) => {
  nativeSet.call(node, text);
  node.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, isComposing: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('ImperativeModal', () => {
  it('renders children inside the modal and keeps autofocus', async () => {
    render(<Harness />);

    const field = (await screen.findByTestId('field')) as HTMLInputElement;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(field.closest('[role="dialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(field);
  });

  it('never writes back to a controlled input while an IME composition is active', async () => {
    // Regression: modal content used to be handed to the base-ui modal host,
    // a separate React tree that only saw caller state one commit later. React
    // then restored the stale value onto the input at the end of every event,
    // which aborts the composition session and makes CJK input impossible.
    render(<Harness />);

    const field = (await screen.findByTestId('field')) as HTMLInputElement;
    const writes = recordValueWrites(field);

    field.focus();
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    for (const step of ['l', 'la', 'lal', 'lala']) await composeStep(field, step);

    expect(writes).toEqual([]);
    expect(field.value).toBe('lala');
  });

  it('keeps the body mounted while the modal plays its exit animation', async () => {
    // Regression: children used to unmount in the same commit that flipped
    // `open` to false, so the panel went blank and snapped to header height for
    // the whole exit transition.
    const { rerender } = render(<Harness />);

    await screen.findByTestId('field');

    await act(async () => {
      rerender(<Harness open={false} />);
    });

    expect(screen.queryByTestId('field')).not.toBeNull();
  });
});
