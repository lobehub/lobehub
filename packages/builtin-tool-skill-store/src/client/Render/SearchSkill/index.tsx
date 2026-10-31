'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { MarketSkillItem, SearchSkillParams, SearchSkillState } from '../../../types';

const styles = stylex.create({
  container: {
    overflow: 'hidden',
    width: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '12px',
    background: cssVar.colorBgContainer,
  },
  description: { fontSize: '13px', lineHeight: 1.6, color: cssVar.colorTextSecondary },
  empty: { padding: '24px', color: cssVar.colorTextTertiary, textAlign: 'center' },
  identifier: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  item: {
    paddingBlock: '12px',
    paddingInline: '14px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: { 'default': 'dashed', ':last-child': 'none' },
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  meta: { fontSize: '12px', color: cssVar.colorTextTertiary },
  title: { fontSize: '14px', fontWeight: 500, color: cssVar.colorText },
});

interface SkillItemProps {
  skill: MarketSkillItem;
}

const SkillItem = memo<SkillItemProps>(({ skill }) => {
  const { t } = useTranslation('plugin');

  return (
    <Flexbox className={stylex.props(styles.item).className} gap={6}>
      <Flexbox gap={2}>
        <div {...stylex.props(styles.title)}>{skill.name}</div>
        <div {...stylex.props(styles.identifier)}>{skill.identifier}</div>
      </Flexbox>
      {(skill.description || skill.summary) && (
        <div {...stylex.props(styles.description)}>{skill.summary || skill.description}</div>
      )}
      <Flexbox horizontal gap={6} wrap={'wrap'}>
        {skill.version && (
          <Tag
            size={'small'}
          >{`${t('builtins.lobe-skill-store.render.version')}: ${skill.version}`}</Tag>
        )}
        <Tag
          size={'small'}
        >{`${t('builtins.lobe-skill-store.render.installs')}: ${skill.installCount}`}</Tag>
        {skill.category && <Tag size={'small'}>{skill.category}</Tag>}
      </Flexbox>
      {skill.repository && (
        <Text ellipsis className={stylex.props(styles.meta).className}>
          {`${t('builtins.lobe-skill-store.render.repository')}: ${skill.repository}`}
        </Text>
      )}
    </Flexbox>
  );
});

SkillItem.displayName = 'SkillItem';

const SearchSkill = memo<BuiltinRenderProps<SearchSkillParams, SearchSkillState>>(
  ({ pluginState }) => {
    const { t } = useTranslation('plugin');

    const items = pluginState?.items || [];

    if (items.length === 0) {
      return (
        <div {...stylex.props(styles.container)}>
          <div {...stylex.props(styles.empty)}>
            {t('builtins.lobe-skill-store.inspector.noResults')}
          </div>
        </div>
      );
    }

    return (
      <Flexbox className={stylex.props(styles.container).className}>
        {items.map((skill) => (
          <SkillItem key={skill.identifier} skill={skill} />
        ))}
      </Flexbox>
    );
  },
);

SearchSkill.displayName = 'SearchSkill';

export default SearchSkill;
