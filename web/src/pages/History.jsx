import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { api } from '../api.js';
import { useResource } from '../useResource.js';
import { Empty, ErrorNotice, JobsTable, Loading, PageTitle, Pagination, Refresh, WindowNotice } from '../components.jsx';

export default function History() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') || '');
  const filters = { status: params.get('status') || '', type: params.get('type') || '', search: params.get('search') || '', page: params.get('page') || '1', pageSize: 15 };
  const resource = useResource(signal => api.jobs(filters, signal), params.toString(), { pollMs: 5000 });
  function change(key, value) { setParams(previous => { const next = new URLSearchParams(previous); if (value) next.set(key, value); else next.delete(key); next.delete('page'); return next; }); }
  return <>
    <PageTitle eyebrow="YOUR JOBS" title="Job history" description="Find jobs by status, type, or ID."><Refresh onClick={resource.refresh} busy={resource.refreshing} /><Link className="button primary" to="/submit"><Plus size={17} />Submit job</Link></PageTitle>
    <ErrorNotice error={resource.error} retry={resource.refresh} />
    <section className="panel"><div className="filters"><form className="search-field" onSubmit={event => { event.preventDefault(); change('search', search.trim()); }}><Search size={17} /><label htmlFor="job-search" className="sr-only">Search job ID or type</label><input id="job-search" placeholder="Search job ID or type…" maxLength={128} value={search} onChange={event => setSearch(event.target.value)} /><button className="text-button" type="submit">Search</button></form><label className="filter-label"><span>Status</span><select aria-label="Filter by status" value={filters.status} onChange={event => change('status', event.target.value)}><option value="">All statuses</option>{['waiting', 'active', 'delayed', 'completed', 'failed'].map(state => <option key={state} value={state}>{state === 'delayed' ? 'Delayed retries' : state[0].toUpperCase() + state.slice(1)}</option>)}</select></label><label className="filter-label"><span>Type</span><select aria-label="Filter by type" value={filters.type} onChange={event => change('type', event.target.value)}><option value="">All job types</option><option value="csv-import">CSV imports</option><option value="simulation">Simulations</option></select></label></div>
      <WindowNotice data={resource.data} />{resource.loading ? <Loading /> : resource.data && (resource.data.items.length ? <JobsTable jobs={resource.data.items} /> : <Empty title="No matching jobs" description="Adjust your filters or search." />)}
      {resource.data && <Pagination {...resource.data} setPage={page => setParams(previous => { const next = new URLSearchParams(previous); next.set('page', page); return next; })} />}
    </section>
  </>;
}
