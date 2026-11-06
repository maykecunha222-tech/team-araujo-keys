import QRCode from "qrcode";
import { imageSize } from "image-size";

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const table = "zentrix_pix_receipts";
const maxBytes = 2 * 1024 * 1024;

function field(id, value) {
  return id + String(value.length).padStart(2, "0") + value;
}

function crc16(value) {
  let crc = 0xffff;
  for (const byte of Buffer.from(value)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function createManualPix({ key, name, city }) {
  const normalize = (value, length) => (value || "").normalize("NFD").replace(/\p{M}/gu, "")
    .toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/ +/g, " ").trim().slice(0, length);
  const receiver = normalize(name, 25);
  const location = normalize(city, 15);
  const pixKey = (key || "").trim();
  if (!/^[\x21-\x7E]{1,77}$/.test(pixKey) || !receiver || !location) {
    throw new Error("Configure PIX_KEY, PIX_RECEIVER_NAME e PIX_RECEIVER_CITY.");
  }
  return {
    async create(id, amount) {
      const txid = pixReference(id);
      const payload = field("00", "01") + field("26", field("00", "br.gov.bcb.pix") + field("01", pixKey)) +
        field("52", "0000") + field("53", "986") + field("54", (amount / 100).toFixed(2)) +
        field("58", "BR") + field("59", receiver) + field("60", location) + field("62", field("05", txid)) + "6304";
      const pix = payload + crc16(payload);
      const qr = await QRCode.toDataURL(pix, { width: 360 });
      return { pix, qr, txid, pixKey, amount };
    }
  };
}

export function pixReference(id) {
  return id.replaceAll("-", "").slice(0, 25).toUpperCase();
}

export async function readReceipt(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBytes) {
      req.resume();
      throw Object.assign(new Error("A imagem deve ter até 2 MB."), { status: 413 });
    }
    chunks.push(chunk);
  }
  const image = Buffer.concat(chunks);
  try {
    const { type, width, height } = imageSize(image);
    if (!["png", "jpg"].includes(type) || width < 64 || height < 64 ||
        width > 8000 || height > 8000 || width * height > 24000000) throw new Error();
    const complete = type === "png" ? image.subarray(-12).toString("hex") === "0000000049454e44ae426082" :
      image.readUInt16BE(image.length - 2) === 0xffd9;
    if (!complete) throw new Error();
    return { image, mime: type === "png" ? "image/png" : "image/jpeg" };
  } catch {
    throw Object.assign(new Error("Envie uma imagem PNG ou JPG legível de até 2 MB."), { status: 400 });
  }
}

export function createReceiptAdmin({ db, body, isAdmin }) {
  return async (req, res, path, send) => {
    if (path !== "/api/admin/comprovantes") return false;
    if (!isAdmin(req)) {
      send(403, { error: "Acesso exclusivo do administrador." });
      return true;
    }
    if (req.method === "GET") {
      const id = new URL(req.url, "http://localhost").searchParams.get("id");
      if (id) {
        if (!uuid.test(id)) {
          send(400, { error: "Pedido inválido." });
          return true;
        }
        const [receipt] = await db(table + "?select=mime,image&order_id=eq." + id + "&status=eq.review");
        send(receipt ? 200 : 404, receipt || { error: "Comprovante indisponível." });
        return true;
      }
      const receipts = await db(table + "?select=order_id,created_at,zentrix_orders(amount,hours,reseller_id,buyer_name,license_id)&status=eq.review&order=created_at.asc&limit=100");
      send(200, { receipts: receipts.map(receipt => ({ ...receipt, reference: pixReference(receipt.order_id) })) });
      return true;
    }
    if (req.method === "PATCH") {
      const input = await body(req);
      const approved = input?.action === "approve";
      const e2e = typeof input?.e2e === "string" ? input.e2e.trim() : "";
      if (!uuid.test(input?.id || "") || !["approve", "reject"].includes(input?.action) ||
          (approved && !/^E[0-9]{20}[A-Za-z0-9]{11}$/.test(e2e))) {
        send(400, { error: "Informe o ID End-to-End do Pix que consta no extrato." });
        return true;
      }
      try {
        const changed = await db(table + "?select=order_id&order_id=eq." + input.id + "&status=eq.review",
          "PATCH", { status: approved ? "approved" : "rejected", e2e: approved ? e2e : null, image: null });
        send(changed.length ? 200 : 409, changed.length ? { ok: true } : { error: "Comprovante já revisado." });
      } catch (error) {
        if (error.dbStatus !== 409) throw error;
        send(409, { error: "Esse ID de Pix já foi usado em outro pedido." });
      }
      return true;
    }
    send(405, { error: "Método não permitido." });
    return true;
  };
}
