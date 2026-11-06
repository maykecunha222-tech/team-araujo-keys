const control = id => document.getElementById(id);

async function resellerRequest(method, data) {
  return request(method, data, "/api/admin/revenda");
}

async function refreshResellers() {
  const { resellers } = await resellerRequest("GET");
  const list = control("reseller-accounts");
  list.replaceChildren();
  for (const account of resellers) {
    const row = document.createElement("div");
    row.append(document.createTextNode(account.name + (account.active ? " · Ativo " : " · Bloqueado ")));
    for (const [action, label] of [
      [account.active ? "disable" : "enable", account.active ? "Bloquear acesso" : "Liberar acesso"],
      ["rotate", "Novo token"]
    ]) {
      const button = document.createElement("button");
      button.className = "small secondary";
      button.textContent = label;
      button.type = "button";
      button.onclick = async () => {
        if (action === "rotate" && !confirm("O token atual de " + account.name + " será invalidado. Continuar?")) return;
        button.disabled = true;
        try {
          const result = await resellerRequest("PATCH", { resellerId: account.id, action });
          showToken(result);
          await refreshResellers();
        } catch (error) {
          message(error.message);
        } finally {
          button.disabled = false;
        }
      };
      row.append(button);
    }
    list.append(row);
  }
}

function showToken(result) {
  control("reseller-access").hidden = !result.token;
  control("reseller-access").querySelector("code").textContent = result.token || "";
}

control("reseller-management").ontoggle = async event => {
  if (!event.currentTarget.open) return;
  try { await refreshResellers(); } catch (error) { message(error.message); }
};
control("add-reseller").onsubmit = async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = await resellerRequest("POST", { name: control("reseller-name").value });
    showToken(result);
    event.target.reset();
    await refreshResellers();
  } catch (error) {
    message(error.message);
  } finally {
    button.disabled = false;
  }
};
control("copy-reseller-access").onclick = async () => {
  try {
    await navigator.clipboard.writeText(control("reseller-access").querySelector("code").textContent);
    message("Token copiado.");
  } catch {
    message("Selecione o token e copie manualmente.");
  }
};
