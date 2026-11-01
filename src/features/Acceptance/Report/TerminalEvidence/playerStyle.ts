import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import relational from './player.module.css';

const definitions = stylex.create({
  screen: {
    overflow: 'auto',
    maxHeight: '480px',
    padding: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgContainer,
  },
  clock: {
    flex: 'none',
    minWidth: '88px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextSecondary,
  },
  rate: {
    cursor: 'pointer',
    flex: 'none',
    minWidth: '36px',
    paddingBlock: '2px',
    paddingInline: '6px',
    borderWidth: '0',
    borderStyle: 'none',
    borderRadius: cssVar.borderRadiusSM,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
  },
  rateActive: {
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillSecondary,
  },
  marker: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '6px',
    alignItems: 'center',
    maxWidth: '100%',
    paddingBlock: '2px',
    paddingInline: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusXS,
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
  },
  markerTime: {
    fontFamily: cssVar.fontFamilyCode,
    color: cssVar.colorTextTertiary,
  },
});

export const styles = {
  screen: cx(stylex.props(definitions.screen).className ?? '', relational.screen),
  clock: stylex.props(definitions.clock).className ?? '',
  rate: stylex.props(definitions.rate).className ?? '',
  rateActive: stylex.props(definitions.rateActive).className ?? '',
  marker: stylex.props(definitions.marker).className ?? '',
  markerTime: stylex.props(definitions.markerTime).className ?? '',
};
