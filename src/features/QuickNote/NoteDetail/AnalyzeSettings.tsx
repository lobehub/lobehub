'use client';

import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { Flexbox, Popover } from '@lobehub/ui';
import { ActionIcon, Button, Select, Switch, Text, toast } from '@lobehub/ui/base-ui';
import { Settings2Icon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useInitBuiltinAgent } from '@/hooks/useInitBuiltinAgent';
import { useClientDataSWR } from '@/libs/swr';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

const BUILTIN_ANALYZER_VALUE = '__quick-note-analyze__';

/** Compact Quick Note binding UI for Auto Analyze and its configured Agent. */
const AnalyzeSettings = memo(() => {
  const { t } = useTranslation('note');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const settings = useUserStore(settingsSelectors.currentQuickNoteSettings);
  const setSettings = useUserStore((state) => state.setSettings);
  const builtinAgentId = useAgentStore(
    builtinAgentSelectors.getBuiltinAgentId(BUILTIN_AGENT_SLUGS.quickNoteAnalyze),
  );
  const { data: agents = [] } = useClientDataSWR(open ? ['QUICK_NOTE_ANALYZER_AGENTS'] : null, () =>
    agentService.queryAgents({ limit: 100 }),
  );

  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.quickNoteAnalyze);

  const options = useMemo(
    () => [
      { label: t('analyzeSettings.builtinAgent'), value: BUILTIN_ANALYZER_VALUE },
      ...agents.map((agent) => ({
        label: agent.title?.trim() || agent.name?.trim() || agent.id,
        value: agent.id,
      })),
    ],
    [agents, t],
  );
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
        <Flexbox gap={14} padding={12} style={{ width: 300 }}>
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
              size={'small'}
              onChange={(enabled) =>
                void updateSettings({
                  ...settings,
                  autoAnalyze: { ...settings.autoAnalyze, enabled },
                })
              }
            />
          </Flexbox>
          <Flexbox gap={6}>
            <Text fontSize={13}>{t('analyzeSettings.agent')}</Text>
            <Select
              options={options}
              size={'small'}
              value={selectedValue}
              onChange={(value: string) =>
                void updateSettings({
                  ...settings,
                  analyzeAgentId: value === BUILTIN_ANALYZER_VALUE ? null : value,
                })
              }
            />
          </Flexbox>
          <Button
            disabled={!selectedAgentId}
            size={'small'}
            onClick={() => {
              if (!selectedAgentId) return;
              setOpen(false);
              navigate(`/agent/${selectedAgentId}/profile`);
            }}
          >
            {t('analyzeSettings.configureAgent')}
          </Button>
        </Flexbox>
      }
      onOpenChange={setOpen}
    >
      <ActionIcon
        aria-label={t('analyzeSettings.title')}
        icon={Settings2Icon}
        size={'small'}
        title={t('analyzeSettings.title')}
      />
    </Popover>
  );
});

AnalyzeSettings.displayName = 'QuickNoteAnalyzeSettings';

export default AnalyzeSettings;
