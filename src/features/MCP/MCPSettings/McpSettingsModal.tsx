'use client';

import { Button, createModal, Flexbox, ModalFooter } from '@lobehub/ui';
import { t as i18nT } from 'i18next';
import { type RefObject } from 'react';

import { type SettingsRef } from './index';
import Settings from './index';

interface McpSettingsModalOptions {
  identifier: string;
}

export const createMcpSettingsModal = ({ identifier }: McpSettingsModalOptions) => {
  const settingsRef: RefObject<SettingsRef | null> = { current: null };

  const modal = createModal({
    content: <Settings hideFooter identifier={identifier} ref={settingsRef} />,
    footer: (
      <ModalFooter style={{ justifyContent: 'space-between' }}>
        <Button
          onClick={() => {
            settingsRef.current?.reset();
          }}
        >
          {i18nT('reset', { ns: 'common' })}
        </Button>
        <Flexbox horizontal gap={8}>
          <Button onClick={() => modal.close()}>{i18nT('cancel', { ns: 'common' })}</Button>
          <Button
            type="primary"
            onClick={() => {
              settingsRef.current?.save();
            }}
          >
            {i18nT('save', { ns: 'common' })}
          </Button>
        </Flexbox>
      </ModalFooter>
    ),
    title: i18nT('dev.title.skillSettings', { ns: 'plugin' }),
    width: 600,
  });

  return modal;
};
