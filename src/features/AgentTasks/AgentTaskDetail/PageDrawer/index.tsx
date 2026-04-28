'use client';

import { Drawer } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

import PageExplorer from '@/features/PageExplorer';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

const PageDrawer = memo(() => {
  const pageId = useTaskStore(taskDetailSelectors.activePageDrawerPageId);
  const closePageDrawer = useTaskStore((s) => s.closePageDrawer);

  const open = !!pageId;

  return (
    <Drawer
      destroyOnHidden
      containerMaxWidth={'auto'}
      mask={false}
      open={open}
      placement={'right'}
      push={false}
      width={720}
      styles={{
        body: { padding: 0 },
        bodyContent: { height: '100%' },
        header: { display: 'none' },
        wrapper: {
          border: `1px solid ${cssVar.colorBorderSecondary}`,
          borderRadius: 12,
          bottom: 8,
          boxShadow: '0 6px 24px 0 rgba(0, 0, 0, 0.08), 0 2px 6px 0 rgba(0, 0, 0, 0.04)',
          height: 'auto',
          overflow: 'hidden',
          right: 8,
          top: 8,
        },
      }}
      onClose={closePageDrawer}
    >
      {open && pageId && <PageExplorer pageId={pageId} />}
    </Drawer>
  );
});

PageDrawer.displayName = 'PageDrawer';

export default PageDrawer;
