import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HANDOFF_MAX_MS, waitForAnswerInView } from './waitForAnswerInView';

const FRAME_MS = 16;

const rect = (top: number, bottom: number) => ({ bottom, top }) as DOMRect;

const setup = () => {
  const container = document.createElement('div');
  document.body.append(container);
  container.getBoundingClientRect = () => rect(0, 600);
  const renderAnswer = (bottom: number, id = 'msg_final__answer') => {
    const answer = document.createElement('div');
    answer.id = id;
    let current = bottom;
    answer.getBoundingClientRect = () => rect(current - 80, current);
    container.append(answer);
    return { moveTo: (next: number) => (current = next) };
  };
  return { container, renderAnswer };
};

describe('waitForAnswerInView', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits while the list has not rendered the final answer yet', () => {
    const { container } = setup();
    const onReady = vi.fn();

    waitForAnswerInView({ container, messageId: 'msg_final', onReady });
    vi.advanceTimersByTime(FRAME_MS * 10);

    expect(onReady).not.toHaveBeenCalled();
  });

  it('waits while the final answer sits below the visible part of the list', () => {
    const { container, renderAnswer } = setup();
    renderAnswer(1400);
    const onReady = vi.fn();

    waitForAnswerInView({ container, messageId: 'msg_final', onReady });
    vi.advanceTimersByTime(FRAME_MS * 10);

    expect(onReady).not.toHaveBeenCalled();
  });

  it('hands off once the final answer is in view and holds still', () => {
    const { container, renderAnswer } = setup();
    const answer = renderAnswer(1400);
    const onReady = vi.fn();

    waitForAnswerInView({ container, messageId: 'msg_final', onReady });
    vi.advanceTimersByTime(FRAME_MS * 3);
    answer.moveTo(520);
    vi.advanceTimersByTime(FRAME_MS);
    answer.moveTo(560);
    vi.advanceTimersByTime(FRAME_MS);

    expect(onReady).not.toHaveBeenCalled();

    vi.advanceTimersByTime(FRAME_MS * 3);

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('finds a single message rendered under its own id', () => {
    const { container, renderAnswer } = setup();
    renderAnswer(560, 'msg_final');
    const onReady = vi.fn();

    waitForAnswerInView({ container, messageId: 'msg_final', onReady });
    vi.advanceTimersByTime(FRAME_MS * 4);

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('ignores a copy of the answer outside the list', () => {
    const { container } = setup();
    const outside = document.createElement('div');
    outside.id = 'msg_final__answer';
    outside.getBoundingClientRect = () => rect(480, 560);
    document.body.prepend(outside);
    const onReady = vi.fn();

    waitForAnswerInView({ container, messageId: 'msg_final', onReady });
    vi.advanceTimersByTime(FRAME_MS * 10);

    expect(onReady).not.toHaveBeenCalled();
  });

  it('hands off after the time cap even if the answer never shows', () => {
    const { container } = setup();
    const onReady = vi.fn();

    waitForAnswerInView({ container, messageId: 'msg_final', onReady });
    vi.advanceTimersByTime(HANDOFF_MAX_MS);

    expect(onReady).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(HANDOFF_MAX_MS);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('stops waiting once cancelled', () => {
    const { container, renderAnswer } = setup();
    renderAnswer(560);
    const onReady = vi.fn();

    const cancel = waitForAnswerInView({ container, messageId: 'msg_final', onReady });
    cancel();
    vi.advanceTimersByTime(HANDOFF_MAX_MS * 2);

    expect(onReady).not.toHaveBeenCalled();
  });
});
