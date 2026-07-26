/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  highlightMessageWhenScrollSettles,
  isTopicCommentAnchorDeleted,
  resolveTopicCommentMessageLocation,
} from './messageLocator';

describe('isTopicCommentAnchorDeleted', () => {
  it('uses the persisted foreign-key state instead of current message locatability', () => {
    expect(isTopicCommentAnchorDeleted('message-not-currently-loaded')).toBe(false);
    expect(isTopicCommentAnchorDeleted(null)).toBe(true);
  });
});

describe('resolveTopicCommentMessageLocation', () => {
  it('locates a main-conversation message at its rendered index', () => {
    expect(
      resolveTopicCommentMessageLocation([{ id: 'message-1' }, { id: 'message-2' }], 'message-2'),
    ).toEqual({ elementId: 'message-2', index: 1 });
  });

  it('locates a message rendered in the active thread', () => {
    expect(
      resolveTopicCommentMessageLocation(
        [{ id: 'message-1' }, { id: 'thread-message', threadId: 'thread-1' }],
        'thread-message',
      ),
    ).toEqual({ elementId: 'thread-message', index: 1 });
  });

  it('locates a persisted task inside its virtual aggregate row', () => {
    expect(
      resolveTopicCommentMessageLocation(
        [{ id: 'virtual-tasks', tasks: [{ id: 'message-2' }] }],
        'message-2',
      ),
    ).toEqual({ elementId: 'virtual-tasks', index: 0 });
  });
});

describe('highlightMessageWhenScrollSettles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('starts highlighting only after the target message stops moving', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const runNextFrame = (timestamp: number) => {
      const frame = frames.shift();
      expect(frame).toBeDefined();
      frame!(timestamp);
    };
    const target = document.createElement('div');
    target.setAttribute('data-message-id', 'message-2');
    let targetTop = 300;
    vi.spyOn(target, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, targetTop, 100, 40),
    );
    document.body.appendChild(target);

    highlightMessageWhenScrollSettles('message-2');
    runNextFrame(0);
    expect(target).not.toHaveAttribute('data-message-locate-highlight');

    for (const [timestamp, top] of [
      [16, 300],
      [32, 240],
      [48, 180],
      [64, 120],
    ] as const) {
      targetTop = top;
      runNextFrame(timestamp);
      expect(target).not.toHaveAttribute('data-message-locate-highlight');
    }

    for (let timestamp = 80; timestamp <= 224; timestamp += 16) {
      runNextFrame(timestamp);
      expect(target).not.toHaveAttribute('data-message-locate-highlight');
    }

    runNextFrame(240);
    expect(target).toHaveAttribute('data-message-locate-highlight');
  });

  it('does not highlight when the target never stops moving', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const target = document.createElement('div');
    target.setAttribute('data-message-id', 'message-2');
    let targetTop = 300;
    vi.spyOn(target, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, targetTop--, 100, 40),
    );
    document.body.appendChild(target);

    highlightMessageWhenScrollSettles('message-2');
    for (let frame = 0; frame < 260 && frames.length > 0; frame += 1) {
      frames.shift()!(frame * 16);
    }

    expect(frames).toHaveLength(0);
    expect(target).not.toHaveAttribute('data-message-locate-highlight');
  });
});
