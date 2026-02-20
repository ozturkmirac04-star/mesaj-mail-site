const express = require("express");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

app.post("/gonder", async (req, res) => {
    const { isim, mesaj } = req.body;

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.EMAIL,
            pass: process.env.PASS
        }
    });

    const mailOptions = {
        from: process.env.EMAIL,
        to: process.env.EMAIL,
        subject: "Yeni Mesaj Geldi!",
        text: `İsim: ${isim}\nMesaj: ${mesaj}`
    };

    try {
        await transporter.sendMail(mailOptions);
        res.send("Mesaj gönderildi!");
    } catch (error) {
        console.log(error);
        res.send("Hata oluştu!");
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Sunucu çalışıyor...");
});