'use client';

import { Alert } from '@lobehub/ui';
import { type ErrorInfo, type ReactNode } from 'react';
import { Component } from 'react';

interface EditorErrorBoundaryState {
  error: Error | null;
  hasError: boolean;
}

interface EditorErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * ErrorBoundary for EditorCanvas component.
 * Catches rendering errors in the editor and displays a fallback error UI
 * instead of crashing the entire page.
 */
export class EditorErrorBoundary extends Component<
  EditorErrorBoundaryProps,
  EditorErrorBoundaryState
> {
  public state: EditorErrorBoundaryState = {
    error: null,
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<EditorErrorBoundaryState> {
    return { error, hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[EditorErrorBoundary] Caught error in editor render:', {
      componentStack: errorInfo.componentStack,
      error: error.message,
      stack: error.stack,
    });
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Alert
          showIcon
          message={this.state.error?.message || 'An unknown error occurred in the editor'}
          title="Editor Error"
          type="error"
          style={{
            margin: 16,
            overflow: 'hidden',
            position: 'relative',
            width: '100%',
          }}
        />
      );
    }

    return this.props.children;
  }
}
