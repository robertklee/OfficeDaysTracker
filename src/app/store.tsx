import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { liveQuery } from 'dexie';
import { dateInZone } from '../domain/dates';
import { type Dataset, type EntryInput } from '../domain/schema';
import {
  type Action,
  type EditAction,
  type StoredSnapshot,
  PlannerDB,
  Repository,
  advanceUndoStack,
  editAction,
} from '../data/repository';
import { download, serializeBackup } from '../features/backup/backup';
import { useDraftWarning } from './useDraftWarning';

const db = new PlannerDB();
const repository = new Repository(db);
type Store = {
  snapshot: StoredSnapshot | null;
  today: string;
  timeZone: string;
  saving: boolean;
  error: string | null;
  pending: Action | null;
  migrationRequired: boolean;
  undoAvailable: boolean;
  perform: (action: Action, isUndo?: boolean) => Promise<boolean>;
  edit: (values: { date: string; value: EntryInput | null }[]) => Promise<boolean>;
  undo: () => Promise<void>;
  retry: () => void;
  discard: () => void;
  exportPending: () => void;
};
const Context = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<StoredSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const [saving, setSaving] = useState(false);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [undoStack, setUndoStack] = useState<EditAction[]>([]);
  const [watchKey, setWatchKey] = useState(0);
  const busy = useRef(false);
  const pendingUndo = useRef(false);
  const [instant, setInstant] = useState(() => new Date().toISOString());
  const timeZone =
    snapshot?.dataset.policy?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = dateInZone(instant, timeZone);
  useDraftWarning(saving || !!pending);

  useEffect(() => {
    const tick = () => setInstant(new Date().toISOString());
    const timer = setInterval(tick, 15000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  useEffect(() => {
    const subscription = liveQuery(() => repository.read()).subscribe({
      next: (value) => {
        setSnapshot((previous) => {
          if (previous && previous.generation !== value.generation) setUndoStack([]);
          return value;
        });
      },
      error: () =>
        setError(
          'Unable to read browser storage. Close older tabs and retry. Check private-browsing or storage restrictions; no saved status can be confirmed.',
        ),
    });
    const versionChange = () => {
      db.close();
      setMigrationRequired(true);
    };
    const blocked = () =>
      setError(
        'A database upgrade is blocked by an older tab. Close other RTO Planner tabs, then retry. Existing data is retained.',
      );
    db.on('versionchange', versionChange);
    db.on('blocked', blocked);
    return () => {
      subscription.unsubscribe();
      db.on('versionchange').unsubscribe(versionChange);
      db.on('blocked').unsubscribe(blocked);
    };
  }, [watchKey]);

  const perform = useCallback(
    async (action: Action, isUndo = false) => {
      if (busy.current || migrationRequired) return false;
      busy.current = true;
      pendingUndo.current = isUndo;
      setSaving(true);
      setError(null);
      setPending(action);
      let committed = false;
      try {
        const inverse = await repository.perform(action);
        committed = true;
        setUndoStack((stack) => {
          if (isUndo && action.type === 'edit') return advanceUndoStack(stack, action, inverse);
          return action.type === 'replace' ? [] : inverse ? [...stack, inverse].slice(-30) : stack;
        });
        setSnapshot(await repository.read());
        setPending(null);
        return true;
      } catch (cause) {
        if (committed) {
          setPending(null);
          setError(
            'The write committed, but browser storage could not be reloaded. Retry storage to refresh the saved data before making more edits. Do not repeat the original action.',
          );
          return false;
        }
        setError(
          cause instanceof Error
            ? `Not saved. ${cause.name === 'QuotaExceededError' ? 'Browser storage is full. Free space, retry, or export your unsaved changes.' : cause.message}`
            : 'Not saved. Browser storage failed. Retry or export your unsaved changes.',
        );
        return false;
      } finally {
        busy.current = false;
        setSaving(false);
      }
    },
    [migrationRequired],
  );

  const edit = async (values: { date: string; value: EntryInput | null }[]) =>
    snapshot && !pending ? perform(editAction(snapshot, values)) : false;
  const undo = async () => {
    const action = undoStack.at(-1);
    if (action && !pending) await perform(action, true);
  };
  const retry = () => {
    if (pending) void perform(pending, pendingUndo.current);
    else {
      setError(null);
      setWatchKey((value) => value + 1);
    }
  };
  const exportPending = () => {
    if (!snapshot || !pending) return;
    let dataset: Dataset = snapshot.dataset;
    if (pending.type === 'replace') dataset = pending.dataset;
    else if (pending.type === 'settings')
      dataset = { ...dataset, policy: pending.policy, preferences: pending.preferences };
    else {
      const records = new Map(dataset.records.map((entry) => [entry.date, entry]));
      for (const change of pending.changes) {
        if (!change.value) records.delete(change.date);
        else
          records.set(change.date, {
            ...change.value,
            revision: (records.get(change.date)?.revision ?? 0) + 1,
            createdAt: change.restoreCreatedAt ?? records.get(change.date)?.createdAt ?? instant,
            updatedAt: instant,
          });
      }
      dataset = { ...dataset, records: [...records.values()] };
    }
    download(serializeBackup(dataset), 'rto-unsaved-recovery.json');
  };
  return (
    <Context.Provider
      value={{
        snapshot,
        today,
        timeZone,
        saving,
        error,
        pending,
        migrationRequired,
        undoAvailable: undoStack.length > 0,
        perform,
        edit,
        undo,
        retry,
        exportPending,
        discard: () => {
          setPending(null);
          setError(null);
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useStore(): Store {
  const store = useContext(Context);
  if (!store) throw new Error('StoreProvider is required.');
  return store;
}
