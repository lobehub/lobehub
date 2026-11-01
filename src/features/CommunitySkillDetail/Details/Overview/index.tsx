'use client';

import {
  Accordion,
  Block,
  Button,
  Flexbox,
  Icon,
  Markdown,
  ScrollShadow,
  Tag,
  Text,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight } from 'lucide-react';
import qs from 'query-string';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import PublishedTime from '@/components/PublishedTime';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useDiscoverStore } from '@/store/discover';
import { skillSelectors } from '@/store/discover/selectors';
import { sx } from '@/styles/sx';

import { useDetailActionContext, useDetailContext } from '../../DetailProvider';
import moduleStyles from './Overview.module.css';
import RelatedSkillCard from './RelatedSkillCard';

const styles = stylex.create({
  relatedGrid: {
    display: 'grid',
    gridTemplateColumns: { default: 'repeat(2, minmax(0, 1fr))', [media.sm]: '1fr' },
    gap: '12px',
  },
  sectionLabel: {
    margin: '0',
    fontSize: { default: '20px', [media.sm]: '18px' },
    fontWeight: 700,
    lineHeight: 1.25,
    color: cssVar.colorText,
  },
  more: { display: 'flex', alignItems: 'center', color: cssVar.colorTextSecondary },
  summary: { fontSize: '15px', lineHeight: 1.7, color: cssVar.colorTextSecondary },
  tag: {
    borderColor: `color-mix(in srgb, ${cssVar.colorBorderSecondary} 84%, transparent)`,
    borderRadius: '8px',
  },
  versionCard: {
    borderColor: `color-mix(in srgb, ${cssVar.colorBorderSecondary} 88%, transparent)`,
    borderRadius: '8px',
  },
});

const SectionLabel = memo<{ children: string }>(({ children }) => (
  <Text as={'h2'} className={stylex.props(styles.sectionLabel).className}>
    {children}
  </Text>
));

const Overview = memo(() => {
  const { t } = useTranslation('discover');
  const {
    tags = [],
    description,
    overview,
    category,
    identifier,
    version,
    versions = [],
    content,
  } = useDetailContext();
  const { close } = useDetailActionContext();
  const navigate = useWorkspaceAwareNavigate();

  const useFetchRelatedSkills = useDiscoverStore((s) => s.useFetchRelatedSkills);
  const { queryKey } = useFetchRelatedSkills({ category, identifier });
  const related = useDiscoverStore(skillSelectors.skillRelated(queryKey));

  // Honor the fetched (possibly deep-linked ?version=) version before falling
  // back to the latest entry
  const selectedVersion =
    versions.find((v) => v.version === version) || versions.find((v) => v.isLatest) || versions[0];

  const handleMoreRelated = useCallback(() => {
    navigate(qs.stringifyUrl({ query: { category }, url: '/community/skill' }));
    // In the modal, leave the detail open no longer than the navigation
    close?.();
  }, [category, close, navigate]);

  return (
    <Flexbox gap={32}>
      {/* ABOUT */}
      <Flexbox gap={12}>
        <SectionLabel>{t('skills.details.overview.about')}</SectionLabel>
        <div {...sx(styles.summary, moduleStyles.summary)}>
          <Markdown variant={'chat'}>{overview?.summary || description || ''}</Markdown>
        </div>
      </Flexbox>

      {/* SKILL.md */}
      {content && (
        <Accordion
          defaultValue={['skill']}
          indicatorPlacement={'end'}
          variant={'outlined'}
          items={[
            {
              children: (
                <ScrollShadow height={480} offset={16} padding={16} size={16}>
                  <Markdown variant={'chat'}>{content}</Markdown>
                </ScrollShadow>
              ),
              key: 'skill',
              title: t('skills.details.overview.instructions'),
            },
          ]}
        />
      )}

      {/* FEATURES */}
      {tags.length > 0 && (
        <Flexbox gap={12}>
          <SectionLabel>{t('skills.details.overview.features')}</SectionLabel>
          <Flexbox horizontal gap={8} wrap={'wrap'}>
            {tags.map((tag) => (
              <Tag className={stylex.props(styles.tag).className} key={tag}>
                {tag}
              </Tag>
            ))}
          </Flexbox>
        </Flexbox>
      )}

      {/* WHAT'S NEW */}
      {selectedVersion?.changelog && (
        <Flexbox gap={12}>
          <SectionLabel>{t('skills.details.overview.whatsNew')}</SectionLabel>
          <Block
            className={stylex.props(styles.versionCard).className}
            gap={12}
            paddingBlock={16}
            paddingInline={16}
            variant={'outlined'}
          >
            <Flexbox horizontal align={'center'} gap={8}>
              <Text style={{ fontFamily: cssVar.fontFamilyCode, fontSize: 14 }} weight={600}>
                {t('skills.details.overview.version', { version: selectedVersion.version })}
              </Text>
              <PublishedTime
                date={selectedVersion.createdAt}
                style={{ color: cssVar.colorTextDescription, fontSize: 12 }}
                template={'MMM DD, YYYY'}
              />
            </Flexbox>
            <Markdown variant={'chat'}>{selectedVersion.changelog}</Markdown>
          </Block>
        </Flexbox>
      )}

      {/* RELATED SKILLS */}
      {related && related.length > 0 && (
        <Flexbox gap={12}>
          <Flexbox horizontal align={'center'} justify={'space-between'}>
            <SectionLabel>{t('skills.details.related.listTitle')}</SectionLabel>
            <Button
              className={stylex.props(styles.more).className}
              style={{ paddingInline: 6 }}
              type={'text'}
              onClick={handleMoreRelated}
            >
              <span>{t('skills.details.related.more')}</span>
              <Icon icon={ChevronRight} />
            </Button>
          </Flexbox>
          <div {...stylex.props(styles.relatedGrid)}>
            {related.map((item) => (
              <RelatedSkillCard key={item.identifier} {...item} />
            ))}
          </div>
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default Overview;
