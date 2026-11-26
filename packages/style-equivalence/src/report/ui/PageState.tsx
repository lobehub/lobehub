import { Button, Center, Empty, Spin, Text } from '@lobehub/ui';
import { CircleAlert } from 'lucide-react';

export const PageState = ({
  error,
  loading,
  onRetry,
  title,
}: {
  error?: string;
  loading: string;
  onRetry?: () => void;
  title: string;
}) => (
  <Center gap={12} height="100vh" width="100%">
    {error ? (
      <Empty
        action={onRetry && <Button onClick={onRetry}>重试</Button>}
        description={error}
        icon={CircleAlert}
        title={title}
      />
    ) : (
      <>
        <Spin />
        <Text type="secondary">{loading}</Text>
      </>
    )}
  </Center>
);

export const InlineState = ({ error, loading }: { error?: string; loading: string }) => (
  <Text type={error ? 'danger' : 'secondary'}>{error ?? loading}</Text>
);
