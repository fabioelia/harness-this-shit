import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { FleetPage } from '@/pages/FleetPage';
import { NewRoutinePage } from '@/pages/NewRoutinePage';
import { RoutineDetailPage } from '@/pages/RoutineDetailPage';
import { RunsPage } from '@/pages/RunsPage';
import { RunDetailPage } from '@/pages/RunDetailPage';
import { ConnectorsPage } from '@/pages/ConnectorsPage';
import { ActivityPage } from '@/pages/ActivityPage';
import { SettingsPage } from '@/pages/SettingsPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<FleetPage />} />
          <Route path="/routines/new" element={<NewRoutinePage />} />
          <Route path="/routines/:slug/edit" element={<NewRoutinePage />} />
          <Route path="/routines/:slug" element={<RoutineDetailPage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/runs/:id" element={<RunDetailPage />} />
          <Route path="/connectors" element={<ConnectorsPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
