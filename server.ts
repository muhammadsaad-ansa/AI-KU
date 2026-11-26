import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { GoogleGenAI } from '@google/genai';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Simple CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-Token');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin123';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Storage directories & persistent database file
const STORAGE_DIR = path.resolve(__dirname, 'storage');
const DB_FILE = path.join(STORAGE_DIR, 'database.json');
const FOLDERS: Record<string, string> = {
  otak: path.join(STORAGE_DIR, 'otak'),
  skill: path.join(STORAGE_DIR, 'skill')
};

for (const dir of Object.values(FOLDERS)) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

interface StoredFileRecord {
  name: string;
  category: 'otak' | 'skill';
  data: string; // base64
  updatedAt: number;
}

// Load database or initialize
function loadDatabase(): StoredFileRecord[] {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error loading database.json:', err);
  }
  return [];
}

function saveDatabase(records: StoredFileRecord[]) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(records, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving database.json:', err);
  }
}

// Restore files from persistent database to disk on startup
function restoreFilesFromDatabase() {
  const records = loadDatabase();
  for (const rec of records) {
    const targetDir = FOLDERS[rec.category];
    if (targetDir) {
      const filePath = path.join(targetDir, rec.name);
      if (!fs.existsSync(filePath)) {
        try {
          const buffer = Buffer.from(rec.data, 'base64');
          fs.writeFileSync(filePath, buffer);
          console.log(`Restored persistent file: ${rec.category}/${rec.name}`);
        } catch (err) {
          console.error(`Failed to restore file ${rec.name}:`, err);
        }
      }
    }
  }
}

restoreFilesFromDatabase();

// Multer setup for PDF uploads
const upload = multer({
  storage: multer.memoryStorage(), // Use memory storage to easily get buffer for base64 persistence
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file PDF yang diizinkan!'));
    }
  }
});

// PDF reading & caching helper
const pdfCache: { [key: string]: string } = {};

async function readPdfText(filePath: string): Promise<string> {
  if (pdfCache[filePath] && fs.existsSync(filePath)) {
    return pdfCache[filePath];
  }
  try {
    if (!fs.existsSync(filePath)) return '';
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    pdfCache[filePath] = data.text || '';
    return pdfCache[filePath];
  } catch (err) {
    console.error('Error reading PDF:', filePath, err);
    return '';
  }
}

