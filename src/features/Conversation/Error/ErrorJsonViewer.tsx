import { ChatMessageError } from '@lobechat/types';
import { Highlighter } from '@lobehub/ui';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

interface ErrorJSONViewerProps {
  error?: ChatMessageError | null;
  id: string;
}

const ErrorJsonViewer = memo<ErrorJSONViewerProps>(({ error, id }) => {
  const errorBody = error?.body || error;

  if (!errorBody) return;

  return (
    <Flexbox id={id} style={{ maxWidth: 600 }}>
      <Highlighter actionIconSize={'small'} language={'json'}>
        {JSON.stringify(errorBody, null, 2)}
      </Highlighter>
    </Flexbox>
  );
});

export default ErrorJsonViewer;
