import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Loading from '@/components/Loading/CircleLoading';

import PaneFooter from '../PaneFooter';
import { classifySheet } from './classifySheet';
import { MAX_PREVIEW_ROWS, readWorkbook, type SheetModel } from './model';
import SheetDocument from './SheetDocument';
import SheetGrid from './SheetGrid';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    height: 100%;
    background: ${cssVar.colorBgContainer};
  `,
}));

interface XlsxPaneProps {
  blob: Blob;
  onError: (error: unknown) => void;
}

const XlsxPane = memo<XlsxPaneProps>(({ blob, onError }) => {
  const { t } = useTranslation('chat');
  const [sheets, setSheets] = useState<SheetModel[]>();
  const [activeSheet, setActiveSheet] = useState(0);
  const [mode, setMode] = useState<'auto' | 'fidelity' | 'reflow'>('auto');

  useEffect(() => {
    let disposed = false;

    readWorkbook(blob)
      .then((parsed) => {
        if (disposed) return;
        setSheets(parsed);
        setActiveSheet(0);
        setMode('auto');
      })
      .catch((error) => {
        if (!disposed) onError(error);
      });

    return () => {
      disposed = true;
    };
  }, [blob, onError]);

  const sheet = sheets?.[activeSheet] ?? sheets?.[0];
  const outline = useMemo(() => (sheet ? classifySheet(sheet) : undefined), [sheet]);

  if (!sheet || !outline) return <Loading />;

  const resolvedMode = mode === 'auto' ? outline.mode : mode;

  return (
    <div className={styles.container}>
      {resolvedMode === 'reflow' ? (
        <SheetDocument outline={outline} />
      ) : (
        <SheetGrid sheet={sheet} />
      )}
      <PaneFooter
        activeMode={resolvedMode}
        activeTab={String(activeSheet)}
        tabs={sheets!.map((item, index) => ({ key: String(index), label: item.name }))}
        modes={[
          { key: 'reflow', label: t('workingPanel.localFile.document.xlsxReflow') },
          { key: 'fidelity', label: t('workingPanel.localFile.document.xlsxOriginal') },
        ]}
        note={
          sheet.truncated
            ? t('workingPanel.localFile.document.truncatedRows', { count: MAX_PREVIEW_ROWS })
            : undefined
        }
        onModeChange={(key) => setMode(key as 'fidelity' | 'reflow')}
        onTabChange={(key) => setActiveSheet(Number(key))}
      />
    </div>
  );
});

XlsxPane.displayName = 'XlsxPane';

export default XlsxPane;
