import { Block, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { memo } from 'react';

// The section-header contract used by TaskAcceptance / TaskActivities:
// Block clickable borderless · paddingBlock 4 / paddingInline 8 · 16px description-colored icon ·
// 13px/500 secondary text · optional count Tag · rotating chevron. `extra` sits on the far right and
// stops propagation. (src/features/AgentTasks/AgentTaskDetail/TaskAcceptanceHeader.tsx)

const useStyles = createStyles(({ css, token }) => ({
  arrow: css`
    flex: none;
    color: ${token.colorTextDescription};
    transition: transform 0.2s;
  `,
  arrowOpen: css`
    transform: rotate(90deg);
  `,
}));

/** Same 16×16 chevron the Task accordions use (shared/AccordionArrowIcon.tsx). */
const ArrowIcon = memo<{ isOpen?: boolean }>(({ isOpen }) => {
  const { styles, cx } = useStyles();
  return (
    <svg
      className={cx(styles.arrow, isOpen && styles.arrowOpen)}
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M6 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
});

interface SectionHeaderProps {
  icon: LucideIcon;
  title: string;
  count?: number;
  isOpen?: boolean;
  extra?: React.ReactNode;
  onToggle: () => void;
}

export const SectionHeader = memo<SectionHeaderProps>(
  ({ icon, title, count, isOpen, extra, onToggle }) => {
    const toggle = (
      <Block
        clickable
        horizontal
        align="center"
        gap={8}
        paddingBlock={4}
        paddingInline={8}
        style={{ cursor: 'pointer', width: 'fit-content' }}
        variant="borderless"
        onClick={onToggle}
      >
        <Icon color="var(--ant-color-text-description)" icon={icon} size={16} />
        <Text color="var(--ant-color-text-secondary)" fontSize={13} weight={500}>
          {title}
        </Text>
        {!!count && <Tag size="small">{count}</Tag>}
        <ArrowIcon isOpen={isOpen} />
      </Block>
    );
    if (!extra) return toggle;
    return (
      <Flexbox horizontal align="center" justify="space-between">
        {toggle}
        <Flexbox horizontal gap={4} align="center" onClick={(e) => e.stopPropagation()}>
          {extra}
        </Flexbox>
      </Flexbox>
    );
  },
);
