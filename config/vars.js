const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const VARS_PATH = path.join(__dirname, '..', '.vars.json');

let vars = {};
try {
  vars = JSON.parse(fs.readFileSync(VARS_PATH, 'utf8'));
} catch (e) {
  logger.error('Gagal membaca .vars.json. Pastikan file ada & format JSON benar: ' + (e.message || e));
  vars = {};
}

// ── Bot & Store ──────────────────────────────────────────────────────────────
const BOT_TOKEN             = vars.BOT_TOKEN || '';
const PORT                  = vars.PORT || 5000;
const MASTER_ID             = Number(vars.MASTER_ID || vars.USER_ID || 0);
const ADMIN_IDS_RAW         = vars.ADMIN_IDS || vars.USER_ID || '';
const NAMA_STORE            = vars.NAMA_STORE || '@YourStore';
const RESELLER_DISCOUNT     = Number(vars.RESELLER_DISCOUNT || 0.5);
const GROUP_ID              = vars.GROUP_ID || '';
const NOTIF_TOPUP_GROUP     = vars.NOTIF_TOPUP_GROUP === undefined
  ? true
  : String(vars.NOTIF_TOPUP_GROUP).toLowerCase() === 'true';

// Data QRIS lama (legacy, kalau ada)
const DATA_QRIS             = vars.DATA_QRIS || '';
const MERCHANT_ID           = vars.MERCHANT_ID || '';
const API_KEY               = vars.API_KEY || '';

// ── Lisensi & Timezone ───────────────────────────────────────────────────────
const EXPIRE_DATE           = vars.EXPIRE_DATE || null;
const TIME_ZONE             = vars.TIME_ZONE || 'Asia/Jakarta';

// ── Payment / QRIS (autoft-orkut) ────────────────────────────────────────────
const ORDERKUOTA_BASE_QR              = vars.ORDERKUOTA_BASE_QR || '';
const ORDERKUOTA_AUTH_USERNAME        = vars.ORDERKUOTA_AUTH_USERNAME || '';
const ORDERKUOTA_AUTH_TOKEN           = vars.ORDERKUOTA_AUTH_TOKEN || '';
const ORDERKUOTA_CREATEPAYMENT_URL    = vars.ORDERKUOTA_CREATEPAYMENT_URL
  || 'https://api.rajaserverpremium.web.id/orderkuota/createpayment';
const ORDERKUOTA_CREATEPAYMENT_APIKEY = vars.ORDERKUOTA_CREATEPAYMENT_APIKEY || '';
const ADMIN_WHATSAPP                  = vars.ADMIN_WHATSAPP || '';

// Batas nominal & timing QRIS
const QRIS_AUTO_TOPUP_MIN       = Number(vars.QRIS_AUTO_TOPUP_MIN    || 15000);
const QRIS_AUTO_TOPUP_MAX       = Number(vars.QRIS_AUTO_TOPUP_MAX    || 500000);
const QRIS_CHECK_INTERVAL_MS    = Number(vars.QRIS_CHECK_INTERVAL_MS || 5000);
const QRIS_PAYMENT_TIMEOUT_MIN  = Number(vars.QRIS_PAYMENT_TIMEOUT_MIN || 15);

// ── Bonus Topup (Tier) ───────────────────────────────────────────────────────
const TOPUP_BONUS_ENABLED       = typeof vars.TOPUP_BONUS_ENABLED !== 'undefined'
  ? !!vars.TOPUP_BONUS_ENABLED : true;
const TOPUP_BONUS_MIN_AMOUNT    = Number(vars.TOPUP_BONUS_MIN_AMOUNT    || 50000);
const TOPUP_BONUS_PERCENT       = Number(vars.TOPUP_BONUS_PERCENT       || 5);
const TOPUP_BONUS_TIER2_MIN     = Number(vars.TOPUP_BONUS_TIER2_MIN     || 100000);
const TOPUP_BONUS_TIER2_PERCENT = Number(vars.TOPUP_BONUS_TIER2_PERCENT || 7);
const TOPUP_BONUS_TIER3_MIN     = Number(vars.TOPUP_BONUS_TIER3_MIN     || 200000);
const TOPUP_BONUS_TIER3_PERCENT = Number(vars.TOPUP_BONUS_TIER3_PERCENT || 10);

// ── Auto Backup ───────────────────────────────────────────────────────────────
const AUTO_BACKUP_ENABLED        = typeof vars.AUTO_BACKUP_ENABLED !== 'undefined'
  ? !!vars.AUTO_BACKUP_ENABLED : true;
const AUTO_BACKUP_INTERVAL_HOURS = Number(vars.AUTO_BACKUP_INTERVAL_HOURS || 12);
const BACKUP_CHAT_ID             = Number(vars.BACKUP_CHAT_ID || MASTER_ID || 0);

