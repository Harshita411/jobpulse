import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Activity, ArrowRight, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useAuth } from '../Auth.jsx';
import { ErrorNotice, Loading } from '../components.jsx';

export default function AuthPage({ register = false }) {
  const auth = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const from = location.state?.from;
  const destination = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/';
  if (auth.loading) return <Loading label="Getting things ready…" />;
  if (auth.user) return <Navigate to={destination} replace />;
  async function submit(event) {
    event.preventDefault(); setError(null);
    if ([...password].length < 12 || new TextEncoder().encode(password).length > 72) { setError(new Error('Use at least 12 characters and at most 72 UTF-8 bytes for your password.')); return; }
    setPending(true);
    try { await auth.signIn({ email, password }, register); setPassword(''); }
    catch (failure) { setError(failure); }
    finally { setPending(false); }
  }
  return <main className="auth-page"><section className="auth-story"><Link className="brand" to="/login"><span className="brand-mark"><Activity size={25} /></span>JobPulse<span className="brand-dot">.</span></Link><div><div className="eyebrow">YOUR WORK, YOUR WORKSPACE</div><h1>Your work.<br />Always in view.</h1><p>Run jobs, follow progress, and find your results in one place.</p><div className="auth-promise"><ShieldCheck size={20} />One workspace. A clearer workflow.</div></div><p className="auth-story-foot">Focus on what’s next.</p></section><section className="auth-form-pane"><div className="auth-card"><span className="auth-lock"><LockKeyhole size={23} /></span><div className="eyebrow">{register ? 'GET STARTED' : 'WELCOME TO JOBPULSE'}</div><h1>{register ? 'Create your account' : 'Welcome back'}</h1><p>{register ? 'Your next job starts here.' : 'Pick up where you left off.'}</p>
    {auth.expired && !register && <div className="notice warning" role="status">Please sign in again to continue.</div>}
    <ErrorNotice error={error || auth.error} retry={auth.error ? auth.restore : undefined} />
    <form onSubmit={submit}><label htmlFor="auth-email">Email address</label><input id="auth-email" type="email" autoComplete="username" maxLength={254} required value={email} disabled={pending} onChange={event => setEmail(event.target.value)} /><label htmlFor="auth-password">Password</label><input id="auth-password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={12} maxLength={72} required aria-describedby="password-help" value={password} disabled={pending} onChange={event => setPassword(event.target.value)} /><p id="password-help">At least 12 characters; at most 72 UTF-8 bytes.</p><button className="button primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}{pending ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button></form><p className="auth-switch">{register ? 'Already have an account?' : 'New to JobPulse?'} <Link to={register ? '/login' : '/register'} state={location.state}>{register ? 'Sign in' : 'Create an account'}</Link></p></div></section></main>;
}
