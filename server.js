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
    const { isim = "", mesaj = "", konu = "" } = req.body || {};

    if (!process.env.RESEND_API_KEY) {
      return res.status(500).send("Sunucu ayarı eksik: RESEND_API_KEY yok.");
    }
    if (!process.env.TO_EMAIL) {
      return res.status(500).send("Sunucu ayarı eksik: TO_EMAIL yok.");
    }

    if (!isim.trim() || !mesaj.trim()) {
      return res.status(400).send("İsim ve mesaj zorunlu.");
    }

    console.log("POST /gonder:", req.headers["content-type"], {
      isim,
      konu,
      msgLen: mesaj.length,
    });

    const resend = new Resend(process.env.RESEND_API_KEY);

    const result = await resend.emails.send({
      from: "onboarding@resend.dev",
      to: [process.env.TO_EMAIL],
      subject: `Yeni Mesaj${konu ? `: ${konu}` : ""}`,
      html: `
        <h2>Yeni Mesaj Geldi</h2>
        <p><strong>İsim:</strong> ${escapeHtml(isim)}</p>
        ${konu ? `<p><strong>Konu:</strong> ${escapeHtml(konu)}</p>` : ""}
        <p><strong>Mesaj:</strong></p>
        <pre style="white-space:pre-wrap;font-family:Arial">${escapeHtml(mesaj)}</pre>
      `,
    });

    console.log("Mail gönderildi:", result?.id || result);

    return res.send("Mesaj gönderildi ✅");
  } catch (err) {
    console.error("RESEND ERROR:", err);
    return res.status(500).send(err?.message || "Mail gönderilemedi ❌");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sunucu çalışıyor: ${PORT}`));