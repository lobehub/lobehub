'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { AcceptanceListPanel, useAcceptanceProjectActionItems } from '@/features/Acceptance';
import NavHeader from '@/features/NavHeader';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useCurrentProjectDetail } from '@/store/project';

const noop = () => {};

/**
 * `project/:projectId/acceptance` — the project's acceptances as one page-wide
 * list; a row opens its own page instead of filling a side pane.
 */
const ProjectAcceptanceList = () => {
  const { t } = useTranslation('verify');
  const { projectId } = useActiveRouteParams<{ projectId: string }>();
  const detail = useCurrentProjectDetail(projectId);
  const projectActionItems = useAcceptanceProjectActionItems();

  return (
    <Flexbox flex={1} height={'100%'} style={{ minWidth: 0 }}>
      <NavHeader
        left={
          <Text style={{ paddingInlineStart: 4 }} weight={500}>
            {t('acceptance.workspace.title')}
          </Text>
        }
      />
      <Flexbox
        flex={1}
        paddingBlock={'0 8px'}
        style={{ marginInline: 'auto', maxWidth: 960, minHeight: 0 }}
        width={'100%'}
      >
        <AcceptanceListPanel
          expand
          hosted
          pinned
          isNarrow={false}
          projectActionItems={projectActionItems}
          projectId={detail?.project.id}
          setExpand={noop}
        />
      </Flexbox>
    </Flexbox>
  );
};

export default ProjectAcceptanceList;
