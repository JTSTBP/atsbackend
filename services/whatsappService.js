const sendWhatsAppMessage = async ({ to, body } = {}) => {
  if (!process.env.WHATSAPP_PROVIDER || process.env.WHATSAPP_PROVIDER === "none") {
    const error = new Error("WhatsApp provider is not configured.");
    error.code = "WHATSAPP_PROVIDER_NOT_CONFIGURED";
    throw error;
  }

  if (process.env.WHATSAPP_PROVIDER !== "http") {
    const error = new Error(`Unsupported WhatsApp provider "${process.env.WHATSAPP_PROVIDER}".`);
    error.code = "WHATSAPP_PROVIDER_INVALID";
    throw error;
  }

  if (!process.env.WHATSAPP_API_URL || !process.env.WHATSAPP_API_KEY) {
    const error = new Error("WhatsApp API URL/key is missing.");
    error.code = "WHATSAPP_PROVIDER_NOT_CONFIGURED";
    throw error;
  }

  const response = await fetch(process.env.WHATSAPP_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.WHATSAPP_API_KEY}`,
    },
    body: JSON.stringify({ to, message: body }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "WhatsApp send failed.");
    error.code = "WHATSAPP_SEND_FAILED";
    error.providerResponse = data;
    throw error;
  }

  return {
    provider: "http",
    messageId: data.id || data.messageId || null,
    response: data,
  };
};

module.exports = { sendWhatsAppMessage };
