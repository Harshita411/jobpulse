import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, Info } from 'lucide-react';
import { api } from '../api.js';
import { useResource } from '../useResource.js';
import { CopyId, date, ErrorNotice, isTerminal, Loading, number, PageTitle, Progress, Refresh, Status, typeLabel, TypeIcon } from '../components.jsx';

function ImportSummary({ id, terminal }) {
  const resource = useResource(signal => api.summary(id, signal), `summary-${id}`, { pollMs: terminal ? 0 : 1500, shouldPoll: summary => !summary.finished });
  return <><ErrorNotice error={resource.error} retry={resource.refresh} />{resource.loading && <Loading label="Loading import summary…" />}{resource.data && <><div className="row-stats">{['processed', 'accepted', 'rejected'].map(key => <div key={key}><span>{key} rows</span><strong>{number(resource.data[key])}</strong></div>)}</div></>}</>;
}
export default function Details() {
  const { id } = useParams();
  const location = useLocation();
  const resource = useResource(signal => api.job(id, signal), id, { pollMs: 1500, shouldPoll: job => !isTerminal(job.state) });
  const { data: job } = resource;
  return <>
    <Link className="back-link" to="/jobs"><ArrowLeft size={15} />Back to job history</Link>
    <PageTitle eyebrow="YOUR JOB" title="Job details" description="Track progress and review the outcome."><Refresh onClick={resource.refresh} busy={resource.refreshing} /></PageTitle>
    {location.state?.submitted && <div className="notice success" role="status"><CheckCircle2 size={19} /><p>Submission accepted.</p></div>}
    <ErrorNotice error={resource.error} retry={resource.refresh} />{resource.loading && <Loading />}
    {job && <><div className="details-grid"><section className="panel details-primary"><div className="panel-heading"><div className="detail-type"><TypeIcon type={job.type} /><div><h2>{typeLabel(job.type)}</h2></div></div><Status state={job.state} /></div><div className="panel-body"><label className="detail-label">JOB ID</label><CopyId id={job.jobId} /><div className="detail-progress"><div className="section-label"><h3>{job.type === 'csv-import' ? 'Processed row breakdown' : 'Task progress'}</h3><span className="muted">{isTerminal(job.state) ? 'Finished' : 'Auto-refresh'}</span></div><Progress job={job} />{job.type === 'csv-import' && <div className="progress-key"><span><i className="accepted-key" />Accepted</span><span><i className="rejected-key" />Rejected</span></div>}</div>
      {job.state === 'waiting' && <div className="notice info"><Clock3 size={18} /><p>Waiting to start.</p></div>}
      {job.state === 'delayed' && <div className="notice warning"><Clock3 size={18} /><p>Waiting for an automatic retry.{job.retryBackoffMs ? ` Retry delay: ${job.retryBackoffMs / 1000} seconds.` : ''}</p></div>}
      {job.error && <div className="notice error" role="alert"><Info size={18} /><div><strong>{job.state === 'failed' ? 'Job failed' : 'Last attempt failed'}</strong><p>{job.error.message === 'Task failed; inspect worker logs' ? 'The job couldn’t finish.' : job.error.message}</p></div></div>}
      {job.type === 'csv-import' && <div className="durable-section"><h3>Import summary</h3><ImportSummary key={`${id}-${job.state}`} id={id} terminal={isTerminal(job.state)} /></div>}
      {job.state === 'completed' && <div className="result-section"><div className="section-label"><h3>Result</h3><CheckCircle2 size={18} className="green" /></div><p className="result-summary">{job.type === 'csv-import' && job.result ? `${number(job.result.accepted)} accepted · ${number(job.result.rejected)} rejected` : job.result?.message || 'No result available.'}</p><Link className="text-link" to="/results">Browse completed results <ArrowRight size={15} /></Link></div>}
      {job.state === 'failed' && job.type === 'csv-import' && <p className="help-text">Any saved rows are kept. Re-uploading this file won’t retry it.</p>}
    </div></section><aside className="panel metadata-panel"><div className="panel-heading"><h2>Job information</h2></div><dl><div><dt>Job type</dt><dd>{typeLabel(job.type)}</dd></div><div><dt>Attempts completed</dt><dd>{number(job.attemptsMade)} of {number(job.maxAttempts)}</dd></div><div><dt>Created</dt><dd>{date(job.createdAt)}</dd></div><div><dt>Latest attempt started</dt><dd>{date(job.startedAt)}</dd></div><div><dt>Finished</dt><dd>{date(job.finishedAt)}</dd></div><div><dt>Attempt limit</dt><dd>{number(job.maxAttempts)} total</dd></div></dl></aside></div></>}
  </>;
}
