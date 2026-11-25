"""
Server AI untuk website Anda. Otak dan skill dari PDF, AI bisa menjalankan aksi di website.

Pasang:   pip install flask flask-cors anthropic pypdf scikit-learn
Env:      ANTHROPIC_API_KEY=...   ADMIN_TOKEN=kata-sandi-admin
          ALLOWED_ORIGINS=https://website-anda.com   (pisahkan koma; isi * hanya untuk uji coba)
Jalankan: python server.py       lalu buka http://localhost:5000/admin untuk upload PDF
"""
import json
import os
import re
from pathlib import Path

import anthropic
from flask import Flask, abort, jsonify, request
from flask_cors import CORS
from pypdf import PdfReader
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from werkzeug.utils import secure_filename

BASE = Path(__file__).parent
FOLDER = {"otak": BASE / "otak", "skill": BASE / "skill"}
for f in FOLDER.values():
    f.mkdir(exist_ok=True)

TOKEN = os.environ.get("ADMIN_TOKEN", "")
ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
MODEL = "claude-sonnet-5-5"

client = anthropic.Anthropic()
app = Flask(__name__)
CORS(app, origins=ORIGINS)


def baca_pdf(path):
    return "\n".join((p.extract_text() or "") for p in PdfReader(path).pages)


_cache = {"chunks": None}


def indeks():
    if _cache["chunks"] is None:
        chunks = []
        for f in sorted(FOLDER["otak"].glob("*.pdf")):
            t = baca_pdf(f)
            chunks += [(f.name, t[i:i + 1000]) for i in range(0, len(t), 850) if t[i:i + 1000].strip()]
        _cache["chunks"] = chunks
        if chunks:
            _cache["vec"] = TfidfVectorizer()
            _cache["mat"] = _cache["vec"].fit_transform([c for _, c in chunks])
    return _cache["chunks"]


def cari(q, k=5):
    chunks = indeks()
    if not chunks:
        return []
    skor = cosine_similarity(_cache["vec"].transform([q]), _cache["mat"])[0]
    urut = sorted(range(len(skor)), key=lambda i: skor[i], reverse=True)[:k]
    return [chunks[i] for i in urut if skor[i] > 0]


def skill_teks():
    return "\n\n".join(
        f"## SKILL: {f.stem}\n{baca_pdf(f)[:15000]}" for f in sorted(FOLDER["skill"].glob("*.pdf"))
    )


@app.post("/chat")
def chat():
    d = request.get_json(force=True)
    pesan = str(d.get("pesan", ""))[:2000]
    aksi = [a for a in d.get("aksi", []) if isinstance(a, dict) and a.get("nama")]
    halaman = d.get("halaman", {})
    riwayat = [
        {"role": m["role"], "content": str(m["content"])[:2000]}
        for m in d.get("riwayat", [])[-10:]
        if m.get("role") in ("user", "assistant")
    ]

    sistem = "Kamu adalah AI yang mengendalikan dan membantu pengunjung website ini. Jawab dalam bahasa Indonesia.\n"
    sistem += skill_teks()
    konteks = cari(pesan)
    if konteks:
        sistem += "\n\n# PENGETAHUAN (dari PDF, gunakan bila relevan)\n" + "\n---\n".join(
            f"[{n}] {c}" for n, c in konteks
        )
    sistem += (
        f"\n\n# HALAMAN SAAT INI\nJudul: {str(halaman.get('judul',''))[:200]}\n"
        f"URL: {str(halaman.get('url',''))[:300]}\nIsi: {str(halaman.get('teks',''))[:3000]}\n"
        "\n# AKSI YANG BOLEH DIJALANKAN DI WEBSITE\n"
        + (json.dumps(aksi, ensure_ascii=False) if aksi else "(tidak ada)")
        + '\n\nBalas HANYA dengan JSON: {"balasan": "teks untuk pengunjung", '
        '"aksi": [{"nama": "...", "param": {...}}]}. Isi "aksi" hanya dengan aksi dari daftar di atas, '
        "dan kosongkan bila tidak perlu."
    )

    r = client.messages.create(
        model=MODEL,
        max_tokens=1200,
        system=sistem,
        messages=riwayat + [{"role": "user", "content": pesan}],
    )
    teks = r.content[0].text
    try:
        data = json.loads(re.search(r"\{.*\}", teks, re.S).group(0))
    except Exception:
        data = {"balasan": teks, "aksi": []}
    boleh = {a["nama"] for a in aksi}
    data["aksi"] = [a for a in data.get("aksi", []) if isinstance(a, dict) and a.get("nama") in boleh]
    data.setdefault("balasan", "")
    return jsonify(data)


# ---------- Admin: kontrol otak dan skill ----------
def cek():
    if not TOKEN or request.headers.get("X-Token") != TOKEN:
        abort(401)


@app.get("/admin/daftar")
def daftar():
    cek()
    return jsonify({k: [f.name for f in v.glob("*.pdf")] for k, v in FOLDER.items()})


@app.post("/admin/upload")
def upload():
    cek()
    jenis = request.form.get("jenis")
    f = request.files.get("file")
    if jenis not in FOLDER or not f or not f.filename.lower().endswith(".pdf"):
        abort(400)
    f.save(FOLDER[jenis] / secure_filename(f.filename))
    _cache["chunks"] = None
    return jsonify(ok=True)


@app.post("/admin/hapus")
def hapus():
    cek()
    d = request.get_json(force=True)
    if d.get("jenis") not in FOLDER:
        abort(400)
    (FOLDER[d["jenis"]] / secure_filename(d.get("nama", ""))).unlink(missing_ok=True)
    _cache["chunks"] = None
    return jsonify(ok=True)


ADMIN_HTML = """<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Admin AI</title><body style="font:16px system-ui;max-width:560px;margin:20px auto;padding:0 14px">
<h2>Admin AI</h2>
<input id=t type=password placeholder="ADMIN_TOKEN" style="width:100%;padding:8px">
<p><select id=j><option value=otak>Otak (pengetahuan)</option><option value=skill>Skill (instruksi)</option></select>
<input id=f type=file accept=application/pdf> <button onclick=up()>Upload</button></p>
<div id=l></div>
<script>
const H=()=>({"X-Token":document.getElementById("t").value});
async function muat(){const r=await fetch("/admin/daftar",{headers:H()});const l=document.getElementById("l");l.textContent="";
if(!r.ok){l.textContent="Token salah.";return}
const d=await r.json();for(const k in d){const h=document.createElement("h3");h.textContent=k;l.append(h);
d[k].forEach(n=>{const p=document.createElement("div");p.textContent=n+" ";const b=document.createElement("button");b.textContent="hapus";
b.onclick=async()=>{await fetch("/admin/hapus",{method:"POST",headers:{...H(),"Content-Type":"application/json"},body:JSON.stringify({jenis:k,nama:n})});muat()};
p.append(b);l.append(p)})}}
async function up(){const f=document.getElementById("f").files[0];if(!f)return;const fd=new FormData();fd.append("jenis",document.getElementById("j").value);fd.append("file",f);
await fetch("/admin/upload",{method:"POST",headers:H(),body:fd});muat()}
document.getElementById("t").onchange=muat;
</script>"""


@app.get("/admin")
def admin():
    return ADMIN_HTML


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
