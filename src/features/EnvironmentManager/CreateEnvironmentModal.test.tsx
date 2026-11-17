import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const close = vi.fn();
const createFromRepository = vi.fn();
const confirmModal = vi.fn();

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  confirmModal: (...args: unknown[]) => confirmModal(...args),
  useModalContext: () => ({ close }),
}));
// The GitHub App listing needs a connection; the pasted URL is the path under test.
vi.mock('@/features/Projects/CreateFromGithub/RepositoryList', () => ({ default: () => null }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('./useEnvironmentData', () => ({
  useEnvironmentActions: () => ({ createFromRepository }),
}));

const { CreateEnvironmentContent } = await import('./CreateEnvironmentModal');

const addButton = () => screen.getByRole('button', { name: 'environments.add' });
const urlInput = () => screen.getByPlaceholderText('createFromGithub.urlPlaceholder');

describe('CreateEnvironmentContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks for a repository and nothing else', () => {
    render(<CreateEnvironmentContent />);

    expect(screen.queryByPlaceholderText('environments.namePlaceholder')).toBeNull();
    expect(addButton()).toBeDisabled();

    fireEvent.change(urlInput(), { target: { value: 'not a repository' } });
    expect(addButton()).toBeDisabled();
  });

  it('adds the pasted repository named after itself and hands it back', async () => {
    const onCreated = vi.fn();
    createFromRepository.mockResolvedValue({ id: 'env-1', name: 'lobehub/lobe-tts' });
    render(<CreateEnvironmentContent visibility={'private'} onCreated={onCreated} />);

    fireEvent.change(urlInput(), { target: { value: 'https://github.com/lobehub/lobe-tts.git' } });
    fireEvent.click(addButton());

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'env-1' })),
    );
    expect(createFromRepository).toHaveBeenCalledWith({
      name: 'lobehub/lobe-tts',
      ref: undefined,
      url: 'https://github.com/lobehub/lobe-tts',
      visibility: 'private',
    });
    expect(close).toHaveBeenCalled();
    expect(confirmModal).not.toHaveBeenCalled();
  });

  it('asks before adding into the workspace pool', () => {
    render(<CreateEnvironmentContent visibility={'public'} />);

    fireEvent.change(urlInput(), { target: { value: 'lobehub/lobehub' } });
    fireEvent.click(addButton());

    expect(confirmModal).toHaveBeenCalledTimes(1);
    expect(createFromRepository).not.toHaveBeenCalled();
  });

  it('keeps the dialog open with the reason when adding fails', async () => {
    createFromRepository.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<CreateEnvironmentContent />);

    fireEvent.change(urlInput(), { target: { value: 'lobehub/lobehub' } });
    fireEvent.click(addButton());

    expect(await screen.findByText('environments.createFailed')).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
  });
});
