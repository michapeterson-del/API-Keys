// Eigenständiger Server für den API-Key Manager (ersetzt Supabase).
// Keine Abhängigkeiten – nur Node.js-Bordmittel.
//
// Umgebungsvariablen:
//   SESSION_SECRET  Pflicht, langer Zufallswert (signiert die Login-Cookies)
//   ENCRYPTION_KEY  Pflicht, 64 Hex-Zeichen (verschlüsselt die gespeicherten Keys)
//   ADMIN_EMAIL     E-Mail des ersten Kontos (nur beim allerersten Start)
//   ADMIN_PASSWORD  Passwort des ersten Kontos (nur beim allerersten Start)
//   DATA_DIR        Speicherort der Daten (Standard: ./data)
//   PORT            Standard: 3000
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY || "", "hex");
const COOKIE = "akm_session";
const SESSION_DAYS = 30;

if (SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET fehlt oder ist kürzer als 32 Zeichen.");
if (ENCRYPTION_KEY.length !== 32) throw new Error("ENCRYPTION_KEY muss genau 64 Hex-Zeichen haben.");

// ---------- Speicher ----------

function emptyStore() {
  return { users: [], keys: [] };
}

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return emptyStore();
    throw err;
  }
}

let store = loadStore();

function saveStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DATA_FILE);
}

// ---------- Verschlüsselung der Keys (AES-256-GCM) ----------

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const data = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

