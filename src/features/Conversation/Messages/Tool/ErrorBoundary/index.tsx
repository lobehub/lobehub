'use client';

import { type ErrorInfo, type ReactNode } from 'react';
import { Component } from 'react';

import { ErrorDisplay } from './ErrorResult';

interface ToolErrorBoundaryProps {
  /**
   * API name being called
   */
  apiName?: string;
  children: ReactNode;
  /**
   * Identifier of the tool (e.g., plugin name)
   */
  identifier?: string;
}

interface ToolErrorBoundaryState {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  hasError: boolean;
}

/**
 * ErrorBoundary for Tool rendering components.
 * Catches rendering errors in tool UI and displays a fallback error UI
 * instead of crashing the entire chat interface.
 */
class ToolErrorBoundary extends Component<ToolErrorBoundaryProps, ToolErrorBoundaryState> {
  public state: ToolErrorBoundaryState = {
    error: null,
    errorInfo: null,
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<ToolErrorBoundaryState> {
    return { error, hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Only log, don't setState to avoid re-render loop
    // errorInfo is captured here for logging but we use the error from getDerivedStateFromError
    console.error('[ToolErrorBoundary] Caught error in tool render:', {
      apiName: this.props.apiName,
      componentStack: errorInfo.componentStack,
      error: error.message,
      identifier: this.props.identifier,
    });

    // Store errorInfo without triggering re-render if already has error
    if (!this.state.errorInfo) {
      this.setState({ errorInfo });
    }
  }

  public render() {
    if (this.state.hasError) {
      return (
        <ErrorDisplay
          apiName={this.props.apiName}
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          identifier={this.props.identifier}
        />
      );
    }

    return this.props.children;
  }
}

export { ToolErrorBoundary };
