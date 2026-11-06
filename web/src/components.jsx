import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, Check, Copy, FileSpreadsheet, Inbox, LoaderCircle, RefreshCw, Terminal } from 'lucide-react';
import { useState } from 'react';

export const number = value => new Intl.NumberFormat().format(value ?? 0);
export const date = value => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
export const typeLabel = value => value === 'csv-import' ? 'CSV import' : value === 'simulation' ? 'Simulation' : value || 'Unknown';
export const isTerminal = state => ['completed', 'failed'].includes(state);

export function Status({ state }) {
  return <span className={`status status-${state}`}><span className="status-dot" />{state === 'waiting-children' ? 'Waiting for children' : state === 'delayed' ? 'Delayed retry' : state}</span>;
}
export function TypeIcon({ type }) {
  return <span className={`type-icon ${type === 'csv-import' ? 'csv' : 'sim'}`}>{type === 'csv-import' ? <FileSpreadsheet size={18} /> : <Terminal size={18} />}</span>;
}
export function PageTitle({ eyebrow = 'WORKSPACE', title, description, children }) {
  return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div><div className="page-actions">{children}</div></div>;
}
export function Refresh({ onClick, busy }) {
  return <button className="button secondary" onClick={onClick} disabled={busy}><RefreshCw size={15} className={busy ? 'spin' : ''} />Refresh</button>;
}
export function ErrorNotice({ error, retry }) {
  if (!error) return null;
  const title = error.status === 404 && error.resource === 'job' ? 'We couldn’t find that job'
    : error.status === 404 && error.resource === 'import' ? 'We couldn’t find that import'
      : error.resource === 'account' && error.status === 404 ? 'Unable to connect to your account' : 'Something needs attention';
  return <div className="notice error" role="alert"><AlertCircle size={19} /><div><strong>{title}</strong><p>{error.message}</p></div>{retry && <button className="text-button" onClick={retry}>Try again</button>}</div>;
}
export function Loading({ label = 'Loading…' }) {
  return <div className="loading" role="status"><LoaderCircle className="spin" size={23} /><span>{label}</span></div>;
}
export function Empty({ title = 'No jobs yet', description = 'Submit a job to get started.', action = true }) {
  return <div className="empty"><div className="empty-icon"><Inbox size={26} /></div><h3>{title}</h3><p>{description}</p>{action && <Link className="button primary" to="/submit">Submit a job <ArrowRight size={15} /></Link>}</div>;
}
export function Progress({ job, compact = false }) {
  const counts = typeof job.progress === 'object' && job.progress ? job.progress : null;
  if (counts) {
    const processed = counts.processed ?? 0;
    return <div className={`progress-content ${compact ? 'compact' : ''}`}><div className="progress-label"><span>{number(processed)} rows processed</span>{!compact && <span>{number(counts.rejected)} rejected</span>}</div>
      <div className="progress-track" role="img" aria-label={`${processed} processed, ${counts.accepted ?? 0} accepted, ${counts.rejected ?? 0} rejected; total input rows not yet known`}><span className="accepted-fill" style={{ width: `${processed ? (counts.accepted ?? 0) / processed * 100 : 0}%` }} /><span className="rejected-fill" style={{ width: `${processed ? (counts.rejected ?? 0) / processed * 100 : 0}%` }} /></div></div>;
  }
  const percent = Math.max(0, Math.min(100, Number(job.progress) || 0));
  return <div className={`progress-content ${compact ? 'compact' : ''}`}><div className="progress-label"><span>{job.type === 'csv-import' ? 'Waiting for row updates' : `${percent}%`}</span></div><div className="progress-track" role="progressbar" aria-label="Task progress" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percent}%` }} /></div></div>;
}
export function JobsTable({ jobs }) {
  return <div className="table-scroll" role="region" aria-label="Jobs table" tabIndex={0}><table><thead><tr><th>Job</th><th>Status</th><th>Progress</th><th>Created</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{jobs.map(job => <tr key={job.jobId}><td><div className="job-cell"><TypeIcon type={job.type} /><div><Link className="job-title" to={`/jobs/${job.jobId}`}>{typeLabel(job.type)}</Link><span className="mono small-id" title={job.jobId}>{job.jobId.slice(0, 12)}…</span></div></div></td><td><Status state={job.state} /></td><td className="progress-cell"><Progress job={job} compact /></td><td className="table-date">{date(job.createdAt)}</td><td><Link className="icon-button" to={`/jobs/${job.jobId}`} aria-label={`View job ${job.jobId}`}><ArrowRight size={17} /></Link></td></tr>)}</tbody></table></div>;
}
export function Pagination({ page, pageSize, total, setPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="pagination"><span>{total ? `${number((page - 1) * pageSize + 1)}–${number(Math.min(page * pageSize, total))} of ${number(total)} jobs` : '0 matching jobs'}</span><div><button className="button secondary small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button className="button secondary small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div></div>;
}
export function CopyId({ id }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return <div className="copy-id"><code>{id}</code><button className="icon-button" aria-label="Copy job ID" onClick={async () => { try { await navigator.clipboard.writeText(id); setCopied(true); setFailed(false); } catch { setFailed(true); } }}>{copied ? <Check size={17} /> : <Copy size={17} />}</button><span className="sr-only" role="status">{copied ? 'Job ID copied' : failed ? 'Could not copy; select the ID manually' : ''}</span></div>;
}
export function WindowNotice({ data }) {
  return data?.truncated ? <div className="notice warning" role="status">Some older jobs are not shown in this view.</div> : null;
}
