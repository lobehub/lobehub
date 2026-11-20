/**
 * @vitest-environment happy-dom
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DragUploadProvider, useDragUploadContext } from './DragUploadProvider';

const state = { dragging: false, kind: 'none' as string };

const Probe = () => {
  const { isDraggingGlobally, dragContentKind } = useDragUploadContext();
  state.dragging = isDraggingGlobally;
  state.kind = dragContentKind;
  return null;
};

const renderProvider = () =>
  render(
    <DragUploadProvider>
      <Probe />
    </DragUploadProvider>,
  );

const fireDragEvent = async (type: string, relatedTarget: EventTarget | null = null) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: { types: ['Files'], items: [] }, configurable: true },
    relatedTarget: { value: relatedTarget, configurable: true },
  });
  await act(async () => {
    window.dispatchEvent(event);
  });
};

describe('DragUploadProvider', () => {
  beforeEach(() => {
    state.dragging = false;
    state.kind = 'none';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the overlay on dragenter and closes it on drop', async () => {
    renderProvider();

    await fireDragEvent('dragenter');
    expect(state.dragging).toBe(true);

    await fireDragEvent('drop');
    expect(state.dragging).toBe(false);
    expect(state.kind).toBe('none');
  });

  it('keeps the overlay open across nested enter/leave until the last leave', async () => {
    renderProvider();

    const child = document.createElement('div');
    document.body.appendChild(child);

    await fireDragEvent('dragenter');
    // entering a child bumps the counter again
    await fireDragEvent('dragenter', child);
    expect(state.dragging).toBe(true);

    // leaving one layer keeps the drag alive
    await fireDragEvent('dragleave', child);
    expect(state.dragging).toBe(true);

    // the final leave (back to the page) closes it
    await fireDragEvent('dragleave', document.body);
    expect(state.dragging).toBe(false);
  });

  it('hard-resets when dragleave has a null relatedTarget (left the window)', async () => {
    renderProvider();

    await fireDragEvent('dragenter');
    await fireDragEvent('dragenter');
    expect(state.dragging).toBe(true);

    await fireDragEvent('dragleave', null);
    expect(state.dragging).toBe(false);
  });

  it('watchdog force-closes the overlay when dragover goes idle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000));

    renderProvider();

    await fireDragEvent('dragenter');
    expect(state.dragging).toBe(true);

    // the drag ended without any matching event (Esc / drop outside the
    // window / a lost dragleave): dragover goes silent and the watchdog
    // must recover
    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });

    expect(state.dragging).toBe(false);
    expect(state.kind).toBe('none');
  });

  it('watchdog does not fire while dragover keeps firing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2_000_000));

    renderProvider();

    await fireDragEvent('dragenter');

    // simulate a 3s long active drag with continuous dragover events
    for (let i = 0; i < 10; i += 1) {
      await fireDragEvent('dragover');
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
    }

    expect(state.dragging).toBe(true);

    await fireDragEvent('drop');
    expect(state.dragging).toBe(false);
  });
});
