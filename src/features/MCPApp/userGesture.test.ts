import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ACTIVATION_WINDOW_MS, createViewGestureGate } from './userGesture';

const activation = { isActive: true };
let clock = 0;

const setup = () => {
  const iframe = document.createElement('iframe');
  const other = document.createElement('button');
  document.body.append(iframe, other);
  const gate = createViewGestureGate(() => clock);

  return { gate, iframe, other };
};

describe('createViewGestureGate', () => {
  beforeEach(() => {
    clock = 1000;
    activation.isActive = true;
    Object.defineProperty(navigator, 'userActivation', { configurable: true, value: activation });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('counts a gesture once focus is in the view and the host has been idle', () => {
    const { gate, iframe } = setup();
    iframe.focus();
    clock += ACTIVATION_WINDOW_MS;

    expect(document.activeElement).toBe(iframe);
    expect(gate.takeGestureIn(iframe)).toBe(true);
    gate.dispose();
  });

  it('does not count anything right after the view mounts', () => {
    const { gate, iframe } = setup();
    iframe.focus();
    clock += ACTIVATION_WINDOW_MS - 1;

    expect(gate.takeGestureIn(iframe)).toBe(false);
    gate.dispose();
  });

  it('does not count an activation the host itself may have produced', () => {
    const { gate, iframe } = setup();
    clock += ACTIVATION_WINDOW_MS;
    window.dispatchEvent(new Event('pointerdown'));
    iframe.focus();
    clock += 1000;

    expect(gate.takeGestureIn(iframe)).toBe(false);

    clock += ACTIVATION_WINDOW_MS;
    expect(gate.takeGestureIn(iframe)).toBe(true);
    gate.dispose();
  });

  it('counts one gesture for one message only', () => {
    const { gate, iframe } = setup();
    iframe.focus();
    clock += ACTIVATION_WINDOW_MS;

    expect(gate.takeGestureIn(iframe)).toBe(true);
    // Still the same activation: a second message must not ride on it
    clock += 100;
    expect(gate.takeGestureIn(iframe)).toBe(false);
    clock += ACTIVATION_WINDOW_MS - 200;
    expect(gate.takeGestureIn(iframe)).toBe(false);

    // That activation has expired, so a live one now comes from a new gesture
    clock += 100;
    expect(gate.takeGestureIn(iframe)).toBe(true);
    gate.dispose();
  });

  it('does not use the gesture up when it does not count', () => {
    const { gate, iframe } = setup();
    clock += ACTIVATION_WINDOW_MS;
    activation.isActive = false;
    iframe.focus();

    expect(gate.takeGestureIn(iframe)).toBe(false);
    activation.isActive = true;
    expect(gate.takeGestureIn(iframe)).toBe(true);
    gate.dispose();
  });

  it('needs both focus in this view and a live activation', () => {
    const { gate, iframe, other } = setup();
    clock += ACTIVATION_WINDOW_MS;

    other.focus();
    expect(gate.takeGestureIn(iframe)).toBe(false);

    iframe.focus();
    activation.isActive = false;
    expect(gate.takeGestureIn(iframe)).toBe(false);
    gate.dispose();
  });

  it('stops watching host gestures once disposed', () => {
    const { gate, iframe } = setup();
    gate.dispose();
    clock += ACTIVATION_WINDOW_MS;
    window.dispatchEvent(new Event('keydown'));
    iframe.focus();

    expect(gate.takeGestureIn(iframe)).toBe(true);
  });
});
