'use client';

import { PopoverPopup, PopoverPortal, PopoverPositioner, PopoverRoot } from '@lobehub/ui';

import AgentContent from './AgentContent';
import GroupContent from './GroupContent';
import { useEditingPopoverStore } from './store';

const EditingPopover = () => {
  const target = useEditingPopoverStore((s) => s.target);
  const close = useEditingPopoverStore((s) => s.close);

  return (
    <PopoverRoot
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <PopoverPortal>
        <PopoverPositioner anchor={target?.anchor ?? document.body} placement="bottomLeft">
          <PopoverPopup data-testid="editing-popover" style={{ padding: 4 }}>
            {target?.type === 'agent' ? (
              <AgentContent
                avatar={target.avatar}
                id={target.id}
                title={target.title}
                onClose={close}
              />
            ) : target ? (
              <GroupContent
                avatar={target.avatar}
                id={target.id}
                memberAvatars={target.memberAvatars}
                title={target.title}
                type={target.type}
                onClose={close}
              />
            ) : null}
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </PopoverRoot>
  );
};

export default EditingPopover;
