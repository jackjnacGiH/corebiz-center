"use client";

export default function StorefrontError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="max-w-5xl mx-auto px-4 py-16 text-center">
      <h1 className="text-xl font-bold">โหลดข้อมูลไม่สำเร็จ</h1>
      <p role="alert" className="mt-3 text-neutral-600">ระบบข้อมูลไม่พร้อมชั่วคราว กรุณาลองใหม่อีกครั้ง</p>
      <button type="button" onClick={reset} className="mt-6 rounded-lg bg-[#1696F4] px-5 py-3 font-semibold text-white">ลองใหม่</button>
    </main>
  );
}
