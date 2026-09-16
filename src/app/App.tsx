import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useStore } from './store';
import { PolicyForm } from '../components/PolicyForm';
import { Calendar } from '../features/calendar/Calendar';
import { Dashboard } from '../features/dashboard/Dashboard';
import { BackupSettings, Settings } from '../features/settings/Settings';
import { Dialog } from '../components/Dialog';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function PWAStatus() {
  const { saving, pending } = useStore();
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
      setError('Offline setup failed. Revisit online to retry; your browser records are retained.'),
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
        {online
          ? offlineReady || navigator.serviceWorker?.controller
            ? 'Ready for offline use'
            : 'Online · preparing offline shell'
          : 'Offline · working on this browser'}{' '}
        · {installed ? 'Installed' : 'Installation optional'}
      </span>
      {install && (
        <button
          onClick={async () => {
            try {
              await install.prompt();
              await install.userChoice;
              setInstall(null);
            } catch {
              setError(
                'Installation could not finish. You can continue using the website normally.',
              );
            }
          }}
        >
          Install app
        </button>
      )}
      {needRefresh && (
        <div className="notice" role="status">
          An app update is ready. Finish and save edits before reloading.{' '}
          <button disabled={saving || !!pending} onClick={() => setConfirmUpdate(true)}>
            Review app update
          </button>
          <button onClick={() => setNeedRefresh(false)}>Later</button>
        </div>
      )}
      {confirmUpdate && (
        <Dialog title="Reload to update?" onClose={() => setConfirmUpdate(false)}>
          <p>
            Saved attendance stays in this browser. Unfinished ranges, notes, and policy drafts will
            be discarded. Cancel to finish editing first.
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
              Confirm reload
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
  const { snapshot, error, pending, saving, migrationRequired } = store;
  const configured = !!snapshot?.dataset.policy;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <a href="/dashboard" className="brand">
          <img src="/icon.svg" alt="" width="36" height="36" />
          <span>
            RTO<span className="brand-light">planner</span>
          </span>
        </a>
        <p className="sidebar-label">YOUR WORK, IN BALANCE</p>
        <nav aria-label="Main navigation">
          <NavLink to="/dashboard">
            <span aria-hidden="true">▦</span>Dashboard
          </NavLink>
          <NavLink to="/calendar">
            <span aria-hidden="true">▤</span>Calendar
          </NavLink>
          <NavLink to="/settings">
            <span aria-hidden="true">⚙</span>Settings
          </NavLink>
        </nav>
        <div className="sidebar-note">
          <strong>Private by design.</strong>
          <p>Your attendance lives on this browser. No account required.</p>
          <span className="small">
            Plan with confidence.
            <br />
            Keep a backup.
          </span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>Personal workspace</span>
          <div className={`saved-status ${error ? 'failed' : ''}`} role="status">
            {saving
              ? 'Saving...'
              : error
                ? 'Storage needs attention'
                : snapshot
                  ? 'Saved on this browser'
                  : 'Opening browser storage...'}
          </div>
        </header>
        <main id="main">
          {error && (
            <section className="notice error" role="alert">
              <h2>{pending ? 'Your edit is not saved' : 'Unable to evaluate stored data'}</h2>
              <p>{error}</p>
              <div className="button-row">
                <button onClick={store.retry} disabled={saving}>
                  Retry storage
                </button>
                {pending && (
                  <>
                    <button onClick={store.exportPending}>Export unsaved changes</button>
                    <button onClick={store.discard}>Discard pending edit</button>
                  </>
                )}
              </div>
            </section>
          )}
          {migrationRequired ? (
            <section className="card">
              <h1>Reload required</h1>
              <p>
                A newer tab upgraded the local database. This older tab has stopped writing to
                protect your data. Export any pending edit before reloading.
              </p>
              {pending && <button onClick={store.exportPending}>Export unsaved changes</button>}
              <button onClick={() => location.reload()}>Reload compatible app</button>
            </section>
          ) : !snapshot ? (
            <section className="card">
              <h1>Opening your planner</h1>
              <p>
                {error
                  ? 'Browser storage is unavailable. Resolve the error above before recording attendance.'
                  : 'Reading this browser’s local records...'}
              </p>
            </section>
          ) : !configured ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">WELCOME TO YOUR PERSONAL PLANNER</p>
                  <h1>Make office days work for you.</h1>
                  <p className="muted">
                    Set a policy, track your days, and see a workable path ahead.
                  </p>
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
                    <p>Use the navigation to return to your planner.</p>
                    <NavLink to="/dashboard">Go to Dashboard</NavLink>
                  </section>
                }
              />
            </Routes>
          )}
        </main>
        <footer>
          <PWAStatus />
          <p>
            Advisory planning, not employer-certified compliance.{' '}
            <NavLink to="/settings">Policy assumptions & backups</NavLink>
          </p>
        </footer>
      </div>
    </div>
  );
}
