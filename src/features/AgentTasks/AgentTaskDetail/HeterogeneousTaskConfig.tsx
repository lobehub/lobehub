import type { HeterogeneousRuntimeConfigField } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Button, Popover, Tag, Text } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

/** The assignee and resource-scoped pin whose effective configuration is being inspected. */
interface HeterogeneousTaskConfigProps {
  /** Effective values and their individual configuration sources. */
  fields: HeterogeneousRuntimeConfigField[];
  /** Whether this is the next Task run or an existing Topic. */
  source: 'task' | 'topic' | 'run';
}

/**
 * Displays inspectable external runtime settings and their per-field sources.
 *
 * Use when:
 * - A Task assignee executes through an external runtime.
 * - A Task Topic has its own pinned configuration.
 *
 * Expects:
 * - The owner-scoped provider and pin, never the surrounding chat's active Agent.
 *
 * Returns:
 * - A keyboard-accessible inspector, also available to read-only viewers.
 */
export const HeterogeneousTaskConfig = ({ fields, source }: HeterogeneousTaskConfigProps) => {
  const { t } = useTranslation('chat');
  const selection = fields.find((field) => field.key === 'model' || field.key === 'mode')?.value;
  const valueLabel = (value: string) =>
    value === 'default' ? t('taskDetail.runtimeConfig.cliDefault') : value;

  return (
    <Popover
      placement={'bottomLeft'}
      styles={{ content: { maxWidth: 'calc(100vw - 32px)', padding: 16, width: 380 } }}
      trigger={'click'}
      content={
        <Flexbox gap={12}>
          <Text weight={500}>{t('taskDetail.runtimeConfig.title')}</Text>
          <Text fontSize={12} type={'secondary'}>
            {t(`taskDetail.runtimeConfig.${source}Scope`)}
          </Text>
          {fields.map((field) => (
            <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} key={field.key}>
              <Text fontSize={12} style={{ width: 64 }}>
                {t(`taskDetail.runtimeConfig.field.${field.key}`)}
              </Text>
              <Text fontSize={12} style={{ flex: 1, overflowWrap: 'anywhere' }}>
                {field.key === 'speed' && field.value === 'default' && field.source !== 'runtime'
                  ? t('heteroAgent.modelSelector.speed.standard')
                  : valueLabel(field.value)}
              </Text>
              <Tag>{t(`taskDetail.runtimeConfig.source.${field.source}`)}</Tag>
            </Flexbox>
          ))}
          <Text fontSize={12} type={'secondary'}>
            {t('taskDetail.runtimeConfig.defaultsNote')}
          </Text>
        </Flexbox>
      }
    >
      <Button aria-label={t('taskDetail.runtimeConfig.title')} size={'small'} type={'text'}>
        {fields.find((field) => field.key === 'runtime')?.value}
        {selection && ` · ${valueLabel(selection)}`}
      </Button>
    </Popover>
  );
};
