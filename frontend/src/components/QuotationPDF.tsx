import { Document, Page, Text, View, StyleSheet, PDFViewer, Font, pdf } from '@react-pdf/renderer';

// Register Sarabun font for Thai support (Google Fonts CDN)
Font.register({
  family: 'Sarabun',
  fonts: [
    { src: 'https://fonts.gstatic.com/s/sarabun/v15/DtVjJx26TKEr37c9YL5rXFI.ttf', fontWeight: 400 },
    { src: 'https://fonts.gstatic.com/s/sarabun/v15/DtVmJx26TKEr37c9aBBx_nxOQFs.ttf', fontWeight: 700 },
  ],
});

export interface QuoteData {
  code: string;
  customer_name?: string | null;
  customer_address?: string | null;
  customer_tax_id?: string | null;
  created_at: string;
  valid_until?: string | null;
  items: Array<{
    sku: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    total: number;
  }>;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  notes?: string | null;
  /** 'quotation' (ใบเสนอราคา) or 'invoice' (ใบกำกับภาษี) */
  doc_type?: 'quotation' | 'invoice';
}

const styles = StyleSheet.create({
  page: { padding: 36, fontFamily: 'Sarabun', fontSize: 10, color: '#111' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', borderBottom: '2pt solid #4f46e5', paddingBottom: 12, marginBottom: 14 },
  brand: { fontSize: 18, fontWeight: 700, color: '#4f46e5' },
  brandSub: { fontSize: 9, color: '#666', marginTop: 2 },
  docTitleBox: { textAlign: 'right' },
  docTitle: { fontSize: 16, fontWeight: 700 },
  docMeta: { fontSize: 9, color: '#666', marginTop: 4 },

  sectionRow: { flexDirection: 'row', marginBottom: 14, gap: 16 },
  section: { flex: 1 },
  sectionLabel: { fontSize: 8, color: '#999', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  sectionValue: { fontSize: 10, fontWeight: 700, color: '#111' },
  sectionLine: { fontSize: 9, color: '#444', marginTop: 1 },

  table: { border: '1pt solid #e5e7eb', borderRadius: 4, marginBottom: 12 },
  thead: { flexDirection: 'row', backgroundColor: '#f3f4f6', padding: 8, borderBottom: '1pt solid #e5e7eb' },
  th: { fontSize: 9, fontWeight: 700, color: '#374151' },
  trow: { flexDirection: 'row', padding: 8, borderBottom: '1pt solid #f3f4f6' },
  td: { fontSize: 10, color: '#111' },
  colSku:   { width: '14%' },
  colName:  { width: '46%' },
  colQty:   { width: '10%', textAlign: 'right' },
  colPrice: { width: '15%', textAlign: 'right' },
  colTotal: { width: '15%', textAlign: 'right', fontWeight: 700 },

  totalsBox: { marginLeft: 'auto', width: '40%', marginTop: 8 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', padding: '4 8', fontSize: 10 },
  totalRowBold: { flexDirection: 'row', justifyContent: 'space-between', padding: '6 8', fontSize: 12, fontWeight: 700, backgroundColor: '#4f46e5', color: '#fff', borderRadius: 4, marginTop: 4 },

  footer: { marginTop: 24, paddingTop: 12, borderTop: '1pt solid #e5e7eb', fontSize: 8, color: '#888' },
  signaturesRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 28 },
  sigBox: { width: '40%', textAlign: 'center' },
  sigLine: { borderTop: '1pt solid #999', marginTop: 36, paddingTop: 4, fontSize: 9, color: '#666' },
});

function fmt(value: number): string {
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function QuotationDocument({ data }: { data: QuoteData }) {
  const isInvoice = data.doc_type === 'invoice';
  const title = isInvoice ? 'ใบกำกับภาษี / TAX INVOICE' : 'ใบเสนอราคา / QUOTATION';

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.brand}>CoreBiz Center</Text>
            <Text style={styles.brandSub}>Unified Commerce Platform</Text>
            <Text style={styles.brandSub}>www.jnac.online</Text>
          </View>
          <View style={styles.docTitleBox}>
            <Text style={styles.docTitle}>{title}</Text>
            <Text style={styles.docMeta}>เลขที่ / No: {data.code}</Text>
            <Text style={styles.docMeta}>วันที่ / Date: {fmtDate(data.created_at)}</Text>
            {data.valid_until && (
              <Text style={styles.docMeta}>ใช้ได้ถึง / Valid until: {fmtDate(data.valid_until)}</Text>
            )}
          </View>
        </View>

        {/* Customer info */}
        <View style={styles.sectionRow}>
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>ลูกค้า / Customer</Text>
            <Text style={styles.sectionValue}>{data.customer_name ?? '—'}</Text>
            {data.customer_address && <Text style={styles.sectionLine}>{data.customer_address}</Text>}
            {data.customer_tax_id && <Text style={styles.sectionLine}>Tax ID: {data.customer_tax_id}</Text>}
          </View>
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>ผู้ออกเอกสาร / Issued by</Text>
            <Text style={styles.sectionValue}>CoreBiz Center</Text>
            <Text style={styles.sectionLine}>Bangkok HQ, Thailand</Text>
          </View>
        </View>

        {/* Items table */}
        <View style={styles.table}>
          <View style={styles.thead}>
            <Text style={[styles.th, styles.colSku]}>SKU</Text>
            <Text style={[styles.th, styles.colName]}>รายการ / Description</Text>
            <Text style={[styles.th, styles.colQty]}>จำนวน</Text>
            <Text style={[styles.th, styles.colPrice]}>หน่วยละ</Text>
            <Text style={[styles.th, styles.colTotal]}>รวม</Text>
          </View>
          {data.items.map((it, i) => (
            <View key={i} style={styles.trow}>
              <Text style={[styles.td, styles.colSku]}>{it.sku}</Text>
              <Text style={[styles.td, styles.colName]}>{it.product_name}</Text>
              <Text style={[styles.td, styles.colQty]}>{it.quantity}</Text>
              <Text style={[styles.td, styles.colPrice]}>{fmt(it.unit_price)}</Text>
              <Text style={[styles.td, styles.colTotal]}>{fmt(it.total)}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totalsBox}>
          <View style={styles.totalRow}><Text>ยอดสินค้า / Subtotal</Text><Text>{fmt(data.subtotal)}</Text></View>
          {data.discount > 0 && (
            <View style={styles.totalRow}><Text>ส่วนลด / Discount</Text><Text>- {fmt(data.discount)}</Text></View>
          )}
          <View style={styles.totalRow}><Text>ภาษีมูลค่าเพิ่ม 7% / VAT</Text><Text>{fmt(data.vat)}</Text></View>
          <View style={styles.totalRowBold}><Text>ยอดสุทธิ / Grand Total (THB)</Text><Text>{fmt(data.total)}</Text></View>
        </View>

        {/* Notes */}
        {data.notes && (
          <View style={{ marginTop: 14 }}>
            <Text style={styles.sectionLabel}>หมายเหตุ / Notes</Text>
            <Text style={styles.sectionLine}>{data.notes}</Text>
          </View>
        )}

        {/* Signatures */}
        <View style={styles.signaturesRow}>
          <View style={styles.sigBox}>
            <Text style={styles.sigLine}>ผู้รับเอกสาร / Customer Signature</Text>
          </View>
          <View style={styles.sigBox}>
            <Text style={styles.sigLine}>ผู้มีอำนาจลงนาม / Authorized Signature</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          เอกสารนี้สร้างจากระบบ CoreBiz Center อัตโนมัติ — เก็บเป็นหลักฐานทางบัญชีและภาษีได้
        </Text>
      </Page>
    </Document>
  );
}

export function QuotationPreview({ data }: { data: QuoteData }) {
  return (
    <PDFViewer width="100%" height="100%" style={{ border: 'none' }}>
      <QuotationDocument data={data} />
    </PDFViewer>
  );
}

/**
 * Generate a PDF Blob (useful for download or upload).
 */
export async function generateQuotationBlob(data: QuoteData): Promise<Blob> {
  const blob = await pdf(<QuotationDocument data={data} />).toBlob();
  return blob;
}

/**
 * Trigger immediate browser download of the PDF.
 */
export async function downloadQuotation(data: QuoteData) {
  const blob = await generateQuotationBlob(data);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${data.code}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
