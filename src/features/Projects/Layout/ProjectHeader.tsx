'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Button, Popover } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronsUpDownIcon, SquareKanbanIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ProjectDetail } from '@/store/project';
import { useCurrentProjectList, useProjectStore } from '@/store/project';

const styles = createStaticStyles(({ css }) => ({
  chevron: css`
    flex: none;
    color: ${cssVar.colorTextDescription};
  `,
  trigger: css`
    overflow: hidden;
    justify-content: flex-start;

    width: 100%;
    min-width: 0;
    height: 32px;
    padding-inline: 6px;
    border: 0;

    background: transparent;
  `,
}));

interface ProjectHeaderProps {
  project?: ProjectDetail['project'];
}

const ProjectHeader = memo<ProjectHeaderProps>(({ project }) => {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const [open, setOpen] = useState(false);
  const projects = useCurrentProjectList();
  useProjectStore((s) => s.useFetchProjectList)(true);

  const handleSelect = (projectId: string) => {
    setOpen(false);
    navigate(`/project/${projectId}`);
  };

  return (
    <SideBarHeaderLayout
      backTo="/"
      left={
        <Popover
          classNames={{ trigger: styles.trigger }}
          open={open}
          placement="bottomLeft"
          styles={{ content: { padding: 0, width: 240 } }}
          trigger="click"
          content={
            <Flexbox gap={4} padding={8} style={{ maxHeight: '50vh', overflowY: 'auto' }}>
              {projects.map((item) => (
                <NavItem
                  active={item.id === project?.id}
                  icon={SquareKanbanIcon}
                  key={item.id}
                  title={item.name}
                  onClick={() => handleSelect(item.id)}
                />
              ))}
            </Flexbox>
          }
          onOpenChange={setOpen}
        >
          <Button
            aria-expanded={open}
            aria-haspopup="dialog"
            className={styles.trigger}
            type="text"
          >
            <Icon icon={SquareKanbanIcon} />
            <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={500}>
              {project?.name || t('sidebar.title')}
            </Text>
            <ChevronsUpDownIcon className={styles.chevron} size={14} />
          </Button>
        </Popover>
      }
    />
  );
});

ProjectHeader.displayName = 'ProjectHeader';

export default ProjectHeader;
