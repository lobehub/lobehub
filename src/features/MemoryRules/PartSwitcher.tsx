'use client';

import { Flexbox } from '@lobehub/ui';
import { Segmented, Select } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentSectionsByCount, liveCount, type OwnerSection } from './labels';
import OwnerLabel from './OwnerLabel';
import { styles } from './styles';

/** Past this many agents the picker gets a search box; below it, scanning the list is faster. */
const SEARCH_FROM = 8;

interface PartSwitcherProps {
  onChange: (key: string) => void;
  sections: OwnerSection[];
  value: string;
}

/**
 * Whose sheet is on screen, in two steps that both stay one line wide however many agents have
 * learned something: "My rules" or "Agents" first, then which agent. One segment per agent ran
 * off the page once there were more than a handful.
 *
 * Switching to "Agents" reopens the agent last looked at, or the one that learned the most.
 */
const PartSwitcher = ({ onChange, sections, value }: PartSwitcherProps) => {
  const { t } = useTranslation('memory');
  const mine = sections.find((section) => section.key === 'mine');
  const agents = agentSectionsByCount(sections);
  const [lastAgent, setLastAgent] = useState<string>();

  const onAgent = value !== 'mine';
  const agentTotal = agents.reduce((sum, section) => sum + liveCount(section), 0);

  const openAgent = (key: string) => {
    setLastAgent(key);
    onChange(key);
  };

  return (
    <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
      <Segmented
        value={onAgent ? 'agents' : 'mine'}
        options={[
          {
            label: <OwnerLabel count={mine ? liveCount(mine) : 0} owner={{ kind: 'mine' }} />,
            value: 'mine',
          },
          {
            label: (
              <Flexbox horizontal align={'center'} gap={6}>
                <span>{t('rules.owner.agents')}</span>
                <span className={styles.ownerCount}>{agentTotal}</span>
              </Flexbox>
            ),
            value: 'agents',
          },
        ]}
        onChange={(next) => {
          if (next === 'mine') return onChange('mine');
          const remembered = agents.find((section) => section.key === lastAgent);
          openAgent((remembered ?? agents[0]).key);
        }}
      />
      {onAgent && (
        <Select
          popupMatchSelectWidth={false}
          showSearch={agents.length >= SEARCH_FROM}
          style={{ minWidth: 200, width: 'auto' }}
          value={value}
          variant={'filled'}
          options={agents.map((section) => ({
            label: <OwnerLabel count={liveCount(section)} owner={section.owner} />,
            // What the search box matches against, since the label is not plain text.
            title:
              section.owner.kind === 'agent'
                ? section.owner.agent.title || t('rules.owner.untitledAgent')
                : undefined,
            value: section.key,
          }))}
          onChange={(next) => {
            if (typeof next === 'string') openAgent(next);
          }}
        />
      )}
    </Flexbox>
  );
};

export default PartSwitcher;
