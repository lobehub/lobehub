import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import GenerationInvalidAPIKey from '@/routes/(main)/(create)/features/GenerationInput/GenerationInvalidAPIKey';

import ChatInvalidAPIKey from './ChatInvalidApiKey';

const { deleteMessage, navigate } = vi.hoisted(() => ({
  deleteMessage: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@lobechat/business-const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  BRANDING_LOGO_URL: '/branding/private-logo.png',
  BRANDING_NAME: 'Private Workspace',
  BRANDING_PROVIDER: 'lobehub',
  BRANDING_PROVIDER_DISPLAY_ID: 'managed-upstream',
}));
vi.mock('../store', () => ({
  useConversationStore: (selector: (state: object) => unknown) => selector({ deleteMessage }),
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));

beforeAll(() => import('@/libs/providerIcon'), 30_000);
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('API-key error cards', () => {
  it('brands the chat error without changing the provider settings destination or dismissal', async () => {
    render(<ChatInvalidAPIKey id="error-message" provider="lobehub" />);

    expect(await screen.findByRole('img', { name: 'Private Workspace' })).toHaveAttribute(
      'src',
      '/branding/private-logo.png',
    );
    fireEvent.click(screen.getByRole('button'));
    expect(navigate).toHaveBeenCalledWith('/settings/provider/lobehub');
    expect(deleteMessage).toHaveBeenCalledWith('error-message');
  });

  it('also brands the image/video generation error and preserves its callback', async () => {
    const onNavigate = vi.fn();
    render(<GenerationInvalidAPIKey provider="lobehub" onNavigate={onNavigate} />);

    expect(await screen.findByRole('img', { name: 'Private Workspace' })).toHaveAttribute(
      'src',
      '/branding/private-logo.png',
    );
    fireEvent.click(screen.getByRole('button'));
    expect(navigate).toHaveBeenCalledWith('/settings/provider/lobehub');
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it('maps the branded display provider id back to the runtime provider settings route', async () => {
    render(<ChatInvalidAPIKey id="error-message" provider="managed-upstream" />);

    expect(await screen.findByRole('img', { name: 'Private Workspace' })).toHaveAttribute(
      'src',
      '/branding/private-logo.png',
    );
    fireEvent.click(screen.getByRole('button'));
    expect(navigate).toHaveBeenCalledWith('/settings/provider/lobehub');
  });
});