// ── Laporan Harian ────────────────────────────────────────────────────────────
const DAILY_REPORT_ENABLED = typeof vars.DAILY_REPORT_ENABLED !== 'undefined'
  ? !!vars.DAILY_REPORT_ENABLED : true;
const DAILY_REPORT_HOUR    = Number(vars.DAILY_REPORT_HOUR   || 23);
const DAILY_REPORT_MINUTE  = Number(vars.DAILY_REPORT_MINUTE || 0);

// ── Pengingat Expired ─────────────────────────────────────────────────────────
const EXPIRY_REMINDER_ENABLED     = typeof vars.EXPIRY_REMINDER_ENABLED !== 'undefined'
  ? !!vars.EXPIRY_REMINDER_ENABLED : true;
const EXPIRY_REMINDER_HOUR        = Number(vars.EXPIRY_REMINDER_HOUR        || 20);
const EXPIRY_REMINDER_MINUTE      = Number(vars.EXPIRY_REMINDER_MINUTE      || 0);
const EXPIRY_REMINDER_DAYS_BEFORE = Number(vars.EXPIRY_REMINDER_DAYS_BEFORE || 1);

// ── Target Reseller ───────────────────────────────────────────────────────────
const RESELLER_TARGET_ENABLED            = typeof vars.RESELLER_TARGET_ENABLED !== 'undefined'
  ? !!vars.RESELLER_TARGET_ENABLED : true;
const RESELLER_TARGET_MIN_30D_ACCOUNTS   = Number(vars.RESELLER_TARGET_MIN_30D_ACCOUNTS   || 3);
const RESELLER_TARGET_MIN_DAYS_PER_MONTH = Number(vars.RESELLER_TARGET_MIN_DAYS_PER_MONTH || 90);
const RESELLER_TARGET_CHECK_HOUR         = Number(vars.RESELLER_TARGET_CHECK_HOUR         || 1);
const RESELLER_TARGET_CHECK_MINUTE       = Number(vars.RESELLER_TARGET_CHECK_MINUTE       || 5);

// ── Computed: ADMIN_IDS sebagai array angka ───────────────────────────────────
const ADMIN_IDS = Array.isArray(ADMIN_IDS_RAW)
  ? ADMIN_IDS_RAW.map((id) => Number(id))
  : String(ADMIN_IDS_RAW)
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));

module.exports = {
  vars,
  VARS_PATH,

  // Bot & Store
  BOT_TOKEN,
  PORT,
  MASTER_ID,
  ADMIN_IDS_RAW,
  ADMIN_IDS,
  NAMA_STORE,
  RESELLER_DISCOUNT,
  GROUP_ID,
  NOTIF_TOPUP_GROUP,
  DATA_QRIS,
  MERCHANT_ID,
  API_KEY,

  // Lisensi & Timezone
  EXPIRE_DATE,
  TIME_ZONE,

  // Payment / QRIS
  ORDERKUOTA_BASE_QR,
  ORDERKUOTA_AUTH_USERNAME,
  ORDERKUOTA_AUTH_TOKEN,
  ORDERKUOTA_CREATEPAYMENT_URL,
  ORDERKUOTA_CREATEPAYMENT_APIKEY,
  ADMIN_WHATSAPP,
  QRIS_AUTO_TOPUP_MIN,
  QRIS_AUTO_TOPUP_MAX,
  QRIS_CHECK_INTERVAL_MS,
  QRIS_PAYMENT_TIMEOUT_MIN,

  // Bonus Topup
  TOPUP_BONUS_ENABLED,
  TOPUP_BONUS_MIN_AMOUNT,
  TOPUP_BONUS_PERCENT,
  TOPUP_BONUS_TIER2_MIN,
  TOPUP_BONUS_TIER2_PERCENT,
  TOPUP_BONUS_TIER3_MIN,
  TOPUP_BONUS_TIER3_PERCENT,

  // Auto Backup
  AUTO_BACKUP_ENABLED,
  AUTO_BACKUP_INTERVAL_HOURS,
  BACKUP_CHAT_ID,

  // Laporan Harian
  DAILY_REPORT_ENABLED,
  DAILY_REPORT_HOUR,
  DAILY_REPORT_MINUTE,

  // Pengingat Expired
  EXPIRY_REMINDER_ENABLED,
  EXPIRY_REMINDER_HOUR,
  EXPIRY_REMINDER_MINUTE,
  EXPIRY_REMINDER_DAYS_BEFORE,

  // Target Reseller
  RESELLER_TARGET_ENABLED,
  RESELLER_TARGET_MIN_30D_ACCOUNTS,
  RESELLER_TARGET_MIN_DAYS_PER_MONTH,
  RESELLER_TARGET_CHECK_HOUR,
  RESELLER_TARGET_CHECK_MINUTE,
};
