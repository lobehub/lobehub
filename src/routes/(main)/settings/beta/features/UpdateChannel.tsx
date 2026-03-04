'use client';

import { FORM_STYLE } from '@lobechat/const';
import { Form } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { autoUpdateService } from '@/services/electron/autoUpdate';

type UpdateChannelValue = 'canary' | 'nightly' | 'stable';

const UpdateChannel = memo(() => {
  const { t } = useTranslation('setting');
  const [channel, setChannel] = useState<UpdateChannelValue>('stable');

  useEffect(() => {
    autoUpdateService
      .getUpdateChannel()
      .then(setChannel)
      .catch(() => {});
  }, []);

  const handleChange = useCallback((value: UpdateChannelValue) => {
    setChannel(value);
    autoUpdateService.setUpdateChannel(value);
  }, []);

  const channelOptions = [
    { label: t('tab.beta.updateChannel.stable'), value: 'stable' as const },
    { label: t('tab.beta.updateChannel.nightly'), value: 'nightly' as const },
    { label: t('tab.beta.updateChannel.canary'), value: 'canary' as const },
  ];

  return (
    <Form
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
      items={[
        {
          children: [
            {
              children: <Select options={channelOptions} value={channel} onChange={handleChange} />,
              desc: t('tab.beta.updateChannel.desc'),
              label: t('tab.beta.updateChannel.title'),
            },
          ],
          title: t('tab.beta'),
        },
      ]}
    />
  );
});

export default UpdateChannel;
