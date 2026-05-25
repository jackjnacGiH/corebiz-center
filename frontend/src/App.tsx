import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Ecommerce from './pages/Ecommerce';
import Inventory from './pages/Inventory';
import Orders from './pages/Orders';
import CRM from './pages/CRM';
import Chat from './pages/Chat';
import Marketing from './pages/Marketing';
import OpenclawRAG from './pages/OpenclawRAG';
import KnowledgeChat from './pages/KnowledgeChat';
import CustomerChat from './pages/CustomerChat';
import Inbox from './pages/Inbox';
import Affiliate from './pages/Affiliate';
import Settings from './pages/Settings';
import Login from './pages/auth/Login';
import AuthCallback from './pages/auth/AuthCallback';
import LineCallback from './pages/auth/LineCallback';
import { LanguageProvider } from './LanguageProvider';
import { AuthProvider } from './lib/AuthProvider';
import ProtectedRoute from './lib/ProtectedRoute';

function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/auth/line-callback" element={<LineCallback />} />
            {/* Public customer-facing AI chat widget — designed to be
                iframed onto jnac.co.th. No auth required. */}
            <Route path="/widget" element={<CustomerChat />} />
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
              <Route path="inbox" element={<Inbox />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </LanguageProvider>
  );
}

export default App;
