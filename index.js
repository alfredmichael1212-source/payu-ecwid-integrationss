import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// Helper: Get OAuth token from PayU
async function getPayUToken() {
  const url = `${process.env.PAYU_API_URL}/pl/standard/user/oauth/authorize`;

  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", process.env.PAYU_CLIENT_ID);
  params.append("client_secret", process.env.PAYU_CLIENT_SECRET);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });

  const data = await response.json();
  if (!data.access_token) {
    throw new Error("PayU auth failed: " + JSON.stringify(data));
  }
  return data.access_token;
}

// ✅ Step 1: Ecwid → Your server → PayU
app.post("/payu", async (req, res) => {
  try {
    console.log("Ecwid payment request received:", req.body);

    const order = req.body?.cart?.order;
    if (!order) {
      return res.status(400).json({ error: "No order data received" });
    }

    // Convert to grosz (minor units)
    const totalAmount = Math.round(order.total * 100);

    const products = order.items.map(item => ({
      name: item.name,
      unitPrice: Math.round(item.price * 100),
      quantity: item.quantity
    }));

    // 🔑 Get access token from PayU
    const token = await getPayUToken();

    const payuPayload = {
      notifyUrl: `${PAYU_API_URL=https://secure.payu.com
}/payu/notify`, 
      customerIp: req.ip || "127.0.0.1",
      merchantPosId: process.env.PAYU_POS_ID,
      description: `Order #${order.id}`,
      currencyCode: order.currency || "PLN",
      totalAmount: totalAmount.toString(),
      extOrderId: order.id, // keep Ecwid order ID reference
      products
    };

    // Call PayU API
    const response = await fetch(`${PAYU_API_URL=https://secure.snd.payu.com
}/api/v2_1/orders`, { 
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payuPayload)
    });

    const result = await response.json();
    console.log("PayU response:", result);

    if (result.status?.statusCode === "SUCCESS") {
      return res.json({ redirectUrl: result.redirectUri });
    } else {
      return res.status(400).json({ error: result });
    }
  } catch (err) {
    console.error("Error in /payu:", err);
    res.status(500).json({ error: "Payment initialization failed" });
  }
});

// ✅ Step 2: PayU → Your server → Ecwid (update payment status)
app.post("/payu/notify", async (req, res) => {
  try {
    console.log("PayU notification received:", req.body);

    const payuOrder = req.body;
    const orderId = payuOrder?.order?.extOrderId;

    if (!orderId) {
      return res.sendStatus(400);
    }

    // Call Ecwid API to mark order as PAID
    const ecwidApiUrl = `https://app.ecwid.com/api/v3/${process.env.ECWID_STORE_ID}/orders/${orderId}/payment_status`;
    const ecwidResponse = await fetch(ecwidApiUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ECWID_API_TOKEN}`
      },
      body: JSON.stringify({ paymentStatus: "PAID" })
    });

    if (!ecwidResponse.ok) {
      const errorText = await ecwidResponse.text();
      console.error("Failed to update Ecwid order:", errorText);
      return res.sendStatus(500);
    }

    console.log(`✅ Order ${orderId} marked as PAID in Ecwid`);
    res.sendStatus(200);
  } catch (error) {
    console.error("Error in /payu/notify:", error);
    res.sendStatus(500);
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 PayU integration server running on port ${PORT}`);
});
