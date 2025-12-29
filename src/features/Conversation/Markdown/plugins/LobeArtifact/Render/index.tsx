import { Center, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cx, useThemeMode } from 'antd-style';
import { Loader2 } from 'lucide-react';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, messageStateSelectors } from '@/store/chat/selectors';
import { dotLoading } from '@/styles/loading';

import { type MarkdownElementProps } from '../../type';
import ArtifactIcon from './Icon';

const styles = createStaticStyles(({ css, cssVar }) => ({
  avatar: css`
    border-inline-end: 1px solid ${cssVar.colorSplit};
    background: ${cssVar.colorFillQuaternary};
  `,
  container: css`
    cursor: pointer;

    margin-block-start: 12px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 8px;

    color: ${cssVar.colorText};

    box-shadow: ${cssVar.boxShadowTertiary};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  container_dark: css`
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  desc: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  title: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    text-overflow: ellipsis;
  `,
}));

interface ArtifactProps extends MarkdownElementProps {
  identifier: string;
  language?: string;
  title: string;
  type: string;
}

const Render = memo<ArtifactProps>(({ identifier, title, type, language, children, id }) => {
  const { t } = useTranslation('chat');
  const { isDarkMode } = useThemeMode();

  const hasChildren = !!children;
  const str = ((children as string) || '').toString?.();

  const [isGenerating, isArtifactTagClosed, openArtifact, closeArtifact] = useChatStore((s) => {
    return [
      messageStateSelectors.isMessageGenerating(id)(s),
      chatPortalSelectors.isArtifactTagClosed(id)(s),
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
  }, [isGenerating, hasChildren, str, identifier, title, type, id, language]);

  return (
    <Flexbox
      className={cx(styles.container, isDarkMode && styles.container_dark)}
      gap={16}
      onClick={() => {
        const currentArtifactMessageId = chatPortalSelectors.artifactMessageId(
          useChatStore.getState(),
        );
        if (currentArtifactMessageId === id) {
          closeArtifact();
        } else {
          openArtifactUI();
        }
      }}
      width={'100%'}
    >
      <Flexbox align={'center'} flex={1} horizontal>
        <Center className={styles.avatar} height={64} horizontal width={64}>
          <ArtifactIcon type={type} />
        </Center>
        <Flexbox gap={4} paddingBlock={8} paddingInline={12}>
          {!title && isGenerating ? (
            <Flexbox className={cx(dotLoading)} horizontal>
              {t('artifact.generating')}
            </Flexbox>
          ) : (
            <Flexbox className={cx(styles.title)}>{title || t('artifact.unknownTitle')}</Flexbox>
          )}
          {hasChildren && (
            <Flexbox className={styles.desc} horizontal>
              {identifier} ·{' '}
              <Flexbox gap={2} horizontal>
                {!isArtifactTagClosed && (
                  <div>
                    <Icon icon={Loader2} spin />
                  </div>
                )}
                {str?.length}
              </Flexbox>
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default Render;
