import { safeParseJSON } from '@lobechat/utils';
import { memo } from 'react';

import { getBuiltinPlaceholder } from '@/tools/placeholders';
import { getBuiltinStreaming } from '@/tools/streamings';

import Arguments from '../Arguments';

interface LoadingPlaceholderProps {
  apiName: string;
  identifier: string;
  loading?: boolean;
  messageId: string;
  requestArgs?: string;
  toolCallId: string;
}

const LoadingPlaceholder = memo<LoadingPlaceholderProps>(
  ({ identifier, requestArgs, apiName, loading, toolCallId, messageId }) => {
    const Render =
      getBuiltinPlaceholder(identifier, apiName) || getBuiltinStreaming(identifier, apiName);

    if (Render) {
      return (
        <Render
          apiName={apiName}
          args={safeParseJSON(requestArgs) || {}}
          identifier={identifier}
          messageId={messageId}
          toolCallId={toolCallId}
        />
      );
    }

    return <Arguments arguments={requestArgs} loading={loading} />;
  },
);

export default LoadingPlaceholder;
