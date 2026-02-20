const express = require("express");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();

// Render/proxy arkasında daha sağlıklı IP vb. için (opsiyonel)
app.set("trust proxy", 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.get("/health", (req, res) => res.status(200).send("OK"));

app.post("/gonder", async (req, res) => {
  const isim = (req.body.isim || "").trim();
  const mesaj = (req.body.mesaj || "").trim();

  if (!isim || !mesaj) {
    return res.status(400).send("İsim ve mesaj zorunlu.");
  }

  if (!process.env.EMAIL || !process.env.PASS) {
    return res
      .status(500)
      .send("Sunucu ayarı eksik: EMAIL/PASS Render'da tanımlı değil.");
  }

  // Gmail SMTP (service:'gmail' yerine) - timeout ihtimalini azaltır
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL,
      pass: process.env.PASS, // Gmail App Password (16 haneli)
    },
    connectionTimeout: 20000, // 20s
    greetingTimeout: 20000,
    socketTimeout: 20000,
  });

  const mailOptions = {
    from: process.env.EMAIL,
    to: process.env.EMAIL, // İstersen ayrı bir alıcı için TO_EMAIL ekleyebiliriz
    subject: "Yeni Mesaj Geldi!",
    text: `İsim: ${isim}\n\nMesaj:\n${mesaj}\n\n---\nGönderen IP: ${req.ip}`,
  };

  try {
    await transporter.sendMail(mailOptions);
    return res.send("Mesaj gönderildi ✅");
  } catch (error) {
    console.log("MAIL HATASI:", error);
    return res.status(500).send("Mail gönderilemedi ❌");
  }
});

// Render için PORT şart
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sunucu çalışıyor: ${PORT}`);
});