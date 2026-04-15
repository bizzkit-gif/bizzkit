import React, { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }

type State = { hasError: boolean; message: string }

/**
 * Catches render/lifecycle errors so a failed subtree does not leave a silent blank screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Something went wrong' }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Bizzkit]', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, color: '#fff', background: '#0A1628', minHeight: 200 }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, marginBottom: 12 }}>Something broke</div>
          <div style={{ fontSize: 14, color: '#7A92B0', marginBottom: 16, wordBreak: 'break-word' }}>{this.state.message}</div>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