// Simple RAG retrieval search over PDF chunks in 'otak'
async function searchOtak(query: string, maxResults = 5): Promise<Array<{ name: string; text: string; score: number }>> {
  const otakDir = FOLDERS.otak;
  if (!otakDir || !fs.existsSync(otakDir)) return [];

  const files = fs.readdirSync(otakDir).filter(f => f.toLowerCase().endsWith('.pdf'));
  const chunks: Array<{ name: string; text: string }> = [];

  for (const file of files) {
    const filePath = path.join(otakDir, file);
    const text = await readPdfText(filePath);
    for (let i = 0; i < text.length; i += 850) {
      const chunk = text.slice(i, i + 1000).trim();
      if (chunk.length > 20) {
        chunks.push({ name: file, text: chunk });
      }
    }
  }

  if (chunks.length === 0) return [];

  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (queryWords.length === 0) {
    return chunks.slice(0, maxResults).map(c => ({ ...c, score: 1 }));
  }

  const scored = chunks.map(chunk => {
    const lowerText = chunk.text.toLowerCase();
    let score = 0;
    for (const word of queryWords) {
      if (lowerText.includes(word)) {
        score += 1;
      }
    }
    if (lowerText.includes(query.toLowerCase())) {
      score += 3;
    }
    return { ...chunk, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score > 0).slice(0, maxResults);
}

async function getSkillTexts(): Promise<string> {
  const skillDir = FOLDERS.skill;
  if (!skillDir || !fs.existsSync(skillDir)) return '';
  const files = fs.readdirSync(skillDir).filter(f => f.toLowerCase().endsWith('.pdf'));
  let result = '';
  for (const file of files) {
    const filePath = path.join(skillDir, file);
    const text = await readPdfText(filePath);
    const stem = path.parse(file).name;
    result += `\n\n## SKILL: ${stem}\n${text.slice(0, 15000)}`;
  }
  return result;
}

// ---------- API Routes ----------

app.post('/api/chat', async (req, res) => {
  try {
    const { pesan = '', riwayat = [], aksi = [], halaman = {} } = req.body;
    const userMessage = String(pesan).slice(0, 2000);

    let systemInstruction = 'Kamu adalah AI asisten cerdas yang mengendalikan dan membantu pengunjung website ini. Jawab dalam bahasa Indonesia yang ramah, profesional, dan membantu.\n';
    
    const skills = await getSkillTexts();
    if (skills) {
      systemInstruction += skills;
    }

    const retrievedContext = await searchOtak(userMessage);
    if (retrievedContext.length > 0) {
      systemInstruction += '\n\n# PENGETAHUAN (dari Dokumen Otak PDF, gunakan bila relevan):\n' +
        retrievedContext.map(c => `[${c.name}]: ${c.text}`).join('\n---\n');
    }

    systemInstruction += `\n\n# HALAMAN SAAT INI\nJudul: ${String(halaman.judul || '').slice(200)}\nURL: ${String(halaman.url || '').slice(300)}\nIsi: ${String(halaman.teks || '').slice(3000)}`;

    if (Array.isArray(aksi) && aksi.length > 0) {
      systemInstruction += `\n\n# AKSI YANG BOLEH DIJALANKAN DI WEBSITE:\n` + JSON.stringify(aksi, null, 2);
    } else {
      systemInstruction += `\n\n# AKSI YANG BOLEH DIJALANKAN DI WEBSITE:\n(tidak ada)`;
    }

    systemInstruction += `\n\nINSTRUKSI FORMAT OUTPUT:
Balas HANYA dengan format JSON valid berikut (tanpa markdown backticks jika memungkinkan):
{
  "balasan": "Teks jawaban untuk pengunjung website",
  "aksi": [
    { "nama": "nama_aksi", "param": { ... } }
  ]
}
Isi "aksi" hanya dengan aksi dari daftar di atas, dan kosongkan array "aksi" bila tidak perlu melakukan tindakan di website.`;

    const formattedHistory = Array.isArray(riwayat) ? riwayat.map((m: any) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '').slice(2000) }]
    })) : [];

    const modelName = 'gemini-2.5-flash';

    const chatSession = ai.chats.create({
      model: modelName,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
      },
      history: formattedHistory
    });

    const result = await chatSession.sendMessage({ message: userMessage });
    const responseText = result.text || '';

    let parsed: any = { balasan: responseText, aksi: [] };
    try {
      let cleanJson = responseText.trim();
      if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch (parseErr) {
      console.warn('Failed to parse model response as JSON, falling back to text:', responseText);
      parsed = { balasan: responseText, aksi: [] };
    }

    const allowedActionNames = new Set(Array.isArray(aksi) ? aksi.map((a: any) => a.nama) : []);
    const validActions = Array.isArray(parsed.aksi) ? parsed.aksi.filter((a: any) => a && allowedActionNames.has(a.nama)) : [];

    res.json({
      balasan: parsed.balasan || responseText,
      aksi: validActions,
      debug: {
        retrievedOtakCount: retrievedContext.length
      }
    });

  } catch (error: any) {
    console.error('Chat API Error:', error);
    res.status(500).json({ error: error.message || 'Terjadi kesalahan pada server AI.' });
  }
});

// Admin auth middleware (bypassed / no token required)
function checkAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  next();
}

// Admin: list PDF files
app.get('/api/admin/daftar', checkAdminAuth, (req, res) => {
  const result: { [key: string]: string[] } = {};
  for (const [key, dir] of Object.entries(FOLDERS)) {
    if (dir && fs.existsSync(dir)) {
      result[key] = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.pdf'));
    } else {
      result[key] = [];
    }
  }
  res.json(result);
});

