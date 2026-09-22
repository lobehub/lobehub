import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IndentStyle } from './indent';
import { useCodeMirrorEditor, type UseCodeMirrorEditorOptions } from './useCodeMirrorEditor';

const { loadCodeMirrorMock } = vi.hoisted(() => ({ loadCodeMirrorMock: vi.fn() }));

vi.mock('@lobehub/editor/codemirror', () => ({
  loadCodeMirror: loadCodeMirrorMock,
  lobeTheme: {},
}));

const indent: IndentStyle = { size: 2, useTabs: false };

const setup = (overrides: Partial<UseCodeMirrorEditorOptions> = {}) => {
  const props: UseCodeMirrorEditorOptions = {
    indent,
    isDark: false,
    lineWrapping: true,
    mode: 'javascript',
    readOnly: false,
    textareaRef: { current: document.createElement('textarea') },
    value: 'const a = 1;',
    ...overrides,
  };

  return renderHook(
    (p: Partial<UseCodeMirrorEditorOptions>) => useCodeMirrorEditor({ ...props, ...p }),
    {
      initialProps: {},
    },
  );
};

/**
 * Keeps `loadCodeMirror()` pending until the test resolves it, so props can
 * change while the editor bundle is still loading.
 */
const deferLoad = () => {
  let resolveLoad!: (codeMirror: unknown) => void;
  loadCodeMirrorMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
  );

  return {
    resolve: async (codeMirror: unknown) => {
      await act(async () => {
        resolveLoad(codeMirror);
      });
    },
  };
};

const createFakeCodeMirror = () => {
  let currentValue = '';
  const instance = {
    destroy: vi.fn(),
    getValue: vi.fn(() => currentValue),
    on: vi.fn(),
    optionHelper: { theme: { reconfigure: vi.fn(() => ({ effects: 'theme' })) } },
    setOption: vi.fn(),
    setValue: vi.fn((value: string) => {
      currentValue = value;
    }),
    view: {
      constructor: { theme: vi.fn(() => ({ theme: 'lobe' })) },
      dispatch: vi.fn(),
      dom: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
      state: {
        doc: { lineAt: vi.fn(() => ({ from: 0, number: 1 })) },
        selection: { main: { from: 0, head: 0, to: 0 } },
      },
    },
  };
  const fromTextArea = vi.fn((_dom: HTMLTextAreaElement, options: Record<string, unknown>) => {
    currentValue = options.value as string;
    return instance;
  });

  return { fromTextArea, instance };
};

describe('useCodeMirrorEditor', () => {
  afterEach(() => {
    loadCodeMirrorMock.mockReset();
  });

  it('initializes with mount-time values when no prop changes while loading', async () => {
    const { resolve } = deferLoad();
    setup();

    const fake = createFakeCodeMirror();
    await resolve({ fromTextArea: fake.fromTextArea });

    expect(fake.fromTextArea).toHaveBeenCalledTimes(1);
    expect(fake.fromTextArea.mock.calls[0][1]).toMatchObject({
      autoCloseBrackets: true,
      indentWithTabs: false,
      mode: 'javascript',
      readOnly: false,
      tabSize: 2,
      value: 'const a = 1;',
    });
  });

  // Regression for the async initialization race: `value`, `mode` and
  // `readOnly` changing while `loadCodeMirror()` is pending used to be dropped,
  // because the update effects run before the editor instance exists. The
  // editor then initialized with the mount-time values.
  it('initializes with the latest values when props change while the bundle is loading', async () => {
    const { resolve } = deferLoad();
    const { rerender } = setup();

    rerender({ mode: 'python', readOnly: true, value: "print('hi')" });

    const fake = createFakeCodeMirror();
    await resolve({ fromTextArea: fake.fromTextArea });

    expect(fake.fromTextArea).toHaveBeenCalledTimes(1);
    expect(fake.fromTextArea.mock.calls[0][1]).toMatchObject({
      autoCloseBrackets: false,
      mode: 'python',
      readOnly: true,
      value: "print('hi')",
    });
  });

  it('pushes prop changes that arrive after initialization', async () => {
    const { resolve } = deferLoad();
    const { rerender } = setup();

    const fake = createFakeCodeMirror();
    await resolve({ fromTextArea: fake.fromTextArea });

    rerender({ mode: 'python', readOnly: true, value: 'two' });

    expect(fake.instance.setValue).toHaveBeenCalledWith('two');
    expect(fake.instance.setOption).toHaveBeenCalledWith('mode', 'python');
    expect(fake.instance.setOption).toHaveBeenCalledWith('readOnly', true);
    expect(fake.instance.setOption).toHaveBeenCalledWith('autoCloseBrackets', false);
  });

  it('does not initialize when unmounted before the bundle resolves', async () => {
    const { resolve } = deferLoad();
    const { unmount } = setup();

    const fake = createFakeCodeMirror();
    unmount();
    await resolve({ fromTextArea: fake.fromTextArea });

    expect(fake.fromTextArea).not.toHaveBeenCalled();
  });
});
