import { Button, DropdownMenu, Flexbox, Icon, Text } from '@lobehub/ui';
import { GithubIcon } from '@lobehub/ui/icons';
import { ChevronDown, FileArchive, Grid2x2Plus, Link, PenLine } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CustomConnectorModal } from '@/features/Connectors';
import { usePermission } from '@/hooks/usePermission';

import ImportFromGithubModal from './ImportFromGithubModal';
import ImportFromUrlModal from './ImportFromUrlModal';
import UploadSkillModal from './UploadSkillModal';

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
  const [showUrlModal, setUrlModal] = useState(false);
  const [showGithubModal, setGithubModal] = useState(false);
  const [showUploadModal, setUploadModal] = useState(false);
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <CustomConnectorModal open={showMcpModal} onClose={() => setMcpModal(false)} />
      <ImportFromUrlModal open={showUrlModal} onOpenChange={setUrlModal} />
      <ImportFromGithubModal open={showGithubModal} onOpenChange={setGithubModal} />
      <UploadSkillModal open={showUploadModal} onOpenChange={setUploadModal} />
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
              setUrlModal(true);
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
              setGithubModal(true);
            },
          },
          {
            disabled: !canCreate,
            icon: <Icon icon={FileArchive} />,
            key: 'uploadZip',
            label: <MenuLabel desc={t('tab.uploadZip.desc')} title={t('tab.uploadZip')} />,
            onClick: () => {
              if (!canCreate) return;
              setUploadModal(true);
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
