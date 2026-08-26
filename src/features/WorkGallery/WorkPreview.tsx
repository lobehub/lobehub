'use client';

import type { WorkSummaryItem } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { Flexbox } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckCircle2Icon, GitPullRequestIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { getWorkTypeDescriptor } from '@/features/Work/descriptors';
import LinearIcon from '@/features/Work/icons/LinearIcon';

const styles = createStaticStyles(({ css }) => ({
  cover: css`
    position: relative;

    overflow: hidden;

    height: clamp(160px, 15vw, 220px);
    margin: 7px;
    border-radius: 11px;

    /* A white top spotlight keeps the flat fill from reading dull. Light and
       dark need different intensities: on the light grey fill the highlight
       must be near-opaque white to register at all, while in dark mode a few
       percent of white already lifts the surface. */
    background:
      radial-gradient(
        140% 110% at 50% 0%,
        color-mix(in srgb, #fff 85%, transparent) 0%,
        color-mix(in srgb, #fff 30%, transparent) 45%,
        transparent 75%
      ),
      ${cssVar.colorFillTertiary};
    box-shadow: inset 0 1px 0 #fff;

    [data-theme='dark'] & {
      background:
        radial-gradient(
          140% 110% at 50% 0%,
          color-mix(in srgb, #fff 10%, transparent) 0%,
          transparent 65%
        ),
        ${cssVar.colorFillQuaternary};
      box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 12%, transparent);
    }
  `,
  coverBadge: css`
    position: absolute;
    z-index: 2;
    inset-block-start: 9px;
    inset-inline-start: 9px;

    display: grid;
    place-items: center;

    width: 34px;
    height: 34px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 10px;

    color: ${cssVar.colorText};

    background: color-mix(in srgb, ${cssVar.colorBgElevated} 88%, transparent);
    backdrop-filter: blur(12px);
  `,
  grid: css`
    position: absolute;
    inset: 0;

    opacity: 0.22;
    background-image:
      linear-gradient(${cssVar.colorBorderSecondary} 1px, transparent 1px),
      linear-gradient(90deg, ${cssVar.colorBorderSecondary} 1px, transparent 1px);
    background-size: 20px 20px;
  `,
  linearBody: css`
    padding: 20px;
  `,
  linearId: css`
    font-size: 10px;
    font-weight: 650;
    color: ${cssVar.colorTextTertiary};
    letter-spacing: 0.04em;
  `,
  linearTitle: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    margin-block-start: 7px;

    font-size: 13px;
    font-weight: 700;
    line-height: 1.4;
  `,
  mockWindow: css`
    position: absolute;
    inset: 26px;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 9px;

    background: ${cssVar.colorBgContainer};
  `,
  previewDescription: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    margin-block-start: 8px;

    font-size: 9px;
    line-height: 1.55;
    color: ${cssVar.colorTextSecondary};
  `,
  previewBody: css`
    box-sizing: border-box;
    height: 100%;
    padding-block: 20px 28px;
    padding-inline: 20px;
  `,
  previewIdentifier: css`
    font-size: 9px;
    font-weight: 650;
    color: ${cssVar.colorTextTertiary};
  `,
  previewTitle: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    margin-block-start: 7px;

    font-size: 12px;
    font-weight: 700;
    line-height: 1.45;
  `,
  status: css`
    position: absolute;
    z-index: 2;
    inset-block-start: 12px;
    inset-inline-end: 12px;
  `,
  taskBody: css`
    padding: 20px;
  `,
}));

const getStatusColor = (status?: string | null) => {
  const normalized = status?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized.includes('done') || normalized.includes('complete') || normalized === 'merged')
    return 'success';
  if (normalized.includes('review') || normalized.includes('progress')) return 'warning';
  if (normalized.includes('open') || normalized.includes('todo')) return 'info';
  return undefined;
};

interface WorkPreviewProps {
  item: WorkSummaryItem;
  title: string;
}

const WorkPreview = memo<WorkPreviewProps>(({ item, title }) => {
  const { t } = useTranslation('file');
  const descriptor = getWorkTypeDescriptor(item);
  const DescriptorIcon = descriptor.getIcon(item);
  const description = descriptor.getDescription(item);
  const identifier = descriptor.getIdentifier(item);
  const displayIdentifier =
    item.resourceType.startsWith('github_') && identifier?.includes('#')
      ? `#${identifier.split('#').at(-1)}`
      : identifier;
  const previewIdentifier =
    item.resourceType === 'document' ? t('work.type.document') : displayIdentifier;
  const isGithub = item.resourceType.startsWith('github_');
  const isLinear = item.resourceType.startsWith('linear_');
  const taskStatus = item.resourceType === 'task' ? item.task.status : null;
  const status = item.status || taskStatus;

  return (
    <div className={styles.cover}>
      <div className={styles.grid} />
      <div className={styles.mockWindow}>
        {isLinear ? (
          <div className={styles.linearBody}>
            <Flexbox horizontal align={'center'} justify={'space-between'}>
              <span className={styles.linearId}>{identifier}</span>
            </Flexbox>
            <div className={styles.linearTitle}>{title}</div>
            <div className={styles.previewDescription}>{description}</div>
          </div>
        ) : item.resourceType === 'task' ? (
          <Flexbox className={styles.taskBody} gap={10}>
            <Flexbox horizontal align={'center'} gap={8}>
              <CheckCircle2Icon color={cssVar.colorSuccess} size={22} />
              <Text strong>{title}</Text>
            </Flexbox>
            <div className={styles.previewDescription}>{description}</div>
          </Flexbox>
        ) : (
          <div className={styles.previewBody}>
            <Flexbox horizontal align={'center'} gap={6}>
              {item.resourceType === 'github_pull_request' && (
                <GitPullRequestIcon color={cssVar.colorTextTertiary} size={11} />
              )}
              <span className={styles.previewIdentifier}>
                {previewIdentifier || item.resourceType}
              </span>
            </Flexbox>
            <div className={styles.previewTitle}>{title}</div>
            <div className={styles.previewDescription}>{description}</div>
          </div>
        )}
      </div>
      <div className={styles.coverBadge}>
        {isGithub ? (
          <Github size={18} />
        ) : isLinear ? (
          <LinearIcon size={18} />
        ) : (
          <DescriptorIcon size={17} />
        )}
      </div>
      {!isLinear && !isGithub && status && (
        <Tag className={styles.status} color={getStatusColor(status)} size={'small'}>
          {status}
        </Tag>
      )}
    </div>
  );
});

WorkPreview.displayName = 'WorkPreview';

export default WorkPreview;
