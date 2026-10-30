import { Component, type ReactNode } from 'react';
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error('Workspace rendering failed', error.message);
  }
  render() {
    return this.state.failed ? (
      <main className="empty-state" role="alert">
        <h1>The workspace couldn’t display this view.</h1>
        <p>Your posted records are stored safely. Reload the workspace to continue.</p>
        <button className="button primary" onClick={() => window.location.reload()}>
          Reload workspace
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
