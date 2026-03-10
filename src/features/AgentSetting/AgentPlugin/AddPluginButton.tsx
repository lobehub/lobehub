import { type ButtonProps } from '@lobehub/ui';
import { Button } from '@lobehub/ui';
import { Grid2x2Plus } from 'lucide-react';
import { type Ref } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import DevModal from '@/features/PluginDevModal';
import { useAgentStore } from '@/store/agent';
import { useToolStore } from '@/store/tool';

const AddPluginButton = ({ ref, ...props }: ButtonProps & { ref?: Ref<HTMLButtonElement> }) => {
  const { t } = useTranslation('setting');
  const [showModal, setModal] = useState(false);
  const toggleAgentPlugin = useAgentStore((s) => s.toggleAgentPlugin);
  const [installCustomPlugin, updateNewDevPlugin] = useToolStore((s) => [
    s.installCustomPlugin,
    s.updateNewCustomPlugin,
  ]);

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
          toggleAgentPlugin(devPlugin.identifier);
        }}
      />
      <Button
        icon={Grid2x2Plus}
        ref={ref}
        size={'small'}
        onClick={() => {
          setModal(true);
        }}
      >
        {t('plugin.addTooltip')}
      </Button>
    </div>
  );
};

export default AddPluginButton;
