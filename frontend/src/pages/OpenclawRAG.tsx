import { useState, type FormEvent, type ChangeEvent } from 'react';
import { Upload, Link as LinkIcon, FileText, FileImage, Youtube, HardDriveUpload, CheckCircle, AlertCircle } from 'lucide-react';

const OpenclawRAG = () => {
    const [uploadMode, setUploadMode] = useState<'files' | 'links'>('files');
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [links, setLinks] = useState([{ type: 'website', url: '' }]);
    const [isUploading, setIsUploading] = useState(false);
    const [statusText, setStatusText] = useState('');

    const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            setSelectedFiles(Array.from(e.target.files));
        }
    };

    const handleLinkChange = (index: number, field: string, value: string) => {
        const newLinks = [...links];
        if (field === 'type' && (value === 'website' || value === 'youtube')) {
            newLinks[index].type = value;
        } else if (field === 'url') {
            newLinks[index].url = value;
        }
        setLinks(newLinks);
    };

    const addLinkField = () => {
        setLinks([...links, { type: 'website', url: '' }]);
    };

    const removeLinkField = (index: number) => {
        const newLinks = [...links];
        newLinks.splice(index, 1);
        setLinks(newLinks);
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setIsUploading(true);
        setStatusText('กำลังอัปโหลดข้อมูลไปยัง Openclaw RAG...');

        try {
            if (uploadMode === 'files') {
                if (selectedFiles.length === 0) {
                    throw new Error('กรุณาเลือกไฟล์ที่ต้องการอัปโหลด');
                }
                const formData = new FormData();
                selectedFiles.forEach((file) => {
                    formData.append('documents', file);
                });

                const response = await fetch('http://localhost:3001/api/upload', {
                    method: 'POST',
                    body: formData,
                });

                if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
            } else {
                const validLinks = links.filter(link => link.url.trim() !== '');
                if (validLinks.length === 0) {
                    throw new Error('กรุณากรอกลิงก์ที่ต้องการเพิ่ม');
                }

                const response = await fetch('http://localhost:3001/api/links', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ links: validLinks }),
                });

                if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
            }

            setStatusText('✅ นำเข้าข้อมูลสู่ระบบ AI เรียบร้อยแล้ว!');
            setTimeout(() => {
                setStatusText('');
                setSelectedFiles([]);
                setLinks([{ type: 'website', url: '' }]);
            }, 5000);
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            setStatusText(`❌ ข้อผิดพลาด: ไม่สามารถเชื่อมต่อ n8n Webhook ได้ (${msg})`);
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="animate-fade-in" style={{ padding: '1rem', maxWidth: '900px', margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
                <div style={{ padding: '1rem', background: 'rgba(99, 102, 241, 0.1)', borderRadius: '12px' }}>
                    <HardDriveUpload size={32} color="var(--primary)" />
                </div>
                <div>
                    <h1 style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>Openclaw RAG Data Center</h1>
                    <p style={{ color: 'var(--text-muted)', margin: '0.25rem 0 0 0' }}>อัปโหลดเอกสาร คู่มือ หรือลิงก์ที่เกี่ยวข้อง เพื่อเชื่อมต่อเข้าสู่ระบบสมองกล (Memory) ของ AI</p>
                </div>
            </div>

            <div className="glass-card" style={{ padding: '2rem', borderRadius: '16px' }}>
                <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '1rem' }}>
                    <button
                        onClick={() => setUploadMode('files')}
                        style={{
                            background: uploadMode === 'files' ? 'var(--primary)' : 'transparent',
                            color: uploadMode === 'files' ? '#fff' : 'var(--text-muted)',
                            border: '1px solid',
                            borderColor: uploadMode === 'files' ? 'var(--primary)' : 'var(--panel-border)',
                            padding: '0.75rem 1.5rem',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            fontWeight: 600,
                            transition: 'var(--transition)'
                        }}
                    >
                        <FileText size={18} /> อัปโหลดไฟล์เอกสาร
                    </button>
                    <button
                        onClick={() => setUploadMode('links')}
                        style={{
                            background: uploadMode === 'links' ? 'var(--secondary)' : 'transparent',
                            color: uploadMode === 'links' ? '#fff' : 'var(--text-muted)',
                            border: '1px solid',
                            borderColor: uploadMode === 'links' ? 'var(--secondary)' : 'var(--panel-border)',
                            padding: '0.75rem 1.5rem',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            fontWeight: 600,
                            transition: 'var(--transition)'
                        }}
                    >
                        <LinkIcon size={18} /> อัปโหลดลิงก์เว็บไซต์/YouTube
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    {uploadMode === 'files' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            <div style={{
                                border: '2px dashed var(--panel-border)',
                                borderRadius: '12px',
                                padding: '3rem 2rem',
                                textAlign: 'center',
                                background: 'rgba(255,255,255,0.02)',
                                cursor: 'pointer',
                                transition: 'all 0.3s ease'
                            }}
                                onClick={() => document.getElementById('file-upload')?.click()}>
                                <Upload size={48} style={{ color: 'var(--primary)', margin: '0 auto 1rem auto' }} />
                                <h3>คลิกเพื่อเลือกไฟล์ หรือลากไฟล์มาวางที่นี่</h3>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
                                    รองรับ Text, Word, Excel, PDF, และไฟล์รูปภาพ
                                </p>
                                <input
                                    id="file-upload"
                                    type="file"
                                    multiple
                                    onChange={handleFileChange}
                                    style={{ display: 'none' }}
                                    accept=".txt,.doc,.docx,.xls,.xlsx,.pdf,.png,.jpg,.jpeg"
                                />
                            </div>

                            {selectedFiles.length > 0 && (
                                <div style={{ background: 'var(--panel-bg)', padding: '1.5rem', borderRadius: '12px' }}>
                                    <h4 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <CheckCircle size={18} color="var(--success)" /> ไฟล์ที่เลือก ({selectedFiles.length})
                                    </h4>
                                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        {selectedFiles.map((f, i) => (
                                            <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.95rem', padding: '0.5rem', background: 'rgba(0,0,0,0.1)', borderRadius: '6px' }}>
                                                {f.type.startsWith('image/') ? <FileImage size={16} color="var(--secondary)" /> : <FileText size={16} color="var(--primary)" />}
                                                {f.name} <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>({(f.size / 1024).toFixed(1)} KB)</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div style={{ marginBottom: '1rem' }}>
                                <p style={{ color: 'var(--text-muted)' }}>เพิ่มลิงก์เว็บไซต์ หรือวิดีโอ YouTube ที่ต้องการให้ AI เข้าไปดึงข้อมูลมาเรียนรู้</p>
                            </div>

                            {links.map((link, index) => (
                                <div key={index} style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                    <select
                                        value={link.type}
                                        onChange={(e) => handleLinkChange(index, 'type', e.target.value)}
                                        style={{
                                            padding: '0.75rem',
                                            background: 'var(--panel-bg)',
                                            border: '1px solid var(--panel-border)',
                                            borderRadius: '8px',
                                            color: '#fff',
                                            outline: 'none',
                                            width: '150px'
                                        }}
                                    >
                                        <option value="website">Website URL</option>
                                        <option value="youtube">YouTube URL</option>
                                    </select>
                                    <div style={{ position: 'relative', flex: 1 }}>
                                        <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: '1rem', color: 'var(--text-muted)' }}>
                                            {link.type === 'website' ? <LinkIcon size={16} /> : <Youtube size={16} />}
                                        </div>
                                        <input
                                            type="url"
                                            value={link.url}
                                            onChange={(e) => handleLinkChange(index, 'url', e.target.value)}
                                            placeholder={link.type === 'website' ? 'https://example.com/article' : 'https://youtube.com/watch?v=...'}
                                            style={{
                                                width: '100%',
                                                padding: '0.75rem 1rem 0.75rem 2.5rem',
                                                background: 'var(--panel-bg)',
                                                border: '1px solid var(--panel-border)',
                                                borderRadius: '8px',
                                                color: '#fff',
                                                outline: 'none'
                                            }}
                                            required={index === 0}
                                        />
                                    </div>
                                    {links.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => removeLinkField(index)}
                                            style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0.5rem' }}
                                        >
                                            ลบ
                                        </button>
                                    )}
                                </div>
                            ))}
                            <button
                                type="button"
                                onClick={addLinkField}
                                style={{
                                    background: 'transparent',
                                    border: '1px dashed var(--panel-border)',
                                    color: 'var(--text-muted)',
                                    padding: '0.75rem',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    marginTop: '0.5rem'
                                }}
                            >
                                + เพิ่มลิงก์อีก
                            </button>
                        </div>
                    )}

                    <div style={{ marginTop: '2.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{
                            color: statusText.includes('❌') ? 'var(--danger)' : statusText.includes('✅') ? 'var(--success)' : 'var(--text-muted)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            fontWeight: 500
                        }}>
                            {statusText && (
                                <>
                                    {statusText.includes('❌') ? <AlertCircle size={18} /> : null}
                                    {statusText}
                                </>
                            )}
                        </div>
                        <button
                            type="submit"
                            disabled={isUploading || (uploadMode === 'files' && selectedFiles.length === 0)}
                            className="btn btn-primary"
                            style={{
                                padding: '0.75rem 2rem',
                                fontSize: '1.05rem',
                                opacity: isUploading || (uploadMode === 'files' && selectedFiles.length === 0) ? 0.6 : 1,
                                cursor: isUploading || (uploadMode === 'files' && selectedFiles.length === 0) ? 'not-allowed' : 'pointer',
                                width: '200px',
                                justifyContent: 'center'
                            }}
                        >
                            {isUploading ? 'กำลังทำงาน...' : 'เชื่อมต่อข้อมูล ✨'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default OpenclawRAG;