function decrypt(value) {
  const [iv, tag, data] = value.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

// ---------- Passwörter und Sitzungen ----------

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function checkPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = crypto.scryptSync(String(password), salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sign = (value) => crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");

function createSession(user) {
  const expires = Date.now() + SESSION_DAYS * 86400 * 1000;
  // tokenVersion: ändert sich beim Passwortwechsel → alte Sitzungen werden ungültig
  const payload = `${user.id}.${expires}.${user.tokenVersion}`;
  return `${payload}.${sign(payload)}`;
}

function sessionUser(req) {
  const cookie = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!cookie) return null;
  const token = cookie.slice(COOKIE.length + 1);
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [id, expires, version, sig] = parts;
  const expected = sign(`${id}.${expires}.${version}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(expires) < Date.now()) return null;
  const user = store.users.find((u) => u.id === id);
  if (!user || String(user.tokenVersion) !== version) return null;
  return user;
}

const sessionCookie = (token) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

// Erstes Konto aus den Umgebungsvariablen anlegen (nur wenn noch keins existiert)
if (store.users.length === 0 && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  store.users.push({
    id: crypto.randomUUID(),
    email: process.env.ADMIN_EMAIL.trim().toLowerCase(),
    passwordHash: hashPassword(process.env.ADMIN_PASSWORD),
    tokenVersion: 0,
  });
  saveStore();
  console.log(`Konto ${process.env.ADMIN_EMAIL} angelegt.`);
}

// ---------- Hilfsfunktionen ----------

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Cache-Control": "no-store",
    ...(isJson ? { "Content-Type": "application/json; charset=utf-8" } : {}),
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

const fail = (res, status, error) => send(res, status, { error });

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 100_000) {
        reject(Object.assign(new Error("Anfrage zu groß."), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(Object.assign(new Error("Ungültige Anfrage."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

const clean = (v, max) => String(v ?? "").trim().slice(0, max);
const publicKey = (k) => ({ id: k.id, name: k.name, provider: k.provider, key: decrypt(k.key), created_at: k.created_at });

// Bremst das Durchprobieren von Passwörtern: max. 10 Fehlversuche pro IP und 15 Minuten
const failedLogins = new Map();
function tooManyAttempts(ip) {
  const entry = failedLogins.get(ip);
  return entry && entry.count >= 10 && Date.now() - entry.since < 15 * 60 * 1000;
}
function noteFailedLogin(ip) {
  const entry = failedLogins.get(ip);
  if (!entry || Date.now() - entry.since > 15 * 60 * 1000) failedLogins.set(ip, { count: 1, since: Date.now() });
  else entry.count++;
}

// ---------- API ----------

async function handleApi(req, res, pathname) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

  if (pathname === "/api/login" && req.method === "POST") {
    if (tooManyAttempts(ip)) return fail(res, 429, "Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.");
    const body = await readJson(req);
    const email = clean(body.email, 200).toLowerCase();
    const user = store.users.find((u) => u.email === email);
    if (!user || !checkPassword(body.password, user.passwordHash)) {
      noteFailedLogin(ip);
      await new Promise((r) => setTimeout(r, 1000));
      return fail(res, 401, "E-Mail oder Passwort falsch.");
    }
    failedLogins.delete(ip);
    return send(res, 200, { email: user.email }, { "Set-Cookie": sessionCookie(createSession(user)) });
  }

  if (pathname === "/api/logout" && req.method === "POST") {
    return send(res, 200, { ok: true }, { "Set-Cookie": clearCookie });
  }

  const user = sessionUser(req);
  if (!user) return fail(res, 401, "Nicht angemeldet.");

  if (pathname === "/api/me" && req.method === "GET") return send(res, 200, { email: user.email });

  if (pathname === "/api/password" && req.method === "POST") {
    const body = await readJson(req);
    const password = String(body.password || "");
    if (password.length < 8) return fail(res, 400, "Das Passwort muss mindestens 8 Zeichen haben.");
    user.passwordHash = hashPassword(password);
    user.tokenVersion++;
    saveStore();
    return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(createSession(user)) });
  }

  if (pathname === "/api/keys" && req.method === "GET") {
    const keys = store.keys
      .filter((k) => k.user_id === user.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(publicKey);
    return send(res, 200, keys);
  }

  if (pathname === "/api/keys" && req.method === "POST") {
    const body = await readJson(req);
    const name = clean(body.name, 200);
    const provider = clean(body.provider, 100) || "Andere";
    const key = clean(body.key, 10_000);
    if (!name || !key) return fail(res, 400, "Bezeichnung und Key sind Pflicht.");
    const entry = { id: crypto.randomUUID(), user_id: user.id, name, provider, key: encrypt(key), created_at: new Date().toISOString() };
    store.keys.push(entry);
    saveStore();
    return send(res, 201, publicKey(entry));
  }

  const match = pathname.match(/^\/api\/keys\/([0-9a-f-]{36})$/);
  if (match) {
    const entry = store.keys.find((k) => k.id === match[1] && k.user_id === user.id);
    if (!entry) return fail(res, 404, "Key nicht gefunden.");

    if (req.method === "PUT") {
      const body = await readJson(req);
      const name = clean(body.name, 200);
      const provider = clean(body.provider, 100) || "Andere";
      const key = clean(body.key, 10_000);
      if (!name || !key) return fail(res, 400, "Bezeichnung und Key sind Pflicht.");
      Object.assign(entry, { name, provider, key: encrypt(key) });
      saveStore();
      return send(res, 200, publicKey(entry));
    }

    if (req.method === "DELETE") {
      store.keys = store.keys.filter((k) => k !== entry);
      saveStore();
      return send(res, 200, { ok: true });
    }
  }

  return fail(res, 404, "Nicht gefunden.");
}

// ---------- Statische Dateien ----------

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
};

http
  .createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, "http://localhost");
      if (pathname.startsWith("/api/")) return await handleApi(req, res, pathname);

      const file = STATIC[pathname];
      if (file && (req.method === "GET" || req.method === "HEAD")) {
        const data = fs.readFileSync(path.join(__dirname, file[0]));
        return send(res, 200, req.method === "HEAD" ? "" : data, { "Content-Type": file[1], "Cache-Control": "no-cache" });
      }
      send(res, 404, "Nicht gefunden.", { "Content-Type": "text/plain; charset=utf-8" });
    } catch (err) {
      if (!err.status) console.error(err);
      if (!res.headersSent) fail(res, err.status || 500, err.status ? err.message : "Interner Serverfehler.");
      else res.end();
    }
  })
  .listen(PORT, () => console.log(`API-Key Manager läuft auf Port ${PORT}`));
