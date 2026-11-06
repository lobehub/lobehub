'use client';

import type { WorkSummaryItem } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckCircle2Icon, GitPullRequestIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { getWorkTypeDescriptor } from '@/features/Work/descriptors';
import LinearIcon from '@/features/Work/icons/LinearIcon';

const DARK = ':is([data-theme="dark"] *)';

const styles = stylex.create({
  cover: {
    // Keep color-mix precision and percentage positions through CSS optimization.
    '--work-preview-highlight': '#fff',
    '--work-preview-background-position': '0% 0%',
    'position': 'relative',
    'overflow': 'hidden',
    'height': 'clamp(160px, 15vw, 220px)',
    'margin': '7px',
    'borderRadius': '11px',
    'backgroundColor': { default: cssVar.colorFillTertiary, [DARK]: cssVar.colorFillQuaternary },
    'backgroundImage': {
      default:
        'radial-gradient(140% 110% at center top, color-mix(in srgb, var(--work-preview-highlight) 85%, transparent) 0%, color-mix(in srgb, var(--work-preview-highlight) 30%, transparent) 45%, transparent 75%), none',
      [DARK]:
        'radial-gradient(140% 110% at center top, color-mix(in srgb, var(--work-preview-highlight) 10%, transparent) 0%, transparent 65%), none',
    },
    'backgroundPosition':
      'var(--work-preview-background-position), var(--work-preview-background-position)',
    'backgroundSize': 'auto, auto',
    'backgroundRepeat': 'repeat, repeat',
    // eslint-disable-next-line @stylexjs/valid-styles -- Preserve both background layers; the 0.19 keyword validator omits comma lists.
    'backgroundOrigin': 'padding-box, padding-box',
    // eslint-disable-next-line @stylexjs/valid-styles -- Valid list-valued CSS, accepted by the compiler.
    'backgroundClip': 'border-box, border-box',
    // eslint-disable-next-line @stylexjs/valid-styles -- Valid list-valued CSS, accepted by the compiler.
    'backgroundAttachment': 'scroll, scroll',
    'boxShadow': {
      default: 'inset 0 1px 0 #fff',
      [DARK]: 'inset 0 1px 0 color-mix(in srgb, var(--work-preview-highlight) 12%, transparent)',
    },
  },
  coverBadge: {
    position: 'absolute',
    zIndex: 2,
    insetBlockStart: '9px',
    insetInlineStart: '9px',
    display: 'grid',
    placeItems: 'center',
    width: '34px',
    height: '34px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '10px',
    color: cssVar.colorText,
    backgroundColor: `color-mix(in srgb, ${cssVar.colorBgElevated} 88%, transparent)`,
    backgroundImage: 'none',
    backdropFilter: 'blur(12px)',
  },
  grid: {
    position: 'absolute',
    inset: 0,
    opacity: 0.22,
    backgroundImage: `linear-gradient(${cssVar.colorBorderSecondary} 1px, transparent 1px),
      linear-gradient(90deg, ${cssVar.colorBorderSecondary} 1px, transparent 1px)`,
    backgroundSize: '20px 20px',
  },
  linearBody: { padding: '20px' },
  linearId: {
    fontSize: '10px',
    fontWeight: 650,
    color: cssVar.colorTextTertiary,
    letterSpacing: '0.04em',
  },
  linearTitle: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
    marginBlockStart: '7px',
    fontSize: '13px',
    fontWeight: 700,
    lineHeight: 1.4,
  },
  mockWindow: {
    position: 'absolute',
    inset: '26px',
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '9px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  previewDescription: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
    marginBlockStart: '8px',
    fontSize: '9px',
    lineHeight: 1.55,
    color: cssVar.colorTextSecondary,
  },
  previewBody: {
    boxSizing: 'border-box',
    height: '100%',
    paddingBlockStart: '20px',
    paddingBlockEnd: '28px',
    paddingInline: '20px',
  },
  previewIdentifier: {
    fontSize: '9px',
    fontWeight: 650,
    color: cssVar.colorTextTertiary,
  },
  previewTitle: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
    marginBlockStart: '7px',
    fontSize: '12px',
    fontWeight: 700,
    lineHeight: 1.45,
  },
  status: {
    position: 'absolute',
    zIndex: 2,
    insetBlockStart: '12px',
    insetInlineEnd: '12px',
  },
  taskBody: { padding: '20px' },
});

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
    <div {...stylex.props(styles.cover)}>
      <div {...stylex.props(styles.grid)} />
      <div {...stylex.props(styles.mockWindow)}>
        {isLinear ? (
          <div {...stylex.props(styles.linearBody)}>
            <Flexbox horizontal align={'center'} justify={'space-between'}>
              <span {...stylex.props(styles.linearId)}>{identifier}</span>
            </Flexbox>
            <div {...stylex.props(styles.linearTitle)}>{title}</div>
            <div {...stylex.props(styles.previewDescription)}>{description}</div>
          </div>
        ) : item.resourceType === 'task' ? (
          <Flexbox className={stylex.props(styles.taskBody).className} gap={10}>
            <Flexbox horizontal align={'center'} gap={8}>
              <CheckCircle2Icon color={cssVar.colorSuccess} size={22} />
              <Text strong>{title}</Text>
            </Flexbox>
            <div {...stylex.props(styles.previewDescription)}>{description}</div>
          </Flexbox>
        ) : (
          <div {...stylex.props(styles.previewBody)}>
            <Flexbox horizontal align={'center'} gap={6}>
              {item.resourceType === 'github_pull_request' && (
                <GitPullRequestIcon color={cssVar.colorTextTertiary} size={11} />
              )}
              <span {...stylex.props(styles.previewIdentifier)}>
                {previewIdentifier || item.resourceType}
              </span>
            </Flexbox>
            <div {...stylex.props(styles.previewTitle)}>{title}</div>
            <div {...stylex.props(styles.previewDescription)}>{description}</div>
          </div>
        )}
      </div>
      <div {...stylex.props(styles.coverBadge)}>
        {isGithub ? (
          <Github size={18} />
        ) : isLinear ? (
          <LinearIcon size={18} />
        ) : (
          <DescriptorIcon size={17} />
        )}
      </div>
      {!isLinear && !isGithub && status && (
        <Tag
          className={stylex.props(styles.status).className}
          color={getStatusColor(status)}
          size={'small'}
        >
          {status}
        </Tag>
      )}
    </div>
  );
});

WorkPreview.displayName = 'WorkPreview';

export default WorkPreview;
