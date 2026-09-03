'use client';

import { Flexbox } from '@lobehub/ui';
import { SkeletonText, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

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

    /*
     * The card is anchored above the row, and this stack never flips a popup to the opposite
     * side — an explicit collisionAvoidance side:'flip' was measured to do nothing. So for a row
     * high on the page the card has to fit in the space above it or its tail becomes unreachable.
     */
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
  retry: css`
    cursor: pointer;
    align-self: flex-start;
    border: 0;
    background: none;
  `,
  open: css`
    flex: none;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  title: css`
    text-wrap: balance;
  `,
}));

/** Kept low so the card fits above the row it describes; the rest is one line away. */
const MAX_EVIDENCE = 2;

interface LessonPreviewProps {
  /** Carried from the list row so the card has a header before the fetch lands. */
  code: string;
  layer?: string | null;
  lessonId: string;
  /** The card outlives the pointer leaving the row, so it carries its own way in. */
  lessonPath: string;
  title: string;
}

/**
 * 悬停一条经验时展开的预览卡。
 *
 * 清单一行只放得下「标题 + 靠不靠谱」，但要判断一条经验是否可信，看的是它的理由和用法 ——
 * 那些原来得逐条点进详情页。这里按需拉同一份详情（SWR 缓存，真点进去时不会再请求一次），
 * 只截取判断需要的部分：为什么、怎么用、最近在哪几次实践里验证过。
 */
const LessonPreview = memo<LessonPreviewProps>(({ code, layer, lessonId, lessonPath, title }) => {
  const { t } = useTranslation('selfLearning');
  const navigate = useWorkspaceAwareNavigate();
  const { data, error, isLoading, mutate } = useExpertiseLesson(lessonId);

  const sections = previewSections(data?.lesson.sections);
  const evidence = data?.hits.slice(0, MAX_EVIDENCE) ?? [];

  return (
    <Flexbox className={styles.root} gap={10} padding={4}>
      <Flexbox gap={6}>
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
          <Text fontSize={12} type={'secondary'} weight={600}>
            {t('rules.detail.eyebrow', { code })}
          </Text>
          {/* The row underneath is no longer under the pointer once it moves in here. */}
          <Link
            className={styles.open}
            to={lessonPath}
            onClick={(event) => {
              event.preventDefault();
              navigate(lessonPath);
            }}
          >
            {t('preview.open')}
          </Link>
        </Flexbox>
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
              : error
                ? t('preview.failed')
                : t('preview.loading')}
          </Text>
          {layer && <Tag size={'small'}>{layer}</Tag>}
        </Flexbox>
      </Flexbox>

      {isLoading && !data && <SkeletonText rows={3} />}

      {/* Without this the card sits on "loading…" forever: SWR clears isLoading on failure. */}
      {!!error && !data && (
        <Text
          as={'button'}
          className={styles.retry}
          fontSize={12}
          type={'info'}
          onClick={() => void mutate()}
        >
          {t('rules.detail.retry')}
        </Text>
      )}

      {sections.length > 0 && (
        <>
          <div className={styles.separator} />
          <Flexbox gap={8}>
            {sections.map(({ label, ...section }) => (
              <div className={styles.section} key={section.key}>
                <Text fontSize={12} type={'secondary'} weight={600}>
                  {label ? t(label) : section.key}
                </Text>
                <Text fontSize={12.5} lineClamp={3} lineHeight={1.6}>
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
    </Flexbox>
  );
});

LessonPreview.displayName = 'ExpertiseLessonPreview';

export default LessonPreview;
