'use client';

import { Flexbox, SkeletonText, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { previewSections } from '../helpers';
import { useExpertiseLesson } from '../hooks';

const styles = stylex.create({
  root: {
    overflowY: 'auto',
    width: '380px',
    maxWidth: 'min(380px, calc(100vw - 32px))',
    maxHeight: 'calc(var(--available-height, 100dvh) - 16px)',
  },
  section: {
    display: 'grid',
    gridTemplateColumns: '56px minmax(0, 1fr)',
    gap: '12px',
    alignItems: 'baseline',
  },
  separator: {
    flex: 'none',
    height: '1px',
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  retry: {
    cursor: 'pointer',
    alignSelf: 'flex-start',
    borderStyle: 'none',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
  open: {
    flex: 'none',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    whiteSpace: 'nowrap',
  },
  title: { textWrap: 'balance' },
});

/** Kept low so the card fits beside the row it describes; the rest is one line away. */
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
    <Flexbox className={stylex.props(styles.root).className} gap={10} padding={4}>
      <Flexbox gap={6}>
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
          <Text fontSize={12} type={'secondary'} weight={600}>
            {t('rules.detail.eyebrow', { code })}
          </Text>
          {/* The row underneath is no longer under the pointer once it moves in here. */}
          <Link
            className={stylex.props(styles.open).className}
            to={lessonPath}
            onClick={(event) => {
              event.preventDefault();
              navigate(lessonPath);
            }}
          >
            {t('preview.open')}
          </Link>
        </Flexbox>
        <Text
          className={stylex.props(styles.title).className}
          fontSize={15}
          lineHeight={1.45}
          weight={600}
        >
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
          className={stylex.props(styles.retry).className}
          fontSize={12}
          type={'info'}
          onClick={() => void mutate()}
        >
          {t('rules.detail.retry')}
        </Text>
      )}

      {sections.length > 0 && (
        <>
          <div {...stylex.props(styles.separator)} />
          <Flexbox gap={8}>
            {sections.map(({ label, ...section }) => (
              <div {...stylex.props(styles.section)} key={section.key}>
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
          <div {...stylex.props(styles.separator)} />
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
