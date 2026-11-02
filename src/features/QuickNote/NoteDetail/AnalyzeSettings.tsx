'use client';

import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import {
  ActionIcon,
  Button,
  Flexbox,
  InputNumber,
  Popover,
  Select,
  Switch,
  Text,
  toast,
} from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { Settings2Icon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useInitBuiltinAgent } from '@/hooks/useInitBuiltinAgent';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { buildAnalyzerAgentOptions, BUILTIN_ANALYZER_VALUE } from './analyzerAgentOptions';

/** Quiet-period choices in seconds; the server clamps stored values to 1–300 s. */
const IDLE_DELAY_SECONDS = [3, 6, 10, 30, 60, 120];
/** Server-side bounds for `maxAnalyzeSteps`. */
const MAX_STEPS_RANGE = { max: 20, min: 1 };

/** Compact Quick Note binding UI for Auto Analyze and its configured Agent. */
const AnalyzeSettings = memo(() => {
  const { t } = useTranslation('note');
  const navigate = useWorkspaceAwareNavigate();
  const [open, setOpen] = useState(false);
  const settings = useUserStore(settingsSelectors.currentQuickNoteSettings);
  const setSettings = useUserStore((state) => state.setSettings);
  const builtinAgentId = useAgentStore(
    builtinAgentSelectors.getBuiltinAgentId(BUILTIN_AGENT_SLUGS.quickNoteAnalyze),
  );
  // The same sidebar agent list every other agent picker reads.
  const agents = useHomeStore(homeAgentListSelectors.allAgents, isEqual);

  useFetchAgentList();
  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.quickNoteAnalyze);

  const options = useMemo(
    () => buildAnalyzerAgentOptions(agents, t('analyzeSettings.builtinAgent')),
    [agents, t],
  );
  const idleDelaySeconds = Math.round(settings.autoAnalyze.idleDelayMs / 1000);
  const idleDelayOptions = [...new Set([...IDLE_DELAY_SECONDS, idleDelaySeconds])]
    .sort((a, b) => a - b)
    .map((seconds) => ({
      label: t('analyzeSettings.seconds', { count: seconds }),
      value: seconds,
    }));
  const selectedValue = settings.analyzeAgentId ?? BUILTIN_ANALYZER_VALUE;
  const selectedAgentId = settings.analyzeAgentId ?? builtinAgentId;

  const updateSettings = async (quickNote: typeof settings) => {
    try {
      await setSettings({ quickNote });
    } catch {
      toast.error(t('agentic.actionFailed'));
    }
  };

  return (
    <Popover
      arrow={false}
      open={open}
      placement={'bottomRight'}
      trigger={['click']}
      content={
        <Flexbox gap={16} width={300}>
          <Text weight={500}>{t('analyzeSettings.title')}</Text>
          <Flexbox horizontal align={'center'} justify={'space-between'}>
            <Flexbox gap={2}>
              <Text fontSize={13}>{t('analyzeSettings.autoAnalyze')}</Text>
              <Text color={'secondary'} fontSize={12}>
                {t('analyzeSettings.autoAnalyzeDesc')}
              </Text>
            </Flexbox>
            <Switch
              checked={settings.autoAnalyze.enabled}
              onChange={(enabled) =>
                void updateSettings({
                  ...settings,
                  autoAnalyze: { ...settings.autoAnalyze, enabled },
                })
              }
            />
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
            <Text fontSize={13}>{t('analyzeSettings.idleDelay')}</Text>
            <Select
              disabled={!settings.autoAnalyze.enabled}
              options={idleDelayOptions}
              style={{ width: 96 }}
              value={idleDelaySeconds}
              onChange={(seconds: number) =>
                void updateSettings({
                  ...settings,
                  autoAnalyze: { ...settings.autoAnalyze, idleDelayMs: seconds * 1000 },
                })
              }
            />
          </Flexbox>
          <Flexbox gap={6}>
            <Flexbox gap={2}>
              <Text fontSize={13}>{t('analyzeSettings.agent')}</Text>
              <Text color={'secondary'} fontSize={12}>
                {t('analyzeSettings.agentDesc')}
              </Text>
            </Flexbox>
            <Select
              options={options}
              value={selectedValue}
              onChange={(value: string) =>
                void updateSettings({
                  ...settings,
                  analyzeAgentId: value === BUILTIN_ANALYZER_VALUE ? null : value,
                })
              }
            />
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
            <Flexbox gap={2}>
              <Text fontSize={13}>{t('analyzeSettings.maxSteps')}</Text>
              <Text color={'secondary'} fontSize={12}>
                {t('analyzeSettings.maxStepsDesc')}
              </Text>
            </Flexbox>
            <InputNumber
              max={MAX_STEPS_RANGE.max}
              min={MAX_STEPS_RANGE.min}
              precision={0}
              style={{ flex: 'none', width: 72 }}
              value={settings.maxAnalyzeSteps}
              onChange={(value) => {
                if (typeof value !== 'number') return;
                void updateSettings({ ...settings, maxAnalyzeSteps: value });
              }}
            />
          </Flexbox>
          <Button
            disabled={!selectedAgentId}
            onClick={() => {
              if (!selectedAgentId) return;
              setOpen(false);
              navigate(`/agent/${selectedAgentId}/profile`);
            }}
          >
            {t('analyzeSettings.configureAgent')}
          </Button>
          <Text color={'secondary'} fontSize={12}>
            {t('analyzeSettings.decisionModel')}{' '}
            <a
              href={'/settings/service-model'}
              onClick={(event) => {
                event.preventDefault();
                setOpen(false);
                navigate('/settings/service-model');
              }}
            >
              {t('analyzeSettings.decisionModelLink')}
            </a>
          </Text>
        </Flexbox>
      }
      onOpenChange={setOpen}
    >
      <ActionIcon
        aria-label={t('analyzeSettings.title')}
        icon={Settings2Icon}
        title={t('analyzeSettings.title')}
      />
    </Popover>
  );
});

AnalyzeSettings.displayName = 'QuickNoteAnalyzeSettings';

export default AnalyzeSettings;
