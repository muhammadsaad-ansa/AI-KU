/*
  Widget AI untuk website Anda. Tempel sebelum </body>:

  <script src="widget.js"></script>
  <script>
    AIWidget.init({
      server: "https://alamat-server-anda.com",
      aksi: {
        buka_halaman: {
          deskripsi: "Pindah ke halaman lain di website ini. param: {url} (diawali /)",
          jalankan: p => { if (String(p.url).startsWith("/")) location.href = p.url; }
        },
        isi_kolom: {
          deskripsi: "Mengisi kolom form. param: {id, nilai}",
          jalankan: p => { const e = document.getElementById(p.id); if (e) e.value = p.nilai; }
        },
        klik_tombol: {
          deskripsi: "Mengklik elemen berdasarkan id. param: {id}",
          jalankan: p => { const e = document.getElementById(p.id); if (e) e.click(); }
        }
      }
    });
  </script>

  Hanya aksi yang Anda daftarkan di sini yang bisa dijalankan AI.
*/
(function () {
  const W = {};
  W.init = function (o) {
    const server = o.server.replace(/\/$/, "");
    const aksi = o.aksi || {};
    const riwayat = [];

    const css = document.createElement("style");
    css.textContent =
      "#aiw-b{position:fixed;right:16px;bottom:16px;width:56px;height:56px;border-radius:50%;border:0;background:#c4581f;color:#fff;font-size:26px;z-index:99999;cursor:pointer}" +
      "#aiw-p{position:fixed;right:16px;bottom:84px;width:min(360px,calc(100vw - 32px));height:min(480px,70vh);background:#fff;color:#1f1e1d;border:1px solid #ddd;border-radius:14px;display:none;flex-direction:column;z-index:99999;font:15px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.18)}" +
      "#aiw-l{flex:1;overflow-y:auto;padding:12px}" +
      ".aiw-m{padding:8px 10px;border-radius:10px;margin-bottom:8px;white-space:pre-wrap;background:#f3f1ee}" +
      ".aiw-u{background:#f6e3d6;margin-left:28px}" +
      "#aiw-r{display:flex;gap:6px;padding:8px;border-top:1px solid #eee}" +
      "#aiw-i{flex:1;border:1px solid #ddd;border-radius:10px;padding:8px;font:inherit}" +
      "#aiw-s{border:0;background:#c4581f;color:#fff;border-radius:10px;padding:0 14px;font:inherit}";
    document.head.appendChild(css);

    const btn = document.createElement("button");
    btn.id = "aiw-b";
    btn.textContent = "\uD83E\uDDE0";
    btn.setAttribute("aria-label", "Buka asisten AI");
    const panel = document.createElement("div");
    panel.id = "aiw-p";
    panel.innerHTML = '<div id="aiw-l"></div><div id="aiw-r"><input id="aiw-i" placeholder="Tulis pesan..."><button id="aiw-s">Kirim</button></div>';
    document.body.append(btn, panel);

    const log = panel.querySelector("#aiw-l");
    const input = panel.querySelector("#aiw-i");
    btn.onclick = () => { panel.style.display = panel.style.display === "flex" ? "none" : "flex"; };

    function tambah(teks, user) {
      const d = document.createElement("div");
      d.className = "aiw-m" + (user ? " aiw-u" : "");
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
      const out = tambah("...", false);
      try {
        const r = await fetch(server + "/chat", {
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
        out.textContent = d.balasan || "(selesai)";
        riwayat.push({ role: "user", content: pesan }, { role: "assistant", content: d.balasan || "" });
        for (const a of d.aksi || []) {
          if (aksi[a.nama]) {
            try { aksi[a.nama].jalankan(a.param || {}); } catch (e) { console.error(e); }
          }
        }
      } catch (e) {
        out.textContent = "Gagal terhubung ke server.";
      }
    }
    panel.querySelector("#aiw-s").onclick = kirim;
    input.addEventListener("keydown", e => { if (e.key === "Enter") kirim(); });
  };
  window.AIWidget = W;
})();
