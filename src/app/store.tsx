import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
import { type User } from '../data/account-schema';
import { type PlannerRepository } from '../data/model';
import { RemoteRepository } from '../data/remote-repository';

const db = new PlannerDB();
export const localRepository = new Repository(db);
type Store = {
  isAccount: boolean;
  storageLabel: string;
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

export function StoreProvider({
  children,
  account,
}: {
  children: ReactNode;
  account: User | null;
}) {
  const repository = useMemo<PlannerRepository>(
    () => (account ? new RemoteRepository(account.id) : localRepository),
    [account],
  );
  const [snapshot, setSnapshot] = useState<StoredSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const [saving, setSaving] = useState(false);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [undoStack, setUndoStack] = useState<EditAction[]>([]);
  const [watchKey, setWatchKey] = useState(0);
  const busy = useRef(false);
  const pendingAction = useRef<Action | null>(null);
  const readVersion = useRef(0);
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
    if (account) {
      let active = true;
      let reading = false;
      const refresh = async () => {
        if (reading || busy.current || pendingAction.current) return;
        reading = true;
        const version = readVersion.current;
        try {
          const value = await repository.read();
          if (!active || version !== readVersion.current) return;
          setSnapshot((previous) => {
            if (previous && previous.revision > value.revision) return previous;
            if (previous && previous.generation !== value.generation) setUndoStack([]);
            return value;
          });
          setError(null);
        } catch (cause) {
          if (active && version === readVersion.current)
            setError(cause instanceof Error ? cause.message : 'Unable to read account storage.');
        } finally {
          reading = false;
        }
      };
      const onFocus = () => {
        void refresh();
      };
      void refresh();
      const timer = setInterval(onFocus, 30000);
      window.addEventListener('focus', onFocus);
      window.addEventListener('online', onFocus);
      return () => {
        active = false;
        clearInterval(timer);
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('online', onFocus);
      };
    }
    const subscription = liveQuery(() => repository.read()).subscribe({
      next: (value) => {
        setSnapshot((previous) => {
          if (previous && previous.generation !== value.generation) setUndoStack([]);
          return value;
        });
      },
      error: () =>
        setError(
          'Cannot read browser storage. Close older tabs, check browser storage settings, then retry. Saved status is unknown.',
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
  }, [watchKey, repository, account]);

  const perform = useCallback(
    async (action: Action, isUndo = false) => {
      if (busy.current || migrationRequired) return false;
      busy.current = true;
      readVersion.current++;
      pendingAction.current = action;
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
        pendingAction.current = null;
        setPending(null);
        return true;
      } catch (cause) {
        if (committed) {
          pendingAction.current = null;
          setPending(null);
          setError(
            'The write committed, but storage could not be reloaded. Retry storage to refresh the saved data before making more edits. Do not repeat the original action.',
          );
          return false;
        }
        setError(
          cause instanceof Error
            ? `${account ? 'Save not confirmed.' : 'Not saved.'} ${cause.name === 'QuotaExceededError' ? 'Browser storage is full. Free space, retry, or export your unsaved changes.' : cause.message}`
            : 'Save not confirmed. Storage failed. Retry or export your pending changes.',
        );
        return false;
      } finally {
        busy.current = false;
        setSaving(false);
      }
    },
    [migrationRequired, repository, account],
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
        isAccount: !!account,
        storageLabel: account ? 'to your account' : 'in this browser',
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
          pendingAction.current = null;
          setPending(null);
          setError(null);
          setWatchKey((value) => value + 1);
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
