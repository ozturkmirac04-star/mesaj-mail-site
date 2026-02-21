const express = require("express");
require("dotenv").config();
const { Resend } = require("resend");

const app = express();

app.post("/gonder", async (req, res) => {
  console.log("POST /gonder geldi:", req.headers["content-type"], req.body);
  // ...
});
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.get("/health", (req, res) => res.status(200).send("OK"));

app.post("/gonder", async (req, res) => {
  const isim = (req.body.isim || "").trim();
  const mesaj = (req.body.mesaj || "").trim();
  const konu = (req.body.konu || "").trim(); // premium UI gönderiyor olabilir

  console.log("POST /gonder:", req.headers["content-type"], { isim, konu, msgLen: mesaj.length });

  if (!isim || !mesaj) return res.status(400).send("İsim ve mesaj zorunlu.");

  // Resend gönderimi burada...
});
  const resend = new Resend(process.env.RESEND_API_KEY);

  // Not: Resend'de doğrulanmış domain yoksa from adresi genelde onboarding adresi olur.
  // Şimdilik en güvenlisi: "onboarding@resend.dev"
  const fromAddress = process.env.FROM_EMAIL || "onboarding@resend.dev";
  const toAddress = process.env.TO_EMAIL || process.env.EMAIL; // İstersen TO_EMAIL ekle

  if (!toAddress) {
    return res.status(500).send("Sunucu ayarı eksik: TO_EMAIL/EMAIL yok.");
  }

  try {
    await resend.emails.send({
      from: fromAddress,
      to: [toAddress],
      subject: "Yeni Mesaj Geldi!",
      text: `İsim: ${isim}\n\nMesaj:\n${mesaj}\n\nIP: ${req.ip}`,
    });

    return res.send("Mesaj gönderildi ✅");
  } catch (err) {
    console.log("RESEND ERROR:", err);
    return res.status(500).send("Mail gönderilemedi ❌");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sunucu çalışıyor: ${PORT}`));