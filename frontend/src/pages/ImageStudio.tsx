import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, Check, ChevronDown, Download, ImageIcon,
  Images, Layers3, Loader2, Plus, RotateCcw, Save, Search, Trash2, Upload, Copy,
} from 'lucide-react';
import JSZip from 'jszip';
import PageHeader from '../components/PageHeader';
import { productsApi, type ProductWithInventory } from '../lib/api';
import { uploadProductImage } from '../lib/storage';

type TextAlign = 'left' | 'center' | 'right';
type StickerShape = 'rounded' | 'pill' | 'circle' | 'tag' | 'outline' | 'burst' | 'ribbon' | 'speech';
type TextLayer = {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontWeight: number;
  color: string;
  background: string;
  padding: number;
  paddingX: number;
  paddingY: number;
  radius: number;
  align: TextAlign;
  rotation: number;
  fontFamily: string;
  fontStyle: 'normal' | 'italic';
  backgroundEnabled: boolean;
  backgroundOpacity: number;
  opacity: number;
  borderColor: string;
  borderWidth: number;
  shadow: number;
  letterSpacing: number;
  shape: StickerShape;
};
type ImageStudioProject = { baseImageUrl: string; layers: TextLayer[]; updatedAt: string };

const STORAGE_KEY = 'corebiz-image-studio-v1';
const newLayer = (): TextLayer => ({
  id: crypto.randomUUID(), text: 'สินค้าใหม่', x: 50, y: 14, fontSize: 64,
  fontWeight: 800, color: '#ffffff', background: '#4f46e5', padding: 20, paddingX: 24, paddingY: 10,
  radius: 18, align: 'center', rotation: 0,
  fontFamily: 'Kanit', fontStyle: 'normal', backgroundEnabled: true,
  backgroundOpacity: 100, opacity: 100, borderColor: '#ffffff', borderWidth: 0,
  shadow: 12, letterSpacing: 0, shape: 'rounded',
});

