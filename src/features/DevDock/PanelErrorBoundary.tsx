import { Button } from '@lobehub/ui/base-ui';
import { Component, type PropsWithChildren } from 'react';

interface PanelErrorBoundaryState {
  error?: Error;
}

class PanelErrorBoundary extends Component<PropsWithChildren, PanelErrorBoundaryState> {
  state: PanelErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
        <span style={{ fontSize: 12 }}>Panel crashed: {this.state.error.message}</span>
        <Button
          size={'small'}
          style={{ alignSelf: 'flex-start' }}
          onClick={() => this.setState({ error: undefined })}
        >
          Retry
        </Button>
      </div>
    );
  }
}

export default PanelErrorBoundary;
