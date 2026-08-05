import { isTrpcErrorCode } from '@/utils/trpcError';

export type TopicCommentThreadState = 'error' | 'hidden' | 'loading' | 'notFound' | 'ready';

export const resolveTopicCommentThreadState = ({
  error,
  hasData,
  isDeleting,
  isLoading,
}: {
  error?: unknown;
  hasData: boolean;
  isDeleting: boolean;
  isLoading: boolean;
}): TopicCommentThreadState => {
  if (isDeleting && !hasData) return 'hidden';
  if (isTrpcErrorCode(error, 'NOT_FOUND')) return 'notFound';
  if (error && !hasData) return 'error';
  if (isLoading && !hasData) return 'loading';
  return hasData ? 'ready' : 'notFound';
};
