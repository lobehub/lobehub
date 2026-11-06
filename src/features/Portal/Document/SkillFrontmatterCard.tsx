'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight } from 'lucide-react';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { parseSkillMarkdownMetadata } from '@/utils/skillMarkdown';

const styles = stylex.create({
  frontmatter: {
    marginBlockStart: '16px',
    marginBlockEnd: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '8px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  metadataKey: {
    flexShrink: 0,
    width: '112px',
    fontFamily: cssVar.fontFamilyCode,
    color: cssVar.colorTextSecondary,
  },
  metadataRow: {
    paddingBlock: '10px',
    paddingInline: '12px',
    borderBlockEndWidth: { 'default': null, ':not(:last-child)': '1px' },
    borderBlockEndStyle: { 'default': null, ':not(:last-child)': 'solid' },
    borderBlockEndColor: { 'default': null, ':not(:last-child)': cssVar.colorBorderSecondary },
  },
  metadataValue: { minWidth: '0', whiteSpace: 'pre-wrap' },
  sectionHeaderCollapsed: { borderBlockEndStyle: 'none' },
  sectionHeaderToggle: { cursor: 'pointer', userSelect: 'none' },
  sectionHeader: {
    paddingBlock: '10px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
});

interface SkillFrontmatterCardProps {
  /** Replaces the key/value rows, e.g. the raw YAML while editing. */
  children?: ReactNode;
  /** Starts folded to its header; the header toggles it. */
  defaultCollapsed?: boolean;
  /** The header's right side, e.g. an edit action. */
  extra?: ReactNode;
  frontmatter: string;
}

/**
 * A skill's frontmatter as a document shows it: a card of key/value rows above
 * the body. Read-only on its own; a host adds editing through `extra`.
 */
const SkillFrontmatterCard = memo<SkillFrontmatterCardProps>(
  ({ children, defaultCollapsed, extra, frontmatter }) => {
    const { t } = useTranslation('editor');
    const metadata = useMemo(() => parseSkillMarkdownMetadata(frontmatter), [frontmatter]);
    const collapsible = defaultCollapsed !== undefined;
    const [collapsed, setCollapsed] = useState(!!defaultCollapsed);

    return (
      <Flexbox
        className={stylex.props(styles.frontmatter).className}
        data-collapsed={collapsed || undefined}
      >
        <Flexbox
          horizontal
          align="center"
          aria-expanded={collapsible ? !collapsed : undefined}
          justify="space-between"
          role={collapsible ? 'button' : undefined}
          className={
            stylex.props(
              styles.sectionHeader,
              collapsible && styles.sectionHeaderToggle,
              collapsed && styles.sectionHeaderCollapsed,
            ).className
          }
          onClick={collapsible ? () => setCollapsed((value) => !value) : undefined}
        >
          <Flexbox horizontal align="center" gap={6}>
            {collapsible && (
              <Icon
                icon={ChevronRight}
                size={14}
                style={{
                  transform: collapsed ? undefined : 'rotate(90deg)',
                  transition: 'transform 0.15s',
                }}
              />
            )}
            <Text type="secondary">{t('skillFrontmatter.title')}</Text>
          </Flexbox>
          {extra}
        </Flexbox>
        {collapsed
          ? null
          : (children ??
            (metadata.length > 0 ? (
              metadata.map((item) => (
                <Flexbox
                  horizontal
                  align="flex-start"
                  className={stylex.props(styles.metadataRow).className}
                  key={item.key}
                >
                  <Text className={stylex.props(styles.metadataKey).className}>{item.key}</Text>
                  <Text className={stylex.props(styles.metadataValue).className}>{item.value}</Text>
                </Flexbox>
              ))
            ) : (
              <Flexbox className={stylex.props(styles.metadataRow).className}>
                <Text type="secondary">{t('skillFrontmatter.empty')}</Text>
              </Flexbox>
            )))}
      </Flexbox>
    );
  },
);

SkillFrontmatterCard.displayName = 'SkillFrontmatterCard';

export default SkillFrontmatterCard;
