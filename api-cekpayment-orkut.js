// api-cekpayment-orkut.js (SELLVPN) - khusus cek mutasi/history
const qs = require('qs');
const fs = require('fs');
const path = require('path');

function loadVars() {
  try {
    const p = path.join(__dirname, '.vars.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8') || '{}');
  } catch {}
  return {};
}

const vars = loadVars();

// WAJIB: ini endpoint cek mutasi / history (bukan createpayment)
const API_URL = vars.CEKPAY_API_URL || process.env.CEKPAY_API_URL || '';
const USERNAME = vars.CEKPAY_ORKUT_USERNAME || process.env.CEKPAY_ORKUT_USERNAME || '';
const TOKEN = vars.CEKPAY_ORKUT_TOKEN || process.env.CEKPAY_ORKUT_TOKEN || '';

function buildPayload() {
  return qs.stringify({
    username: USERNAME,
    token: TOKEN,
    jenis: 'masuk', // seperti temenmu
  });
}

const headers = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Connection': 'keep-alive',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://api.rajaserverpremium.web.id/',
  'Origin': 'https://api.rajaserverpremium.web.id',
};


module.exports = { buildPayload, headers, API_URL };
