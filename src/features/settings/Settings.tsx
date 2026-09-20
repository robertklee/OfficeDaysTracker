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
      <h2>Backups & {isAccount ? 'account' : 'local'} data</h2>
      <p>
        {isAccount
          ? 'Your records are saved in your account in Cloudflare D1.'
          : 'Your records stay in this browser on this origin.'}{' '}
        JSON is a complete backup; CSV contains attendance only and cannot restore settings.
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
          Review JSON import
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
        Import limit: 5 MB. Only RTO Planner web backups are supported. Native app imports and
        timezone guessing are intentionally not supported.
        {isAccount &&
          ' Account storage is limited to 1.5 MB including revision and undo metadata; larger imports will be rejected without changing saved data.'}
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
        <Dialog title="Review replacement backup" onClose={() => setReview(null)}>
          <p>
            <strong>{review.dataset.records.length} attendance entries</strong>,{' '}
            {review.dataset.records.filter((entry) => entry.priority === 'must').length} protected
            days, {review.dataset.policy?.kind ?? 'no confirmed'} policy, and weekend preference
            will replace all {snapshot.dataset.records.length} current entries.
          </p>
          <p>
            This replacement is atomic and cannot be undone. Download a pre-replacement backup
            first.{' '}
            {isAccount
              ? 'Other devices receive the replacement when they refresh.'
              : 'Other open tabs will receive the replacement.'}
          </p>
          {review.revision !== snapshot.revision && (
            <p role="alert" className="error">
              Stored data changed after import review. Cancel and review the file again.
            </p>
          )}
          <div className="button-row">
            <button onClick={exportJSON}>Download pre-replacement backup</button>
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
            This deletes all attendance, priorities, policy and preferences{' '}
            {isAccount
              ? 'in your account, on every device. Your account and the separate local planner are retained'
              : 'on this origin'}
            . Export a backup first. This cannot be undone.
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
      setStorageMessage(
        'Persistent storage requests are not supported here. Keep regular JSON backups.',
      );
      return;
    }
    try {
      const granted = await navigator.storage.persist();
      setStorageMessage(
        granted
          ? 'Persistent storage granted. This reduces eviction risk but does not replace backups.'
          : 'The browser did not grant persistent storage. Data still saves locally; keep regular backups.',
      );
    } catch {
      setStorageMessage(
        'Unable to request persistent storage. Check browser permissions and keep a JSON backup.',
      );
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MAKE IT YOURS</p>
          <h1>Settings & backups</h1>
          <p className="muted">An explicit policy. Data you control.</p>
        </div>
      </div>
      <section className="card">
        <h2>Attendance policy</h2>
        <p>
          Review any changes before applying. Settings affect all recorded history; historical
          policy versions are not retained.
        </p>
        <PolicyForm />
      </section>
      <BackupSettings />
      <section className="card">
        <h2>Browser storage & privacy</h2>
        <p>
          No tracking scripts. In local mode attendance stays in your browser. In account mode,
          attendance, notes and settings are sent to the same-origin API and stored in Cloudflare
          D1. They are not end-to-end encrypted or kept in an offline account cache. Cloudflare also
          receives ordinary hosting request metadata; visits are not invisible.
        </p>
        <p>
          Clearing site data, private browsing, browser eviction, or changing browsers can remove or
          separate your records. Production, preview, pages.dev, and custom-domain addresses have
          independent storage. Move data with JSON export/import.
        </p>
        {!isAccount && (
          <button onClick={() => void requestPersistence()}>
            Request persistent browser storage
          </button>
        )}
        <p role="status">{storageMessage}</p>
        <h3>Reminders, not background notifications</h3>
        <p>
          While this app is open, the Dashboard highlights unconfirmed past plans and upcoming gaps.
          There are no scheduled notifications after the tab is closed.
        </p>
      </section>
    </>
  );
}
