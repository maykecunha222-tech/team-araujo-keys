const byId = id => document.getElementById(id);
let token = "";
let rows = [];
async function request(method = "GET", input) {
  const response = await fetch("/api/admin", { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: input ? JSON.stringify(input) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
  return data;
}
function statusOf(key) { return key.revoked ? "blocked" : new Date(key.expires_at).getTime() <= Date.now() ? "expired" : "active"; }
const names = { active: "Ativa", blocked: "Bloqueada", expired: "Expirada" };
const formatDate = date => new Date(date).toLocaleString("pt-BR");
function el(tag, className, content) { const node = document.createElement(tag); if (className) node.className = className; if (content !== undefined) node.textContent = content; return node; }
function message(value) { byId("message").textContent = value; }
function render() {
  byId("statTotal").textContent = rows.length;
  for (const [id, status] of [["statActive", "active"], ["statBlocked", "blocked"], ["statExpired", "expired"]]) byId(id).textContent = rows.filter(k => statusOf(k) === status).length;
  const term = byId("search").value.trim().toLowerCase();
  const filter = byId("filter").value;
  const filtered = rows.filter(k => (filter === "all" || statusOf(k) === filter) && (k.label.toLowerCase().includes(term) || k.suffix.toLowerCase().includes(term)));
  const list = byId("keys"); list.replaceChildren();
  if (!filtered.length) { list.append(el("div", "empty", "Nenhuma licença encontrada.")); return; }
  for (const key of filtered) {
    const status = statusOf(key);
    const item = el("article", "key-item");
    const head = el("div", "key-head");
    const title = el("div"); title.append(el("div", "key-name", key.label), el("div", "key-meta", "Final da key: •••• " + key.suffix));
    head.append(title, el("span", "pill " + status, names[status]));
    item.append(head, el("div", "key-meta", "Validade: " + formatDate(key.expires_at) + "  •  Criada: " + formatDate(key.created_at)));
    if (key.last_seen) item.append(el("div", "key-meta", "Última validação: " + formatDate(key.last_seen)));
    const actions = el("div", "actions");
    const buttons = [
      ["extend", "+30 dias", false, false],
      [key.revoked ? "unrevoke" : "revoke", key.revoked ? "Desbloquear" : "Bloquear", key.revoked ? false : true, false],
      ["reset", "Desvincular aparelho", false, status !== "active"]
    ];
    for (const [action, label, danger, disabled] of buttons) {
      const button = el("button", "small " + (danger ? "danger" : "secondary"), label);
      button.type = "button"; button.disabled = disabled;
      button.onclick = async () => {
        if (!confirm(label + " a licença '" + key.label + "' (final " + key.suffix + ")?")) return;
        button.disabled = true;
        try { await request("PATCH", { id: key.id, action }); await reload(); message("Operação concluída: " + label + "."); }
        catch (error) { message(error.message); button.disabled = false; }
      };
      actions.append(button);
    }
    item.append(actions); list.append(item);
  }
}
async function reload() { rows = (await request()).keys; render(); }
byId("loginForm").onsubmit = async event => { event.preventDefault(); token = byId("token").value.trim(); try { await reload(); byId("token").value = ""; byId("login").hidden = true; byId("panel").hidden = false; byId("logout").hidden = false; message(""); } catch (error) { token = ""; message(error.message); } };
byId("generate").onsubmit = async event => { event.preventDefault(); const button = event.submitter; button.disabled = true; try { const result = await request("POST", { label: byId("label").value, hours: Number(byId("hours").value) }); byId("newKey").querySelector("code").textContent = result.key; byId("newKey").hidden = false; await reload(); message("Key gerada. Copie e guarde a chave agora."); } catch (error) { message(error.message); } finally { button.disabled = false; } };
byId("copy").onclick = async () => { try { await navigator.clipboard.writeText(byId("newKey").querySelector("code").textContent); message("Key copiada."); } catch { message("Selecione a key e copie manualmente."); } };
byId("logout").onclick = () => location.reload();
byId("refresh").onclick = async () => { try { await reload(); message("Lista atualizada."); } catch (error) { message(error.message); } };
byId("search").oninput = render; byId("filter").onchange = render;
