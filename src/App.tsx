import { ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { AccessProvider, useAccess } from "./lib/access";
import Admin from "./pages/Admin";
import Sber from "./pages/Sber";
import AppShell from "./components/shell/AppShell";
import Login from "./pages/Login";
import PinLogin from "./pages/PinLogin";
import PinAuth from "./pages/PinAuth";
import DeviceLogin from "./pages/DeviceLogin";
import CamView from "./pages/CamView";
import AdpodPinLogin from "./pages/AdpodPinLogin";
import { PIN_ADPODS } from "./lib/pinAdpods";
import Dashboard from "./pages/Dashboard";
import Devices from "./pages/Devices";
import Documents from "./pages/Documents";
import DocumentBase from "./pages/DocumentBase";
import Dto from "./pages/Dto";
import Chat from "./pages/Chat";
import Cameras from "./pages/Cameras";
import Skud from "./pages/Skud";
import Employees from "./pages/Employees";
import Settings from "./pages/Settings";
import Salary from "./pages/Salary";
import Schedule from "./pages/Schedule";
import Inventory from './pages/Inventory';
import Collection from "./pages/Collection";
import Accounting from "./pages/Accounting";
import Legal from "./pages/Legal";
import Register from "./pages/Register";
import License from "./pages/License";
import BizAdmin from "./pages/BizAdmin";
import { LicenseProvider, useLicenseState } from "./lib/license";

const queryClient = new QueryClient();

function Loader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
    </div>
  );
}

function LicenseRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const lic = useLicenseState();
  if (loading) return <Loader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!lic.checked) return <Loader />;
  if (lic.allowed) return <AppShell>{children}</AppShell>;
  return <div className="min-h-screen bg-background">{children}</div>;
}

function BizAdminRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const lic = useLicenseState();
  if (loading || (user && !lic.checked)) return <Loader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!lic.isBizAdmin) return <Navigate to="/dashboard" replace />;
  return <AppShell>{children}</AppShell>;
}

function ProtectedRoute({ children, directorOnly = false, deputyOnly = false, path }: { children: ReactNode; directorOnly?: boolean; deputyOnly?: boolean; path?: string }) {
  const { user, loading } = useAuth();
  const { access, canSee } = useAccess();
  const lic = useLicenseState();
  if (loading) return <Loader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!lic.checked) return <Loader />;
  if (!lic.allowed) return <Navigate to="/license" replace />;
  if (path && access) {
    if (!canSee(path)) return <Navigate to="/dashboard" replace />;
    return <AppShell>{children}</AppShell>;
  }
  if (directorOnly && user.role !== "director" && user.role !== "deputy_director") {
    return <Navigate to="/dashboard" replace />;
  }
  if (deputyOnly && user.role !== "deputy_director") {
    return <Navigate to="/dashboard" replace />;
  }
  return <AppShell>{children}</AppShell>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AccessProvider>
          <LicenseProvider>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/legal" element={<Legal />} />
            <Route path="/legal/:slug" element={<Legal />} />
            <Route path="/license" element={<LicenseRoute><License /></LicenseRoute>} />
            <Route path="/biz-admin" element={<BizAdminRoute><BizAdmin /></BizAdminRoute>} />
            <Route path="/pin-login" element={<PinLogin />} />
            <Route path="/pin-auth" element={<PinAuth />} />
            <Route path="/device-login" element={<DeviceLogin />} />
            <Route path="/cam-view" element={<CamView />} />
            {PIN_ADPODS.map(adpod => (
              <Route key={adpod.slug} path={adpod.path} element={<AdpodPinLogin adpodSlug={adpod.slug} />} />
            ))}
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/documents" element={<ProtectedRoute path="/documents"><Documents /></ProtectedRoute>} />
            <Route path="/base" element={<ProtectedRoute path="/base"><DocumentBase /></ProtectedRoute>} />
            <Route path="/dto" element={<ProtectedRoute path="/dto"><Dto /></ProtectedRoute>} />
            <Route path="/chat" element={<ProtectedRoute path="/chat"><Chat /></ProtectedRoute>} />
            <Route path="/cameras" element={<ProtectedRoute path="/cameras"><Cameras /></ProtectedRoute>} />
            <Route path="/skud" element={<ProtectedRoute path="/skud"><Skud /></ProtectedRoute>} />
            <Route path="/salary" element={<ProtectedRoute path="/salary"><Salary /></ProtectedRoute>} />
            <Route path="/schedule" element={<ProtectedRoute path="/schedule"><Schedule /></ProtectedRoute>} />
            <Route path="/sber" element={<ProtectedRoute path="/sber"><Sber /></ProtectedRoute>} />
            <Route path="/accounting" element={<ProtectedRoute path="/accounting"><Accounting /></ProtectedRoute>} />
            <Route path="/inventory" element={<ProtectedRoute path="/inventory"><Inventory /></ProtectedRoute>} />
            <Route path="/collection" element={<ProtectedRoute path="/collection"><Collection /></ProtectedRoute>} />
            <Route path="/employees" element={<ProtectedRoute directorOnly path="/employees"><Employees /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute deputyOnly><Admin /></ProtectedRoute>} />
            <Route path="/devices" element={<ProtectedRoute deputyOnly><Devices /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute path="/settings"><Settings /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          </LicenseProvider>
          </AccessProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;