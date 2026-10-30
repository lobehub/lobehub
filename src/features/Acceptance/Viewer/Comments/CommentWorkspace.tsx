'use client';

import { ActionIcon, Button, Center, Flexbox, Icon, Text, TextArea } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { SquareDashedMousePointer, Trash2 } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';

/** The point where the side panel folds under the stage, matching the modal shell. */

const styles = stylex.create({
  root: { display: 'flex', flex: '1', flexDirection: 'column', minWidth: 0, minHeight: 0 },
  body: {
    display: { 'default': 'grid', '@media (width <= 767px)': 'flex' },
    gridTemplateColumns: 'minmax(0, 1fr) 352px',
    flex: '1',
    minHeight: 0,
    flexDirection: { 'default': null, '@media (width <= 767px)': 'column' },
    overflowY: { 'default': null, '@media (width <= 767px)': 'auto' },
    overscrollBehavior: { 'default': null, '@media (width <= 767px)': 'contain' },
    gap: { 'default': null, '@media (width <= 767px)': 16 },
    paddingBlockEnd: { 'default': null, '@media (width <= 767px)': 16 },
  },
  stage: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    minWidth: 0,
    minHeight: 0,
    paddingBlock: { 'default': 16, '@media (width <= 767px)': '12px 0' },
    paddingInline: { 'default': 16, '@media (width <= 767px)': 12 },
    backgroundColor: { 'default': cssVar.colorBgLayout, '@media (width <= 767px)': 'transparent' },
    flex: { 'default': null, '@media (width <= 767px)': 'none' },
  },
  fit: {
    containerType: { 'default': 'size', '@media (width <= 767px)': 'normal' },
    display: 'flex',
    flex: { 'default': '1', '@media (width <= 767px)': 'none' },
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 0,
  },
  scroll: {
    overflow: 'auto',
    flex: { 'default': '1', '@media (width <= 767px)': 'none' },
    minHeight: 0,
  },
  panel: {
    overflowY: { 'default': 'auto', '@media (width <= 767px)': 'visible' },
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    minHeight: 0,
    paddingBlock: { 'default': 16, '@media (width <= 767px)': 0 },
    paddingInline: { 'default': 16, '@media (width <= 767px)': 12 },
    borderInlineStartWidth: { 'default': 1, '@media (width <= 767px)': 0 },
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
    flex: { 'default': null, '@media (width <= 767px)': 'none' },
  },
  footer: {
    display: 'flex',
    flex: 'none',
    gap: { 'default': 12, '@media (width <= 767px)': 8 },
    alignItems: { 'default': 'center', '@media (width <= 767px)': 'stretch' },
    flexDirection: { 'default': 'row', '@media (width <= 767px)': 'column' },
    paddingBlockStart: 12,
    paddingBlockEnd: {
      'default': 12,
      '@media (width <= 767px)': 'max(12px, env(safe-area-inset-bottom))',
    },
    paddingInline: { 'default': 16, '@media (width <= 767px)': 12 },
    borderBlockStartWidth: 1,
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  status: { flex: '1', minWidth: 0, fontSize: 12, color: cssVar.colorTextTertiary },
  statusError: { color: cssVar.colorError },
  cancel: { display: { 'default': null, '@media (width <= 767px)': 'none' } },
  send: { minHeight: { 'default': null, '@media (width <= 767px)': 44 } },
  note: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    paddingBlock: 12,
    paddingInline: { 'default': 12, '@media (width <= 767px)': 8 },
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: {
      'default': 'transparent',
      '@media (hover: hover)': { 'default': null, ':hover': cssVar.colorFillTertiary },
    },
    transition: {
      'default': `background ${cssVar.motionDurationMid}, border-color ${cssVar.motionDurationMid}`,
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
  },
  field: { fontSize: { 'default': null, '@media (width <= 767px)': 16 } },
  noteActive: {
    borderColor: cssVar.colorBorder,
    boxShadow: cssVar.boxShadowTertiary,
    backgroundColor: { 'default': cssVar.colorBgContainer, ':hover': cssVar.colorBgContainer },
  },
  statusLink: {
    cursor: 'pointer',
    padding: 0,
    borderWidth: 0,
    font: 'inherit',
    color: { 'default': cssVar.colorText, ':hover': cssVar.colorPrimaryHover },
    textDecoration: 'underline',
    textUnderlineOffset: 3,
    backgroundColor: 'transparent',
    borderRadius: { 'default': null, ':focus-visible': 2 },
    outline: { 'default': null, ':focus-visible': `2px solid ${cssVar.colorPrimaryBorder}` },
  },
  badge: {
    flex: 'none',
    width: 18,
    height: 18,
    borderRadius: '50%',
    fontSize: 11,
    fontWeight: 600,
    lineHeight: '18px',
    color: cssVar.colorTextLightSolid,
    textAlign: 'center',
    backgroundColor: cssVar.colorError,
  },
  empty: {
    flex: '1',
    gap: 8,
    minHeight: { 'default': 200, '@media (width <= 767px)': 0 },
    paddingBlock: { 'default': 32, '@media (width <= 767px)': 16 },
    paddingInline: 24,
    textAlign: 'center',
  },
  emptyIcon: {
    width: 40,
    height: 40,
    borderRadius: cssVar.borderRadiusLG,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
  },
});

