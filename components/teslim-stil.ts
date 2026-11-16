/** /teslim sayfalarının ortak stili (HITY7 tasarım dili: beyaz, siyah çerçeve, sarı #F5C518). */
export const TESLIM_CSS = `
.tl-root{min-height:calc(100vh - 71px);color:#111;font-family:Inter,"Helvetica Neue",Arial,sans-serif;background-color:#fff;background-image:radial-gradient(#d9d9d9 1.4px,transparent 1.5px);background-size:28px 28px;-webkit-font-smoothing:antialiased}
.tl-root *,.tl-root *::before,.tl-root *::after{box-sizing:border-box}
.tl-root :where(h1,h2,h3,p){margin:0}
.tl-wrap{max-width:1100px;margin:0 auto;padding:44px 20px 80px}
.tl-pill{display:inline-block;border:2px solid #111;border-radius:999px;padding:6px 14px;font-size:11px;font-weight:800;letter-spacing:.14em;background:#fff}
.tl-h1{font-size:clamp(40px,7vw,78px);line-height:.92;letter-spacing:-.05em;font-weight:900;margin:18px 0 12px}
.tl-h1 span{background:#f5c518;padding:0 .12em;border:3px solid #111;border-radius:16px;display:inline-block;transform:rotate(-1.5deg)}
.tl-lead{color:#686868;font-size:15.5px;line-height:1.65;max-width:620px}
.tl-kart{background:#fff;border:3px solid #111;border-radius:26px;padding:20px;box-shadow:0 7px 0 #111}
.tl-liste{display:grid;gap:14px;margin-top:28px}
.tl-satir{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center}
.tl-satir h3{font-size:18px;font-weight:900;letter-spacing:-.02em}
.tl-meta{font-size:12.5px;color:#686868;margin-top:4px;line-height:1.5}
.tl-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:2.5px solid #111;border-radius:999px;background:#f5c518;font-size:12.5px;font-weight:800;letter-spacing:.04em;padding:11px 16px;cursor:pointer;box-shadow:0 3px 0 #111;color:#111;text-decoration:none;white-space:nowrap;transition:transform .1s,box-shadow .1s}
.tl-btn:hover{transform:translateY(-1px);box-shadow:0 5px 0 #111}
.tl-btn:disabled{opacity:.55;cursor:not-allowed;transform:none}
.tl-btn.beyaz{background:#fff}
.tl-btn.siyah{background:#111;color:#f5c518}
.tl-durum{display:inline-block;border:2px solid #111;border-radius:999px;padding:4px 10px;font-size:10.5px;font-weight:900;letter-spacing:.08em}
.tl-durum.hazirlaniyor{background:#fff}
.tl-durum.teslim_edildi{background:#f5c518}
.tl-durum.revizyon{background:#ffe1dc}
.tl-durum.tamamlandi{background:#111;color:#f5c518}
.tl-dosya{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;border:2.5px solid #111;border-radius:18px;padding:12px 14px;background:#fff}
.tl-dosya b{display:block;font-size:14px;overflow-wrap:anywhere}
.tl-dosya small{font-size:11.5px;color:#686868}
.tl-surum{margin-top:18px;font-size:11px;font-weight:800;letter-spacing:.12em;color:#686868}
.tl-not{margin-top:14px;border:2.5px dashed #111;border-radius:18px;padding:12px 14px;background:#fffdf2;font-size:13.5px;line-height:1.6}
.tl-msg{margin-top:14px;border:2.5px solid #111;border-radius:16px;background:#fff6cf;padding:12px 14px;font-size:13.5px;line-height:1.6;font-weight:600}
.tl-in{width:100%;border:2.5px solid #111;border-radius:16px;background:#fff;padding:12px 14px;font-size:15px;outline:none;font-family:inherit;resize:vertical}
.tl-in:focus{background:#fffdf2;box-shadow:0 0 0 4px #f5c518}
.tl-bos{border:3px dashed #111;border-radius:26px;padding:30px;text-align:center;background:#fff;font-weight:600;color:#555;line-height:1.6;margin-top:28px}
.tl-iki{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:20px;margin-top:28px;align-items:start}
@media (max-width:820px){.tl-iki{grid-template-columns:1fr}}
@media (max-width:560px){.tl-wrap{padding:30px 16px 60px}.tl-satir{grid-template-columns:1fr}.tl-dosya{grid-template-columns:1fr}.tl-btn{width:100%}}
`;

export const DURUM_ADI: Record<string, string> = {
  hazirlaniyor: "Hazırlanıyor",
  teslim_edildi: "Teslim Edildi",
  revizyon: "Revizyon İstendi",
  tamamlandi: "Tamamlandı",
};
