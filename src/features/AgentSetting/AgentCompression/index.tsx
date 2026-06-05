'use client';

import { Form } from '@lobehub/ui';
import { Input } from 'antd';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useStore } from '../store';
import { selectors } from '../store/selectors';

const { TextArea } = Input;

const AgentCompression = memo(() => {
  const { t } = useTranslation('setting');
  const compressionSystemPrompt = useStore(
    (s) => selectors.chatConfig(s).compressionSystemPrompt,
  );
  const setChatConfig = useStore((s) => s.setChatConfig);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setChatConfig({ compressionSystemPrompt: e.target.value || undefined });
    },
    [setChatConfig],
  );

  return (
    <Form
      itemsType={'group'}
      variant={'borderless'}
      items={[
        {
          children: [
            {
              children: (
                <TextArea
                  allowClear
                  autoSize={{ minRows: 8, maxRows: 20 }}
                  placeholder={t('settingCompression.systemPrompt.placeholder')}
                  value={compressionSystemPrompt ?? ''}
                  onChange={handleChange}
                />
              ),
              desc: t('settingCompression.systemPrompt.desc'),
              label: t('settingCompression.systemPrompt.title'),
              layout: 'vertical',
            },
          ],
          title: t('settingCompression.title'),
        },
      ]}
    />
  );
});

export default AgentCompression;
