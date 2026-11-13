# HITY7 — Türkçe e-posta şablonları (Supabase)

Supabase'in hazır e-postaları İngilizcedir. Aşağıdaki şablonları **Supabase → Authentication → Emails → Templates** bölümüne yapıştırabilirsin.

- Her şablonda **Subject** (konu) ve **Message body** (içerik) alanlarını doldur.
- `{{ .ConfirmationURL }}` ifadesini silme. Supabase onu kişiye özel bağlantıyla değiştirir.

> Not: Gerçek müşterilere e-posta gidebilmesi için önce kendi e-posta servisini (SMTP) bağlamalısın. Ayrıntılar KURULUM.md 9. adımda.

---

## 1. Confirm signup (üyelik doğrulama)

**Subject:**

```
HITY7 üyeliğini doğrula
```

**Message body:**

```html
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
  <div style="font-size:26px;font-weight:900;letter-spacing:-1px">HITY7<span style="color:#f5c518">●</span></div>
  <h2 style="font-size:22px;margin:24px 0 8px">Hoş geldin!</h2>
  <p style="font-size:15px;line-height:1.6;color:#444">Üyeliğini tamamlamak için aşağıdaki düğmeye tıkla.</p>
  <p style="margin:28px 0">
    <a href="{{ .ConfirmationURL }}" style="background:#f5c518;color:#111;border:2px solid #111;border-radius:999px;padding:14px 26px;font-weight:800;text-decoration:none;display:inline-block">ÜYELİĞİMİ DOĞRULA</a>
  </p>
  <p style="font-size:12px;line-height:1.6;color:#888">Bu üyeliği sen oluşturmadıysan bu e-postayı dikkate alma.</p>
</div>
```

---

## 2. Reset Password (şifre sıfırlama)

**Subject:**

```
HITY7 şifreni yenile
```

**Message body:**

```html
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
  <div style="font-size:26px;font-weight:900;letter-spacing:-1px">HITY7<span style="color:#f5c518">●</span></div>
  <h2 style="font-size:22px;margin:24px 0 8px">Şifreni yenile</h2>
  <p style="font-size:15px;line-height:1.6;color:#444">Hesabın için şifre sıfırlama isteği aldık. Yeni şifreni belirlemek için aşağıdaki düğmeye tıkla. Bağlantı kısa süre geçerlidir ve yalnızca bir kez kullanılabilir.</p>
  <p style="margin:28px 0">
    <a href="{{ .ConfirmationURL }}" style="background:#f5c518;color:#111;border:2px solid #111;border-radius:999px;padding:14px 26px;font-weight:800;text-decoration:none;display:inline-block">YENİ ŞİFRE BELİRLE</a>
  </p>
  <p style="font-size:12px;line-height:1.6;color:#888">Bu isteği sen yapmadıysan bu e-postayı dikkate alma; şifren değişmez.</p>
</div>
```
