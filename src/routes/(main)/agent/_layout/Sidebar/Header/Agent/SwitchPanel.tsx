import { Flexbox, Popover, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type PropsWithChildren } from 'react';
import { memo, Suspense, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import AgentListContent from '@/routes/(main)/home/_layout/Body/Agent/List/AgentListContent';
import { AgentModalProvider } from '@/routes/(main)/home/_layout/Body/Agent/ModalProvider';
import PrivateList from '@/routes/(main)/home/_layout/Body/Private/List';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

const styles = createStaticStyles(({ cssVar, css }) => ({
  sectionHeader: css`
    padding-block: 4px;
    padding-inline: 8px;
    line-height: 20px;
  `,
  trigger: css`
    &[data-popup-open] {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

interface SectionHeaderProps {
  children: React.ReactNode;
}

const SectionHeader = memo<SectionHeaderProps>(({ children }) => (
  <Flexbox className={styles.sectionHeader}>
    <Text fontSize={12} type="secondary" weight={500}>
      {children}
    </Text>
  </Flexbox>
));

const SwitchPanel = memo<PropsWithChildren>(({ children }) => {
  const navigate = useWorkspaceAwareNavigate();
  const activeWorkspaceId = useActiveWorkspaceId();
  const { t } = useTranslation('common');
  // AgentListContent no longer owns the SWR subscription; subscribe here so
  // the standalone switcher still triggers a fetch when opened.
  useFetchAgentList();

  // Only show the "私人 / 工作区" split when the user actually has private
  // items in this workspace — a lone Private header above an empty section
  // would be noise.
  const hasPrivateItems = useHomeStore(homeAgentListSelectors.hasPrivateAgents);
  const showPrivateSection = Boolean(activeWorkspaceId) && hasPrivateItems;

  const handleMoreClick = useCallback(() => navigate('/'), [navigate]);

  const content = useMemo(
    () => (
      <Suspense fallback={<SkeletonList rows={6} />}>
        <AgentModalProvider>
          <Flexbox
            gap={4}
            padding={8}
            style={{
              maxHeight: '50vh',
              overflowY: 'auto',
            }}
          >
            {showPrivateSection && (
              <>
                <SectionHeader>{t('navPanel.privateAgents')}</SectionHeader>
                <PrivateList hideCreateButton onMoreClick={handleMoreClick} />
                <SectionHeader>{t('navPanel.publicAgents')}</SectionHeader>
              </>
            )}
            <AgentListContent onMoreClick={handleMoreClick} />
          </Flexbox>
        </AgentModalProvider>
      </Suspense>
    ),
    [handleMoreClick, showPrivateSection, t],
  );

  return (
    <Popover
      classNames={{ trigger: styles.trigger }}
      content={content}
      nativeButton={false}
      placement="bottomLeft"
      trigger="click"
      styles={{
        content: {
          padding: 0,
          width: 240,
        },
      }}
    >
      {children}
    </Popover>
  );
});

export default SwitchPanel;
