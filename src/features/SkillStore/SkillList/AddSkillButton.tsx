import { Button, DropdownMenu, Flexbox, Icon, Text } from '@lobehub/ui';
import { ChevronDown, FileArchive, Github, Grid2x2Plus, Link, PenLine } from 'lucide-react';
import { type ReactNode, forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import DevModal from '@/features/PluginDevModal';
import { useAgentStore } from '@/store/agent';
import { useToolStore } from '@/store/tool';

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

const AddSkillButton = forwardRef<HTMLButtonElement>((props, ref) => {
  const { t } = useTranslation('setting');
  const [showMcpModal, setMcpModal] = useState(false);
  const [showUrlModal, setUrlModal] = useState(false);
  const [showGithubModal, setGithubModal] = useState(false);
  const [showUploadModal, setUploadModal] = useState(false);

  const [installCustomPlugin, updateNewDevPlugin] = useToolStore((s) => [
    s.installCustomPlugin,
    s.updateNewCustomPlugin,
  ]);
  const togglePlugin = useAgentStore((s) => s.togglePlugin);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <DevModal
        onOpenChange={setMcpModal}
        onSave={async (devPlugin) => {
          await installCustomPlugin(devPlugin);
          await togglePlugin(devPlugin.identifier);
        }}
        onValueChange={updateNewDevPlugin}
        open={showMcpModal}
      />
      <ImportFromUrlModal onOpenChange={setUrlModal} open={showUrlModal} />
      <ImportFromGithubModal onOpenChange={setGithubModal} open={showGithubModal} />
      <UploadSkillModal onOpenChange={setUploadModal} open={showUploadModal} />
      <DropdownMenu
        items={[
          {
            icon: <Icon icon={Link} />,
            key: 'importUrl',
            label: <MenuLabel desc={t('tab.importFromUrl.desc')} title={t('tab.importFromUrl')} />,
            onClick: () => setUrlModal(true),
          },
          {
            icon: <Icon icon={Github} />,
            key: 'importGithub',
            label: (
              <MenuLabel desc={t('tab.importFromGithub.desc')} title={t('tab.importFromGithub')} />
            ),
            onClick: () => setGithubModal(true),
          },
          {
            icon: <Icon icon={FileArchive} />,
            key: 'uploadZip',
            label: <MenuLabel desc={t('tab.uploadZip.desc')} title={t('tab.uploadZip')} />,
            onClick: () => setUploadModal(true),
          },
          { type: 'divider' as const },
          {
            icon: <Icon icon={PenLine} />,
            key: 'customMcp',
            label: <MenuLabel desc={t('tab.addCustomMcp.desc')} title={t('tab.addCustomMcp')} />,
            onClick: () => setMcpModal(true),
          },
        ]}
        nativeButton={false}
        placement="bottomRight"
      >
        <Button icon={Grid2x2Plus} ref={ref}>
          {t('tab.addCustomSkill')}
          <Icon icon={ChevronDown} size={14} />
        </Button>
      </DropdownMenu>
    </div>
  );
});

export default AddSkillButton;
