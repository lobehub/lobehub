'use client';

import { Button } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import type { ImageVersion } from './context';

const styles = stylex.create({
  bar: {
    position: 'absolute',
    zIndex: 3,
    insetBlockStart: '48px',
    insetInlineStart: '8px',
    overflowX: 'auto',
    display: 'flex',
    gap: '2px',
    alignItems: 'center',
    maxWidth: 'calc(100% - 16px)',
    padding: '2px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowTertiary,
  },
  item: { flexShrink: 0 },
});

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
    <div aria-label={t('imageViewer.version.label')} {...stylex.props(styles.bar)} role={'toolbar'}>
      {items.map((item) => {
        const selected = item.id === activeId;
        return (
          <Button
            aria-pressed={selected}
            className={stylex.props(styles.item).className}
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
