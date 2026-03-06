const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// ตั้งค่าการเชื่อมต่อฐานข้อมูลเวกเตอร์ Supabase
const supabaseUrl = 'https://owoedccmuqnzdtxvywgt.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93b2VkY2NtdXFuemR0eHZ5d2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTMyOTQsImV4cCI6MjA4NzkyOTI5NH0.OfOaHTsJx-M36N5G54PjC4n-8-qZVQNVUuLdb10RO4M';
const supabase = createClient(supabaseUrl, supabaseKey);

// ฟังก์ชันสำหรับแปลงข้อความให้กลายเป็นจำลอง Vector (Embedding)
const PHAYA_API_KEY = 'pk_gd7O1pA7AzzOBoEwbDIGpIFoAo1zpLi5duzVFD0xnA198o8k';

async function generateEmbedding(text) {
    try {
        const response = await fetch("https://api.phaya.io/api/v1/embedding/create", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${PHAYA_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ input: [text] })
        });
        const data = await response.json();
        if (data.data && data.data.length > 0) {
            return data.data[0].embedding;
        } else {
            console.warn("⚠️ Embedding API Error (เครดิตอาจจะไม่พอ):", data);
            return null; // ข้ามการสร้างเวกเตอร์ถ้า API คืนค่า Error
        }
    } catch (e) {
        console.error("❌ Failed to call Phaya Embedding API:", e);
        return null;
    }
}

async function insertIntoSupabase(content, metadata, embedding) {
    if (!embedding) return;

    const { error } = await supabase
        .from('page_sections')
        .insert([{
            content: content,
            metadata: metadata,
            embedding: embedding
        }]);

    if (error) {
        console.error("❌ Supabase Insert Error:", error);
    } else {
        console.log(`✅ บันทึกเวกเตอร์ลง Supabase สำเร็จ (ข้อมูล: ${metadata.source})`);
    }
}

const app = express();
const PORT = 3001;

// ให้แน่ใจว่าโฟลเดอร์มีอยู่จริง (ใช้เส้นทางเต็มเพื่อความชัวร์ หรือเส้นทางสัมพัทธ์ในกรณีนี้)
// จะเซฟไฟล์เข้าไปในโฟลเดอร์ Openclaw RAG หลัก
const RAG_DIR = path.join(__dirname, '..', 'Openclaw RAG');

if (!fs.existsSync(RAG_DIR)) {
    fs.mkdirSync(RAG_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json());

// จัดการการอัปโหลดไฟล์ด้วย multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, RAG_DIR);
    },
    filename: (req, file, cb) => {
        // อัปโหลดไฟล์โดยคงชื่อและนามสกุลเดิม ไม่ให้ถูกเขียนทับง่ายๆ
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext);
        cb(null, `${name}_${Date.now()}${ext}`);
    }
});

const upload = multer({ storage });

// API Endpoint สำหรับรับไฟล์
app.post('/api/upload', upload.array('documents'), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'ไม่พบไฟล์ที่อัปโหลด' });
        }

        // ประมวลผลไฟล์ .txt หรือ .md เพื่อทำ Data Embedding อัตโนมัติเวลาอัปโหลด
        for (const file of req.files) {
            const ext = path.extname(file.originalname).toLowerCase();
            if (ext === '.txt' || ext === '.md') {
                const textContent = fs.readFileSync(file.path, 'utf8');
                // ดึง 1,000 ตัวอักษรแรก (Chunking อย่างง่าย)
                const chunk = textContent.substring(0, 1000);
                const embedding = await generateEmbedding(chunk);
                await insertIntoSupabase(chunk, { source: file.filename, type: 'file_upload' }, embedding);
            }
        }

        res.status(200).json({
            message: 'อัปโหลดสำเร็จ',
            files: req.files.map(f => f.filename)
        });
    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในการอัปโหลด' });
    }
});

// API Endpoint สำหรับรับลิงก์ (Website/YouTube)
app.post('/api/links', async (req, res) => {
    try {
        const { links } = req.body;
        if (!links || links.length === 0) {
            return res.status(400).json({ error: 'ไม่พบข้อมูลลิงก์' });
        }

        // เซฟลิงก์ลงในไฟล์ JSON ภายในโฟลเดอร์ Openclaw RAG
        const linksFile = path.join(RAG_DIR, 'saved_links.json');

        let existingLinks = [];
        if (fs.existsSync(linksFile)) {
            const rawData = fs.readFileSync(linksFile, 'utf8');
            existingLinks = JSON.parse(rawData);
        }

        const newLinksData = {
            timestamp: new Date().toISOString(),
            links: links
        };

        existingLinks.push(newLinksData);

        fs.writeFileSync(linksFile, JSON.stringify(existingLinks, null, 2));

        res.status(200).json({ message: 'บันทึกลิงก์สำเร็จ' });

        // ทำการ Process Link ที่ส่งมาเพื่อทำ Data Embedding เบื้องต้น (ตัวอย่างใช้ URL แทน Content ก่อน)
        for (const linkObj of links) {
            const embedding = await generateEmbedding(`Website/Video URL: ${linkObj.url}`);
            await insertIntoSupabase(linkObj.url, { source: linkObj.url, type: linkObj.type }, embedding);
        }
    } catch (error) {
        console.error('Links Error:', error);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในการบันทึกลิงก์' });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Openclaw RAG API Server รับข้อมูลที่ http://localhost:${PORT}`);
    console.log(`📁 พาธการจัดเก็บข้อมูล: ${RAG_DIR}`);
});
