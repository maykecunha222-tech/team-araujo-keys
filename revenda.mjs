import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const licenses = "team_araujo_app_licenses";
const accounts = "zentrix_resellers";
const accountFields = "id,name,active";
const assets = new Map([
  ["/revendedores", ["revenda.html", "text/html"]],
  ["/revenda.js", ["revenda.js", "text/javascript"]]
]);

export async function findReseller(db, hash, token) {
  if (!/^RV-[a-f0-9]{64}$/.test(token || "")) return null;
  const [reseller] = await db(accounts + "?select=id,name&active=eq.true&token_hash=eq." + hash(token));
  return reseller;
}

export function createResellerPanel({ db, body, hash, decryptKey, isAdmin }) {
  return async (req, res, path, send) => {
    if (req.method === "GET" && assets.has(path)) {
      const [file, type] = assets.get(path);
      const content = await readFile(new URL(file, import.meta.url));
      res.writeHead(200, {
        "Content-Type": type + "; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src data: blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
      });
      res.end(content);
      return true;
    }
    if (path !== "/api/revenda" && path !== "/api/admin/revenda") return false;

    if (path === "/api/admin/revenda") {
      if (!isAdmin(req)) {
        send(403, { error: "Acesso exclusivo do administrador." });
        return true;
      }
      if (req.method === "GET") {
        const resellers = await db(accounts + "?select=" + accountFields + "&order=name.asc,id.asc");
        send(200, { resellers });
        return true;
      }
      if (req.method === "POST") {
        const input = await body(req);
        const name = typeof input?.name === "string" ? input.name.trim() : "";
        if (!name || name.length > 80) {
          send(400, { error: "Informe um nome de até 80 caracteres." });
          return true;
        }
        const token = "RV-" + randomBytes(32).toString("hex");
        const [reseller] = await db(accounts + "?select=" + accountFields, "POST", { name, token_hash: hash(token) });
        send(201, { reseller, token });
        return true;
      }
      if (req.method === "PATCH") {
        const input = await body(req);
        if (!uuid.test(input?.resellerId || "") || !["enable", "disable", "rotate"].includes(input?.action)) {
          send(400, { error: "Confira a conta e a ação." });
          return true;
        }
        const token = input.action === "rotate" ? "RV-" + randomBytes(32).toString("hex") : undefined;
        const update = token ? { token_hash: hash(token) } : { active: input.action === "enable" };
        const [reseller] = await db(accounts + "?select=" + accountFields + "&id=eq." + input.resellerId, "PATCH", update);
        send(reseller ? 200 : 404, reseller ? { reseller, token } : { error: "Revendedor não encontrado." });
        return true;
      }
    } else if (req.method === "GET") {
      const token = (req.headers.authorization || "").replace(/^Bearer /, "");
      const reseller = await findReseller(db, hash, token);
      if (!reseller) {
        send(403, { error: "Token inválido ou acesso bloqueado." });
        return true;
      }
      const cursor = new URL(req.url, "http://localhost").searchParams.get("cursor");
      if (cursor && !uuid.test(cursor)) {
        send(400, { error: "Página inválida." });
        return true;
      }
      const rows = await db(licenses + "?select=id,suffix,expires_at,revoked,key_encrypted" +
        "&is_reseller=eq.true&reseller_id=eq." + reseller.id + "&order=id.asc&limit=51" +
        (cursor ? "&id=gt." + cursor : ""));
      const page = rows.slice(0, 50);
      const keys = page.map(({ id, suffix, expires_at, revoked, key_encrypted }) => {
        const status = revoked ? "Bloqueada" : Date.parse(expires_at) <= Date.now() ? "Expirada" : "Ativa";
        return { id, suffix, expiresAt: expires_at, status, key: status === "Ativa" ? decryptKey(key_encrypted) : null };
      });
      send(200, { id: reseller.id, name: reseller.name, keys, next: rows.length > 50 ? page.at(-1).id : null });
      return true;
    }
    send(405, { error: "Método não permitido." });
    return true;
  };
}
