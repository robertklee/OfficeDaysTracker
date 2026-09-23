import { useState, type ChangeEvent } from 'react';
import { useStore } from '../../app/store';
import { Dialog } from '../../components/Dialog';
import { PolicyForm } from '../../components/PolicyForm';
import { emptyDataset, type Dataset } from '../../domain/schema';
import {
  attendanceCSV,
  download,
  MAX_BACKUP_BYTES,
  parseBackup,
  serializeBackup,
} from '../backup/backup';

export function BackupSettings() {
  const {
    snapshot,
    perform,
    saving,
    pending,
    isAccount,
    storageLabel,
    error: storageError,
  } = useStore();
  const [review, setReview] = useState<{ dataset: Dataset; revision: number } | null>(null);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  if (!snapshot) return null;
  const blocked = saving || !!pending || !!storageError;
  const exportJSON = () => download(serializeBackup(snapshot.dataset), 'rto-planner-backup.json');
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setMessage('');
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 5 MB limit.');
      const dataset = parseBackup(await file.text(), file.size);
      setReview({ dataset, revision: snapshot!.revision });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to read this backup. Existing data is unchanged.',
      );
    }
  }
  return (
    <section className="card">
      <h2>Backups</h2>
      <p>
        {isAccount ? 'Saved to your account.' : 'Saved in this browser.'} JSON backs up everything.
        CSV exports attendance only.
      </p>
      <div className="button-row">
        <button onClick={exportJSON}>Export JSON backup</button>
        <button
          onClick={() =>
            download(
              attendanceCSV(snapshot.dataset),
              'rto-attendance.csv',
              'text/csv;charset=utf-8',
            )
          }
        >
          Export attendance CSV
        </button>
        <label className="button file-button">
          Import backup
          <input
            aria-label="Import JSON backup"
            type="file"
            accept=".json,application/json"
            disabled={blocked}
            onChange={(event) => void importFile(event)}
          />
        </label>
      </div>
      <p className="muted">
        RTO Planner web backups only, up to 5 MB.
        {isAccount && ' Accounts have a 1.5 MB storage limit, including undo history.'}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <button
        className="danger subtle"
        disabled={blocked}
        onClick={() => {
          setDeleteText('');
          setDeleteDialog(true);
        }}
      >
        Delete all {isAccount ? 'account planner' : 'local'} data
      </button>
      {review && (
        <Dialog title="Restore backup?" onClose={() => setReview(null)}>
          <p>
            Replace your saved days and settings with{' '}
            <strong>
              {review.dataset.records.length} {review.dataset.records.length === 1 ? 'day' : 'days'}
            </strong>{' '}
            and the settings in this backup.
          </p>
          <p>
            This cannot be undone. Back up your current data first.{' '}
            {isAccount
              ? 'The change applies across your devices.'
              : 'The change applies to all open tabs.'}
          </p>
          {review.revision !== snapshot.revision && (
            <p role="alert" className="error">
              Your data changed. Cancel and import the file again.
            </p>
          )}
          <div className="button-row">
            <button onClick={exportJSON}>Back up current data</button>
            <button
              className="danger"
              disabled={blocked || review.revision !== snapshot.revision}
              onClick={async () => {
                if (
                  await perform({
                    type: 'replace',
                    expectedRevision: review.revision,
                    dataset: review.dataset,
                  })
                ) {
                  setReview(null);
                  setMessage(`Backup restored ${storageLabel}.`);
                }
              }}
            >
              Confirm replacement
            </button>
            <button onClick={() => setReview(null)}>Cancel</button>
          </div>
        </Dialog>
      )}
      {deleteDialog && (
        <Dialog
          title={`Delete all ${isAccount ? 'account planner' : 'local'} data?`}
          onClose={() => setDeleteDialog(false)}
        >
          <p>
            Delete all saved days and settings{' '}
            {isAccount
              ? 'in your account, on every device. Your account and local planner stay'
              : 'in this browser'}
            . This cannot be undone.
          </p>
          <label>
            Type DELETE to confirm
            <input
              value={deleteText}
              onChange={(event) => setDeleteText(event.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="button-row">
            <button onClick={exportJSON}>Export before deleting</button>
            <button
              className="danger"
              disabled={deleteText !== 'DELETE' || blocked}
              onClick={async () => {
                if (
                  await perform({
                    type: 'replace',
                    expectedRevision: snapshot.revision,
                    dataset: emptyDataset(),
                  })
                )
                  setDeleteDialog(false);
              }}
            >
              Permanently delete {isAccount ? 'account planner' : 'local'} data
            </button>
            <button onClick={() => setDeleteDialog(false)}>Cancel</button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

export function Settings() {
  const { isAccount } = useStore();
  const [storageMessage, setStorageMessage] = useState('');
  async function requestPersistence() {
    if (!navigator.storage?.persist) {
      setStorageMessage('This browser does not support storage protection. Keep regular backups.');
      return;
    }
    try {
      const granted = await navigator.storage.persist();
      setStorageMessage(
        granted
          ? 'Storage protection is on. Keep backups too.'
          : 'Storage protection was not granted. Your data still saves here; keep backups.',
      );
    } catch {
      setStorageMessage('Could not protect storage. Check browser permissions and keep a backup.');
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Settings</h1>
          <p className="muted">Your office policy and saved data.</p>
        </div>
      </div>
      <section className="card">
        <h2>Attendance policy</h2>
        <p>Policy changes apply to past records too.</p>
        <PolicyForm />
      </section>
      <BackupSettings />
      <section className="card">
        <h2>Storage & privacy</h2>
        <p>
          No analytics. Local data stays in your browser. Account data is stored in Cloudflare D1,
          requires internet access, and is not end-to-end encrypted. Cloudflare receives hosting
          request metadata.
        </p>
        <p>
          Clearing browser data or using private browsing can lose local records. Different browsers
          and site addresses have separate storage. Use a JSON backup to move your data.
        </p>
        {!isAccount && (
          <button onClick={() => void requestPersistence()}>Protect browser storage</button>
        )}
        <p role="status">{storageMessage}</p>
        <h3>Reminders</h3>
        <p>
          Past plans are flagged on This week. There are no notifications when the app is closed.
        </p>
      </section>
    </>
  );
}
