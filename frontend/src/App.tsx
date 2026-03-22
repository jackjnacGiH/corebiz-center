import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Ecommerce from './pages/Ecommerce';
import Inventory from './pages/Inventory';
import CRM from './pages/CRM';
import Chat from './pages/Chat';
import Marketing from './pages/Marketing';
import OpenclawRAG from './pages/OpenclawRAG';

// Placeholder components สำหรับหน้าที่กำลังพัฒนา
const Orders = () => (
  <div className="animate-fade-in">
    <h1 className="text-2xl font-bold">จัดการออเดอร์ (Orders) 🚚</h1>
    <p className="text-muted" style={{ marginTop: '0.5rem', marginBottom: '2rem' }}>หน้านี้อยู่ระหว่างการพัฒนา</p>
    <div className="glass-card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
      🚧 Coming Soon — ระบบจัดการออเดอร์
    </div>
  </div>
);

const Affiliate = () => (
  <div className="animate-fade-in">
    <h1 className="text-2xl font-bold">ระบบ Affiliate 🤝</h1>
    <p className="text-muted" style={{ marginTop: '0.5rem', marginBottom: '2rem' }}>หน้านี้อยู่ระหว่างการพัฒนา</p>
    <div className="glass-card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
      🚧 Coming Soon — ระบบ Affiliate & คอมมิชชั่น
    </div>
  </div>
);

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="ecommerce" element={<Ecommerce />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="orders" element={<Orders />} />
          <Route path="crm" element={<CRM />} />
          <Route path="chat" element={<Chat />} />
          <Route path="marketing" element={<Marketing />} />
          <Route path="affiliate" element={<Affiliate />} />
          <Route path="rag" element={<OpenclawRAG />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;

