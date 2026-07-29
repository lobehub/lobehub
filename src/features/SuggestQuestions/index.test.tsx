/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SuggestQuestions from './index';

const permissionMock = vi.hoisted(() => ({
  allowed: true,
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({
    allowed: permissionMock.allowed,
    reason: '',
  }),
}));

vi.mock('./List', () => ({
  default: ({ disabled }: { disabled?: boolean }) => (
    <div data-disabled={String(!!disabled)}>suggest list</div>
  ),
}));

vi.mock('./Skeleton', () => ({
  default: () => <div>loading</div>,
}));

describe('SuggestQuestions', () => {
  beforeEach(() => {
    permissionMock.allowed = true;
  });

  it('disables question clicks when the user cannot create content', () => {
    permissionMock.allowed = false;

    render(<SuggestQuestions mode="write" />);

    expect(screen.getByText('suggest list')).toHaveAttribute('data-disabled', 'true');
  });
});
