import { StrictMode, Component } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      const hasRecovery = !!localStorage.getItem('teamsheet_in_progress');
      return (
        <div style={{ padding: 32, fontFamily: 'monospace', background: '#fee2e2', minHeight: '100vh' }}>
          <h2 style={{ color: '#dc2626' }}>Render Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#7f1d1d' }}>{this.state.error?.message}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#7f1d1d', fontSize: 11 }}>{this.state.error?.stack}</pre>
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            {hasRecovery && (
              <button onClick={() => this.setState({ error: null })} style={{ padding: '12px 24px', background: '#1d6fcf', color: '#fff', border: 'none', borderRadius: 8, fontSize: 16, cursor: 'pointer' }}>
                Recover Last Game
              </button>
            )}
            <button onClick={() => this.setState({ error: null })} style={{ padding: '12px 24px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 16, cursor: 'pointer' }}>Retry</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
