/**
 * components/giris-stil.ts
 * Giriş (/giris) ve şifre yenileme (/sifre-yenile) sayfalarının ortak stili.
 */
export const GIRIS_CSS = `
.gr-root{min-height:100vh;display:flex;flex-direction:column;color:#111;font-family:Inter,"Helvetica Neue",Arial,sans-serif;background-color:#fff;background-image:radial-gradient(#d9d9d9 1.4px,transparent 1.5px);background-size:28px 28px;-webkit-font-smoothing:antialiased}
.gr-root *,.gr-root *::before,.gr-root *::after{box-sizing:border-box}
.gr-root :where(a){color:inherit;text-decoration:none}
.gr-root :where(button,input){font:inherit;color:inherit}
.gr-root :where(h1,h2,p){margin:0}
.gr-top{border-bottom:3px solid #111;background:rgba(255,255,255,.92)}
.gr-top-in{max-width:1200px;margin:0 auto;height:68px;padding:0 24px;display:flex;align-items:center;justify-content:space-between}
.gr-logo{font-size:26px;font-weight:900;letter-spacing:-1.5px;display:inline-flex;align-items:baseline;gap:3px}
.gr-dot{width:9px;height:9px;border-radius:50%;background:#f5c518;border:2px solid #111;display:inline-block}
.gr-back{font-size:11px;font-weight:800;letter-spacing:.1em;color:#686868}
.gr-main{flex:1;display:grid;place-items:center;padding:40px 16px}
.gr-card{width:100%;max-width:460px;background:#fff;border:3px solid #111;border-radius:32px;padding:32px;box-shadow:0 10px 0 #111}
.gr-pill{display:inline-block;border:2px solid #111;border-radius:999px;padding:6px 14px;font-size:11px;font-weight:800;letter-spacing:.14em}
.gr-card h1{font-size:40px;line-height:1;letter-spacing:-.05em;font-weight:900;margin:18px 0 8px}
.gr-card h1 span{background:#f5c518;border:3px solid #111;border-radius:14px;padding:0 .14em;display:inline-block;transform:rotate(-1.5deg)}
.gr-sub{color:#686868;font-size:14px;line-height:1.6}
.gr-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:24px 0 4px;padding:5px;border:2.5px solid #111;border-radius:999px;background:#f5f5f5}
.gr-tab{border:0;background:transparent;border-radius:999px;padding:11px;font-size:12px;font-weight:800;letter-spacing:.08em;cursor:pointer}
.gr-tab.on{background:#f5c518;box-shadow:0 0 0 2.5px #111}
.gr-lab{display:block;font-size:11px;font-weight:800;letter-spacing:.12em;margin:18px 0 8px}
.gr-in{width:100%;border:2.5px solid #111;border-radius:16px;background:#fff;padding:14px 16px;font-size:15px;outline:none}
.gr-in:focus{background:#fffdf2;box-shadow:0 0 0 4px #f5c518}
.gr-btn{width:100%;margin-top:22px;border:2.5px solid #111;border-radius:999px;background:#f5c518;padding:16px;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 4px 0 #111;transition:transform .1s,box-shadow .1s}
.gr-btn:hover{transform:translateY(-1px);box-shadow:0 6px 0 #111}
.gr-btn:active{transform:translateY(3px);box-shadow:0 1px 0 #111}
.gr-btn:disabled{opacity:.55;cursor:not-allowed}
.gr-msg{margin-top:16px;border:2.5px solid #111;border-radius:16px;background:#fff6cf;padding:12px 14px;font-size:13px;line-height:1.6;font-weight:600}
.gr-msg.ok{background:#f5c518}
.gr-note{margin-top:18px;font-size:12px;color:#686868;line-height:1.6;text-align:center}
.gr-row{display:flex;justify-content:flex-end;margin-top:10px}
.gr-link{background:none;border:0;padding:0;font-size:12px;font-weight:700;color:#111;cursor:pointer;text-decoration:underline;text-decoration-color:#f5c518;text-decoration-thickness:3px;text-underline-offset:3px}
@media (prefers-reduced-motion:reduce){.gr-btn{transition:none}}
@media (max-width:520px){.gr-card{padding:24px 20px;border-radius:26px}.gr-card h1{font-size:34px}}
`;
