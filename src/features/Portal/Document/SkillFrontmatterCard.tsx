'use client';

import { createStaticStyles, cssVar, cx, Flexbox, Icon, Text } from '@lobehub/ui';
import { ChevronRight } from 'lucide-react';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { parseSkillMarkdownMetadata } from '@/utils/skillMarkdown';

const styles = createStaticStyles(({ css }) => ({
  frontmatter: css`
    margin-block: 16px 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
    background: ${cssVar.colorBgContainer};
  `,
  metadataKey: css`
    flex-shrink: 0;
    width: 112px;
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorTextSecondary};
  `,
  metadataRow: css`
    padding-block: 10px;
    padding-inline: 12px;

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  metadataValue: css`
    min-width: 0;
    white-space: pre-wrap;
  `,
  sectionHeaderCollapsed: css`
    border-block-end: none;
  `,
  sectionHeaderToggle: css`
    cursor: pointer;
    user-select: none;
  `,
  sectionHeader: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

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
      <Flexbox className={styles.frontmatter} data-collapsed={collapsed || undefined}>
        <Flexbox
          horizontal
          align="center"
          aria-expanded={collapsible ? !collapsed : undefined}
          justify="space-between"
          role={collapsible ? 'button' : undefined}
          className={cx(
            styles.sectionHeader,
            collapsible && styles.sectionHeaderToggle,
            collapsed && styles.sectionHeaderCollapsed,
          )}
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
                  className={styles.metadataRow}
                  key={item.key}
                >
                  <Text className={styles.metadataKey}>{item.key}</Text>
                  <Text className={styles.metadataValue}>{item.value}</Text>
                </Flexbox>
              ))
            ) : (
              <Flexbox className={styles.metadataRow}>
                <Text type="secondary">{t('skillFrontmatter.empty')}</Text>
              </Flexbox>
            )))}
      </Flexbox>
    );
  },
);

SkillFrontmatterCard.displayName = 'SkillFrontmatterCard';

export default SkillFrontmatterCard;
