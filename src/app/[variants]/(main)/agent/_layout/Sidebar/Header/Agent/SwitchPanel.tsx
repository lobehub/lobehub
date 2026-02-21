import { Flexbox, Popover } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type PropsWithChildren } from 'react';
import { memo, Suspense, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import List from '@/app/[variants]/(main)/home/_layout/Body/Agent/List';
import { AgentModalProvider } from '@/app/[variants]/(main)/home/_layout/Body/Agent/ModalProvider';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';

const styles = createStaticStyles(({ cssVar, css }) => ({
  trigger: css`
    &[data-popup-open] {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

const SwitchPanel = memo<PropsWithChildren>(({ children }) => {
  const navigate = useNavigate();

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
            <List onMoreClick={() => navigate('/')} />
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
