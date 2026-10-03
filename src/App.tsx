import { ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import AppShell from "./components/shell/AppShell";
import Login from "./pages/Login";
import Register from "./pages/Register";
import PinLogin from "./pages/PinLogin";
import PinAuth from "./pages/PinAuth";
import DeviceLogin from "./pages/DeviceLogin";
import AdpodPinLogin from "./pages/AdpodPinLogin";
import { PIN_ADPODS } from "./lib/pinAdpods";
import Dashboard from "./pages/Dashboard";
import Devices from "./pages/Devices";
import Documents from "./pages/Documents";
import DocumentBase from "./pages/DocumentBase";
import Dto from "./pages/Dto";
import Chat from "./pages/Chat";
import Cameras from "./pages/Cameras";
import Employees from "./pages/Employees";
import Settings from "./pages/Settings";
import Salary from "./pages/Salary";
import Schedule from "./pages/Schedule";
import Collection from "./pages/Collection";

const queryClient = new QueryClient();

function Loader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
    </div>
  );
}

function ProtectedRoute({ children, directorOnly = false, deputyOnly = false }: { children: ReactNode; directorOnly?: boolean; deputyOnly?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <Loader />;
  if (!user) return <Navigate to="/login" replace />;
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
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/pin-login" element={<PinLogin />} />
            <Route path="/pin-auth" element={<PinAuth />} />
            <Route path="/device-login" element={<DeviceLogin />} />
            {PIN_ADPODS.map(adpod => (
              <Route key={adpod.slug} path={adpod.path} element={<AdpodPinLogin adpodSlug={adpod.slug} />} />
            ))}
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/documents" element={<ProtectedRoute><Documents /></ProtectedRoute>} />
            <Route path="/base" element={<ProtectedRoute><DocumentBase /></ProtectedRoute>} />
            <Route path="/dto" element={<ProtectedRoute><Dto /></ProtectedRoute>} />
            <Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
            <Route path="/cameras" element={<ProtectedRoute><Cameras /></ProtectedRoute>} />
            <Route path="/salary" element={<ProtectedRoute><Salary /></ProtectedRoute>} />
            <Route path="/schedule" element={<ProtectedRoute><Schedule /></ProtectedRoute>} />
            <Route path="/collection" element={<ProtectedRoute><Collection /></ProtectedRoute>} />
            <Route path="/employees" element={<ProtectedRoute directorOnly><Employees /></ProtectedRoute>} />
            <Route path="/devices" element={<ProtectedRoute deputyOnly><Devices /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;