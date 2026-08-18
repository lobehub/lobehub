'use client';

import { Block, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ShieldCheck } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import AccordionArrowIcon from '../shared/AccordionArrowIcon';

interface TaskAcceptanceHeaderProps {
  count?: number;
  /** Section-level action (e.g. open the full report), outside the toggle. */
  extra?: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
}

/** Canonical Task detail header shared by acceptance definition and result modes. */
export const TaskAcceptanceHeader = memo<TaskAcceptanceHeaderProps>(
  ({ count, extra, isOpen, onToggle }) => {
    const { t } = useTranslation('chat');

    const toggle = (
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

    if (!extra) return toggle;

    return (
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        {toggle}
        {/* Lives outside the toggle: opening the report should not also fold
          the section the user is reading. */}
        <Flexbox onClick={(event) => event.stopPropagation()}>{extra}</Flexbox>
      </Flexbox>
    );
  },
);

TaskAcceptanceHeader.displayName = 'TaskAcceptanceHeader';
