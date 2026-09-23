import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useStore } from './store';
import { PolicyForm } from '../components/PolicyForm';
import { Calendar } from '../features/calendar/Calendar';
import { Dashboard } from '../features/dashboard/Dashboard';
import { BackupSettings, Settings } from '../features/settings/Settings';
import { Dialog } from '../components/Dialog';
import { Account } from '../features/account/Account';
import { useAccount } from './account';
import { Icon } from '../components/Icon';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function PWAStatus() {
  const { saving, pending, isAccount } = useStore();
  const [online, setOnline] = useState(navigator.onLine);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(
    window.matchMedia('(display-mode: standalone)').matches,
  );
  const [error, setError] = useState('');
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: () =>
      setError('Offline setup failed. Reconnect to try again. Saved data is safe.'),
    onRegisteredSW: (_url, registration) => {
      if (registration)
        window.addEventListener('focus', () => {
          if (navigator.onLine)
            void registration
              .update()
              .catch(() => setError('Unable to check for an app update. Try again online.'));
        });
    },
  });
  useEffect(() => {
    const connection = () => setOnline(navigator.onLine);
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallEvent);
    };
    const appInstalled = () => {
      setInstalled(true);
      setInstall(null);
    };
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', appInstalled);
    return () => {
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', appInstalled);
    };
  }, []);
  return (
    <div className="pwa-status">
      <span>
        {isAccount
          ? online
            ? 'Account connected'
            : 'Offline · reconnect to use your account'
          : online
            ? offlineReady || navigator.serviceWorker?.controller
              ? 'Ready for offline use'
              : 'Preparing offline access'
            : 'Offline · saved in this browser'}
        {installed && ' · Installed'}
      </span>
      {install && (
        <button
          onClick={async () => {
            try {
              await install.prompt();
              await install.userChoice;
              setInstall(null);
            } catch {
              setError('Could not install. You can still use the website.');
            }
          }}
        >
          Install app
        </button>
      )}
      {needRefresh && (
        <div className="notice" role="status">
          Update available. Save your edits before reloading.{' '}
          <button disabled={saving || !!pending} onClick={() => setConfirmUpdate(true)}>
            Update app
          </button>
          <button onClick={() => setNeedRefresh(false)}>Later</button>
        </div>
      )}
      {confirmUpdate && (
        <Dialog title="Reload to update?" onClose={() => setConfirmUpdate(false)}>
          <p>
            Saved days stay in {isAccount ? 'your account' : 'this browser'}. Unsaved edits will be
            lost.
          </p>
          <div className="button-row">
            <button
              className="primary"
              disabled={saving || !!pending}
              onClick={() => {
                setConfirmUpdate(false);
                void updateServiceWorker(true).catch(() =>
                  setError('Update failed. Your records are retained; retry online.'),
                );
              }}
            >
              Reload
            </button>
            <button onClick={() => setConfirmUpdate(false)}>Cancel</button>
          </div>
        </Dialog>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}

export function App() {
  const store = useStore();
  const account = useAccount();
  const route = useLocation();
  const { snapshot, error, pending, saving, migrationRequired, isAccount } = store;
  const configured = !!snapshot?.dataset.policy;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <div className="header-inner">
          <NavLink to="/dashboard" className="brand" aria-label="RTO Planner home">
            <span className="brand-mark">
              <Icon name="week" size={22} />
            </span>
            <span>
              RTO<span className="brand-light">planner</span>
            </span>
          </NavLink>
          <nav className="main-navigation" aria-label="Main navigation">
            <NavLink to="/dashboard">
              <Icon name="week" />
              This week
            </NavLink>
            <NavLink to="/calendar">
              <Icon name="calendar" />
              Calendar
            </NavLink>
            <NavLink to="/settings">
              <Icon name="settings" />
              Settings
            </NavLink>
            <NavLink to="/account">
              <Icon name="account" />
              Account
            </NavLink>
          </nav>
        </div>
      </header>
      <div className="workspace">
        <div className="topbar">
          <span>{account.user ? `${account.user.displayName}'s planner` : 'My planner'}</span>
          <div className={`saved-status ${error ? 'failed' : ''}`} role="status">
            {saving
              ? 'Saving...'
              : error
                ? 'Storage needs attention'
                : snapshot
                  ? isAccount
                    ? 'Saved to your account'
                    : 'Saved on this browser'
                  : isAccount
                    ? 'Loading account...'
                    : 'Loading...'}
          </div>
        </div>
        <main id="main">
          {account.error && !isAccount && route.pathname !== '/account' && (
            <section className="notice" role="status">
              <h2>Account unavailable</h2>
              <p>{account.error}</p>
              <p>
                You are viewing your local planner. Your account data is unchanged.{' '}
                <NavLink to="/account">Check connection</NavLink>
              </p>
            </section>
          )}
          {error && (
            <section className="notice error" role="alert">
              <h2>
                {pending
                  ? isAccount
                    ? 'Account save not confirmed'
                    : 'Your edit is not saved'
                  : 'Could not load your data'}
              </h2>
              <p>{error}</p>
              <div className="button-row">
                <button onClick={store.retry} disabled={saving}>
                  Retry storage
                </button>
                {pending && (
                  <>
                    <button onClick={store.exportPending}>Export unsaved changes</button>
                    <button onClick={store.discard}>Discard unsaved edit</button>
                  </>
                )}
              </div>
            </section>
          )}
          {route.pathname === '/account' ? (
            <Account />
          ) : migrationRequired ? (
            <section className="card">
              <h1>Reload required</h1>
              <p>Another tab updated the app. Export unsaved edits, then reload to continue.</p>
              {pending && <button onClick={store.exportPending}>Export unsaved changes</button>}
              <button onClick={() => location.reload()}>Reload</button>
            </section>
          ) : !snapshot ? (
            <section className="card">
              <h1>Opening your planner</h1>
              <p>
                {error
                  ? 'Resolve the storage error above to continue.'
                  : isAccount
                    ? 'Loading your account...'
                    : 'Loading saved days...'}
              </p>
            </section>
          ) : !configured ? (
            <>
              <div className="page-heading">
                <div>
                  <h1>Set up your week</h1>
                  <p className="muted">Choose your office policy to get started.</p>
                </div>
              </div>
              <section className="card">
                <h2>Start with your policy</h2>
                <PolicyForm setup />
              </section>
              <BackupSettings />
            </>
          ) : (
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/settings" element={<Settings />} />
              <Route
                path="*"
                element={
                  <section className="card">
                    <h1>Page not found</h1>
                    <NavLink to="/dashboard">Back to this week</NavLink>
                  </section>
                }
              />
            </Routes>
          )}
        </main>
        <footer>
          <PWAStatus />
          <p>
            Planning advice, not an official attendance record.{' '}
            <NavLink to="/settings">Settings & backups</NavLink>
          </p>
        </footer>
      </div>
    </div>
  );
}
