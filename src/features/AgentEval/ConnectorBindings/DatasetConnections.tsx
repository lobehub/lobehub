'use client';

import type {
  AgentEvalDatasetConnectorRequirement,
  AgentEvalDatasetPackageBindings,
} from '@lobechat/types';
import { Block, Button, Flexbox, Modal, Spin, Text, toast } from '@lobehub/ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { agentEvalService } from '@/services/agentEval';
import { useEvalStore } from '@/store/eval';

import { hasPartialConnectorBindings } from './bindings';
import { openConnectionEditor } from './ConnectionEditor';
import { ConnectorBindings } from './index';

const DatasetConnectionsEditor = ({
  datasetId,
  onClose,
  onSaved,
  requirements,
}: {
  datasetId: string;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
  requirements: AgentEvalDatasetConnectorRequirement[];
}) => {
  const { t } = useTranslation('eval');
  const [value, setValue] = useState<AgentEvalDatasetPackageBindings>(() => ({
    caseBindings: Object.fromEntries(
      requirements.filter((r) => r.scope === 'case').map((r) => [r.key, r.bindings]),
    ),
    environmentBindings: Object.fromEntries(
      requirements.filter((r) => r.scope === 'environment').map((r) => [r.key, r.bindings]),
    ),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const changes: AgentEvalDatasetPackageBindings = {};
  for (const requirement of requirements) {
    const scope = requirement.scope === 'environment' ? 'environmentBindings' : 'caseBindings';
    const next = value[scope]?.[requirement.key] ?? {};
    if (JSON.stringify(next) !== JSON.stringify(requirement.bindings)) {
      changes[scope] = { ...changes[scope], [requirement.key]: next };
    }
  }
  const partial = hasPartialConnectorBindings(requirements, changes);
  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await agentEvalService.updateDatasetConnectorBindings({ datasetId, ...changes });
      await onSaved();
      toast.success(t('connections.saved'));
      onClose();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      closable={!saving}
      keyboard={!saving}
      maskClosable={false}
      title={t('connections.title')}
      width={640}
      footer={
        <Flexbox horizontal gap={8} justify="flex-end">
          <Button disabled={saving} onClick={onClose}>
            {t('connections.cancel')}
          </Button>
          <Button disabled={partial} loading={saving} type="primary" onClick={() => void save()}>
            {t('connections.save')}
          </Button>
        </Flexbox>
      }
      onCancel={onClose}
    >
      <Flexbox gap={12}>
        <Text type="secondary">{t('connections.editHint')}</Text>
        {!!error && <AsyncError error={error} variant="inline" />}
        {partial && <Text type="danger">{t('connections.completeScope')}</Text>}
        <ConnectorBindings
          datasetId={datasetId}
          disabled={saving}
          requirements={requirements}
          value={value}
          onChange={setValue}
        />
      </Flexbox>
    </Modal>
  );
};

export const DatasetConnections = ({
  datasetId,
  editable,
}: {
  datasetId: string;
  editable: boolean;
}) => {
  const { t } = useTranslation('eval');
  const detailsId = useId();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [fetchBindings, fetchConnectors] = useEvalStore((s) => [
    s.useFetchDatasetConnectorBindings,
    s.useFetchEvalConnectors,
  ]);
  const { data, error, isLoading, mutate } = fetchBindings(datasetId);
  const {
    data: connectors,
    error: connectorError,
    mutate: refreshConnectors,
  } = fetchConnectors(datasetId);
  if (isLoading) return <Spin />;
  if (error) return <AsyncError error={error} variant="inline" onRetry={() => void mutate()} />;
  if (!data) return null;
  // An older server may omit the field; treat it as a Dataset with no connector needs.
  const requirements = data.requirements ?? [];
  const missing =
    connectors &&
    requirements.reduce(
      (count, requirement) =>
        count +
        requirement.services.filter(
          (service) =>
            !connectors.some(
              (connection) =>
                connection.id === requirement.bindings[service]?.connectorId &&
                connection.isEnabled &&
                connection.mcpConnectionType === 'http' &&
                connection.mcpServerUrl,
            ),
        ).length,
      0,
    );
  return (
    <Block padding={16} variant="outlined">
      <Flexbox gap={8}>
        <Flexbox horizontal align="center" gap={12} justify="space-between" wrap="wrap">
          <Flexbox gap={4}>
            <Text weight={600}>{t('connections.title')}</Text>
            <Text type="secondary">
              {missing === undefined
                ? t('connections.checking')
                : missing
                  ? t('connections.missing', { count: missing })
                  : t('connections.configured')}
            </Text>
          </Flexbox>
          <Button
            aria-controls={detailsId}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {t(expanded ? 'connections.hideDetails' : 'connections.showDetails')}
          </Button>
        </Flexbox>
        {!!connectorError && (
          <AsyncError
            error={connectorError}
            variant="inline"
            onRetry={() => void refreshConnectors()}
          />
        )}
        {expanded && (
          <Flexbox gap={12} id={detailsId}>
            {editable && (
              <Flexbox horizontal justify="flex-end">
                <Button onClick={() => setEditing(true)}>{t('connections.manage')}</Button>
              </Flexbox>
            )}
            {connectors?.length === 0 && <Text type="secondary">{t('connections.empty')}</Text>}
            <Flexbox gap={16} style={{ maxHeight: 400, overflowY: 'auto' }}>
              {(connectors ?? []).map((connection) => {
                const usages = requirements.filter((requirement) =>
                  Object.values(requirement.bindings).some(
                    (binding) => binding.connectorId === connection.id,
                  ),
                );
                return (
                  <Flexbox
                    horizontal
                    align="center"
                    gap={12}
                    justify="space-between"
                    key={connection.id}
                    wrap="wrap"
                  >
                    <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                      <Text>{connection.name}</Text>
                      {!connection.isEnabled && (
                        <Text type="secondary">{t('connections.disabled')}</Text>
                      )}
                      <Text fontSize={13} type="secondary">
                        {connection.mcpServerUrl ?? '--'}
                      </Text>
                      <Text fontSize={13} type="secondary">
                        {t(
                          connection.hasCredentials
                            ? 'connections.authSaved'
                            : 'connections.authNone',
                        )}
                        {' · '}
                        {t(
                          connection.status === 'connected'
                            ? 'connections.statusConnected'
                            : connection.status === 'error'
                              ? 'connections.statusError'
                              : 'connections.statusDisconnected',
                        )}
                      </Text>
                      <Text fontSize={13} type="secondary">
                        {usages.length
                          ? usages.map((item) => item.name).join(' · ')
                          : t('connections.unbound')}
                      </Text>
                    </Flexbox>
                    {editable && (
                      <Button
                        onClick={() =>
                          openConnectionEditor({
                            datasetId,
                            id: connection.id,
                            onSaved: async () => {
                              await Promise.all([mutate(), refreshConnectors()]);
                            },
                            title: connection.name,
                          })
                        }
                      >
                        {t('connections.edit')}
                      </Button>
                    )}
                  </Flexbox>
                );
              })}
            </Flexbox>
            {editable && (
              <Button
                onClick={() =>
                  openConnectionEditor({
                    datasetId,
                    onSaved: refreshConnectors,
                    title: t('connections.create'),
                  })
                }
              >
                {t('connections.create')}
              </Button>
            )}
            <Text fontSize={13} type="secondary">
              {t('connections.datasetHint')}
            </Text>
          </Flexbox>
        )}
        {editing && (
          <DatasetConnectionsEditor
            datasetId={datasetId}
            requirements={requirements}
            onClose={() => setEditing(false)}
            onSaved={async () => {
              await Promise.all([mutate(), refreshConnectors()]);
            }}
          />
        )}
      </Flexbox>
    </Block>
  );
};
