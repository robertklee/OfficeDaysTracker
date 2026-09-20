import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { AccountProvider } from './app/account';
import './styles.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Deliberately keep attendance and component data out of logs. */
  }
  render() {
    if (this.state.failed)
      return (
        <main className="fatal">
          <h1>Unable to open the planner</h1>
          <p>
            An application error prevented evaluation. No compliance result is available. Saved
            browser data has not been intentionally deleted.
          </p>
          <button onClick={() => location.reload()}>Reload app</button>
        </main>
      );
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AccountProvider>
          <App />
        </AccountProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
