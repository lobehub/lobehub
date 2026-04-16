import { ActionIcon, Flexbox } from '@lobehub/ui';
import { PanelRightCloseIcon } from 'lucide-react';
import { memo } from 'react';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import NavHeader from '@/features/NavHeader';
import RightPanel from '@/features/RightPanel';
import { useGlobalStore } from '@/store/global';

import AgentDocumentEditorPanel from './AgentDocumentEditorPanel';
import ResourcesSection from './ResourcesSection';

interface AgentWorkingSidebarProps {
  onSelectDocument: (id: string | null) => void;
  selectedDocumentId: string | null;
}

const AgentWorkingSidebar = memo<AgentWorkingSidebarProps>(
  ({ onSelectDocument, selectedDocumentId }) => {
    const toggleRightPanel = useGlobalStore((s) => s.toggleRightPanel);
    const isDocumentMode = Boolean(selectedDocumentId);

    return (
      <RightPanel defaultWidth={360} maxWidth={720} minWidth={300}>
        {isDocumentMode ? (
          <AgentDocumentEditorPanel
            selectedDocumentId={selectedDocumentId}
            onClose={() => onSelectDocument(null)}
          />
        ) : (
          <Flexbox height={'100%'} width={'100%'}>
            <NavHeader
              showTogglePanelButton={false}
              right={
                <ActionIcon
                  icon={PanelRightCloseIcon}
                  size={DESKTOP_HEADER_ICON_SIZE}
                  onClick={() => toggleRightPanel(false)}
                />
              }
              style={{
                paddingBlock: 8,
                paddingInline: 8,
                position: 'absolute',
              }}
            />
            <Flexbox gap={8} height={'100%'} style={{ overflowY: 'auto' }} width={'100%'}>
              {/* <AgentSummary /> */}
              {/*<ProgressSection />*/}
              <ResourcesSection
                selectedDocumentId={selectedDocumentId}
                onSelectDocument={onSelectDocument}
              />
            </Flexbox>
          </Flexbox>
        )}
      </RightPanel>
    );
  },
);

export default AgentWorkingSidebar;
