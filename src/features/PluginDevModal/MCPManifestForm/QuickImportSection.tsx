import { Alert, Button, Flexbox, TextArea } from '@lobehub/ui';
import { type FormInstance } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { electronStylish } from '@/styles/electron';

import { parseMcpInput } from './utils';

interface QuickImportSectionProps {
  form: FormInstance;
  isEditMode?: boolean;
  onClearConnectionError?: () => void;
}

const QuickImportSection = ({
  form,
  isEditMode,
  onClearConnectionError,
}: QuickImportSectionProps) => {
  const { t } = useTranslation(['plugin', 'common']);
  const pluginIds = useToolStore(pluginSelectors.storeAndInstallPluginsIdList);
  const [isImportModalVisible, setIsImportModalVisible] = useState(false);
  const [jsonInput, setJsonInput] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const handleImportConfirm = () => {
    setImportError(null); // Clear previous import error
    onClearConnectionError?.(); // Clear connection error

    const value = jsonInput.trim(); // Use the text area input
    if (!value) {
      setImportError(t('dev.mcp.quickImportError.empty'));
      return;
    }

    // Use the existing parseMcpInput function
    const parseResult = parseMcpInput(value);

    // Handle parsing errors from parseMcpInput
    if (parseResult.status === 'error') {
      // Assuming parseMcpInput returns an error message or code in parseResult
      // We might need a more specific error message based on parseResult.error
      setImportError(parseResult.errorCode);
      return;
    }

    if (parseResult.status === 'noop') {
      setImportError(t('dev.mcp.quickImportError.invalidJson'));
      return;
    }

    // Extract identifier and mcpConfig from the successful parse result
    const { identifier, mcpConfig } = parseResult;

    // Check for desktop requirement for stdio
    if (!isDesktop && mcpConfig.type === 'stdio') {
      setImportError(t('dev.mcp.stdioNotSupported'));
      return;
    }

    // Check for duplicate identifier (only in create mode)
    if (!isEditMode && pluginIds.includes(identifier)) {
      // Update form fields even if duplicate, so user sees the pasted values
      form.setFieldsValue({
        customParams: { mcp: mcpConfig },
        identifier: identifier,
      });
      // Trigger validation to show Form.Item error
      form.validateFields(['identifier']);
      setIsImportModalVisible(false); // Close modal even on duplicate error
      setJsonInput(''); // Clear modal input
      return;
    }

    // All checks passed, fill the form
    form.setFieldsValue({
      customParams: { mcp: mcpConfig },
      identifier: identifier,
    });

    // Clear potential old validation error on identifier field
    form.setFields([{ errors: [], name: 'identifier' }]);

    // Clear modal state and close (or rather, hide the import UI)
    setIsImportModalVisible(false);
    // setJsonInput(''); // Keep input for potential edits?
    setImportError(null);
  };

  if (!isImportModalVisible) {
    return (
      <div>
        <Button
          block // Make button full width
          onClick={() => {
            setImportError(null); // Clear previous errors when opening
            setIsImportModalVisible(true);
          }}
          style={{ marginBottom: 16 }} // Add some spacing
          type="dashed"
        >
          {t('dev.mcp.quickImport')}
        </Button>
      </div>
    );
  }

  return (
    <Flexbox gap={8}>
      {importError && (
        <Alert showIcon style={{ marginBottom: 8 }} title={importError} type="error" />
      )}
      <TextArea
        autoSize={{ maxRows: 15, minRows: 10 }}
        onChange={(e) => {
          setJsonInput(e.target.value);
          if (importError) setImportError(null);
        }}
        placeholder={`{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-github"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "<your-api-key>"
      }
    }
  }
}`}
        value={jsonInput}
      />
      <Flexbox horizontal justify={'space-between'}>
        <Button
          className={electronStylish.nodrag}
          onClick={() => {
            setIsImportModalVisible(false);
          }}
          size={'small'}
        >
          {t('common:cancel')}
        </Button>
        <Button onClick={handleImportConfirm} size={'small'} type={'primary'}>
          {t('common:import')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

export default QuickImportSection;
