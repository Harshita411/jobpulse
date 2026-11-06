import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { Activity, ArrowUpRight, ChevronRight, FileCheck2, History, LayoutDashboard, LogOut, Menu, UploadCloud, X } from 'lucide-react';
import { useAuth } from './Auth.jsx';
import { ErrorNotice } from './components.jsx';

const navigation = [
  ['/', 'Dashboard', LayoutDashboard], ['/submit', 'Submit job', UploadCloud],
  ['/jobs', 'Job history', History], ['/results', 'Results', FileCheck2],
];
export default function Layout() {
  const [open, setOpen] = useState(false);
  const auth = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(null);
  async function logout() {
    setLoggingOut(true); setLogoutError(null);
    try { await auth.logout(); } catch (error) { setLogoutError(error); }
    finally { setLoggingOut(false); }
  }
  const location = useLocation();
  const main = useRef(null);
  function closeNavigation() {
    setOpen(false);
    document.querySelector('.mobile-menu')?.focus();
  }
  useEffect(() => {
    if (!open) return;
    document.querySelector('#navigation nav a')?.focus();
    const escape = event => { if (event.key === 'Escape') closeNavigation(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open]);
  const title = location.pathname.startsWith('/jobs/') ? 'Job details' : navigation.find(([path]) => path === location.pathname)?.[1] || 'Workspace';
  useEffect(() => { setOpen(false); document.title = `${title} · JobPulse`; main.current?.focus(); }, [location.pathname, title]);
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    {open && <button className="nav-backdrop" aria-label="Close navigation" onClick={closeNavigation} />}
    <aside className={`sidebar ${open ? 'open' : ''}`} id="navigation">
      <Link className="brand" to="/"><span className="brand-mark"><Activity size={25} /></span>JobPulse<span className="brand-dot">.</span></Link>
      <button className="mobile-close icon-button" aria-label="Close navigation" onClick={closeNavigation}><X /></button>
      <div className="nav-label">OPERATIONS</div>
      <nav aria-label="Main navigation">{navigation.map(([path, label, Icon]) => <NavLink key={path} to={path} end={path === '/'} className={({ isActive }) => `nav-link ${isActive ? 'selected' : ''}`}><Icon size={19} />{label}{label === 'Submit job' && <span className="nav-plus">+</span>}</NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-footer"><span className="avatar">JP</span><div><strong title={auth.user.email}>{auth.user.email}</strong><span>Personal workspace</span></div></div></div>
    </aside>
    <div className="workspace-main"><header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" aria-expanded={open} aria-controls="navigation" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu size={21} /></button><span>Workspace</span><ChevronRight size={14} /><strong>{title}</strong></div><div className="topbar-right"><button className="icon-button" aria-label="Sign out" title="Sign out" disabled={loggingOut} onClick={logout}><LogOut size={18} /></button><span className="topbar-divider" /><Link className="topbar-link" to="/submit">New job <ArrowUpRight size={16} /></Link></div></header>
      {logoutError && <div className="logout-notice"><ErrorNotice error={logoutError} /></div>}<main id="main-content" ref={main} tabIndex={-1}><Outlet /></main>
    </div>
  </div>;
}
