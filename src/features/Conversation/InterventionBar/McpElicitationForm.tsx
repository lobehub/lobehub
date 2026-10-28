import { isDesktop } from '@lobechat/const';
import {
  getMcpFormDefaults,
  getMcpFormOptions,
  validateMcpElicitationResponse,
} from '@lobechat/mcp-elicitation/form';
import { MCP_CONTINUATION_CONTROL } from '@lobechat/mcp-elicitation/types';
import { Alert, Button, Flexbox, Input, InputNumber, Select, Switch, Text } from '@lobehub/ui';
import type { ElicitRequestParams, ElicitResult } from '@modelcontextprotocol/client';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { mutate } from '@/libs/swr';
import { mcpElicitationKeys } from '@/libs/swr/keys';
import { electronSystemService } from '@/services/electron/system';
import { mcpElicitationService, type PendingMcpElicitation } from '@/services/mcpElicitation';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useConversationResourceAccess } from '../hooks/useConversationResourceAccess';
import { useFetchMcpElicitations } from '../hooks/useFetchMcpElicitations';
import { useConversationStore } from '../store';

export function McpElicitationForm({ pending }: { pending: PendingMcpElicitation }) {
  return <McpElicitationBatch key={pending.batchId} pending={pending} />;
}
function McpElicitationBatch({ pending }: { pending: PendingMcpElicitation }) {
  const { t } = useTranslation('plugin');
  const userId = useUserStore(userProfileSelectors.userId);
  const context = useConversationStore((s) => s.context);
  const refreshMessages = useChatStore((s) => s.refreshMessages);
  const { canUseResource } = useConversationResourceAccess();
  const [responses, setResponses] = useState<Record<string, ElicitResult>>({});
  const [requestIndex, setRequestIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [resolutionRequestId] = useState(() => crypto.randomUUID());
  const requests = Object.entries(pending.requests);
  const current = requests[requestIndex];

  const resolve = async (response?: ElicitResult) => {
    if (busy || pending.resolving || !canUseResource) return;
    let collected =
      current && response
        ? { ...responses, [current[0]]: response }
        : { ...responses, [MCP_CONTINUATION_CONTROL]: response ?? { action: 'accept' as const } };
    if (response?.action === 'cancel')
      for (const [id] of requests)
        if (!Object.hasOwn(collected, id)) collected = { ...collected, [id]: { action: 'cancel' } };
    if (response?.action !== 'cancel' && requestIndex + 1 < requests.length) {
      setResponses(collected);
      setRequestIndex(requestIndex + 1);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await mcpElicitationService.resolve(pending.id, resolutionRequestId, collected);
      await Promise.all([
        mutate(mcpElicitationKeys.pending(userId!, context.topicId!, context.threadId)),
        refreshMessages(context),
      ]);
    } catch (cause) {
      console.error('MCP input submission failed', cause);
      setError(t('mcpElicitation.submitError'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Flexbox gap={16} padding={16}>
      <Flexbox gap={4}>
        <Text weight={600}>
          {t('mcpElicitation.title', { server: pending.serverName ?? pending.identifier })}
        </Text>
        <Text type="secondary">
          {pending.identifier} · {pending.apiName}
        </Text>
        {requests.length > 1 && (
          <Text type="secondary">
            {t('mcpElicitation.progress', { current: requestIndex + 1, total: requests.length })}
          </Text>
        )}
        <Text type="secondary">
          {t('mcpElicitation.deadline', { time: new Date(pending.deadline).toLocaleTimeString() })}
        </Text>
      </Flexbox>
      {error && <Alert showIcon title={error} type="error" />}
      {pending.resolving && <Text>{t('mcpElicitation.resolving')}</Text>}
      {current ? (
        <McpRequestForm
          disabled={busy || pending.resolving || !canUseResource}
          key={`${pending.batchId}:${current[0]}`}
          nextRequest={requestIndex + 1 < requests.length}
          request={current[1]}
          onResponse={resolve}
        />
      ) : (
        <Flexbox gap={12}>
          <Text>{t('mcpElicitation.waiting')}</Text>
          <Button
            disabled={busy || pending.resolving || !canUseResource}
            loading={busy}
            type="primary"
            onClick={() => resolve()}
          >
            {t('mcpElicitation.retry')}
          </Button>
          <Button
            disabled={busy || pending.resolving || !canUseResource}
            onClick={() => resolve({ action: 'cancel' })}
          >
            {t('mcpElicitation.cancel')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
}

function McpRequestForm({
  request,
  onResponse,
  disabled,
  nextRequest,
}: {
  disabled: boolean;
  nextRequest?: boolean;
  onResponse: (response: ElicitResult) => Promise<void>;
  request: ElicitRequestParams;
}) {
  const { t } = useTranslation('plugin');
  const fieldPrefixId = useId();
  const [values, setValues] = useState(() => getMcpFormDefaults(request));
  const [error, setError] = useState<string>();
  const [opened, setOpened] = useState(false);
  const url = request.mode === 'url' ? new URL(request.url) : undefined;
  const accept = async () => {
    const response: ElicitResult =
      request.mode === 'url' ? { action: 'accept' } : { action: 'accept', content: values };
    const errors = validateMcpElicitationResponse(request, response);
    if (errors.length) {
      setError(t('mcpElicitation.invalidInput', { detail: errors.join('; ') }));
      return;
    }
    await onResponse(response);
  };
  const open = async () => {
    if (!url || disabled) return;
    try {
      if (isDesktop) await electronSystemService.openExternalLink(url.href);
      else {
        const external = window.open(url.href, '_blank', 'noopener,noreferrer');
        // noopener deliberately returns null in some browsers; completion is
        // confirmed by the user and MCP server, never inferred from this handle.
        external?.blur();
      }
      setOpened(true);
    } catch (cause) {
      console.error('MCP external page could not be opened', cause);
      setError(t('mcpElicitation.openError'));
    }
  };
  return (
    <Flexbox gap={16}>
      {request.mode !== 'url' && <Text type="secondary">{t('mcpElicitation.formPrivacy')}</Text>}
      <Text style={{ whiteSpace: 'pre-wrap' }}>{request.message}</Text>
      {request.mode === 'url' && url ? (
        <Flexbox gap={8}>
          <Text weight={600}>{url.hostname}</Text>
          <Text style={{ overflowWrap: 'anywhere' }}>{url.href}</Text>
          <Text type="secondary">{t('mcpElicitation.externalPrivacy')}</Text>
          <Button disabled={disabled} onClick={open}>
            {t('mcpElicitation.open')}
          </Button>
          {opened && <Text>{t('mcpElicitation.return')}</Text>}
        </Flexbox>
      ) : (
        request.mode !== 'url' &&
        Object.entries(request.requestedSchema.properties).map(([name, field]) => {
          const options = getMcpFormOptions(field);
          const fieldValue = Object.hasOwn(values, name) ? values[name] : undefined;
          const update = (value: string | number | boolean | string[] | null | undefined) =>
            setValues((previous) => {
              if (value !== null && value !== undefined) return { ...previous, [name]: value };
              return Object.fromEntries(Object.entries(previous).filter(([key]) => key !== name));
            });
          const label = `${field.title ?? name}${request.requestedSchema.required?.includes(name) ? ' *' : ''}`;
          return (
            <Flexbox gap={6} key={name}>
              <Flexbox horizontal align="center" justify="space-between">
                <label htmlFor={`${fieldPrefixId}-${name}`}>{label}</label>
                {!request.requestedSchema.required?.includes(name) &&
                  Object.hasOwn(values, name) && (
                    <Button disabled={disabled} size="small" onClick={() => update(undefined)}>
                      {t('mcpElicitation.omit', { field: field.title ?? name })}
                    </Button>
                  )}
              </Flexbox>
              {field.description && <Text type="secondary">{field.description}</Text>}
              {options ? (
                <Select
                  aria-label={label}
                  disabled={disabled}
                  id={`${fieldPrefixId}-${name}`}
                  mode={field.type === 'array' ? 'multiple' : undefined}
                  options={options}
                  value={fieldValue as string | string[]}
                  onChange={update}
                />
              ) : field.type === 'boolean' ? (
                <Switch
                  aria-label={label}
                  checked={fieldValue === true}
                  disabled={disabled}
                  id={`${fieldPrefixId}-${name}`}
                  onChange={update}
                />
              ) : field.type === 'number' || field.type === 'integer' ? (
                <InputNumber
                  aria-label={label}
                  disabled={disabled}
                  id={`${fieldPrefixId}-${name}`}
                  max={field.maximum}
                  min={field.minimum}
                  step={field.type === 'integer' ? 1 : undefined}
                  value={fieldValue as number | undefined}
                  onChange={update}
                />
              ) : (
                <Input
                  autoComplete="off"
                  disabled={disabled}
                  id={`${fieldPrefixId}-${name}`}
                  value={(fieldValue as string) ?? ''}
                  onChange={(event) => update(event.target.value)}
                />
              )}
            </Flexbox>
          );
        })
      )}
      {error && <Alert showIcon title={error} type="error" />}
      <Flexbox horizontal gap={8} wrap="wrap">
        <Button
          disabled={disabled || (request.mode === 'url' && !opened)}
          type="primary"
          onClick={accept}
        >
          {t(
            nextRequest
              ? 'mcpElicitation.next'
              : request.mode === 'url'
                ? 'mcpElicitation.continue'
                : 'mcpElicitation.accept',
          )}
        </Button>
        <Button disabled={disabled} onClick={() => onResponse({ action: 'decline' })}>
          {t('mcpElicitation.decline')}
        </Button>
        <Button disabled={disabled} onClick={() => onResponse({ action: 'cancel' })}>
          {t('mcpElicitation.cancel')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
}

export function McpElicitationConnectionError() {
  const { t } = useTranslation('plugin');
  const { error } = useFetchMcpElicitations();
  return error ? <Alert showIcon title={t('mcpElicitation.readError')} type="error" /> : null;
}
