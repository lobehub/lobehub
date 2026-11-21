import { Center, cx, Flexbox, Spin } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsDark } from '@/hooks/useIsDark';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, messageStateSelectors } from '@/store/chat/selectors';
import { dotLoading } from '@/styles/loading';

import { type MarkdownElementProps } from '../../type';
import ArtifactIcon from './Icon';
import { useArtifactCodeLength } from './useArtifactCodeLength';

const styles = stylex.create({
  avatar: {
    borderInlineEndWidth: '1px',
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: cssVar.colorSplit,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  container: {
    cursor: 'pointer',
    marginBlockStart: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: '8px',
    color: cssVar.colorText,
    boxShadow: cssVar.boxShadowTertiary,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  container_dark: { boxShadow: cssVar.boxShadowSecondary },
  desc: { fontSize: '12px', color: cssVar.colorTextTertiary },
  title: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '1',
    textOverflow: 'ellipsis',
  },
});

interface ArtifactProps extends MarkdownElementProps {
  identifier: string;
  language?: string;
  title: string;
  type: string;
}

const Render = memo<ArtifactProps>(({ identifier, title, type, language, children, id }) => {
  const { t } = useTranslation('chat');
  const isDarkMode = useIsDark();

  const hasChildren = !!children;

  const codeLength = useArtifactCodeLength(id, identifier);

  const [isGenerating, isArtifactTagClosed, openArtifact, closeArtifact] = useChatStore((s) => {
    return [
      messageStateSelectors.isMessageGenerating(id)(s),
      chatPortalSelectors.isArtifactTagClosed(id, identifier)(s),
      s.openArtifact,
      s.closeArtifact,
    ];
  });

  const openArtifactUI = () => {
    openArtifact({ id, identifier, language, title, type });
  };

  useEffect(() => {
    if (!hasChildren || !isGenerating) return;

    openArtifactUI();
  }, [isGenerating, hasChildren, codeLength, identifier, title, type, id, language]);

  return (
    <Flexbox
      className={stylex.props(styles.container, isDarkMode && styles.container_dark).className}
      gap={16}
      width={'100%'}
      onClick={() => {
        const state = useChatStore.getState();
        const currentArtifactMessageId = chatPortalSelectors.artifactMessageId(state);
        const currentArtifactIdentifier = chatPortalSelectors.artifactIdentifier(state);
        if (currentArtifactMessageId === id && currentArtifactIdentifier === identifier) {
          closeArtifact();
        } else {
          openArtifactUI();
        }
      }}
    >
      <Flexbox horizontal align={'center'} flex={1}>
        <Center horizontal className={stylex.props(styles.avatar).className} height={64} width={64}>
          <ArtifactIcon type={type} />
        </Center>
        <Flexbox gap={4} paddingBlock={8} paddingInline={12}>
          {!title && isGenerating ? (
            <Flexbox horizontal className={cx(dotLoading)}>
              {t('artifact.generating')}
            </Flexbox>
          ) : (
            <Flexbox className={stylex.props(styles.title).className}>
              {title || t('artifact.unknownTitle')}
            </Flexbox>
          )}
          {hasChildren && (
            <Flexbox horizontal align={'center'} className={stylex.props(styles.desc).className}>
              {identifier} ·&nbsp;
              <Flexbox horizontal align={'center'} gap={4}>
                {!isArtifactTagClosed && <Spin size="small" />}
                {codeLength}
              </Flexbox>
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default Render;
