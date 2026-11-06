import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, FileSpreadsheet, Info, LoaderCircle, Terminal, UploadCloud, X } from 'lucide-react';
import { api, validateCsvFile } from '../api.js';
import { ErrorNotice, PageTitle } from '../components.jsx';

export default function Submit() {
  const [type, setType] = useState('csv-import');
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [checking, setChecking] = useState(false);
  const [mode, setMode] = useState('complete');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef(null);
  const selection = useRef(0);
  const navigate = useNavigate();
  async function chooseFile(candidate) {
    const version = ++selection.current;
    setChecking(true); setFile(null); setFileError(''); setError(null);
    try {
      const invalid = await validateCsvFile(candidate);
      if (version !== selection.current) return;
      if (invalid) setFileError(invalid); else setFile(candidate);
    } catch { if (version === selection.current) setFileError('Could not read that file. Please select it again.'); }
    finally { if (version === selection.current) setChecking(false); }
  }
  async function submit(event) {
    event.preventDefault();
    if (type === 'csv-import' && !file) { setFileError('Choose a valid CSV file to continue.'); return; }
    setSubmitting(true); setError(null);
    try {
      const receipt = type === 'csv-import' ? await api.upload(file) : await api.simulation(mode);
      navigate(`/jobs/${receipt.jobId}`, { state: { submitted: true } });
    } catch (failure) { setError(failure); }
    finally { setSubmitting(false); }
  }
  return <>
    <PageTitle eyebrow="NEW JOB" title="Submit a job" description="Upload a CSV or try a simulation." />
    <div className="submit-layout"><form className="panel submission-form" onSubmit={submit}>
      <div className="form-section"><div className="step-heading"><span>1</span><div><h2>Choose a job type</h2></div></div><div className="type-options">{[['csv-import', 'CSV import', 'Import and validate your records', FileSpreadsheet], ['simulation', 'Simulation', 'A controlled ten-second task', Terminal]].map(([value, title, text, Icon]) => <label key={value} className={`type-option ${type === value ? 'chosen' : ''}`}><input type="radio" name="jobType" value={value} checked={type === value} disabled={submitting} onChange={() => { setType(value); setError(null); }} /><Icon size={23} /><strong>{title}</strong><span>{text}</span></label>)}</div></div>
      <div className="form-section"><div className="step-heading"><span>2</span><div><h2>{type === 'csv-import' ? 'Upload your CSV' : 'Configure the simulation'}</h2><p>{type === 'csv-import' ? 'One UTF-8 CSV file, up to 2 MB.' : 'Choose how the task should finish.'}</p></div></div>
        {type === 'csv-import' ? <>
          <div className={`dropzone ${dragging ? 'dragging' : ''} ${fileError ? 'invalid' : ''}`} onDragOver={event => { event.preventDefault(); if (!submitting) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (submitting) return; if (event.dataTransfer.files.length !== 1) { setFileError('Select exactly one CSV file.'); setFile(null); } else void chooseFile(event.dataTransfer.files[0]); }}>
            <div className="upload-icon"><UploadCloud size={29} /></div><strong>Drop your CSV here</strong><span>or choose a file from your computer</span><button type="button" className="button secondary" onClick={() => input.current?.click()} disabled={submitting || checking}>Browse files</button><input ref={input} className="sr-only" aria-label="CSV file" type="file" accept=".csv,text/csv" disabled={submitting} onChange={event => { void chooseFile(event.target.files[0]); event.target.value = ''; }} /><small>CSV format · 2 MB maximum · 10,000 data rows</small>
          </div>
          {checking && <p className="inline-status" role="status"><LoaderCircle className="spin" size={16} />Checking file…</p>}
          {fileError && <p className="field-error" role="alert">{fileError}</p>}
          {file && <div className="selected-file"><FileSpreadsheet size={24} /><div><strong>{file.name}</strong><span>{(file.size / 1024).toFixed(1)} KB · Ready to upload</span></div><CheckCircle2 size={19} /><button type="button" className="icon-button" disabled={submitting} aria-label="Remove selected file" onClick={() => { selection.current += 1; setFile(null); }}><X size={17} /></button></div>}
          <div className="notice info"><Info size={18} /><p>Required columns: <code>name,email,age</code>. Invalid rows are skipped.</p></div>
        </> : <fieldset className="simulation-options"><legend className="sr-only">Simulation outcome</legend>{[['complete', 'Complete successfully', 'Runs for ten seconds and returns a result.'], ['fail', 'Fail in a controlled way', 'Runs for ten seconds, then reports a failure.']].map(([value, label, text]) => <label key={value}><input type="radio" name="mode" checked={mode === value} disabled={submitting} onChange={() => setMode(value)} /><div><strong>{label}</strong><span>{text}</span></div></label>)}</fieldset>}
      </div><div className="form-footer"><ErrorNotice error={error} /><button type="submit" className="button primary" disabled={submitting || checking || (type === 'csv-import' && !file)}>{submitting ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}{submitting ? 'Submitting…' : 'Submit job'}</button></div>
    </form><aside className="submit-help"><span className="eyebrow">QUICK GUIDE</span><h2>{type === 'csv-import' ? 'Before you upload' : 'Try a simulation'}</h2><ol>{(type === 'csv-import' ? [['Check the columns', 'Include name, email, and age.'], ['Check the values', 'Use a valid email and a whole-number age from 0 to 120.'], ['Review your results', 'Invalid rows are counted and skipped.']] : [['Choose an outcome', 'Complete successfully or test a failure.'], ['Follow the progress', 'The task runs for ten seconds.'], ['Review the result', 'Open job details to see the outcome.']]).map(([title, text]) => <li key={title}><strong>{title}</strong><p>{text}</p></li>)}</ol>{type === 'csv-import' && <div className="help-note"><Info size={17} /><p>Uploading the same file opens your existing import.</p></div>}</aside></div>
  </>;
}
