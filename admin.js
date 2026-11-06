const byId = id => document.getElementById(id);
let token = "";
let rows = [];
const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
async function request(method = "GET", input, endpoint = "/api/admin") {
  const response = await fetch(endpoint, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: input ? JSON.stringify(input) : undefined });
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
  const filtered = rows.filter(k => (filter === "all" || statusOf(k) === filter) && (k.label.toLowerCase().includes(term) || k.suffix.toLowerCase().includes(term) || (k.reseller_name || "").toLowerCase().includes(term)));
  const list = byId("keys"); list.replaceChildren();
  if (!filtered.length) { list.append(el("div", "empty", "Nenhuma licença encontrada.")); return; }
  for (const key of filtered) {
    const status = statusOf(key);
    const item = el("article", "key-item");
    const head = el("div", "key-head");
    const title = el("div"); title.append(el("div", "key-name", key.label), el("div", "key-meta", "Final da key: •••• " + key.suffix));
    if (key.is_reseller) {
      title.append(el("div", "key-meta", key.reseller_name ? "Revendedor: " + key.reseller_name : "Sem conta de revendedor vinculada"));
    }
    const badges = el("div");
    if (key.is_reseller) badges.append(el("span", "pill expired", "Revenda"), document.createTextNode(" "));
    badges.append(el("span", "pill " + status, names[status]));
    head.append(title, badges);
    const details = el("div", "key-details");
    const expiry = el("div", "key-detail");
    const expiresAt = new Date(key.expires_at);
    expiry.append(el("span", "", status === "expired" ? "Expirou em" : "Expira em"),
      el("strong", "", expiresAt.toLocaleDateString("pt-BR")),
      el("small", "", expiresAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })));
    details.append(expiry);
    if (key.price_cents != null) {
      const sale = el("div", "key-detail key-detail-sale");
      sale.append(el("span", "", "Valor da venda"), el("strong", "", reais.format(key.price_cents / 100)));
      details.append(sale);
    }
    item.append(head, details, el("div", "key-meta",
      (key.price_cents == null ? "Criada: " : "Venda registrada em: ") + formatDate(key.created_at)));
    if (key.last_seen) item.append(el("div", "key-meta", "Última validação: " + formatDate(key.last_seen)));
    const actions = el("div", "actions");
    const reveal = el("button", "small secondary", "Mostrar key");
    reveal.type = "button";
    reveal.disabled = !key.recoverable;
    reveal.title = key.recoverable ? "Consultar chave completa" : "Key antiga: o banco só possui seu hash";
    reveal.onclick = async () => {
      reveal.disabled = true;
      try {
        const data = await request("PUT", { id: key.id });
        const code = el("code", "full-key", data.key);
        const copy = el("button", "small secondary", "Copiar");
        copy.type = "button";
        copy.onclick = async () => { await navigator.clipboard.writeText(data.key); message("Key copiada."); };
        const detail = el("div", "revealed-key"); detail.append(code, copy);
        const old = item.querySelector(".revealed-key"); if (old) old.remove();
        item.insertBefore(detail, actions);
      } catch (error) { message(error.message); }
      finally { reveal.disabled = false; }
    };
    actions.append(reveal);
    const remove = el("button", "small danger", "Apagar key");
    remove.type = "button";
    remove.onclick = async () => {
      if (!confirm("APAGAR DEFINITIVAMENTE a licença '" + key.label + "' (final " + key.suffix + ")? Ela deixará de funcionar.")) return;
      remove.disabled = true;
      try { await request("DELETE", { id: key.id }); await reload(); message("Key apagada definitivamente."); }
      catch (error) { message(error.message); remove.disabled = false; }
    };
    actions.append(remove);
    const buttons = [
      ["extend", "+30 dias", false, false, 30],
        ["extend", "+14 dias", false, false, 14],
        ["extend", "+7 dias", false, false, 7],
      [key.revoked ? "unrevoke" : "revoke", key.revoked ? "Desbloquear" : "Bloquear", key.revoked ? false : true, false],
      ["reset", "Desvincular aparelho", false, status !== "active"]
    ];
    for (const [action, label, danger, disabled, days] of buttons) {
      const button = el("button", "small " + (danger ? "danger" : "secondary"), label);
      button.type = "button"; button.disabled = disabled;
      button.onclick = async () => {
        if (!confirm(label + " a licença '" + key.label + "' (final " + key.suffix + ")?")) return;
        button.disabled = true;
        try { await request("PATCH", { id: key.id, action, days }); await reload(); message("Operação concluída: " + label + "."); }
        catch (error) { message(error.message); button.disabled = false; }
      };
      actions.append(button);
    }
    item.append(actions); list.append(item);
  }
}
async function reload() {
  const data = await request();
  rows = data.keys;
  byId("statSales").textContent = reais.format(data.salesTotalCents / 100);
  render();
}
byId("loginForm").onsubmit = async event => { event.preventDefault(); token = byId("token").value.trim(); try { await reload(); byId("token").value = ""; byId("login").hidden = true; byId("panel").hidden = false; byId("logout").hidden = false; message(""); } catch (error) { token = ""; message(error.message); } };
for (const [formId, labelId, hoursId, isReseller] of [
  ["generate", "label", "hours", false],
  ["generateReseller", "resellerLabel", "resellerHours", true]
]) {
  byId(formId).onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const result = await request("POST", {
        label: byId(labelId).value,
        hours: Number(byId(hoursId).value),
        isReseller
      });
      byId("newKey").querySelector("code").textContent = result.key;
      byId("newKey").hidden = false;
      await reload();
      message("Key gerada. Você poderá consultá-la novamente em Mostrar key.");
    } catch (error) {
      message(error.message);
    } finally {
      button.disabled = false;
    }
  };
}
byId("copy").onclick = async () => { try { await navigator.clipboard.writeText(byId("newKey").querySelector("code").textContent); message("Key copiada."); } catch { message("Selecione a key e copie manualmente."); } };
byId("logout").onclick = () => location.reload();
byId("refresh").onclick = async () => { try { await reload(); message("Lista atualizada."); } catch (error) { message(error.message); } };
byId("search").oninput = render; byId("filter").onchange = render;
