/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Brain,
  BookOpen,
  MessageSquare,
  Upload,
  Trash2,
  Code,
  Play,
  Settings,
  Search,
  FileText,
  Sparkles,
  Globe,
  CheckCircle,
  Copy,
  ExternalLink,
  Shield,
  Send,
  Bot,
  User
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'brain' | 'search' | 'simulator' | 'embed' | 'admin'>('brain');

  // State for PDFs
  const [otakFiles, setOtakFiles] = useState<string[]>([]);
  const [skillFiles, setSkillFiles] = useState<string[]>([]);
  const [adminToken, setAdminToken] = useState<string>(() => {
    return localStorage.getItem('adminToken') || 'admin123';
  });

  useEffect(() => {
    localStorage.setItem('adminToken', adminToken);
  }, [adminToken]);
  const [uploadJenis, setUploadJenis] = useState<'otak' | 'skill'>('otak');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ name: string; text: string }>>([]);
  const [searching, setSearching] = useState(false);

  // Chat playground state
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([
    { role: 'assistant', content: 'Halo! Saya asisten Gemini AI yang didukung oleh dokumen Otak dan Skill PDF Anda. Ada yang bisa saya bantu?' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  // Simulator state
  const [simPage, setSimPage] = useState<'home' | 'pricing' | 'contact'>('home');
  const [simFormData, setSimFormData] = useState({ nama: '', email: '', pesan: '' });
  const [simClickedBtn, setSimClickedBtn] = useState<string | null>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);

  // Load file list
  const fetchFiles = async () => {
    try {
      const res = await fetch('/api/admin/daftar', {
        headers: { 'X-Token': adminToken }
      });
      if (res.ok) {
        const data = await res.json();
        setOtakFiles(data.otak || []);
        setSkillFiles(data.skill || []);
      } else {
        setErrorMsg('Token admin salah atau gagal memuat daftar file.');
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, [adminToken]);

  // Upload PDF
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;
    setUploading(true);
    setErrorMsg('');
    setSuccessMsg('');

    const formData = new FormData();
    formData.append('jenis', uploadJenis);
    formData.append('file', uploadFile);

    try {
      const res = await fetch('/api/admin/upload', {
        method: 'POST',
        headers: { 'X-Token': adminToken },
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setSuccessMsg(`Berhasil mengunggah ${uploadFile.name} ke ${uploadJenis}!`);
        setUploadFile(null);
        fetchFiles();
      } else {
        setErrorMsg(data.error || 'Gagal mengunggah file.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal mengunggah file.');
    } finally {
      setUploading(false);
    }
  };

  // Delete PDF
  const handleDelete = async (jenis: 'otak' | 'skill', nama: string) => {
    if (!confirm(`Hapus file ${nama} dari ${jenis}?`)) return;
    try {
      const res = await fetch('/api/admin/hapus', {
        method: 'POST',
        headers: {
          'X-Token': adminToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ jenis, nama })
      });
      if (res.ok) {
        setSuccessMsg(`File ${nama} berhasil dihapus.`);
        fetchFiles();
      } else {
        const d = await res.json();
        setErrorMsg(d.error || 'Gagal menghapus file.');
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  // Search PDF content
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (err) {
      console.error(err);
    } finally {
      setSearching(false);
    }
  };

  // Send chat message in playground
  const handleSendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput('');
    const newMessages = [...chatMessages, { role: 'user' as const, content: userMsg }];
    setChatMessages(newMessages);
    setChatLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pesan: userMsg,
          riwayat: newMessages.slice(-10),
          aksi: [
            {
              nama: 'buka_halaman',
              deskripsi: 'Pindah halaman di simulator. param: {url: "/home"|"pricing"|"contact"}'
            },
            {
              nama: 'isi_kolom',
              deskripsi: 'Mengisi input form di simulator. param: {id: "nama"|"email"|"pesan", nilai: "..."}'
            },
            {
              nama: 'klik_tombol',
              deskripsi: 'Klik tombol aksi di simulator. param: {id: "btn-submit"|"btn-promo"}'
            }
          ],
          halaman: {
            url: `simulator?page=${simPage}`,
            judul: `Simulator Website - Halaman ${simPage}`,
            teks: `Pengunjung sedang melihat halaman ${simPage} di website simulasi.`
          }
        })
      });
      const data = await res.json();
      const assistantReply = data.balasan || '(Selesai)';
      setChatMessages([...newMessages, { role: 'assistant', content: assistantReply }]);

      // Execute simulator actions if any
      if (Array.isArray(data.aksi)) {
        for (const action of data.aksi) {
          if (action.nama === 'buka_halaman' && action.param?.url) {
            const pageTarget = action.param.url.replace('/', '');
            if (['home', 'pricing', 'contact'].includes(pageTarget)) {
              setSimPage(pageTarget as any);
            }
          } else if (action.nama === 'isi_kolom' && action.param?.id) {
            const { id, nilai } = action.param;
            if (['nama', 'email', 'pesan'].includes(id)) {
              setSimFormData(prev => ({ ...prev, [id]: nilai }));
            }
          } else if (action.nama === 'klik_tombol' && action.param?.id) {
            setSimClickedBtn(action.param.id);
            setTimeout(() => setSimClickedBtn(null), 2500);
          }
        }
      }
    } catch (err) {
      setChatMessages([...newMessages, { role: 'assistant', content: 'Gagal terhubung ke server AI.' }]);
    } finally {
      setChatLoading(false);
    }
  };

  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [chatMessages, chatLoading]);

  const serverUrl = window.location.origin;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-blue-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              Gemini AI Widget & Knowledge Hub
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 font-medium">
                v2.5 Flash
              </span>
            </h1>
            <p className="text-xs text-slate-400">Kelola otak PDF, skill, pencarian RAG, dan widget asisten AI website</p>
          </div>
        </div>

      </header>

      {/* Navigation Tabs */}
      <nav className="bg-slate-900/60 border-b border-slate-800/80 px-6 flex gap-2 overflow-x-auto">
        {[
          { id: 'brain', label: 'Otak & Skill (PDF)', icon: Brain },
          { id: 'search', label: 'Pencarian & RAG', icon: Search },
          { id: 'simulator', label: 'Simulator & Widget Live', icon: Play },
          { id: 'embed', label: 'Kode Embed Website', icon: Code },
          { id: 'admin', label: 'Pengaturan & Admin', icon: Settings },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ${
                isActive
                  ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6">
        {successMsg && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>{successMsg}</span>
            </div>
            <button onClick={() => setSuccessMsg('')} className="text-emerald-400 hover:text-emerald-200 font-bold">×</button>
          </div>
        )}

        {errorMsg && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 flex items-center justify-between text-sm">
            <span>{errorMsg}</span>
            <button onClick={() => setErrorMsg('')} className="text-rose-400 hover:text-rose-200 font-bold">×</button>
          </div>
        )}

        {/* TAB 1: BRAIN & SKILL PDF MANAGEMENT */}
        {activeTab === 'brain' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Upload Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
                <h2 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
                  <Upload className="w-5 h-5 text-indigo-400" />
                  Upload Dokumen PDF
                </h2>
                <p className="text-xs text-slate-400 mb-6">
                  Tambahkan file PDF untuk pengetahuan otak AI (RAG) atau skill khusus instruksi.
                </p>

                <form onSubmit={handleUpload} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Tujuan Kategori</label>
                    <select
                      value={uploadJenis}
                      onChange={e => setUploadJenis(e.target.value as any)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="otak">Otak (Basis Pengetahuan / RAG)</option>
                      <option value="skill">Skill (Instruksi & Kepribadian)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Pilih File PDF</label>
                    <input
                      type="file"
                      accept="application/pdf"
                      onChange={e => setUploadFile(e.target.files?.[0] || null)}
                      className="w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-500 cursor-pointer"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={uploading || !uploadFile}
                    className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-sm transition-all shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2"
                  >
                    {uploading ? 'Mengunggah...' : 'Upload Dokumen PDF'}
                  </button>
                </form>
              </div>

              {/* Files Lists */}
              <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Otak Files */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-white flex items-center gap-2">
                      <Brain className="w-4 h-4 text-indigo-400" />
                      Otak ({otakFiles.length})
                    </h3>
                    <span className="text-xs text-slate-400">Pengetahuan RAG</span>
                  </div>
                  <div className="flex-1 space-y-2.5 overflow-y-auto max-h-[360px] pr-1">
                    {otakFiles.length === 0 ? (
                      <div className="text-center py-12 text-slate-500 text-sm">Belum ada file PDF di Otak</div>
                    ) : (
                      otakFiles.map(filename => (
                        <div key={filename} className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-sm">
                          <span className="truncate text-slate-300 font-medium" title={filename}>{filename}</span>
                          <button
                            onClick={() => handleDelete('otak', filename)}
                            className="text-rose-400 hover:text-rose-300 p-1.5 rounded-lg hover:bg-rose-500/10 transition-colors"
                            title="Hapus file"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Skill Files */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-white flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-indigo-400" />
                      Skill ({skillFiles.length})
                    </h3>
                    <span className="text-xs text-slate-400">Instruksi Khusus</span>
                  </div>
                  <div className="flex-1 space-y-2.5 overflow-y-auto max-h-[360px] pr-1">
                    {skillFiles.length === 0 ? (
                      <div className="text-center py-12 text-slate-500 text-sm">Belum ada file PDF di Skill</div>
                    ) : (
                      skillFiles.map(filename => (
                        <div key={filename} className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-sm">
                          <span className="truncate text-slate-300 font-medium" title={filename}>{filename}</span>
                          <button
                            onClick={() => handleDelete('skill', filename)}
                            className="text-rose-400 hover:text-rose-300 p-1.5 rounded-lg hover:bg-rose-500/10 transition-colors"
                            title="Hapus file"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: SEARCH & RAG INSPECTOR */}
        {activeTab === 'search' && (
          <div className="space-y-6 max-w-4xl mx-auto">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <h2 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
                <Search className="w-5 h-5 text-indigo-400" />
                Pencarian Isi PDF (RAG Inspector)
              </h2>
              <p className="text-xs text-slate-400 mb-6">
                Uji coba pencarian semantik / kata kunci langsung pada dokumen PDF yang tersimpan di basis pengetahuan Otak.
              </p>

              <form onSubmit={handleSearch} className="flex gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Masukkan kata kunci atau pertanyaan (contoh: harga, garansi, syarat)..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={searching}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm rounded-xl transition-all shadow-lg shadow-indigo-600/30"
                >
                  {searching ? 'Mencari...' : 'Cari'}
                </button>
              </form>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-300">Hasil Pencocokan Dokumen ({searchResults.length})</h3>
              {searchResults.length === 0 ? (
                <div className="text-center py-12 bg-slate-900/40 border border-slate-800 rounded-2xl text-slate-500 text-sm">
                  Belum ada hasil pencarian. Masukkan kata kunci di atas.
                </div>
              ) : (
                searchResults.map((item, idx) => (
                  <div key={idx} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-2">
                    <div className="flex items-center justify-between text-xs text-indigo-400 font-mono">
                      <span>File: {item.name}</span>
                      <span>Chunk #{idx + 1}</span>
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{item.text}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 3: SIMULATOR & WIDGET LIVE */}
        {activeTab === 'simulator' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Simulated Website (Left 7 cols) */}
            <div className="lg:col-span-7 bg-white text-slate-900 rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col min-h-[580px]">
              {/* Simulated Browser Bar */}
              <div className="bg-slate-100 border-b border-slate-200 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-rose-400"></div>
                    <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                    <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
                  </div>
                  <div className="bg-white border border-slate-300 rounded-lg px-4 py-1 text-xs text-slate-600 font-mono w-64 truncate">
                    https://contoh-website.com/{simPage}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSimPage('home')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold ${simPage === 'home' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'}`}
                  >
                    Beranda
                  </button>
                  <button
                    onClick={() => setSimPage('pricing')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold ${simPage === 'pricing' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'}`}
                  >
                    Harga
                  </button>
                  <button
                    onClick={() => setSimPage('contact')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold ${simPage === 'contact' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'}`}
                  >
                    Kontak
                  </button>
                </div>
              </div>

              {/* Simulated Website Content */}
              <div className="flex-1 p-8 flex flex-col justify-between">
                {simPage === 'home' && (
                  <div className="space-y-6 text-center my-auto">
                    <span className="px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-bold uppercase tracking-wider">
                      Selamat Datang di Toko & Layanan Kami
                    </span>
                    <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                      Solusi Bisnis Cerdas dengan Otomasi AI
                    </h2>
                    <p className="text-slate-600 max-w-md mx-auto text-sm">
                      Tingkatkan konversi pelanggan dan layani tanya jawab otomatis 24/7 menggunakan asisten cerdas Gemini.
                    </p>
                    <div>
                      <button
                        id="btn-promo"
                        onClick={() => alert('Tombol Promo diklik!')}
                        className={`px-6 py-3 rounded-xl bg-indigo-600 text-white font-semibold text-sm shadow-lg transition-transform ${simClickedBtn === 'btn-promo' ? 'ring-4 ring-indigo-400 scale-105' : ''}`}
                      >
                        Lihat Promo Spesial
                      </button>
                    </div>
                  </div>
                )}

                {simPage === 'pricing' && (
                  <div className="space-y-6 my-auto">
                    <div className="text-center">
                      <h2 className="text-2xl font-bold text-slate-900">Pilihan Paket Harga</h2>
                      <p className="text-xs text-slate-500 mt-1">Pilih paket terbaik untuk kebutuhan bisnis Anda.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="border border-slate-200 rounded-xl p-5 text-center bg-slate-50">
                        <h4 className="font-bold text-slate-900">Starter</h4>
                        <div className="text-2xl font-extrabold text-indigo-600 my-2">Rp 199rb</div>
                        <p className="text-xs text-slate-500 mb-4">Cocok untuk UMKM pemula</p>
                        <button
                          id="btn-starter"
                          onClick={() => alert('Paket Starter dipilih!')}
                          className={`w-full py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold ${simClickedBtn === 'btn-starter' ? 'ring-4 ring-indigo-400' : ''}`}
                        >
                          Pilih Starter
                        </button>
                      </div>
                      <div className="border-2 border-indigo-600 rounded-xl p-5 text-center bg-indigo-50/50 shadow-md">
                        <h4 className="font-bold text-indigo-900">Pro Enterprise</h4>
                        <div className="text-2xl font-extrabold text-indigo-600 my-2">Rp 499rb</div>
                        <p className="text-xs text-indigo-600 mb-4">Fitur AI Widget & RAG Lengkap</p>
                        <button
                          id="btn-pro"
                          onClick={() => alert('Paket Pro Enterprise dipilih!')}
                          className={`w-full py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold ${simClickedBtn === 'btn-pro' ? 'ring-4 ring-indigo-400' : ''}`}
                        >
                          Pilih Pro
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {simPage === 'contact' && (
                  <div className="space-y-4 my-auto max-w-md mx-auto w-full">
                    <h2 className="text-xl font-bold text-slate-900 text-center">Hubungi Kami / Form Konsultasi</h2>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Lengkap</label>
                        <input
                          id="nama"
                          type="text"
                          value={simFormData.nama}
                          onChange={e => setSimFormData({ ...simFormData, nama: e.target.value })}
                          placeholder="Masukkan nama..."
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
                        <input
                          id="email"
                          type="email"
                          value={simFormData.email}
                          onChange={e => setSimFormData({ ...simFormData, email: e.target.value })}
                          placeholder="Masukkan email..."
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Pesan</label>
                        <textarea
                          id="pesan"
                          rows={3}
                          value={simFormData.pesan}
                          onChange={e => setSimFormData({ ...simFormData, pesan: e.target.value })}
                          placeholder="Tulis pesan..."
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-indigo-600"
                        />
                      </div>
                      <button
                        id="btn-submit"
                        onClick={() => alert('Pesan berhasil dikirim!')}
                        className={`w-full py-2.5 bg-indigo-600 text-white rounded-lg font-semibold text-sm transition-transform ${simClickedBtn === 'btn-submit' ? 'ring-4 ring-indigo-400 scale-105' : ''}`}
                      >
                        Kirim Pesan Sekarang
                      </button>
                    </div>
                  </div>
                )}

                <div className="text-center pt-8 border-t border-slate-100 text-xs text-slate-400">
                  Simulasi Halaman Website Aktif • Coba chat dengan AI di sebelah kanan untuk melihat aksi otomatis!
                </div>
              </div>
            </div>

            {/* AI Widget Playground Chat (Right 5 cols) */}
            <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col h-[580px]">
              <div className="bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-4 rounded-t-2xl flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-white font-semibold">
                  <Bot className="w-5 h-5" />
                  <span>Gemini Assistant Playground</span>
                </div>
                <span className="text-xs bg-black/20 px-2.5 py-1 rounded-full text-indigo-100">Live RAG + Aksi</span>
              </div>

              {/* Chat Log */}
              <div ref={chatLogRef} className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-950/60">
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                  >
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-indigo-400'}`}>
                      {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                    </div>
                    <div
                      className={`p-3 rounded-2xl text-sm max-w-[80%] leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-indigo-600 text-white rounded-tr-none'
                          : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none'
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex items-center gap-2 text-xs text-slate-400 italic p-2">
                    <Sparkles className="w-4 h-4 text-indigo-400 animate-spin" />
                    Gemini sedang membaca dokumen & berpikir...
                  </div>
                )}
              </div>

              {/* Chat Input */}
              <div className="p-3 bg-slate-900 border-t border-slate-800 flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSendChat()}
                  placeholder="Ketik pesan atau minta AI isi form / pindah halaman..."
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={handleSendChat}
                  disabled={chatLoading}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-xl transition-all shadow-md shadow-indigo-600/30 flex items-center justify-center"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: EMBED CODE GENERATOR */}
        {activeTab === 'embed' && (
          <div className="space-y-6 max-w-3xl mx-auto">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Code className="w-5 h-5 text-indigo-400" />
                Kode Embed Widget untuk Website Anda
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Salin skrip HTML di bawah ini dan tempelkan tepat sebelum tag penutup <code className="text-indigo-400">&lt;/body&gt;</code> di website Anda. AI akan otomatis terhubung dengan basis pengetahuan PDF dan mampu menjalankan aksi website yang Anda daftarkan.
              </p>

              <div className="relative">
                <pre className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-indigo-200 overflow-x-auto leading-relaxed">
{`<script src="${serverUrl}/widget.js"></script>
<script>
  AIWidget.init({
    server: "${serverUrl}",
    aksi: {
      buka_halaman: {
        deskripsi: "Pindah ke halaman lain di website ini. param: {url} (diawali /)",
        jalankan: function(p) {
          if (String(p.url).startsWith("/")) {
            location.href = p.url;
          }
        }
      },
      isi_kolom: {
        deskripsi: "Mengisi kolom form berdasarkan id. param: {id, nilai}",
        jalankan: function(p) {
          const el = document.getElementById(p.id);
          if (el) { el.value = p.nilai; el.dispatchEvent(new Event('input')); }
        }
      },
      klik_tombol: {
        deskripsi: "Mengklik tombol berdasarkan id. param: {id}",
        jalankan: function(p) {
          const el = document.getElementById(p.id);
          if (el) { el.click(); }
        }
      }
    }
  });
</script>`}
                </pre>
                <button
                  onClick={() => {
                    const codeSnippet = `<script src="${serverUrl}/widget.js"></script>\n<script>\n  AIWidget.init({\n    server: "${serverUrl}",\n    aksi: {\n      buka_halaman: {\n        deskripsi: "Pindah ke halaman lain di website ini. param: {url}",\n        jalankan: p => { if (String(p.url).startsWith("/")) location.href = p.url; }\n      }\n    }\n  });\n</script>`;
                    navigator.clipboard.writeText(codeSnippet);
                    alert('Kode embed berhasil disalin ke clipboard!');
                  }}
                  className="absolute top-3 right-3 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 shadow-md"
                >
                  <Copy className="w-3.5 h-3.5" /> Salin Kode
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: ADMIN & SETTINGS */}
        {activeTab === 'admin' && (
          <div className="space-y-6 max-w-2xl mx-auto">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-400" />
                Pengaturan Sistem & Keamanan Admin
              </h2>

              <div className="space-y-4">
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                  <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Status Sistem</h4>
                  <p className="text-sm text-slate-300">Mode tanpa token aktif (bebas upload dan kelola PDF tanpa login).</p>
                </div>

                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                  <h4 className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Endpoint Server URL</h4>
                  <p className="text-sm font-mono text-slate-300">{serverUrl}</p>
                  <p className="text-xs text-slate-500">URL dasar yang digunakan widget untuk terhubung ke backend server.</p>
                </div>

                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                  <h4 className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Model AI Gemini</h4>
                  <p className="text-sm text-slate-300">Menggunakan <span className="font-mono text-indigo-300">gemini-2.5-flash</span> melalui `@google/genai` SDK resmi.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