const FONTS = [
  'Kanit', 'Prompt', 'Sarabun', 'Mitr', 'Chakra Petch', 'IBM Plex Sans Thai', 'Noto Sans Thai',
  'Athiti', 'Bai Jamjuree', 'Charm', 'Charmonman', 'Chonburi', 'Fahkwang', 'Itim', 'K2D',
  'Kodchasan', 'KoHo', 'Krub', 'Maitree', 'Mali', 'Niramit', 'Pattaya', 'Pridi', 'Sriracha',
  'Taviraj', 'Thasadith', 'Trirong', 'Anek Thai', 'Anuphan', 'Noto Serif Thai', 'Rasa', 'Srisakdi',
  'Montserrat', 'Poppins', 'DM Sans', 'Oswald', 'Bebas Neue', 'Anton', 'Archivo Black',
  'Barlow Condensed', 'Roboto Slab', 'Playfair Display', 'Pacifico', 'Lobster', 'Fredoka', 'Baloo 2',
  'DynaPuff', 'Chewy', 'Bubblegum Sans', 'Coiny', 'Grandstander', 'Nunito', 'Quicksand',
  'Tahoma', 'Leelawadee UI', 'Angsana New', 'Cordia New', 'Browallia New', 'Arial', 'Arial Black',
  'Calibri', 'Cambria', 'Georgia', 'Impact', 'Trebuchet MS', 'Verdana',
];
const layerDefaults = newLayer();
const normalizeLayer = (layer: TextLayer): TextLayer => ({
  ...layerDefaults, ...layer, id: layer.id,
  paddingX: layer.paddingX ?? layer.padding ?? layerDefaults.paddingX,
  paddingY: layer.paddingY ?? layer.padding ?? layerDefaults.paddingY,
});
const STICKERS: Array<{ name: string; sample: string; style: Partial<TextLayer> }> = [
  { name: 'สินค้าใหม่', sample: 'NEW', style: { text: 'สินค้าใหม่', background: '#2563eb', color: '#ffffff', shape: 'pill', fontFamily: 'Kanit', rotation: -4 } },
  { name: 'ลดแรง', sample: '-30%', style: { text: 'ลด 30%', background: '#ef4444', color: '#ffffff', shape: 'circle', fontFamily: 'Kanit', fontSize: 72, rotation: -8 } },
  { name: 'ขายดี', sample: 'BEST', style: { text: 'ขายดี', background: '#f59e0b', color: '#111827', shape: 'tag', fontFamily: 'Mitr', rotation: 3 } },
  { name: 'พร้อมส่ง', sample: 'READY', style: { text: 'พร้อมส่ง', background: '#16a34a', color: '#ffffff', shape: 'pill', fontFamily: 'Prompt' } },
  { name: 'ของแท้', sample: '100%', style: { text: 'ของแท้ 100%', background: '#0f172a', color: '#facc15', shape: 'circle', borderColor: '#facc15', borderWidth: 5, fontFamily: 'Chakra Petch' } },
  { name: 'ราคาโรงงาน', sample: 'FACTORY', style: { text: 'ราคาโรงงาน', background: '#7c3aed', color: '#ffffff', shape: 'tag', fontFamily: 'Kanit' } },
  { name: 'รุ่นแนะนำ', sample: 'PICK', style: { text: 'รุ่นแนะนำ', background: '#0891b2', color: '#ffffff', shape: 'rounded', fontFamily: 'Prompt', borderColor: '#ffffff', borderWidth: 4 } },
  { name: 'ข้อความล้วน', sample: 'TEXT', style: { text: 'คุณภาพงานช่าง', backgroundEnabled: false, color: '#dc2626', shape: 'outline', fontFamily: 'Kanit', borderColor: '#ffffff', borderWidth: 0, shadow: 0, padding: 0 } },
  { name: 'มาใหม่จ้า', sample: 'NEW!', style: { text: 'มาใหม่จ้า!', background: '#fb7185', color: '#ffffff', shape: 'burst', fontFamily: 'Mali', fontSize: 76, rotation: -8, borderColor: '#ffffff', borderWidth: 5 } },
  { name: 'น่ารักมาก', sample: 'CUTE', style: { text: 'น่ารักมาก', background: '#f9a8d4', color: '#831843', shape: 'speech', fontFamily: 'Itim', fontSize: 68, borderColor: '#ffffff', borderWidth: 4 } },
  { name: 'ช้อปเลย', sample: 'SHOP', style: { text: 'ช้อปเลย!', background: '#a78bfa', color: '#ffffff', shape: 'ribbon', fontFamily: 'Mali', rotation: 2 } },
  { name: 'ดีลพิเศษ', sample: 'DEAL', style: { text: 'ดีลพิเศษ', background: '#fde047', color: '#7c2d12', shape: 'burst', fontFamily: 'Chonburi', fontSize: 70, rotation: -5 } },
  { name: 'มีจำนวนจำกัด', sample: 'LIMIT', style: { text: 'มีจำนวนจำกัด', background: '#f97316', color: '#ffffff', shape: 'ribbon', fontFamily: 'Kanit', fontSize: 60 } },
  { name: 'แนะนำเลย', sample: 'PICK!', style: { text: 'แนะนำเลย!', background: '#22d3ee', color: '#164e63', shape: 'speech', fontFamily: 'Kodchasan', fontSize: 64 } },
  { name: 'คุ้มสุดๆ', sample: 'WOW', style: { text: 'คุ้มสุดๆ', background: '#c4b5fd', color: '#4c1d95', shape: 'burst', fontFamily: 'Sriracha', fontSize: 72, rotation: 7 } },
  { name: 'ของมันต้องมี', sample: 'MUST', style: { text: 'ของมันต้องมี', background: '#fda4af', color: '#881337', shape: 'pill', fontFamily: 'Mali', fontSize: 62, borderColor: '#ffffff', borderWidth: 4 } },
  { name: 'โปรวันนี้', sample: 'TODAY', style: { text: 'โปรวันนี้เท่านั้น', background: '#ef4444', color: '#ffffff', shape: 'ribbon', fontFamily: 'Kanit', fontSize: 58 } },
  { name: 'ส่งฟรี', sample: 'FREE', style: { text: 'ส่งฟรี!', background: '#34d399', color: '#064e3b', shape: 'burst', fontFamily: 'Itim', fontSize: 76 } },
  { name: 'ช่างเลือกใช้', sample: 'PRO', style: { text: 'ช่างเลือกใช้', background: '#334155', color: '#facc15', shape: 'tag', fontFamily: 'Chakra Petch', fontSize: 60, borderColor: '#facc15', borderWidth: 3 } },
  { name: 'งานหนักเอาอยู่', sample: 'TOUGH', style: { text: 'งานหนักเอาอยู่', background: '#1d4ed8', color: '#ffffff', shape: 'ribbon', fontFamily: 'K2D', fontSize: 56 } },
  { name: 'คุณภาพพรีเมียม', sample: 'PREM', style: { text: 'คุณภาพพรีเมียม', background: '#111827', color: '#fbbf24', shape: 'pill', fontFamily: 'Noto Serif Thai', fontSize: 56, borderColor: '#fbbf24', borderWidth: 3 } },
  { name: 'รับประกัน', sample: 'OK', style: { text: 'รับประกันคุณภาพ', background: '#0f766e', color: '#ffffff', shape: 'circle', fontFamily: 'Prompt', fontSize: 58, borderColor: '#5eead4', borderWidth: 5 } },
  { name: 'WOW สดใส', sample: 'WOW!', style: { text: 'WOW!', background: '#e879f9', color: '#ffffff', shape: 'burst', fontFamily: 'Fredoka', fontSize: 90, rotation: -10 } },
  { name: 'Best Choice', sample: 'BEST', style: { text: 'BEST CHOICE', background: '#60a5fa', color: '#ffffff', shape: 'speech', fontFamily: 'DynaPuff', fontSize: 62 } },
];

function shapeClipPath(shape?: StickerShape): string | undefined {
  if (shape === 'tag') return 'polygon(12% 0,100% 0,88% 50%,100% 100%,12% 100%,0 50%)';
  if (shape === 'ribbon') return 'polygon(0 12%,10% 12%,10% 0,90% 0,90% 12%,100% 12%,92% 50%,100% 88%,90% 88%,90% 100%,10% 100%,10% 88%,0 88%,8% 50%)';
  if (shape === 'speech') return 'polygon(0 0,100% 0,100% 78%,62% 78%,50% 100%,44% 78%,0 78%)';
  if (shape === 'burst') return 'polygon(50% 0,61% 18%,78% 5%,80% 26%,100% 22%,88% 42%,100% 50%,84% 61%,95% 78%,74% 78%,72% 100%,54% 85%,40% 100%,34% 80%,12% 91%,18% 68%,0 60%,18% 47%,4% 31%,27% 30%,25% 8%,43% 21%)';
  return undefined;
}

function getImages(product: ProductWithInventory): string[] {
  return Array.isArray(product.images)
    ? product.images.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
}

