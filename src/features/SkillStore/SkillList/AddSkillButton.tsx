import { DropdownMenu, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { GithubIcon } from '@lobehub/ui/icons';
import { ChevronDown, FileArchive, Grid2x2Plus, Link, PenLine } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CustomConnectorModal } from '@/features/Connectors';
import { usePermission } from '@/hooks/usePermission';

import { openImportFromGithubModal } from './ImportFromGithubModal';
import { openImportFromUrlModal } from './ImportFromUrlModal';
import { openUploadSkillModal } from './UploadSkillModal';

const MenuLabel = ({ desc, title }: { desc: string; title: ReactNode }) => (
  <Flexbox gap={2}>
    <span>{title}</span>
    <Text style={{ fontSize: 12 }} type="secondary">
      {desc}
    </Text>
  </Flexbox>
);

const AddSkillButton = () => {
  const { t } = useTranslation('setting');
  const [showMcpModal, setMcpModal] = useState(false);
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <CustomConnectorModal open={showMcpModal} onClose={() => setMcpModal(false)} />
      <DropdownMenu
        nativeButton={false}
        placement="bottomRight"
        items={[
          {
            disabled: !canCreate,
            icon: <Icon icon={Link} />,
            key: 'importUrl',
            label: <MenuLabel desc={t('tab.importFromUrl.desc')} title={t('tab.importFromUrl')} />,
            onClick: () => {
              if (!canCreate) return;
              openImportFromUrlModal();
            },
          },
          {
            disabled: !canCreate,
            icon: <Icon icon={GithubIcon} />,
            key: 'importGithub',
            label: (
              <MenuLabel desc={t('tab.importFromGithub.desc')} title={t('tab.importFromGithub')} />
            ),
            onClick: () => {
              if (!canCreate) return;
              openImportFromGithubModal();
            },
          },
          {
            disabled: !canCreate,
            icon: <Icon icon={FileArchive} />,
            key: 'uploadZip',
            label: <MenuLabel desc={t('tab.uploadZip.desc')} title={t('tab.uploadZip')} />,
            onClick: () => {
              if (!canCreate) return;
              openUploadSkillModal();
            },
          },
          { type: 'divider' as const },
          {
            disabled: !canCreate || !canEdit,
            icon: <Icon icon={PenLine} />,
            key: 'customMcp',
            label: <MenuLabel desc={t('tab.addCustomMcp.desc')} title={t('tab.addCustomMcp')} />,
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
    </div>
  );
};

export default AddSkillButton;
