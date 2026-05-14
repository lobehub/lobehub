import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { PanelRightCloseIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { useRepoType } from '@/features/ChatInput/RuntimeConfig/useRepoType';
import RightPanel from '@/features/RightPanel';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';

import Files from './Files';
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

type Tab = 'review' | 'resources' | 'files';

const AgentWorkingSidebar = memo(() => {
  const { t } = useTranslation('chat');
  const toggleRightPanel = useGlobalStore((s) => s.toggleRightPanel);
  const setWorkingSidebarTab = useGlobalStore((s) => s.setWorkingSidebarTab);
  const storedTab = useGlobalStore((s) => s.status.workingSidebarTab);
  const topicWorkingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const agentWorkingDirectory = useAgentStore((s) =>
    activeAgentId ? agentByIdSelectors.getAgentWorkingDirectoryById(activeAgentId)(s) : undefined,
  );
  const isLocalSystemEnabled = useAgentStore((s) =>
    activeAgentId ? chatConfigByIdSelectors.isLocalSystemEnabledById(activeAgentId)(s) : false,
  );
  const workingDirectory = topicWorkingDirectory || agentWorkingDirectory;
  const repoType = useRepoType(workingDirectory);

  const filesAvailable = isLocalSystemEnabled && !!workingDirectory;
  const reviewAvailable = isLocalSystemEnabled && !!workingDirectory && !!repoType;
  // Topic metadata is preferred for resuming a coding session, but Review and
  // Files are project-scoped and should also work before a topic has bound
  // metadata. Fall back to a still-visible tab when the stored choice is gone.
  const resolveActiveTab = (): Tab => {
    if (storedTab === 'review' && reviewAvailable) return 'review';
    if (storedTab === 'files' && filesAvailable) return 'files';
    if (storedTab === 'resources') return 'resources';
    if (reviewAvailable) return 'review';
    if (filesAvailable) return 'files';
    return 'resources';
  };
  const activeTab: Tab = resolveActiveTab();

  return (
    <RightPanel stableLayout defaultWidth={360} maxWidth={720} minWidth={300}>
      <Flexbox height={'100%'} width={'100%'}>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.header}
          height={44}
          justify={'space-between'}
          paddingInline={4}
        >
          {reviewAvailable || filesAvailable ? (
            <div className={styles.tabs}>
              <button
                className={`${styles.tab} ${activeTab === 'resources' ? styles.tabActive : ''}`}
                type="button"
                onClick={() => setWorkingSidebarTab('resources')}
              >
                {t('workingPanel.space')}
              </button>
              {reviewAvailable && (
                <button
                  className={`${styles.tab} ${activeTab === 'review' ? styles.tabActive : ''}`}
                  type="button"
                  onClick={() => setWorkingSidebarTab('review')}
                >
                  {t('workingPanel.review.title')}
                </button>
              )}
              {filesAvailable && (
                <button
                  className={`${styles.tab} ${activeTab === 'files' ? styles.tabActive : ''}`}
                  type="button"
                  onClick={() => setWorkingSidebarTab('files')}
                >
                  {t('workingPanel.files.title')}
                </button>
              )}
            </div>
          ) : (
            <Flexbox paddingInline={8}>
              <Text strong>{t('workingPanel.space')}</Text>
            </Flexbox>
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
          {filesAvailable && (
            <Flexbox className={activeTab === 'files' ? styles.pane : styles.paneHidden}>
              <Files workingDirectory={workingDirectory} />
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
