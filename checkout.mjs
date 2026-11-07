import { readReceipt } from "./pix-manual.mjs";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

export const resellerPrices = Object.freeze({ 336: 4000, 720: 7000 });
export const retailPrices = Object.freeze({ 336: 6000, 720: 10000 });

export function createPicPay({ environment, clientId, clientSecret, fetchPayment = fetch }) {
  const base = {
    sandbox: "https://ecommerce-api.svcp.ppay.me/sandbox",
    production: "https://ecommerce-api.svcp.picpay.com"
  }[environment];
  if (!["sandbox", "production"].includes(environment) || !clientId || !clientSecret) {
    throw new Error("Configure PICPAY_ENV, PICPAY_CLIENT_ID e PICPAY_CLIENT_SECRET.");
  }

  let token;
  let renewAt = 0;
  let refresh;
  async function request(path, value, bearer) {
    const response = await fetchPayment(base + path, {
      method: value === undefined ? "GET" : "POST",
      headers: {
        Accept: "application/json",
        ...(value === undefined ? {} : { "Content-Type": "application/json" }),
        ...(bearer ? { Authorization: "Bearer " + bearer } : {})
      },
      body: value === undefined ? undefined : JSON.stringify(value),
      signal: AbortSignal.timeout(8000),
      redirect: "error"
    });
    if (!response.ok) throw new Error("PicPay HTTP " + response.status);
    return response.json();
  }

  async function accessToken() {
    if (Date.now() < renewAt) return token;
    refresh ??= request("/oauth2/token", {
      grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret
    }).then(result => {
      if (!result.access_token || !Number.isFinite(result.expires_in)) throw new Error("Token PicPay inválido.");
      token = result.access_token;
      renewAt = Date.now() + Math.max(0, result.expires_in - 30) * 1000;
      return token;
    }).finally(() => { refresh = undefined; });
    return refresh;
  }

  return {
    environment,
    async create(id, amount, customer, ip) {
      return request("/v1/charge/pix", {
        paymentSource: "GATEWAY", merchantChargeId: id, customer,
        deviceInformation: { ip },
        transactions: [{ amount, pix: { expiration: 600 } }]
      }, await accessToken());
    },
    async find(id) {
      return request("/v1/charge/" + id, undefined, await accessToken());
    }
  };
}

const assets = new Map([
  ["/loja", ["loja.html", "text/html"]],
  ["/loja.js", ["loja.js", "text/javascript"]]
]);

function customerData(input) {
  const clean = field => typeof input?.[field] === "string" ? input[field].trim() : "";
  const name = clean("name");
  const email = clean("email");
  const document = clean("cpf").replace(/[.\-]/g, "");
  const phone = clean("phone").replace(/[()\s-]/g, "");
  if (!/^[\p{L} &\d]{2,255}$/u.test(name) || email.length > 254 ||
      !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email) ||
      !/^\d{11}$/.test(document) || !/^\d{10,11}$/.test(phone)) return null;

  return { name, email, document, documentType: "CPF", phone: {
    countryCode: "55", areaCode: phone.slice(0, 2), number: phone.slice(2), type: "MOBILE"
  } };
}

