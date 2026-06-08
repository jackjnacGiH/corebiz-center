import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';
import Layout from './components/Layout';
import { LanguageProvider } from './LanguageProvider';
import { AuthProvider } from './lib/AuthProvider';
import ProtectedRoute from './lib/ProtectedRoute';

// Route components are code-split (lazy) so each page ships its own chunk
// instead of one ~3MB bundle — first paint loads only what the route needs.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Ecommerce = lazy(() => import('./pages/Ecommerce'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Orders = lazy(() => import('./pages/Orders'));
const CRM = lazy(() => import('./pages/CRM'));
const Chat = lazy(() => import('./pages/Chat'));
const Marketing = lazy(() => import('./pages/Marketing'));
const OpenclawRAG = lazy(() => import('./pages/OpenclawRAG'));
const KnowledgeChat = lazy(() => import('./pages/KnowledgeChat'));
const CustomerChat = lazy(() => import('./pages/CustomerChat'));
const SurveyPage = lazy(() => import('./pages/SurveyPage'));
const ReferPage = lazy(() => import('./pages/ReferPage'));
const Affiliate = lazy(() => import('./pages/Affiliate'));
const Settings = lazy(() => import('./pages/Settings'));
const Users = lazy(() => import('./pages/Users'));
const Audit = lazy(() => import('./pages/Audit'));
const Login = lazy(() => import('./pages/auth/Login'));
const AuthCallback = lazy(() => import('./pages/auth/AuthCallback'));
const LineCallback = lazy(() => import('./pages/auth/LineCallback'));

function PageFallback() {
  return (
    <div className="min-h-screen grid place-items-center text-neutral-400">
      <Loader2 size={28} className="animate-spin" />
    </div>
  );
}

function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/auth/line-callback" element={<LineCallback />} />
              {/* Public customer-facing AI chat widget — designed to be
                  iframed onto jnac.co.th. No auth required. */}
              <Route path="/widget" element={<CustomerChat />} />
              {/* Public satisfaction / NPS rating page reached from a LINE link. */}
              <Route path="/survey/:token" element={<SurveyPage />} />
              {/* Public referral landing page reached from a customer's share link. */}
              <Route path="/refer/:code" element={<ReferPage />} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Dashboard />} />
                <Route path="ecommerce" element={<Ecommerce />} />
                <Route path="inventory" element={<Inventory />} />
                <Route path="orders" element={<Orders />} />
                <Route path="crm" element={<CRM />} />
                <Route path="chat" element={<Chat />} />
                <Route path="marketing" element={<Marketing />} />
                <Route path="affiliate" element={<Affiliate />} />
                <Route path="rag" element={<OpenclawRAG />} />
                <Route path="ask" element={<KnowledgeChat />} />
                <Route
                  path="settings"
                  element={
                    <ProtectedRoute roles={['owner', 'admin']}>
                      <Settings />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="users"
                  element={
                    <ProtectedRoute roles={['owner', 'admin']}>
                      <Users />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="audit"
                  element={
                    <ProtectedRoute roles={['owner', 'admin']}>
                      <Audit />
                    </ProtectedRoute>
                  }
                />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </LanguageProvider>
  );
}

export default App;
