import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { FleetPage } from '@/pages/FleetPage';
import { RoutineDetailPage } from '@/pages/RoutineDetailPage';
import { RunsPage } from '@/pages/RunsPage';
import { ConnectorsPage } from '@/pages/ConnectorsPage';
import { ActivityPage } from '@/pages/ActivityPage';
import { SettingsPage } from '@/pages/SettingsPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<FleetPage />} />
          <Route path="/routines/:slug" element={<RoutineDetailPage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/connectors" element={<ConnectorsPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
