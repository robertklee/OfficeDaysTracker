import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../data/api';
import { sessionSchema, type User } from '../data/account-schema';
import { StoreProvider } from './store';

type Account = {
  user: User | null;
  busy: boolean;
  error: string | null;
  authenticate: (
    mode: 'signup' | 'login',
    input: { username: string; password: string; displayName?: string },
  ) => Promise<boolean>;
  logout: () => Promise<boolean>;
  refresh: () => Promise<void>;
};
const Context = createContext<Account | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const epoch = useRef(0);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    const requestEpoch = ++epoch.current;
    setBusy(true);
    try {
      const result = await api('/session', sessionSchema);
      if (requestEpoch !== epoch.current) return;
      setUser(result.user);
      setWorkspace((value) => value + 1);
      setError(null);
    } catch (cause) {
      if (requestEpoch === epoch.current)
        setError(cause instanceof Error ? cause.message : 'Unable to check your account session.');
    } finally {
      if (requestEpoch === epoch.current) {
        setReady(true);
        setBusy(false);
      }
    }
  }, []);

  useEffect(() => {
    const events = new BroadcastChannel('rto-planner-account');
    channel.current = events;
    events.onmessage = () => {
      epoch.current++;
      setUser(null);
      setWorkspace((value) => value + 1);
      setReady(true);
      setBusy(false);
      setError(
        'The account changed in another tab. Account data was cleared from this tab. Check your account session to continue.',
      );
    };
    void refresh();
    return () => {
      epoch.current++;
      events.close();
      channel.current = null;
    };
  }, [refresh]);

  async function change(path: string, body: unknown): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    const requestEpoch = ++epoch.current;
    setBusy(true);
    setError(null);
    try {
      const result = await api(path, sessionSchema, { body, accountId: user?.id });
      if (requestEpoch !== epoch.current) return false;
      setUser(result.user);
      setWorkspace((value) => value + 1);
      channel.current?.postMessage('account-changed');
      return true;
    } catch (cause) {
      if (requestEpoch === epoch.current)
        setError(cause instanceof Error ? cause.message : 'The account request failed.');
      return false;
    } finally {
      inFlight.current = false;
      if (requestEpoch === epoch.current) setBusy(false);
    }
  }

  return (
    <Context.Provider
      value={{
        user,
        busy,
        error,
        refresh,
        authenticate: (mode, input) => change(`/auth/${mode}`, input),
        logout: () => change('/auth/logout', {}),
      }}
    >
      {ready ? (
        <StoreProvider key={`${user?.id ?? 'guest'}:${workspace}`} account={user}>
          {children}
        </StoreProvider>
      ) : (
        <main className="fatal">
          <h1>Opening your planner</h1>
          <p>Checking your account session...</p>
        </main>
      )}
    </Context.Provider>
  );
}

export function useAccount(): Account {
  const account = useContext(Context);
  if (!account) throw new Error('AccountProvider is required.');
  return account;
}
