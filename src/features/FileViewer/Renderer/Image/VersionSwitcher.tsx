'use client';

import { Button, createStaticStyles, cssVar } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import type { ImageVersion } from './context';

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    position: absolute;
    z-index: 3;
    inset-block-start: 48px;
    inset-inline-start: 8px;

    overflow-x: auto;
    display: flex;
    gap: 2px;
    align-items: center;

    max-width: calc(100% - 16px);
    padding: 2px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowTertiary};
  `,
  item: css`
    flex-shrink: 0;
  `,
}));

interface VersionSwitcherProps {
  /** Version on stage; `undefined` means the original. */
  activeId?: string;
  onSelect: (fileId?: string) => void;
  versions: ImageVersion[];
}

/** Switch the stage between the original and the edits saved in this session. */
const VersionSwitcher = ({ activeId, onSelect, versions }: VersionSwitcherProps) => {
  const { t } = useTranslation('file');

  const items = [
    { id: undefined, label: t('imageViewer.version.original'), title: undefined },
    ...versions.map((version) => ({
      id: version.fileId,
      label: t(`imageViewer.tool.${version.operation}`),
      title: version.name,
    })),
  ];

  return (
    <div aria-label={t('imageViewer.version.label')} className={styles.bar} role={'toolbar'}>
      {items.map((item) => {
        const selected = item.id === activeId;
        return (
          <Button
            aria-pressed={selected}
            className={styles.item}
            key={item.id ?? 'original'}
            size={'small'}
            title={item.title}
            type={selected ? 'primary' : 'text'}
            onClick={() => onSelect(item.id)}
          >
            {item.label}
          </Button>
        );
      })}
    </div>
  );
};

export default VersionSwitcher;
