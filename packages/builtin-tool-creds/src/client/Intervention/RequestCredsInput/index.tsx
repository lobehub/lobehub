'use client';

import { SecretInputView } from '@lobechat/shared-tool-ui/secret-input';
import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { usePermission } from '@/hooks/usePermission';
import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';

import type { RequestCredsInputParams } from '../../../types';
import {
  canSaveCredsInput,
  type CredsWriteClient,
  findWritableCred,
  saveCredsInput,
} from './saveCredsInput';

/**
 * Same scope the server runtime uses (`credsAccessor`): inside a workspace the
 * agent's credentials are the workspace organization's, otherwise the user's.
 * `workspaceCreds` mirrors `market.creds` but is registered in the cloud
 * namespace, so it is cast at the boundary like the workspace settings page.
 */
const useScopedCredsClient = () => {
  const workspaceId = useActiveWorkspaceId();
  return useMemo(
    () => ({
      client: (workspaceId
        ? lambdaClient.workspaceCreds
        : lambdaClient.market.creds) as unknown as CredsWriteClient,
      isWorkspace: !!workspaceId,
    }),
    [workspaceId],
  );
};

/**
 * Secure form for `lobe-creds/requestCredsInput`.
 *
 * The plaintext goes from the form straight to the credential store. Only then
 * does the card approve the tool call, with no payload: the host maps submit
 * to the ordinary approve action, and the tool itself just confirms the key
 * exists. Skipping rejects the call so the agent can continue without it.
 */
const RequestCredsInputIntervention = memo<BuiltinInterventionProps<RequestCredsInputParams>>(
  ({ actionsPortalTarget, args, disabled, interactionMode, onInteractionAction }) => {
    const { t } = useTranslation('tool');
    const { client, isWorkspace } = useScopedCredsClient();
    const { allowed: canManageWorkspaceCreds } = usePermission('manage_provider_key');
    const canSave = canSaveCredsInput({ canManageWorkspaceCreds, isWorkspace });
    const [error, setError] = useState<string>();

    const fieldNames = useMemo(
      () => (Array.isArray(args?.fieldNames) ? args.fieldNames.filter(Boolean) : []),
      [args?.fieldNames],
    );
    const name = args?.name || args?.key;
    const isInteractive = interactionMode === 'custom';

    // Only metadata (id / key / owner) — list responses never carry values.
    const { data: existing } = useClientDataSWR(
      isInteractive && canSave && args?.key
        ? ['requestCredsInput:existing', args.key, isWorkspace]
        : null,
      () => findWritableCred(client, args.key, isWorkspace),
    );

    const handleSubmit = useCallback(
      async (values: Record<string, string>) => {
        setError(undefined);
        try {
          await saveCredsInput(client, args, isWorkspace, values);
        } catch (saveError) {
          // Error messages from the creds router are generic; never echo values here.
          setError(t('credsInput.saveFailed'));
          throw saveError;
        }

        await onInteractionAction?.({ payload: {}, type: 'submit' });
      },
      [args, client, isWorkspace, onInteractionAction, t],
    );

    const handleCancel = useCallback(() => {
      void onInteractionAction?.({
        reason: canSave
          ? 'The user chose not to enter this credential.'
          : 'The user cannot save workspace credentials: only workspace admins can. A workspace admin needs to add this credential in the workspace settings.',
        type: 'skip',
      });
    }, [canSave, onInteractionAction]);

    const header = (
      <Flexbox gap={4}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Text strong>{name}</Text>
          <Tag>{args?.key}</Tag>
        </Flexbox>
        {args?.description && <Text type={'secondary'}>{args.description}</Text>}
      </Flexbox>
    );

    if (!isInteractive) {
      return (
        <Flexbox gap={8}>
          {header}
          <Text fontSize={12} type={'secondary'}>
            {fieldNames.join(', ')}
          </Text>
        </Flexbox>
      );
    }

    return (
      <SecretInputView
        actionsPortalTarget={actionsPortalTarget}
        blockedReason={canSave ? undefined : t('credsInput.notice.noPermission')}
        disabled={disabled}
        error={error}
        fields={fieldNames}
        labels={{
          cancel: t('credsInput.skip'),
          placeholder: (field) => t('credsInput.placeholder', { field }),
          submit: t(existing ? 'credsInput.update' : 'credsInput.submit'),
          submitting: t('credsInput.submitting'),
        }}
        notice={
          <Flexbox gap={8}>
            {header}
            <Text fontSize={12} type={'secondary'}>
              {t(isWorkspace ? 'credsInput.notice.workspace' : 'credsInput.notice.personal')}
            </Text>
            {existing && (
              <Text fontSize={12} type={'warning'}>
                {t('credsInput.notice.overwrite', { key: args.key })}
              </Text>
            )}
          </Flexbox>
        }
        onCancel={handleCancel}
        onSubmit={handleSubmit}
      />
    );
  },
);

RequestCredsInputIntervention.displayName = 'RequestCredsInputIntervention';

export default RequestCredsInputIntervention;
