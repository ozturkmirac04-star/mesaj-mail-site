const express = require("express");
require("dotenv").config();
const { Resend } = require("resend");

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// Health check
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Mesaj endpointi (premium HTML buna istek atıyor)
app.post("/gonder", async (req, res) => {
  try {
    const { isim = "", mesaj = "", konu = "" } = req.body || {};

    if (!isim.trim() || !mesaj.trim()) {
      return res.status(400).send("İsim ve mesaj zorunlu.");
    }

    console.log("POST /gonder:", { isim, konu });

    const result = await resend.emails.send({
      from: "onboarding@resend.dev", // Domain doğrulamazsan bu kalmalı
      to: process.env.TO_EMAIL,
      subject: `Yeni Mesaj${konu ? `: ${konu}` : ""}`,
      html: `
        <h2>Yeni Mesaj Geldi</h2>
        <p><strong>İsim:</strong> ${escapeHtml(isim)}</p>
        ${konu ? `<p><strong>Konu:</strong> ${escapeHtml(konu)}</p>` : ""}
        <p><strong>Mesaj:</strong></p>
        <pre style="white-space:pre-wrap;font-family:Arial">${escapeHtml(mesaj)}</pre>
      `,
    });

    console.log("Mail gönderildi:", result?.id);

    return res.send("Mesaj gönderildi ✅");
  } catch (err) {
    console.error("RESEND ERROR:", err);
    return res.status(500).send(err?.message || "Mail gönderilemedi ❌");
  }
});

// HTML injection koruması
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Render için zorunlu PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sunucu çalışıyor: ${PORT}`);
});