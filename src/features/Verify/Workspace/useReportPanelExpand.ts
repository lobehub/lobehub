'use client';

import { useResponsive } from 'antd-style';
import { useEffect, useState } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export interface ReportPanelExpand {
  expand: boolean;
  /** Below the breakpoint the panel floats over the report instead of shrinking it. */
  isNarrow: boolean;
  setExpand: (expand: boolean) => void;
}

/**
 * Expand state for the report-list panel, shared by the panel and the expand
 * button that replaces it.
 *
 * Master-detail only works while the detail still has room. The report body wants
 * ~880px and the list is 260–420px wide, so once the viewport drops under `lg` the
 * two can't sit side by side — the report gets squeezed into a column too narrow to
 * read. Below that width the list stops being a fixed column and becomes a float
 * overlay that is closed by default.
 *
 * The narrow-width collapse is deliberately NOT written back to
 * `showVerifyReportPanel`: that flag is the user's preference for the wide layout,
 * and clobbering it would leave the panel collapsed after they resize back — the
 * layout would have silently "remembered" a decision the user never made.
 */
export const useReportPanelExpand = (): ReportPanelExpand => {
  const [showPanel, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.showVerifyReportPanel(s),
    s.updateSystemStatus,
  ]);
  const { lg = true } = useResponsive();
  const isNarrow = !lg;

  const [floatOpen, setFloatOpen] = useState(false);
  // Leaving the narrow regime hands control back to the persisted preference, so
  // drop the overlay rather than let it linger as a second source of truth.
  useEffect(() => {
    if (!isNarrow) setFloatOpen(false);
  }, [isNarrow]);

  // Not memoized on purpose: it closes over `isNarrow`, and a stale closure here
  // would route a wide-layout toggle into the transient overlay state, silently
  // dropping the user's preference.
  const setExpand = (next: boolean) => {
    if (isNarrow) setFloatOpen(next);
    else updateSystemStatus({ showVerifyReportPanel: next });
  };

  return { expand: isNarrow ? floatOpen : showPanel, isNarrow, setExpand };
};
