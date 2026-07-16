'use client';

import { Block, Collapse, Flexbox, Icon, Markdown, ScrollShadow, Tag, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, responsive } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import qs from 'query-string';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import PublishedTime from '@/components/PublishedTime';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useDiscoverStore } from '@/store/discover';

import { useDetailActionContext, useDetailContext } from '../../DetailProvider';
import RelatedSkillCard from './RelatedSkillCard';

const styles = createStaticStyles(({ css, cssVar }) => ({
  relatedGrid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;

    ${responsive.sm} {
      grid-template-columns: 1fr;
    }
  `,
  sectionLabel: css`
    margin: 0;

    font-size: 20px;
    font-weight: 700;
    line-height: 1.25;
    color: ${cssVar.colorText};

    ${responsive.sm} {
      font-size: 18px;
    }
  `,
  more: css`
    display: flex;
    align-items: center;
    color: ${cssVar.colorTextSecondary};
  `,
  summary: css`
    font-size: 15px;
    line-height: 1.7;
    color: ${cssVar.colorTextSecondary};

    p {
      margin-block: 0 0.8em;
    }
  `,
  tag: css`
    border-color: color-mix(in srgb, ${cssVar.colorBorderSecondary} 84%, transparent) !important;
    border-radius: 8px !important;
  `,
  versionCard: css`
    border-color: color-mix(in srgb, ${cssVar.colorBorderSecondary} 88%, transparent) !important;
    border-radius: 8px !important;
  `,
}));

const SectionLabel = memo<{ children: string }>(({ children }) => (
  <Text as={'h2'} className={styles.sectionLabel}>
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
  const { data: related } = useFetchRelatedSkills({ category, identifier });

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
        <div className={styles.summary}>
          <Markdown variant={'chat'}>{overview?.summary || description || ''}</Markdown>
        </div>
      </Flexbox>

      {/* SKILL.md */}
      {content && (
        <Collapse
          defaultActiveKey={['skill']}
          expandIconPlacement={'end'}
          padding={{ body: 0 }}
          variant={'outlined'}
          items={[
            {
              children: (
                <ScrollShadow height={480} offset={16} padding={16} size={16}>
                  <Markdown variant={'chat'}>{content}</Markdown>
                </ScrollShadow>
              ),
              key: 'skill',
              label: t('skills.details.overview.instructions'),
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
              <Tag className={styles.tag} key={tag}>
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
            className={styles.versionCard}
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
              className={styles.more}
              style={{ paddingInline: 6 }}
              type={'text'}
              onClick={handleMoreRelated}
            >
              <span>{t('skills.details.related.more')}</span>
              <Icon icon={ChevronRight} />
            </Button>
          </Flexbox>
          <div className={styles.relatedGrid}>
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
