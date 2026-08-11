'use client';

import { TextArea } from '@lobehub/ui';
import { Button, Select } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';

import type { ManagedProjection } from '@/projection/devtools';

import { useProjectionEditor } from './useProjectionEditor';

const styles = createStaticStyles(({ css }) => ({
  actions: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  editor: css`
    display: flex;
    flex-direction: column;
    gap: 10px;

    padding: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  footer: css`
    display: flex;
    gap: 8px;
    align-items: flex-start;
    justify-content: space-between;
  `,
  header: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
  `,
  identity: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  label: css`
    font-size: ${cssVar.fontSizeSM};
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  message: css`
    flex: 1;

    padding-block: 4px;

    font-size: ${cssVar.fontSizeSM};
    line-height: 1.4;
    color: ${cssVar.colorTextTertiary};
  `,
  messageError: css`
    color: ${cssVar.colorError};
  `,
  messageSuccess: css`
    color: ${cssVar.colorSuccess};
  `,
  textarea: css`
    resize: vertical;

    min-height: 180px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    line-height: 1.5;
  `,
}));

interface ProjectionEditorProps {
  onPersisted?: () => Promise<void> | void;
  projection: ManagedProjection;
}

const ProjectionEditor = memo<ProjectionEditorProps>(({ onPersisted, projection }) => {
  const {
    apply,
    draft,
    fragmentName,
    fragmentNames,
    isApplying,
    message,
    phase,
    reset,
    selectFragment,
    setDraft,
  } = useProjectionEditor({ onPersisted, projection });

  return (
    <section aria-label={'Projection fragment editor'} className={styles.editor}>
      <div className={styles.header}>
        <span className={styles.label}>Projection</span>
        <span
          className={styles.identity}
          title={`${projection.scope} · ${projection.record.kind}/${projection.record.id}`}
        >
          {projection.scope} · {projection.record.kind}/{projection.record.id}
        </span>
      </div>
      <Select
        aria-label={'Fragment'}
        disabled={isApplying}
        options={fragmentNames.map((name) => ({ label: name, value: name }))}
        size={'small'}
        value={fragmentName}
        variant={'filled'}
        onChange={(value) => {
          if (typeof value === 'string') selectFragment(value);
        }}
      />
      <TextArea
        aria-label={'Fragment JSON'}
        className={styles.textarea}
        disabled={isApplying}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className={styles.footer}>
        <span
          className={cx(
            styles.message,
            phase === 'error' && styles.messageError,
            phase === 'persisted' && styles.messageSuccess,
          )}
        >
          {message ?? 'source and observedAt are generated automatically.'}
        </span>
        <div className={styles.actions}>
          <Button disabled={isApplying} size={'small'} type={'text'} onClick={reset}>
            Reset
          </Button>
          <Button loading={isApplying} size={'small'} type={'primary'} onClick={() => void apply()}>
            Apply
          </Button>
        </div>
      </div>
    </section>
  );
});

ProjectionEditor.displayName = 'ProjectionEditor';

export default ProjectionEditor;
