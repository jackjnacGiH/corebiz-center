import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Ecommerce from './pages/Ecommerce';
import Inventory from './pages/Inventory';
import CRM from './pages/CRM';
import Chat from './pages/Chat';
import Marketing from './pages/Marketing';
import OpenclawRAG from './pages/OpenclawRAG';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="ecommerce" element={<Ecommerce />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="crm" element={<CRM />} />
          <Route path="chat" element={<Chat />} />
          <Route path="marketing" element={<Marketing />} />
          <Route path="rag" element={<OpenclawRAG />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
