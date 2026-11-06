const field = id => document.getElementById(id);
let access = "";
let cursor;

async function loadKeys(next) {
  const query = next ? "?cursor=" + encodeURIComponent(next) : "";
  const response = await fetch("/api/revenda" + query, { headers: { Authorization: "Bearer " + access } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  field("welcome").textContent = data.name;
  if (!next) field("reseller-keys").replaceChildren();
  for (const key of data.keys) {
    const row = document.createElement("li");
    const detail = document.createElement("p");
    detail.textContent = key.status + " · " + new Date(key.expiresAt).toLocaleString("pt-BR");
    const code = document.createElement("code");
    code.textContent = key.key || "Final: " + key.suffix;
    row.append(detail, code);
    if (key.key) {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "Copiar";
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(key.key);
          copy.textContent = "Copiado";
        } catch {
          copy.textContent = "Selecione e copie";
        }
      };
      row.append(copy);
    }
    field("reseller-keys").append(row);
  }
  field("empty-keys").hidden = Boolean(field("reseller-keys").children.length);
  cursor = data.next;
  field("more-keys").hidden = !cursor;
  return data.id;
}

field("reseller-login").onsubmit = async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  access = field("reseller-token").value.trim();
  try {
    const id = await loadKeys();
    field("reseller-token").value = "";
    field("reseller-error").textContent = "";
    field("reseller-login").hidden = true;
    field("reseller-panel").hidden = false;
    document.dispatchEvent(new CustomEvent("reseller-ready", { detail: { access, id } }));
  } catch (error) {
    access = "";
    field("reseller-error").textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

async function refresh(next, button) {
  if (button) button.disabled = true;
  try {
    await loadKeys(next);
    field("reseller-error").textContent = "";
  } catch (error) {
    field("reseller-error").textContent = error.message;
  } finally {
    if (button) button.disabled = false;
  }
}
field("more-keys").onclick = event => refresh(cursor, event.currentTarget);
field("refresh-keys").onclick = event => refresh(null, event.currentTarget);
field("reseller-logout").onclick = () => location.reload();
document.addEventListener("reseller-paid", () => refresh());
