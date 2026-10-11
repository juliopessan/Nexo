// Persistência entre reinstalações. O Chrome apaga TODO o storage de uma extensão removida,
// então mantemos duas cópias fora dela: um arquivo em Downloads/Nexo e o cofre no servidor (se logado).
const NexoPersist = (() => {
  // Configurações pessoais que valem a pena restaurar (sessão e estado de sync ficam de fora)
  const VAULT_FIELDS = ["anthropicKey", "model", "tone", "aboutMe", "goals", "me", "exaKey", "bridgeToken", "serverUrl"];
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined && o[k] !== null && o[k] !== "").map((k) => [k, o[k]]));

  // ---- Arquivo de backup (sobrescreve sempre o mesmo arquivo) ----
  async function writeBackupFile() {
    const all = await chrome.storage.local.get(null);
    // Instalação nova ainda não restaurada: NÃO sobrescrever o backup bom com dados vazios
    if (all.settings?.freshInstall) return false;
    delete all.pendingInsert;
    if (all.settings) all.settings = { ...all.settings, session: undefined };
    const json = JSON.stringify({ nexoBackup: 1, at: new Date().toISOString(), version: chrome.runtime.getManifest().version, data: all });
    const url = "data:application/json;base64," + btoa(unescape(encodeURIComponent(json)));
    const id = await chrome.downloads.download({ url, filename: "Nexo/nexo-backup.json", conflictAction: "overwrite", saveAs: false });
    // tira da lista de downloads (o arquivo continua no disco)
    const done = (d) => { if (d.id === id && d.state?.current === "complete") { chrome.downloads.erase({ id }); chrome.downloads.onChanged.removeListener(done); } };
    chrome.downloads.onChanged.addListener(done);
    await NexoStore.saveSettings({ lastFileBackupAt: Date.now() });
    return true;
  }

  // ---- Cofre no servidor ----
  async function pushVault() {
    const s = await NexoStore.getSettings();
    if (!s.serverUrl || !s.session?.token) return;
    const data = pick(s, VAULT_FIELDS);
    await fetch(`${s.serverUrl}/me/vault`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${s.session.token}` },
      body: JSON.stringify({ data, updated_at: s.vaultUpdatedAt || Date.now() })
    });
  }

  // Após login: se o cofre do servidor é mais novo, ou o local está vazio, restaura
  async function pullVault() {
    const s = await NexoStore.getSettings();
    if (!s.serverUrl || !s.session?.token) return false;
    const res = await fetch(`${s.serverUrl}/me/vault`, { headers: { authorization: `Bearer ${s.session.token}` } });
    if (!res.ok) return false;
    const { data, updated_at } = await res.json();
    if (!data) { await pushVault(); return false; }
    const localEmpty = !Object.keys(pick(s, VAULT_FIELDS.filter((k) => k !== "serverUrl"))).length;
    if (!localEmpty && (s.vaultUpdatedAt || 0) >= updated_at) return false;
    await NexoStore.saveSettings({ ...data, serverUrl: s.serverUrl, vaultUpdatedAt: updated_at, freshInstall: false, restoredFrom: "servidor" });
    return true;
  }

  // Marca mudanças relevantes e agenda as cópias (com folga para não gravar a cada tecla)
  let fileTimer, vaultTimer;
  function onStorageChanged(ch) {
    const s = ch.settings;
    const settingsChanged = s && VAULT_FIELDS.some((k) => JSON.stringify(s.oldValue?.[k]) !== JSON.stringify(s.newValue?.[k]));
    if (settingsChanged) {
      NexoStore.saveSettings({ vaultUpdatedAt: Date.now() });
      clearTimeout(vaultTimer);
      vaultTimer = setTimeout(() => pushVault().catch(() => {}), 5000);
    }
    if (settingsChanged || ch.contacts || ch.templates) {
      clearTimeout(fileTimer);
      fileTimer = setTimeout(async () => {
        const { lastFileBackupAt = 0 } = await NexoStore.getSettings();
        if (Date.now() - lastFileBackupAt > 5 * 60_000 || settingsChanged) writeBackupFile().catch(() => {});
      }, 15_000);
    }
  }

  return { writeBackupFile, pushVault, pullVault, onStorageChanged, VAULT_FIELDS };
})();