function getStudioProject(product: ProductWithInventory): ImageStudioProject | null {
  if (!product.spec || typeof product.spec !== 'object' || Array.isArray(product.spec)) return null;
  const value = (product.spec as Record<string, unknown>).image_studio;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const project = value as Record<string, unknown>;
  if (typeof project.baseImageUrl !== 'string' || !Array.isArray(project.layers)) return null;
  return { baseImageUrl: project.baseImageUrl, layers: (project.layers as TextLayer[]).map(normalizeLayer), updatedAt: typeof project.updatedAt === 'string' ? project.updatedAt : '' };
}

function getSpecRecord(product: ProductWithInventory): Record<string, unknown> {
  return product.spec && typeof product.spec === 'object' && !Array.isArray(product.spec)
    ? { ...(product.spec as Record<string, unknown>) }
    : {};
}

function drawStickerShape(ctx: CanvasRenderingContext2D, layer: TextLayer, width: number, height: number, radius: number) {
  if (layer.shape === 'burst') {
    const points = 24; ctx.beginPath();
    for (let i = 0; i < points; i++) { const angle = -Math.PI / 2 + (i * Math.PI * 2) / points; const outer = i % 2 === 0; const x = Math.cos(angle) * width / 2 * (outer ? 1 : .78); const y = Math.sin(angle) * height / 2 * (outer ? 1 : .72); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.closePath();
  } else if (layer.shape === 'ribbon') {
    ctx.beginPath(); ctx.moveTo(-width / 2, -height * .32); ctx.lineTo(-width * .4, -height * .32); ctx.lineTo(-width * .4, -height / 2); ctx.lineTo(width * .4, -height / 2); ctx.lineTo(width * .4, -height * .32); ctx.lineTo(width / 2, -height * .32); ctx.lineTo(width * .44, 0); ctx.lineTo(width / 2, height * .32); ctx.lineTo(width * .4, height * .32); ctx.lineTo(width * .4, height / 2); ctx.lineTo(-width * .4, height / 2); ctx.lineTo(-width * .4, height * .32); ctx.lineTo(-width / 2, height * .32); ctx.lineTo(-width * .44, 0); ctx.closePath();
  } else if (layer.shape === 'speech') {
    ctx.beginPath(); ctx.roundRect(-width / 2, -height / 2, width, height * .82, radius); ctx.moveTo(-width * .05, height * .32); ctx.lineTo(width * .04, height / 2); ctx.lineTo(width * .14, height * .32); ctx.closePath();
  } else if (layer.shape === 'tag') {
    const notch = Math.min(height * .28, width * .12);
    ctx.beginPath(); ctx.moveTo(-width / 2 + notch, -height / 2); ctx.lineTo(width / 2, -height / 2);
    ctx.lineTo(width / 2 - notch, 0); ctx.lineTo(width / 2, height / 2); ctx.lineTo(-width / 2 + notch, height / 2);
    ctx.lineTo(-width / 2, 0); ctx.closePath();
  } else {
    const r = layer.shape === 'pill' || layer.shape === 'circle' ? height / 2 : radius;
    ctx.beginPath(); ctx.roundRect(-width / 2, -height / 2, width, height, r);
  }
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('โหลดรูปภาพไม่สำเร็จ'));
    image.src = url;
  });
}

