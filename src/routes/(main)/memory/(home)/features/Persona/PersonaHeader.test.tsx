/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PersonaHeader from './PersonaHeader';

const mocks = vi.hoisted(() => ({
  confirmModal: vi.fn(),
  deletePersona: vi.fn(),
  workspaceId: null as string | null,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.workspaceId,
}));
vi.mock('@/store/userMemory', () => ({
  useUserMemoryStore: (
    selector: (state: { deletePersona: typeof mocks.deletePersona }) => unknown,
  ) => selector({ deletePersona: mocks.deletePersona }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmModal: mocks.confirmModal,
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspaceId = null;
});

describe('PersonaHeader scope', () => {
  it('offers deletion with confirmation in personal scope', () => {
    render(<PersonaHeader />);
    fireEvent.click(screen.getByRole('button', { name: 'persona.delete.action' }));
    expect(mocks.confirmModal).toHaveBeenCalledOnce();
    expect(mocks.deletePersona).not.toHaveBeenCalled();
  });

  it('keeps the heading but removes deletion when entering a workspace', () => {
    const { rerender } = render(<PersonaHeader />);
    expect(screen.getByRole('button', { name: 'persona.delete.action' })).toBeTruthy();
    mocks.workspaceId = 'workspace-1';
    rerender(<PersonaHeader />);
    expect(screen.getByRole('heading', { name: 'Persona' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'persona.delete.action' })).toBeNull();
    expect(mocks.deletePersona).not.toHaveBeenCalled();
  });
});
