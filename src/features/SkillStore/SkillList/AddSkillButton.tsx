import { Button, DropdownMenu, Icon } from '@lobehub/ui';
import { ChevronDown, Grid2x2Plus, Import, PenLine } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CustomConnectorModal } from '@/features/Connectors';
import { usePermission } from '@/hooks/usePermission';

import { openSkillImportModal } from '../SkillImportModal';

const AddSkillButton = () => {
  const { t } = useTranslation('setting');
  const [showMcpModal, setMcpModal] = useState(false);
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');

  return (
    <>
      <CustomConnectorModal open={showMcpModal} onClose={() => setMcpModal(false)} />
      <DropdownMenu
        nativeButton={false}
        placement="bottomRight"
        items={[
          {
            disabled: !canCreate,
            desc: t('agentSkillModal.sources'),
            icon: <Icon icon={Import} />,
            key: 'import',
            label: t('agentSkillModal.title'),
            onClick: openSkillImportModal,
          },
          { type: 'divider' as const },
          {
            disabled: !canCreate || !canEdit,
            icon: <Icon icon={PenLine} />,
            key: 'customMcp',
            desc: t('tab.addCustomMcp.desc'),
            label: t('tab.addCustomMcp'),
            onClick: () => {
              if (!canCreate || !canEdit) return;
              setMcpModal(true);
            },
          },
        ]}
      >
        <Button disabled={!canCreate} icon={Grid2x2Plus}>
          {t('tab.addCustomSkill')}
          <Icon icon={ChevronDown} size={14} />
        </Button>
      </DropdownMenu>
    </>
  );
};

export default AddSkillButton;
