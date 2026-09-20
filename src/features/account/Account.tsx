import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../../app/account';
import { localRepository, useStore } from '../../app/store';
import { useDraftWarning } from '../../app/useDraftWarning';
import { Dialog } from '../../components/Dialog';
import { loginSchema, signupSchema } from '../../data/account-schema';
import { type Dataset } from '../../domain/schema';
import { download, serializeBackup } from '../backup/backup';

export function Account() {
  const account = useAccount();
  const store = useStore();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [signout, setSignout] = useState(false);
  const [review, setReview] = useState<{ dataset: Dataset; revision: number } | null>(null);
  const blocked = account.busy || store.saving || !!store.pending;
  useDraftWarning(!!password);

  async function reviewLocal() {
    setError('');
    try {
      const local = await localRepository.read();
      if (!store.snapshot) throw new Error('Load account storage before importing.');
      setReview({ dataset: local.dataset, revision: store.snapshot.revision });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to read the local planner.');
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR PLANNER, YOUR CHOICE</p>
          <h1>Account</h1>
          <p className="muted">Keep a local planner, or save a separate planner across devices.</p>
        </div>
      </div>
      <section className="card">
        {account.user ? (
          <>
            <h2>Signed in as {account.user.displayName}</h2>
            <p>
              Username: <strong>{account.user.username}</strong>
            </p>
            <p>
              Account attendance, notes, policy and preferences are saved to Cloudflare D1. Account
              storage requires an internet connection. It is not cached in this browser. Signing out
              clears this account workspace and returns to your untouched local planner.
            </p>
            <div className="button-row">
              <Link className="button primary" to="/dashboard">
                Open account planner
              </Link>
              <button disabled={blocked} onClick={() => setSignout(true)}>
                Sign out
              </button>
            </div>
            <h3 className="subtle">Bring your local planner</h3>
            <p>
              Nothing is uploaded automatically. Review an import to replace the account planner
              with this browser&apos;s local data, or import a JSON backup in Settings. The local
              original is retained. Account storage has a 1.5 MB limit including revision and undo
              metadata.
            </p>
            <button
              disabled={blocked || !store.snapshot || !!store.error}
              onClick={() => void reviewLocal()}
            >
              Review local data import
            </button>
          </>
        ) : (
          <>
            <h2>{mode === 'login' ? 'Sign in to your account' : 'Create your account'}</h2>
            <p>
              You are using the local planner. Creating an account starts a separate, empty planner;
              it does not upload or erase local records. Finish edits before switching workspaces.
            </p>
            <div className="button-row" role="group" aria-label="Account form">
              <button
                aria-pressed={mode === 'login'}
                disabled={blocked}
                onClick={() => {
                  setMode('login');
                  setPassword('');
                  setError('');
                }}
              >
                Sign in
              </button>
              <button
                aria-pressed={mode === 'signup'}
                disabled={blocked}
                onClick={() => {
                  setMode('signup');
                  setPassword('');
                  setError('');
                }}
              >
                Create account
              </button>
            </div>
            <form
              className="account-form"
              aria-label="Account credentials"
              onSubmit={async (event) => {
                event.preventDefault();
                if (blocked) return;
                setError('');
                const input =
                  mode === 'signup' ? { username, password, displayName } : { username, password };
                const parsed = (mode === 'signup' ? signupSchema : loginSchema).safeParse(input);
                if (!parsed.success) {
                  setError(parsed.error.issues.map((issue) => issue.message).join(' '));
                  return;
                }
                if (await account.authenticate(mode, parsed.data)) setPassword('');
              }}
            >
              <label>
                Username
                <input
                  name="username"
                  value={username}
                  autoComplete="username"
                  minLength={3}
                  maxLength={30}
                  required
                  pattern="[A-Za-z0-9_]{3,30}"
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              {mode === 'signup' && (
                <label>
                  Display name
                  <input
                    name="displayName"
                    value={displayName}
                    autoComplete="nickname"
                    maxLength={60}
                    required
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </label>
              )}
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  value={password}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  minLength={12}
                  maxLength={200}
                  required
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <p className="muted">
                Use 12-200 characters. Keep your password in a password manager; password recovery
                is not available.
              </p>
              <button className="primary" disabled={blocked} type="submit">
                {account.busy ? 'Please wait...' : mode === 'signup' ? 'Create account' : 'Sign in'}
              </button>
            </form>
            <button className="subtle" disabled={blocked} onClick={() => void account.refresh()}>
              Check account session
            </button>
          </>
        )}
        {(error || account.error) && (
          <p role="alert" className="error subtle">
            {error || account.error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </section>
      <section className="card">
        <h2>Account limits & privacy</h2>
        <p>
          No email is collected. Password recovery, email verification, MFA, password changes and
          self-service account deletion are not available. A forgotten password cannot be recovered.
          Keep JSON backups. Do not use this account for data that requires those protections.
        </p>
        <p>
          There are no analytics. In local mode attendance stays on this origin in your browser.
          Account mode sends it to the same-origin account API and stores it in Cloudflare D1; it is
          not end-to-end encrypted. Sessions expire after 30 days. Settings can erase account
          planner data, but that does not delete your account.
        </p>
      </section>
      {signout && (
        <Dialog title="Sign out?" onClose={() => !account.busy && setSignout(false)}>
          <p>
            Saved account data stays in D1. Unfinished drafts will be discarded. This clears the
            account workspace in all open tabs and restores the local planner.
          </p>
          <div className="button-row">
            <button
              className="primary"
              disabled={blocked}
              onClick={async () => {
                if (await account.logout()) setSignout(false);
              }}
            >
              Confirm sign out
            </button>
            <button disabled={account.busy} onClick={() => setSignout(false)}>
              Cancel
            </button>
          </div>
          {account.error && (
            <p role="alert" className="error">
              {account.error}
            </p>
          )}
        </Dialog>
      )}
      {review && (
        <Dialog title="Import local planner?" onClose={() => !store.saving && setReview(null)}>
          <p>
            Upload {review.dataset.records.length} attendance entries,{' '}
            {review.dataset.policy?.kind ?? 'no confirmed'} policy, and preferences. This replaces
            all {store.snapshot?.dataset.records.length ?? 0} account entries. It cannot be undone.
            The local planner is not changed.
          </p>
          <div className="button-row">
            <button
              onClick={() =>
                store.snapshot &&
                download(serializeBackup(store.snapshot.dataset), 'rto-account-before-import.json')
              }
            >
              Download account backup first
            </button>
            <button
              className="danger"
              disabled={blocked || !!store.error || store.snapshot?.revision !== review.revision}
              onClick={async () => {
                if (
                  await store.perform({
                    type: 'replace',
                    expectedRevision: review.revision,
                    dataset: review.dataset,
                  })
                ) {
                  setReview(null);
                  setMessage(
                    'Local planner imported into your account. The local original is unchanged.',
                  );
                }
              }}
            >
              Import into account
            </button>
            <button disabled={store.saving} onClick={() => setReview(null)}>
              Cancel
            </button>
          </div>
          {store.snapshot?.revision !== review.revision && (
            <p role="alert">Account data changed. Cancel and review the import again.</p>
          )}
          {store.error && (
            <p role="alert" className="error">
              {store.error}
            </p>
          )}
        </Dialog>
      )}
    </>
  );
}
