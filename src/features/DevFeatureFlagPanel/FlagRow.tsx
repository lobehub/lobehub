'use client';

import { Flexbox, Segmented, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { snakeCase } from 'es-toolkit/compat';
import { memo, useMemo } from 'react';

import { useServerConfigStore } from '@/store/serverConfig';
import { type FeatureFlagKey } from '@/store/serverConfig/slices/featureFlagOverride/action';

type SegmentedValue = 'true' | 'false' | 'inherit';

const styles = createStaticStyles(({ css }) => ({
  meta: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 10px;
    color: ${cssVar.colorTextDescription};
  `,
  name: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  row: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    margin-block: 2px;
    margin-inline: 4px;
    padding-block: 6px;
    padding-inline: 8px;
    border-inline-start: 2px solid transparent;
    border-radius: 6px;

    transition: background 120ms ease;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  rowOverridden: css`
    border-inline-start-color: ${cssVar.colorWarning};
    background: ${cssVar.colorWarningBg};

    &:hover {
      background: ${cssVar.colorWarningBgHover};
    }
  `,
}));

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
    <div className={`${styles.row} ${isOverridden ? styles.rowOverridden : ''}`}>
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Text ellipsis className={styles.name}>
          {snakeCase(flagKey as string)}
        </Text>
        <span className={styles.meta}>server: {String(original)}</span>
      </Flexbox>
      <Segmented
        options={segmentOptions}
        size={'small'}
        value={value}
        onChange={(v) => handleChange(v as SegmentedValue)}
      />
    </div>
  );
});

FlagRow.displayName = 'DevFeatureFlagPanel/FlagRow';

export default FlagRow;
