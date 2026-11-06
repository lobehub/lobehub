'use client';

import { Button, Flexbox, Input, Switch, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { snakeCase } from 'es-toolkit/compat';
import { ListRestartIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';
import { useServerConfigStore } from '@/store/serverConfig';
import {
  type FeatureFlagKey,
  isFeatureFlagOverridable,
} from '@/store/serverConfig/slices/featureFlagOverride/action';

import FlagRow from './FlagRow';

const styles = stylex.create({
  body: { overflow: 'auto', flex: '1', minHeight: '0' },
  empty: {
    paddingBlock: '32px',
    fontSize: '12px',
    color: cssVar.colorTextDescription,
    textAlign: 'center',
  },
  footer: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  toolbar: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    height: '44px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  toolbarFilter: {
    display: 'flex',
    flexShrink: 0,
    gap: '6px',
    alignItems: 'center',
    height: '100%',
    paddingInline: '12px',
    borderInlineStartWidth: '1px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
  },
});

const Panel = memo(() => {
  const originalFlags = useServerConfigStore((s) => s._originalFeatureFlags);
  const overrideCount = useServerConfigStore((s) => Object.keys(s._featureFlagOverrides).length);
  const overrides = useServerConfigStore((s) => s._featureFlagOverrides);
  const resetFlagOverrides = useServerConfigStore((s) => s.resetFlagOverrides);

  const [search, setSearch] = useState('');
  const [overriddenOnly, setOverriddenOnly] = useState(false);

  const flagKeys = useMemo<FeatureFlagKey[]>(() => {
    if (!originalFlags) return [];
    return (Object.keys(originalFlags) as (keyof typeof originalFlags)[])
      .filter(isFeatureFlagOverridable)
      .sort();
  }, [originalFlags]);

  const visibleKeys = useMemo(() => {
    const term = search.trim().toLowerCase();
    return flagKeys.filter((key) => {
      if (overriddenOnly && overrides[key] === undefined) return false;
      if (!term) return true;
      return snakeCase(key as string).includes(term);
    });
  }, [flagKeys, overrides, overriddenOnly, search]);

  if (!originalFlags)
    return (
      <div {...stylex.props(devDockPanelStyles.root)}>
        <div {...stylex.props(styles.empty)}>Server feature flags are not loaded yet.</div>
      </div>
    );

  return (
    <div {...stylex.props(devDockPanelStyles.root)}>
      <div {...stylex.props(styles.toolbar)}>
        <Input
          allowClear
          className={stylex.props(devDockPanelStyles.searchInput).className}
          placeholder={'Search flag name…'}
          size={'small'}
          value={search}
          variant={'borderless'}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Flexbox horizontal className={stylex.props(styles.toolbarFilter).className}>
          <Switch checked={overriddenOnly} size={'small'} onChange={setOverriddenOnly} />
          <Text style={{ fontSize: 12, whiteSpace: 'nowrap' }} type={'secondary'}>
            overridden only
          </Text>
        </Flexbox>
      </div>

      <div {...stylex.props(styles.body)}>
        {visibleKeys.length === 0 ? (
          <div {...stylex.props(styles.empty)}>No flags match</div>
        ) : (
          visibleKeys.map((key) => <FlagRow flagKey={key} key={key} />)
        )}
      </div>

      <div {...stylex.props(styles.footer)}>
        <Text style={{ fontSize: 11 }} type={'secondary'}>
          {overrideCount} active override{overrideCount === 1 ? '' : 's'} · client-side ·
          localStorage persisted
        </Text>
        <Button
          disabled={overrideCount === 0}
          icon={ListRestartIcon}
          size={'small'}
          onClick={resetFlagOverrides}
        >
          Reset all
        </Button>
      </div>
    </div>
  );
});

Panel.displayName = 'DevFeatureFlagPanel/Panel';

export default Panel;
