/**
 * helpers/index.js
 * Fungsi utilitas murni (pure) — tidak bergantung pada bot, db, atau state app.
 * Aman dipakai di mana saja tanpa efek samping.
 */

// ── Timing ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Format Angka & Rupiah ────────────────────────────────────────────────────

function rupiah(n) {
  return `Rp${Number(n || 0).toLocaleString('id-ID')}`;
}

function parseRupiahInt(v) {
  if (typeof v === 'number') return Math.round(v);
  if (!v) return 0;
  return parseInt(String(v).replace(/[^\d]/g, ''), 10) || 0;
}

// ── Format Pesan Standar (HTML) ───────────────────────────────────────────────

function msgSuccess(t) { return `✅ <b>Berhasil</b>\n${t}`; }
function msgError(t)   { return `❌ <b>Gagal</b>\n${t}`; }
function msgInfo(t)    { return `ℹ️ <b>Info</b>\n${t}`; }

// ── Konversi Teks ─────────────────────────────────────────────────────────────

/**
 * Konversi Markdown sederhana (*bold*, `code`) ke HTML aman untuk Telegram.
 */
function mdToHtml(text) {
  if (text == null) return '';
  let escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  escaped = escaped.replace(/\*([^*]+)\*/g, '<b>$1</b>');

  return escaped;
}

/**
 * Parse nominal kredit dari teks respons mutasi autoft-orkut.
 * Format: "Kredit: 10.123" dipisah oleh "---".
 */
function parseKreditFromResponse(text) {
  const blocks = String(text).split('------------------------').filter(Boolean);
  const kredits = [];

  for (const b of blocks) {
    const m = b.match(/Kredit\s*:\s*([\d.]+)/);
    if (!m) continue;
    const val = parseInt(m[1].replace(/\./g, ''), 10);
    if (!Number.isNaN(val)) kredits.push(val);
  }

  return kredits;
}

// ── Kalkulasi Tanggal ─────────────────────────────────────────────────────────

/**
 * Hitung sisa hari akun berdasarkan TANGGAL (bukan jam).
 * Mengembalikan null jika expiresAtMs tidak ada.
 */
function getAccountDaysLeft(expiresAtMs) {
  if (!expiresAtMs) return null;

  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();

  const expDate = new Date(expiresAtMs);
  const expDayStart = new Date(
    expDate.getFullYear(),
    expDate.getMonth(),
    expDate.getDate()
  ).getTime();

  return Math.round((expDayStart - todayStart) / (1000 * 60 * 60 * 24));
}

module.exports = {
  sleep,
  rupiah,
  parseRupiahInt,
  msgSuccess,
  msgError,
  msgInfo,
  mdToHtml,
  parseKreditFromResponse,
  getAccountDaysLeft,
};
