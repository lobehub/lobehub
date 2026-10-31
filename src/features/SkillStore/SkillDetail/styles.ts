import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const ICON_SIZE = 56;

const compiled = stylex.create({
  authorLink: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    color: cssVar.colorPrimary,
    textDecorationLine: { 'default': null, ':hover': 'underline' },
  },
  code: {
    fontFamily: cssVar.fontFamilyCode,
  },
  detailItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  detailLabel: {
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  header: {
    display: 'flex',
    gap: '16px',
    alignItems: 'center',
    borderRadius: '12px',
  },
  icon: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    // ICON_SIZE
    width: '56px',
    height: '56px',
  },
  introduction: {
    fontSize: '14px',
    lineHeight: 1.8,
    color: cssVar.colorText,
  },
  nav: {
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorder,
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: cssVar.colorText,
  },
  title: {
    fontSize: '18px',
    fontWeight: 600,
    color: cssVar.colorText,
  },
  trustWarning: {
    fontSize: '12px',
    lineHeight: 1.6,
    color: cssVar.colorTextTertiary,
  },
});

// Consumers pass these to `className` props of other components, so they are exported as
// compiled class names.
export const styles = {
  authorLink: stylex.props(compiled.authorLink).className,
  code: stylex.props(compiled.code).className,
  detailItem: stylex.props(compiled.detailItem).className,
  detailLabel: stylex.props(compiled.detailLabel).className,
  header: stylex.props(compiled.header).className,
  icon: stylex.props(compiled.icon).className,
  introduction: stylex.props(compiled.introduction).className,
  nav: stylex.props(compiled.nav).className,
  sectionTitle: stylex.props(compiled.sectionTitle).className,
  title: stylex.props(compiled.title).className,
  trustWarning: stylex.props(compiled.trustWarning).className,
};