// Admin: upload PDF with persistent DB backup
app.post('/api/admin/upload', checkAdminAuth, upload.single('file'), (req, res) => {
  try {
    const jenis = String(req.body.jenis || 'otak');
    const file = req.file;
    if (!FOLDERS[jenis] || !file) {
      return res.status(400).json({ error: 'Parameter tidak valid atau file PDF tidak ditemukan.' });
    }

    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = Date.now() + '-' + safeName;
    const targetDir = FOLDERS[jenis];
    const filePath = path.join(targetDir, filename);

    // Save file to disk
    fs.writeFileSync(filePath, file.buffer);
    delete pdfCache[filePath];

    // Update persistent database json
    const records = loadDatabase();
    // Remove existing if duplicate name
    const filtered = records.filter(r => !(r.category === jenis && r.name === filename));
    filtered.push({
      name: filename,
      category: jenis as 'otak' | 'skill',
      data: file.buffer.toString('base64'),
      updatedAt: Date.now()
    });
    saveDatabase(filtered);

    res.json({ ok: true, filename });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: delete PDF & update persistent DB
app.post('/api/admin/hapus', checkAdminAuth, (req, res) => {
  try {
    const { jenis, nama } = req.body;
    const folderKey = String(jenis || '');
    if (!FOLDERS[folderKey] || !nama) {
      return res.status(400).json({ error: 'Parameter tidak valid.' });
    }
    const safeName = path.basename(String(nama));
    const filePath = path.join(FOLDERS[folderKey], safeName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      delete pdfCache[filePath];
    }

    // Update persistent database json
    const records = loadDatabase();
    const filtered = records.filter(r => !(r.category === folderKey && r.name === safeName));
    saveDatabase(filtered);

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Search PDF content API
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '');
  if (!q) return res.json({ results: [] });
  const results = await searchOtak(q, 10);
  res.json({ results });
});

// Serve the embeddable widget.js script
app.get('/widget.js', (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['host'] || 'localhost:3000';
  const serverUrl = `${protocol}://${host}`;

  const widgetCode = `/**
  * Gemini AI Widget untuk Website Anda.
  * Tempel sebelum </body>:
  * <script src="${serverUrl}/widget.js" data-server="${serverUrl}"></script>
  */
(function () {
  const currentScript = document.currentScript;
  const scriptServer = currentScript ? currentScript.getAttribute('data-server') : '';
  const W = {};
  
  W.init = function (o) {
    const server = (o && o.server ? o.server : (scriptServer || "${serverUrl}")).replace(/\\/$/, "");
    const aksi = o && o.aksi ? o.aksi : {};
    const riwayat = [];

    const css = document.createElement("style");
    css.textContent =
      "#aiw-b{position:fixed;right:20px;bottom:20px;width:60px;height:60px;border-radius:50%;border:0;background:linear-gradient(135deg,#4f46e5,#3b82f6);color:#fff;font-size:26px;z-index:99999;cursor:pointer;box-shadow:0 6px 20px rgba(79,70,229,0.4);transition:transform 0.2s}" +
      "#aiw-b:hover{transform:scale(1.08)}" +
      "#aiw-p{position:fixed;right:20px;bottom:92px;width:min(380px,calc(100vw - 32px));height:min(520px,75vh);background:#ffffff;color:#1e293b;border:1px solid #e2e8f0;border-radius:16px;display:none;flex-direction:column;z-index:99999;font:14px/1.5 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,0.15);overflow:hidden}" +
      "#aiw-h{background:linear-gradient(135deg,#4f46e5,#3b82f6);color:#fff;padding:14px 16px;font-weight:600;display:flex;align-items:center;justify-content:between}" +
      "#aiw-l{flex:1;overflow-y:auto;padding:16px;background:#f8fafc;display:flex;flex-direction:column;gap:10px}" +
      ".aiw-m{padding:10px 14px;border-radius:12px;max-width:85%;word-break:break-word;line-height:1.5}" +
      ".aiw-assistant{background:#ffffff;border:1px solid #e2e8f0;color:#334155;align-self:flex-start;box-shadow:0 1px 2px rgba(0,0,0,0.05)}" +
      ".aiw-u{background:#4f46e5;color:#ffffff;align-self:flex-end}" +
      "#aiw-r{display:flex;gap:8px;padding:12px;background:#ffffff;border-top:1px solid #e2e8f0}" +
      "#aiw-i{flex:1;border:1px solid #cbd5e1;border-radius:10px;padding:10px 12px;font:inherit;outline:none}" +
      "#aiw-i:focus{border-color:#4f46e5;box-shadow:0 0 0 2px rgba(79,70,229,0.15)}" +
      "#aiw-s{border:0;background:#4f46e5;color:#fff;border-radius:10px;padding:0 16px;font:inherit;font-weight:600;cursor:pointer;transition:background 0.2s}" +
      "#aiw-s:hover{background:#4338ca}";
    document.head.appendChild(css);

    const btn = document.createElement("button");
    btn.id = "aiw-b";
    btn.innerHTML = '✨';
    btn.setAttribute("aria-label", "Buka asisten AI");

    const panel = document.createElement("div");
    panel.id = "aiw-p";
    panel.innerHTML = '<div id="aiw-h"><span>✨ Asisten AI Gemini</span></div><div id="aiw-l"></div><div id="aiw-r"><input id="aiw-i" placeholder="Tulis pesan atau pertanyaan..."><button id="aiw-s">Kirim</button></div>';
    document.body.append(btn, panel);

    const log = panel.querySelector("#aiw-l");
    const input = panel.querySelector("#aiw-i");
    
    const welcomeDiv = document.createElement("div");
    welcomeDiv.className = "aiw-m aiw-assistant";
    welcomeDiv.textContent = "Halo! Ada yang bisa saya bantu terkait informasi website atau dokumen kami?";
    log.appendChild(welcomeDiv);

    btn.onclick = () => { 
      const isVisible = panel.style.display === "flex";
      panel.style.display = isVisible ? "none" : "flex";
      if (!isVisible) input.focus();
    };

    function tambah(teks, user) {
      const d = document.createElement("div");
      d.className = "aiw-m " + (user ? "aiw-u" : "aiw-assistant");
      d.textContent = teks;
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
      return d;
    }

    async function kirim() {
      const pesan = input.value.trim();
      if (!pesan) return;
      input.value = "";
      tambah(pesan, true);
      const out = tambah("Sedang berpikir...", false);
      try {
        const r = await fetch(server + "/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pesan,
            riwayat: riwayat.slice(-10),
            aksi: Object.entries(aksi).map(([nama, a]) => ({ nama, deskripsi: a.deskripsi })),
            halaman: { url: location.href, judul: document.title, teks: document.body.innerText.slice(0, 3000) }
          })
        });
        const d = await r.json();
        out.textContent = d.balasan || "(Selesai)";
        riwayat.push({ role: "user", content: pesan }, { role: "assistant", content: d.balasan || "" });
        
        for (const a of (d.aksi || [])) {
          if (aksi[a.nama] && typeof aksi[a.nama].jalankan === 'function') {
            try { 
              aksi[a.nama].jalankan(a.param || {}); 
            } catch (err) { 
              console.error("Gagal menjalankan aksi:", a.nama, err); 
            }
          }
        }
      } catch (e) {
        out.textContent = "Gagal terhubung ke server AI.";
        console.error(e);
      }
    }
    
    panel.querySelector("#aiw-s").onclick = kirim;
    input.addEventListener("keydown", e => { if (e.key === "Enter") kirim(); });
  };

  window.AIWidget = W;
})();
`;
  res.setHeader('Content-Type', 'application/javascript');
  res.send(widgetCode);
});

// Vite dev server middleware integration or static file serving
if (process.env.NODE_ENV !== 'production') {
  try {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } catch (err) {
    console.warn('Vite dev middleware not loaded:', err);
  }
} else {
  const distPath = path.resolve(__dirname, 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
