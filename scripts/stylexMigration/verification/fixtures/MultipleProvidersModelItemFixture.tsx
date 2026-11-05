import {
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from '@lobehub/ui';
import { useLayoutEffect } from 'react';
import { MultipleProvidersModelItem } from 'verification:component';

import { FixtureI18n } from './FixtureI18n';

const noop = () => {};

const data = {
  displayName: 'GPT-4o',
  model: { displayName: 'GPT-4o', id: 'gpt-4o' },
  providers: [
    { id: 'openai', name: 'OpenAI' },
    { id: 'azure', name: 'Azure OpenAI' },
    { id: 'lobehub', name: 'LobeHub' },
  ],
};

export const Fixture = ({ variant }: { variant: string }) => {
  useLayoutEffect(() => {
    const open = () => {
      const trigger = document.querySelector<HTMLElement>('[role="menu"] [aria-haspopup="menu"]');
      if (!trigger) return false;
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
      return true;
    };
    if (open()) return;
    const observer = new MutationObserver(() => {
      if (open()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return (
    <FixtureI18n>
      <DropdownMenuRoot open>
        <DropdownMenuTrigger>Models</DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuPositioner placement="bottomLeft">
            <DropdownMenuPopup>
              <MultipleProvidersModelItem
                activeKey={variant === 'active' ? 'azure-gpt-4o' : ''}
                data={data}
                newLabel="New"
                proLabel="Pro"
                isModelRestricted={(_model: string, provider: string) =>
                  variant === 'restricted' && provider === 'azure'
                }
                onClose={noop}
                onModelChange={noop}
              />
            </DropdownMenuPopup>
          </DropdownMenuPositioner>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    </FixtureI18n>
  );
};
