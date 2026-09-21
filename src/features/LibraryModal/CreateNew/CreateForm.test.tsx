/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CreateForm from './CreateForm';

const mocks = vi.hoisted(() => ({
  activeWorkspaceSlug: null as string | null,
  createNewKnowledgeBase: vi.fn(async () => 'kb_new'),
  updateKnowledgeBase: vi.fn(async () => undefined),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => mocks.activeWorkspaceSlug,
}));

vi.mock('@/features/ResourceManager/store', () => ({
  useResourceManagerStore: (selector: (state: { listVisibility: string }) => unknown) =>
    selector({ listVisibility: 'workspace' }),
}));

vi.mock('@/store/library', () => ({
  useKnowledgeBaseStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      createNewKnowledgeBase: mocks.createNewKnowledgeBase,
      updateKnowledgeBase: mocks.updateKnowledgeBase,
    }),
}));

const originalLocation = window.location;

/** @example Creating a library from the empty state lands on the new library. */
describe('CreateForm — post-create navigation', () => {
  // ROOT CAUSE:
  //
  // When no `onSuccess` is supplied (the explorer empty state opens the modal
  // bare), the form hard-navigates to `/resource/library/<id>`. Workspace routes
  // are mounted under `/:workspaceSlug`, so without the slug the navigation
  // landed in the personal scope where the new workspace library does not
  // resolve.
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeWorkspaceSlug = null;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, href: '', origin: originalLocation.origin },
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
      writable: true,
    });
  });

  const submit = async () => {
    render(<CreateForm />);
    fireEvent.change(screen.getByPlaceholderText('createNew.name.placeholder'), {
      target: { value: 'Docs' },
    });
    fireEvent.click(screen.getByText('createNew.confirm'));
    await waitFor(() => expect(mocks.createNewKnowledgeBase).toHaveBeenCalled());
    await waitFor(() => expect(window.location.href).not.toBe(''));
    return window.location.href;
  };

  it('prefixes the new library path with the active workspace slug', async () => {
    mocks.activeWorkspaceSlug = 'acme';
    await expect(submit()).resolves.toBe('/acme/resource/library/kb_new');
  });

  it('leaves the personal-scope path unprefixed', async () => {
    await expect(submit()).resolves.toBe('/resource/library/kb_new');
  });
});
