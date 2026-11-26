/**
 * @vitest-environment happy-dom
 */
import type { KeyboardEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleTopicRowKeyDown } from './topicRowKeyboard';

const createRow = (parent: HTMLElement, { href }: { href?: string } = {}) => {
  const row = document.createElement(href ? 'a' : 'div');
  if (href) row.setAttribute('href', href);
  row.setAttribute('data-topic-row', '');
  row.tabIndex = 0;
  row.append(document.createElement('button'));
  parent.append(row);
  return row;
};

const createRoot = () => {
  const root = document.createElement('div');
  root.setAttribute('data-topic-list-root', '');
  document.body.append(root);
  return root;
};

const press = (
  row: HTMLElement,
  key: string,
  handlers: { onOpen?: () => void; onRename?: () => void } = {},
  target: EventTarget = row,
) => {
  const preventDefault = vi.fn();
  handleTopicRowKeyDown(
    {
      altKey: false,
      ctrlKey: false,
      currentTarget: row,
      key,
      metaKey: false,
      nativeEvent: { isComposing: false },
      preventDefault,
      shiftKey: false,
      target,
    } as unknown as KeyboardEvent<HTMLElement>,
    { onOpen: handlers.onOpen ?? vi.fn(), onRename: handlers.onRename },
  );
  return preventDefault;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('handleTopicRowKeyDown', () => {
  it('moves focus between rows with the arrow keys and stops at the ends', () => {
    const root = createRoot();
    const a = createRow(root);
    const b = createRow(root);
    a.focus();

    press(a, 'ArrowDown');
    expect(document.activeElement).toBe(b);

    const preventDefault = press(b, 'ArrowDown');
    expect(document.activeElement).toBe(b);
    // The end of the list must not scroll the sidebar either.
    expect(preventDefault).toHaveBeenCalled();

    press(b, 'ArrowUp');
    expect(document.activeElement).toBe(a);
  });

  it('keeps arrow navigation inside its own list', () => {
    const sidebar = createRow(createRoot());
    createRow(createRoot());
    sidebar.focus();

    press(sidebar, 'ArrowDown');

    expect(document.activeElement).toBe(sidebar);
  });

  it('does not move focus from a row outside any marked list', () => {
    const loose = createRow(document.body);
    createRow(document.body);
    loose.focus();

    press(loose, 'ArrowDown');

    expect(document.activeElement).toBe(loose);
  });

  it('renames on F2 only when renaming is allowed', () => {
    const root = createRoot();
    const onRename = vi.fn();

    press(createRow(root), 'F2', { onRename });
    press(createRow(root), 'F2');

    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it('opens a non-link row on Enter but leaves a link row to the browser', () => {
    const root = createRoot();
    const onOpenDiv = vi.fn();
    const onOpenLink = vi.fn();

    press(createRow(root), 'Enter', { onOpen: onOpenDiv });
    const linkPreventDefault = press(createRow(root, { href: '/agent/a/tpc_1' }), 'Enter', {
      onOpen: onOpenLink,
    });

    expect(onOpenDiv).toHaveBeenCalledTimes(1);
    expect(onOpenLink).not.toHaveBeenCalled();
    expect(linkPreventDefault).not.toHaveBeenCalled();
  });

  it('ignores keys pressed on the row actions', () => {
    const row = createRow(createRoot());
    const onRename = vi.fn();

    press(row, 'F2', { onRename }, row.querySelector('button')!);

    expect(onRename).not.toHaveBeenCalled();
  });
});
