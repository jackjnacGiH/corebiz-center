import React, { useState } from 'react';
import ProductModal from '../components/ProductModal';

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
}

const mockData: Product[] = [
  { id: '1', name: 'กระดาษทรายกลมสักหลาด 5"', price: 15, stock: 1500, category: 'General' },
  { id: '2', name: 'ใบเจียรเหล็ก 4"', price: 25, stock: 850, category: 'General' },
];

export default function Inventory() {
  const [products, setProducts] = useState<Product[]>(mockData);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const handleSave = (product: Product) => {
    if (editingProduct) {
      setProducts(products.map(p => p.id === product.id ? product : p));
    } else {
      setProducts([...products, product]);
    }
  };

  const handleDelete = (id: string) => {
    if(confirm('ยืนยันการลบสินค้านี้?')) {
      setProducts(products.filter(p => p.id !== id));
    }
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setIsModalOpen(true);
  };

  const openAddModal = () => {
    setEditingProduct(null);
setIsModalOpen(true);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto min-h-screen bg-gray-50">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Inventory Management</h1>
          <p className="text-gray-500 mt-1">จัดการคลังสินค้าและสต๊อกแบบเรียลไทม์</p>
        </div>
        <button onClick={openAddModal} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg font-semibold shadow-sm transition-all flex items-center gap-2">
          + เพิ่มสินค้าใหม่
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-gray-600 text-sm uppercase tracking-wider">
              <th className="p-4 font-semibold">รหัสสินค้า</th>
              <th className="p-4 font-semibold">ชื่อสินค้า</th>
              <th className="p-4 font-semibold">หมวดหมู่</th>
              <th className="p-4 font-semibold text-right">ราคา (฿)</th>
              <th className="p-4 font-semibold text-right">สต๊อก</th>
              <th className="p-4 font-semibold text-center">จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {products.map((product) => (
              <tr key={product.id} className="hover:bg-gray-50 transition-colors">
                <td className="p-4 text-gray-500 font-mono text-sm">#{product.id.padStart(4, '0')}</td>
                <td className="p-4 font-medium text-gray-900">{product.name}</td>
                <td className="p-4"><span className="px-3 py-1 bg-blue-50 text-blue-700 text-xs font-semibold rounded-full">{product.category}</span></td>
                <td className="p-4 text-right text-gray-700">{product.price.toLocaleString()}</td>
                <td className="p-4 text-right"><span className={`font-semibold ${product.stock < 10 ? 'text-red-500' : 'text-green-600'}`}>{product.stock}</span></td>
                <td className="p-4 flex justify-center gap-2">
                  <button onClick={() => openEditModal(product)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg">Edit</button>
                  <button onClick={() => handleDelete(product.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ProductModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSave} editingProduct={editingProduct} />
    </div>
  );
}
