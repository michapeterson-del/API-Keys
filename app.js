"use strict";
  // Spricht mit dem eigenen Server (server.js)
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && url !== "/api/login") showLoggedOut();
    if (!res.ok) throw new Error(data.error || "Fehler " + res.status);
    return data;
  }

  let editingId = null;
  let currentKeys = [];
  const revealedIds = new Set();

  const authView = document.getElementById("auth-view");
  const appView = document.getElementById("app-view");
  const authForm = document.getElementById("auth-form");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const authSubmit = document.getElementById("auth-submit");
  const authError = document.getElementById("auth-error");
  const userEmail = document.getElementById("user-email");
  const logoutBtn = document.getElementById("logout-btn");
  const pwChangeToggle = document.getElementById("pw-change-toggle");
  const pwChangeCard = document.getElementById("pw-change-card");
  const pwChangeForm = document.getElementById("pw-change-form");
  const newPasswordInput = document.getElementById("new-password");
  const pwChangeSubmit = document.getElementById("pw-change-submit");

  const form = document.getElementById("key-form");
  const nameInput = document.getElementById("name");
  const providerSelect = document.getElementById("provider");
  const providerCustom = document.getElementById("provider-custom");
  const keyInput = document.getElementById("key");
  const toggleNewKeyBtn = document.getElementById("toggle-new-key");
  const submitBtn = document.getElementById("submit-btn");
  const list = document.getElementById("list");
  const toast = document.getElementById("toast");

  function showToast(msg, isError) {
    toast.textContent = msg;
    toast.classList.toggle("error", !!isError);
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function maskKey(key) {
    if (key.length <= 8) return "•".repeat(key.length);
    return key.slice(0, 4) + "•".repeat(Math.min(key.length - 8, 20)) + key.slice(-4);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Auth ----

  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    authError.style.display = "none";
    authSubmit.disabled = true;
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    try {
      // Registrierung ist absichtlich nicht mehr möglich (nur bestehende Konten).
      const data = await api("POST", "/api/login", { email, password });
      showLoggedIn(data.email);
    } catch (err) {
      authError.textContent = err.message || "Anmeldung fehlgeschlagen";
      authError.style.display = "block";
    } finally {
      authSubmit.disabled = false;
    }
  });

  logoutBtn.addEventListener("click", async () => {
    await api("POST", "/api/logout").catch(() => {});
    showLoggedOut();
  });

  pwChangeToggle.addEventListener("click", () => {
    pwChangeCard.classList.toggle("hidden");
    if (!pwChangeCard.classList.contains("hidden")) newPasswordInput.focus();
  });

  pwChangeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const newPassword = newPasswordInput.value;
    pwChangeSubmit.disabled = true;
    try {
      await api("POST", "/api/password", { password: newPassword });
      showToast("Passwort geändert");
      pwChangeForm.reset();
      pwChangeCard.classList.add("hidden");
    } catch (err) {
      showToast(err.message || "Passwort ändern fehlgeschlagen", true);
    } finally {
      pwChangeSubmit.disabled = false;
    }
  });

  function showLoggedIn(email) {
    authView.classList.add("hidden");
    appView.classList.remove("hidden");
    userEmail.textContent = email;
    authForm.reset();
    loadKeys();
  }

  function showLoggedOut() {
    appView.classList.add("hidden");
    authView.classList.remove("hidden");
    currentKeys = [];
    list.innerHTML = "";
  }

  // Beim Laden prüfen, ob noch eine Sitzung besteht
  api("GET", "/api/me").then((d) => showLoggedIn(d.email)).catch(() => showLoggedOut());

  // ---- Keys CRUD ----

  providerSelect.addEventListener("change", () => {
    providerCustom.style.display = providerSelect.value === "Custom" ? "block" : "none";
  });

  toggleNewKeyBtn.addEventListener("click", () => {
    const isPw = keyInput.type === "password";
    keyInput.type = isPw ? "text" : "password";
    toggleNewKeyBtn.textContent = isPw ? "Verbergen" : "Anzeigen";
  });

  function resetForm() {
    form.reset();
    providerCustom.style.display = "none";
    keyInput.type = "password";
    toggleNewKeyBtn.textContent = "Anzeigen";
    editingId = null;
    submitBtn.textContent = "Key speichern";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const provider = providerSelect.value === "Custom"
      ? (providerCustom.value.trim() || "Andere")
      : providerSelect.value;
    const key = keyInput.value.trim();
    if (!name || !key) return;

    submitBtn.disabled = true;
    try {
      if (editingId) {
        await api("PUT", "/api/keys/" + editingId, { name, provider, key });
        showToast("Key aktualisiert");
      } else {
        await api("POST", "/api/keys", { name, provider, key });
        showToast("Key gespeichert");
      }
      resetForm();
      await loadKeys();
    } catch (err) {
      showToast(err.message || "Speichern fehlgeschlagen", true);
    } finally {
      submitBtn.disabled = false;
    }
  });

  function startEdit(id) {
    const k = currentKeys.find(k => k.id === id);
    if (!k) return;
    nameInput.value = k.name;
    keyInput.value = k.key;
    const known = ["Claude", "ChatGPT", "Gemini"];
    if (known.includes(k.provider)) {
      providerSelect.value = k.provider;
      providerCustom.style.display = "none";
    } else {
      providerSelect.value = "Custom";
      providerCustom.style.display = "block";
      providerCustom.value = k.provider;
    }
    editingId = id;
    submitBtn.textContent = "Änderungen speichern";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteKey(id) {
    if (!confirm("Diesen API-Key wirklich löschen?")) return;
    try {
      await api("DELETE", "/api/keys/" + id);
      if (editingId === id) resetForm();
      await loadKeys();
    } catch (err) {
      showToast(err.message || "Löschen fehlgeschlagen", true);
    }
  }

  function toggleReveal(id) {
    if (revealedIds.has(id)) revealedIds.delete(id);
    else revealedIds.add(id);
    render();
  }

  function copyKey(id) {
    const k = currentKeys.find(k => k.id === id);
    if (!k) return;
    navigator.clipboard.writeText(k.key).then(() => showToast("Key kopiert"));
  }

  async function loadKeys() {
    try {
      currentKeys = await api("GET", "/api/keys");
    } catch (err) {
      showToast(err.message || "Laden fehlgeschlagen", true);
      return;
    }
    render();
  }

  function render() {
    list.innerHTML = "";

    if (currentKeys.length === 0) {
      list.innerHTML = '<div class="empty">Noch keine API-Keys gespeichert</div>';
      return;
    }

    currentKeys.forEach(k => {
      const revealed = revealedIds.has(k.id);
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `
        <div class="item-top">
          <div>
            <div class="item-name">${escapeHtml(k.name)}</div>
            <span class="badge">${escapeHtml(k.provider)}</span>
          </div>
          <div class="item-actions">
            <button data-action="reveal">${revealed ? "Verbergen" : "Anzeigen"}</button>
            <button data-action="copy">Kopieren</button>
            <button data-action="edit">Bearbeiten</button>
            <button data-action="delete" class="danger">Löschen</button>
          </div>
        </div>
        <div class="key-display">${revealed ? escapeHtml(k.key) : maskKey(k.key)}</div>
      `;
      item.querySelector('[data-action="reveal"]').addEventListener("click", () => toggleReveal(k.id));
      item.querySelector('[data-action="copy"]').addEventListener("click", () => copyKey(k.id));
      item.querySelector('[data-action="edit"]').addEventListener("click", () => startEdit(k.id));
      item.querySelector('[data-action="delete"]').addEventListener("click", () => deleteKey(k.id));
      list.appendChild(item);
    });
  }
