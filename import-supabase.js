// Einmaliger Umzug: holt deine Keys aus dem alten Supabase-Projekt und speichert
// sie über die API dieses Servers (dort werden sie verschlüsselt abgelegt).
// Aufruf im Terminal des laufenden Containers:  node import-supabase.js
"use strict";

const readline = require("node:readline");

async function main() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (q) => {
    process.stdout.write(q);
    const { value } = await lines.next();
    return value ?? "";
  };
  const sbUrl = (await ask("Alte Supabase-URL (https://….supabase.co): ")).trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const sbKey = (await ask("Alter Supabase anon-Key (eyJ…): ")).trim();
  const sbEmail = (await ask("Login-E-Mail im alten Manager: ")).trim();
  const sbPassword = await ask("Login-Passwort im alten Manager: ");
  const email = (await ask("Login-E-Mail im NEUEN Manager (leer = gleiche): ")).trim() || sbEmail;
  const password = (await ask("Login-Passwort im NEUEN Manager (leer = gleiches): ")) || sbPassword;
  rl.close();

  // 1. Beim alten Supabase anmelden
  const auth = await fetch(`${sbUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: sbKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: sbEmail, password: sbPassword }),
  });
  const session = await auth.json();
  if (!auth.ok) throw new Error(`Supabase-Login fehlgeschlagen: ${session.error_description || session.msg || auth.status}`);

  // 2. Alte Keys laden
  const res = await fetch(`${sbUrl}/rest/v1/api_keys?select=*&order=created_at.asc`, {
    headers: { apikey: sbKey, Authorization: `Bearer ${session.access_token}` },
  });
  const oldKeys = await res.json();
  if (!res.ok) throw new Error(`Keys laden fehlgeschlagen: ${oldKeys.message || res.status}`);
  console.log(`${oldKeys.length} Keys bei Supabase gefunden.`);

  // 3. Beim neuen Server anmelden
  const base = `http://localhost:${process.env.PORT || 3000}`;
  const login = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) throw new Error(`Login am neuen Server fehlgeschlagen: ${(await login.json()).error}`);
  const cookie = login.headers.get("set-cookie").split(";")[0];

  // 4. Keys übertragen (bereits vorhandene gleiche Einträge werden übersprungen)
  const existing = await (await fetch(`${base}/api/keys`, { headers: { cookie } })).json();
  const seen = new Set(existing.map((k) => `${k.name}\n${k.provider}\n${k.key}`));
  let added = 0;
  for (const k of oldKeys) {
    if (seen.has(`${k.name}\n${k.provider}\n${k.key}`)) continue;
    const r = await fetch(`${base}/api/keys`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: k.name, provider: k.provider, key: k.key }),
    });
    if (!r.ok) throw new Error(`Speichern von "${k.name}" fehlgeschlagen: ${(await r.json()).error}`);
    added++;
  }
  console.log(`FERTIG – ${added} Keys übernommen (${oldKeys.length - added} waren schon da).`);
}

main().catch((err) => {
  console.error("FEHLER:", err.message);
  process.exit(1);
});
