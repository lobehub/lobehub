// Fixture: a working-sidebar section toggles how its works are shown (summary / history).
// Reduced from Conversation/WorkingSidebar/WorksSection.
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { HistoryIcon, ListIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocalStorageState } from '@/hooks/useLocalStorageState';

import WorkHistoryList from './WorkHistoryList';
import WorkSummaryList from './WorkSummaryList';

type Mode = 'history' | 'summary';

const WorksSection = memo(() => {
  const { t } = useTranslation('chat');
  const [mode, setMode] = useLocalStorageState<Mode>('working-panel-works-mode', 'summary');

  return (
    <Flexbox gap={8} padding={8}>
      <Flexbox horizontal gap={4} style={{ alignSelf: 'flex-end' }}>
        <ActionIcon
          active={mode === 'summary'}
          icon={ListIcon}
          size={'small'}
          title={t('workingPanel.works.viewMode.summary')}
          onClick={() => setMode('summary')}
        />
        <ActionIcon
          active={mode === 'history'}
          icon={HistoryIcon}
          size={'small'}
          title={t('workingPanel.works.viewMode.history')}
          onClick={() => setMode('history')}
        />
      </Flexbox>
      {mode === 'summary' ? <WorkSummaryList /> : <WorkHistoryList />}
    </Flexbox>
  );
});

export default WorksSection;
