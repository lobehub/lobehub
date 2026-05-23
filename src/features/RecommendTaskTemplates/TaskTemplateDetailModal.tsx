'use client';

import type { TaskTemplate } from '@lobechat/const';
import { ActionIcon, Button, Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { cssVar } from 'antd-style';
import { Clock, X } from 'lucide-react';
import { memo, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveTemplateIcon } from './resolveTemplateIcon';
import { SkillAuthRow } from './SkillAuthRow';
import { INTEREST_ICON_MAP, TemplateBriefIcon } from './TemplateBriefIcon';
import { useScheduleText } from './useScheduleText';
import { useTaskTemplateCreate } from './useTaskTemplateCreate';
import { useVisibleAuthSpecs } from './useVisibleAuthSpecs';

interface TaskTemplateDetailContentProps {
  onCreated: (templateId: string) => void;
  template: TaskTemplate;
}

const TaskTemplateDetailContent = memo<TaskTemplateDetailContentProps>(
  ({ template, onCreated }) => {
    const { t } = useTranslation('taskTemplate');
    const { close } = useModalContext();

    const iconSpec = useMemo(() => resolveTemplateIcon(template, INTEREST_ICON_MAP), [template]);

    const title = t(`${template.id}.title`, { defaultValue: '' });
    const description = t(`${template.id}.description`, { defaultValue: '' });
    const instruction = t(`${template.id}.instruction`, { defaultValue: '' });

    const visibleAuthSpecs = useVisibleAuthSpecs(template);
    const scheduleText = useScheduleText(template.cronPattern);

    const {
      created,
      disabled,
      handleAddTask,
      handleConnectError,
      loading,
      pendingCreate,
      primaryButtonLabel,
    } = useTaskTemplateCreate({ description, onCreated, template, title });

    // Close the modal once creation completes; handleCreate also navigates to
    // the new task, but closing keeps state tidy if navigation is intercepted.
    useEffect(() => {
      if (created) close();
    }, [created, close]);

    return (
      <Flexbox gap={16} padding={20}>
        <Flexbox horizontal align={'flex-start'} gap={12} justify={'space-between'}>
          <Flexbox horizontal align={'center'} gap={12} style={{ flex: 1, minWidth: 0 }}>
            <TemplateBriefIcon spec={iconSpec} tileSize={36} />
            <Flexbox gap={2} style={{ minWidth: 0 }}>
              <Text ellipsis fontSize={18} weight={600}>
                {title}
              </Text>
              <Flexbox horizontal align={'center'} gap={4}>
                <Icon color={cssVar.colorTextSecondary} icon={Clock} size={12} />
                <Text fontSize={12} type={'secondary'}>
                  {scheduleText}
                </Text>
              </Flexbox>
            </Flexbox>
          </Flexbox>
          <ActionIcon icon={X} size={'small'} onClick={close} />
        </Flexbox>

        {description.trim().length > 0 && <Text type={'secondary'}>{description}</Text>}

        {instruction.trim().length > 0 && (
          <>
            <Divider dashed style={{ marginBlock: 0 }} />
            <Markdown variant={'chat'}>{instruction}</Markdown>
          </>
        )}

        {visibleAuthSpecs.length > 0 && (
          <Flexbox gap={6}>
            {visibleAuthSpecs.map((spec) => (
              <SkillAuthRow
                key={`${spec.source}:${spec.provider}`}
                spec={spec}
                onError={handleConnectError}
              />
            ))}
          </Flexbox>
        )}

        <Flexbox horizontal justify={'flex-end'}>
          <Button
            disabled={disabled}
            loading={loading || pendingCreate}
            shape={'round'}
            type={'primary'}
            onClick={handleAddTask}
          >
            {primaryButtonLabel}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

TaskTemplateDetailContent.displayName = 'TaskTemplateDetailContent';

interface CreateTaskTemplateDetailModalOptions {
  onCreated: (templateId: string) => void;
  template: TaskTemplate;
}

export const createTaskTemplateDetailModal = ({
  template,
  onCreated,
}: CreateTaskTemplateDetailModalOptions): ModalInstance =>
  createModal({
    content: <TaskTemplateDetailContent template={template} onCreated={onCreated} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { overflow: 'hidden', padding: 0 },
    },
    title: null,
    width: 'min(80%, 680px)',
  });
