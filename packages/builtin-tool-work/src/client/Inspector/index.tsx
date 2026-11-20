'use client';

import type { BuiltinInspector, BuiltinInspectorProps } from '@lobechat/types';
import { cssVar, cx, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import {
  type CreateWorkArgs,
  type DeleteWorkState,
  WorkApiName,
  type WorkState,
  type WorkToolErrorState,
} from '../../types';

type InspectorState = Partial<DeleteWorkState & WorkState & WorkToolErrorState>;

/**
 * The header line of every Work call: the action, the Work's title once known
 * (from the arguments while they stream, from the result afterwards), then the
 * collection's image count or a failure mark. One component for all APIs.
 */
const WorkInspector = ({
  apiName,
  args,
  isArgumentsStreaming,
  isLoading,
  partialArgs,
  pluginState,
  result,
}: BuiltinInspectorProps<Partial<CreateWorkArgs>, InspectorState>) => {
  const { t } = useTranslation('plugin');
  const params = args ?? partialArgs ?? {};
  const pending = isArgumentsStreaming || isLoading;

  const subject =
    pluginState?.work?.title?.trim() ||
    pluginState?.deleted?.title?.trim() ||
    (apiName === WorkApiName.deleteWork ? undefined : params.title?.trim());

  const failed = !pending && (!!pluginState?.error || !!result?.error);
  const imageCount = pending ? undefined : pluginState?.work?.imageCount;

  return (
    <div className={cx(inspectorTextStyles.root, pending && shinyTextStyles.shinyText)}>
      <span>{t(`builtins.lobe-work.apiName.${apiName}` as any)}</span>
      {subject && <span className={highlightTextStyles.primary}>{subject}</span>}
      {typeof imageCount === 'number' && !failed && (
        <Text
          as={'span'}
          color={cssVar.colorTextSecondary}
          fontSize={12}
          style={{ marginInlineStart: 6 }}
        >
          {t('builtins.lobe-work.inspector.images', { count: imageCount })}
        </Text>
      )}
      {failed && (
        <Text as={'span'} color={cssVar.colorError} fontSize={12} style={{ marginInlineStart: 6 }}>
          {t('builtins.lobe-work.inspector.failed')}
        </Text>
      )}
    </div>
  );
};

export const WorkInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  Object.values(WorkApiName).map((api) => [api, WorkInspector as BuiltinInspector]),
);
