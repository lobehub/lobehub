/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { HTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorModal } from './index';

const getDocumentMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/editor/react', () => ({
  useEditor: () => ({
    getDocument: getDocumentMock,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  createRawModal: vi.fn(),
  Modal: ({
    children,
    confirmLoading,
    okText,
    onOk,
    open,
  }: {
    children: ReactNode;
    confirmLoading?: boolean;
    okText?: string;
    onOk?: () => Promise<void>;
    open?: boolean;
  }) =>
    open ? (
      <div>
        <div data-testid="confirm-loading">{String(confirmLoading)}</div>
        <button
          onClick={() => {
            void onOk?.().catch(() => {});
          }}
        >
          {okText}
        </button>
        {children}
      </div>
    ) : null,
}));

vi.mock('./EditorCanvas', () => ({
  default: ({ defaultValue }: HTMLAttributes<HTMLDivElement> & { defaultValue?: string }) => (
    <div>{defaultValue}</div>
  ),
}));

describe('EditorModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reset confirm loading when onConfirm rejects', async () => {
    getDocumentMock.mockImplementation((type: string) =>
      type === 'markdown' ? 'markdown value' : { type: 'doc' },
    );

    const onConfirm = vi.fn().mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error('confirm failed')), 0);
        }),
    );

    render(<EditorModal open={true} value={'hello'} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: 'ok' }));

    await waitFor(() => {
      expect(screen.getByTestId('confirm-loading')).toHaveTextContent('true');
    });

    await waitFor(() => {
      expect(screen.getByTestId('confirm-loading')).toHaveTextContent('false');
    });

    expect(onConfirm).toHaveBeenCalledWith('markdown value', { type: 'doc' });
  });
});
