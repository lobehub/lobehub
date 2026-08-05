'use client';

import { Block, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ShieldCheck } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AccordionArrowIcon from '../shared/AccordionArrowIcon';

interface TaskAcceptanceHeaderProps {
  count?: number;
  isOpen: boolean;
  onToggle: () => void;
}

/** Canonical Task detail header shared by acceptance definition and result modes. */
export const TaskAcceptanceHeader = memo<TaskAcceptanceHeaderProps>(
  ({ count, isOpen, onToggle }) => {
    const { t } = useTranslation('chat');

    return (
      <Block
        clickable
        horizontal
        align={'center'}
        gap={8}
        paddingBlock={4}
        paddingInline={8}
        style={{ cursor: 'pointer', width: 'fit-content' }}
        variant={'borderless'}
        onClick={onToggle}
      >
        <Icon color={cssVar.colorTextDescription} icon={ShieldCheck} size={16} />
        <Text color={cssVar.colorTextSecondary} fontSize={13} weight={500}>
          {t('taskDetail.acceptance.title')}
        </Text>
        {Boolean(count) && <Tag size={'small'}>{count}</Tag>}
        <AccordionArrowIcon isOpen={isOpen} style={{ color: cssVar.colorTextDescription }} />
      </Block>
    );
  },
);

TaskAcceptanceHeader.displayName = 'TaskAcceptanceHeader';