async function renderProduct(product: ProductWithInventory, layers: TextLayer[], sourceUrl?: string): Promise<Blob> {
  const url = sourceUrl ?? getImages(product)[0];
  if (!url) throw new Error(`${product.sku} ไม่มีภาพหลัก`);
  const image = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('เบราว์เซอร์ไม่รองรับ Canvas');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  const scale = canvas.width / 1080;

  await document.fonts.ready;
  for (const rawLayer of layers) {
    const layer = normalizeLayer(rawLayer);
    const fontSize = layer.fontSize * scale;
    const paddingX = layer.paddingX * scale;
    const paddingY = layer.paddingY * scale;
    ctx.save();
    ctx.globalAlpha = layer.opacity / 100;
    ctx.font = `${layer.fontStyle} ${layer.fontWeight} ${fontSize}px "${layer.fontFamily}", "Noto Sans Thai", sans-serif`;
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${layer.letterSpacing * scale}px`;
    ctx.textAlign = layer.align;
    ctx.textBaseline = 'middle';
    const metrics = ctx.measureText(layer.text);
    const boxWidth = metrics.width + paddingX * 2;
    const boxHeight = Math.max(2 * scale, fontSize * 1.2 + paddingY * 2);
    const centerX = (layer.x / 100) * canvas.width;
    const centerY = (layer.y / 100) * canvas.height;
    ctx.translate(centerX, centerY);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    if (layer.backgroundEnabled) {
      ctx.shadowColor = layer.shadow ? 'rgba(15,23,42,.45)' : 'transparent';
      ctx.shadowBlur = layer.shadow * scale; ctx.shadowOffsetY = layer.shadow * .3 * scale;
      drawStickerShape(ctx, layer, boxWidth, boxHeight, layer.radius * scale);
      ctx.fillStyle = hexWithAlpha(layer.background, layer.backgroundOpacity / 100); ctx.fill();
      if (layer.borderWidth > 0) { ctx.strokeStyle = layer.borderColor; ctx.lineWidth = layer.borderWidth * scale; ctx.stroke(); }
    }
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = layer.color;
    if (!layer.backgroundEnabled && layer.shadow > 0) {
      ctx.shadowColor = 'rgba(15,23,42,.45)'; ctx.shadowBlur = layer.shadow * scale; ctx.shadowOffsetY = layer.shadow * .3 * scale;
    }
    const textX = layer.align === 'left' ? -metrics.width / 2 : layer.align === 'right' ? metrics.width / 2 : 0;
    ctx.fillText(layer.text, textX, 0);
    ctx.restore();
  }

  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('สร้างไฟล์ไม่สำเร็จ')), 'image/jpeg', 0.94));
}

function hexWithAlpha(hex: string, opacity: number) {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16); const g = Number.parseInt(value.slice(2, 4), 16); const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

export default function ImageStudio() {
  const [products, setProducts] = useState<ProductWithInventory[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [layers, setLayers] = useState<TextLayer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState('');
  const [previewId, setPreviewId] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState('');
  const [sourceImages, setSourceImages] = useState<Record<string, string>>({});
  const [dragLayerId, setDragLayerId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; layerId: string } | null>(null);
  const hydrated = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { layers?: TextLayer[]; selected?: string[] };
        if (parsed.layers?.length) {
          const restored = parsed.layers.map(normalizeLayer);
          setLayers(restored); setActiveLayerId(restored[0]?.id ?? '');
        }
        if (parsed.selected) setSelected(new Set(parsed.selected));
      } catch { localStorage.removeItem(STORAGE_KEY); }
    }
    hydrated.current = true;
    productsApi.list().then(rows => {
      const withImages = rows.filter(row => getImages(row).length > 0);
      setProducts(withImages);
      setPreviewId(withImages[0]?.id ?? '');
      setSourceImages(Object.fromEntries(withImages.map(product => [product.id, getStudioProject(product)?.baseImageUrl ?? getImages(product)[0]])));
    }).catch(error => setMessage((error as Error).message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return products;
    return products.filter(product => `${product.sku} ${product.name_th} ${product.name_en ?? ''}`.toLowerCase().includes(query));
  }, [products, search]);
  const preview = products.find(product => product.id === previewId) ?? products.find(product => selected.has(product.id)) ?? products[0];
  const activeLayer = layers.find(layer => layer.id === activeLayerId) ?? layers[0];

  function updateLayer(patch: Partial<TextLayer>) {
    if (!activeLayer) return;
    setLayers(current => current.map(layer => layer.id === activeLayer.id ? { ...layer, ...patch } : layer));
  }

  function applySticker(style: Partial<TextLayer>) {
    const layer = { ...newLayer(), ...style, id: crypto.randomUUID(), x: 50, y: 16 };
    setLayers(current => [...current, layer]); setActiveLayerId(layer.id);
  }

  function removeLayer(id: string) {
    const next = layers.filter(layer => layer.id !== id);
    if (next.length === 0) { const layer = newLayer(); setLayers([layer]); setActiveLayerId(layer.id); }
    else { setLayers(next); if (activeLayerId === id) setActiveLayerId(next[0].id); }
    setContextMenu(null);
  }

  function duplicateLayer(id: string) {
    const source = layers.find(layer => layer.id === id); if (!source) return;
    const copy = { ...normalizeLayer(source), id: crypto.randomUUID(), x: Math.min(95, source.x + 4), y: Math.min(95, source.y + 4) };
    setLayers(current => [...current, copy]); setActiveLayerId(copy.id); setContextMenu(null);
  }

  function moveLayer(event: React.PointerEvent<HTMLDivElement>, id: string) {
    if (dragLayerId !== id || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
    setLayers(current => current.map(layer => layer.id === id ? { ...layer, x, y } : layer));
  }

  function saveDraft() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ layers, selected: [...selected] }));
    setMessage('บันทึกแบบร่างบนเครื่องนี้แล้ว');
    window.setTimeout(() => setMessage(''), 2500);
  }

  function resetDraft() {
    setLayers([]); setActiveLayerId(''); setSelected(new Set());
    localStorage.removeItem(STORAGE_KEY); setMessage('เริ่มแบบร่างใหม่แล้ว');
  }

  function toggleProduct(id: string) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setPreviewId(id);
  }

  async function exportZip() {
    const targets = products.filter(product => selected.has(product.id));
    if (!targets.length) { setMessage('กรุณาเลือกสินค้าอย่างน้อย 1 รายการ'); return; }
    setExporting(true); setMessage('กำลังสร้างภาพ...');
    try {
      const zip = new JSZip();
      for (const product of targets) {
        const blob = await renderProduct(product, layers, sourceImages[product.id]);
        zip.file(`${product.sku.replace(/[^a-zA-Z0-9_-]/g, '_')}-edited.jpg`, blob);
      }
      const archive = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(archive);
      link.download = `corebiz-images-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click(); URL.revokeObjectURL(link.href);
      setMessage(`ดาวน์โหลดภาพ ${targets.length} รายการแล้ว`);
    } catch (error) { setMessage((error as Error).message); }
    finally { setExporting(false); }
  }

  async function publishAsPrimaryImages() {
    const targets = products.filter(product => selected.has(product.id));
    if (!targets.length) { setMessage('กรุณาเลือกสินค้าอย่างน้อย 1 รายการ'); return; }
    if (!window.confirm(`ใช้ภาพที่แต่งแล้วเป็นภาพหลักของสินค้า ${targets.length} รายการ?\n\nภาพหลักเดิมจะถูกเก็บไว้เป็นภาพลำดับถัดไป และการเปลี่ยนแปลงจะแสดงทั่วทั้งระบบ`)) return;
    setPublishing(true); setMessage(`กำลังอัปเดตภาพสินค้า 0/${targets.length}...`);
    try {
      for (let index = 0; index < targets.length; index++) {
        const product = targets[index];
        const baseImageUrl = sourceImages[product.id] ?? getStudioProject(product)?.baseImageUrl ?? getImages(product)[0];
        const blob = await renderProduct(product, layers, baseImageUrl);
        const file = new File([blob], `${product.sku}-edited.jpg`, { type: 'image/jpeg' });
        const publicUrl = await uploadProductImage(file, product.id);
        const originals = getImages(product).filter(url => url !== publicUrl);
        const spec = { ...getSpecRecord(product), image_studio: { baseImageUrl, layers: layers.map(normalizeLayer), updatedAt: new Date().toISOString() } };
        await productsApi.update(product.id, { images: [publicUrl, ...originals], spec });
        setProducts(current => current.map(row => row.id === product.id ? { ...row, images: [publicUrl, ...originals], spec } : row));
        setMessage(`กำลังอัปเดตภาพสินค้า ${index + 1}/${targets.length}...`);
      }
      setMessage(`อัปเดตภาพหลักสำเร็จ ${targets.length} รายการ ภาพใหม่ถูกใช้ทั่วทั้งระบบแล้ว`);
    } catch (error) { setMessage(`อัปเดตไม่สำเร็จ: ${(error as Error).message}`); }
    finally { setPublishing(false); }
  }

  const previewUrl = preview ? (sourceImages[preview.id] ?? getImages(preview)[0]) : '';
  const previewProject = preview ? getStudioProject(preview) : null;

  function loadSavedProject() {
    if (!preview || !previewProject) return;
    setLayers(previewProject.layers); setActiveLayerId(previewProject.layers[0]?.id ?? '');
    setSourceImages(current => ({ ...current, [preview.id]: previewProject.baseImageUrl }));
    setMessage('โหลดงานแก้ไขเดิมแล้ว สามารถคลิกข้อความและปรับแต่งต่อได้');
  }

  function rebuildFromOriginal() {
    if (!preview) return;
    const images = getImages(preview); const original = images[1] ?? images[0];
    const layer = { ...newLayer(), text: 'แก้ไขข้อความ' };
    setSourceImages(current => ({ ...current, [preview.id]: original }));
    setLayers([layer]); setActiveLayerId(layer.id);
    setMessage('นำภาพต้นฉบับกลับมาแล้ว กรุณาเปลี่ยนข้อความในแผงด้านขวา');
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-5">
      <PageHeader
        title="แต่งภาพสินค้า"
        subtitle="เพิ่มข้อความเป็นเลเยอร์บนภาพหลักหลายสินค้า แล้วดาวน์โหลดพร้อมกัน"
        icon={<Images size={20} />}
        actions={<>
          <button onClick={resetDraft} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"><RotateCcw size={15} /> เริ่มใหม่</button>
          <button onClick={saveDraft} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-sm font-medium text-indigo-700 hover:bg-indigo-100"><Save size={15} /> บันทึกแบบร่าง</button>
          <button onClick={() => void publishAsPrimaryImages()} disabled={publishing || selected.size === 0} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">{publishing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} ใช้เป็นภาพสินค้าหลัก</button>
          <button onClick={() => void exportZip()} disabled={exporting || selected.size === 0} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} ดาวน์โหลด {selected.size || ''} ภาพ
          </button>
        </>}
      />

      {message && <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-indigo-700">{message}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[300px_minmax(420px,1fr)_330px] gap-5 items-start">
        <section className="rounded-xl border border-slate-200 bg-white overflow-hidden xl:sticky xl:top-4">
          <div className="p-4 border-b border-slate-200">
            <div className="flex items-center justify-between mb-3"><h2 className="font-semibold text-slate-900">เลือกสินค้า</h2><span className="text-xs font-semibold text-indigo-600">{selected.size} รายการ</span></div>
            <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="ค้นหา SKU หรือชื่อสินค้า" className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-400" /></div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => setSelected(new Set(filtered.map(product => product.id)))} className="text-xs font-medium text-indigo-600 hover:underline">เลือกทั้งหมดที่แสดง</button>
              <button onClick={() => setSelected(new Set())} className="text-xs text-slate-500 hover:underline">ล้าง</button>
            </div>
          </div>
          <div className="max-h-[62vh] overflow-y-auto p-2 space-y-1">
            {loading && <div className="py-12 grid place-items-center"><Loader2 className="animate-spin text-indigo-500" /></div>}
            {!loading && filtered.map(product => {
              const checked = selected.has(product.id);
              return <button key={product.id} onClick={() => toggleProduct(product.id)} className={`w-full flex items-center gap-3 p-2 rounded-lg text-left border ${checked ? 'border-indigo-300 bg-indigo-50' : 'border-transparent hover:bg-slate-50'}`}>
                <span className={`w-5 h-5 rounded border grid place-items-center flex-none ${checked ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 bg-white'}`}>{checked && <Check size={13} />}</span>
                <img src={getImages(product)[0]} alt="" className="w-11 h-11 rounded-md border border-slate-200 object-cover bg-white" />
                <span className="min-w-0"><span className="block text-xs font-mono text-slate-500">{product.sku}</span><span className="block text-sm font-medium text-slate-800 truncate">{product.name_th}</span></span>
              </button>;
            })}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-100 p-4 md:p-6 xl:sticky xl:top-4">
          <div className="flex items-center justify-between mb-4">
            <div><h2 className="font-semibold text-slate-900">ตัวอย่าง</h2><p className="text-xs text-slate-500 mt-0.5">{preview ? `${preview.sku} — ${preview.name_th}` : 'ยังไม่มีภาพสินค้า'}</p></div>
            {preview && <div className="relative"><select value={preview.id} onChange={event => setPreviewId(event.target.value)} className="appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 py-2 text-xs"><option value={preview.id}>เปลี่ยนภาพตัวอย่าง</option>{products.filter(p => selected.has(p.id) && p.id !== preview.id).map(p => <option key={p.id} value={p.id}>{p.sku}</option>)}</select><ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" /></div>}
          </div>
          {preview && <div className="mb-3 flex flex-wrap items-center gap-2">{previewProject ? <button onClick={loadSavedProject} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100">โหลดงานแก้ไขเดิม</button> : getImages(preview).length > 1 ? <button onClick={rebuildFromOriginal} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100">สร้างงานแก้ไขจากภาพต้นฉบับ</button> : null}<span className="text-[11px] text-slate-500">{previewProject ? 'มีข้อมูลเลเยอร์ที่บันทึกไว้' : 'ภาพรุ่นเก่าไม่มีข้อมูลเลเยอร์ ต้องสร้างข้อความใหม่'}</span></div>}
          <div ref={canvasRef} onPointerDown={event => { if (event.target === event.currentTarget) setActiveLayerId(''); }} className="mx-auto relative aspect-square w-full max-w-[680px] overflow-hidden rounded-lg bg-white shadow-sm [container-type:inline-size] touch-none select-none">
            {previewUrl ? <img src={previewUrl} alt={preview?.name_th ?? ''} draggable={false} className="absolute inset-0 w-full h-full object-contain pointer-events-none" /> : <div className="absolute inset-0 grid place-items-center text-slate-400"><ImageIcon size={40} /></div>}
            {layers.map(rawLayer => { const layer = normalizeLayer(rawLayer); return <div key={layer.id} onClick={() => setActiveLayerId(layer.id)} onPointerDown={event => { event.stopPropagation(); setActiveLayerId(layer.id); setDragLayerId(layer.id); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => moveLayer(event, layer.id)} onPointerUp={event => { setDragLayerId(null); event.currentTarget.releasePointerCapture(event.pointerId); }} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setActiveLayerId(layer.id); setContextMenu({ x: event.clientX, y: event.clientY, layerId: layer.id }); }} className={`absolute cursor-grab active:cursor-grabbing whitespace-nowrap ${layer.id === activeLayerId ? 'outline outline-2 outline-dashed outline-indigo-400 outline-offset-4' : ''}`} style={{ left: `${layer.x}%`, top: `${layer.y}%`, transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`, color: layer.color, backgroundColor: 'transparent', backgroundImage: layer.backgroundEnabled ? `linear-gradient(${hexWithAlpha(layer.background, layer.backgroundOpacity / 100)}, ${hexWithAlpha(layer.background, layer.backgroundOpacity / 100)})` : undefined, backgroundPosition: 'center', backgroundRepeat: 'no-repeat', backgroundSize: layer.paddingY < 0 ? `100% calc(100% + ${layer.paddingY * 2 / 10}cqw)` : '100% 100%', padding: layer.backgroundEnabled ? `${Math.max(0, layer.paddingY) / 10}cqw ${layer.paddingX / 10}cqw` : 0, borderRadius: layer.shape === 'pill' || layer.shape === 'circle' ? '999px' : `${layer.radius / 10}cqw`, clipPath: shapeClipPath(layer.shape), border: layer.backgroundEnabled && layer.borderWidth && layer.paddingY >= 0 ? `${layer.borderWidth / 10}cqw solid ${layer.borderColor}` : undefined, boxShadow: layer.backgroundEnabled && layer.shadow && layer.paddingY >= 0 ? `0 ${layer.shadow / 25}cqw ${layer.shadow / 10}cqw rgba(15,23,42,.35)` : undefined, textShadow: !layer.backgroundEnabled && layer.shadow ? `0 ${layer.shadow / 30}cqw ${layer.shadow / 12}cqw rgba(15,23,42,.45)` : undefined, fontFamily: `'${layer.fontFamily}', sans-serif`, fontStyle: layer.fontStyle, fontSize: `${layer.fontSize / 10}cqw`, lineHeight: 1.2, fontWeight: layer.fontWeight, letterSpacing: `${layer.letterSpacing / 10}cqw`, textAlign: layer.align, opacity: layer.opacity / 100 }}>{layer.text}</div>; })}
          </div>
          <p className="mt-3 text-center text-xs text-slate-500">ลากข้อความเพื่อย้ายตำแหน่ง • คลิกขวาที่ข้อความเพื่อเปิดเมนูลัด</p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white overflow-hidden xl:sticky xl:top-4 xl:h-[calc(100vh-2rem)] flex flex-col">
          <details className="shrink-0 border-b border-slate-200" open><summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-900 flex items-center justify-between">Sticker Templates <span className="flex items-center gap-2 text-xs font-normal text-indigo-600">{STICKERS.length} แบบ <ChevronDown size={14} /></span></summary><div className="px-4 pb-4"><p className="text-[11px] text-slate-500 mb-3">คลิกเพื่อเพิ่มเป็นเลเยอร์ใหม่</p><div className="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto pr-1">{STICKERS.map(sticker => <button key={sticker.name} onClick={() => applySticker(sticker.style)} className="group rounded-lg border border-slate-200 p-1.5 hover:border-indigo-400 hover:bg-indigo-50" title={sticker.name}><span className="grid place-items-center h-10 rounded-md text-[9px] font-extrabold" style={{ color: sticker.style.color, background: sticker.style.backgroundEnabled === false ? '#f1f5f9' : sticker.style.background, borderRadius: sticker.style.shape === 'pill' || sticker.style.shape === 'circle' ? 999 : 6, clipPath: shapeClipPath(sticker.style.shape), fontFamily: sticker.style.fontFamily }}>{sticker.sample}</span><span className="block mt-1 text-[9px] text-slate-500 truncate group-hover:text-indigo-700">{sticker.name}</span></button>)}</div></div></details>
          <div className="flex items-center justify-between p-4 border-b border-slate-200"><div className="flex items-center gap-2"><Layers3 size={17} className="text-indigo-600" /><h2 className="font-semibold text-slate-900">เลเยอร์ข้อความ</h2></div><button onClick={() => { const layer = newLayer(); setLayers(current => [...current, layer]); setActiveLayerId(layer.id); }} className="p-1.5 rounded-md text-indigo-600 hover:bg-indigo-50" title="เพิ่มเลเยอร์"><Plus size={17} /></button></div>
          <div className="shrink-0 max-h-28 overflow-y-auto p-3 border-b border-slate-200 space-y-1">{layers.length === 0 ? <div className="px-2 py-3 text-center text-xs text-slate-400">ยังไม่มีเลเยอร์ — กด + หรือเลือก Template</div> : layers.map((layer, index) => <button key={layer.id} onClick={() => setActiveLayerId(layer.id)} className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left ${layer.id === activeLayerId ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50 text-slate-700'}`}><Layers3 size={14} /><span className="flex-1 truncate">{layer.text || `ข้อความ ${index + 1}`}</span>{layer.id === activeLayerId && <Check size={13} />}</button>)}</div>
          {activeLayer ? <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
            <label className="block"><span className="block text-xs font-medium text-slate-600 mb-1.5">ข้อความ</span><textarea value={activeLayer.text} onChange={event => updateLayer({ text: event.target.value.replace(/\n/g, ' ') })} rows={2} className="w-full resize-none rounded-lg border border-slate-200 p-2.5 text-sm outline-none focus:border-indigo-400" /></label>
            <div className="grid grid-cols-2 gap-3"><SelectField label="ฟอนต์" value={activeLayer.fontFamily} options={FONTS} onChange={fontFamily => updateLayer({ fontFamily })} /><SelectField label="รูปแบบ" value={activeLayer.fontStyle} options={['normal','italic']} labels={['ปกติ','ตัวเอียง']} onChange={fontStyle => updateLayer({ fontStyle: fontStyle as TextLayer['fontStyle'] })} /></div>
            <div className="grid grid-cols-2 gap-3"><SelectField label="ทรงสติ๊กเกอร์" value={activeLayer.shape} options={['rounded','pill','circle','tag','burst','ribbon','speech','outline']} labels={['สี่เหลี่ยมมน','แคปซูล','วงกลม','ป้ายแท็ก','ดาวกระจาย','ริบบิ้น','คำพูด','ข้อความล้วน']} onChange={shape => updateLayer({ shape: shape as StickerShape, backgroundEnabled: shape !== 'outline' })} /><RangeField label="ระยะตัวอักษร" value={activeLayer.letterSpacing} min={-2} max={12} suffix=" px" onChange={letterSpacing => updateLayer({ letterSpacing })} /></div>
            <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"><span className="text-xs font-medium text-slate-700">ใช้พื้นหลังข้อความ</span><input type="checkbox" checked={activeLayer.backgroundEnabled} onChange={event => updateLayer({ backgroundEnabled: event.target.checked })} className="w-4 h-4 accent-indigo-600" /></label>
            <div className="grid grid-cols-2 gap-3"><ColorField label="สีตัวอักษร" value={activeLayer.color} onChange={color => updateLayer({ color })} /><ColorField label="สีพื้นหลัง" value={activeLayer.background} onChange={background => updateLayer({ background })} /></div>
            <div className="grid grid-cols-2 gap-3"><ColorField label="สีเส้นขอบ" value={activeLayer.borderColor} onChange={borderColor => updateLayer({ borderColor })} /><RangeField label="ความหนาขอบ" value={activeLayer.borderWidth} min={0} max={12} suffix=" px" onChange={borderWidth => updateLayer({ borderWidth })} /></div>
            <div className="grid grid-cols-2 gap-3"><RangeField label="ความโปร่งใสพื้น" value={activeLayer.backgroundOpacity} min={0} max={100} suffix="%" onChange={backgroundOpacity => updateLayer({ backgroundOpacity })} /><RangeField label="ความโปร่งใสรวม" value={activeLayer.opacity} min={10} max={100} suffix="%" onChange={opacity => updateLayer({ opacity })} /></div>
            <RangeField label="เงา" value={activeLayer.shadow} min={0} max={30} suffix=" px" onChange={shadow => updateLayer({ shadow })} />
            <RangeField label="ขนาดตัวอักษร" value={activeLayer.fontSize} min={20} max={1400} step={5} suffix=" px" onChange={fontSize => updateLayer({ fontSize })} />
            <div className="grid grid-cols-2 gap-3"><RangeField label="ความกว้างกรอบ" value={activeLayer.paddingX} min={0} max={100} suffix=" px" onChange={paddingX => updateLayer({ paddingX })} /><RangeField label="ความสูงกรอบ" value={activeLayer.paddingY} min={-50} max={80} suffix=" px" onChange={paddingY => updateLayer({ paddingY })} /></div>
            <RangeField label="ตำแหน่งแนวนอน" value={activeLayer.x} min={5} max={95} suffix="%" onChange={x => updateLayer({ x })} />
            <RangeField label="ตำแหน่งแนวตั้ง" value={activeLayer.y} min={5} max={95} suffix="%" onChange={y => updateLayer({ y })} />
            <div className="grid grid-cols-2 gap-3"><RangeField label="ความหนา" value={activeLayer.fontWeight} min={300} max={900} step={100} onChange={fontWeight => updateLayer({ fontWeight })} /><RangeField label="หมุน" value={activeLayer.rotation} min={-30} max={30} suffix="°" onChange={rotation => updateLayer({ rotation })} /></div>
            <div><span className="block text-xs font-medium text-slate-600 mb-1.5">จัดแนวข้อความ</span><div className="grid grid-cols-3 rounded-lg border border-slate-200 overflow-hidden">{(['left','center','right'] as TextAlign[]).map(align => <button key={align} onClick={() => updateLayer({ align })} className={`grid place-items-center py-2 ${activeLayer.align === align ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}>{align === 'left' ? <AlignLeft size={16} /> : align === 'center' ? <AlignCenter size={16} /> : <AlignRight size={16} />}</button>)}</div></div>
            <button onClick={() => removeLayer(activeLayer.id)} className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 py-2 text-sm font-medium text-red-600 hover:bg-red-50"><Trash2 size={14} /> ลบเลเยอร์นี้</button>
          </div> : <div className="min-h-0 flex-1 grid place-items-center p-6 text-center"><div><Layers3 size={32} className="mx-auto text-slate-300 mb-3" /><p className="text-sm font-medium text-slate-600">เริ่มจากเพิ่มเลเยอร์</p><p className="mt-1 text-xs text-slate-400">กดปุ่ม + หรือเลือก Sticker Template ด้านบน</p></div></div>}
        </section>
      </div>
      {contextMenu && <ContextMenu menu={contextMenu} layer={normalizeLayer(layers.find(layer => layer.id === contextMenu.layerId) ?? newLayer())} onPatch={patch => { setLayers(current => current.map(layer => layer.id === contextMenu.layerId ? { ...layer, ...patch } : layer)); }} onDuplicate={() => duplicateLayer(contextMenu.layerId)} onDelete={() => removeLayer(contextMenu.layerId)} />}
    </div>
  );
}

function ContextMenu({ menu, layer, onPatch, onDuplicate, onDelete }: { menu: { x: number; y: number }; layer: TextLayer; onPatch: (patch: Partial<TextLayer>) => void; onDuplicate: () => void; onDelete: () => void }) {
  const colors = ['#ffffff','#111827','#2563eb','#7c3aed','#dc2626','#f59e0b','#16a34a','#0891b2'];
  return <div onPointerDown={event => event.stopPropagation()} className="fixed z-[100] w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-2xl" style={{ left: Math.min(menu.x, window.innerWidth - 272), top: Math.min(menu.y, window.innerHeight - 340) }}>
    <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">เมนูลัดข้อความ</div>
    <label className="block px-2 py-1.5"><span className="text-[11px] text-slate-500">ฟอนต์</span><select value={layer.fontFamily} onChange={event => onPatch({ fontFamily: event.target.value })} className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs">{FONTS.map(font => <option key={font} value={font}>{font}</option>)}</select></label>
    <div className="px-2 py-1.5"><span className="text-[11px] text-slate-500">สีตัวอักษร</span><div className="mt-1.5 flex flex-wrap gap-1.5">{colors.map(color => <button key={color} onClick={() => onPatch({ color })} className="w-6 h-6 rounded-full border border-slate-300" style={{ background: color }} title={color} />)}</div></div>
    <label className="flex items-center justify-between px-2 py-2 text-xs text-slate-700"><span>พื้นหลังข้อความ</span><input type="checkbox" checked={layer.backgroundEnabled} onChange={event => onPatch({ backgroundEnabled: event.target.checked })} className="accent-indigo-600" /></label>
    <div className="my-1 border-t border-slate-100" />
    <button onClick={onDuplicate} className="w-full flex items-center gap-2 rounded-md px-2 py-2 text-xs text-slate-700 hover:bg-slate-50"><Copy size={14} /> ทำสำเนาเลเยอร์</button>
    <button onClick={onDelete} className="w-full flex items-center gap-2 rounded-md px-2 py-2 text-xs text-red-600 hover:bg-red-50"><Trash2 size={14} /> ลบเลเยอร์</button>
  </div>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label><span className="block text-xs font-medium text-slate-600 mb-1.5">{label}</span><div className="flex items-center gap-2 rounded-lg border border-slate-200 p-1.5"><input type="color" value={value} onChange={event => onChange(event.target.value)} className="w-8 h-7 rounded border-0 p-0 bg-transparent" /><span className="text-xs font-mono text-slate-500">{value}</span></div></label>;
}

function SelectField({ label, value, options, labels, onChange }: { label: string; value: string; options: string[]; labels?: string[]; onChange: (value: string) => void }) {
  return <label><span className="block text-xs font-medium text-slate-600 mb-1.5">{label}</span><select value={value} onChange={event => onChange(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs outline-none focus:border-indigo-400" style={label === 'ฟอนต์' ? { fontFamily: value } : undefined}>{options.map((option, index) => <option key={option} value={option} style={{ fontFamily: option }}>{labels?.[index] ?? option}</option>)}</select></label>;
}

function RangeField({ label, value, min, max, step = 1, suffix = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void }) {
  return <label className="block"><span className="flex justify-between text-xs font-medium text-slate-600 mb-1.5"><span>{label}</span><span className="font-mono text-slate-500">{value}{suffix}</span></span><input type="range" value={value} min={min} max={max} step={step} onChange={event => onChange(Number(event.target.value))} className="w-full accent-indigo-600" /></label>;
}
