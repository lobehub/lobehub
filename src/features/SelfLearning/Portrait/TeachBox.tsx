'use client';

import { Flexbox, TextArea } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface TeachBoxProps {
  autoFocus?: boolean;
  onSubmit: (text: string) => Promise<void> | void;
  placeholder: string;
}

/** 一句话教它。教学动作全是随手的，所以这里只有一个输入框和一个按钮。 */
const TeachBox = memo<TeachBoxProps>(({ autoFocus, onSubmit, placeholder }) => {
  const { t } = useTranslation('selfLearning');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const text = value.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await onSubmit(text);
      setValue('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flexbox horizontal align={'flex-end'} gap={8} width={'100%'}>
      <TextArea
        autoFocus={autoFocus}
        autoSize={{ maxRows: 4, minRows: 1 }}
        disabled={busy}
        placeholder={placeholder}
        style={{ flex: 1 }}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit();
        }}
      />
      <Button disabled={!value.trim()} loading={busy} type={'primary'} onClick={submit}>
        {t('habit.teach.send')}
      </Button>
    </Flexbox>
  );
});

TeachBox.displayName = 'ExpertiseTeachBox';

export default TeachBox;
