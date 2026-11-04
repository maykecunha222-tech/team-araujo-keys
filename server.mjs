import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createIphoneHandler } from "./iphone.mjs";

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const keyFormat = /^(?:ZX|TA)-(?:[A-F\d]{8}-){3}[A-F\d]{8}$/;
const hash = value => createHash("sha256").update(value).digest("hex");
const publicFields = "id,suffix,label,created_at,expires_at,revoked,last_seen,key_encrypted,price_cents,is_reseller";
function encryptKey(key, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(hash(secret), "hex"), iv);
  const ciphertext = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}
function decryptKey(value, secret) {
  if (!value) return null;
  const bytes = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(hash(secret), "hex"), bytes.subarray(0,12));
  decipher.setAuthTag(bytes.subarray(12,28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}

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

export function makeServer({ supabaseUrl, secretKey, adminToken, encryptionSecret, fetchDb = fetch }) {
  if (new URL(supabaseUrl).protocol !== "https:" || !secretKey || !adminToken || !encryptionSecret || encryptionSecret.length < 32) {
    throw new Error("Configure SUPABASE_URL, SUPABASE_SECRET_KEY e ADMIN_TOKEN e KEY_ENCRYPTION_SECRET (mínimo 32 caracteres).");
  }
  const adminHash = Buffer.from(hash(adminToken), "hex");
  async function db(path, method = "GET", value) {
    const headers = { apikey: secretKey, "Content-Type": "application/json", Prefer: "return=representation" };
    if (!secretKey.startsWith("sb_secret_")) headers.Authorization = "Bearer " + secretKey;
    const result = await fetchDb(new URL("/rest/v1/" + path, supabaseUrl), {
      method, headers, signal: AbortSignal.timeout(8000), body: value === undefined ? undefined : JSON.stringify(value)
    });
    if (!result.ok) {
  const details = await result.text();
  console.error("Supabase HTTP", result.status, details);
  throw new Error("Supabase HTTP " + result.status);
}
    return result.status === 204 ? [] : result.json();
  }

  const iphone = createIphoneHandler({ db, body, adminToken });
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
      if (await iphone(req, res, path)) return;
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
          const keys = await db("team_araujo_app_licenses?select=" + publicFields + "&order=created_at.desc&limit=500");
          const salesTotalCents = await db("rpc/team_araujo_license_sales_total", "POST", {});
          return send(200, { salesTotalCents, keys: keys.map(({ key_encrypted, ...row }) => ({ ...row, recoverable: Boolean(key_encrypted) })) });
        }
        if (req.method === "POST") {
          const input = await body(req);
          if (![1, 24, 168, 336, 720].includes(input?.hours) || typeof input?.label !== "string" || input.label.length > 80) {
            return send(400, { error: "Confira a identificação e a validade." });
          }
          const isReseller = input.isReseller ?? false;
          if (typeof isReseller !== "boolean" || (isReseller && ![336, 720].includes(input.hours))) {
            return send(400, { error: "Plano de revenda inválido." });
          }
          const prices = isReseller ? { 336: 4000, 720: 7000 } : { 336: 6000, 720: 10000 };
          const key = "ZX-" + randomBytes(16).toString("hex").toUpperCase().match(/.{8}/g).join("-");
          const rows = await db("team_araujo_app_licenses?select=" + publicFields, "POST", {
            key_hash: hash(key), key_encrypted: encryptKey(key, encryptionSecret), suffix: key.slice(-8), label: input.label.trim() || "Sem identificação",
            is_reseller: isReseller,
            price_cents: prices[input.hours] ?? null,
            expires_at: new Date(Date.now() + input.hours * 3600000).toISOString()
          });
          return send(201, { key, id: rows[0].id });
        }
        if (req.method === "PUT") {
          const input = await body(req);
          if (!uuid.test(input?.id || "")) return send(400, { error: "ID inválido." });
          const found = await db("team_araujo_app_licenses?select=key_encrypted&id=eq." + input.id + "&limit=1");
          if (!found.length) return send(404, { error: "Key não encontrada." });
          if (!found[0].key_encrypted) return send(409, { error: "Key antiga: somente o hash foi armazenado. Não é possível recuperar o texto original." });
          return send(200, { key: decryptKey(found[0].key_encrypted, encryptionSecret) });
        }
        if (req.method === "DELETE") {
          const input = await body(req);
          if (!uuid.test(input?.id || "")) return send(400, { error: "ID inválido." });
          const deleted = await db("team_araujo_app_licenses?id=eq." + input.id + "&select=id", "DELETE");
          return deleted.length ? send(200, { ok: true }) : send(404, { error: "Key não encontrada." });
        }
        if (req.method === "PATCH") {
          const input = await body(req);
          if (typeof input?.id !== "string" || !uuid.test(input.id) || !["revoke", "unrevoke", "reset", "extend"].includes(input.action)) {
            return send(400, { error: "Ação inválida." });
          }
          if (input.action === "extend") {
            // Atomic extension in the database avoids overwriting concurrent changes.
            const days = input.days === undefined ? 30 : input.days;
            if (![7, 14, 30].includes(days)) return send(400, { error: "Prazo inválido." });
            const result = await db("rpc/team_araujo_extend_license", "POST", { p_id: input.id, p_days: days });
            return result === true || result?.[0]?.team_araujo_extend_license === true
              ? send(200, { ok: true }) : send(404, { error: "Key não encontrada." });
          }
          const filter = input.action === "reset" ? "&revoked=eq.false&expires_at=gt.now" : "";
          const patch = input.action === "revoke" ? { revoked: true } : input.action === "unrevoke" ? { revoked: false } : { device: null };
          const rows = await db("team_araujo_app_licenses?select=id&id=eq." + input.id + filter, "PATCH", patch);
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
    adminToken: process.env.ADMIN_TOKEN,
    encryptionSecret: process.env.KEY_ENCRYPTION_SECRET
  });
  server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () => console.log("Zentrix Keys online"));
}

