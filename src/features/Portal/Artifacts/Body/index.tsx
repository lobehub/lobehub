import { Flexbox, Highlighter } from '@lobehub/ui';
import { memo, useEffect, useMemo } from 'react';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, messageStateSelectors } from '@/store/chat/selectors';
import { ArtifactDisplayMode } from '@/store/chat/slices/portal/initialState';
import { ArtifactType } from '@/types/artifact';

import Renderer from './Renderer';

const ArtifactsUI = memo(() => {
  const [
    messageId,
    displayMode,
    isMessageGenerating,
    artifactType,
    artifactContent,
    artifactCodeLanguage,
    isArtifactTagClosed,
  ] = useChatStore((s) => {
    const messageId = chatPortalSelectors.artifactMessageId(s) || '';

    return [
      messageId,
      s.portalArtifactDisplayMode,
      messageStateSelectors.isMessageGenerating(messageId)(s),
      chatPortalSelectors.artifactType(s),
      chatPortalSelectors.artifactCode(messageId)(s),
      chatPortalSelectors.artifactCodeLanguage(s),
      chatPortalSelectors.isArtifactTagClosed(messageId)(s),
    ];
  });

  useEffect(() => {
    // when message generating , check whether the artifact is closed
    // if close, move the display mode to preview
    if (isMessageGenerating && isArtifactTagClosed && displayMode === ArtifactDisplayMode.Code) {
      useChatStore.setState({ portalArtifactDisplayMode: ArtifactDisplayMode.Preview });
    }
  }, [isMessageGenerating, displayMode, isArtifactTagClosed]);

  const language = useMemo(() => {
    switch (artifactType) {
      case ArtifactType.React: {
        return 'tsx';
      }

      case ArtifactType.Code: {
        return artifactCodeLanguage;
      }

      case ArtifactType.Python: {
        return 'python';
      }

      default: {
        return 'html';
      }
    }
  }, [artifactType, artifactCodeLanguage]);

  // make sure the message and id is valid
  if (!messageId) return;

  // show code when the artifact is not closed or the display mode is code or the artifact type is code
  const showCode =
    !isArtifactTagClosed ||
    displayMode === ArtifactDisplayMode.Code ||
    artifactType === ArtifactType.Code;

  return (
    <Flexbox
      className={'portal-artifact'}
      flex={1}
      gap={8}
      height={'100%'}
      paddingInline={12}
      style={{ overflow: 'hidden' }}
    >
      {showCode ? (
        <Highlighter
          language={language || 'txt'}
          style={{ fontSize: 12, height: '100%', overflow: 'auto' }}
        >
          {artifactContent}
        </Highlighter>
      ) : (
        <Renderer content={artifactContent} type={artifactType} />
      )}
    </Flexbox>
  );
});

export default ArtifactsUI;
