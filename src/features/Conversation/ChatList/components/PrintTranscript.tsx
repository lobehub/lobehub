'use client';

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

import WideScreenContainer from '../../../WideScreenContainer';
import { PrintModeContext } from '../../components/PrintModeContext';
import { CONVERSATION_PRINT_ROOT_CLASS } from '../constants';
import { useIsPrinting } from '../hooks/useIsPrinting';

interface PrintTranscriptProps {
  dataSource: string[];
  itemContent: (index: number, data: string) => ReactNode;
}

/**
 * Print-only copy of the loaded transcript.
 *
 * The virtual list mounts just the rows near the viewport inside a fixed-height
 * scroller, so printing the page captured one screen of messages framed by the
 * app chrome. While the browser prints, every loaded row renders here in normal
 * flow on `document.body`, and the global print styles hide the rest of the
 * app. It exists only between `beforeprint` and `afterprint`, so screens never
 * pay for it.
 */
const PrintTranscript = ({ dataSource, itemContent }: PrintTranscriptProps) => {
  const printing = useIsPrinting();

  if (!printing) return null;

  // Paper is white: re-scope the theme variables to light even in dark mode.
  return createPortal(
    <div className={CONVERSATION_PRINT_ROOT_CLASS} data-theme={'light'}>
      {/* Rows are the live renderer, so mark them static: no editor lifecycle may start here. */}
      <PrintModeContext value>
        {dataSource.map((id, index) => (
          <WideScreenContainer fullWidth key={id}>
            {itemContent(index, id)}
          </WideScreenContainer>
        ))}
      </PrintModeContext>
    </div>,
    document.body,
  );
};

export default PrintTranscript;
