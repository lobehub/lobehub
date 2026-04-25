/**
 * @vitest-environment happy-dom
 */
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PageRedirect from './PageRedirect';

const navigateMock = vi.hoisted(() => vi.fn());
const useAutoCreateTopicDocumentMock = vi.hoisted(() => vi.fn());
const useParamsMock = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = (await vi.importActual('react-router-dom')) as typeof import('react-router-dom');

  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: useParamsMock,
  };
});

vi.mock('@/components/Loading/BrandTextLoading', () => ({
  default: ({ debugId }: { debugId: string }) => <div data-testid={debugId} />,
}));

vi.mock('@/features/TopicCanvas/useAutoCreateTopicDocument', () => ({
  useAutoCreateTopicDocument: useAutoCreateTopicDocumentMock,
}));

describe('PageRedirect', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    useAutoCreateTopicDocumentMock.mockReset();
    useParamsMock.mockReset();
  });

  it('redirects to the page created for an empty topic', async () => {
    useParamsMock.mockReturnValue({ aid: 'agt_test', topicId: 'tpc_test' });
    useAutoCreateTopicDocumentMock.mockReturnValue({
      document: undefined,
      documentId: 'doc_created',
      isLoading: false,
    });

    render(<PageRedirect />);

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/agent/agt_test/tpc_test/page/doc_created', {
        replace: true,
      }),
    );
  });

  it('keeps the loading state while the topic document id is not available', () => {
    useParamsMock.mockReturnValue({ aid: 'agt_test', topicId: 'tpc_test' });
    useAutoCreateTopicDocumentMock.mockReturnValue({
      document: undefined,
      documentId: undefined,
      isLoading: true,
    });

    render(<PageRedirect />);

    expect(navigateMock).not.toHaveBeenCalled();
  });
});
