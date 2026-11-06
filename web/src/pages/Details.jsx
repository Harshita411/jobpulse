import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, Info } from 'lucide-react';
import { api } from '../api.js';
import { useResource } from '../useResource.js';
import { CopyId, date, ErrorNotice, isTerminal, Loading, number, PageTitle, Progress, Refresh, Status, typeLabel, TypeIcon } from '../components.jsx';

function ImportSummary({ id, terminal }) {
  const resource = useResource(signal => api.summary(id, signal), `summary-${id}`, { pollMs: terminal ? 0 : 1500, shouldPoll: summary => !summary.finished });
  return <><ErrorNotice error={resource.error} retry={resource.refresh} />{resource.loading && <Loading label="Loading durable counters…" />}{resource.data && <><div className="row-stats">{['processed', 'accepted', 'rejected'].map(key => <div key={key}><span>{key} rows</span><strong>{number(resource.data[key])}</strong></div>)}</div><p className="data-footnote">MongoDB checkpoints · {resource.data.finished ? 'Processing reached the end of the file.' : 'Only committed batches are reflected. Failed attempts may have saved partial data.'}</p></>}</>;
}
export default function Details() {
  const { id } = useParams();
  const location = useLocation();
  const resource = useResource(signal => api.job(id, signal), id, { pollMs: 1500, shouldPoll: job => !isTerminal(job.state) });
  const { data: job } = resource;
  return <>
    <Link className="back-link" to="/jobs"><ArrowLeft size={15} />Back to job history</Link>
    <PageTitle eyebrow="EXECUTION DETAIL" title="Job details" description="One task. Every available detail."><Refresh onClick={resource.refresh} busy={resource.refreshing} /></PageTitle>
    {location.state?.submitted && <div className="notice success" role="status"><CheckCircle2 size={19} /><p>Submission accepted. If these CSV bytes were submitted before, this is the existing import.</p></div>}
    <ErrorNotice error={resource.error} retry={resource.refresh} />{resource.loading && <Loading />}
    {job && <><div className="details-grid"><section className="panel details-primary"><div className="panel-heading"><div className="detail-type"><TypeIcon type={job.type} /><div><h2>{typeLabel(job.type)}</h2><p>{isTerminal(job.state) ? 'Terminal state' : 'Live execution'}</p></div></div><Status state={job.state} /></div><div className="panel-body"><label className="detail-label">JOB ID</label><CopyId id={job.jobId} /><div className="detail-progress"><div className="section-label"><h3>Processing progress</h3><span className="muted">{isTerminal(job.state) ? 'Polling stopped' : 'Updates every 1.5 seconds'}</span></div><Progress job={job} />{job.type === 'csv-import' && <p className="help-text">The bar shows accepted and rejected rows processed so far, not a percentage of the whole file.</p>}</div>
      {job.state === 'waiting' && <div className="notice info"><Clock3 size={18} /><p>Waiting for a worker. Start <code>npm run worker</code> if no consumer is running.</p></div>}
      {job.state === 'delayed' && <div className="notice warning"><Clock3 size={18} /><p>Automatic retry is delayed. {job.retryBackoffMs ? `The configured backoff for this retry is ${job.retryBackoffMs / 1000} seconds.` : 'BullMQ will make the job available when its delay expires.'} A worker must be available to continue.</p></div>}
      {job.error && <div className="notice error" role="alert"><Info size={18} /><div><strong>{job.state === 'failed' ? 'Job failed' : 'Last attempt failed'}</strong><p>{job.error.message}</p></div></div>}
      {job.type === 'csv-import' && <div className="durable-section"><h3>Import row counts</h3><ImportSummary key={`${id}-${job.state}`} id={id} terminal={isTerminal(job.state)} /></div>}
      {job.state === 'completed' && <div className="result-section"><div className="section-label"><h3>Processing result</h3><CheckCircle2 size={18} className="green" /></div><pre className="json-result">{JSON.stringify(job.result, null, 2)}</pre><Link className="text-link" to="/results">Browse completed results <ArrowRight size={15} /></Link></div>}
      {job.state === 'failed' && <p className="help-text">Committed CSV batches are preserved. This console has no manual retry action; re-uploading identical bytes does not reset the failed job.</p>}
    </div></section><aside className="panel metadata-panel"><div className="panel-heading"><h2>Execution information</h2></div><dl><div><dt>Job type</dt><dd>{typeLabel(job.type)}</dd></div><div><dt>Attempts completed</dt><dd>{number(job.attemptsMade)} of {number(job.maxAttempts)}</dd></div><div><dt>Created</dt><dd>{date(job.createdAt)}</dd></div><div><dt>Latest attempt started</dt><dd>{date(job.startedAt)}</dd></div><div><dt>Finished</dt><dd>{date(job.finishedAt)}</dd></div><div><dt>Retry policy</dt><dd>{job.type === 'csv-import' ? 'Exponential backoff · up to 3 attempts' : 'One execution attempt'}</dd></div></dl><p className="metadata-note">Attempts count finished attempts, including failures. Permanent validation errors can fail before the retry limit.</p></aside></div></>}
  </>;
}
