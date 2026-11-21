import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { LocalFile, LocalFolder } from '@/features/LocalFile';

import type { BrowserUploadFileArgs } from '../../types';

/** `/a/b/c.zip` → `/a/b` + `c.zip`; Windows separators included. */
const splitPath = (filePath: string) => {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return index < 0
    ? { base: filePath, dir: '' }
    : { base: filePath.slice(index + 1), dir: filePath.slice(0, index) || filePath[0] };
};

/**
 * Approval card for `uploadFile`: the files leave the device for whatever page
 * the browser shows, so the user sees each one before it is handed over.
 */
const UploadFile = memo<BuiltinInterventionProps<BrowserUploadFileArgs>>(({ args }) => {
  const { t } = useTranslation('plugin');
  const paths = (Array.isArray(args?.paths) ? args.paths : []).filter(
    (filePath): filePath is string => typeof filePath === 'string' && !!filePath,
  );

  return (
    <Flexbox gap={8}>
      <Text style={{ fontSize: 12 }} type="secondary">
        {t('builtins.lobe-browser.uploadFile.confirm')}
      </Text>
      {paths.map((filePath) => {
        const { base, dir } = splitPath(filePath);
        return (
          <Flexbox horizontal align={'center'} key={filePath}>
            {dir && <LocalFolder path={dir} />}
            {dir && <Icon icon={ChevronRight} />}
            <LocalFile name={base} path={filePath} />
          </Flexbox>
        );
      })}
    </Flexbox>
  );
});

UploadFile.displayName = 'BrowserUploadFileIntervention';

export default UploadFile;
