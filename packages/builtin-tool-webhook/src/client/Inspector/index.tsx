'use client';

import type { BuiltinInspector, BuiltinInspectorProps } from '@lobechat/types';
import { cssVar, cx, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import {
  type CreateWebhookArgs,
  type DeleteWebhookState,
  type ListWebhookCallsState,
  type ListWebhooksState,
  WebhookApiName,
  type WebhookState,
} from '../../types';
import { getToolError } from '../toolError';

type InspectorState = Partial<
  DeleteWebhookState & ListWebhookCallsState & ListWebhooksState & WebhookState
>;

/**
 * The header line of every webhook call: what the agent is doing, the webhook it is about once
 * known (the name while a create streams in, the row's name once a result is back), then a count
 * or a failure mark. One component for all APIs: they share the same anatomy.
 */
const WebhookInspector = ({
  apiName,
  args,
  isArgumentsStreaming,
  isLoading,
  partialArgs,
  pluginState,
  result,
}: BuiltinInspectorProps<CreateWebhookArgs, InspectorState>) => {
  const { t } = useTranslation('plugin');
  const params = args ?? partialArgs ?? {};
  const pending = isArgumentsStreaming || isLoading;

  const title = t(`builtins.lobe-webhook.apiName.${apiName}` as any);
  const subject =
    pluginState?.webhook?.name?.trim() ||
    pluginState?.name?.trim() ||
    (apiName === WebhookApiName.createWebhook ? params.name?.trim() : undefined);

  const failed = !pending && !!getToolError(pluginState ?? result?.state, result?.error);
  const count = pending
    ? undefined
    : apiName === WebhookApiName.listWebhooks
      ? pluginState?.webhooks?.length
      : apiName === WebhookApiName.listWebhookCalls
        ? pluginState?.calls?.length
        : undefined;

  return (
    <div className={cx(inspectorTextStyles.root, pending && shinyTextStyles.shinyText)}>
      <span>{title}</span>
      {subject && <span className={highlightTextStyles.primary}>{subject}</span>}
      {typeof count === 'number' && !failed && (
        <Text
          code
          as={'span'}
          color={cssVar.colorTextSecondary}
          fontSize={12}
          style={{ marginInlineStart: 6 }}
        >
          {count}
        </Text>
      )}
      {failed && (
        <Text as={'span'} color={cssVar.colorError} fontSize={12} style={{ marginInlineStart: 6 }}>
          {t('builtins.lobe-webhook.inspector.failed')}
        </Text>
      )}
    </div>
  );
};

export const WebhookInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  Object.values(WebhookApiName).map((api) => [api, WebhookInspector as BuiltinInspector]),
);
