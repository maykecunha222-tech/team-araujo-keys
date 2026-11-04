import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const keyFormat = /^(?:ZX|TA)-(?:[A-F\d]{8}-){3}[A-F\d]{8}$/;
const hash = value => createHash("sha256").update(value).digest("hex");
const publicFields = "id,suffix,label,created_at,expires_at,revoked,last_seen";

async function body(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > 4096) {
      req.resume();
      throw Object.assign(new Error("Pedido muito grande."), { status: 413 });
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks)); }
  catch { throw Object.assign(new Error("Pedido inválido."), { status: 400 }); }
}

export function makeServer({ supabaseUrl, secretKey, adminToken, fetchDb = fetch }) {
  if (new URL(supabaseUrl).protocol !== "https:" || !secretKey || !adminToken || adminToken.length < 32) {
    throw new Error("Configure SUPABASE_URL, SUPABASE_SECRET_KEY e ADMIN_TOKEN (mínimo 32 caracteres).");
  }
  const adminHash = Buffer.from(hash(adminToken), "hex");
  async function db(path, method = "GET", value) {
    const headers = { apikey: secretKey, "Content-Type": "application/json", Prefer: "return=representation" };
    if (!secretKey.startsWith("sb_secret_")) headers.Authorization = "Bearer " + secretKey;
    const result = await fetchDb(new URL("/rest/v1/" + path, supabaseUrl), {
      method, headers, signal: AbortSignal.timeout(8000), body: value === undefined ? undefined : JSON.stringify(value)
    });
    if (!result.ok) throw new Error("Supabase HTTP " + result.status);
    return result.status === 204 ? [] : result.json();
  }

  return createServer(async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      res.end(JSON.stringify(value));
    };
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (req.method === "GET" && path === "/health") return send(200, { ok: true });
      if (req.method === "GET" && ["/", "/admin.js"].includes(path)) {
        const script = path === "/admin.js";
        const content = await readFile(new URL(script ? "./admin.js" : "./admin.html", import.meta.url));
        res.writeHead(200, {
          "Content-Type": script ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8",
          "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
        });
        return res.end(content);
      }
      if (path === "/api/validate" && req.method === "POST") {
        const input = await body(req);
        const key = typeof input?.key === "string" ? input.key.trim().toUpperCase() : "";
        if (!keyFormat.test(key) || typeof input?.device !== "string" || !uuid.test(input.device)) {
          return send(400, { valid: false, error: "Confira a key." });
        }
        const rows = await db("rpc/team_araujo_app_validate", "POST", { p_hash: hash(key), p_device: input.device });
        const expiresAt = Date.parse(rows[0]?.expires_at);
        const serverTime = Date.now();
        if (!(expiresAt > serverTime)) {
          return send(403, { valid: false, error: "Key inválida, expirada, bloqueada ou vinculada a outro aparelho." });
        }
        return send(200, { valid: true, expiresAt, serverTime });
      }
      if (path === "/api/admin") {
        const authorization = req.headers.authorization || "";
        const provided = Buffer.from(hash(authorization.replace(/^Bearer /, "")), "hex");
        if (!authorization.startsWith("Bearer ") || !timingSafeEqual(provided, adminHash)) {
          return send(403, { error: "Acesso exclusivo do administrador." });
        }
        if (req.method === "GET") {
          return send(200, { keys: await db("team_araujo_app_licenses?select=" + publicFields + "&order=created_at.desc&limit=500") });
        }
        if (req.method === "POST") {
          const input = await body(req);
          if (![1, 24, 168, 720].includes(input?.hours) || typeof input?.label !== "string" || input.label.length > 80) {
            return send(400, { error: "Confira a identificação e a validade." });
          }
          const key = "ZX-" + randomBytes(16).toString("hex").toUpperCase().match(/.{8}/g).join("-");
          const rows = await db("team_araujo_app_licenses?select=" + publicFields, "POST", {
            key_hash: hash(key), suffix: key.slice(-8), label: input.label.trim() || "Sem identificação",
            expires_at: new Date(Date.now() + input.hours * 3600000).toISOString()
          });
          return send(201, { key, id: rows[0].id });
        }
        if (req.method === "PATCH") {
          const input = await body(req);
          if (typeof input?.id !== "string" || !uuid.test(input.id) || !["revoke", "reset"].includes(input.action)) {
            return send(400, { error: "Ação inválida." });
          }
          const filter = input.action === "reset" ? "&revoked=eq.false&expires_at=gt.now" : "";
          const rows = await db("team_araujo_app_licenses?select=id&id=eq." + input.id + filter, "PATCH",
            input.action === "revoke" ? { revoked: true } : { device: null });
          return rows.length ? send(200, { ok: true }) : send(404, { error: "Key não encontrada ou encerrada." });
        }
      }
      return send(404, { error: "Rota não encontrada." });
    } catch (error) {
      if (!error.status) console.error(error.name, error.message);
      return send(error.status || 503, { error: error.status ? error.message : "Servidor indisponível. Tente novamente." });
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const server = makeServer({
    supabaseUrl: process.env.SUPABASE_URL,
    secretKey: process.env.SUPABASE_SECRET_KEY,
    adminToken: process.env.ADMIN_TOKEN
  });
  server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () => console.log("Zentrix Keys online"));
}
