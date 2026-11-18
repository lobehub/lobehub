'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Handle, Position } from '@xyflow/react';
import {
  BadgeCheck,
  Check,
  CircleDashed,
  CircleDot,
  CircleHelp,
  CirclePause,
  CircleX,
  Repeat2,
  RotateCcw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface FlowNodeData extends Record<string, unknown> {
  attempts: number;
  evidence: number;
  expected: string;
  order?: number;
  review?: 'accepted' | 'rejected';
  selected: boolean;
  state?: 'passed' | 'failed' | 'uncertain' | 'blocked' | 'partial';
  thumbnail?: string;
  title: string;
}

export const flowStateBackground = (state?: string) => {
  switch (state) {
    case undefined: {
      return cssVar.colorFillTertiary;
    }
    case 'passed': {
      return cssVar.colorSuccessBg;
    }
    case 'failed': {
      return cssVar.colorErrorBg;
    }
    default: {
      return cssVar.colorWarningBg;
    }
  }
};

export const flowStateColor = (state?: string) => {
  switch (state) {
    case undefined: {
      return cssVar.colorTextQuaternary;
    }
    case 'passed': {
      return cssVar.colorSuccess;
    }
    case 'failed': {
      return cssVar.colorError;
    }
    default: {
      return cssVar.colorWarning;
    }
  }
};

export const flowStateIcon = (state?: string) => {
  switch (state) {
    case 'passed': {
      return Check;
    }
    case 'failed': {
      return CircleX;
    }
    case 'blocked': {
      return CirclePause;
    }
    case 'partial': {
      return CircleDot;
    }
    case 'uncertain': {
      return CircleHelp;
    }
    default: {
      return CircleDashed;
    }
  }
};

const styles = stylex.create({
  card: {
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '260px',
    height: '100%',
    padding: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    transition: 'border-color 0.15s,\n      box-shadow 0.15s',
  },
  selected: {
    borderColor: { 'default': cssVar.colorPrimary, ':hover': cssVar.colorPrimary },
    boxShadow: `0 0 0 1px ${cssVar.colorPrimary}`,
  },
  frame: {
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    height: '132px',
    borderRadius: '6px',
    backgroundColor: cssVar.colorFillQuaternary,
  },
  frameEmpty: {
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: cssVar.colorBorder,
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextTertiary,
    textAlign: 'center',
  },
  picture: {
    display: 'block',
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
  },
  order: {
    position: 'absolute',
    insetBlockStart: '8px',
    insetInlineStart: '8px',
    minWidth: '20px',
    height: '20px',
    paddingInline: '4px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '4px',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: '18px',
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
    backgroundColor: cssVar.colorBgElevated,
  },
  caption: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
    paddingInline: '4px',
  },
  title: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: '22px',
  },
  footer: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBlockStart: 'auto',
    paddingInline: '4px',
    paddingBlockEnd: '4px',
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextTertiary,
  },
  meta: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
  },
  reviewAccepted: { color: cssVar.colorSuccessText },
  reviewRejected: { color: cssVar.colorErrorText },
  reviewPending: { color: cssVar.colorTextSecondary },
  handle: {
    width: '1px',
    minWidth: '0',
    height: '1px',
    minHeight: '0',
    borderStyle: 'none',
    opacity: 0,
  },
});

function FlowNodeDecision({ attempts, review }: Pick<FlowNodeData, 'attempts' | 'review'>) {
  const { t } = useTranslation('verify');
  if (attempts === 0) return <span>{t('acceptance.decision.notRun')}</span>;
  switch (review) {
    case 'accepted': {
      return (
        <span {...stylex.props(styles.meta, styles.reviewAccepted)}>
          <Icon icon={BadgeCheck} size={14} />
          {t('acceptance.focus.state.accepted')}
        </span>
      );
    }
    case 'rejected': {
      return (
        <span {...stylex.props(styles.meta, styles.reviewRejected)}>
          <Icon icon={RotateCcw} size={14} />
          {t('acceptance.focus.state.needsFix')}
        </span>
      );
    }
    default: {
      return (
        <span {...stylex.props(styles.reviewPending)}>{t('acceptance.focus.state.pending')}</span>
      );
    }
  }
}

export function FlowNode({ data }: { data: FlowNodeData }) {
  const { t } = useTranslation('verify');
  const verdict = t(`flow.state.${data.state ?? 'pending'}`);
  return (
    <>
      <Handle
        className={stylex.props(styles.handle).className}
        id="in"
        position={Position.Left}
        type="target"
      />
      <div {...stylex.props(styles.card, data.selected && styles.selected)}>
        <div {...stylex.props(styles.frame, !data.thumbnail && styles.frameEmpty)}>
          {data.thumbnail ? (
            <img
              alt={data.title}
              draggable={false}
              src={data.thumbnail}
              {...stylex.props(styles.picture)}
            />
          ) : (
            t(data.attempts === 0 ? 'flow.unvisitedShort' : 'flow.noPicture')
          )}
          {data.order !== undefined && <span {...stylex.props(styles.order)}>{data.order}</span>}
        </div>
        <div {...stylex.props(styles.caption)}>
          <span
            aria-label={verdict}
            role="img"
            style={{ display: 'inline-flex', flex: 'none', marginBlockStart: 3 }}
            title={`${t('acceptance.focus.judgeLabel')} · ${verdict}`}
          >
            <Icon color={flowStateColor(data.state)} icon={flowStateIcon(data.state)} size={16} />
          </span>
          <span {...stylex.props(styles.title)}>{data.title}</span>
        </div>
        <div {...stylex.props(styles.footer)}>
          <span {...stylex.props(styles.meta)}>
            {data.attempts > 1 && (
              <>
                <Icon icon={Repeat2} size={12} />
                {data.attempts}
              </>
            )}
          </span>
          <FlowNodeDecision attempts={data.attempts} review={data.review} />
        </div>
      </div>
      <Handle
        className={stylex.props(styles.handle).className}
        id="out"
        position={Position.Right}
        type="source"
      />
      <Handle
        className={stylex.props(styles.handle).className}
        id="return-in"
        position={Position.Bottom}
        style={{ left: '35%' }}
        type="target"
      />
      <Handle
        className={stylex.props(styles.handle).className}
        id="return-out"
        position={Position.Bottom}
        style={{ left: '65%' }}
        type="source"
      />
    </>
  );
}
