const express = require("express");
require("dotenv").config();
const { Resend } = require("resend");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

app.get("/health", (req, res) => res.status(200).send("OK"));

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

app.post("/gonder", async (req, res) => {
  try {
    const {
      isim = "",
      email = "",
      mesaj = "",
      konu = ""
    } = req.body || {};

    // Environment kontrolü
    if (!process.env.RESEND_API_KEY) {
      return res.status(500).send("Sunucu ayarı eksik: RESEND_API_KEY yok.");
    }

    if (!process.env.TO_EMAIL) {
      return res.status(500).send("Sunucu ayarı eksik: TO_EMAIL yok.");
    }

    // Zorunlu alan kontrolü
    if (!isim.trim() || !email.trim() || !mesaj.trim()) {
      return res.status(400).send("İsim, email ve mesaj zorunlu.");
    }

    // Basit email doğrulama
    if (!email.includes("@")) {
      return res.status(400).send("Geçerli bir email adresi giriniz.");
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    const result = await resend.emails.send({
      from: "onboarding@resend.dev", // domain doğruladıktan sonra bunu değiştirebiliriz
      to: [process.env.TO_EMAIL],
      reply_to: email, // 👈 EN ÖNEMLİ KISIM
      subject: `Yeni Mesaj${konu ? `: ${escapeHtml(konu)}` : ""}`,
      html: `
        <h2>Yeni Mesaj Geldi</h2>
        <p><strong>İsim:</strong> ${escapeHtml(isim)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        ${konu ? `<p><strong>Konu:</strong> ${escapeHtml(konu)}</p>` : ""}
        <p><strong>Mesaj:</strong></p>
        <pre style="white-space:pre-wrap;font-family:Arial">${escapeHtml(mesaj)}</pre>
      `,
    });

    console.log("Mail gönderildi:", result?.id || result);

    return res.send("Mesaj gönderildi ✅");
  } catch (err) {
    console.error("RESEND ERROR:", err);
    return res.status(500).send("Mail gönderilemedi ❌");
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Sunucu çalışıyor: ${PORT}`);
});