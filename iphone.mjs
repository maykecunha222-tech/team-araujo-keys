import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const format = /^(?:ZX|TA)-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/;
const assets = {
  "/iphone/": ["index.html", "text/html; charset=utf-8"],
  "/iphone/app.css": ["app.css", "text/css; charset=utf-8"],
  "/iphone/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/iphone/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json"],
  "/iphone/crest.png": ["crest.png", "image/png"],
  "/iphone/icon.png": ["icon.png", "image/png"],
  "/iphone/background.png": ["background.png", "image/png"]
};

export function createIphoneHandler({ db, body, adminToken }) {
  const sign = text => createHmac("sha256", adminToken).update("zentrix-iphone/v1:" + text).digest();
  const cookie = (name, value, age) =>
    name + "=" + value + "; Path=/iphone/; Max-Age=" + age + "; HttpOnly; Secure; SameSite=Strict";
  function session(raw) {
    if (!raw || raw.length > 512) return null;
    const [message, signature, extra] = raw.split(".");
    if (!message || !signature || extra !== undefined) return null;
    const provided = Buffer.from(signature, "base64url");
    if (provided.length !== 32 || !timingSafeEqual(provided, sign(message))) return null;
    try {
      const value = JSON.parse(Buffer.from(message, "base64url").toString("utf8"));
      if (!/^[a-f0-9]{64}$/.test(value.hash) || !uuid.test(value.device) || !(value.exp > Date.now())) return null;
      return value;
    } catch { return null; }
  }
  return async (req, res, path) => {
    if (path !== "/iphone" && !path.startsWith("/iphone/")) return false;
    const send = (status, data, headers = {}) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
      res.end(JSON.stringify(data));
      return true;
    };
    if (path === "/iphone" && req.method === "GET") {
      res.writeHead(302, { Location: "/iphone/" });
      res.end();
      return true;
    }
    const cookies = Object.fromEntries((req.headers.cookie || "").split(";").map(part => part.trim().split("=", 2)));
    const asset = assets[path];
    if (req.method === "GET" && asset) {
      const content = await readFile(new URL("./iphone/" + asset[0], import.meta.url));
      res.writeHead(200, {
        "Content-Type": asset[1], "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff",
        ...(path === "/iphone/" && !uuid.test(cookies.zx_ios_device || "") ?
          { "Set-Cookie": cookie("zx_ios_device", randomUUID(), 365 * 86400) } : {}),
        "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; manifest-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
      });
      res.end(content);
      return true;
    }
    if (req.method === "GET" && path === "/iphone/session") {
      const current = session(cookies.zx_ios_session);
      if (!current || current.device !== cookies.zx_ios_device) return send(401, { error: "Entre com sua key." });
      const rows = await db("team_araujo_app_licenses?select=expires_at&revoked=eq.false&expires_at=gt.now&limit=1&key_hash=eq."
        + current.hash + "&device=eq." + current.device);
      if (!rows.length) return send(403, { error: "O acesso foi bloqueado, expirou ou mudou de aparelho." },
        { "Set-Cookie": cookie("zx_ios_session", "", 0) });
      return send(200, { expiresAt: Date.parse(rows[0].expires_at) });
    }
    if (req.method === "POST" && ["/iphone/login", "/iphone/logout"].includes(path)) {
      let origin;
      try { origin = new URL(req.headers.origin); } catch { return send(403, { error: "Origem inválida." }); }
      if (origin.host !== req.headers.host) return send(403, { error: "Origem inválida." });
      if (path === "/iphone/logout") return send(200, { ok: true }, { "Set-Cookie": cookie("zx_ios_session", "", 0) });
      const input = await body(req);
      const key = typeof input?.key === "string" ? input.key.trim().toUpperCase() : "";
      if (!format.test(key)) return send(400, { error: "Confira a key completa." });
      const device = cookies.zx_ios_device;
      if (!uuid.test(device || "")) return send(400, { error: "Abra a página novamente e permita cookies para vincular a key." });
      const hash = createHash("sha256").update(key).digest("hex");
      const rows = await db("rpc/team_araujo_app_validate", "POST", { p_hash: hash, p_device: device });
      const expiresAt = Date.parse(rows[0]?.expires_at);
      const now = Date.now();
      if (!(expiresAt > now)) return send(403, { error: "Key inválida, vencida, bloqueada ou em uso em outro aparelho." });
      const exp = Math.min(expiresAt, now + 7 * 86400000);
      const message = Buffer.from(JSON.stringify({ hash, device, exp })).toString("base64url");
      return send(200, { expiresAt }, { "Set-Cookie": [
        cookie("zx_ios_device", device, 365 * 86400),
        cookie("zx_ios_session", message + "." + sign(message).toString("base64url"), Math.ceil((exp - now) / 1000))
      ] });
    }
    return send(404, { error: "Rota não encontrada." });
  };
}
