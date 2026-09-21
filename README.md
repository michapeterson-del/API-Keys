# API-Keys Manager

Eine einfache Web-App zum Speichern deiner API-Keys (z. B. für Claude, ChatGPT, Gemini oder beliebige andere Anbieter) – mit Login und Cloud-Sync über [Supabase](https://supabase.com), sodass deine Keys auf jedem Gerät identisch angezeigt werden.

- Bezeichnung, Anbieter und der API-Key selbst
- Keys anlegen, bearbeiten, löschen, ein-/ausblenden und kopieren
- Login per E-Mail/Passwort (Supabase Auth); jeder Nutzer sieht nur seine eigenen Keys (Row Level Security)
- Läuft direkt über GitHub Pages als statische `index.html`

## Supabase-Setup

1. Projekt auf [supabase.com](https://supabase.com) anlegen
2. Im **SQL Editor** folgendes Script ausführen:

```sql
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  name text not null,
  provider text not null,
  key text not null,
  created_at timestamptz default now()
);

alter table api_keys enable row level security;

create policy "Users can manage their own keys"
on api_keys for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

3. Unter **Settings → API** die **Project URL** und den **anon/public** Key kopieren
4. Beide Werte in `index.html` bei `SUPABASE_URL` und `SUPABASE_ANON_KEY` eintragen

## GitHub Pages aktivieren

1. Im Repo zu **Settings → Pages** gehen
2. Unter **Source** die Option **Deploy from a branch** wählen
3. Branch **main** und Ordner **/ (root)** auswählen und speichern
4. Nach kurzer Zeit ist die App unter `https://<dein-user>.github.io/api-keys/` erreichbar

## Hinweis

Der `anon`/`public` Key von Supabase ist dafür gedacht, im Browser sichtbar zu sein – die eigentliche Absicherung erfolgt über Row Level Security (RLS) und den Login. Der **service_role**-Key darf niemals in dieser App verwendet werden.
