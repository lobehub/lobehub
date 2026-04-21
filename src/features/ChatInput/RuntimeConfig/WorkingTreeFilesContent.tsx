import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkingTreeFiles } from './useWorkingTreeFiles';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow-y: auto;

    width: 320px;
    max-height: 360px;
    padding: 4px;

    font-size: 12px;
  `,
  empty: css`
    padding-block: 16px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  path: css`
    overflow: hidden;
    flex: 1;

    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  row: css`
    display: flex;
    gap: 12px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 12px;
    border-radius: 4px;

    line-height: 1.4;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  sectionHeader: css`
    padding-block: 6px 4px;
    padding-inline: 12px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
    text-transform: uppercase;
  `,
  statusAdded: css`
    flex: none;
    width: 10px;
    color: ${cssVar.colorSuccess};
    text-align: center;
  `,
  statusDeleted: css`
    flex: none;
    width: 10px;
    color: ${cssVar.colorError};
    text-align: center;
  `,
  statusModified: css`
    flex: none;
    width: 10px;
    color: ${cssVar.colorWarning};
    text-align: center;
  `,
}));

interface WorkingTreeFilesContentProps {
  enabled: boolean;
  path: string;
}

const WorkingTreeFilesContent = memo<WorkingTreeFilesContentProps>(({ path, enabled }) => {
  const { t } = useTranslation('plugin');
  const { data, isLoading } = useWorkingTreeFiles(path, enabled);

  const sections = useMemo(
    () => [
      {
        items: data?.added ?? [],
        key: 'added' as const,
        label: t('localSystem.workingDirectory.filesAdded'),
        sign: '+',
        statusClass: styles.statusAdded,
      },
      {
        items: data?.modified ?? [],
        key: 'modified' as const,
        label: t('localSystem.workingDirectory.filesModified'),
        sign: '±',
        statusClass: styles.statusModified,
      },
      {
        items: data?.deleted ?? [],
        key: 'deleted' as const,
        label: t('localSystem.workingDirectory.filesDeleted'),
        sign: '−',
        statusClass: styles.statusDeleted,
      },
    ],
    [data, t],
  );

  const hasAny = sections.some((s) => s.items.length > 0);

  if (!data && isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>{t('localSystem.workingDirectory.filesLoading')}</div>
      </div>
    );
  }

  if (!hasAny) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>{t('localSystem.workingDirectory.filesEmpty')}</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {sections.map(({ key, items, label, sign, statusClass }) =>
        items.length > 0 ? (
          <div key={key}>
            <div className={styles.sectionHeader}>
              {label} · {items.length}
            </div>
            {items.map((file) => (
              <div className={styles.row} key={`${key}:${file}`} title={file}>
                <span className={statusClass}>{sign}</span>
                <span className={styles.path}>{file}</span>
              </div>
            ))}
          </div>
        ) : null,
      )}
    </div>
  );
});

WorkingTreeFilesContent.displayName = 'WorkingTreeFilesContent';

export default WorkingTreeFilesContent;
