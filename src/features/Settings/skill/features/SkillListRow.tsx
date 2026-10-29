'use client';

import { Block, Center, cssVar, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { cssVar as sxVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight, CircleCheck } from 'lucide-react';
import { createContext, memo, type ReactNode, use } from 'react';

import NavItem, { type NavItemProps } from '@/features/NavPanel/components/NavItem';

/**
 * `nav` is the compact sidebar row beside a detail pane; `page` is the
 * full-width list a row opens a second-level page from.
 */
export type SkillListVariant = 'nav' | 'page';

const SkillListVariantContext = createContext<SkillListVariant>('nav');

export const SkillListVariantProvider = SkillListVariantContext.Provider;

export const useSkillListVariant = () => use(SkillListVariantContext);

const styles = stylex.create({
  chevron: {
    color: sxVar.colorTextQuaternary,
    flex: 'none',
  },
  iconTile: {
    backgroundColor: sxVar.colorBgContainer,
    borderColor: sxVar.colorBorderSecondary,
    borderRadius: sxVar.borderRadius,
    borderStyle: 'solid',
    borderWidth: 1,
    flex: 'none',
    height: 36,
    overflow: 'hidden',
    width: 36,
  },
  row: {
    minHeight: 60,
  },
});

interface SkillListRowProps {
  active?: boolean;
  /** Feedback line (connect error, ask an admin); shown in both variants. */
  description?: ReactNode;
  extra?: ReactNode;
  icon: NonNullable<NavItemProps['icon']>;
  onClick?: () => void;
  /** What the connector does; only the page row has room for it. */
  summary?: ReactNode;
  title: string;
  titleColor?: string;
}

const SkillListRow = memo<SkillListRowProps>(
  ({ active, description, extra, icon, onClick, summary, title, titleColor }) => {
    const variant = useSkillListVariant();

    if (variant === 'nav')
      return (
        <NavItem
          active={active}
          description={description}
          extra={extra}
          icon={icon}
          title={title}
          titleColor={titleColor}
          onClick={onClick}
        />
      );

    const IconNode = icon as () => ReactNode;

    return (
      <Block
        horizontal
        align={'center'}
        {...stylex.props(styles.row)}
        clickable={!!onClick}
        gap={12}
        paddingBlock={10}
        paddingInline={12}
        variant={'borderless'}
        onClick={onClick}
      >
        <Center {...stylex.props(styles.iconTile)}>
          <IconNode />
        </Center>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text ellipsis weight={500}>
            {title}
          </Text>
          {summary && (
            <Text ellipsis color={cssVar.colorTextDescription} fontSize={12}>
              {summary}
            </Text>
          )}
          {description}
        </Flexbox>
        {extra && (
          <Flexbox horizontal align={'center'} flex={'none'} gap={8}>
            {extra}
          </Flexbox>
        )}
        {onClick && <Icon {...stylex.props(styles.chevron)} icon={ChevronRight} size={16} />}
      </Block>
    );
  },
);

SkillListRow.displayName = 'SkillListRow';

/**
 * The nav row only has room for a check with a tooltip; the page row spells
 * the state out so a scan down the list reads without hovering.
 */
export const ConnectedStatus = memo<{ label: string }>(({ label }) => {
  const variant = useSkillListVariant();
  const check = (
    <Icon
      icon={CircleCheck}
      size={variant === 'page' ? 14 : 16}
      style={{ color: cssVar.colorSuccess }}
    />
  );

  if (variant === 'page')
    return (
      <Flexbox horizontal align={'center'} gap={4}>
        {check}
        <Text fontSize={12} type={'secondary'}>
          {label}
        </Text>
      </Flexbox>
    );

  return (
    <Tooltip title={label}>
      <Center width={20}>{check}</Center>
    </Tooltip>
  );
});

ConnectedStatus.displayName = 'ConnectedStatus';

export default SkillListRow;