export function createCheckout({ db, body, hash, encryptKey, decryptKey, payment, manualPix, findReseller }) {
  return async (req, res, path, send) => {
    if (req.method === "GET" && assets.has(path)) {
      const [file, type] = assets.get(path);
      const content = await readFile(new URL(file, import.meta.url));
      res.writeHead(200, {
        "Content-Type": type + "; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
      });
      res.end(content);
      return true;
    }
    const resellerOrder = path === "/api/loja/revenda" || path === "/api/loja/revenda/pedido";
    const endpoint = resellerOrder ? "/api/loja/revenda" : "/api/loja";
    if (path !== endpoint && path !== endpoint + "/pedido") return false;
    const reseller = resellerOrder ? await findReseller(req.headers["x-reseller-token"]) : null;
    if (resellerOrder && !reseller) {
      send(403, { error: "Token inválido ou acesso bloqueado." });
      return true;
    }
    if (path === endpoint && req.method === "GET") {
      send(200, { manual: Boolean(manualPix), available: Boolean(manualPix || payment) });
      return true;
    }
    if (!payment && !manualPix) {
      send(503, { error: "As vendas ainda não estão disponíveis." });
      return true;
    }

    if (path === endpoint && req.method === "POST") {
      const input = await body(req);
      const hours = input?.hours;
      const customer = manualPix ? null : customerData(input);
      const buyerName = typeof input?.buyerName === "string" ? input.buyerName.trim() : "";
      if (manualPix && reseller && (!buyerName || buyerName.length > 80 || /[\p{Cc}]/u.test(buyerName))) {
        send(400, { error: "Informe seu nome com até 80 caracteres." });
        return true;
      }
      if (![336, 720].includes(hours) || (!manualPix && !customer)) {
        send(400, { error: manualPix ? "Selecione um plano válido." : "Confira o plano, nome, CPF, e-mail e telefone com DDD." });
        return true;
      }

      const id = randomUUID();
      const access = randomBytes(32).toString("hex");
      const amount = (reseller ? resellerPrices : retailPrices)[hours];
      await db("zentrix_orders", "POST", {
        id, access_hash: hash(access), hours, amount, environment: manualPix ? "production" : payment.environment,
        ...(manualPix ? { payment_method: "manual", ...(reseller ? { buyer_name: buyerName } : {}) } : {}),
        ...(reseller ? { reseller_id: reseller.id } : {})
      });
      if (manualPix) {
        const pix = await manualPix.create(id, amount);
        send(201, { order: id + "." + access, ...pix, manual: true });
        return true;
      }
      const charge = await payment.create(id, amount, customer, req.socket.remoteAddress);
      const pix = charge.transactions?.[0]?.pix;
      if (charge.merchantChargeId !== id || !pix?.qrCode) throw new Error("Cobrança Pix sem código válido.");
      send(201, { order: id + "." + access, pix: pix.qrCode, qr: pix.qrCodeBase64, sandbox: payment.environment === "sandbox" });
      return true;
    }

    if (path === endpoint + "/pedido" && ["GET", "POST", "PUT"].includes(req.method)) {
      const token = /^Bearer ([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(req.headers.authorization || "");
      if (!token) {
        send(404, { error: "Pedido não encontrado." });
        return true;
      }
      const [, id, access] = token;
      const [order] = await db("zentrix_orders?select=id,hours,amount,license_id,payment_method,buyer_name&id=eq." + id +
        "&access_hash=eq." + hash(access) + "&environment=eq." + (manualPix ? "production" : payment.environment) +
        "&reseller_id=" + (reseller ? "eq." + reseller.id : "is.null") + "&limit=1");
      if (!order) {
        send(404, { error: "Pedido não encontrado." });
        return true;
      }

      if (order.payment_method === "manual") {
        if (req.method === "POST" || req.method === "PUT") {
          const fallback = req.method === "PUT";
          if (fallback && (!reseller || !order.buyer_name)) {
            send(405, { error: "Operação disponível apenas para revenda." });
            return true;
          }
          const receipt = fallback ? null : await readReceipt(req);
          try {
            await db("zentrix_pix_receipts", "POST", {
              order_id: id, ...(receipt ? { image_hash: hash(receipt.image), image: receipt.image.toString("base64"), mime: receipt.mime } : {})
            });
            send(201, { status: "review" });
          } catch (error) {
            if (error.dbStatus !== 409) throw error;
            send(409, { error: "Este pedido ou esta imagem já tem comprovante cadastrado." });
          }
          return true;
        }
        const [receipt] = await db("zentrix_pix_receipts?select=status&order_id=eq." + id);
        const provisional = reseller && order.buyer_name && receipt?.status === "review";
        if (receipt?.status !== "approved" && !provisional) {
          send(200, { status: receipt?.status || "awaiting_receipt" });
          return true;
        }
      } else {
        if (!payment || req.method !== "GET") {
          send(405, { error: "Operação indisponível para este pedido." });
          return true;
        }
        const charge = await payment.find(id);
        const transaction = charge.transactions?.[0];
        if (charge.merchantChargeId !== id || charge.originalAmount !== order.amount ||
            charge.transactions?.length !== 1 || transaction?.paymentType !== "PIX" || transaction.originalAmount !== order.amount) {
          throw new Error("Cobrança PicPay não corresponde ao pedido.");
        }
        if (charge.chargeStatus !== "PAID" || transaction.transactionStatus !== "PAID" || charge.refundedAmount !== 0 || charge.amount !== order.amount || transaction.amount !== order.amount) {
          const pending = transaction.transactionStatus === "PENDING";
          send(200, { status: pending ? "pending" : "closed" });
          return true;
        }
        if (payment.environment === "sandbox") {
          send(200, { status: "paid", key: "DEMO-" + id.slice(0, 8).toUpperCase(), sandbox: true });
          return true;
        }
      }

      let licenseId = order.license_id;
      if (!licenseId) {
        const key = "ZX-" + randomBytes(16).toString("hex").toUpperCase().match(/.{8}/g).join("-");
        licenseId = await db("rpc/zentrix_issue_order", "POST", {
          order_id: id, license_hash: hash(key), encrypted_key: encryptKey(key), key_suffix: key.slice(-8)
        });
      }
      const [license] = await db("team_araujo_app_licenses?select=key_encrypted,revoked&id=eq." + licenseId + "&limit=1");
      if (!license?.key_encrypted || license.revoked) {
        send(200, { status: "closed" });
        return true;
      }
      send(200, { status: "paid", key: decryptKey(license.key_encrypted), ...(reseller && order.payment_method === "manual" ? { receiptOnly: true } : {}) });
      return true;
    }
    send(405, { error: "Método não permitido." });
    return true;
  };
}
