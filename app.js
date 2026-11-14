import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "public-files";
const PAGE_SIZE = 100;
const els = {
  picker: document.querySelector("#fileInput"),
  drop: document.querySelector("#dropzone"),
  status: document.querySelector("#uploadStatus"),
  list: document.querySelector("#fileList"),
  search: document.querySelector("#searchInput"),
  dialog: document.querySelector("#configDialog"),
  projectUrl: document.querySelector("#projectUrl"),
  anonKey: document.querySelector("#anonKey"),
  saveConfig: document.querySelector("#saveConfig"),
};

let supabase;
let allFiles = [];

function readConfig() {
  try { return JSON.parse(localStorage.getItem("filebox-config") || "null"); }
  catch { return null; }
}
function setStatus(message, error = false) {
  els.status.textContent = message;
  els.status.classList.toggle("error", error);
}
function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
  return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`;
}
function fileIcon(mime = "", name = "") {
  if (mime.startsWith("image/")) return "🖼️";
  if (mime.startsWith("video/")) return "🎬";
  if (mime.startsWith("audio/")) return "🎵";
  if (mime.includes("pdf")) return "📕";
  if (/\.zip$|\.7z$|\.rar$/i.test(name)) return "🗜️";
  return "📄";
}
function safeName(name) {
  return name.normalize("NFKC").replace(/[^\p{L}\p{N}._() -]/gu, "_").slice(0, 160) || "file";
}
function renderFiles() {
  const q = els.search.value.trim().toLocaleLowerCase();
  const filtered = allFiles.filter(f => f.name.toLocaleLowerCase().includes(q));
  els.list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = allFiles.length ? "Ничего не найдено." : "Пока нет файлов. Загрузи первый файл выше.";
    els.list.append(empty);
    return;
  }
  for (const file of filtered) {
    const row = document.createElement("article"); row.className = "file-row";
    const icon = document.createElement("div"); icon.className = "file-icon"; icon.textContent = fileIcon(file.mimetype, file.name);
    const info = document.createElement("div"); info.className = "file-info";
    const name = document.createElement("div"); name.className = "file-name"; name.textContent = file.name;
    const meta = document.createElement("div"); meta.className = "file-meta"; meta.textContent = `${humanSize(file.size)} · ${new Date(file.created_at).toLocaleDateString("ru-RU")}`;
    info.append(name, meta);
    const actions = document.createElement("div"); actions.className = "file-actions";
    const download = document.createElement("a"); download.className = "link-button"; download.href = file.publicUrl; download.target = "_blank"; download.rel = "noopener"; download.download = file.name; download.textContent = "Скачать";
    const copy = document.createElement("button"); copy.className = "link-button"; copy.type = "button"; copy.textContent = "Копировать ссылку";
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(file.publicUrl); copy.textContent = "Скопировано!"; }
      catch { window.prompt("Скопируй ссылку:", file.publicUrl); }
      setTimeout(() => copy.textContent = "Копировать ссылку", 1800);
    });
    actions.append(download, copy); row.append(icon, info, actions); els.list.append(row);
  }
}
async function loadFiles() {
  if (!supabase) return;
  els.list.innerHTML = '<div class="empty">Загружаем список файлов…</div>';
  const { data, error } = await supabase.storage.from(BUCKET).list("", {
    limit: PAGE_SIZE, sortBy: { column: "created_at", order: "desc" }
  });
  if (error) {
    els.list.innerHTML = "";
    const msg = document.createElement("div"); msg.className = "empty";
    msg.textContent = `Не удалось получить список: ${error.message}. Проверь настройки Storage и политики доступа.`;
    els.list.append(msg); return;
  }
  allFiles = (data || []).filter(x => x.name && x.name !== ".emptyFolderPlaceholder").map(x => {
    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(x.name);
    return { name: x.name, size: x.metadata?.size || 0, mimetype: x.metadata?.mimetype || "", created_at: x.created_at || x.updated_at || new Date().toISOString(), publicUrl: `${publicData.publicUrl}?download=${encodeURIComponent(x.name)}` };
  });
  renderFiles();
}
async function uploadFiles(fileList) {
  if (!supabase) { setStatus("Сначала подключи Supabase в настройках ниже.", true); return; }
  const files = [...fileList];
  if (!files.length) return;
  for (const file of files) {
    // Supabase free projects commonly impose a 50 MB per-file ceiling unless changed in project settings.
    if (file.size > 50 * 1024 * 1024) {
      setStatus(`Файл «${file.name}» больше 50 МБ. Уменьши его или измени лимит в настройках Supabase.`, true);
      continue;
    }
    setStatus(`Загружаем: ${file.name}…`);
    const key = `${Date.now()}-${crypto.randomUUID()}-${safeName(file.name)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(key, file, {
      cacheControl: "3600", upsert: false, contentType: file.type || "application/octet-stream"
    });
    if (error) { setStatus(`Ошибка загрузки «${file.name}»: ${error.message}`, true); continue; }
    setStatus(`Файл «${file.name}» загружен. Обновляем каталог…`);
  }
  els.picker.value = "";
  await loadFiles();
  if (!els.status.classList.contains("error")) setStatus("Готово! Файлы появились в общей библиотеке.");
}
function connect(config) {
  try {
    const url = new URL(config.url);
    if (!["https:"].includes(url.protocol)) throw new Error("Нужен HTTPS Project URL.");
    if (!config.key || config.key.length < 20) throw new Error("Проверь publishable/anon key.");
    supabase = createClient(config.url, config.key);
    els.dialog.close();
    loadFiles();
  } catch (e) { setStatus(e.message, true); }
}
function showConfig() {
  const config = readConfig();
  if (config) { els.projectUrl.value = config.url; els.anonKey.value = config.key; }
  els.dialog.showModal();
}
els.picker.addEventListener("change", e => uploadFiles(e.target.files));
els.search.addEventListener("input", renderFiles);
["dragenter", "dragover"].forEach(type => els.drop.addEventListener(type, e => { e.preventDefault(); els.drop.classList.add("drag"); }));
["dragleave", "drop"].forEach(type => els.drop.addEventListener(type, e => { e.preventDefault(); els.drop.classList.remove("drag"); }));
els.drop.addEventListener("drop", e => uploadFiles(e.dataTransfer.files));
els.saveConfig.addEventListener("click", e => {
  e.preventDefault();
  const config = { url: els.projectUrl.value.trim().replace(/\/$/, ""), key: els.anonKey.value.trim() };
  try { new URL(config.url); } catch { setStatus("Введи корректный Project URL.", true); return; }
  localStorage.setItem("filebox-config", JSON.stringify(config));
  connect(config);
});
const settingsButton = document.createElement("button");
settingsButton.type = "button"; settingsButton.className = "link-button"; settingsButton.textContent = "Настройки";
settingsButton.addEventListener("click", showConfig);
document.querySelector(".top").append(settingsButton);
const config = readConfig();
if (config) connect(config);
else {
  setStatus("Подключи Supabase, чтобы включить общую загрузку и скачивание.");
  showConfig();
}
