import { type PluginRenderProps } from '@lobehub/chat-plugin-sdk/client';
import { Skeleton } from '@lobehub/ui';
import { memo, useRef, useState } from 'react';

import { useOnPluginReadyForInteraction } from '../../utils/iframeOnReady';
import { useOnPluginFetchMessage } from '../../utils/listenToPlugin';
import { sendMessageContentToPlugin } from '../../utils/postMessage';

interface IFrameRenderProps extends PluginRenderProps {
  height?: number;
  url: string;
  width?: number;
}

const IFrameRender = memo<IFrameRenderProps>(({ url, width = 800, height = 300, ...props }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);

  // When props change, proactively send data to the iframe
  useOnPluginReadyForInteraction(() => {
    const iframeWin = iframeRef.current?.contentWindow;

    if (iframeWin) {
      sendMessageContentToPlugin(iframeWin, props);
    }
  }, [props]);

  // when get iframe fetch message ，send message content
  useOnPluginFetchMessage(() => {
    const iframeWin = iframeRef.current?.contentWindow;
    if (iframeWin) {
      sendMessageContentToPlugin(iframeWin, props);
    }
  }, [props]);

  return (
    <>
      {loading && <Skeleton active style={{ maxWidth: '100%', width }} />}
      <iframe
        // @ts-ignore
        allowtransparency="true"
        height={height}
        hidden={loading}
        ref={iframeRef}
        src={url}
        width={width}
        style={{
          border: 0,
          // iframe cannot be transparent in color-scheme:dark mode
          // refs: https://www.jianshu.com/p/bc5a37bb6a7b
          colorScheme: 'light',
          maxWidth: '100%',
        }}
        onLoad={() => {
          setLoading(false);
        }}
      />
    </>
  );
});
export default IFrameRender;
