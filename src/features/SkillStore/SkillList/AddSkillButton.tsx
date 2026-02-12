import { type ButtonProps } from '@lobehub/ui';
import { Button } from '@lobehub/ui';
import { Grid2x2Plus } from 'lucide-react';
import { type Ref } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import DevModal from '@/features/PluginDevModal';
import { useAgentStore } from '@/store/agent';
import { useToolStore } from '@/store/tool';

const AddSkillButton = ({ ref, ...props }: ButtonProps & { ref?: Ref<HTMLButtonElement> }) => {
  const { t } = useTranslation('setting');
  const [showModal, setModal] = useState(false);

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
        open={showModal}
        onOpenChange={setModal}
        onValueChange={updateNewDevPlugin}
        onSave={async (devPlugin) => {
          await installCustomPlugin(devPlugin);
          await togglePlugin(devPlugin.identifier);
        }}
      />
      <Button
        icon={Grid2x2Plus}
        ref={ref}
        onClick={() => {
          setModal(true);
        }}
      >
        {t('tab.addCustomSkill')}
      </Button>
    </div>
  );
};

export default AddSkillButton;
