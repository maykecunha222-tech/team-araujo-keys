const element = id => document.getElementById(id);
const form = element("purchase");
const status = element("status");
let storageKey = "zentrix.pix.order";
let resellerAccess = "";
const endpoint = form.dataset.reseller ? "/api/loja/revenda" : "/api/loja";
let order;


async function request(path, options) {
    if (resellerAccess) options.headers["X-Reseller-Token"] = resellerAccess;
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status });
  return data;
}

function showOrder() {
  form.hidden = true;
  element("order").hidden = false;
  element("payment").hidden = false;
  element("pix").value = order.pix;
  element("pix-reference").hidden = !order.txid;
  element("pix-reference").textContent = order.txid ? "Referência do Pix: " + order.txid : "";
  if (typeof order.qr === "string") {
    const qr = order.qr.replace(/^data:image\/png;base64[,.]/, "");
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(qr)) {
      element("qr").src = "data:image/png;base64," + qr;
      element("qr").hidden = false;
    }
  }
  status.textContent = order.manual ? "Pague o Pix e envie o comprovante." : order.sandbox ? "Ambiente de teste. Aguardando confirmação simulada." : "Aguardando pagamento…";
}

async function checkPayment() {
  try {
    const result = await request(endpoint + "/pedido", { headers: { Authorization: "Bearer " + order.order } });
    if (result.status === "awaiting_receipt") {
      element("receipt-form").hidden = false;
      status.textContent = "Pague o Pix e envie o comprovante.";
      return;
    }
    element("receipt-form").hidden = true;
    if (result.status === "review") {
      element("payment").hidden = true;
      status.textContent = "Comprovante recebido. Aguardando conferência do pagamento.";
      setTimeout(checkPayment, 15000);
      return;
    }
    if (result.status === "pending") {
      status.textContent = order.manual ? "Pague o Pix e envie o comprovante." : order.sandbox ? "Ambiente de teste. Aguardando confirmação simulada." : "Aguardando pagamento…";
      setTimeout(checkPayment, 6000);
      return;
    }
    element("payment").hidden = true;
    element("reset").hidden = false;
    if (result.status === "rejected") {
      status.textContent = "Comprovante recusado. Se o valor saiu da sua conta, fale com o responsável pela loja antes de pagar novamente.";
      return;
    }
    if (result.status === "closed") {
      status.textContent = "Pedido encerrado ou key indisponível.";
      return;
    }
    status.textContent = result.sandbox ? "Pagamento de teste confirmado. Key demonstrativa." : result.receiptOnly ? "Comprovante recebido. Sua key foi liberada." : "Pagamento confirmado!";
    element("key").textContent = result.key;
    element("delivery").hidden = false;
    if (resellerAccess) document.dispatchEvent(new Event("reseller-paid"));
  } catch (error) {
    if (error.status === 404 || error.status === 403) {
      element("payment").hidden = true;
      element("reset").hidden = false;
      status.textContent = "Pedido indisponível.";
      return;
    }
    status.textContent = "A confirmação está demorando. Vamos consultar novamente.";
    setTimeout(checkPayment, 15000);
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  status.textContent = "Gerando cobrança…";
  try {
    const data = Object.fromEntries(new FormData(form));
    order = await request(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, hours: Number(data.hours) })
    });
    try { (order.manual ? localStorage : sessionStorage).setItem(storageKey, JSON.stringify(order)); } catch {}
    form.reset();
    showOrder();
    checkPayment();
  } catch (error) {
    status.textContent = error.message || "Não foi possível gerar o Pix.";
  } finally {
    button.disabled = false;
  }
});

function copy(button, read) {
  element(button).addEventListener("click", async event => {
    try {
      await navigator.clipboard.writeText(read());
      event.target.textContent = "Copiado";
    } catch {
      event.target.textContent = "Selecione e copie o texto";
    }
  });
}

copy("copy-pix", () => element("pix").value);
copy("copy-key", () => element("key").textContent);
element("reset").addEventListener("click", () => {
  try { sessionStorage.removeItem(storageKey); localStorage.removeItem(storageKey); } catch {}
  order = undefined;
  element("order").hidden = true;
  element("delivery").hidden = true;
  element("reset").hidden = true;
  element("qr").hidden = true;
  element("key").textContent = "";
  element("pix").value = "";
  element("copy-pix").textContent = "Copiar Pix";
  element("copy-key").textContent = "Copiar key";
  form.hidden = false;
  status.textContent = "";
});

element("receipt-form").onsubmit = async event => {
  event.preventDefault();
  const button = event.submitter;
  const image = element("receipt-image").files[0];
  if (!image) return;
  element("receipt-error").textContent = "";
  if (image.size > 2 * 1024 * 1024) {
    element("receipt-error").textContent = "A imagem deve ter até 2 MB.";
    return;
  }
  button.disabled = true;
  try {
    await request(endpoint + "/pedido", {
      method: "POST", headers: { Authorization: "Bearer " + order.order, "Content-Type": "application/octet-stream" },
      body: image
    });
    event.target.reset();
    element("receipt-form").hidden = true;
    checkPayment();
  } catch (error) {
    element("receipt-error").textContent = error.message;
    if (error.status === 409) checkPayment();
  } finally {
    button.disabled = false;
  }
};

async function resumeOrder() {
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const config = await request(endpoint, { headers: {} });
    const customer = element("customer-data");
    customer.hidden = config.manual;
    customer.disabled = config.manual;
    const buyer = element("buyer-name-field");
    if (buyer) {
      buyer.hidden = !config.manual;
      buyer.querySelector("input").disabled = !config.manual;
      buyer.querySelector("input").required = config.manual;
    }
    if (!config.available) status.textContent = "As vendas ainda não estão disponíveis.";
    button.disabled = !config.available;
  } catch (error) {
    status.textContent = error.message;
  }
  try { order = JSON.parse(localStorage.getItem(storageKey) || sessionStorage.getItem(storageKey)); } catch {}
  if (order?.order) {
    showOrder();
    checkPayment();
  }
}

if (form.dataset.reseller) {
  document.addEventListener("reseller-ready", ({ detail }) => {
    resellerAccess = detail.access;
    storageKey += "." + detail.id;
    resumeOrder();
  }, { once: true });
} else {
  resumeOrder();
}
