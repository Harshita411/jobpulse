import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { api, setSessionCsrf } from './api.js';
import { ErrorNotice, Loading } from './components.jsx';

const Context = createContext(null);
export const useAuth = () => useContext(Context);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expired, setExpired] = useState(false);
  const channel = useRef(null);
  const generation = useRef(0);
  const apply = useCallback(value => { setSessionCsrf(value?.csrfToken || null); setSession(value); }, []);
  const restore = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError(null);
    try { const value = await api.session(); if (request === generation.current) apply(value); }
    catch (failure) { if (request === generation.current) { apply(null); if (failure.status !== 401) setError(failure); } }
    finally { if (request === generation.current) setLoading(false); }
  }, [apply]);
  useEffect(() => {
    void restore();
    const expire = () => { generation.current += 1; apply(null); setLoading(false); setExpired(true); };
    window.addEventListener('jobpulse-session-expired', expire);
    if ('BroadcastChannel' in window) {
      channel.current = new BroadcastChannel('jobpulse-auth');
      channel.current.onmessage = () => void restore();
    }
    // Also restore when returning to a tab, including browsers without BroadcastChannel.
    const visible = () => { if (document.visibilityState === 'visible') void restore(); };
    document.addEventListener('visibilitychange', visible);
    return () => { generation.current += 1; window.removeEventListener('jobpulse-session-expired', expire); document.removeEventListener('visibilitychange', visible); channel.current?.close(); channel.current = null; };
  }, [apply, restore]);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => { apply(null); setExpired(true); }, Math.max(0, new Date(session.expiresAt).getTime() - Date.now()));
    return () => clearTimeout(timer);
  }, [session, apply]);
  async function signIn(data, register = false) {
    generation.current += 1;
    const value = await (register ? api.register(data) : api.login(data));
    generation.current += 1;
    apply(value); setExpired(false); setError(null); setLoading(false);
    channel.current?.postMessage('changed');
  }
  async function logout() {
    try { await api.logout(); } catch (failure) { if (failure.status !== 401) throw failure; }
    generation.current += 1;
    apply(null); setExpired(false); channel.current?.postMessage('changed');
  }
  return <Context.Provider value={{ user: session?.user, loading, error, expired, restore, signIn, logout }}>{children}</Context.Provider>;
}

export function Protected() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading) return <Loading label="Getting things ready…" />;
  if (auth.error) return <div className="auth-restore-error"><ErrorNotice error={auth.error} retry={auth.restore} /></div>;
  if (!auth.user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  // Account changes unmount every private page, including its cached resource state.
  return <Fragment key={auth.user.id}><Outlet /></Fragment>;
}
