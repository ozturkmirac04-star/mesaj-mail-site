const express = require("express");
require("dotenv").config();
const { Resend } = require("resend");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();

app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: true, limit: "20kb" }));
app.use(express.static("public"));

/* =========================
   DATABASE
========================= */

let pool = null;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  pool.on("error", (err) => {
    console.error("PostgreSQL pool error:", err);
  });
}

/* =========================
   HEALTH
========================= */

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

/* =========================
   HTML ESCAPE
========================= */

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================
   CHAT DATABASE SETUP
========================= */

async function setupDatabase() {
  if (!pool) {
    console.log("DATABASE_URL bulunamadı. Sohbet sistemi kapalı.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chats (
      id UUID PRIMARY KEY,
      public_code VARCHAR(12) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      sender VARCHAR(20) NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS messages_chat_id_idx
    ON messages(chat_id);
  `);

  console.log("Chat database hazır.");
}

/* =========================
   CHAT HELPERS
========================= */

function generateCode() {
  return crypto
    .randomBytes(5)
    .toString("hex")
    .toUpperCase();
}

function validChatId(id) {
  return /^[0-9a-fA-F-]{36}$/.test(id);
}

/* =========================
   CREATE CHAT
========================= */

app.post("/api/chat/create", async (req, res) => {
  try {
    if (!pool) {
      return res.status(503).json({
        error: "Sohbet sistemi şu anda hazır değil."
      });
    }

    const chatId = crypto.randomUUID();
    const code = generateCode();

    await pool.query(
      `
      INSERT INTO chats (id, public_code)
      VALUES ($1, $2)
      `,
      [chatId, code]
    );

    return res.json({
      chatId,
      code
    });

  } catch (err) {
    console.error("CHAT CREATE ERROR:", err);

    return res.status(500).json({
      error: "Sohbet oluşturulamadı."
    });
  }
});

/* =========================
   CHAT INFO
========================= */

app.get("/api/chat/:id/info", async (req, res) => {
  try {
    if (!pool) {
      return res.status(503).json({
        error: "Sohbet sistemi hazır değil."
      });
    }

    const { id } = req.params;

    if (!validChatId(id)) {
      return res.status(400).json({
        error: "Geçersiz sohbet."
      });
    }

    const result = await pool.query(
      `
      SELECT public_code
      FROM chats
      WHERE id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Sohbet bulunamadı."
      });
    }

    return res.json({
      code: result.rows[0].public_code
    });

  } catch (err) {
    console.error("CHAT INFO ERROR:", err);

    return res.status(500).json({
      error: "Sohbet bilgisi alınamadı."
    });
  }
});

/* =========================
   GET MESSAGES
========================= */

app.get("/api/chat/:id", async (req, res) => {
  try {
    if (!pool) {
      return res.status(503).json({
        error: "Sohbet sistemi hazır değil."
      });
    }

    const { id } = req.params;

    if (!validChatId(id)) {
      return res.status(400).json({
        error: "Geçersiz sohbet."
      });
    }

    const chatResult = await pool.query(
      `
      SELECT id
      FROM chats
      WHERE id = $1
      `,
      [id]
    );

    if (chatResult.rows.length === 0) {
      return res.status(404).json({
        error: "Sohbet bulunamadı."
      });
    }

    const messagesResult = await pool.query(
      `
      SELECT
        id,
        sender,
        message AS text,
        created_at
      FROM messages
      WHERE chat_id = $1
      ORDER BY created_at ASC
      LIMIT 200
      `,
      [id]
    );

    return res.json({
      messages: messagesResult.rows
    });

  } catch (err) {
    console.error("CHAT GET ERROR:", err);

    return res.status(500).json({
      error: "Mesajlar alınamadı."
    });
  }
});

/* =========================
   SEND CHAT MESSAGE
========================= */

app.post("/api/chat/:id/message", async (req, res) => {
  try {
    if (!pool) {
      return res.status(503).send(
        "Sohbet sistemi şu anda hazır değil."
      );
    }

    const { id } = req.params;
    const text = String(req.body?.text || "").trim();

    if (!validChatId(id)) {
      return res.status(400).send(
        "Geçersiz sohbet."
      );
    }

    if (!text) {
      return res.status(400).send(
        "Mesaj boş olamaz."
      );
    }

    if (text.length > 1000) {
      return res.status(400).send(
        "Mesaj en fazla 1000 karakter olabilir."
      );
    }

    const chatResult = await pool.query(
      `
      SELECT id
      FROM chats
      WHERE id = $1
      `,
      [id]
    );

    if (chatResult.rows.length === 0) {
      return res.status(404).send(
        "Sohbet bulunamadı."
      );
    }

    await pool.query(
      `
      INSERT INTO messages
        (chat_id, sender, message)
      VALUES
        ($1, 'visitor', $2)
      `,
      [id, text]
    );

    return res.json({
      success: true
    });

  } catch (err) {
    console.error("CHAT MESSAGE ERROR:", err);

    return res.status(500).send(
      "Mesaj gönderilemedi."
    );
  }
});

/* =========================
   OLD EMAIL MESSAGE SYSTEM
   ========================= */

app.post("/gonder", async (req, res) => {
  try {
    const {
      isim = "",
      email = "",
      mesaj = "",
      konu = ""
    } = req.body || {};

    if (!process.env.RESEND_API_KEY) {
      return res.status(500).send(
        "Sunucu ayarı eksik: RESEND_API_KEY yok."
      );
    }

    if (!process.env.TO_EMAIL) {
      return res.status(500).send(
        "Sunucu ayarı eksik: TO_EMAIL yok."
      );
    }

    if (
      !isim.trim() ||
      !email.trim() ||
      !mesaj.trim()
    ) {
      return res.status(400).send(
        "İsim, email ve mesaj zorunlu."
      );
    }

    if (!email.includes("@")) {
      return res.status(400).send(
        "Geçerli bir email adresi giriniz."
      );
    }

    const resend =
      new Resend(process.env.RESEND_API_KEY);

    const result =
      await resend.emails.send({
        from: "onboarding@resend.dev",
        to: [process.env.TO_EMAIL],
        reply_to: email,

        subject:
          `Yeni Mesaj${
            konu
              ? `: ${escapeHtml(konu)}`
              : ""
          }`,

        html: `
          <h2>Yeni Mesaj Geldi</h2>

          <p>
            <strong>İsim:</strong>
            ${escapeHtml(isim)}
          </p>

          <p>
            <strong>Email:</strong>
            ${escapeHtml(email)}
          </p>

          ${
            konu
              ? `
                <p>
                  <strong>Konu:</strong>
                  ${escapeHtml(konu)}
                </p>
              `
              : ""
          }

          <p>
            <strong>Mesaj:</strong>
          </p>

          <pre
            style="
              white-space:pre-wrap;
              font-family:Arial
            "
          >${escapeHtml(mesaj)}</pre>
        `
      });

    console.log(
      "Mail gönderildi:",
      result?.id || result
    );

    return res.send(
      "Mesaj gönderildi ✅"
    );

  } catch (err) {

    console.error(
      "RESEND ERROR:",
      err
    );

    return res.status(500).send(
      "Mail gönderilemedi ❌"
    );
  }
});

/* =========================
   START SERVER
========================= */

const PORT =
  process.env.PORT || 3000;

async function startServer() {

  try {

    await setupDatabase();

    app.listen(PORT, () => {

      console.log(
        `Sunucu çalışıyor: ${PORT}`
      );

    });

  } catch (err) {

    console.error(
      "DATABASE STARTUP ERROR:",
      err
    );

    process.exit(1);
  }
}

startServer();
