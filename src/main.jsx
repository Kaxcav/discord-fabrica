import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(err) {
    return { error: err };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'monospace', background: '#0b0d12', color: '#f87171', minHeight: '100vh' }}>
          <h2 style={{ color: '#f87171' }}>Erro na aplicação</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#fca5a5' }}>{String(this.state.error)}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#6b7280', fontSize: '0.75rem' }}>{this.state.error?.stack}</pre>
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
  </StrictMode>,
)