interface CommentWorkspaceProps {
  footer: ReactNode;
  inert?: boolean;
  panel: ReactNode;
  /** The picture being commented on. */
  stage: ReactNode;
  /**
   * `fit` centres the stage and makes it a size container (a video sizes its
   * frame to it); `scroll` lets a tall screenshot scroll inside it.
   */
  stageMode: 'fit' | 'scroll';
  strip?: ReactNode;
}

/**
 * The comment composer's frame: the evidence large on the left, the notes being
 * written in a panel on the right, sending pinned underneath. On a phone the
 * panel folds under the stage and the page scrolls; sending stays pinned.
 */
export const CommentWorkspace = ({
  footer,
  inert,
  panel,
  stage,
  stageMode,
  strip,
}: CommentWorkspaceProps) => (
  <div {...stylex.props(styles.root)}>
    <div {...stylex.props(styles.body)}>
      <div {...stylex.props(styles.stage)} inert={inert}>
        {strip}
        <div {...stylex.props(stageMode === 'fit' ? styles.fit : styles.scroll)}>{stage}</div>
      </div>
      <div {...stylex.props(styles.panel)} inert={inert}>
        {panel}
      </div>
    </div>
    <div {...stylex.props(styles.footer)}>{footer}</div>
  </div>
);

export const DraftPanelHeading = ({ count }: { count: number }) => {
  const { t } = useTranslation('verify');
  return (
    <Flexbox horizontal align={'baseline'} gap={8} style={{ paddingInline: 4 }}>
      <Text strong>{t('acceptance.comments.draftsTitle')}</Text>
      {count > 0 && (
        <Text fontSize={12} style={{ color: cssVar.colorTextTertiary }}>
          {count}
        </Text>
      )}
    </Flexbox>
  );
};

/** First use: show what to do with the picture, since nothing is written yet. */
export const DraftEmpty = ({ body }: { body: string }) => {
  const { t } = useTranslation('verify');
  return (
    <Center {...stylex.props(styles.empty)}>
      <Center {...stylex.props(styles.emptyIcon)}>
        <Icon icon={SquareDashedMousePointer} size={20} />
      </Center>
      <Text strong>{t('acceptance.comments.draftEmptyTitle')}</Text>
      <Text fontSize={12} type={'secondary'}>
        {body}
      </Text>
    </Center>
  );
};

interface DraftNoteProps {
  active?: boolean;
  autoFocus?: boolean;
  fieldRef?: Ref<HTMLTextAreaElement>;
  index: number;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onRemove: () => void;
  onSubmit: () => void;
  /** Where the note points — the video's moment, the image's region. */
  stamp?: ReactNode;
  value: string;
}

/** One comment being written: its number, where it points, its own words. */
export const DraftNote = ({
  active,
  autoFocus,
  fieldRef,
  index,
  onChange,
  onFocus,
  onRemove,
  onSubmit,
  stamp,
  value,
}: DraftNoteProps) => {
  const { t } = useTranslation('verify');
  return (
    <div {...stylex.props([styles.note, active && styles.noteActive])}>
      <Flexbox horizontal align={'center'} gap={8}>
        <span {...stylex.props(styles.badge)}>{index}</span>
        <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }}>
          {stamp}
        </Flexbox>
        <ActionIcon
          aria-label={t('acceptance.comments.draftRemove', { index })}
          icon={Trash2}
          size={'small'}
          title={t('acceptance.comments.draftRemove', { index })}
          onClick={onRemove}
        />
      </Flexbox>
      <TextArea
        {...stylex.props(styles.field)}
        aria-label={t('acceptance.comments.draftNumber', { index })}
        autoFocus={autoFocus}
        autoSize={{ maxRows: 8, minRows: 2 }}
        placeholder={t('acceptance.comments.draftPlaceholder')}
        ref={fieldRef}
        value={value}
        variant={active ? 'outlined' : 'filled'}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
    </div>
  );
};

interface DraftFooterProps {
  count: number;
  disabled: boolean;
  error?: boolean;
  loading: boolean;
  onCancel: () => void;
  onSend: () => void;
  status: ReactNode;
}

/** Why sending is or is not possible, then the one primary action. */
export const DraftFooter = ({
  count,
  disabled,
  error,
  loading,
  onCancel,
  onSend,
  status,
}: DraftFooterProps) => {
  const { t } = useTranslation('verify');
  return (
    <>
      <div
        aria-live={'polite'}
        {...stylex.props([styles.status, error && styles.statusError])}
        role={error ? 'alert' : undefined}
      >
        {status}
      </div>
      <Button {...stylex.props(styles.cancel)} disabled={loading} onClick={onCancel}>
        {t('acceptance.actions.cancel')}
      </Button>
      <Button
        {...stylex.props(styles.send)}
        disabled={disabled}
        loading={loading}
        type={'primary'}
        onClick={onSend}
      >
        {count > 1 ? t('acceptance.comments.sendCount', { count }) : t('acceptance.comments.send')}
      </Button>
    </>
  );
};

/** A link-styled line in the footer status that takes you to what blocks sending. */
export const StatusLink = ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
  <button {...stylex.props(styles.statusLink)} type={'button'} onClick={onClick}>
    {children}
  </button>
);
