import { ActionIcon, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { PanelRightCloseIcon } from 'lucide-react';
import { lazy, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { useRepoType } from '@/features/ChatInput/RuntimeConfig/useRepoType';
import RightPanel from '@/features/RightPanel';
import { useAgentStore } from '@/store/agent';
import {
  agentByIdSelectors,
  agentSelectors,
  chatConfigByIdSelectors,
} from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';

import Files from './Files';
import ProgressSection from './ProgressSection';
import ResourcesSection from './ResourcesSection';
import Review from './Review';

const ParamsSection = lazy(() => import('./ParamsSection'));

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

type Tab = 'files' | 'params' | 'review' | 'resources';

const AgentWorkingSidebar = memo(() => {
  const { t } = useTranslation(['chat', 'setting']);
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
  const isHetero = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const workingDirectory = topicWorkingDirectory || agentWorkingDirectory;
  const repoType = useRepoType(workingDirectory);

  const filesAvailable = isLocalSystemEnabled && !!workingDirectory;
  const reviewAvailable = isLocalSystemEnabled && !!workingDirectory && !!repoType;
  const paramsAvailable = !isHetero;
  const resolveActiveTab = (): Tab => {
    if (storedTab === 'params' && paramsAvailable) return 'params';
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
            {paramsAvailable && (
              <button
                className={`${styles.tab} ${activeTab === 'params' ? styles.tabActive : ''}`}
                type="button"
                onClick={() => setWorkingSidebarTab('params')}
              >
                {t('settingModel.params.panel.tab', { ns: 'setting' })}
              </button>
            )}
          </div>
          <ActionIcon
            icon={PanelRightCloseIcon}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            onClick={() => toggleRightPanel(false)}
          />
        </Flexbox>
        <Flexbox className={styles.body} width={'100%'}>
          {paramsAvailable && activeTab === 'params' && (
            <Flexbox className={styles.pane}>
              <ParamsSection />
            </Flexbox>
          )}
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
