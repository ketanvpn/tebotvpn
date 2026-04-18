// services/orderkuotaQris.js
const axios = require("axios");

// Ganti kalau kamu pakai domain lain
const BASE_URL = "https://api.rajaserverpremium.web.id";

async function createQrisPayment({ apikey, amount, codeqr, reference }) {
  const url = `${BASE_URL}/orderkuota/createpayment`;
  const params = { apikey, amount, codeqr, reference };

  // Coba GET dulu
  try {
    const r = await axios.get(url, { params, timeout: 30000 });
    return r.data;
  } catch (e1) {
    // Kalau GET gagal, coba POST (params tetap di query)
    try {
      const r = await axios.post(url, null, { params, timeout: 30000 });
      return r.data;
    } catch (e2) {
      const status = e2?.response?.status;
      const data = e2?.response?.data;
      throw new Error(
        `createpayment gagal. HTTP=${status || "?"} response=${JSON.stringify(data || {})}`
      );
    }
  }
}

module.exports = { createQrisPayment };
