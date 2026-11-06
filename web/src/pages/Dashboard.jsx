import { Link } from 'react-router-dom';
import { Activity, ArrowRight, CheckCheck, CircleAlert, Clock3, Layers3, Plus } from 'lucide-react';
import { api } from '../api.js';
import { useResource } from '../useResource.js';
import { date, Empty, ErrorNotice, JobsTable, Loading, number, PageTitle, Refresh, WindowNotice } from '../components.jsx';

const states = [
  ['waiting', 'Waiting', Clock3, '#b38a37'], ['active', 'Active', Activity, '#4985ce'],
  ['completed', 'Completed', CheckCheck, '#22977a'], ['failed', 'Failed', CircleAlert, '#ce6562'],
];
export default function Dashboard() {
  const resource = useResource(async signal => {
    const [queue, recent] = await Promise.all([api.queue(signal), api.jobs({ pageSize: 6 }, signal)]);
    return { queue, recent };
  }, 'dashboard', { pollMs: 5000 });
  const { data } = resource;
  const distribution = data ? [...states.map(([key, label, , color]) => ({ key, label, color, count: data.queue.counts[key] })),
    { key: 'delayed', label: 'Delayed', color: '#9272bf', count: data.queue.counts.delayed },
    { key: 'waitingChildren', label: 'Waiting for children', color: '#91a19e', count: data.queue.counts.waitingChildren }] : [];
  let offset = 0;
  const gradient = distribution.map(item => { const start = offset; offset += data.queue.total ? item.count / data.queue.total * 100 : 0; return `${item.color} ${start}% ${offset}%`; }).join(',');
  return <>
    <PageTitle eyebrow="OPERATIONS OVERVIEW" title="Dashboard" description="A clear view of your background work."><Refresh onClick={resource.refresh} busy={resource.refreshing} /><Link className="button primary" to="/submit"><Plus size={17} />Submit job</Link></PageTitle>
    <ErrorNotice error={resource.error} retry={resource.refresh} />
    {resource.loading && <Loading />}
    {data && <>
      <div className="data-line"><span className={`live-indicator ${resource.error ? 'stale' : ''}`}><span />{resource.error ? 'Last known data' : 'Queue snapshot'}</span><span>Updated {date(data.queue.observedAt)} <span className="separator">·</span> Refreshes every 5 seconds</span></div>
      {data.queue.paused && <div className="notice warning">The queue is paused. Waiting jobs will remain queued until it is resumed outside this console.</div>}
      <div className="stats-grid">{states.map(([key, label, Icon, color]) => <Link to={`/jobs?status=${key}`} className="stat-card" key={key}><div className="stat-top"><span>{label} jobs</span><span className="stat-icon" style={{ color, background: `${color}14` }}><Icon size={19} /></span></div><strong>{number(data.queue.counts[key])}</strong><div className="stat-caption">{({ waiting: 'Ready for a worker', active: 'Currently processing', completed: 'Finished successfully', failed: 'Need your attention' })[key]}<ArrowRight size={14} /></div></Link>)}</div>
      <div className="overview-grid"><section className="panel distribution-panel"><div className="panel-heading"><div><h2>Queue distribution</h2><p>All retained jobs, by current state</p></div><Layers3 size={20} className="muted" /></div><div className="distribution-content"><div className="donut" style={{ background: data.queue.total ? `conic-gradient(${gradient})` : '#e8eeeb' }} role="img" aria-label={distribution.map(item => `${item.label}: ${item.count}`).join(', ')}><div><strong>{number(data.queue.total)}</strong><span>Total jobs</span></div></div><div className="legend">{distribution.filter(item => item.key !== 'waitingChildren' || item.count).map(item => <div key={item.key}><span className="legend-dot" style={{ background: item.color }} /><span>{item.label}</span><strong>{number(item.count)}</strong></div>)}</div></div></section>
      <section className="queue-note"><span className="queue-note-icon"><Activity size={25} /></span><div className="eyebrow">WORK, DECOUPLED</div><h2>Submit it.<br />Keep moving.</h2><p>Your API accepts the job. Independent workers take care of the processing.</p><Link to="/submit">Create a new job <ArrowRight size={16} /></Link><div className="queue-note-foot"><span>QUEUE</span><code>{data.queue.queue}</code></div></section></div>
      <section className="panel"><div className="panel-heading"><div><h2>Recent jobs <span className="count-label">{data.recent.items.length}</span></h2><p>Latest submissions in the inspected queue window</p></div><Link className="text-link" to="/jobs">View all jobs <ArrowRight size={15} /></Link></div><WindowNotice data={data.recent} />{data.recent.items.length ? <JobsTable jobs={data.recent.items} /> : <Empty />}</section>
      <p className="data-footnote">Counts describe retained BullMQ records. They are not lifetime metrics or a worker-health check.</p>
    </>}
  </>;
}
