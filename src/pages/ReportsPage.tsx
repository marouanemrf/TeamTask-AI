import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useProject } from '../hooks/useProject';
import { useUser } from '../hooks/useUser';
import { generateWeeklyReport, observeProjectReports } from '../services/automationService';
import type { WeeklyReport } from '../services/client';
import { describeApiError } from '../utils/apiErrors';
import { projectPath } from '../utils/routes';
import LoadingState from "../components/ui/LoadingState";

function ReportsPage() {
  const { id } = useParams();
  const { isAdmin } = useUser();
  const { project, loading: projectLoading } = useProject(id);
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!id) return;
    return observeProjectReports(id, setReports, (err) => setError(describeApiError(err)));
  }, [id]);

  async function generate() {
    if (!id) return;
    setGenerating(true); setError(null);
    try { await generateWeeklyReport(id); }
    catch (err) { setError(describeApiError(err)); }
    finally { setGenerating(false); }
  }

  if (projectLoading) return <LoadingState className="empty-state panel">Loading project…</LoadingState>;
  if (!project) return <div className="panel"><p>Project not found.</p><Link className="text-link" to="/projects">Back to projects</Link></div>;
  return <div className="page-stack">
    <section className="panel">
      <div className="panel__header"><div><h2 className="panel__title">Weekly reports</h2><p>{project.name}</p></div>{isAdmin && <button className="button-primary" disabled={generating} onClick={() => void generate()}>{generating ? 'Generating…' : 'Generate now'}</button>}</div>
      {error && <div className="form-alert" role="alert">{error}</div>}
      {reports.length === 0 ? <p className="empty-state">No reports yet.</p> : reports.map((report) => <article className="panel" key={report.id} style={{ marginTop: 16 }}>
        <h3>Week {report.weekNumber}{report.year ? ` · ${report.year}` : ''}</h3>
        <div className="stat-grid"><div><strong>Total</strong><p>{report.totalCount ?? 0}</p></div><div><strong>Done</strong><p>{report.completedCount ?? 0}</p></div><div><strong>In progress</strong><p>{report.inProgressCount ?? 0}</p></div><div><strong>Overdue</strong><p>{report.overdueCount ?? 0}</p></div><div><strong>Completion</strong><p>{report.completionRate ?? 0}%</p></div></div>
        <p>{report.summary}</p>
        <h4>Risks</h4><ul>{(report.risks ?? []).map((risk, index) => <li key={`${report.id}-risk-${index}`}>{risk}</li>)}</ul>
        <h4>Suggested actions</h4><ul>{(report.correctiveActions ?? []).map((action, index) => <li key={`${report.id}-action-${index}`}>{action}</li>)}</ul>
      </article>)}
      <p><Link className="text-link" to={projectPath(project.id)}>Back to the project</Link></p>
    </section>
  </div>;
}

export default ReportsPage;
