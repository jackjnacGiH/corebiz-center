import React, { useState } from 'react';

const catalogData = [
  { id: '1', name: 'กระดาษทรายกลมสักหลาด 5"', price: 15, image: '🔵', category: 'General' },
  { id: '2', name: 'ใบเจียรเหล็ก 4"', price: 25, image: '⚙️', category: 'General' },
];

export default function Ecommerce() {
  const [cartCount, setCartCount] = useState(0);
return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm sticky top-0 z-10 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-black text-blue-600 tracking-tighter">CoreBiz<span className="text-gray-900">Store</span></h1>
          <div className="flex items-center gap-4">
            <button className="relative p-2 text-gray-600 hover:text-blue-600 transition-colors">
              🛒
              {cartCount > 0 && <span className="absolute top-0 right-0 bg-red-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center transform translate-x-1 -translate-y-1">{cartCount}</span>}
            </button>
          </div>
        </div>
      </nav>

      <div className="bg-blue-600 text-white py-16 px-4 text-center">
        <h2 className="text-4xl font-extrabold mb-4">ค้นพบสินค้าคุณภาพระดับ Enterprise</h2>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {catalogData.map((item) => (
            <div key={item.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-xl transition-all flex flex-col">
              <div className="h-48 bg-gray-50 flex items-center justify-center text-6xl">{item.image}</div>
              <div className="p-5 flex-1 flex flex-col">
                <div className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">{item.category}</div>
                <h4 className="text-lg font-semibold text-gray-900 mb-2 flex-1">{item.name}</h4>
                <div className="flex items-center justify-between mt-4">
                  <span className="text-xl font-bold text-gray-900">฿{item.price.toLocaleString()}</span>
                  <button onClick={() => setCartCount(c => c + 1)} className="w-10 h-10 bg-gray-900 hover:bg-blue-600 text-white rounded-full flex items-center justify-center shadow-sm">+</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
