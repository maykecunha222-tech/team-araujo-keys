const byId = id => document.getElementById(id);
let token = "";
async function request(method = "GET", input) {
  const response = await fetch("/api/admin", {
    method,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: input ? JSON.stringify(input) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
function render(rows) {
  const list = byId("keys");
  list.replaceChildren();
  for (const key of rows) {
    const item = document.createElement("li");
    const expiry = new Date(key.expires_at);
    const status = key.revoked ? "Bloqueada" : expiry <= new Date() ? "Expirada" : "Ativa";
    item.textContent = key.label + " · final " + key.suffix + " · " + status + " · " + expiry.toLocaleString("pt-BR");
    for (const [action, caption] of [["revoke", "Bloquear"], ["reset", "Desvincular aparelho"]]) {
      const button = document.createElement("button");
      button.textContent = caption;
      button.disabled = status !== "Ativa";
      button.onclick = async () => {
        if (!confirm(caption + " para esta key?")) return;
        try { await request("PATCH", { id: key.id, action }); render((await request()).keys); }
        catch (error) { byId("message").textContent = error.message; }
      };
      item.append(button);
    }
    list.append(item);
  }
}
byId("loginForm").onsubmit = async event => {
  event.preventDefault();
  token = byId("token").value.trim();
  try {
    render((await request()).keys);
    byId("token").value = "";
    byId("login").hidden = true;
    byId("panel").hidden = false;
    byId("message").textContent = "";
  } catch (error) { token = ""; byId("message").textContent = error.message; }
};
byId("generate").onsubmit = async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = await request("POST", { label: byId("label").value, hours: Number(byId("hours").value) });
    byId("newKey").querySelector("code").textContent = result.key;
    byId("newKey").hidden = false;
    byId("message").textContent = "Copie a key agora. A lista mostra apenas o final.";
    render((await request()).keys);
  } catch (error) { byId("message").textContent = error.message; }
  finally { button.disabled = false; }
};
byId("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(byId("newKey").querySelector("code").textContent);
    byId("message").textContent = "Key copiada.";
  } catch { byId("message").textContent = "Selecione a key e copie manualmente."; }
};
byId("logout").onclick = () => location.reload();
