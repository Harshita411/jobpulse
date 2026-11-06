import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, FileCheck2 } from 'lucide-react';
import { api } from '../api.js';
import { useResource } from '../useResource.js';
import { date, Empty, ErrorNotice, Loading, number, PageTitle, Pagination, Refresh, typeLabel, TypeIcon, WindowNotice } from '../components.jsx';

export default function Results() {
  const [params, setParams] = useSearchParams();
  const type = params.get('type') || '';
  const resource = useResource(signal => api.jobs({ status: 'completed', type, page: params.get('page') || 1, pageSize: 9 }, signal), params.toString(), { pollMs: 5000 });
  return <>
    <PageTitle eyebrow="COMPLETED WORK" title="Results" description="Review your completed jobs and import summaries."><Refresh onClick={resource.refresh} busy={resource.refreshing} /></PageTitle>
    <ErrorNotice error={resource.error} retry={resource.refresh} />
    <div className="results-toolbar"><div className="segment-control" aria-label="Result type">{[['', 'All results'], ['csv-import', 'CSV imports'], ['simulation', 'Simulations']].map(([value, label]) => <button key={value} aria-pressed={type === value} className={type === value ? 'selected' : ''} onClick={() => setParams(value ? { type: value } : {})}>{label}</button>)}</div><span className="muted"><FileCheck2 size={16} />Completed jobs only</span></div>
    <WindowNotice data={resource.data} />{resource.loading && <Loading />}
    {resource.data && <>{resource.data.items.length ? <div className="results-grid">{resource.data.items.map(job => <article className="panel result-card" key={job.jobId}><div className="result-card-top"><TypeIcon type={job.type} /><span className="result-completed"><CheckCircle2 size={14} />Completed</span></div><h2>{typeLabel(job.type)}</h2><Link className="mono small-id" to={`/jobs/${job.jobId}`}>{job.jobId.slice(0, 16)}…</Link>{job.type === 'csv-import' && job.result ? <div className="result-counts">{['processed', 'accepted', 'rejected'].map(key => <div key={key}><strong>{number(job.result[key])}</strong><span>{key}</span></div>)}</div> : <p className="simulation-result">{job.result?.message || 'No result available.'}</p>}<div className="result-card-footer"><span>{date(job.finishedAt)}</span><Link className="icon-button" to={`/jobs/${job.jobId}`} aria-label={`View result ${job.jobId}`}><ArrowRight size={17} /></Link></div></article>)}</div> : <section className="panel"><Empty title="No completed results yet" description="Your completed jobs will appear here." /></section>}<Pagination {...resource.data} setPage={page => setParams(previous => { const next = new URLSearchParams(previous); next.set('page', page); return next; })} /></>}
  </>;
}
