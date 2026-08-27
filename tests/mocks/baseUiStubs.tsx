/**
 * Canonical simplified-DOM stubs for `@lobehub/ui/base-ui` atoms. Prefer the
 * real components — the vitest config already stubs their MotionProvider so
 * they render without app-level providers. Use this only when a test wants
 * simplified DOM, composed over the real module so no export ever goes missing:
 *
 * ```ts
 * vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
 *   ...(await importOriginal<object>()),
 *   ...(await import('~base-ui-stubs')).baseUiStubs,
 * }));
 * ```
 *
 * Per-file factories still win for bespoke testid conventions.
 */
import type { MouseEventHandler, ReactNode } from 'react';
import { vi } from 'vitest';

const ActionIcon = ({
  disabled,
  onClick,
  title,
}: {
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  title?: string;
}) => (
  <button aria-label={title} disabled={disabled} type={'button'} onClick={onClick}>
    {title}
  </button>
);

const Button = ({
  children,
  disabled,
  loading,
  onClick,
  type,
}: {
  children?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  type?: string;
}) => (
  <button
    data-button-loading={loading ? 'true' : undefined}
    data-button-type={type}
    disabled={disabled || loading}
    type={'button'}
    onClick={onClick}
  >
    {children}
  </button>
);

const Text = ({ children }: { children?: ReactNode }) => <span>{children}</span>;

const Tag = ({ children }: { children?: ReactNode }) => <span>{children}</span>;

const Avatar = ({ alt, avatar }: { alt?: string; avatar?: ReactNode }) => (
  <span role={'img'}>{alt ?? (typeof avatar === 'string' ? avatar : null)}</span>
);

const Alert = ({ message, title }: { message?: ReactNode; title?: ReactNode }) => (
  <div role={'alert'}>
    <div>{title}</div>
    <div>{message}</div>
  </div>
);

export const createBaseUiStubs = () => ({
  ActionIcon,
  Alert,
  Avatar,
  Button,
  Tag,
  Text,
  confirmModal: vi.fn(),
  createModal: vi.fn(() => ({ close: vi.fn(), open: vi.fn() })),
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => ({ close: vi.fn(), update: vi.fn() })),
    promise: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
});

export const baseUiStubs = createBaseUiStubs();
