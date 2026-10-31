'use client';

import { Flexbox, Segmented, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { snakeCase } from 'es-toolkit/compat';
import { memo, useMemo } from 'react';

import { useServerConfigStore } from '@/store/serverConfig';
import { type FeatureFlagKey } from '@/store/serverConfig/slices/featureFlagOverride/action';

type SegmentedValue = 'true' | 'false' | 'inherit';

const styles = stylex.create({
  control: { flex: 'none' },
  meta: { fontFamily: cssVar.fontFamilyCode, fontSize: '10px', color: cssVar.colorTextDescription },
  name: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorText,
  },
  row: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: '6px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderInlineStartWidth: '2px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: 'transparent',
    transition: 'background 120ms ease',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  rowOverridden: {
    borderInlineStartColor: cssVar.colorWarning,
    backgroundColor: { 'default': cssVar.colorWarningBg, ':hover': cssVar.colorWarningBgHover },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
});

const segmentOptions = [
  { label: 'true', value: 'true' as const },
  { label: 'false', value: 'false' as const },
  { label: 'inherit', value: 'inherit' as const },
];

interface FlagRowProps {
  flagKey: FeatureFlagKey;
}

const FlagRow = memo<FlagRowProps>(({ flagKey }) => {
  const original = useServerConfigStore((s) => s._originalFeatureFlags?.[flagKey]);
  const overrideValue = useServerConfigStore(
    (s) => s._featureFlagOverrides[flagKey] as boolean | undefined,
  );
  const setFlagOverride = useServerConfigStore((s) => s.setFlagOverride);

  const isOverridden = overrideValue !== undefined;

  const value: SegmentedValue = useMemo(() => {
    if (overrideValue === true) return 'true';
    if (overrideValue === false) return 'false';
    return 'inherit';
  }, [overrideValue]);

  const handleChange = (next: SegmentedValue) => {
    if (next === 'inherit') {
      setFlagOverride(flagKey, undefined);
      return;
    }
    setFlagOverride(flagKey, next === 'true');
  };

  return (
    <div {...stylex.props(styles.row, isOverridden && styles.rowOverridden)}>
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Text ellipsis className={stylex.props(styles.name).className}>
          {snakeCase(flagKey as string)}
        </Text>
        <span {...stylex.props(styles.meta)}>server: {String(original)}</span>
      </Flexbox>
      <Segmented
        className={stylex.props(styles.control).className}
        options={segmentOptions}
        size={'small'}
        value={value}
        onChange={handleChange}
      />
    </div>
  );
});

FlagRow.displayName = 'DevFeatureFlagPanel/FlagRow';

export default FlagRow;
