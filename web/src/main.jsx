import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { AuthProvider, Protected } from './Auth.jsx';
import AuthPage from './pages/AuthPage.jsx';
import Layout from './Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Submit from './pages/Submit.jsx';
import History from './pages/History.jsx';
import Details from './pages/Details.jsx';
import Results from './pages/Results.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><BrowserRouter><AuthProvider><Routes>
    <Route path="login" element={<AuthPage />} />
    <Route path="register" element={<AuthPage register />} />
    <Route element={<Protected />}><Route element={<Layout />}>
      <Route index element={<Dashboard />} />
      <Route path="submit" element={<Submit />} />
      <Route path="jobs" element={<History />} />
      <Route path="jobs/:id" element={<Details />} />
      <Route path="results" element={<Results />} />
      <Route path="*" element={<div className="empty"><h1>Page not found</h1><Link className="button primary" to="/">Back to dashboard</Link></div>} />
    </Route></Route>
  </Routes></AuthProvider></BrowserRouter></React.StrictMode>
);
