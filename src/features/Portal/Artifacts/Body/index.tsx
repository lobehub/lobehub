import { Flexbox, Highlighter } from '@lobehub/ui';
import { memo, useEffect, useMemo } from 'react';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, messageStateSelectors } from '@/store/chat/selectors';
import { ArtifactDisplayMode } from '@/store/chat/slices/portal/initialState';
import { ArtifactType } from '@/types/artifact';

import Renderer from './Renderer';

const TEXT_HTML_ARTIFACT_TYPE = 'text/html';

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
    const identifier = chatPortalSelectors.artifactIdentifier(s);

    return [
      messageId,
      s.portalArtifactDisplayMode,
      messageStateSelectors.isMessageGenerating(messageId)(s),
      chatPortalSelectors.artifactType(s),
      chatPortalSelectors.artifactCode(messageId, identifier)(s),
      chatPortalSelectors.artifactCodeLanguage(s),
      chatPortalSelectors.isArtifactTagClosed(messageId, identifier)(s),
    ];
  });

  const isHtmlArtifact =
    !artifactType ||
    artifactType === ArtifactType.Default ||
    artifactType === TEXT_HTML_ARTIFACT_TYPE;

  useEffect(() => {
    // Prefer live preview while HTML artifacts stream; reset stale code mode from previous artifacts.
    if (
      isMessageGenerating &&
      displayMode === ArtifactDisplayMode.Code &&
      (isArtifactTagClosed || (isHtmlArtifact && !isArtifactTagClosed))
    ) {
      useChatStore.setState({ portalArtifactDisplayMode: ArtifactDisplayMode.Preview });
    }
  }, [isMessageGenerating, displayMode, isArtifactTagClosed, isHtmlArtifact]);

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

  // Keep incomplete non-HTML artifacts in code mode, but let HTML stream into the preview.
  const showCode =
    artifactType === ArtifactType.Code ||
    (!isArtifactTagClosed && !isHtmlArtifact) ||
    (displayMode === ArtifactDisplayMode.Code && !(isHtmlArtifact && !isArtifactTagClosed));
  const isStreamingCode = isMessageGenerating && showCode && !isArtifactTagClosed;
  const isStreamingArtifact = isMessageGenerating && !isArtifactTagClosed;

  // make sure the message and id is valid
  if (!messageId) return;

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
        <Flexbox flex={1} style={{ minHeight: 0, overflow: 'auto' }}>
          <Highlighter
            animated={isStreamingCode}
            language={language || 'txt'}
            style={{ fontSize: 12, minHeight: '100%', overflow: 'visible' }}
          >
            {artifactContent}
          </Highlighter>
        </Flexbox>
      ) : (
        <Renderer animated={isStreamingArtifact} content={artifactContent} type={artifactType} />
      )}
    </Flexbox>
  );
});

export default ArtifactsUI;
