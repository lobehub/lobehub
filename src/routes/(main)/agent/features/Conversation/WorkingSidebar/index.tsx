import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { PanelRightCloseIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import RightPanel from '@/features/RightPanel';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';

import ProgressSection from './ProgressSection';
import ResourcesSection from './ResourcesSection';
import Review from './Review';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  `,
  header: css`
    flex-shrink: 0;
  `,
  pane: css`
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  `,
  paneHidden: css`
    display: none;
  `,
  tab: css`
    cursor: pointer;

    padding-block: 4px;
    padding-inline: 10px;
    border: none;
    border-radius: 6px;

    font-size: 13px;
    color: ${cssVar.colorTextTertiary};

    background: transparent;

    transition:
      color 0.15s,
      background 0.15s;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  tabActive: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillTertiary};
  `,
  tabs: css`
    display: flex;
    gap: 4px;
    align-items: center;
  `,
}));

type Tab = 'review' | 'resources';

const AgentWorkingSidebar = memo(() => {
  const { t } = useTranslation('chat');
  const toggleRightPanel = useGlobalStore((s) => s.toggleRightPanel);
  const workingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);

  const reviewAvailable = !!workingDirectory;
  // When the topic has a working directory we lead with Review — that's why
  // the sidebar is open in agent-coding flows. Otherwise no tab strip at all,
  // we just show the resources view as before.
  const [tab, setTab] = useState<Tab>(reviewAvailable ? 'review' : 'resources');
  const activeTab: Tab = reviewAvailable ? tab : 'resources';

  return (
    <RightPanel stableLayout defaultWidth={360} maxWidth={720} minWidth={300}>
      <Flexbox height={'100%'} width={'100%'}>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.header}
          height={44}
          justify={'space-between'}
          paddingInline={16}
        >
          {reviewAvailable ? (
            <div className={styles.tabs}>
              <button
                className={`${styles.tab} ${activeTab === 'resources' ? styles.tabActive : ''}`}
                type="button"
                onClick={() => setTab('resources')}
              >
                {t('workingPanel.space')}
              </button>
              <button
                className={`${styles.tab} ${activeTab === 'review' ? styles.tabActive : ''}`}
                type="button"
                onClick={() => setTab('review')}
              >
                {t('workingPanel.review.title')}
              </button>
            </div>
          ) : (
            <Text strong>{t('workingPanel.space')}</Text>
          )}
          <ActionIcon
            icon={PanelRightCloseIcon}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            onClick={() => toggleRightPanel(false)}
          />
        </Flexbox>
        <Flexbox className={styles.body} width={'100%'}>
          {reviewAvailable && (
            <Flexbox className={activeTab === 'review' ? styles.pane : styles.paneHidden}>
              <Review workingDirectory={workingDirectory} />
            </Flexbox>
          )}
          <Flexbox
            className={activeTab === 'resources' ? styles.pane : styles.paneHidden}
            gap={8}
            width={'100%'}
          >
            <ProgressSection />
            <ResourcesSection />
          </Flexbox>
        </Flexbox>
      </Flexbox>
    </RightPanel>
  );
});

export default AgentWorkingSidebar;
