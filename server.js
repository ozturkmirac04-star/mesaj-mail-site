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
   ADMIN SESSIONS
========================= */

const adminSessions = new Map();

function createAdminSession() {
  const token = crypto.randomBytes(32).toString("hex");

  adminSessions.set(token, {
    createdAt: Date.now()
  });

  return token;
}

function isAdmin(req) {
  const cookie = req.headers.cookie || "";

  const match = cookie
    .split(";")
    .map(x => x.trim())
    .find(x => x.startsWith("admin_session="));

  if (!match) return false;

  const token = match.substring("admin_session=".length);

  return adminSessions.has(token);
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(401).json({
      error: "Yetkisiz erişim."
    });
  }

  next();
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
   DATABASE SETUP
========================= */

async function setupDatabase() {
  if (!pool) {
    console.log("DATABASE_URL bulunamadı.");
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
  return crypto.randomBytes(5).toString("hex").toUpperCase();
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

    res.json({
      chatId,
      code
    });

  } catch (err) {
    console.error("CHAT CREATE ERROR:", err);

    res.status(500).json({
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

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Sohbet bulunamadı."
      });
    }

    res.json({
      code: result.rows[0].public_code
    });

  } catch (err) {
    console.error("CHAT INFO ERROR:", err);

    res.status(500).json({
      error: "Sohbet bilgisi alınamadı."
    });
  }
});

/* =========================
   GET CHAT MESSAGES
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

    const result = await pool.query(
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

    res.json({
      messages: result.rows
    });

  } catch (err) {
    console.error("CHAT GET ERROR:", err);

    res.status(500).json({
      error: "Mesajlar alınamadı."
    });
  }
});

/* =========================
   VISITOR SEND MESSAGE
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
      return res.status(400).send("Geçersiz sohbet.");
    }

    if (!text) {
      return res.status(400).send("Mesaj boş olamaz.");
    }

    if (text.length > 1000) {
      return res.status(400).send(
        "Mesaj en fazla 1000 karakter olabilir."
      );
    }

    const chat = await pool.query(
      `SELECT id FROM chats WHERE id = $1`,
      [id]
    );

    if (!chat.rows.length) {
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

    res.json({
      success: true
    });

  } catch (err) {
    console.error("CHAT MESSAGE ERROR:", err);

    res.status(500).send(
      "Mesaj gönderilemedi."
    );
  }
});

/* =========================
   ADMIN LOGIN
========================= */

app.post("/api/admin/login", (req, res) => {
  const password = String(
    req.body?.password || ""
  );

  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({
      error: "ADMIN_PASSWORD ayarlanmamış."
    });
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({
      error: "Şifre yanlış."
    });
  }

  const token = createAdminSession();

  res.setHeader(
    "Set-Cookie",
    `admin_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`
  );

  res.json({
    success: true
  });
});

/* =========================
   ADMIN LOGOUT
========================= */

app.post(
  "/api/admin/logout",
  requireAdmin,
  (req, res) => {

    const cookie =
      req.headers.cookie || "";

    const match = cookie
      .split(";")
      .map(x => x.trim())
      .find(x =>
        x.startsWith("admin_session=")
      );

    if (match) {
      const token =
        match.substring(
          "admin_session=".length
        );

      adminSessions.delete(token);
    }

    res.setHeader(
      "Set-Cookie",
      "admin_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
    );

    res.json({
      success: true
    });
  }
);

/* =========================
   ADMIN CHAT LIST
========================= */

app.get(
  "/api/admin/chats",
  requireAdmin,
  async (req, res) => {

    try {

      if (!pool) {
        return res.status(503).json({
          error: "Database hazır değil."
        });
      }

      const result = await pool.query(`
        SELECT
          c.id,
          c.public_code,
          c.created_at,
          COUNT(m.id)::int AS message_count,

          MAX(m.created_at)
            AS last_message_at

        FROM chats c

        LEFT JOIN messages m
          ON m.chat_id = c.id

        GROUP BY
          c.id

        ORDER BY
          COALESCE(
            MAX(m.created_at),
            c.created_at
          ) DESC

        LIMIT 100
      `);

      res.json({
        chats: result.rows
      });

    } catch (err) {

      console.error(
        "ADMIN CHAT LIST ERROR:",
        err
      );

      res.status(500).json({
        error: "Sohbetler alınamadı."
      });
    }
  }
);

/* =========================
   ADMIN GET CHAT
========================= */

app.get(
  "/api/admin/chat/:id",
  requireAdmin,
  async (req, res) => {

    try {

      const { id } = req.params;

      if (!validChatId(id)) {
        return res.status(400).json({
          error: "Geçersiz sohbet."
        });
      }

      const result = await pool.query(
        `
        SELECT
          id,
          sender,
          message AS text,
          created_at

        FROM messages

        WHERE chat_id = $1

        ORDER BY created_at ASC

        LIMIT 500
        `,
        [id]
      );

      res.json({
        messages: result.rows
      });

    } catch (err) {

      console.error(
        "ADMIN CHAT ERROR:",
        err
      );

      res.status(500).json({
        error: "Sohbet alınamadı."
      });
    }
  }
);

/* =========================
   ADMIN SEND REPLY
========================= */

app.post(
  "/api/admin/chat/:id/message",
  requireAdmin,
  async (req, res) => {

    try {

      const { id } = req.params;

      const text =
        String(
          req.body?.text || ""
        ).trim();

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

      await pool.query(
        `
        INSERT INTO messages
          (chat_id, sender, message)
        VALUES
          ($1, 'admin', $2)
        `,
        [id, text]
      );

      res.json({
        success: true
      });

    } catch (err) {

      console.error(
        "ADMIN SEND ERROR:",
        err
      );

      res.status(500).send(
        "Cevap gönderilemedi."
      );
    }
  }
);

/* =========================
   OLD EMAIL SYSTEM
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
      new Resend(
        process.env.RESEND_API_KEY
      );

    const result =
      await resend.emails.send({

        from:
          "onboarding@resend.dev",

        to: [
          process.env.TO_EMAIL
        ],

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

    res.send(
      "Mesaj gönderildi ✅"
    );

  } catch (err) {

    console.error(
      "RESEND ERROR:",
      err
    );

    res.status(500).send(
      "Mail gönderilemedi ❌"
    );
  }
});

/* =========================
   START
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
