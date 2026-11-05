'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MapPin } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import { findObject, PIXEL_YARD_SCENE } from '../../scene';
import type { MiniGameApiNameType, MoveToParams } from '../../types';
import { MiniGameIdentifier } from '../../types';

const styles = stylex.create({
  chip: {
    alignItems: 'center',
    backgroundColor: cssVar.colorFillTertiary,
    borderRadius: 999,
    color: cssVar.colorText,
    display: 'inline-flex',
    flexShrink: 1,
    fontSize: 12,
    gap: 4,
    marginInlineStart: 6,
    minWidth: 0,
    overflow: 'hidden',
    paddingBlock: 2,
    paddingInline: 8,
    whiteSpace: 'nowrap',
  },
  icon: {
    color: cssVar.colorTextDescription,
    flexShrink: 0,
  },
});

/** Header strip of every mini game call: the action and where it heads. */
export const MiniGameInspector = memo<BuiltinInspectorProps<MoveToParams>>(
  ({ apiName, args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation(['plugin', 'chat']);
    const label = t(`builtins.${MiniGameIdentifier}.apiName.${apiName as MiniGameApiNameType}`, {
      ns: 'plugin',
    });
    const params = { ...partialArgs, ...args };

    const object = params.targetId ? findObject(PIXEL_YARD_SCENE, params.targetId) : undefined;
    let value = '';
    if (object) value = t(`miniGame.objects.${object.kind}`, { ns: 'chat' });
    else if (params.targetId) value = params.targetId;
    else if (typeof params.x === 'number' && typeof params.y === 'number')
      value = `(${params.x}, ${params.y})`;

    return (
      <div className={inspectorTextStyles.root}>
        <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
          {label}
        </span>
        {value && (
          <span {...stylex.props(styles.chip)}>
            <MapPin size={12} {...stylex.props(styles.icon)} />
            {value}
          </span>
        )}
      </div>
    );
  },
);

MiniGameInspector.displayName = 'MiniGameInspector';
