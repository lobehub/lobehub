import { Flexbox, Popover } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type PropsWithChildren } from 'react';
import { memo, Suspense, useMemo } from 'react';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import AgentListContent from '@/routes/(main)/home/_layout/Body/Agent/List/AgentListContent';
import { AgentModalProvider } from '@/routes/(main)/home/_layout/Body/Agent/ModalProvider';

const styles = createStaticStyles(({ cssVar, css }) => ({
  trigger: css`
    &[data-popup-open] {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

const SwitchPanel = memo<PropsWithChildren>(({ children }) => {
  const navigate = useWorkspaceAwareNavigate();
  // AgentListContent no longer owns the SWR subscription; subscribe here so
  // the standalone switcher still triggers a fetch when opened.
  useFetchAgentList();

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
            <AgentListContent onMoreClick={() => navigate('/')} />
          </Flexbox>
        </AgentModalProvider>
      </Suspense>
    ),
    [navigate],
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
