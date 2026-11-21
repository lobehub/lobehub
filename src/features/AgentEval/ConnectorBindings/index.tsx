'use client';

import type {
  AgentEvalDatasetPackageBindings,
  AgentEvalDatasetPackageConnectionRequirement,
} from '@lobechat/types';
import { Button, Flexbox, Select, Spin, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useEvalStore } from '@/store/eval';

import { setConnectorBinding } from './bindings';
import { openConnectionEditor } from './ConnectionEditor';

const styles = stylex.create({ groups: { maxHeight: 400, overflowY: 'auto' } });

interface ConnectorBindingsProps {
  datasetId?: string;
  disabled?: boolean;
  onChange: (bindings: AgentEvalDatasetPackageBindings) => void;
  requirements: AgentEvalDatasetPackageConnectionRequirement[];
  value: AgentEvalDatasetPackageBindings;
}

/** Only exact connection IDs cross this form. URL and credentials stay in the connection manager. */
export const ConnectorBindings = ({
  datasetId,
  disabled,
  onChange,
  requirements,
  value,
}: ConnectorBindingsProps) => {
  const { t } = useTranslation('eval');
  const id = useId();
  const fetchConnectors = useEvalStore((s) => s.useFetchEvalConnectors);
  const { data, error, isLoading, isValidating, mutate } = fetchConnectors(datasetId);
  const available = data?.filter(
    (connection) =>
      connection.isEnabled && connection.mcpConnectionType === 'http' && connection.mcpServerUrl,
  );

  if (!datasetId) return <Text type="secondary">{t('connections.datasetOnly')}</Text>;

  return (
    <Flexbox gap={12}>
      <Text fontSize={13} type="secondary">
        {t('connections.hint')}
      </Text>
      {!!error && (
        <AsyncError
          error={error}
          retrying={isValidating}
          variant="inline"
          onRetry={() => void mutate()}
        />
      )}
      {isLoading && !data ? (
        <Spin />
      ) : (
        <Flexbox className={stylex.props(styles.groups).className} gap={20}>
          {requirements.map((requirement, groupIndex) => {
            const bindings =
              value[requirement.scope === 'environment' ? 'environmentBindings' : 'caseBindings']?.[
                requirement.key
              ];
            return (
              <Flexbox gap={8} key={`${requirement.scope}:${requirement.key}`}>
                <Text weight={500}>
                  {requirement.name} ·{' '}
                  {t(
                    requirement.scope === 'environment'
                      ? 'connections.environment'
                      : 'connections.case',
                  )}
                </Text>
                {requirement.services.map((service, index) => {
                  const binding = bindings?.[service];
                  const provided = requirement.providedServices?.includes(service);
                  const missing =
                    !!binding &&
                    !available?.some((connection) => connection.id === binding.connectorId);
                  const fieldId = `${id}-${groupIndex}-${index}`;
                  return (
                    <Flexbox gap={6} key={service}>
                      <label htmlFor={fieldId}>{service}</label>
                      <Select
                        disabled={disabled || (!data && !!error)}
                        id={fieldId}
                        value={binding?.connectorId ?? ''}
                        options={[
                          {
                            label: t(
                              provided ? 'connections.fromPackage' : 'connections.configureLater',
                            ),
                            value: '',
                          },
                          ...(missing
                            ? [{ label: t('connections.unavailable'), value: binding.connectorId }]
                            : []),
                          ...(available ?? []).map((connection) => ({
                            label: connection.name,
                            value: connection.id,
                          })),
                        ]}
                        onChange={(connectorId) =>
                          onChange(
                            setConnectorBinding(
                              value,
                              requirement,
                              service,
                              connectorId
                                ? {
                                    connectorId: String(connectorId),
                                    transport: binding?.transport ?? 'mcp',
                                  }
                                : undefined,
                            ),
                          )
                        }
                      />
                      {binding && (
                        <Select
                          aria-label={t('connections.transport', { service })}
                          disabled={disabled}
                          value={binding.transport ?? 'mcp'}
                          options={[
                            { label: t('connections.standard'), value: 'mcp' },
                            { label: t('connections.adapter'), value: 'lobe-bench' },
                          ]}
                          onChange={(transport) =>
                            onChange(
                              setConnectorBinding(value, requirement, service, {
                                ...binding,
                                transport: transport as 'mcp' | 'lobe-bench',
                              }),
                            )
                          }
                        />
                      )}
                    </Flexbox>
                  );
                })}
              </Flexbox>
            );
          })}
        </Flexbox>
      )}
      {!isLoading && available?.length === 0 && (
        <Text type="secondary">{t('connections.empty')}</Text>
      )}
      <Flexbox horizontal gap={8} wrap="wrap">
        <Button
          disabled={disabled}
          onClick={() =>
            openConnectionEditor({ datasetId, onSaved: mutate, title: t('connections.create') })
          }
        >
          {t('connections.create')}
        </Button>
        <Button disabled={disabled} loading={isValidating} onClick={() => void mutate()}>
          {t('connections.refresh')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};
