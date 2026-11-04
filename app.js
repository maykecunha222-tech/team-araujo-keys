const get = id => document.getElementById(id);
const sights = [
  { id: "general", tab: "Geral", title: "Geral", chance: 55 },
  { id: "dot", tab: "Red Dot", title: "Ponto Vermelho", chance: 45 },
  { id: "2x", tab: "2x", title: "Mira 2x", chance: 35 },
  { id: "4x", tab: "4x", title: "Mira 4x", chance: 42 }
];
const modules = ["Aimbot", "Aim Lock", "Prioridade na Cabeça"];
let prefs;
try { prefs = JSON.parse(localStorage.getItem("zx-iphone-panel") || "{}") || {}; }
catch { prefs = {}; }
let selected = 0, allowed = false, generation = 0, expires = 0, lastCheck = 0, checking = false;
const pending = new Set();
const settings = get("settings");
function save() {
  try { localStorage.setItem("zx-iphone-panel", JSON.stringify(prefs)); }
  catch { }
}
function showLogin(message = "") {
  allowed = false;
  generation++;
  pending.clear();
  settings.hidden = true;
  get("closed").hidden = true;
  get("login").hidden = false;
  get("feedback").textContent = message;
}
function showPanel(expiry) {
  allowed = true;
  expires = expiry;
  lastCheck = Date.now();
  get("login").hidden = true;
  settings.hidden = false;
  get("expiry").textContent = "Key válida até " + new Date(expiry).toLocaleString("pt-BR");
  get("closed").hidden = true;
  draw();
}
async function request(path, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 65000);
  try {
    const response = await fetch("/iphone/" + path, {
      cache: "no-store", signal: controller.signal,
      ...(payload === undefined ? {} : {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(response.status === 401 ? "" : data.error || "Servidor indisponível.");
    return data;
  } finally { clearTimeout(timeout); }
}
function draw() {
  const sight = sights[selected];
  const active = prefs["active-" + sight.id] === true;
  const busy = pending.has(sight.id);
  const value = Number(prefs["sense-" + sight.id]);
  get("sightName").textContent = sight.title;
  get("sensitivity").value = Number.isFinite(value) ? Math.max(0, Math.min(200, value)) : 100;
  get("sensitivityValue").value = get("sensitivity").value;
  get("activate").textContent = busy ? "Ativando…" : active ? "Desativar mira" : "Ativar mira";
  get("activate").disabled = busy;
  get("loading").hidden = !busy;
  get("chance").hidden = !active || busy;
  get("chanceValue").textContent = sight.chance + "%";
  [...get("tabs").children].forEach((button, index) => button.setAttribute("aria-pressed", index === selected));
  [...get("modules").children].forEach((button, index) => {
    const id = "module-" + index;
    button.disabled = pending.has(id);
    button.textContent = modules[index] + (pending.has(id) ? " · Ativando…" : "");
    button.setAttribute("aria-pressed", prefs["active-" + id] === true);
  });
}
function toggle(id) {
  if (!allowed || pending.has(id)) return;
  const storage = "active-" + id;
  if (prefs[storage]) { prefs[storage] = false; save(); draw(); return; }
  const version = generation;
  pending.add(id);
  draw();
  setTimeout(() => {
    if (!allowed || generation !== version) return;
    pending.delete(id);
    prefs[storage] = true;
    save();
    draw();
  }, 2000);
}
for (const [index, sight] of sights.entries()) {
  const button = document.createElement("button");
  button.textContent = sight.tab;
  button.onclick = () => { selected = index; draw(); };
  get("tabs").append(button);
}
modules.forEach((name, index) => {
  const button = document.createElement("button");
  button.textContent = name;
  button.onclick = () => toggle("module-" + index);
  get("modules").append(button);
});
get("sensitivity").oninput = event => {
  prefs["sense-" + sights[selected].id] = Number(event.target.value);
  get("sensitivityValue").value = event.target.value;
  save();
};
get("activate").onclick = () => toggle(sights[selected].id);
get("loginForm").onsubmit = async event => {
  event.preventDefault();
  if (checking) return;
  checking = true;
  const button = get("enter");
  button.disabled = true;
  button.textContent = "Validando…";
  get("feedback").textContent = "";
  try {
    const result = await request("login", { key: get("key").value });
    get("key").value = "";
    showPanel(result.expiresAt);
  } catch (error) {
    showLogin(error.message || "Confira a conexão e tente novamente.");
  } finally { checking = false; button.disabled = false; button.textContent = "Validar e entrar"; }
};
get("closeApp").onclick = () => {
  allowed = false;
  generation++;
  pending.clear();
  settings.hidden = true;
  get("closed").hidden = false;
  get("reopen").focus();
};
get("reopen").onclick = () => recheck(true);
async function recheck(initial = false) {
  if ((!allowed && !initial) || checking) return;
  const version = generation;
  checking = true;
  try {
    const result = await request("session");
    if (version === generation) showPanel(result.expiresAt);
  } catch (error) {
    if (version === generation) showLogin(error.message);
  } finally { checking = false; }
}
setInterval(() => {
  if (!allowed) return;
  if (Date.now() >= expires) showLogin("A key venceu.");
  else if (Date.now() - lastCheck >= 60000) recheck();
}, 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && allowed) recheck();
});
recheck(true);
