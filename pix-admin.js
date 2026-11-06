const receiptsPanel = document.getElementById("pix-receipts-panel");
const receiptsList = document.getElementById("pix-receipts-list");
const receiptsEndpoint = "/api/admin/comprovantes";

async function loadReceipts() {
  const { receipts } = await request("GET", undefined, receiptsEndpoint);
  receiptsList.replaceChildren();
  if (!receipts.length) receiptsList.textContent = "Nenhum comprovante aguardando revisão.";
  for (const receipt of receipts) {
    const row = document.createElement("article");
    row.className = "key-item";
    const info = document.createElement("p");
    const order = receipt.zentrix_orders;
    const type = order.reseller_id ? "Revenda" : "Loja";
    info.textContent = type + " · " + reais.format(order.amount / 100) + " · " +
      order.hours / 24 + " dias · " + formatDate(receipt.created_at);
    if (order.buyer_name) info.textContent += " · " + order.buyer_name;
    const reference = document.createElement("p");
    reference.textContent = "Referência do Pix: " + receipt.reference;
    const review = document.createElement("button");
    review.className = "small secondary";
    review.type = "button";
    review.textContent = "Revisar comprovante";
    row.append(info, reference, review);
    if (order.license_id && order.reseller_id) {
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.className = "small danger";
      revoke.textContent = "Excluir key";
      revoke.onclick = async () => {
        if (!confirm("Excluir a key deste pedido? Ela deixará de funcionar.")) return;
        revoke.disabled = true;
        try {
          await request("DELETE", { id: order.license_id });
          revoke.textContent = "Key excluída";
          await reload();
          message("Key excluída. Você pode recusar o comprovante.");
        } catch (error) {
          message(error.message);
          revoke.disabled = false;
        }
      };
      row.append(revoke);
    }
    review.onclick = async () => {
      review.disabled = true;
      try {
        const { mime, image } = await request("GET", undefined, receiptsEndpoint + "?id=" + receipt.order_id);
        const preview = document.createElement("img");
        preview.alt = "Comprovante enviado";
        preview.style.maxWidth = "100%";
        preview.src = "data:" + mime + ";base64," + image;
        const form = document.createElement("form");
        form.className = "stack";
        const help = document.createElement("label");
        help.textContent = "Confira o crédito e o valor no seu extrato. Informe o ID End-to-End do extrato.";
        const id = document.createElement("input");
        id.maxLength = 32;
        id.autocomplete = "off";
        id.required = true;
        help.append(id);
        const approve = document.createElement("button");
        approve.textContent = "Confirmar crédito e liberar key";
        const reject = document.createElement("button");
        reject.type = "button";
        reject.className = "small danger";
        reject.textContent = "Recusar comprovante";
        form.append(help, approve, reject);
        async function decide(action) {
          approve.disabled = true;
          reject.disabled = true;
          try {
            await request("PATCH", { id: receipt.order_id, action, e2e: id.value.trim() }, receiptsEndpoint);
            await loadReceipts();
            message(action === "approve" ? "Pagamento aprovado." : "Comprovante recusado.");
          } catch (error) {
            message(error.message);
            approve.disabled = false;
            reject.disabled = false;
          }
        }
        form.onsubmit = event => {
          event.preventDefault();
          if (confirm("O valor deste pedido entrou na sua conta?")) decide("approve");
        };
        reject.onclick = () => {
          if (confirm("Recusar este comprovante?")) decide("reject");
        };
        row.append(preview, form);
        review.remove();
      } catch (error) {
        message(error.message);
        review.disabled = false;
      }
    };
    receiptsList.append(row);
  }
}

async function refreshReceipts() {
  try { await loadReceipts(); } catch (error) { message(error.message); }
}
receiptsPanel.ontoggle = () => {
  if (receiptsPanel.open) refreshReceipts();
};
document.getElementById("pix-receipts-refresh").onclick = refreshReceipts;
