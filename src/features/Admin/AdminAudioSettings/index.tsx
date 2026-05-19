'use client';

import { Button, Card, Flexbox } from '@lobehub/ui';
import { Divider, Input, InputNumber, Select, Switch } from 'antd';
import { memo, useCallback, useState } from 'react';

const AdminAudioSettings = memo(() => {
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isEnabled, setIsEnabled] = useState(true);
  const [pollingInterval, setPollingInterval] = useState(3000);
  const [testing, setTesting] = useState(false);

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    try {
      // TODO: Test connection to audio generation API
      console.log('Testing connection with API key:', apiKey);
      // Simulate successful test
      setTimeout(() => {
        setTesting(false);
      }, 1000);
    } catch (error) {
      console.error('Connection test failed:', error);
      setTesting(false);
    }
  }, [apiKey]);

  const handleSaveSettings = useCallback(() => {
    const settings = {
      apiKey,
      isEnabled,
      pollingInterval,
    };
    console.log('Saving audio settings:', settings);
    // TODO: Save to database or store
  }, [apiKey, isEnabled, pollingInterval]);

  return (
    <Card title="Audio Generation Settings" style={{ marginBottom: '24px' }}>
      <Flexbox gap="lg">
        <div>
          <label>Enable Audio Generation</label>
          <Switch
            checked={isEnabled}
            onChange={setIsEnabled}
            style={{ marginLeft: '12px' }}
          />
        </div>

        <Divider />

        <div>
          <label>API Key</label>
          <Flexbox horizontal gap="sm" align="center">
            <Input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type={showApiKey ? 'text' : 'password'}
              placeholder="Enter Suno API key"
              style={{ flex: 1 }}
            />
            <Button onClick={() => setShowApiKey(!showApiKey)}>
              {showApiKey ? 'Hide' : 'Show'}
            </Button>
          </Flexbox>
        </div>

        <div>
          <label>Polling Interval (ms)</label>
          <InputNumber
            min={1000}
            max={10000}
            value={pollingInterval}
            onChange={(value) => value && setPollingInterval(value)}
            style={{ width: '100%' }}
          />
        </div>

        <Flexbox horizontal gap="sm">
          <Button
            loading={testing}
            onClick={handleTestConnection}
          >
            Test Connection
          </Button>
          <Button
            type="primary"
            onClick={handleSaveSettings}
          >
            Save Settings
          </Button>
        </Flexbox>
      </Flexbox>
    </Card>
  );
});

AdminAudioSettings.displayName = 'AdminAudioSettings';

export default AdminAudioSettings;
