'use client';

import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { ChevronLeftIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
  AcceptanceViewer,
  OriginConversationProvider,
  useAcceptanceRouteBase,
} from '@/features/Acceptance';
import TopicPanel from '@/features/Acceptance/Viewer/Conversation/TopicPanel';
import NavHeader from '@/features/NavHeader';

/** `project/:projectId/acceptance/:acceptanceId` — one acceptance, back to the project's list. */
const ProjectAcceptanceDetail = () => {
  const { t } = useTranslation('verify');
  const navigate = useNavigate();
  const listPath = useAcceptanceRouteBase();

  return (
    <Flexbox flex={1} height={'100%'} style={{ minWidth: 0 }}>
      <NavHeader
        left={
          <Flexbox horizontal align={'center'} gap={6}>
            <ActionIcon
              icon={ChevronLeftIcon}
              size={'small'}
              title={t('acceptance.workspace.title')}
              onClick={() => navigate(listPath)}
            />
            <Text ellipsis weight={500}>
              {t('acceptance.workspace.title')}
            </Text>
          </Flexbox>
        }
      />
      <Flexbox flex={1} style={{ minHeight: 0, position: 'relative' }}>
        <OriginConversationProvider TopicPanel={TopicPanel}>
          <AcceptanceViewer />
        </OriginConversationProvider>
      </Flexbox>
    </Flexbox>
  );
};

export default ProjectAcceptanceDetail;
