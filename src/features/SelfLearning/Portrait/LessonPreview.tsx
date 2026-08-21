'use client';

import { Flexbox, SkeletonParagraph, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { previewSections } from '../helpers';
import { useExpertiseLesson } from '../hooks';

const styles = createStaticStyles(({ css }) => ({
  root: css`
    /*
     * A row near the fold leaves less room below it than the card wants. base-ui publishes the
     * space it actually has as --available-height; without this the card runs past the viewport
     * and its evidence and click hint become unreachable.
     */
    overflow-y: auto;
    width: 380px;
    max-width: min(380px, calc(100vw - 32px));

    /* less the popup's own chrome, which sits outside this element */
    max-height: calc(var(--available-height, 100dvh) - 16px);
  `,
  section: css`
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr);
    gap: 12px;
    align-items: baseline;
  `,
  separator: css`
    flex: none;
    height: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  title: css`
    text-wrap: balance;
  `,
}));

const MAX_EVIDENCE = 3;

interface LessonPreviewProps {
  /** Carried from the list row so the card has a header before the fetch lands. */
  code: string;
  layer?: string | null;
  lessonId: string;
  title: string;
}

/**
 * 悬停一条经验时展开的预览卡。
 *
 * 清单一行只放得下「标题 + 靠不靠谱」，但要判断一条经验是否可信，看的是它的理由和用法 ——
 * 那些原来得逐条点进详情页。这里按需拉同一份详情（SWR 缓存，真点进去时不会再请求一次），
 * 只截取判断需要的部分：为什么、怎么用、最近在哪几次实践里验证过。
 */
const LessonPreview = memo<LessonPreviewProps>(({ code, layer, lessonId, title }) => {
  const { t } = useTranslation('selfLearning');
  const { data, isLoading } = useExpertiseLesson(lessonId);

  const sections = previewSections(data?.lesson.sections);
  const evidence = data?.hits.slice(0, MAX_EVIDENCE) ?? [];

  return (
    <Flexbox className={styles.root} gap={10} padding={4}>
      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'} weight={600}>
          {t('rules.detail.eyebrow', { code })}
        </Text>
        <Text className={styles.title} fontSize={15} lineHeight={1.45} weight={600}>
          {title}
        </Text>
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          <Text fontSize={12} type={'secondary'}>
            {data
              ? t('rules.detail.meta', {
                  hits: data.lesson.hitCount,
                  runs: data.lesson.hitRunCount,
                })
              : t('preview.loading')}
          </Text>
          {layer && <Tag size={'small'}>{layer}</Tag>}
        </Flexbox>
      </Flexbox>

      {isLoading && !data && <SkeletonParagraph rows={3} />}

      {sections.length > 0 && (
        <>
          <div className={styles.separator} />
          <Flexbox gap={8}>
            {sections.map(({ label, ...section }) => (
              <div className={styles.section} key={section.key}>
                <Text fontSize={12} type={'secondary'} weight={600}>
                  {label ? t(label) : section.key}
                </Text>
                <Text fontSize={12.5} lineClamp={4} lineHeight={1.6}>
                  {section.body}
                </Text>
              </div>
            ))}
          </Flexbox>
        </>
      )}

      {evidence.length > 0 && (
        <>
          <div className={styles.separator} />
          <Flexbox gap={6}>
            <Text fontSize={12} type={'secondary'} weight={600}>
              {t('rules.detail.examples')}
            </Text>
            {evidence.map((hit, index) => (
              <Flexbox horizontal align={'flex-start'} gap={8} key={`${hit.createdAt}-${index}`}>
                <Text
                  fontSize={12}
                  style={{ flex: 'none' }}
                  type={hit.outcome === 'pass' ? 'secondary' : 'warning'}
                >
                  {t(`rules.detail.outcome.${hit.outcome}`)}
                </Text>
                <Text fontSize={12} lineClamp={2} type={'secondary'}>
                  {hit.example}
                </Text>
              </Flexbox>
            ))}
            {data && data.hits.length > MAX_EVIDENCE && (
              <Text fontSize={12} type={'secondary'}>
                {t('preview.moreEvidence', { count: data.hits.length - MAX_EVIDENCE })}
              </Text>
            )}
          </Flexbox>
        </>
      )}

      <Text fontSize={11.5} type={'secondary'}>
        {t('preview.openHint')}
      </Text>
    </Flexbox>
  );
});

LessonPreview.displayName = 'ExpertiseLessonPreview';

export default LessonPreview;
