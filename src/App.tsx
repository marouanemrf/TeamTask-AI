import { useAuthenticator } from "@aws-amplify/ui-react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import EmailVerificationGate from "./components/auth/EmailVerificationGate";
import AppLayout from "./components/layout/AppLayout";
import { UserProvider } from "./context/UserContext";
import { PresenceProvider } from "./context/PresenceContext";
import { useSignIn } from "./hooks/useSignIn";
import { signOutUser } from "./services/authService";
import { ToastProvider } from "./components/ui/Toaster";
import PilotMetricsPage from "./pages/PilotMetricsPage";
import AgentActivityPage from "./pages/AgentActivityPage";
import DashboardPage from "./pages/DashboardPage";
import EscalationsPage from "./pages/EscalationsPage";
import LoginPage from "./pages/LoginPage";
import MemberDetailPage from "./pages/MemberDetailPage";
import MyTasksPage from "./pages/MyTasksPage";
import ProjectCreatePage from "./pages/ProjectCreatePage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import ProjectsListPage from "./pages/ProjectsListPage";
import ReportsPage from "./pages/ReportsPage";
import TeamPage from "./pages/TeamPage";
import WorkloadPage from "./pages/WorkloadPage";
import ProfilePage from "./pages/ProfilePage";
import { ROUTES } from "./utils/routes";

/**
 * Root: the 3D login page while signed out; once signed in, the routed app shell.
 * <Authenticator.Provider> (main.tsx) tracks the Cognito session; no Amplify UI is rendered.
 */
function App() {
  const { authStatus } = useAuthenticator((context) => [context.authStatus]);
  const { error, needsNewPassword, submitCredentials, submitNewPassword } = useSignIn();

  if (authStatus === "configuring") return null;

  if (authStatus === "authenticated") {
    return (
      <EmailVerificationGate onSignOut={() => void signOutUser()}>
      <UserProvider>
       <PresenceProvider>
        <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path={ROUTES.dashboard} element={<DashboardPage />} />
              <Route path={ROUTES.profile} element={<ProfilePage />} />
              <Route path={ROUTES.projects} element={<ProjectsListPage />} />
              <Route path={ROUTES.projectNew} element={<ProjectCreatePage />} />
              <Route path={ROUTES.projectDetail} element={<ProjectDetailPage />} />
              <Route path={ROUTES.projectReports} element={<ReportsPage />} />
              <Route path={ROUTES.escalations} element={<EscalationsPage />} />
              <Route path={ROUTES.agentActivity} element={<AgentActivityPage />} />
              <Route path={ROUTES.pilot} element={<PilotMetricsPage />} />
              <Route path={ROUTES.team} element={<TeamPage />} />
              <Route path={ROUTES.workload} element={<WorkloadPage />} />
              <Route path={ROUTES.memberDetail} element={<MemberDetailPage />} />
              <Route path={ROUTES.myTasks} element={<MyTasksPage />} />
              <Route path="*" element={<Navigate to={ROUTES.dashboard} replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
        </ToastProvider>
       </PresenceProvider>
      </UserProvider>
      </EmailVerificationGate>
    );
  }

  return (
    <LoginPage
      onSubmit={submitCredentials}
      onNewPassword={needsNewPassword ? submitNewPassword : undefined}
      error={error}
    />
  );
}

export default App;
