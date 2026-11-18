import * as stylex from '@stylexjs/stylex';

import { densityTokens } from './density.stylex';

export const compactDensityTheme = stylex.createTheme(densityTokens, {
  '--lobe-density-control-height': '28px',
  '--lobe-density-font-size': '13px',
  '--lobe-density-header-height': '40px',
  '--lobe-density-icon-box': '24px',
  '--lobe-density-icon-size': '16px',
  '--lobe-density-line-height': '20px',
  '--lobe-density-list-row-height': '40px',
  '--lobe-density-page-title-font-size': '14px',
  '--lobe-density-radius': '6px',
  '--lobe-density-row-height': '32px',
  '--lobe-density-section-gap': '12px',
  '--lobe-density-toolbar-height': '36px',
});
