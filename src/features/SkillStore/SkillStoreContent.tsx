'use client';

import { Flexbox, Segmented } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';

import Search from './Search';
import AddSkillButton from './SkillList/AddSkillButton';
import LobeHubList from './SkillList/LobeHub';
import MarketSkillList from './SkillList/MarketSkills';
import MCPList from './SkillList/MCP';

export enum SkillStoreTab {
  LobeHub = 'lobehub',
  MCP = 'mcp',
  Skills = 'skills',
}

export const SkillStoreContent = () => {
  const { t } = useTranslation('setting');
  const [activeTab, setActiveTab] = useState<SkillStoreTab>(SkillStoreTab.LobeHub);
  const [lobehubKeywords, setLobehubKeywords] = useState('');
  const [skillKeywords, setSkillKeywords] = useState('');
  // A tab's list mounts (and fetches) on first open, then stays to keep its scroll and pages.
  const [visited, setVisited] = useState<Set<SkillStoreTab>>(() => new Set([activeTab]));
  if (!visited.has(activeTab)) setVisited(new Set(visited).add(activeTab));

  // Refresh builtin-tool install state for the active workspace whenever the
  // modal mounts, so entries opened from contexts that don't host the chat
  // input (e.g. Home banner) don't read leftover personal-scope state.
  const useFetchUninstalledBuiltinTools = useToolStore((s) => s.useFetchUninstalledBuiltinTools);
  useFetchUninstalledBuiltinTools(true);

  const options = [
    { label: t('skillStore.tabs.lobehub'), value: SkillStoreTab.LobeHub },
    { label: t('skillStore.tabs.skills'), value: SkillStoreTab.Skills },
    { label: t('skillStore.tabs.mcp'), value: SkillStoreTab.MCP },
  ];

  const isLobeHub = activeTab === SkillStoreTab.LobeHub;
  const isSkills = activeTab === SkillStoreTab.Skills;
  const isMCP = activeTab === SkillStoreTab.MCP;

  return (
    <Flexbox gap={8} style={{ maxHeight: '75vh' }} width={'100%'}>
      {/* Source chips, then search and Add on one row, like the connectors page header. */}
      <Flexbox gap={12}>
        <Segmented<SkillStoreTab>
          aria-label={t('connectorMarket.source')}
          options={options}
          style={{ alignSelf: 'flex-start' }}
          value={activeTab}
          onChange={setActiveTab}
        />
        <Flexbox horizontal align={'center'} gap={8}>
          <Flexbox flex={1}>
            <Search
              activeTab={activeTab}
              onLobeHubSearch={setLobehubKeywords}
              onSkillSearch={setSkillKeywords}
            />
          </Flexbox>
          <AddSkillButton />
        </Flexbox>
      </Flexbox>
      <Flexbox height={496} style={{ marginBlockEnd: -12, marginInline: -16 }}>
        <Flexbox flex={1} style={{ display: isLobeHub ? 'flex' : 'none', overflow: 'auto' }}>
          {visited.has(SkillStoreTab.LobeHub) && <LobeHubList keywords={lobehubKeywords} />}
        </Flexbox>
        <Flexbox flex={1} style={{ display: isSkills ? 'flex' : 'none', overflow: 'auto' }}>
          {visited.has(SkillStoreTab.Skills) && <MarketSkillList keywords={skillKeywords} />}
        </Flexbox>
        <Flexbox flex={1} style={{ display: isMCP ? 'flex' : 'none', overflow: 'auto' }}>
          {visited.has(SkillStoreTab.MCP) && <MCPList />}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};
