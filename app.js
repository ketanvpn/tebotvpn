const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const { Telegraf } = require('telegraf');
const app = express();
const axios = require('axios');
const { isUserReseller, addReseller, removeReseller, listResellersSync } = require('./modules/reseller');

const logger = require('./config/logger');


// Helper sederhana untuk jeda (dipakai di broadcast)
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>BotVPN 1FORCR</title></head><body style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:20px"><h1>BotVPN 1FORCR</h1><p>Telegram bot untuk manajemen layanan VPN.</p><p><strong>Status:</strong> ${BOT_TOKEN ? '🟢 Bot Configured' : '🔴 BOT_TOKEN belum di-set di .vars.json'}</p><p>Edit file <code>.vars.json</code> untuk mengkonfigurasi bot Anda.</p></body></html>`);
});

const {
  createssh,
  createvmess,
  createvless,
  createtrojan,
  createshadowsocks
} = require('./modules/create');

const {
  trialssh,
  trialvmess,
  trialvless,
  trialtrojan,
  trialshadowsocks
} = require('./modules/trial');

const {
  renewssh,
  renewvmess,
  renewvless,
  renewtrojan,
  renewshadowsocks
} = require('./modules/renew');

const {
  delssh,
  delvmess,
  delvless,
  deltrojan,
  delshadowsocks
} = require('./modules/del');

const {
  lockssh,
  lockvmess,
  lockvless,
  locktrojan,
  lockshadowsocks
} = require('./modules/lock');

const {
  unlockssh,
  unlockvmess,
  unlockvless,
  unlocktrojan,
  unlockshadowsocks
} = require('./modules/unlock');

const fsPromises = require('fs/promises');
const path = require('path');

const VARS_PATH = path.join(__dirname, '.vars.json');

const trialFile = path.join(__dirname, 'trial.db');
const trialConfigFile = path.join(__dirname, 'trial_config.json');

// Konfigurasi default trial
const DEFAULT_TRIAL_CONFIG = {
  enabled: true,          // trial awalnya AKTIF
  maxPerDay: 1,           // berapa kali trial per user per hari
  durationHours: 1,       // lama trial dalam satuan JAM
  minBalanceForTrial: 0   // minimal saldo untuk bisa trial (0 = bebas)
};
// Cache in-memory untuk konfigurasi trial
let trialConfigCache = null;
let trialConfigCacheLoadedAt = 0;
const TRIAL_CONFIG_CACHE_TTL_MS = 60 * 1000; // 1 menit (boleh diubah kalau perlu)

// Baca / buat file konfigurasi trial (dengan cache in-memory)
async function getTrialConfig() {
  const now = Date.now();

  // Kalau masih dalam TTL dan cache ada → pakai cache saja
  if (
    trialConfigCache &&
    now - trialConfigCacheLoadedAt < TRIAL_CONFIG_CACHE_TTL_MS
  ) {
    return trialConfigCache;
  }

  try {
    const data = await fsPromises.readFile(trialConfigFile, 'utf8');
    const cfg = JSON.parse(data);

    // Backward compatibility:
    // - Kalau durationHours ada → pakai itu
    // - Kalau cuma ada durationDays → konversi ke jam (x24)
    let durationHours;
    if (Number.isInteger(cfg.durationHours)) {
      durationHours = cfg.durationHours;
    } else if (Number.isInteger(cfg.durationDays)) {
      durationHours = cfg.durationDays * 24;
    } else {
      durationHours = DEFAULT_TRIAL_CONFIG.durationHours;
    }

    const maxPerDay = Number.isInteger(cfg.maxPerDay)
      ? cfg.maxPerDay
      : DEFAULT_TRIAL_CONFIG.maxPerDay;

    const enabled =
      typeof cfg.enabled === 'boolean'
        ? cfg.enabled
        : DEFAULT_TRIAL_CONFIG.enabled;

    const minBalanceForTrial =
      Number.isInteger(cfg.minBalanceForTrial) && cfg.minBalanceForTrial >= 0
        ? cfg.minBalanceForTrial
        : DEFAULT_TRIAL_CONFIG.minBalanceForTrial;

    const result = {
      enabled,
      maxPerDay,
      durationHours,
      minBalanceForTrial,
    };

    // Simpan ke cache
    trialConfigCache = result;
    trialConfigCacheLoadedAt = Date.now();

    return result;
  } catch (err) {
    // Kalau file belum ada / rusak → tulis default
    try {
      await fsPromises.writeFile(
        trialConfigFile,
        JSON.stringify(DEFAULT_TRIAL_CONFIG, null, 2)
      );
    } catch (e) {
      logger.error('⚠️ Gagal membuat trial_config.json:', e.message);
    }

    // Simpan default ke cache juga
    trialConfigCache = DEFAULT_TRIAL_CONFIG;
    trialConfigCacheLoadedAt = Date.now();

    return DEFAULT_TRIAL_CONFIG;
  }
}

// Update / simpan konfigurasi trial
async function updateTrialConfig(partial) {
  const current = await getTrialConfig();
  const updated = { ...current, ...partial };

  try {
    await fsPromises.writeFile(
      trialConfigFile,
      JSON.stringify(updated, null, 2)
    );

    // Update cache juga
    trialConfigCache = updated;
    trialConfigCacheLoadedAt = Date.now();
  } catch (e) {
    logger.error('⚠️ Gagal mengupdate trial_config.json:', e.message);
  }

  return updated;
}

// Mengecek apakah user sudah melewati batas trial per hari
async function checkTrialAccess(userId) {
  // default kalau config gagal dibaca
  let maxPerDay = DEFAULT_TRIAL_CONFIG.maxPerDay || 1;

  // baca maxPerDay dari trial_config.json
  try {
    const cfg = await getTrialConfig();
    if (cfg && Number.isInteger(cfg.maxPerDay) && cfg.maxPerDay > 0) {
      maxPerDay = cfg.maxPerDay;
    }
  } catch (err) {
    if (typeof logger !== 'undefined') {
      logger.error('⚠️ Gagal membaca konfigurasi trial (maxPerDay):', err.message || err);
    }
  }

  try {
    const data = await fsPromises.readFile(trialFile, 'utf8');
    const trialData = JSON.parse(data);
    const entry = trialData[userId];
    const today = new Date().toISOString().slice(0, 10);

    if (!entry) {
      return false;
    }

    // format lama: "YYYY-MM-DD"
    if (typeof entry === 'string') {
      if (entry !== today) return false;
      const used = 1;
      return used >= maxPerDay;
    }

    // format baru: { date, count }
    if (typeof entry === 'object' && entry.date) {
      if (entry.date !== today) return false;
      const used = typeof entry.count === 'number' ? entry.count : 1;
      return used >= maxPerDay;
    }

    return false;
  } catch (err) {
    return false; // kalau gagal baca file → anggap belum melewati batas
  }
}

async function getTrialUsageToday(userId) {
  try {
    const data = await fsPromises.readFile(trialFile, 'utf8');
    const trialData = JSON.parse(data);
    const entry = trialData[userId];
    const today = new Date().toISOString().slice(0, 10);

    if (!entry) return 0;

    // format lama: "YYYY-MM-DD"
    if (typeof entry === 'string') {
      return entry === today ? 1 : 0;
    }

    // format baru: { date, count }
    if (typeof entry === 'object' && entry.date) {
      if (entry.date !== today) return 0;
      return typeof entry.count === 'number' ? entry.count : 1;
    }

    return 0;
  } catch (err) {
    // kalau gagal baca file → anggap belum pernah trial
    return 0;
  }
}

async function getCreateUsageToday(userId) {
  return await new Promise((resolve) => {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const startTs = startOfDay.getTime();

      db.get(
        'SELECT COUNT(*) AS cnt FROM accounts WHERE user_id = ? AND created_at >= ?',
        [userId, startTs],
        (err, row) => {
          if (err) {
            logger.error('❌ Kesalahan saat membaca jumlah akun harian user:', err.message);
            return resolve(0); // kalau error, anggap 0 biar ga ganggu user baik
          }
          const cnt = row && row.cnt ? Number(row.cnt) : 0;
          resolve(cnt);
        }
      );
    } catch (e) {
      logger.error('❌ Error di getCreateUsageToday:', e.message || e);
      resolve(0);
    }
  });
}

/////////
async function checkServerAccess(serverId, userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT is_reseller_only FROM Server WHERE id = ?', [serverId], async (err, row) => {
      if (err) return reject(err);
      // jika server tidak ada => tolak (caller menangani pesan)
      if (!row) return resolve({ ok: false, reason: 'not_found' });
      const flag = row.is_reseller_only === 1 || row.is_reseller_only === '1';
      if (!flag) return resolve({ ok: true }); // publik
      // jika reseller-only, cek apakah user terdaftar reseller
      try {
        const isR = await isUserReseller(userId);
        if (isR) return resolve({ ok: true });
        return resolve({ ok: false, reason: 'reseller_only' });
      } catch (e) {
        // fallback: tolak akses
        return resolve({ ok: false, reason: 'reseller_only' });
      }
    });
  });
}

// Menyimpan informasi penggunaan trial user (tanggal + hitungan per hari)
async function saveTrialAccess(userId) {
  let trialData = {};
  try {
    const data = await fsPromises.readFile(trialFile, 'utf8');
    trialData = JSON.parse(data);
  } catch (err) {
    // file belum ada / rusak → mulai dari kosong
  }

  const today = new Date().toISOString().slice(0, 10);
  const existing = trialData[userId];

  if (existing && typeof existing === 'object') {
    // format baru: { date, count }
    if (existing.date === today) {
      existing.count = (existing.count || 0) + 1;
    } else {
      trialData[userId] = { date: today, count: 1 };
    }
  } else if (typeof existing === 'string') {
    // format lama: "YYYY-MM-DD" → anggap sudah 1x di hari itu
    if (existing === today) {
      trialData[userId] = { date: today, count: 2 };
    } else {
      trialData[userId] = { date: today, count: 1 };
    }
  } else {
    // belum ada catatan sama sekali
    trialData[userId] = { date: today, count: 1 };
  }

  await fsPromises.writeFile(trialFile, JSON.stringify(trialData, null, 2));
}
// ── Config: baca .vars.json & semua variabel konfigurasi ─────────────────────
const fs = require('fs');
const cfg = require('./config/vars');

const { vars } = cfg;
const {
  BOT_TOKEN,
  MASTER_ID,
  ADMIN_IDS_RAW,
  NAMA_STORE,
  RESELLER_DISCOUNT,
  GROUP_ID,
  NOTIF_TOPUP_GROUP,
  DATA_QRIS,
  MERCHANT_ID,
  API_KEY,
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
  BACKUP_CHAT_ID,
} = cfg;

const port = cfg.PORT;

// Variabel yang bisa diubah admin saat runtime
let TOPUP_BONUS_ENABLED       = cfg.TOPUP_BONUS_ENABLED;
let TOPUP_BONUS_MIN_AMOUNT    = cfg.TOPUP_BONUS_MIN_AMOUNT;
let TOPUP_BONUS_PERCENT       = cfg.TOPUP_BONUS_PERCENT;
let TOPUP_BONUS_TIER2_MIN     = cfg.TOPUP_BONUS_TIER2_MIN;
let TOPUP_BONUS_TIER2_PERCENT = cfg.TOPUP_BONUS_TIER2_PERCENT;
let TOPUP_BONUS_TIER3_MIN     = cfg.TOPUP_BONUS_TIER3_MIN;
let TOPUP_BONUS_TIER3_PERCENT = cfg.TOPUP_BONUS_TIER3_PERCENT;

let AUTO_BACKUP_ENABLED        = cfg.AUTO_BACKUP_ENABLED;
let AUTO_BACKUP_INTERVAL_HOURS = cfg.AUTO_BACKUP_INTERVAL_HOURS;

let DAILY_REPORT_ENABLED = cfg.DAILY_REPORT_ENABLED;
let DAILY_REPORT_HOUR    = cfg.DAILY_REPORT_HOUR;
let DAILY_REPORT_MINUTE  = cfg.DAILY_REPORT_MINUTE;

let EXPIRY_REMINDER_ENABLED     = cfg.EXPIRY_REMINDER_ENABLED;
let EXPIRY_REMINDER_HOUR        = cfg.EXPIRY_REMINDER_HOUR;
let EXPIRY_REMINDER_MINUTE      = cfg.EXPIRY_REMINDER_MINUTE;
let EXPIRY_REMINDER_DAYS_BEFORE = cfg.EXPIRY_REMINDER_DAYS_BEFORE;

let RESELLER_TARGET_ENABLED            = cfg.RESELLER_TARGET_ENABLED;
let RESELLER_TARGET_MIN_30D_ACCOUNTS   = cfg.RESELLER_TARGET_MIN_30D_ACCOUNTS;
let RESELLER_TARGET_MIN_DAYS_PER_MONTH = cfg.RESELLER_TARGET_MIN_DAYS_PER_MONTH;
let RESELLER_TARGET_CHECK_HOUR         = cfg.RESELLER_TARGET_CHECK_HOUR;
let RESELLER_TARGET_CHECK_MINUTE       = cfg.RESELLER_TARGET_CHECK_MINUTE;

let EXPIRE_DATE = cfg.EXPIRE_DATE;
let TIME_ZONE   = cfg.TIME_ZONE;

// Log init summary
logger.info(`Topup bonus init: enabled=${TOPUP_BONUS_ENABLED}, tier1>=${TOPUP_BONUS_MIN_AMOUNT}@${TOPUP_BONUS_PERCENT}%, tier2>=${TOPUP_BONUS_TIER2_MIN}@${TOPUP_BONUS_TIER2_PERCENT}%, tier3>=${TOPUP_BONUS_TIER3_MIN}@${TOPUP_BONUS_TIER3_PERCENT}%`);
logger.info(`Auto-backup init: enabled=${AUTO_BACKUP_ENABLED}, interval=${AUTO_BACKUP_INTERVAL_HOURS} jam, chat=${BACKUP_CHAT_ID}`);
logger.info(`Daily report init: enabled=${DAILY_REPORT_ENABLED}, time=${DAILY_REPORT_HOUR}:${String(DAILY_REPORT_MINUTE).padStart(2, '0')}`);
logger.info(`Expiry reminder init: enabled=${EXPIRY_REMINDER_ENABLED}, daysBefore=${EXPIRY_REMINDER_DAYS_BEFORE}, time=${EXPIRY_REMINDER_HOUR}:${String(EXPIRY_REMINDER_MINUTE).padStart(2, '0')}`);
logger.info(`Reseller target init: enabled=${RESELLER_TARGET_ENABLED}, min30d=${RESELLER_TARGET_MIN_30D_ACCOUNTS}, minDays=${RESELLER_TARGET_MIN_DAYS_PER_MONTH}, time=${RESELLER_TARGET_CHECK_HOUR}:${String(RESELLER_TARGET_CHECK_MINUTE).padStart(2, '0')}`);
logger.info(`Time zone init: ${TIME_ZONE}`);

// === Variabel untuk pollMutasi (legacy orkut polling) ===
const qs = require('qs');
function buildPayload() {
  return qs.stringify({
    username: ORDERKUOTA_AUTH_USERNAME,
    token: ORDERKUOTA_AUTH_TOKEN,
    jenis: 'masuk',
  });
}
const API_URL = 'https://orkutapi.andyyuda41.workers.dev/api/qris-history';
const headers = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'Accept-Encoding': 'gzip',
  'User-Agent': 'okhttp/4.12.0',
};

let qrisGen = null;
let qrisPaymentChecker = null;

// Init / lazy init instance autoft-qris
// === autoft-orkut (sesuai README) ===
const ork = require('autoft-orkut');
const MutasiClient = ork.MutasiClient || (ork.default && ork.default.MutasiClient);
const QRIS = ork.QRIS || (ork.default && ork.default.QRIS);

let mutasiClient = null;
let qrisImageGen = null;

// Init / lazy init instance autoft-orkut
function getOrkutInstances() {
  if (!ORDERKUOTA_BASE_QR || !ORDERKUOTA_AUTH_USERNAME || !ORDERKUOTA_AUTH_TOKEN) {
    throw new Error(
      'Config ORDERKUOTA_BASE_QR / ORDERKUOTA_AUTH_USERNAME / ORDERKUOTA_AUTH_TOKEN belum di-set di .vars.json'
    );
  }

  if (!MutasiClient || !QRIS) {
    throw new Error('autoft-orkut tidak terbaca. Pastikan `npm i autoft-orkut` sudah sukses.');
  }

  if (!mutasiClient) {
    mutasiClient = new MutasiClient(ORDERKUOTA_AUTH_USERNAME, ORDERKUOTA_AUTH_TOKEN);
  }

  if (!qrisImageGen) {
    // dipakai untuk generate gambar QR
    qrisImageGen = new QRIS({ baseQrString: ORDERKUOTA_BASE_QR });
  }

  return { mutasiClient, qrisImageGen, QRIS };
}


// Hitung bonus topup berdasarkan tier (pembulatan ke bawah)
function calculateTopupBonus(amount) {
  if (!TOPUP_BONUS_ENABLED) {
    return { bonus: 0, percent: 0 };
  }

  // Pastikan nominal angka
  amount = Number(amount || 0);
  if (amount <= 0) {
    return { bonus: 0, percent: 0 };
  }

  let percent = 0;

  // Cek dari tier tertinggi ke terendah
  if (amount >= TOPUP_BONUS_TIER3_MIN) {
    percent = TOPUP_BONUS_TIER3_PERCENT;
  } else if (amount >= TOPUP_BONUS_TIER2_MIN) {
    percent = TOPUP_BONUS_TIER2_PERCENT;
  } else if (amount >= TOPUP_BONUS_MIN_AMOUNT) {
    percent = TOPUP_BONUS_PERCENT;
  }

  if (percent <= 0) {
    return { bonus: 0, percent: 0 };
  }

  // BONUS DIBULATKAN KE BAWAH
  const bonus = Math.floor((amount * percent) / 100);

  return { bonus, percent };
}

// State runtime (timer & flag harian — bukan config)
let autoBackupTimer          = null;
let lastDailyReportDateKey   = null;
let lastExpiryReminderDateKey = null;
let lastResellerTargetMonthKey = null;

function updateResellerTargetVars(partial) {
  try {
    const varsPath = path.join(__dirname, '.vars.json');

    let current = {};
    try {
      if (fs.existsSync(varsPath)) {
        const raw = fs.readFileSync(varsPath, 'utf8');
        current = JSON.parse(raw);
      }
    } catch (e) {
      logger.error(
        'Gagal baca .vars.json saat updateResellerTargetVars:',
        e.message || e
      );
    }

    const updated = Object.assign({}, current, partial);
    fs.writeFileSync(varsPath, JSON.stringify(updated, null, 2));

    logger.info(
      '[ResellerTarget] .vars.json diupdate untuk key: ' +
        Object.keys(partial).join(', ')
    );
  } catch (err) {
    logger.error(
      '[ResellerTarget] Gagal menulis .vars.json saat updateResellerTargetVars:',
      err.message || err
    );
  }
}


// Helper: ambil tanggal & jam sesuai TIME_ZONE (bukan jam server)
function getTimeInConfiguredTimeZone() {
  const now = new Date();

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;

  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);

  const dateKey = `${year}-${month}-${day}`; // YYYY-MM-DD di timezone kita

  return { dateKey, hour, minute };
}

// ===== Tambahan: helper sisa hari akun (berdasarkan TANGGAL, bukan jam) =====
function getAccountDaysLeft(expiresAtMs) {
  if (!expiresAtMs) return null; // kalau nggak ada expires_at

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

  const diffDays = Math.round(
    (expDayStart - todayStart) / (1000 * 60 * 60 * 24)
  );

  return diffDays;
}
// ===== Akhir helper =====

// State sederhana untuk admin (edit nama / harga server)
const adminState = {};

// State sesi pengumuman (broadcast) dari menu admin
// Key = id admin (number), value = { step, target, message }
const broadcastSessions = {};

// Ringkasan broadcast terakhir (hanya disimpan di memori, hilang kalau bot restart)
let lastBroadcastInfo = null;

// Inisialisasi bot
const bot = new Telegraf(BOT_TOKEN || 'placeholder:token_not_configured');

// ==== Helper: konversi Markdown lama -> HTML aman ====
function mdToHtml(text) {
  if (text == null) return '';
  let escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // `code`
  escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  // *bold*
  escaped = escaped.replace(/\*([^*]+)\*/g, '<b>$1</b>');

  return escaped;
}

// Patch ctx.reply supaya semua parse_mode: 'Markdown' diubah ke HTML
bot.use((ctx, next) => {
  const origReply = ctx.reply.bind(ctx);
  ctx.reply = (text, extra = {}) => {
    if (extra && extra.parse_mode === 'Markdown') {
      const htmlText = mdToHtml(text);
      const newExtra = { ...extra, parse_mode: 'HTML' };
      return origReply(htmlText, newExtra);
    }
    return origReply(text, extra);
  };
  return next();
});

// Patch bot.telegram.sendMessage & editMessageText juga
const origSendMessage = bot.telegram.sendMessage.bind(bot.telegram);
bot.telegram.sendMessage = (chatId, text, extra = {}) => {
  if (extra && extra.parse_mode === 'Markdown') {
    const htmlText = mdToHtml(text);
    const newExtra = { ...extra, parse_mode: 'HTML' };
    return origSendMessage(chatId, htmlText, newExtra);
  }
  return origSendMessage(chatId, text, extra);
};

const origEditMessageText = bot.telegram.editMessageText.bind(bot.telegram);
bot.telegram.editMessageText = (chatId, messageId, inlineMessageId, text, extra = {}) => {
  if (extra && extra.parse_mode === 'Markdown') {
    const htmlText = mdToHtml(text);
    const newExtra = { ...extra, parse_mode: 'HTML' };
    return origEditMessageText(chatId, messageId, inlineMessageId, htmlText, newExtra);
  }
  return origEditMessageText(chatId, messageId, inlineMessageId, text, extra);
};

// =====================================================
// Anti double-click / anti spam tombol inline
// =====================================================
const cbRateLimit = new Map();     // userId -> last timestamp
const cbSameDataLock = new Map();  // `${userId}:${data}` -> last timestamp

// Bersihkan cache biar tidak numpuk di memori
setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of cbRateLimit) {
    if (now - ts > 5 * 60 * 1000) cbRateLimit.delete(k); // >5 menit
  }
  for (const [k, ts] of cbSameDataLock) {
    if (now - ts > 5 * 60 * 1000) cbSameDataLock.delete(k);
  }
}, 5 * 60 * 1000);

// Middleware callback_query (jalan untuk semua tombol inline)
bot.on('callback_query', async (ctx, next) => {
  try {
    const userId = ctx.from?.id;
    const data = ctx.callbackQuery?.data || '';
    const now = Date.now();

    if (!userId) return next();

    // Rate limit umum: cegah spam klik terlalu cepat
    const lastAny = cbRateLimit.get(userId) || 0;
    if (now - lastAny < 700) {
      await ctx.answerCbQuery('Pelan-pelan ya…');
      return;
    }
    cbRateLimit.set(userId, now);

    // Lock tombol yang sama: cegah klik tombol yang sama berulang
    const key = `${userId}:${data}`;
    const lastSame = cbSameDataLock.get(key) || 0;
    if (now - lastSame < 1500) {
      await ctx.answerCbQuery('Sedang diproses…');
      return;
    }
    cbSameDataLock.set(key, now);

    return next();
  } catch (e) {
    // kalau answerCbQuery gagal, jangan bikin bot crash
    try { await ctx.answerCbQuery(); } catch (_) {}
    return next();
  }
});// =====================================================
// Helper menu bersih (edit/replace + hapus menu lama)
// =====================================================
const lastMenuMsgId = new Map(); // userId -> message_id bot terakhir (menu)

async function sendCleanMenu(ctx, text, extra = {}) {
  const userId = ctx.from?.id;
  if (!userId) return;

  // 1) Kalau datang dari callback (klik tombol) -> EDIT pesan yang sama
  if (ctx.callbackQuery && ctx.update?.callback_query?.message) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...extra });
      // simpan id pesan yg sedang diedit
      const mid = ctx.update.callback_query.message.message_id;
      lastMenuMsgId.set(userId, mid);
      return;
    } catch (e) {
      // kalau gagal edit (misal pesan terlalu lama / beda jenis)
      // lanjut ke opsi hapus+kirim
    }
  }

  // 2) Kalau bukan callback (misal /menu, /start) -> hapus menu bot sebelumnya
  const prevId = lastMenuMsgId.get(userId);
  if (prevId) {
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, prevId);
    } catch (e) {
      // bisa gagal kalau:
      // - di grup (bot gak punya hak delete)
      // - pesan sudah lama
      // biarin aja
    }
  }

  // 3) kirim menu baru
  const sent = await ctx.reply(text, { parse_mode: 'HTML', ...extra });
  if (sent?.message_id) lastMenuMsgId.set(userId, sent.message_id);
}

// === Helper notifikasi singkat ke user (cbQuery / edit menu) ===
async function toast(ctx, text, { alert = false } = {}) {
  try { await ctx.answerCbQuery(text, { show_alert: alert }); } catch (_) {}
}
async function toastError(ctx, text) {
  await toast(ctx, `⚠️ ${text}`);
}
async function showErrorOnMenu(ctx, htmlText) {
  await sendCleanMenu(ctx, `⚠️ <b>Terjadi kesalahan</b>\n${htmlText}`, { parse_mode: 'HTML' });
}

// === Template pesan standar (HTML) ===
function msgSuccess(t){ return `✅ <b>Berhasil</b>\n${t}`; }
function msgError(t){ return `❌ <b>Gagal</b>\n${t}`; }
function msgInfo(t){ return `ℹ️ <b>Info</b>\n${t}`; }
function rupiah(n) {
  return `Rp${Number(n || 0).toLocaleString('id-ID')}`;
}

async function getUserSaldo(db, userId) {
  return await new Promise((resolve) => {
    db.get('SELECT saldo FROM users WHERE user_id = ?', [userId], (e, r) => {
      if (e) return resolve(null);
      resolve(r ? Number(r.saldo || 0) : null);
    });
  });
}

async function notifyTopupSuccess({ bot, db, userId, baseAmount, bonusAmount, percent, ref, method }) {
  const total = Number(baseAmount || 0) + Number(bonusAmount || 0);
  const saldoNow = await getUserSaldo(db, userId);

  // Nama user untuk notif grup (aman kalau gagal ambil)
  let who = `UID:${userId}`;
  try {
    const chat = await bot.telegram.getChat(userId);
    if (chat?.username) who = `@${chat.username}`;
    else if (chat?.first_name) who = chat.first_name;
  } catch {}

  // 1) Notif ke user (rapi + informatif)
  const lines = [];
  lines.push(`✅ <b>TOPUP BERHASIL</b>`);
  lines.push(`Metode: <b>${method || 'QRIS'}</b>`);
  lines.push(`Nominal: <b>${rupiah(baseAmount)}</b>`);
  if (Number(bonusAmount) > 0) {
    lines.push(`Bonus: <b>${rupiah(bonusAmount)}</b> <i>(${percent || 0}%)</i>`);
  }
  lines.push(`Total masuk: <b>${rupiah(total)}</b>`);
  if (saldoNow != null) lines.push(`Saldo sekarang: <b>${rupiah(saldoNow)}</b>`);
  lines.push(`Ref: <code>${ref}</code>`);
  lines.push(`\nTerima kasih 🙏`);

  try {
    await bot.telegram.sendMessage(userId, lines.join('\n'), { parse_mode: 'HTML' });
  } catch {}

  // 2) Notif ke grup (kalau diaktifkan)
  try {
    if (NOTIF_TOPUP_GROUP && GROUP_ID) {
      const gLines = [];
      gLines.push(`✅ <b>Topup masuk</b>`);
      gLines.push(`User: <b>${who}</b>`);
      gLines.push(`Nominal: <b>${rupiah(baseAmount)}</b>${Number(bonusAmount) > 0 ? ` + bonus <b>${rupiah(bonusAmount)}</b>` : ''}`);
      gLines.push(`Ref: <code>${ref}</code>`);
      await bot.telegram.sendMessage(GROUP_ID, gLines.join('\n'), { parse_mode: 'HTML' });
    }
  } catch {}
}

async function notifyTopupExpired({ bot, userId, ref }) {
  const txt =
    `⏰ <b>QRIS Expired</b>\n` +
    `Ref: <code>${ref}</code>\n` +
    `QRIS kamu sudah lewat batas waktu.\n` +
    `Silakan buat QRIS baru dari menu topup.`;
  try { await bot.telegram.sendMessage(userId, txt, { parse_mode: 'HTML' }); } catch {}
}

// ===== Helper: indikator menunggu saat proses panjang =====
async function startWaiting(ctx, text = '⏳ Sedang membuat akun...') {
  const m = await ctx.reply(text, { parse_mode: 'Markdown' }).catch(() => null);
  let dots = 0;
  const timer = setInterval(async () => {
    dots = (dots + 1) % 4;
    try {
      if (m) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          m.message_id,
          undefined,
          text + '.'.repeat(dots),
          { parse_mode: 'Markdown' }
        );
      }
      await ctx.sendChatAction('typing').catch(() => {});
    } catch (_) {}
  }, 1200);
  return {
    async stop(finalText = null, keep = false) {
      clearInterval(timer);
      if (!m) return;
      try {
        if (finalText) {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            m.message_id,
            undefined,
            finalText,
            { parse_mode: 'Markdown' }
          );
        } else if (!keep) {
          await ctx.telegram.deleteMessage(ctx.chat.id, m.message_id);
        }
      } catch (_) {}
    }
  };
}

// === Wizard state untuk flow create/trial (1 pesan aktif) ===
const flow = new Map(); // userId -> { mode:'trial'|'create', type:'ssh'|'vmess'|'vless'|'trojan'|'shadowsocks', step, payload:{} }

function startFlow(userId, mode, type) {
  flow.set(userId, { mode, type, step: 'pick_server', payload: {} });
}
function endFlow(userId) { flow.delete(userId); }
function getFlow(userId) { return flow.get(userId) || null; }


// Render pilih server
async function renderPickServer(ctx) {
  const userId = ctx.from.id;
  const st = getFlow(userId); if (!st) return;

  try {
    db.all(`SELECT id, nama_server FROM Server ORDER BY id ASC`, [], async (err, rows) => {
      if (err || !rows || rows.length === 0) {
        return showErrorOnMenu(ctx, 'Server tidak tersedia.');
      }
      const buttons = rows.map(s => [{ text: s.nama_server, callback_data: `flow_pick_server:${s.id}` }]);
      buttons.push([{ text: '🔙 Kembali', callback_data: 'send_main_menu' }]);

      await sendCleanMenu(ctx,
        `<b>${st.mode === 'trial' ? 'Trial' : 'Buat Akun'} ${st.type.toUpperCase()}</b>\nPilih server:`,
        { parse_mode:'HTML', reply_markup:{ inline_keyboard: buttons } }
      );
    });
  } catch {
    return showErrorOnMenu(ctx, 'Gagal memuat daftar server.');
  }
}

// Render konfirmasi
async function renderConfirm(ctx) {
  const userId = ctx.from.id;
  const st = getFlow(userId); if (!st) return;

  const { serverId, username } = st.payload;
  const trialCfg = await getTrialConfig();
  const days = Math.max(1, Math.ceil(trialCfg.durationHours / 24));

  const srow = await new Promise((resolve)=> {
    db.get(`SELECT nama_server FROM Server WHERE id=?`, [serverId], (e, r) => resolve(r || null));
  });

  const namaServer = srow?.nama_server || `Server #${serverId}`;

  const msg = [
    `<b>Konfirmasi Trial ${st.type.toUpperCase()}</b>`,
    `Server   : <b>${namaServer}</b>`,
    `Username : <code>${username}</code>`,
    `Durasi   : ~<b>${trialCfg.durationHours} jam</b> (${days} hari dibulatkan)`,
  ].join('\n');

  const kb = [
    [{ text: '✅ Konfirmasi', callback_data: 'flow_confirm' }],
    [{ text: '🔙 Ubah Server', callback_data: 'flow_back_server' }],
    [{ text: '❌ Batal', callback_data: 'flow_cancel' }],
  ];

  await sendCleanMenu(ctx, msg, { parse_mode:'HTML', reply_markup:{ inline_keyboard: kb } });
}

// =====================================================
// Pengaman transaksi penting (create / trial / renew / topup)
// Mencegah dobel proses walau callback terkirim ulang
// =====================================================
const txLock = new Map(); // userId -> { action, until }

function isTxAction(data = '') {
  return (
    data.startsWith('create_') ||   // create_ssh/vmess/vless/trojan...
    data.startsWith('renew_')  ||   // renew_ssh/vmess/vless/trojan...
    data.startsWith('trial_')  ||   // trial_ssh/vmess/vless/trojan...
    data === 'topup_manual'    ||   // topup manual QRIS
    data === 'topup_saldo'          // kalau suatu saat kamu hidupkan lagi
  );
}

bot.on('callback_query', async (ctx, next) => {
  const userId = ctx.from?.id;
  const data = ctx.callbackQuery?.data || '';
  if (!userId || !isTxAction(data)) return next();

  const now = Date.now();
  const lock = txLock.get(userId);

  // kalau masih dalam lock window, hentikan proses
  if (lock && now < lock.until) {
    await ctx.answerCbQuery(`⏳ Sedang diproses (${lock.action})`, { show_alert: false });
    return;
  }

  // set lock 25 detik (cukup untuk create/renew/trial/topup)
  txLock.set(userId, { action: data, until: now + 25 * 1000 });

  try {
    await next();
  } finally {
    // lepas lock setelah handler selesai (normalnya cepat)
    // tapi kalau handler async lama, lock tetap aman karena ada auto-timeout
    txLock.delete(userId);
  }
});

let ADMIN_USERNAME = '';

// Ubah ADMIN_IDS_RAW jadi array angka
const adminIds = Array.isArray(ADMIN_IDS_RAW)
  ? ADMIN_IDS_RAW.map((id) => Number(id))
  : String(ADMIN_IDS_RAW)
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));

// Alias lama supaya kode yang pakai ADMIN_IDS masih jalan
const ADMIN_IDS = adminIds;

logger.info(`Admin IDs: ${adminIds.join(', ')}`);
logger.info('Bot initialized');

// ====== FUNGSI INFO LISENSI BOT ======
function getLicenseInfo() {
  if (!EXPIRE_DATE) return null;

  // Anggap EXPIRE_DATE dalam format "YYYY-MM-DD"
  const now = new Date();
  const expire = new Date(EXPIRE_DATE + 'T23:59:59');

  const diffMs   = expire - now;
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24)); // dibulatkan ke atas

  return { expire, daysLeft };
}
// ====== AKHIR FUNGSI INFO LISENSI ======

// === MIDDLEWARE KUNCI LISENSI ===
bot.use(async (ctx, next) => {
  // Kalau EXPIRE_DATE belum di-set → anggap free, jangan blokir
  if (!EXPIRE_DATE) {
    return next();
  }

  const info = getLicenseInfo();
  if (!info) {
    return next();
  }

  // Kalau lisensi masih aktif → lanjut ke handler berikutnya
  if (info.daysLeft > 0) {
    return next();
  }

  // Kalau yang akses adalah MASTER → tetap boleh lanjut (biar bisa /addhari dll)
  if (ctx.from && ctx.from.id === MASTER_ID) {
    return next();
  }

  // Selain MASTER: blokir, kasih info lisensi habis
  try {
    await ctx.reply(
      '⛔ *Bot sementara nonaktif karena lisensi sudah habis.*\n' +
      'Silakan hubungi owner untuk perpanjang.',
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    // kalau gagal kirim pesan, diamkan saja
  }

  // Jangan lanjut ke handler lain
  return;
});

// Update tanggal lisensi di memori & di file .vars.json
function setLicenseExpireDate(newDateStr) {
  EXPIRE_DATE = newDateStr;
  try {
    // update object vars di memori
    vars.EXPIRE_DATE = newDateStr;

    // tulis ulang ke file
    fs.writeFileSync(VARS_PATH, JSON.stringify(vars, null, 2));

    logger.info(`EXPIRE_DATE updated to ${newDateStr} in .vars.json`);
  } catch (e) {
    logger.error('Gagal mengupdate EXPIRE_DATE di .vars.json:', e.message);
  }
}

// Simpan timezone ke .vars.json
function saveTimeZoneConfig() {
  try {
    vars.TIME_ZONE = TIME_ZONE;
    fs.writeFileSync(VARS_PATH, JSON.stringify(vars, null, 2));
    logger.info(`TIME_ZONE disimpan: ${TIME_ZONE}`);
  } catch (e) {
    logger.error('Gagal menyimpan TIME_ZONE ke .vars.json:', e.message || e);
  }
}

// Simpan pengaturan auto-backup ke .vars.json
function saveAutoBackupConfig() {
  try {
    // update object vars di memori
    vars.AUTO_BACKUP_ENABLED = AUTO_BACKUP_ENABLED;
    vars.AUTO_BACKUP_INTERVAL_HOURS = AUTO_BACKUP_INTERVAL_HOURS;

    // tulis ulang ke file
    fs.writeFileSync(VARS_PATH, JSON.stringify(vars, null, 2));

    logger.info(
      `AUTO_BACKUP disimpan: enabled=${AUTO_BACKUP_ENABLED}, interval=${AUTO_BACKUP_INTERVAL_HOURS} jam`
    );
  } catch (e) {
    logger.error('Gagal menyimpan AUTO_BACKUP ke .vars.json:', e.message);
  }
}

// Simpan pengaturan pengingat expired ke .vars.json
function saveExpiryReminderConfig() {
  try {
    // update object vars di memori
    vars.EXPIRY_REMINDER_ENABLED = EXPIRY_REMINDER_ENABLED;
    vars.EXPIRY_REMINDER_HOUR = EXPIRY_REMINDER_HOUR;
    vars.EXPIRY_REMINDER_MINUTE = EXPIRY_REMINDER_MINUTE;
    vars.EXPIRY_REMINDER_DAYS_BEFORE = EXPIRY_REMINDER_DAYS_BEFORE;

    // tulis ulang ke file
    fs.writeFileSync(VARS_PATH, JSON.stringify(vars, null, 2));

    logger.info(
      `EXPIRY_REMINDER disimpan: enabled=${EXPIRY_REMINDER_ENABLED}, time=${EXPIRY_REMINDER_HOUR}:${String(
        EXPIRY_REMINDER_MINUTE
      ).padStart(2, '0')}, H-${EXPIRY_REMINDER_DAYS_BEFORE}`
    );
  } catch (e) {
    logger.error(
      'Gagal menyimpan pengingat expired ke .vars.json:',
      e.message
    );
  }
}

// Start / restart scheduler auto-backup
function restartAutoBackupScheduler() {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }

  if (!AUTO_BACKUP_ENABLED || AUTO_BACKUP_INTERVAL_HOURS <= 0) {
    logger.info('Auto-backup nonaktif atau interval tidak valid, scheduler tidak jalan.');
    return;
  }

  const intervalMs = AUTO_BACKUP_INTERVAL_HOURS * 60 * 60 * 1000;

  autoBackupTimer = setInterval(() => {
    sendAutoBackup(`backup otomatis tiap ${AUTO_BACKUP_INTERVAL_HOURS} jam`).catch((err) => {
      logger.error('❌ Gagal menjalankan backup otomatis:', err);
    });
  }, intervalMs);

  logger.info(
    `Auto-backup aktif setiap ${AUTO_BACKUP_INTERVAL_HOURS} jam (~${intervalMs / 1000} detik).`
  );
}

(async () => {
  try {
    const adminId = Array.isArray(adminIds) ? adminIds[0] : adminIds;
    const chat = await bot.telegram.getChat(adminId);
    ADMIN_USERNAME = chat.username ? `@${chat.username}` : 'Admin';
    logger.info(`Admin username detected: ${ADMIN_USERNAME}`);
  } catch (e) {
    ADMIN_USERNAME = 'Admin';
    logger.warn('Tidak bisa ambil username admin otomatis.');
  }
})();
/////
const db = new sqlite3.Database('./sellvpn.db', (err) => {
  if (err) {
    logger.error('Kesalahan koneksi SQLite3:', err.message);
  } else {
    logger.info('Terhubung ke SQLite3');
  }
});

// ============================================================================
// SECTION: PAYMENT - DATABASE TABLES
// - pending_deposits  : topup manual via QRIS
// - qris_payments     : topup otomatis (OrderKuota QRIS)
// ============================================================================
db.run(`CREATE TABLE IF NOT EXISTS pending_deposits (
  unique_code TEXT PRIMARY KEY,
  user_id INTEGER,
  amount INTEGER,
  original_amount INTEGER,
  timestamp INTEGER,
  status TEXT,
  qr_message_id INTEGER
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel pending_deposits:', err.message);
  }
});

// =================== AUTO TOPUP QRIS (MODEL MUTASI: pending_deposits) ===================

// Simpan deposit yang sedang menunggu pembayaran (di memory)
global.pendingDeposits = global.pendingDeposits || {};

// Anti dobel proses di PM2 cluster: hanya instance 0 yang polling
const IS_PRIMARY_INSTANCE =
  !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';

let lastPollTime = 0;
const POLL_INTERVAL = 10000;          // 10 detik (mirip temanmu)
const DEPOSIT_EXPIRE_MS = 5 * 60 * 1000; // 5 menit

function parseKreditFromResponse(text) {
  // format dari temanmu: ada "Kredit: 10.123"
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

async function markDepositExpired(uniqueCode, bot, db, logger) {
  await new Promise((resolve) => {
    db.run(
      `UPDATE pending_deposits SET status=? WHERE unique_code=? AND status=?`,
      ['expired', uniqueCode, 'pending'],
      () => resolve()
    );
  });

  const d = global.pendingDeposits[uniqueCode];
  if (d) {
    try {
      const text =
  `⏰ <b>QRIS EXPIRED</b>\n` +
  `━━━━━━━━━━━━━━━━\n` +
  `Pembayaran tidak kami terima dalam batas waktu.\n` +
  `Silakan buat QRIS baru dari menu topup.\n` +
  `━━━━━━━━━━━━━━━━\n` +
  `Ref: <code>${uniqueCode}</code>`;

      await bot.telegram.sendMessage(d.userId, text, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🏠 Menu Utama', callback_data: 'send_main_menu' }],
          ],
        },
      });
    } catch {}

  }

  delete global.pendingDeposits[uniqueCode];
}

async function creditDeposit(uniqueCode, bot, db, logger) {
  const d = global.pendingDeposits[uniqueCode];
  if (!d) return;

  const now = Date.now();

  // SALDO MASUK: pakai nominal topup asli (tanpa angka unik)
  // Kalau kamu mau saldo masuk = yang dibayar, ubah jadi: const credit = d.amount;
  const credit = d.originalAmount;

  await new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE TRANSACTION');

      // Pastikan hanya proses sekali (status masih pending)
      db.run(
        `UPDATE pending_deposits SET status=? WHERE unique_code=? AND status=?`,
        ['paid', uniqueCode, 'pending'],
        function (err1) {
          if (err1 || this.changes === 0) {
            db.run('ROLLBACK');
            return err1 ? reject(err1) : resolve();
          }

          db.run(
            `UPDATE users SET saldo = saldo + ? WHERE user_id = ?`,
            [credit, d.userId],
            (err2) => {
              if (err2) {
                db.run('ROLLBACK');
                return reject(err2);
              }

              db.run(
                `INSERT INTO transactions (user_id, amount, type, reference_id, timestamp)
                 VALUES (?, ?, ?, ?, ?)`,
                [d.userId, credit, 'qris_auto_topup', uniqueCode, now],
                (err3) => {
                  if (err3) {
                    db.run('ROLLBACK');
                    return reject(err3);
                  }
                  db.run('COMMIT', (err4) => (err4 ? reject(err4) : resolve()));
                }
              );
            }
          );
        }
      );
    });
  });

  try {
    const rupiah = (n) => `Rp${Number(n || 0).toLocaleString('id-ID')}`;
    const waktu = new Date().toLocaleString('id-ID', { timeZone: TIME_ZONE });

    const text =
      `✅ <b>TOPUP BERHASIL</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `💰 <b>Saldo Masuk</b> : <b>${rupiah(credit)}</b>\n` +
      `🧾 <b>Ref</b>        : <code>${uniqueCode}</code>\n` +
      `🕒 <b>Waktu</b>      : ${waktu}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `Terima kasih 🙏`;

    await bot.telegram.sendMessage(d.userId, text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏠 Menu Utama', callback_data: 'send_main_menu' }],
        ],
      },
    });
  } catch {}


  delete global.pendingDeposits[uniqueCode];
}

async function pollMutasi(bot, db, logger, axios) {
          // ===== ANTI SPAM 469 (COOLDOWN) =====
  global.mutasiBlockedUntil = global.mutasiBlockedUntil || 0;
  if (Date.now() < global.mutasiBlockedUntil) return;

  const now = Date.now();
  if (now - lastPollTime < POLL_INTERVAL) return;
  lastPollTime = now;

  const pendingList = Object.entries(global.pendingDeposits)
    .filter(([_, d]) => d.status === 'pending');

  if (pendingList.length === 0) return;

  try {
    const payload = buildPayload();
    const res = await axios.post(API_URL, payload, { headers, timeout: 10000 });

    const kredits = parseKreditFromResponse(res.data);

    for (const [uniqueCode, d] of pendingList) {
      const expiresAt = d.expiresAt || (d.timestamp ? (d.timestamp + (5 * 60 * 1000)) : 0);
      if (expiresAt && now > expiresAt) {
      await markDepositExpired(uniqueCode, bot, db, logger);
      continue;
      }


      // cocokkan nominal yang harus dibayar
      if (kredits.includes(d.amount)) {
        await creditDeposit(uniqueCode, bot, db, logger);
      }
    }
 } catch (e) {
  const status = e?.response?.status;
  const msg = e?.response?.data?.message || e?.message || e;

  if (status === 469) {
    global.mutasiBlockedUntil = Date.now() + (30 * 60 * 1000); // 30 menit
    logger.error(`❌ Mutasi ditolak (469): ${msg}. Cooldown 30 menit.`);
    return;
  }

  logger.error(`❌ Poll mutasi error (${status || 'no-status'}):`, msg);
}
  
  }


function startAutoTopupMutasi(bot, db, logger, axios) {
  if (!IS_PRIMARY_INSTANCE) {
    logger.info('ℹ️ Auto-topup mutasi nonaktif di instance non-primary (PM2 cluster).');
    return;
  }

  setInterval(() => pollMutasi(bot, db, logger, axios), 2000);
  logger.info('✅ Auto-topup QRIS (mutasi) aktif.');
}

// ======================= END SECTION: PAYMENT - DATABASE TABLES =============

// ============================================================================


db.run(`CREATE TABLE IF NOT EXISTS Server (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT,
  auth TEXT,
  harga INTEGER,
  nama_server TEXT,
  quota INTEGER,
  iplimit INTEGER,
  batas_create_akun INTEGER,
  total_create_akun INTEGER,
  is_reseller_only INTEGER DEFAULT 0
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel Server:', err.message);
  } else {
    logger.info('Server table created or already exists');
  }
});

db.run("UPDATE Server SET total_create_akun = 0 WHERE total_create_akun IS NULL", function(err) {
  if (err) {
    logger.error('Error fixing NULL total_create_akun:', err.message);
  } else {
    if (this.changes > 0) {
      logger.info(`✅ Fixed ${this.changes} servers with NULL total_create_akun`);
    }
  }
});

db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE,
  saldo INTEGER DEFAULT 0,
  CONSTRAINT unique_user_id UNIQUE (user_id)
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel users:', err.message);
  } else {
    logger.info('Users table created or already exists');
  }
});

// Upgrade tabel users: tambahkan kolom flag_status dan flag_note jika belum ada
db.get('SELECT flag_status FROM users LIMIT 1', (err, row) => {
  if (err && err.message && err.message.includes('no such column')) {
    logger.info('Menambahkan kolom flag_status dan flag_note ke tabel users...');

    db.run(
      "ALTER TABLE users ADD COLUMN flag_status TEXT DEFAULT 'NORMAL'",
      (err2) => {
        if (err2) {
          logger.error('Kesalahan menambahkan kolom flag_status:', err2.message);
        } else {
          logger.info('Kolom flag_status berhasil ditambahkan ke tabel users');
        }
      }
    );

    db.run('ALTER TABLE users ADD COLUMN flag_note TEXT', (err3) => {
      if (err3) {
        logger.error('Kesalahan menambahkan kolom flag_note:', err3.message);
      } else {
        logger.info('Kolom flag_note berhasil ditambahkan ke tabel users');
      }
    });
  }
});


db.run(`CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  amount INTEGER,
  type TEXT,
  reference_id TEXT,
  timestamp INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel transactions:', err.message);
  } else {
    logger.info('Transactions table created or already exists');

    // Add reference_id column if it doesn't exist
    db.get("PRAGMA table_info(transactions)", (err, rows) => {
      if (err) {
        logger.error('Kesalahan memeriksa struktur tabel:', err.message);
        return;
      }

      db.get("SELECT * FROM transactions WHERE reference_id IS NULL LIMIT 1", (err, row) => {
        if (err && err.message.includes('no such column')) {
          // Column doesn't exist, add it
          db.run("ALTER TABLE transactions ADD COLUMN reference_id TEXT", (err) => {
            if (err) {
              logger.error('Kesalahan menambahkan kolom reference_id:', err.message);
            } else {
              logger.info('Kolom reference_id berhasil ditambahkan ke tabel transactions');
            }
          });
        } else if (row) {
          // Update existing transactions with reference_id
          db.all("SELECT id, user_id, type, timestamp FROM transactions WHERE reference_id IS NULL", [], (err, rows) => {
            if (err) {
              logger.error('Kesalahan mengambil transaksi tanpa reference_id:', err.message);
              return;
            }

            rows.forEach(row => {
              const referenceId = `account-${row.type}-${row.user_id}-${row.timestamp}`;
              db.run("UPDATE transactions SET reference_id = ? WHERE id = ?", [referenceId, row.id], (err) => {
                if (err) {
                  logger.error(`Kesalahan mengupdate reference_id untuk transaksi ${row.id}:`, err.message);
                } else {
                  logger.info(`Berhasil mengupdate reference_id untuk transaksi ${row.id}`);
                }
              });
            });
          });
        }
      });
    });
  }
});

function recordSaldoTransaction(userId, amount, type, referenceId) {
  db.run(
    `INSERT INTO transactions (user_id, amount, type, reference_id, timestamp)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, amount, type, referenceId || null, Date.now()],
    (err) => {
      if (err) {
        logger.error(
          'Kesalahan mencatat transaksi saldo:',
          err.message
        );
      }
    }
  );
}

db.run(`CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  type TEXT,
  server_id INTEGER,
  created_at INTEGER,
  expires_at INTEGER
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel accounts:', err.message);
  } else {
    logger.info('Accounts table created or already exists');
  }
});

// Buat index untuk mempercepat query yang sering dipakai
db.run(
  'CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id)',
  (err) => {
    if (err) {
      logger.error(
        'Kesalahan membuat index idx_users_user_id:',
        err.message
      );
    } else {
      logger.info('Index idx_users_user_id siap dipakai');
    }
  }
);

db.run(
  'CREATE INDEX IF NOT EXISTS idx_tx_user_time ON transactions(user_id, timestamp)',
  (err) => {
    if (err) {
      logger.error(
        'Kesalahan membuat index idx_tx_user_time:',
        err.message
      );
    } else {
      logger.info('Index idx_tx_user_time siap dipakai');
    }
  }
);

db.run(
  'CREATE INDEX IF NOT EXISTS idx_tx_type_time ON transactions(type, timestamp)',
  (err) => {
    if (err) {
      logger.error(
        'Kesalahan membuat index idx_tx_type_time:',
        err.message
      );
    } else {
      logger.info('Index idx_tx_type_time siap dipakai');
    }
  }
);

db.run(
  'CREATE INDEX IF NOT EXISTS idx_accounts_user_time ON accounts(user_id, expires_at)',
  (err) => {
    if (err) {
      logger.error(
        'Kesalahan membuat index idx_accounts_user_time:',
        err.message
      );
    } else {
      logger.info('Index idx_accounts_user_time siap dipakai');
    }
  }
);

const adminTrialTemp = {}; // key: adminId, value: config trial sementara

const userState = {};
logger.info('User state initialized');
// Pesan standar untuk akses ditolak
const NO_ACCESS_MESSAGE = '🚫 Kamu tidak punya akses untuk perintah ini.';
// Pesan standar untuk perintah khusus pemilik bot (MASTER)
const MASTER_ONLY_MESSAGE =
  '⚠️ <b>Perintah ini hanya bisa digunakan oleh pemilik bot (MASTER).</b>';

// Pastikan perintah hanya dipakai di private chat
function ensurePrivateChat(ctx) {
  const chatType = ctx.chat?.type;

  if (chatType && chatType !== 'private') {
    ctx.reply(
      '📩 Perintah ini hanya bisa digunakan di chat pribadi dengan bot.\n' +
      'Silakan klik nama bot ini lalu tekan tombol <b>Start</b>.',
      { parse_mode: 'HTML' }
    ).catch((e) => {
      console.error('❌ Gagal kirim instruksi private chat:', e.message);
    });

    return false;
  }

  return true;
}

bot.command(['start', 'menu'], async (ctx) => {
        // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  logger.info('Start or Menu command received');
  const chatType = ctx.chat?.type;
  if (chatType && chatType !== 'private') {
    try {
      await ctx.reply(
        '📩 Untuk menggunakan bot ini, silakan buka chat pribadi dengan bot.\n' +
        'Klik nama bot ini lalu tekan tombol <b>Start</b>.',
        { parse_mode: 'HTML' }
      );
    } catch (e) {
      console.error('❌ Gagal kirim pesan instruksi di grup:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  db.get('SELECT * FROM users WHERE user_id = ?', [userId], (err, row) => {
    if (err) {
      logger.error('Kesalahan saat memeriksa user_id:', err.message);
      return;
    }

    if (row) {
      logger.info(`User ID ${userId} sudah ada di database`);
    } else {
      db.run('INSERT INTO users (user_id) VALUES (?)', [userId], (err) => {
        if (err) {
          logger.error('Kesalahan saat menyimpan user_id:', err.message);
        } else {
          logger.info(`User ID ${userId} berhasil disimpan`);
        }
      });
    }
  });

  await sendMainMenu(ctx);
});

// ============================================================================
// SECTION: PAYMENT - UI TOPUP SALDO OTOMATIS (QRIS)
// - openTopupQrisMenu : set state qris_topup_nominal + kirim instruksi nominal
// ============================================================================
async function openTopupQrisMenu(ctx) {
  if (!ensurePrivateChat(ctx)) return;

  const chatId = ctx.chat.id;

  // Simpan state: user ini lagi diminta isi nominal topup QRIS
  userState[chatId] = { step: 'qris_topup_nominal' };

  await ctx.reply(
    '💳 <b>Topup Saldo Otomatis (QRIS)</b>\n\n' +
      `Minimal: <b>Rp${QRIS_AUTO_TOPUP_MIN}</b>\n` +
      `Maksimal: <b>Rp${QRIS_AUTO_TOPUP_MAX}</b>\n\n` +
      'Silakan kirim nominal topup dalam angka saja.\n' +
      'Contoh: <code>25000</code>\n\n' +
      'Ketik <code>batal</code> kalau ingin membatalkan.',
    { parse_mode: 'HTML' }
  );
}
// ===== END SECTION: PAYMENT - UI TOPUP SALDO OTOMATIS (QRIS) ================

bot.command('testgroup', async (ctx) => {
        // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  // Hanya admin yang boleh pakai perintah ini
  if (!ctx.from || !adminIds.includes(ctx.from.id)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  try {
    await bot.telegram.sendMessage(GROUP_ID, '✅ Test kirim notif ke grup berhasil!');
    await ctx.reply('✅ Pesan test sudah dikirim ke grup.');
  } catch (e) {
    console.error('Gagal kirim ke grup:', e.message);
    await ctx.reply('❌ Gagal kirim ke grup, cek ID grup & izin bot.');
  }
});


bot.command('daily_report_test', async (ctx) => {
        // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from || ctx.from.id !== MASTER_ID) {
    return ctx.reply(MASTER_ONLY_MESSAGE, { parse_mode: 'HTML' });
}

  await ctx.reply('⏳ Mengirim laporan harian (test)...');
  await sendDailyReport(true);
});

// Command: /expired_reminder_test
// Kirim preview pengingat expired ke si pemanggil command
bot.command('expired_reminder_test', (ctx) => {
        // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from) return;

  const userId = ctx.from.id;
  const chatId = ctx.chat.id;

  // Boleh dibatasi hanya admin/master:
  // if (!ADMIN_IDS.includes(userId)) {
  //   return ctx.reply('⚠️ Perintah ini hanya untuk admin.');
  // }

  ctx.reply('⏳ Membuat preview pengingat expired dari akun kamu...').catch(() => {});

  db.all(
    `
      SELECT username, type, server_id, expires_at
      FROM accounts
      WHERE user_id = ?
      ORDER BY expires_at ASC
      LIMIT 5
    `,
    [userId],
    async (err, rows) => {
      if (err) {
        logger.error('❌ Gagal ambil akun untuk expired_reminder_test:', err.message);
        return ctx.reply('❌ Gagal mengambil data akun untuk preview.');
      }

      let text = '';

      if (!rows || rows.length === 0) {
        // Tidak ada akun milik user ini -> kirim contoh dummy
        text =
          '🔔 <b>Peringatan Akun VPN Akan Berakhir</b>\n\n' +
          'Contoh tampilan pengingat expired akun (dummy):\n\n' +
          '1. <b>VMESS</b> <code>user-vmess</code> (server 1)\n' +
          '   ⏰ Expired: 01-01-2026 20:00\n\n' +
          '2. <b>SSH</b> <code>user-ssh</code> (server 2)\n' +
          '   ⏰ Expired: 02-01-2026 20:00\n\n' +
          'Kalau pengingat jalan beneran, daftar di atas akan diisi pakai akun asli milik kamu.\n\n' +
          'Pengingat otomatis tetap mengikuti pengaturan di menu:\n' +
          '• Jam & menit pengingat\n' +
          '• H-1 / H-2 / H-3.';
      } else {
        // Pakai akun beneran milik user ini
        const akunLines = rows
          .map((acc, idx) => {
            const expLabel = acc.expires_at
              ? new Date(acc.expires_at).toLocaleString('id-ID', {
                  timeZone: TIME_ZONE,
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '-';

            const serverLabel =
              typeof acc.server_id !== 'undefined' && acc.server_id !== null
                ? `server ${acc.server_id}`
                : 'server -';

            return `${idx + 1}. <b>${acc.type || 'AKUN'}</b> <code>${
              acc.username || '-'
            }</code> (${serverLabel})\n   ⏰ Expired: ${expLabel}`;
          })
          .join('\n\n');

        text =
          '🔔 <b>Peringatan Akun VPN Akan Berakhir</b>\n\n' +
          'Ini contoh tampilan pengingat expired pakai beberapa akun milik kamu (maks 5):\n\n' +
          akunLines +
          '\n\n' +
          'Pengingat otomatis nanti isinya mirip seperti ini,\n' +
          'bedanya hanya akun yang tampil adalah yang benar-benar akan expired sesuai pengaturan H-n.\n\n' +
          'Atur jadwal & H-nya di:\n' +
          '• Menu Admin → ⏰ Pengingat Expired.';
      }

      try {
        await bot.telegram.sendMessage(chatId, text, {
          parse_mode: 'HTML',
        });
      } catch (e) {
        logger.error(
          '❌ Gagal kirim expired_reminder_test:',
          e.message || e
        );
      }
    }
  );
});

// Test backup otomatis secara manual
bot.command('backup_auto_test', async (ctx) => {
        // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from || ctx.from.id !== MASTER_ID) {
    return ctx.reply(MASTER_ONLY_MESSAGE, { parse_mode: 'HTML' });
}

  await ctx.reply('⏳ Menjalankan backup otomatis (test)...');
  await sendAutoBackup('backup manual lewat /backup_auto_test');
});

// Command: /lisensi
// Menampilkan info masa aktif bot (expire date & sisa hari)
bot.command('lisensi', async (ctx) => {
        // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
   if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  if (!EXPIRE_DATE) {
    return ctx.reply('ℹ️ EXPIRE_DATE belum di-set di .vars.json untuk bot ini.');
  }

  const info = getLicenseInfo();
  const now  = new Date();

  const nowText = now.toLocaleString('id-ID', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  const expireText = info.expire.toLocaleDateString('id-ID', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  let statusText;
  if (info.daysLeft > 0) {
    statusText = `✅ Lisensi masih aktif.\nSisa: <b>${info.daysLeft}</b> hari lagi.`;
  } else if (info.daysLeft === 0) {
    statusText = '⚠️ Lisensi akan berakhir <b>hari ini</b>.';
  } else {
    statusText = `❌ Lisensi sudah kadaluarsa <b>${Math.abs(info.daysLeft)}</b> hari yang lalu.`;
  }

  const msg =
    '<b>🔐 INFO LISENSI BOT</b>\n\n' +
    `Aktif sampai: <b>${expireText}</b>\n` +
    `${statusText}\n\n` +
    `Waktu sekarang: ${nowText}`;

  return ctx.reply(msg, { parse_mode: 'HTML' });
});
// Command: /health
// Cek kesehatan bot: lisensi, database, backup, laporan harian, pengingat expired
bot.command('health', async (ctx) => {
        // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  const chatId = ctx.chat.id;

  // Cek database
  let dbStatus = '❌ Gagal cek database';
  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT 1 AS ok', [], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    if (row && row.ok === 1) {
      dbStatus = '✅ Terhubung & bisa query';
    } else {
      dbStatus = '⚠️ Respons aneh dari database';
    }
  } catch (e) {
    dbStatus = `❌ Error DB: ${e.message || e}`;
  }

  // Info lisensi
  let licenseStatus = 'ℹ️ EXPIRE_DATE belum di-set di .vars.json';
  if (EXPIRE_DATE) {
    const info = getLicenseInfo();
    const expireText = info.expire.toLocaleDateString('id-ID', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    if (info.daysLeft > 0) {
      licenseStatus = `✅ Aktif, sisa <b>${info.daysLeft}</b> hari (sampai <b>${expireText}</b>)`;
    } else if (info.daysLeft === 0) {
      licenseStatus = `⚠️ Akan berakhir <b>HARI INI</b> (sampai ${expireText})`;
    } else {
      licenseStatus = `❌ Sudah kadaluarsa <b>${Math.abs(
        info.daysLeft
      )}</b> hari yang lalu (terakhir <b>${expireText}</b>)`;
    }
  }

  // Status auto-backup
  const abStatus = AUTO_BACKUP_ENABLED ? '🟢 ON' : '🔴 OFF';
  const abDetail = BACKUP_CHAT_ID
    ? `Interval: <b>${AUTO_BACKUP_INTERVAL_HOURS}</b> jam\n   Tujuan : <code>${BACKUP_CHAT_ID}</code>`
    : '⚠️ BACKUP_CHAT_ID belum di-set (pakai MASTER_ID atau set manual).';

  // Status laporan harian
  const drStatus = DAILY_REPORT_ENABLED ? '🟢 ON' : '🔴 OFF';
  const drTime = `${String(DAILY_REPORT_HOUR).padStart(2, '0')}:${String(
    DAILY_REPORT_MINUTE
  ).padStart(2, '0')}`;

  // Status pengingat expired
  const erStatus = EXPIRY_REMINDER_ENABLED ? '🟢 ON' : '🔴 OFF';
  const erTime = `${String(EXPIRY_REMINDER_HOUR).padStart(2, '0')}:${String(
    EXPIRY_REMINDER_MINUTE
  ).padStart(2, '0')}`;
  const erDays = `H-${EXPIRY_REMINDER_DAYS_BEFORE}`;

  // Uptime process (dalam jam & menit)
  const upSec = Math.floor(process.uptime());
  const upHour = Math.floor(upSec / 3600);
  const upMin = Math.floor((upSec % 3600) / 60);

  const now = new Date();
  const nowText = now.toLocaleString('id-ID', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const msg =
    '<b>🩺 STATUS BOT & SERVER</b>\n\n' +
    `<code>Waktu Sekarang</code>\n` +
    `• ${nowText}\n` +
    `• Uptime bot: <b>${upHour} jam ${upMin} menit</b>\n\n` +
    `<code>Lisensi Bot</code>\n` +
    `• ${licenseStatus}\n\n` +
    `<code>Database</code>\n` +
    `• ${dbStatus}\n\n` +
    `<code>Auto Backup</code>\n` +
    `• Status  : ${abStatus}\n` +
    `• ${abDetail}\n\n` +
    `<code>Laporan Harian</code>\n` +
    `• Status : ${drStatus}\n` +
    `• Jam    : <b>${drTime}</b>\n\n` +
    `<code>Pengingat Expired Akun</code>\n` +
    `• Status : ${erStatus}\n` +
    `• Jadwal : <b>${erTime}</b>\n` +
    `• Mode   : <b>${erDays}</b>\n\n` +
    'Kalau ada yang merah/kuning, cek pengaturan di .vars.json atau menu Admin.';

  try {
    await ctx.reply(msg, { parse_mode: 'HTML' });
  } catch (e) {
    logger.error('❌ Gagal kirim pesan /health:', e.message || e);
  }
});

// Command: /addhari <jumlah_hari>
// Menambah masa aktif lisensi bot
bot.command('addhari', async (ctx) => {
        // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from || ctx.from.id !== MASTER_ID) {
    return ctx.reply(MASTER_ONLY_MESSAGE, { parse_mode: 'HTML' });
}

  const parts = ctx.message.text.trim().split(/\s+/);
  // parts[0] = /addhari
  if (parts.length !== 2) {
       return ctx.reply(
      '⚠️ <b>Format salah.</b>\n' +
      'Contoh yang benar:\n' +
      '<code>/addhari 30</code>',
      { parse_mode: 'HTML' }
    );
  }

  const days = parseInt(parts[1], 10);
  if (isNaN(days) || days <= 0) {
       return ctx.reply(
    '⚠️ <b>Jumlah hari tidak valid.</b>\n' +
    'Harus berupa angka lebih dari 0.\n\n' +
    'Contoh:\n' +
    '<code>/addhari 7</code>',
    { parse_mode: 'HTML' }
  );
}
  
  const oldInfo = getLicenseInfo();
  let baseDate;

  // Kalau sebelumnya sudah ada tanggal lisensi → tambah dari tanggal itu
  if (oldInfo) {
    baseDate = new Date(oldInfo.expire.getTime());
  } else {
    // Kalau belum ada → mulai dari hari ini
    baseDate = new Date();
  }

  // Tambah hari
  baseDate.setDate(baseDate.getDate() + days);
  const newDateStr = baseDate.toISOString().slice(0, 10); // YYYY-MM-DD

  // Simpan ke memori & .vars.json
  setLicenseExpireDate(newDateStr);

  const newInfo = getLicenseInfo();
  const expireText = newInfo.expire.toLocaleDateString('id-ID', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  let oldText = '-';
  if (oldInfo) {
    oldText = oldInfo.expire.toLocaleDateString('id-ID', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  }

  return ctx.reply(
    '<b>✅ Berhasil menambah masa aktif lisensi bot.</b>\n\n' +
    `Sebelumnya : <b>${oldText}</b>\n` +
    `Ditambah   : <b>${days}</b> hari\n` +
    `Tanggal baru: <b>${expireText}</b>\n` +
    `Sisa sekarang: <b>${newInfo.daysLeft}</b> hari`,
    { parse_mode: 'HTML' }
  );
});

// Command: /kuranghari <jumlah_hari>
// Mengurangi masa aktif lisensi bot
bot.command('kuranghari', async (ctx) => {
        // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from || ctx.from.id !== MASTER_ID) {
    return ctx.reply(MASTER_ONLY_MESSAGE, { parse_mode: 'HTML' });
}
  const parts = ctx.message.text.trim().split(/\s+/);
  // parts[0] = /kuranghari
  if (parts.length !== 2) {
      return ctx.reply(
      '⚠️ <b>Format salah.</b>\n' +
      'Contoh yang benar:\n' +
      '<code>/kuranghari 7</code>',
      { parse_mode: 'HTML' }
    );
  }

  const days = parseInt(parts[1], 10);
  if (isNaN(days) || days <= 0) {
    return ctx.reply(
    '⚠️ <b>Jumlah hari tidak valid.</b>\n' +
    'Harus berupa angka lebih dari 0.\n\n' +
    'Contoh:\n' +
    '<code>/kuranghari 7</code>',
    { parse_mode: 'HTML' }
  );
}
  
  const oldInfo = getLicenseInfo();
  let baseDate;

  if (oldInfo) {
    baseDate = new Date(oldInfo.expire.getTime());
  } else {
    // Kalau belum ada tanggal, pakai hari ini sebagai dasar
    baseDate = new Date();
  }

  // Kurangi hari
  baseDate.setDate(baseDate.getDate() - days);
  const newDateStr = baseDate.toISOString().slice(0, 10); // YYYY-MM-DD

  setLicenseExpireDate(newDateStr);

  const newInfo = getLicenseInfo();
  const expireText = newInfo.expire.toLocaleDateString('id-ID', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  let oldText = '-';
  if (oldInfo) {
    oldText = oldInfo.expire.toLocaleDateString('id-ID', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  }

  return ctx.reply(
    '<b>✅ Berhasil mengurangi masa aktif lisensi bot.</b>\n\n' +
    `Sebelumnya : <b>${oldText}</b>\n` +
    `Dikurangi  : <b>${days}</b> hari\n` +
    `Tanggal baru: <b>${expireText}</b>\n` +
    `Sisa sekarang: <b>${newInfo.daysLeft}</b> hari`,
    { parse_mode: 'HTML' }
  );
});

////////////////
// Manual admin command: /addsaldo <user_id> <jumlah>
bot.command('addsaldo', async (ctx) => {
  // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;

  // Hanya admin yang boleh pakai
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  const parts = ctx.message.text.trim().split(/\s+/);
  // parts[0] = /addsaldo
  if (parts.length !== 3) {
    return ctx.reply(
      '⚠️ <b>Format salah.</b>\n\n' +
      'Gunakan:\n' +
      '<code>/addsaldo &lt;user_id&gt; &lt;jumlah&gt;</code>\n\n' +
      'Contoh:\n' +
      '<code>/addsaldo 5439429147 50000</code>',
      { parse_mode: 'HTML' }
    );
  }

  const targetId = Number(parts[1]);
  const amount = Number(parts[2]);

  if (!targetId || !amount || amount <= 0) {
    return ctx.reply(
      '⚠️ <b>user_id atau jumlah tidak valid.</b>\n' +
      'Contoh yang benar:\n' +
      '<code>/addsaldo 5439429147 50000</code>',
      { parse_mode: 'HTML' }
    );
  }

  // Ambil saldo lama user
  db.get(
    'SELECT saldo FROM users WHERE user_id = ?',
    [targetId],
    (err, row) => {
      if (err) {
        logger.error('Error ambil data user:', err.message);
        return ctx.reply('❌ Gagal membaca data user. Coba lagi nanti.');
      }

      if (!row) {
        return ctx.reply(`❌ User dengan ID ${targetId} tidak ditemukan di database.`);
      }

      const oldSaldo = Number(row.saldo || 0);

      // 🎁 BONUS: pakai tier dari .vars.json jika ada
      let bonusEnabled = true;
      if (typeof TOPUP_BONUS_ENABLED !== 'undefined') {
        bonusEnabled = !!TOPUP_BONUS_ENABLED;
      }

      let tier1Min = 50000;
      let tier1Pct = 5;
      let tier2Min = 100000;
      let tier2Pct = 7;
      let tier3Min = 200000;
      let tier3Pct = 10;

      if (typeof TOPUP_BONUS_MIN_AMOUNT !== 'undefined') {
        const v = Number(TOPUP_BONUS_MIN_AMOUNT);
        if (!Number.isNaN(v)) tier1Min = v;
      }
      if (typeof TOPUP_BONUS_PERCENT !== 'undefined') {
        const v = Number(TOPUP_BONUS_PERCENT);
        if (!Number.isNaN(v)) tier1Pct = v;
      }
      if (typeof TOPUP_BONUS_TIER2_MIN !== 'undefined') {
        const v = Number(TOPUP_BONUS_TIER2_MIN);
        if (!Number.isNaN(v)) tier2Min = v;
      }
      if (typeof TOPUP_BONUS_TIER2_PERCENT !== 'undefined') {
        const v = Number(TOPUP_BONUS_TIER2_PERCENT);
        if (!Number.isNaN(v)) tier2Pct = v;
      }
      if (typeof TOPUP_BONUS_TIER3_MIN !== 'undefined') {
        const v = Number(TOPUP_BONUS_TIER3_MIN);
        if (!Number.isNaN(v)) tier3Min = v;
      }
      if (typeof TOPUP_BONUS_TIER3_PERCENT !== 'undefined') {
        const v = Number(TOPUP_BONUS_TIER3_PERCENT);
        if (!Number.isNaN(v)) tier3Pct = v;
      }

      // Pilih tier tertinggi yang lolos
      let bonusPercent = 0;
      if (bonusEnabled) {
        if (amount >= tier3Min && tier3Min > 0 && tier3Pct > 0) {
          bonusPercent = tier3Pct;
        } else if (amount >= tier2Min && tier2Min > 0 && tier2Pct > 0) {
          bonusPercent = tier2Pct;
        } else if (amount >= tier1Min && tier1Min > 0 && tier1Pct > 0) {
          bonusPercent = tier1Pct;
        }
      }

      let bonus = 0;
      if (bonusPercent > 0) {
        // dibulatkan ke bawah
        bonus = Math.floor((amount * bonusPercent) / 100);
      }

      const totalCredit = amount + bonus;
      const newSaldo = oldSaldo + totalCredit;

      // Update saldo user
      db.run(
        'UPDATE users SET saldo = ? WHERE user_id = ?',
        [newSaldo, targetId],
        async (err2) => {
          if (err2) {
            logger.error('Error update saldo:', err2.message);
            return ctx.reply('❌ Gagal menambahkan saldo. Coba lagi nanti.');
          }

          // 🧾 CATAT TRANSAKSI SALDO
          try {
            recordSaldoTransaction(
              targetId,
              totalCredit,
              'manual_addsaldo',
              `addsaldo_by_${ctx.from.id}`
            );
          } catch (e) {
            logger.error('Gagal mencatat transaksi tambah saldo manual:', e.message);
          }

          // Notif ke admin
          let msgAdmin =
            `✅ Saldo user ID <code>${targetId}</code> berhasil ditambah.\n\n` +
            `💵 Nominal bayar : <b>Rp${amount.toLocaleString('id-ID')}</b>\n`;

          if (bonus > 0) {
            msgAdmin +=
              `🎁 Bonus         : <b>Rp${bonus.toLocaleString('id-ID')} (${bonusPercent}%)</b>\n` +
              `💳 Saldo masuk   : <b>Rp${totalCredit.toLocaleString('id-ID')}</b>\n`;
          } else {
            msgAdmin +=
              `💳 Saldo masuk   : <b>Rp${totalCredit.toLocaleString('id-ID')}</b>\n`;
          }

          msgAdmin +=
            `\n💼 Saldo sekarang: <b>Rp${newSaldo.toLocaleString('id-ID')}</b>`;

          await ctx.reply(msgAdmin, { parse_mode: 'HTML' });

          // Notif ke user
          try {
            let msgUser =
              '💰 Saldo kamu telah <b>ditambahkan</b>.\n\n' +
              `💵 Topup : <b>Rp ${amount.toLocaleString('id-ID')}</b>\n`;

            if (bonus > 0) {
              msgUser +=
                `🎁 Bonus : <b>Rp ${bonus.toLocaleString('id-ID')} (${bonusPercent}%)</b>\n` +
                `💳 Masuk : <b>Rp ${totalCredit.toLocaleString('id-ID')}</b>\n`;
            } else {
              msgUser +=
                `💳 Masuk : <b>Rp ${totalCredit.toLocaleString('id-ID')}</b>\n`;
            }

            msgUser +=
              `\n💼 Saldo sekarang: <b>Rp ${newSaldo.toLocaleString('id-ID')}</b>`;

            await bot.telegram.sendMessage(targetId, msgUser, {
              parse_mode: 'HTML'
            });
          } catch (e) {
            logger.error('Gagal kirim notif ke user:', e.message);
          }

          // Notif ke grup (jika diaktifkan)
          if (typeof NOTIF_TOPUP_GROUP !== 'undefined' && NOTIF_TOPUP_GROUP && GROUP_ID) {
            try {
              let targetInfo;
              try {
                targetInfo = await bot.telegram.getChat(targetId);
              } catch (e) {
                targetInfo = {};
              }

              let userLabel;
              if (targetInfo.username) {
                userLabel = targetInfo.username;
              } else if (targetInfo.first_name) {
                userLabel = targetInfo.first_name;
              } else {
                userLabel = String(targetId);
              }

              const waktu = new Date().toLocaleString('id-ID', {
                timeZone: TIME_ZONE,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
              });

              let notifTopup =
                '<blockquote>\n' +
                '━━━ TOPUP MANUAL ━━━\n' +
                                '<code>\n' + // <-- MULAI BLOK MONOSPACE
                `👤 User   : ${userLabel}\n` +
                `🆔 ID     : ${targetId}\n` +
                `💵 Bayar  : Rp ${amount.toLocaleString('id-ID')}\n`;

              if (bonus > 0) {
                notifTopup +=
                  `🎁 Bonus  : Rp ${bonus.toLocaleString('id-ID')} (${bonusPercent}%)\n` +
                  `💳 Masuk  : Rp ${totalCredit.toLocaleString('id-ID')}\n`;
              } else {
                notifTopup +=
                  `💳 Masuk  : Rp ${totalCredit.toLocaleString('id-ID')}\n`;
              }

              notifTopup +=
                `💼 Saldo  : Rp ${newSaldo.toLocaleString('id-ID')}\n` +
                `📅 Tanggal: ${waktu}\n` +
                                '</code>\n' + // <-- AKHIR BLOK MONOSPACE
                '━━━━━━━━━━━━━━━━━━━━\n' +
                '</blockquote>';

              await bot.telegram.sendMessage(GROUP_ID, notifTopup, {
                parse_mode: 'HTML'
              });
            } catch (e) {
              logger.error('Gagal kirim notif topup manual ke grup:', e.message);
            }
          }
        }
      );
    }
  );
});



// Manual admin command: /minsaldo <user_id> <jumlah>
// Mengurangi saldo user secara manual oleh admin
bot.command('minsaldo', async (ctx) => {
        // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  // Hanya admin yang boleh pakai
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  const parts = ctx.message.text.trim().split(/\s+/);
  // parts[0] = /minsaldo
    if (parts.length !== 3) {
    return ctx.reply(
      '⚠️ <b>Format salah.</b>\n\n' +
      'Gunakan:\n' +
      '<code>/minsaldo &lt;user_id&gt; &lt;jumlah&gt;</code>\n\n' +
      'Contoh:\n' +
      '<code>/minsaldo 5439429147 10000</code>',
      { parse_mode: 'HTML' }
    );
  }

  const targetId = Number(parts[1]);
  const amount   = Number(parts[2]);

    if (!targetId || !amount || amount <= 0) {
    return ctx.reply(
      '⚠️ <b>user_id atau jumlah tidak valid.</b>\n' +
      'Contoh yang benar:\n' +
      '<code>/minsaldo 5439429147 10000</code>',
      { parse_mode: 'HTML' }
    );
  }

  // Ambil saldo lama user
  db.get(
    'SELECT saldo FROM users WHERE user_id = ?',
    [targetId],
    (err, row) => {
      if (err) {
        console.error('Error ambil data user:', err.message);
        return ctx.reply('❌ Gagal membaca data user. Coba lagi nanti.');
      }

      if (!row) {
        return ctx.reply(`⚠️ User dengan ID ${targetId} tidak ditemukan di database.`);
      }

      const oldSaldo = Number(row.saldo || 0);

      // Cek biar saldo tidak minus
      if (oldSaldo < amount) {
        return ctx.reply(
          `⚠️ Saldo user tidak cukup.\n` +
          `Saldo sekarang: Rp${oldSaldo.toLocaleString()}\n` +
          `Jumlah pengurangan: Rp${amount.toLocaleString()}`
        );
      }

      const newSaldo = oldSaldo - amount;

      // Update saldo user
      db.run(
        'UPDATE users SET saldo = ? WHERE user_id = ?',
        [newSaldo, targetId],
        async (err2) => {
          if (err2) {
            console.error('Error update saldo:', err2.message);
            return ctx.reply('❌ Gagal mengurangi saldo. Coba lagi nanti.');
          }
       // 🧾 CATAT TRANSAKSI SALDO
          recordSaldoTransaction(
            targetId,
            amount,
            'manual_minsaldo',
            `minsaldo_by_${ctx.from.id}`
          );

          // Notif ke admin (chat ini)
          await ctx.reply(
            `✅ Saldo user ID <code>${targetId}</code> berhasil dikurangi Rp${amount.toLocaleString()}.\n` +
            `💰 Saldo sekarang: <b>Rp${newSaldo.toLocaleString()}</b>`,
            { parse_mode: 'HTML' }
          );

          // Notif ke user yang bersangkutan (kalau bisa di-chat)
try {
  await bot.telegram.sendMessage(
    targetId,
    '💸 Saldo kamu telah <b>dikurangi</b> sebesar <b>Rp ' + amount.toLocaleString() + '</b>.\n' +
    '💳 Saldo sekarang: <b>Rp ' + newSaldo.toLocaleString() + '</b>.',
    { parse_mode: 'HTML' }
  );
} catch (e) {
  console.error('Gagal kirim notif ke user saat pengurangan saldo:', e.message);
}


          // (OPSIONAL) Notif ke grup, mirip topup manual
 if (NOTIF_TOPUP_GROUP) {
  try {
    // Ambil info user untuk ditampilkan
    let targetInfo;
    try {
      targetInfo = await bot.telegram.getChat(targetId);
    } catch (e) {
      targetInfo = {};
    }

    let userLabel;
    if (targetInfo.username) {
      userLabel = targetInfo.username;
    } else if (targetInfo.first_name) {
      userLabel = targetInfo.first_name;
    } else {
      userLabel = String(targetId);
    }

    const waktu = new Date().toLocaleString('id-ID', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    const notifPotong =
      '<blockquote>\n' +
      '━━ PENGURANGAN SALDO ━━\n' +
      '<code>\n' + // <-- MULAI BLOK MONOSPACE
      `👤 User   : ${userLabel}\n` +
      `💸 Jumlah : Rp ${amount.toLocaleString()}\n` +
      `📅 Tanggal: ${waktu}\n` +
      '</code>\n' + // <-- AKHIR BLOK MONOSPACE
      '━━━━━━━━━━━━━━━━━━━━\n' +
      '</blockquote>';

    await bot.telegram.sendMessage(GROUP_ID, notifPotong, {
      parse_mode: 'HTML',
    });
            } catch (e) {
              console.error('Gagal kirim notif pengurangan saldo ke grup:', e.message);
            }
          }
        }
      );
    }
  );
});

// Manual admin command: /deluser <user_id>
// Menghapus user dari tabel users dan (jika ada) dari daftar reseller
bot.command('deluser', async (ctx) => {
        // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  // Hanya admin yang boleh pakai (pakai pola yang sama seperti /addsaldo)
   if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  const parts = ctx.message.text.trim().split(/\s+/);
  // parts[0] = /deluser
      if (parts.length !== 2) {
    return ctx.reply(
      '⚠️ <b>Format salah.</b>\n\n' +
      'Gunakan:\n' +
      '<code>/deluser &lt;user_id&gt;</code>\n\n' +
      'Contoh:\n' +
      '<code>/deluser 5439429147</code>',
      { parse_mode: 'HTML' }
    );
  }

  const targetId = Number(parts[1]);
    if (!targetId) {
    return ctx.reply(
      '⚠️ <b>user_id tidak valid.</b>\n' +
      'Contoh yang benar:\n' +
      '<code>/deluser 5439429147</code>',
      { parse_mode: 'HTML' }
    );
  }

  // Cek apakah user ada di tabel users
  db.get('SELECT * FROM users WHERE user_id = ?', [targetId], (err, row) => {
    if (err) {
      logger.error('❌ Kesalahan saat memeriksa user_id di /deluser:', err.message);
      return ctx.reply('❌ Terjadi kesalahan saat memeriksa user.');
    }

    if (!row) {
      return ctx.reply(`ℹ️ User dengan ID ${targetId} tidak ditemukan di database.`);
    }

    // Hapus dari tabel users
    db.run('DELETE FROM users WHERE user_id = ?', [targetId], (err2) => {
      if (err2) {
        logger.error('❌ Gagal menghapus user di /deluser:', err2.message);
        return ctx.reply('❌ Gagal menghapus user dari database.');
      }

      logger.info(`✅ User ${targetId} dihapus dari tabel users oleh admin ${ctx.from.id}`);

         // Setelah berhasil hapus dari users, hapus juga dari daftar reseller (cache + file)
      try {
        const removed = removeResellerIdFromCache(targetId);
        if (removed) {
          logger.info(`✅ User ${targetId} juga dihapus dari daftar reseller (cache + ressel.db)`);
        }
      } catch (e) {
        logger.error('⚠️ Gagal mengupdate resellerCache di /deluser:', e.message || e);
      }
      ctx.reply(
        `✅ User dengan ID <code>${targetId}</code> berhasil dihapus dari database.`,
        { parse_mode: 'HTML' }
      );
    });
  });
});

// Command: /listuser
// Menampilkan total user, total reseller, dan 10 user terakhir
bot.command('listuser', async (ctx) => {
        // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  // Hanya admin yang boleh pakai
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  // Hitung total user
  db.get('SELECT COUNT(*) AS total FROM users', [], (err, row) => {
    if (err) {
      logger.error('Gagal menghitung total user:', err.message);
      return ctx.reply('❌ Terjadi kesalahan saat mengambil data user.');
    }

    const totalUser = row ? row.total : 0;

    // Ambil 10 user terakhir (berdasarkan id)
    db.all(
      'SELECT user_id, saldo FROM users ORDER BY id DESC LIMIT 10',
      [],
      (err2, rows) => {
        if (err2) {
          logger.error('Gagal mengambil daftar user:', err2.message);
          return ctx.reply('❌ Terjadi kesalahan saat mengambil daftar user.');
        }

        // Hitung total reseller dari modul reseller
        let totalReseller = 0;
        try {
          const resList = listResellersSync();
          if (Array.isArray(resList)) {
            totalReseller = resList.length;
          }
        } catch (e) {
          logger.error('Gagal mengambil daftar reseller:', e.message);
        }

        let msg = '<b>STATISTIK USER</b>\n\n';
        msg += `Total user terdaftar : <b>${totalUser}</b>\n`;
        msg += `Total reseller       : <b>${totalReseller}</b>\n\n`;

        if (!rows || rows.length === 0) {
          msg += 'Belum ada user di database.';
        } else {
          msg += '10 user terakhir di tabel:\n';
          rows.forEach((u, i) => {
            const saldo = Number(u.saldo || 0).toLocaleString('id-ID');
            msg += `${i + 1}. <code>${u.user_id}</code> — Saldo: Rp${saldo}\n`;
          });
        }

        ctx.reply(msg, { parse_mode: 'HTML' });
      }
    );
  });
});

// Command: /setflag
// /setflag <user_id> <NORMAL|WATCHLIST|NAKAL> [catatan optional...]
bot.command('setflag', async (ctx) => {
  // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  const args = ctx.message.text.trim().split(/\s+/);
  // args[0] = /setflag
  if (args.length < 3) {
    return ctx.reply(
      '⚠️ Format salah.\n' +
        'Gunakan:\n' +
        '`/setflag <user_id> <NORMAL|WATCHLIST|NAKAL> [catatan...]`',
      { parse_mode: 'Markdown' }
    );
  }

  const targetId = args[1];
  const rawStatus = args[2].toUpperCase();
  const note = args.slice(3).join(' ').trim();

  if (!/^\d+$/.test(targetId)) {
    return ctx.reply('⚠️ user_id harus berupa angka.', { parse_mode: 'Markdown' });
  }

  if (!['NORMAL', 'WATCHLIST', 'NAKAL'].includes(rawStatus)) {
    return ctx.reply(
      '⚠️ Status tidak dikenal.\n' +
        'Gunakan salah satu: `NORMAL`, `WATCHLIST`, atau `NAKAL`.',
      { parse_mode: 'Markdown' }
    );
  }

  db.run(
    'UPDATE users SET flag_status = ?, flag_note = ? WHERE user_id = ?',
    [rawStatus, note || null, targetId],
    function (err) {
      if (err) {
        logger.error('❌ Gagal mengupdate flag_status user:', err.message);
        return ctx.reply('❌ Terjadi kesalahan saat mengupdate status user.');
      }

      if (this.changes === 0) {
        return ctx.reply(
          `⚠️ User dengan ID ${targetId} tidak ditemukan di tabel users.`,
          { parse_mode: 'Markdown' }
        );
      }

      let label = '✅ NORMAL';
      if (rawStatus === 'WATCHLIST') label = '⚠️ WATCHLIST';
      else if (rawStatus === 'NAKAL') label = '🚫 NAKAL';

      const noteText = note ? `\n📝 Catatan: ${note}` : '';
      ctx.reply(
        `✅ Status user \`${targetId}\` berhasil diubah menjadi: ${label}${noteText}`,
        { parse_mode: 'Markdown' }
      );
    }
  );
});

bot.command('lastbroadcast', async (ctx) => {
        // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from) return;
  const userId = ctx.from.id;

  // Hanya admin/master yang boleh
  if (!adminIds.includes(userId) && userId !== MASTER_ID) {
    return ctx.reply(MASTER_ONLY_MESSAGE, { parse_mode: 'HTML' });
}

  if (!lastBroadcastInfo) {
    return ctx.reply('ℹ️ Belum ada data broadcast yang tersimpan (atau bot baru saja direstart).');
  }

  const info = lastBroadcastInfo;

  let targetLabel = info.target;
  if (info.target === 'all') targetLabel = 'semua user';
  else if (info.target === 'reseller') targetLabel = 'semua reseller';
  else if (info.target === 'member') targetLabel = 'member (bukan reseller & bukan admin)';

  await ctx.reply(
    `📊 <b>Broadcast Terakhir</b>\n\n` +
    `Waktu   : <b>${info.time}</b>\n` +
    `Target  : <b>${targetLabel}</b>\n` +
    `Total   : <b>${info.totalTarget}</b> user\n` +
    `Berhasil: <b>${info.sukses}</b>\n` +
    `Gagal   : <b>${info.gagal}</b>\n\n` +
    `<b>Preview Pesan:</b>\n` +
    info.messagePreview,
    { parse_mode: 'HTML' }
  );
});

//////////////////
bot.command('admin', async (ctx) => {
        // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  logger.info('Admin menu requested');

  if (!adminIds.includes(ctx.from.id)) {
    await ctx.reply('🚫 Anda tidak memiliki izin untuk mengakses menu admin.');
    return;
  }

  await sendAdminMenu(ctx);
});
async function sendMainMenu(ctx) {
  if (!ctx.from) return;

  const userId = ctx.from.id;
  const userName = ctx.from.first_name || '-';

  // Ambil saldo user
  let saldo = 0;
  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT saldo FROM users WHERE user_id = ?', [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    saldo = row && typeof row.saldo === 'number' ? row.saldo : 0;
  } catch (e) {
    saldo = 0;
    logger.error('Gagal mengambil saldo di sendMainMenu:', e);
  }

  const isReseller = isResellerId(userId);


  // Cek apakah user ini admin
  const isAdmin = ADMIN_IDS.includes(userId);

  // Tentukan status user + badge
  let userStatus = '👤 Member';
  if (isAdmin) {
    userStatus = '🛡️ Admin';
  } else if (isReseller) {
    userStatus = '🤝 Reseller';
  }

  // Susun teks lisensi (kalau EXPIRE_DATE di-set)
  let licenseInfoText = '';
  if (EXPIRE_DATE) {
    const info = getLicenseInfo();
    if (info) {
      if (info.daysLeft > 0) {
        licenseInfoText =
          `📅 Lisensi aktif sampai: <b>${info.expire.toLocaleDateString('id-ID')}</b>\n` +
          `⏳ Sisa: <b>${info.daysLeft}</b> hari\n`;
      } else if (info.daysLeft === 0) {
        licenseInfoText =
          `📅 Lisensi berakhir: <b>${info.expire.toLocaleDateString('id-ID')}</b>\n` +
          '⏳ Status: <b>HARI INI</b>\n';
      } else {
        licenseInfoText =
          `📅 Lisensi habis: <b>${info.expire.toLocaleDateString('id-ID')}</b>\n` +
          `⏳ Lewat: <b>${Math.abs(info.daysLeft)}</b> hari lalu\n`;
      }
    } else {
      licenseInfoText = '⚠️ Tidak dapat membaca informasi lisensi.\n';
    }
  } else {
    licenseInfoText = 'ℹ️ Lisensi bot tidak dibatasi tanggal (lifetime) atau belum diatur.\n';
  }

  // Teks panel admin (hanya muncul kalau user adalah admin)
  const commandPanelText = isAdmin ? `
<code>⚙️ COMMAND PANEL</code>
🏠 /start       → Menu Utama
🔑 /admin       → Menu Admin
🛡️ /helpadmin  → Panel Admin

${licenseInfoText}
` : '';

  const messageText = `
<code>╭─────────────────────────╮</code>
<b>⚡ BOT VPN ${NAMA_STORE} ⚡</b>
<i>🌐 Koneksi cepat, aman, stabil.</i>
<code>╰─────────────────────────╯</code>

<code>╭────── USER INFO ─────────╮</code>
• Nama   : <b>${userName}</b>
• ID     : <code>${userId}</code>
• Saldo  : <code>Rp ${saldo}</code>
• Status : <code>${userStatus}</code>
<code>╰─────────────────────────╯</code>

<code>╭──── MENU UTAMA ──────────╮</code>
Gunakan tombol di bawah ini
untuk membuat akun, cek akun,
dan melihat riwayat penjualanmu.
<code>╰─────────────────────────╯</code>

<code>╭────── INFO BOT ───────────╮</code>
• Editor  : <b>KETANTECH</b>
<code>╰─────────────────────────╯</code>

${commandPanelText}
`.trim();

  let keyboard = [
    [
      { text: '➕ Buat Akun', callback_data: 'service_create' },
      { text: '📂 Akun Saya', callback_data: 'my_accounts' }
    ],
    [
      { text: '⌛ Trial Akun', callback_data: 'service_trial' },
      { text: '📶 Cek Server', callback_data: 'cek_service' }
    ],
    [
      { text: '❓ Bantuan', callback_data: 'help_user' }
    ],
    [
      { text: '📊 Riwayat Saya', callback_data: 'my_stats:0' }
    ],
    [
      { text: '🤝 Jadi Reseller harga lebih murah!!', callback_data: 'jadi_reseller' }
    ],
        // ========================================================================
    // SECTION: PAYMENT - TOMBOL TOPUP SALDO
    // ========================================================================
        [
   { text: '💳 TopUp Saldo OTOMATIS (QRIS)', callback_data: 'topupqris_btn' }
        ],
    //[
     // { text: '💰 TopUp Saldo MANUAL via (QRIS)', callback_data: 'topup_manual' }
    //]
  ];

  // Tambah tombol "Penjualan Saya" khusus reseller
  if (isReseller) {
    keyboard.splice(2, 0, [
      { text: '🧾 Penjualan Saya', callback_data: 'sales_summary' }
    ]);
  }

  // Kalau user sudah reseller atau admin, sembunyikan tombol "Jadi Reseller"
  if (isReseller || isAdmin) {
    keyboard = keyboard.filter(row =>
      !row.some(btn => btn && btn.callback_data === 'jadi_reseller')
    );
  }

  try {
    await sendCleanMenu(ctx, messageText, {
      reply_markup: { inline_keyboard: keyboard }
    });
    logger.info('Main menu sent');
  } catch (error) {
    logger.error('Error saat mengirim menu utama:', error);
  }
}


bot.command('hapuslog', async (ctx) => {
        // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  if (!adminIds.includes(ctx.from.id)) return ctx.reply('Tidak ada izin!');
  try {
    if (fs.existsSync('bot-combined.log')) fs.unlinkSync('bot-combined.log');
    if (fs.existsSync('bot-error.log')) fs.unlinkSync('bot-error.log');
    ctx.reply('Log berhasil dihapus.');
    logger.info('Log file dihapus oleh admin.');
  } catch (e) {
    ctx.reply('Gagal menghapus log: ' + e.message);
    logger.error('Gagal menghapus log: ' + e.message);
  }
});

// === 🔍 STATUS BOT (ADMIN) ===
// Cek cepat: lisensi, auto-backup, pengingat expired, dan trial
bot.command(['botstatus', 'statusbot'], async (ctx) => {
  // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;

  const adminId = ctx.from?.id;
  if (!adminId || !ADMIN_IDS.includes(adminId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  // --- Lisensi ---
  let licenseText = '';
  if (EXPIRE_DATE) {
    const info = getLicenseInfo();
    if (info) {
      if (info.daysLeft > 0) {
        licenseText =
          `📅 Sampai: <b>${info.expire.toLocaleDateString('id-ID')}</b>\n` +
          `⏳ Sisa  : <b>${info.daysLeft}</b> hari`;
      } else if (info.daysLeft === 0) {
        licenseText =
          `📅 Sampai: <b>${info.expire.toLocaleDateString('id-ID')}</b>\n` +
          '⏳ Status: <b>HARI INI</b>';
      } else {
        licenseText =
          `📅 Habis : <b>${info.expire.toLocaleDateString('id-ID')}</b>\n` +
          `⏳ Lewat : <b>${Math.abs(info.daysLeft)}</b> hari`;
      }
    } else {
      licenseText = '⚠️ Tidak dapat membaca informasi lisensi.';
    }
  } else {
    licenseText = '♾️ Lisensi: <b>lifetime / belum diatur</b>';
  }

  // --- Auto-backup ---
  const abStatus = AUTO_BACKUP_ENABLED ? '🟢 ON' : '🔴 OFF';
  const abInterval =
    AUTO_BACKUP_INTERVAL_HOURS && AUTO_BACKUP_INTERVAL_HOURS > 0
      ? `${AUTO_BACKUP_INTERVAL_HOURS} jam`
      : 'tidak di-set';
  const abChat =
    BACKUP_CHAT_ID && BACKUP_CHAT_ID !== ''
      ? `<code>${BACKUP_CHAT_ID}</code>`
      : '<i>belum di-set</i>';

  // --- Pengingat expired ---
  const erStatus = EXPIRY_REMINDER_ENABLED ? '🟢 ON' : '🔴 OFF';
  const erTime = `${String(EXPIRY_REMINDER_HOUR).padStart(
    2,
    '0'
  )}:${String(EXPIRY_REMINDER_MINUTE).padStart(2, '0')}`;
  const erDays = EXPIRY_REMINDER_DAYS_BEFORE;

  // --- Trial config ---
  let trialInfoText = '';
  try {
    const trialCfg = await getTrialConfig();
    const tStatus = trialCfg.enabled ? '🟢 ON' : '🔴 OFF';
    trialInfoText =
      `Status   : ${tStatus}\n` +
      `Max/hari : <b>${trialCfg.maxPerDay}</b> x\n` +
      `Durasi   : <b>${trialCfg.durationHours}</b> jam\n` +
      `Min saldo: <b>${trialCfg.minBalanceForTrial}</b>`;
  } catch (e) {
    logger.error('❌ Gagal membaca trial_config di /botstatus:', e);
    trialInfoText = '⚠️ Gagal membaca konfigurasi trial.';
  }

  const text = `
<code>╭──────────────────────────────╮</code>
<b>🧰 STATUS BOT VPN ${NAMA_STORE}</b>
<code>╰──────────────────────────────╯</code>

<code>╭──── LISENSI BOT ─────────────╮</code>
${licenseText}
<code>╰──────────────────────────────╯</code>

<code>╭──── AUTO BACKUP DB ──────────╮</code>
• Status   : <b>${abStatus}</b>
• Interval : <b>${abInterval}</b>
• Chat ID  : ${abChat}
<code>╰──────────────────────────────╯</code>

<code>╭──── PENGINGAT EXPIRED ───────╮</code>
• Status   : <b>${erStatus}</b>
• H-       : <b>${erDays}</b> hari
• Jam      : <b>${erTime}</b> (zona ${TIME_ZONE})
<code>╰──────────────────────────────╯</code>

<code>╭──── PENGATURAN TRIAL ────────╮</code>
${trialInfoText}
<code>╰──────────────────────────────╯</code>
`.trim();

  return ctx.reply(text, { parse_mode: 'HTML' });
});

// Command: /helpadmin
// Menampilkan daftar lengkap perintah admin
bot.command('helpadmin', async (ctx) => {
        // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  const userId = ctx.message.from.id;

  // Hanya admin / owner
  if (!ADMIN_IDS.includes(userId)) {
  return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}


  const helpMessage =
    '📋 DAFTAR PERINTAH ADMIN TAPEKETAN VPN\n' +
    '\n' +
    'Gunakan perintah berikut hanya jika Anda memahami fungsinya.\n' +
    'Beberapa perintah tertentu sebaiknya hanya dipakai OWNER / MASTER.\n' +
    '\n' +
    '1) PANEL & BANTUAN\n' +
    '- /admin        → Buka Menu Admin (panel tombol)\n' +
    '- /helpadmin    → Menampilkan daftar perintah admin ini\n' +
    '- /botstatus atau /statusbot -> Cek status bot & server\n' +
    '\n' +
    '2) MANAJEMEN USER & RESELLER\n' +
    '- /listuser     → Menampilkan daftar user yang terdaftar di database\n' +
    '- /addressel    → Menambahkan reseller baru\n' +
    '- /delressel    → Menghapus ID reseller\n' +
    '- /deluser      → Menghapus user dari database (hati-hati)\n' +
    '\n' +
    '3) SALDO & TRANSAKSI\n' +
    '- /addsaldo     → Menambahkan saldo ke akun user\n' +
    '- /minsaldo     → Mengurangi saldo akun user (misal setelah beli akun)\n' +
    '- /cekqris <invoice_id> -> Cek status QRIS manual (invoice tertentu)\n' +
    '\n' +
    '4) SERVER & PAKET\n' +
    '- /addserver          → Menambahkan server baru\n' +
    '- /addserver_reseller → Mengatur server default untuk reseller\n' +
    '- /editharga          → Mengedit harga paket pada server\n' +
    '- /editauth           → Mengedit akun/auth panel (jika dipakai)\n' +
    '- /editdomain         → Mengedit domain server\n' +
    '- /editlimitcreate    → Mengedit batas pembuatan akun per server\n' +
    '- /editlimitip        → Mengedit batas jumlah IP per akun\n' +
    '- /editlimitquota     → Mengedit batas kuota paket\n' +
    '- /editnama           → Mengedit nama server\n' +
    '- /edittotalcreate    → Mengedit total limit pembuatan akun server\n' +
    '\n' +
    '5) BROADCAST & PENGUMUMAN\n' +
    '- /broadcast      → Broadcast ke semua user\n' +
    '- /broadcastres   → Broadcast ke semua reseller\n' +
    '- /broadcastmem   → Broadcast ke semua member biasa\n' +
    '- /lastbroadcast  → Menampilkan ringkasan broadcast terakhir\n' +
    '\n' +
    '6) LOG & MAINTENANCE\n' +
    '- /hapuslog       → Menghapus file log bot\n' +
    '- /testgroup      → Menguji kirim pesan ke GROUP_ID (alat uji/debug)\n' +
    '\n' +
    '7) LISENSI BOT\n' +
    '- /lisensi        → Melihat masa aktif lisensi bot (expire date & sisa hari)\n' +
    '- /addhari        → Menambah masa aktif lisensi bot (biasanya khusus OWNER/MASTER)\n' +
    '- /kuranghari     → Mengurangi masa aktif lisensi bot (biasanya khusus OWNER/MASTER)\n' +
    '\n' +
    '8) LAPORAN, BACKUP & REMINDER\n' +
    '- /health               → Cek kesehatan bot (lisensi, database, auto-backup, laporan harian, pengingat expired, uptime)\n' +
    '- /daily_report_test    → Mengirim laporan harian secara manual (mode test)\n' +
    '- /backup_auto_test     → Menguji fungsi auto-backup sekali (test kirim backup)\n' +
    '- /expired_reminder_test → Preview tampilan pesan pengingat akun expired ke chat Anda\n' +
    '\n' +
    '9) TROUBLESHOOTING / MODERASI\n' +
    '- /setflag <user_id> <NORMAL|WATCHLIST|NAKAL> [catatan...] -> Tandai status user\n' +
    '\n' +
    'Catatan:\n' +
    '- Hak akses admin diatur melalui MASTER_ID dan ADMIN_IDS di file .vars.json\n' +
    '- Jangan gunakan perintah penghapusan/ubah server/lisensi jika belum paham akibatnya.\n';

  return ctx.reply(helpMessage);
});

//////////
bot.command('addserver_reseller', async (ctx) => {
  if (!ensurePrivateChat(ctx)) return;
  const userId = ctx.from?.id;
  if (!ADMIN_IDS.includes(userId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }
  try {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 7) {
      return ctx.reply('⚠️ Format salah!\n\nGunakan:\n/addserver_reseller <domain> <auth> <harga> <nama_server> <quota> <iplimit> <batas_create_akun>');
    }

    const [domain, auth, harga, nama_server, quota, iplimit, batas_create_akun] = args;

    // ✅ TAMBAHKAN total_create_akun di VALUES
    db.run(`INSERT INTO Server (domain, auth, harga, nama_server, quota, iplimit, batas_create_akun, is_reseller_only, total_create_akun) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)`,
      [domain, auth, harga, nama_server, quota, iplimit, batas_create_akun],
      function (err) {
        if (err) {
          logger.error('❌ Gagal menambah server reseller:', err.message);
          return ctx.reply('❌ *Gagal menambah server reseller.*', { parse_mode: 'Markdown' });
        }
        ctx.reply('✅ *Server khusus reseller berhasil ditambahkan!*', { parse_mode: 'Markdown' });
      }
    );
  } catch (e) {
    logger.error('Error di /addserver_reseller:', e);
    ctx.reply('❌ *Terjadi kesalahan.*', { parse_mode: 'Markdown' });
  }
});
//////////
bot.command('broadcast', async (ctx) => {
  // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;

  const userId = ctx.from.id;
  logger.info(`Broadcast command received from user_id: ${userId}`);

  if (!ADMIN_IDS.includes(userId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  // Ambil pesan: dari reply, atau dari teks setelah /broadcast
  const msg = ctx.message;
  const messageText = msg.reply_to_message
    ? msg.reply_to_message.text
    : msg.text.split(' ').slice(1).join(' ');

  if (!messageText || !messageText.trim()) {
    logger.info('⚠️ Pesan untuk broadcast tidak diberikan.');
    return ctx.reply(
      '⚠️ <b>Pesan broadcast kosong.</b>\n' +
        'Kirim ulang perintah dengan teks setelah command, atau reply ke pesan lalu jalankan <code>/broadcast</code>.',
      { parse_mode: 'HTML' }
    );
  }

  try {
    // Ambil semua user dari tabel users
    const rows = await new Promise((resolve, reject) => {
      db.all('SELECT user_id FROM users', [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

    if (rows.length === 0) {
      return ctx.reply('ℹ️ Tidak ada user di database untuk dikirimi broadcast.', {
        parse_mode: 'HTML',
      });
    }

    const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    let sukses = 0;
    let gagal = 0;
    let totalTarget = 0;

    // Beri info awal ke admin
    await ctx.reply(
      `📢 Mulai broadcast ke <b>${rows.length}</b> user...\n` +
        'Mohon tunggu, ini bisa memakan waktu beberapa detik/menit tergantung jumlah user.',
      { parse_mode: 'HTML' }
    );

    for (const row of rows) {
      const targetId = row.user_id;
      if (!targetId) continue;
      totalTarget++;

      try {
        await axios.post(telegramUrl, {
          chat_id: targetId,
          text: messageText,
        });
        sukses++;
        logger.info(`✅ Broadcast terkirim ke ${targetId}`);
            } catch (error) {
        gagal++;

        // Kalau kena limit Telegram (429), ikuti retry_after kalau ada
        const status = error?.response?.status;
        const retryAfter =
          error?.response?.data?.parameters?.retry_after || 0;

        if (status === 429) {
          logger.warn(
            `⏳ Kena limit Telegram (429) saat kirim ke ${targetId}. retry_after=${retryAfter}s`
          );
          const delayMs = (retryAfter > 0 ? retryAfter + 1 : 3) * 1000;
          await sleep(delayMs);
        } else {
          logger.error(
            `⚠️ Gagal kirim broadcast ke ${targetId}:`,
            error.message || error
          );
        }
      }


      // Jeda kecil agar tidak ngebombardir API Telegram
      await sleep(80); // bisa diubah ke 30/100 ms sesuai kebutuhan
    }

    await ctx.reply(
      `✅ <b>Broadcast selesai.</b>\n\n` +
        `🎯 Target   : <b>${totalTarget}</b> user\n` +
        `✅ Berhasil : <b>${sukses}</b>\n` +
        `⚠️ Gagal    : <b>${gagal}</b>\n\n` +
        `<i>Kalau sering kena limit, naikkan jeda di fungsi sleep (misal jadi 100ms).</i>`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    logger.error('⚠️ Kesalahan saat mengambil daftar pengguna untuk broadcast:', e);
    return ctx.reply(
      '⚠️ Terjadi kesalahan saat mengambil daftar pengguna untuk broadcast.',
      { parse_mode: 'HTML' }
    );
  }
});

// Broadcast ke reseller saja (ID diambil dari ressel.db)
/**
 * Cara pakai:
 * /broadcastres Pesan...
 * ATAU reply ke pesan lalu kirim /broadcastres
 */
// Broadcast ke reseller saja (ID diambil dari ressel.db)
/**
 * Cara pakai:
 * /broadcastres Pesan...
 * ATAU reply ke pesan lalu kirim /broadcastres
 */
bot.command('broadcastres', async (ctx) => {
  // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;

  const userId = ctx.from.id;
  logger.info(`Broadcastres command received from user_id: ${userId}`);

  // Hanya admin
  if (!ADMIN_IDS.includes(userId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  // Ambil pesan: dari reply, atau dari teks setelah /broadcastres
  const msg = ctx.message;
  const messageText = msg.reply_to_message
    ? msg.reply_to_message.text
    : msg.text.split(' ').slice(1).join(' ');

  if (!messageText || !messageText.trim()) {
    logger.info('⚠️ Pesan untuk broadcastres tidak diberikan.');
    return ctx.reply(
      '⚠️ <b>Pesan broadcast kosong.</b>\n' +
        'Kirim ulang perintah dengan teks, atau reply sebuah pesan lalu jalankan <code>/broadcastres</code>.',
      { parse_mode: 'HTML' }
    );
  }

  try {
    if (!fs.existsSync(resselFilePath)) {
      return ctx.reply(
        'ℹ️ Belum ada reseller yang terdaftar (file <code>ressel.db</code> kosong).',
        { parse_mode: 'HTML' }
      );
    }

    const fileContent = fs.readFileSync(resselFilePath, 'utf8');
    const resellerList = fileContent
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '');

    if (resellerList.length === 0) {
      return ctx.reply(
        'ℹ️ Belum ada reseller yang terdaftar di <code>ressel.db</code>.',
        { parse_mode: 'HTML' }
      );
    }

    const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    let sukses = 0;
    let gagal = 0;
    let totalTarget = 0;

    // Info awal ke admin
    await ctx.reply(
      `📢 Mulai broadcast ke <b>${resellerList.length}</b> reseller...\n` +
        'Mohon tunggu, proses berjalan bertahap agar tidak kena limit Telegram.',
      { parse_mode: 'HTML' }
    );

    for (const idStr of resellerList) {
      const targetId = Number(idStr);
      if (!targetId) continue;
      totalTarget++;

      try {
        await axios.post(telegramUrl, {
          chat_id: targetId,
          text: messageText,
        });
        sukses++;
        logger.info(`✅ Broadcastres terkirim ke ${targetId}`);
            } catch (error) {
        gagal++;

        const status = error?.response?.status;
        const retryAfter =
          error?.response?.data?.parameters?.retry_after || 0;

        if (status === 429) {
          logger.warn(
            `⏳ Kena limit Telegram (429) saat broadcastres ke ${targetId}. retry_after=${retryAfter}s`
          );
          const delayMs = (retryAfter > 0 ? retryAfter + 1 : 3) * 1000;
          await sleep(delayMs);
        } else {
          logger.error(
            `⚠️ Gagal kirim broadcastres ke ${targetId}:`,
            error.message || error
          );
        }
      }


      // Jeda kecil supaya aman dari limit
      await sleep(80);
    }

    await ctx.reply(
      `✅ <b>Broadcast ke reseller selesai.</b>\n\n` +
        `🎯 Target   : <b>${totalTarget}</b> reseller\n` +
        `✅ Berhasil : <b>${sukses}</b>\n` +
        `⚠️ Gagal    : <b>${gagal}</b>\n\n` +
        `<i>Kalau mulai sering dapat error limit, jeda bisa dinaikkan lagi (misal 100–120 ms).</i>`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    logger.error('❌ Error di broadcastres:', e);
    return ctx.reply(
      '⚠️ Terjadi kesalahan saat menjalankan broadcast ke reseller.',
      { parse_mode: 'HTML' }
    );
  }
});

// Broadcast ke MEMBER saja (bukan reseller & bukan admin)
/**
 * Cara pakai:
 * /broadcastmem Pesan...
 * ATAU reply ke pesan lalu kirim /broadcastmem
 */
bot.command('broadcastmem', async (ctx) => {
  // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;

  const userId = ctx.from.id;
  logger.info(`Broadcastmem command received from user_id: ${userId}`);

  // Hanya admin
  if (!ADMIN_IDS.includes(userId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  // Ambil pesan: dari reply, atau dari teks setelah /broadcastmem
  const msg = ctx.message;
  const messageText = msg.reply_to_message
    ? msg.reply_to_message.text
    : msg.text.split(' ').slice(1).join(' ');

  if (!messageText || !messageText.trim()) {
    logger.info('⚠️ Pesan untuk broadcastmem tidak diberikan.');
    return ctx.reply(
      '⚠️ <b>Pesan broadcast kosong.</b>\n' +
        'Kirim ulang perintah dengan teks, atau reply sebuah pesan lalu jalankan <code>/broadcastmem</code>.',
      { parse_mode: 'HTML' }
    );
  }

  try {
    // Ambil daftar reseller dari file ressel.db
    let resellerSet = new Set();
    if (fs.existsSync(resselFilePath)) {
      try {
        const fileContent = fs.readFileSync(resselFilePath, 'utf8');
        const resellerList = fileContent
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l !== '');
        resellerSet = new Set(resellerList);
      } catch (e) {
        logger.error('⚠️ Gagal membaca file reseller di broadcastmem:', e);
      }
    }

    // Ambil semua user dari tabel users
    const rows = await new Promise((resolve, reject) => {
      db.all('SELECT user_id FROM users', [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

    if (!rows || rows.length === 0) {
      return ctx.reply(
        'ℹ️ Belum ada user yang terdaftar di database.',
        { parse_mode: 'HTML' }
      );
    }

    const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    let sukses = 0;
    let gagal = 0;
    let totalTarget = 0;

    // Info awal ke admin
    await ctx.reply(
      '📢 Mulai broadcast ke member (non-reseller & non-admin)...\n' +
        'Proses berjalan bertahap agar aman dari limit Telegram.',
      { parse_mode: 'HTML' }
    );

    for (const row of rows) {
      const targetId = row.user_id;
      if (!targetId) continue;

      const idStr = String(targetId);

      // Skip reseller
      if (resellerSet.has(idStr)) {
        continue;
      }

      // Skip admin
      if (ADMIN_IDS.includes(targetId)) {
        continue;
      }

      totalTarget++;

      try {
        await axios.post(telegramUrl, {
          chat_id: targetId,
          text: messageText,
        });
        sukses++;
        logger.info(`✅ Broadcastmem terkirim ke ${targetId}`);
            } catch (error) {
        gagal++;

        const status = error?.response?.status;
        const retryAfter =
          error?.response?.data?.parameters?.retry_after || 0;

        if (status === 429) {
          logger.warn(
            `⏳ Kena limit Telegram (429) saat broadcastmem ke ${targetId}. retry_after=${retryAfter}s`
          );
          const delayMs = (retryAfter > 0 ? retryAfter + 1 : 3) * 1000;
          await sleep(delayMs);
        } else {
          logger.error(
            `⚠️ Gagal kirim broadcastmem ke ${targetId}:`,
            error.message || error
          );
        }
      }

      // Jeda 80ms biar aman dari limit
      await sleep(80);
    }

    await ctx.reply(
      `✅ <b>Broadcast ke member selesai.</b>\n\n` +
        `🎯 Target   : <b>${totalTarget}</b> user (bukan reseller & bukan admin)\n` +
        `✅ Berhasil : <b>${sukses}</b>\n` +
        `⚠️ Gagal    : <b>${gagal}</b>\n\n` +
        `<i>Kalau mulai sering kena limit, jeda bisa dinaikkan lagi (misal 100–120 ms).</i>`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    logger.error('❌ Error di broadcastmem:', e);
    return ctx.reply(
      '⚠️ Terjadi kesalahan saat broadcast ke member.',
      { parse_mode: 'HTML' }
    );
  }
});

bot.command('cekqris', async (ctx) => {
  if (!ensurePrivateChat(ctx)) return;

  const userId = ctx.from?.id || 0;

  // Hanya admin / owner
  if (!adminIds.includes(userId) && userId !== MASTER_ID) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  const parts = ctx.message.text.trim().split(/\s+/);
  const invoiceId = parts[1];

  if (!invoiceId) {
    return ctx.reply(
      'ℹ️ Penggunaan:\n<code>/cekqris INV123456789</code>',
      { parse_mode: 'HTML' }
    );
  }

  try {
    // 1. Ambil data dari DB
    const row = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM qris_payments WHERE invoice_id = ? ORDER BY id DESC LIMIT 1',
        [invoiceId],
        (err, r) => (err ? reject(err) : resolve(r))
      );
    });

    if (!row) {
      return ctx.reply(
        '❌ Invoice tidak ditemukan di tabel <code>qris_payments</code>.',
        { parse_mode: 'HTML' }
      );
    }

    // Simpan status DB di variabel (bisa di-update nanti)
    let dbStatus = row.status || 'pending';
    let dbPaidAt = row.paid_at || null;

    // 2. Cek status ke API
    let apiStatus = '-';
    let apiPaidAt = null;
    let apiExtra = '';

    try {
      const apiRes = await checkQrisInvoiceStatus(row.invoice_id, row.amount, row.created_at);

      if (apiRes) {
        apiStatus = (apiRes.status || '-').toUpperCase();
        apiPaidAt = apiRes.paid_at || null;

        if (apiPaidAt) {
          apiExtra =
            '\n📅 Paid API: ' +
            new Date(apiPaidAt).toLocaleString('id-ID', {
              timeZone: TIME_ZONE,
            });
        }
      }
    } catch (e) {
      logger.error('⚠️ Gagal cek status QRIS ke API dari /cekqris:', e);
      apiStatus = 'ERROR';
      apiExtra = `\n⚠️ ${e.message || String(e)}`;
    }

    // 3. Kalau DB masih pending tapi API sudah PAID → langsung selesaikan topup
    if (dbStatus !== 'paid' && apiStatus === 'PAID') {
      const paidTs = apiPaidAt || Date.now();

      // update status di tabel qris_payments
      const changes = await new Promise((resolve, reject) => {
        db.run(
          'UPDATE qris_payments SET status = ?, paid_at = ? WHERE id = ? AND status = ?',
          ['paid', paidTs, row.id, 'pending'],
          function (err) {
            if (err) return reject(err);
            resolve(this.changes || 0);
          }
        );
      });

      if (changes > 0) {
        // tambah saldo user
        await new Promise((resolve, reject) => {
          db.run(
            'UPDATE users SET saldo = saldo + ? WHERE user_id = ?',
            [row.amount, row.user_id],
            (err) => (err ? reject(err) : resolve())
          );
        });

        // catat ke transaksi
        const now = Date.now();
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO transactions (user_id, amount, type, reference_id, timestamp) VALUES (?, ?, ?, ?, ?)',
            [
              row.user_id,
              row.amount,
              'qris_manual_topup',
              `qris_manual_${row.invoice_id}`,
              now,
            ],
            (err) => (err ? reject(err) : resolve())
          );
        });

        // update variabel biar tampilan pakai status terbaru
        dbStatus = 'paid';
        dbPaidAt = paidTs;

        // kirim notif ke user
        try {
          // ambil saldo terbaru
          const userRow = await new Promise((resolve, reject) => {
            db.get(
              'SELECT saldo FROM users WHERE user_id = ?',
              [row.user_id],
              (err, r) => (err ? reject(err) : resolve(r))
            );
          });

          const saldoNow = userRow?.saldo || 0;

          const msgUser =
            '✅ <b>Topup Saldo Berhasil (Manual Sync)</b>\n\n' +
            '💳 Metode : <b>QRIS Otomatis</b>\n' +
            `🧾 Invoice : <code>${row.invoice_id}</code>\n` +
            `💰 Nominal : <b>Rp${row.amount.toLocaleString('id-ID')}</b>\n\n` +
            `💼 Saldo kamu sekarang: <b>${saldoNow.toLocaleString('id-ID')}</b>`;

          await bot.telegram.sendMessage(row.user_id, msgUser, {
            parse_mode: 'HTML',
          });

          // notif ke grup (kalau diaktifkan)
          if (GROUP_ID && NOTIF_TOPUP_GROUP) {
            const chatId = row.user_id;
            let chatInfo;
            try {
              chatInfo = await bot.telegram.getChat(chatId);
            } catch (e) {
              chatInfo = {};
            }

            let userLabel;
            if (chatInfo.username) {
              userLabel = chatInfo.username;
            } else if (chatInfo.first_name) {
              userLabel = chatInfo.first_name;
            } else {
              userLabel = String(chatId);
            }

            const msgGroup =
              '<blockquote>\n' +
              '💰 TOPUP SALDO (QRIS)' +
              '<code>\n' + // <-- MULAI BLOK MONOSPACE
              `👤 User   : ${userLabel}\n` +
              `💰 Nominal: Rp${row.amount.toLocaleString('id-ID')}\n` +
              `🧾 Invoice: ${row.invoice_id}\n` +
              '</code>\n' + // <-- AKHIR BLOK MONOSPACE
              '━━━━━━━━━━━━━━━━━━━━\n' +
              '</blockquote>';

            await bot.telegram.sendMessage(GROUP_ID, msgGroup, {
              parse_mode: 'HTML',
            });
          }
        } catch (e) {
          logger.error(
            '❌ Gagal kirim notif ke user/grup setelah /cekqris:',
            e
          );
        }
      }
    }

    // 4. Tampilkan hasil ke admin (pakai status DB TERBARU)
    const createdAtText = new Date(row.created_at).toLocaleString('id-ID', {
      timeZone: TIME_ZONE,
    });

    const paidAtDbText = dbPaidAt
      ? new Date(dbPaidAt).toLocaleString('id-ID', { timeZone: TIME_ZONE })
      : '-';

    const baseAmount = row.base_amount || 0;
    const uniqueSuffix = row.unique_suffix || 0;

    let nominalInfo = '';
    if (baseAmount > 0) {
      if (uniqueSuffix > 0) {
        nominalInfo =
          `💰 Dipilih user : <b>Rp${baseAmount.toLocaleString('id-ID')}</b>\n` +
          `💠 Kode unik    : <b>${uniqueSuffix
            .toString()
            .padStart(3, '0')}</b>\n` +
          `💳 Dibayar      : <b>Rp${row.amount.toLocaleString('id-ID')}</b>\n`;
      } else {
        // base ada, tapi kode unik 0 (misalnya lagi dimatikan)
        nominalInfo =
          `💰 Dipilih user : <b>Rp${baseAmount.toLocaleString('id-ID')}</b>\n` +
          `💳 Dibayar      : <b>Rp${row.amount.toLocaleString('id-ID')}</b>\n`;
      }
    } else {
      // data lama (waktu belum ada kolom base_amount / unique_suffix)
      nominalInfo =
        `💳 Dibayar      : <b>Rp${row.amount.toLocaleString('id-ID')}</b>\n` +
        '<i>(base_amount tidak tersimpan — transaksi lama)</i>\n';
    }

    const msg =
      '🔎 <b>Cek Invoice QRIS</b>\n\n' +
      `🧾 Invoice : <code>${row.invoice_id}</code>\n` +
      `👤 User ID : <code>${row.user_id}</code>\n\n` +
      nominalInfo +
      '\n' +
      `📊 Status DB : <b>${dbStatus.toUpperCase()}</b>\n` +
      `🕒 Dibuat    : ${createdAtText}\n` +
      `✅ Dibayar   : ${paidAtDbText}\n\n` +
      `📡 Status API: <b>${apiStatus}</b>${apiExtra}`;

    await ctx.reply(msg, { parse_mode: 'HTML' });
  } catch (e) {
    logger.error('❌ Error di /cekqris:', e);
    await ctx.reply('❌ Terjadi kesalahan saat cek invoice QRIS.', {
      parse_mode: 'HTML',
    });
  }
});


bot.command('addserver', async (ctx) => {
        // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  const userId = ctx.message.from.id;
  if (!ADMIN_IDS.includes(userId)) {
  return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}


  const args = ctx.message.text.split(' ');
  if (args.length !== 8) {
      return ctx.reply('⚠️ Format salah. Gunakan: `/addserver <domain> <auth> <harga> <nama_server> <quota> <iplimit> <batas_create_account>`', { parse_mode: 'Markdown' });
  }

  const [domain, auth, harga, nama_server, quota, iplimit, batas_create_akun] = args.slice(1);

  const numberOnlyRegex = /^\d+$/;
  if (!numberOnlyRegex.test(harga) || !numberOnlyRegex.test(quota) || !numberOnlyRegex.test(iplimit) || !numberOnlyRegex.test(batas_create_akun)) {
      return ctx.reply('⚠️ `harga`, `quota`, `iplimit`, dan `batas_create_akun` harus berupa angka.', { parse_mode: 'Markdown' });
  }

  // ✅ QUERY YANG BENAR
  db.run("INSERT INTO Server (domain, auth, harga, nama_server, quota, iplimit, batas_create_akun, total_create_akun) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
      [domain, auth, parseInt(harga), nama_server, parseInt(quota), parseInt(iplimit), parseInt(batas_create_akun)],
      function(err) {
          if (err) {
              logger.error('⚠️ Kesalahan saat menambahkan server:', err.message);
              return ctx.reply('⚠️ Kesalahan saat menambahkan server.', { parse_mode: 'Markdown' });
          }
          ctx.reply(`✅ Server \`${nama_server}\` berhasil ditambahkan.`, { parse_mode: 'Markdown' });
      }
  );
});

bot.command('editharga', async (ctx) => {
  // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;

  const userId = ctx.message.from.id;
  if (!ADMIN_IDS.includes(userId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  // Pecah teks command: /editharga domain harga
  const args = ctx.message.text.trim().split(/\s+/);
  // args[0] = "/editharga"
  if (args.length !== 3) {
    return ctx.reply(
      '⚠️ Format salah. Gunakan:\n`/editharga <domain> <harga>`',
      { parse_mode: 'Markdown' }
    );
  }

  const domain = args[1];
  const hargaStr = args[2];

  // Validasi harga harus angka positif
  if (!/^\d+$/.test(hargaStr)) {
    return ctx.reply(
      '⚠️ `harga` harus berupa angka (tanpa titik/koma).',
      { parse_mode: 'Markdown' }
    );
  }

  const hargaBaru = parseInt(hargaStr, 10);

  db.run(
    'UPDATE Server SET harga = ? WHERE domain = ?',
    [hargaBaru, domain],
    function (err) {
      if (err) {
        logger.error('⚠️ Kesalahan saat mengedit harga server:', err.message);
        return ctx.reply(
          '⚠️ Terjadi kesalahan saat mengedit harga server.',
          { parse_mode: 'Markdown' }
        );
      }

      // this.changes = berapa baris yang kena UPDATE
      if (this.changes === 0) {
        return ctx.reply(
          '⚠️ Server dengan domain tersebut tidak ditemukan.',
          { parse_mode: 'Markdown' }
        );
      }

      ctx.reply(
        `✅ Harga server \`${domain}\` berhasil diubah menjadi \`${hargaBaru}\`.`,
        { parse_mode: 'Markdown' }
      );
    }
  );
});


// =========================
// EDIT DATA SERVER
// =========================

bot.command('editnama', async (ctx) => {
  if (!ensurePrivateChat(ctx)) return;

  const userId = ctx.message.from.id;
  if (!ADMIN_IDS.includes(userId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  // /editnama <domain> <nama_server_baru...>
  const args = ctx.message.text.trim().split(/\s+/);
  if (args.length < 3) {
    return ctx.reply(
      '⚠️ Format salah.\nGunakan:\n`/editnama <domain> <nama_server_baru>`',
      { parse_mode: 'Markdown' }
    );
  }

  const domain = args[1];
  const namaBaru = args.slice(2).join(' '); // nama bisa pakai spasi

  db.run(
    'UPDATE Server SET nama_server = ? WHERE domain = ?',
    [namaBaru, domain],
    function (err) {
      if (err) {
        logger.error('⚠️ Kesalahan saat mengedit nama server:', err.message);
        return ctx.reply('⚠️ Kesalahan saat mengedit nama server.', {
          parse_mode: 'Markdown',
        });
      }

      if (this.changes === 0) {
        return ctx.reply('⚠️ Server tidak ditemukan.', {
          parse_mode: 'Markdown',
        });
      }

      ctx.reply(
        `✅ Nama server untuk \`${domain}\` berhasil diubah menjadi \`${namaBaru}\`.`,
        { parse_mode: 'Markdown' }
      );
    }
  );
});

bot.action(/edit_domain_(\d+)/, async (ctx) => {
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit domain server dengan ID: ${serverId}`);

  // Ambil domain sekarang dari database
  db.get('SELECT domain FROM Server WHERE id = ?', [serverId], async (err, row) => {
    if (err) {
      logger.error('Kesalahan saat mengambil data server untuk edit domain:', err.message);
      await ctx.reply('⚠️ Terjadi kesalahan saat mengambil data server.');
      return;
    }

    if (!row) {
      await ctx.reply('⚠️ Server tidak ditemukan.');
      return;
    }

    const currentDomain = row.domain || '-';

    // Simpan state: input berikutnya dianggap sebagai domain baru
    userState[ctx.chat.id] = {
      step: 'edit_domain',
      serverId: serverId,
      oldDomain: currentDomain,
    };

    await ctx.reply(
      '🌐 *Silakan ketik domain server baru, lalu kirim sebagai pesan biasa.*\n' +
        `✏️ Contoh: \`${currentDomain}\`\n` +
        '❌ Ketik *batal* untuk membatalkan.',
      { parse_mode: 'Markdown' }
    );
  });
});


bot.command('editauth', async (ctx) => {
  if (!ensurePrivateChat(ctx)) return;

  const userId = ctx.message.from.id;
  if (!ADMIN_IDS.includes(userId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  // /editauth <domain> <auth_baru>
  const args = ctx.message.text.trim().split(/\s+/);
  if (args.length !== 3) {
    return ctx.reply(
      '⚠️ Format salah.\nGunakan:\n`/editauth <domain> <auth_baru>`',
      { parse_mode: 'Markdown' }
    );
  }

  const domain = args[1];
  const authBaru = args[2];

  db.run(
    'UPDATE Server SET auth = ? WHERE domain = ?',
    [authBaru, domain],
    function (err) {
      if (err) {
        logger.error('⚠️ Kesalahan saat mengedit auth server:', err.message);
        return ctx.reply('⚠️ Kesalahan saat mengedit auth server.', {
          parse_mode: 'Markdown',
        });
      }

      if (this.changes === 0) {
        return ctx.reply('⚠️ Server tidak ditemukan.', {
          parse_mode: 'Markdown',
        });
      }

      ctx.reply(
        `✅ Auth server untuk \`${domain}\` berhasil diubah.`,
        { parse_mode: 'Markdown' }
      );
    }
  );
});

bot.command('editlimitquota', async (ctx) => {
  if (!ensurePrivateChat(ctx)) return;

  const userId = ctx.message.from.id;
  if (!ADMIN_IDS.includes(userId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  // /editlimitquota <domain> <quota>
  const args = ctx.message.text.trim().split(/\s+/);
  if (args.length !== 3) {
    return ctx.reply(
      '⚠️ Format salah.\nGunakan:\n`/editlimitquota <domain> <quota>`',
      { parse_mode: 'Markdown' }
    );
  }

  const domain = args[1];
  const quotaStr = args[2];

  if (!/^\d+$/.test(quotaStr)) {
    return ctx.reply('⚠️ `quota` harus berupa angka.', {
      parse_mode: 'Markdown',
    });
  }

  const quota = parseInt(quotaStr, 10);

  db.run(
    'UPDATE Server SET quota = ? WHERE domain = ?',
    [quota, domain],
    function (err) {
      if (err) {
        logger.error(
          '⚠️ Kesalahan saat mengedit quota server:',
          err.message
        );
        return ctx.reply('⚠️ Kesalahan saat mengedit quota server.', {
          parse_mode: 'Markdown',
        });
      }

      if (this.changes === 0) {
        return ctx.reply('⚠️ Server tidak ditemukan.', {
          parse_mode: 'Markdown',
        });
      }

      ctx.reply(
        `✅ Quota server \`${domain}\` berhasil diubah menjadi \`${quota}\`.`,
        { parse_mode: 'Markdown' }
      );
    }
  );
});

bot.command('editlimitip', async (ctx) => {
  if (!ensurePrivateChat(ctx)) return;

  const userId = ctx.message.from.id;
  if (!ADMIN_IDS.includes(userId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  // /editlimitip <domain> <iplimit>
  const args = ctx.message.text.trim().split(/\s+/);
  if (args.length !== 3) {
    return ctx.reply(
      '⚠️ Format salah.\nGunakan:\n`/editlimitip <domain> <iplimit>`',
      { parse_mode: 'Markdown' }
    );
  }

  const domain = args[1];
  const ipLimitStr = args[2];

  if (!/^\d+$/.test(ipLimitStr)) {
    return ctx.reply('⚠️ `iplimit` harus berupa angka.', {
      parse_mode: 'Markdown',
    });
  }

  const iplimit = parseInt(ipLimitStr, 10);

  db.run(
    'UPDATE Server SET iplimit = ? WHERE domain = ?',
    [iplimit, domain],
    function (err) {
      if (err) {
        logger.error(
          '⚠️ Kesalahan saat mengedit iplimit server:',
          err.message
        );
        return ctx.reply('⚠️ Kesalahan saat mengedit iplimit server.', {
          parse_mode: 'Markdown',
        });
      }

      if (this.changes === 0) {
        return ctx.reply('⚠️ Server tidak ditemukan.', {
          parse_mode: 'Markdown',
        });
      }

      ctx.reply(
        `✅ Limit IP server \`${domain}\` berhasil diubah menjadi \`${iplimit}\`.`,
        { parse_mode: 'Markdown' }
      );
    }
  );
});

bot.command('editlimitcreate', async (ctx) => {
  if (!ensurePrivateChat(ctx)) return;

  const userId = ctx.message.from.id;
  if (!ADMIN_IDS.includes(userId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  // /editlimitcreate <domain> <batas_create_akun>
  const args = ctx.message.text.trim().split(/\s+/);
  if (args.length !== 3) {
    return ctx.reply(
      '⚠️ Format salah.\nGunakan:\n`/editlimitcreate <domain> <batas_create_akun>`',
      { parse_mode: 'Markdown' }
    );
  }

  const domain = args[1];
  const batasStr = args[2];

  if (!/^\d+$/.test(batasStr)) {
    return ctx.reply(
      '⚠️ `batas_create_akun` harus berupa angka.',
      { parse_mode: 'Markdown' }
    );
  }

  const batas = parseInt(batasStr, 10);

  db.run(
    'UPDATE Server SET batas_create_akun = ? WHERE domain = ?',
    [batas, domain],
    function (err) {
      if (err) {
        logger.error(
          '⚠️ Kesalahan saat mengedit batas_create_akun server:',
          err.message
        );
        return ctx.reply(
          '⚠️ Kesalahan saat mengedit batas_create_akun server.',
          { parse_mode: 'Markdown' }
        );
      }

      if (this.changes === 0) {
        return ctx.reply('⚠️ Server tidak ditemukan.', {
          parse_mode: 'Markdown',
        });
      }

      ctx.reply(
        `✅ Batas create akun server \`${domain}\` berhasil diubah menjadi \`${batas}\`.`,
        { parse_mode: 'Markdown' }
      );
    }
  );
});

bot.command('edittotalcreate', async (ctx) => {
        // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  const userId = ctx.message.from.id;
  if (!ADMIN_IDS.includes(userId)) {
  return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}


  const args = ctx.message.text.split(' ');
  if (args.length !== 3) {
      return ctx.reply('⚠️ Format salah. Gunakan: `/edittotalcreate <domain> <total_create_akun>`', { parse_mode: 'Markdown' });
  }

  const [domain, total_create_akun] = args.slice(1);

  if (!/^\d+$/.test(total_create_akun)) {
      return ctx.reply('⚠️ `total_create_akun` harus berupa angka.', { parse_mode: 'Markdown' });
  }

  db.run("UPDATE Server SET total_create_akun = ? WHERE domain = ?", [parseInt(total_create_akun), domain], function(err) {
      if (err) {
          logger.error('⚠️ Kesalahan saat mengedit total_create_akun server:', err.message);
          return ctx.reply('⚠️ Kesalahan saat mengedit total_create_akun server.', { parse_mode: 'Markdown' });
      }

      if (this.changes === 0) {
          return ctx.reply('⚠️ Server tidak ditemukan.', { parse_mode: 'Markdown' });
      }

      ctx.reply(`✅ Total create akun server \`${domain}\` berhasil diubah menjadi \`${total_create_akun}\`.`, { parse_mode: 'Markdown' });
  });
});
async function handleServiceAction(ctx, action) {
  let keyboard;

  if (action === 'create') {
    keyboard = [
      [{ text: 'Buat Ssh/Ovpn', callback_data: 'create_ssh' }],
      [
        { text: 'Buat Vmess', callback_data: 'create_vmess' },
        { text: 'Buat Vless', callback_data: 'create_vless' }
      ],
      [
        { text: 'Buat Trojan', callback_data: 'create_trojan' },
        /*{ text: 'Buat Shadowsocks', callback_data: 'create_shadowsocks' }*/ 
        { text: '🔙 Kembali', callback_data: 'send_main_menu' }
      ]
    ];
  } else if (action === 'trial') {
    keyboard = [
      [{ text: 'Trial Ssh/Ovpn', callback_data: 'trial_ssh' }],
      [
        { text: 'Trial Vmess', callback_data: 'trial_vmess' },
        { text: 'Trial Vless', callback_data: 'trial_vless' }
      ],
      [
        { text: 'Trial Trojan', callback_data: 'trial_trojan' },
        /*{ text: 'Trial Shadowsocks', callback_data: 'trial_shadowsocks' }*/ 
        { text: '🔙 Kembali', callback_data: 'send_main_menu' }
      ],
    ];
  } else if (action === 'renew') {
    keyboard = [
      [{ text: 'Perpanjang Ssh/Ovpn', callback_data: 'renew_ssh' }],
      [
        { text: 'Perpanjang Vmess', callback_data: 'renew_vmess' },
        { text: 'Perpanjang Vless', callback_data: 'renew_vless' }
      ],
      [
        { text: 'Perpanjang Trojan', callback_data: 'renew_trojan' },
        /*{ text: 'Perpanjang Shadowsocks', callback_data: 'renew_shadowsocks' }*/ 
        { text: '🔙 Kembali', callback_data: 'send_main_menu' }
      ],
    ];
  } else if (action === 'del') {
    keyboard = [
      [{ text: 'Hapus Ssh/Ovpn', callback_data: 'del_ssh' }],
      [
        { text: 'Hapus Vmess', callback_data: 'del_vmess' },
        { text: 'Hapus Vless', callback_data: 'del_vless' }
      ],
      [
        { text: 'Hapus Trojan', callback_data: 'del_trojan' },
        /*{ text: 'Hapus Shadowsocks', callback_data: 'del_shadowsocks' }*/ 
        { text: '🔙 Kembali', callback_data: 'send_main_menu' }
      ],
    ];
  } else if (action === 'lock') {
    keyboard = [
      [{ text: 'Lock Ssh/Ovpn', callback_data: 'lock_ssh' }],
      [
        { text: 'Lock Vmess', callback_data: 'lock_vmess' },
        { text: 'Lock Vless', callback_data: 'lock_vless' }
      ],
      [
        { text: 'Lock Trojan', callback_data: 'lock_trojan' },
        /*{ text: 'Lock Shadowsocks', callback_data: 'lock_shadowsocks' }*/ 
        { text: '🔙 Kembali', callback_data: 'send_main_menu' }
      ],
    ];
  } else if (action === 'unlock') {
    keyboard = [
      [{ text: 'Unlock Ssh/Ovpn', callback_data: 'unlock_ssh' }],
      [
        { text: 'Unlock Vmess', callback_data: 'unlock_vmess' },
        { text: 'Unlock Vless', callback_data: 'unlock_vless' }
      ],
      [
        { text: 'Unlock Trojan', callback_data: 'unlock_trojan' },
        /*{ text: 'Unlock Shadowsocks', callback_data: 'unlock_shadowsocks' }*/ 
        { text: '🔙 Kembali', callback_data: 'send_main_menu' }
      ],
    ];
  }

  // 🔹 Khusus menu TRIAL: kirim teks penjelasan + keyboard dalam satu pesan
     if (action === 'trial') {
    let durationHours = 1;
    let maxPerDay = 1;
    let minBalance = 0;

    try {
      const cfg = await getTrialConfig();
      if (cfg) {
        if (Number.isInteger(cfg.durationHours))      durationHours = cfg.durationHours;
        if (Number.isInteger(cfg.maxPerDay))          maxPerDay     = cfg.maxPerDay;
        if (Number.isInteger(cfg.minBalanceForTrial)) minBalance    = cfg.minBalanceForTrial;
      }
    } catch (e) {
      logger.error('⚠️ Gagal membaca konfigurasi trial di handleServiceAction:', e.message);
    }

    let infoText =
      '⌛ *Trial Akun*\n\n' +
      `• Masa aktif trial saat ini sekitar *${durationHours} jam*.\n` +
      `• Setiap user bisa memakai trial hingga *${maxPerDay}x per hari* (kecuali reseller).\n`;

    if (minBalance > 0) {
      infoText +=
        `• Trial hanya bisa digunakan jika saldo kamu minimal *Rp${minBalance}*.\n`;
    }

    infoText +=
      '• Trial dipakai untuk coba kualitas server sebelum kamu beli akun berbayar.\n\n' +
      'Kalau cocok, kamu bisa lanjut beli akun lewat menu *➕ Buat Akun* atau daftar sebagai *Reseller*.\n\n' +
      'Silakan pilih jenis akun yang mau kamu coba:';

        try {
      await sendCleanMenu(ctx, infoText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
      logger.info('trial service menu sent (clean)');
    } catch (error) {
      logger.error('Error saat mengirim menu trial:', error);
    }
    return;
 }

    // 🔹 Untuk create / renew / del / lock / unlock → tampilkan menu lewat sendCleanMenu
  try {
    const msgText = `Pilih jenis layanan yang ingin Anda ${action}:`;
    await sendCleanMenu(ctx, msgText, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
    logger.info(`${action} service menu sent (clean)`);
  } catch (error) {
    logger.error(`Error saat mengirim menu ${action}:`, error);
  }
}

async function sendAdminMenu(ctx) {
  // === SUSUN TEKS INFO LISENSI (HANYA UNTUK ADMIN) ===
  let headerText = '<b>🔧 MENU ADMIN</b>';
  if (EXPIRE_DATE && ADMIN_IDS.includes(ctx.from.id)) {
    const info = getLicenseInfo();
    if (info) {
      const expireText = info.expire.toLocaleDateString('id-ID', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });

      let statusText;
      if (info.daysLeft > 0) {
        statusText =
          `🔐 <b>INFO LISENSI BOT</b>\n` +
          `Aktif sampai: <b>${expireText}</b>\n` +
          `Sisa: <b>${info.daysLeft}</b> hari`;
      } else if (info.daysLeft === 0) {
        statusText =
          `🔐 <b>INFO LISENSI BOT</b>\n` +
          `Berakhir: <b>${expireText}</b>\n` +
          `⏳ Status: <b>HARI INI</b>`;
      } else {
        statusText =
          `🔐 <b>INFO LISENSI BOT</b>\n` +
          `Habis: <b>${expireText}</b>\n` +
          `⛔ Lewat: <b>${Math.abs(info.daysLeft)}</b> hari lalu`;
      }

      headerText += `\n\n${statusText}`;
    }
  }

       // === TOMBOL ADMIN (RAPI, PAKAI SUBMENU SERVER) ===
      const adminKeyboard = [
  // 🧾 Submenu Reseller & Saldo
  [
    { text: '🧾 Menu Reseller & Saldo', callback_data: 'admin_reseller_menu' }
  ],

  // 🌐 Submenu Server
  [
    { text: '⚙️ Menu Server', callback_data: 'admin_server_menu' }
  ],

    // 📊 Monitoring & List User
  [
    { text: '📊 Monitor User & Reseller', callback_data: 'monitor_panel' },
    { text: '📋 List Semua User',         callback_data: 'list_all_users' }
  ],
    // 🚩 Flag / Tandai user
  [
    { text: '🚩 Tandai User', callback_data: 'flag_user_start' }
  ],
  // ⌛ Pengaturan Trial
  [
    { text: '⌛ Pengaturan Trial', callback_data: 'admin_trial_menu' }
  ],

  // 📦 Backup & auto backup
  [
    { text: '📦 Backup Database', callback_data: 'backup_db' },
    { text: '🗄️ Auto Backup',     callback_data: 'backup_auto_menu' }
  ],
  
// 🌏 Timezone bot
  [
    { text: '🌏 Timezone Bot', callback_data: 'timezone_menu' }
  ],
    // 🖼️ QRIS & pengingat expired
  [
    { text: '🖼️ Upload Gambar QRIS', callback_data: 'upload_qris' },
    { text: '⏰ Pengingat Expired',   callback_data: 'expiry_reminder_menu' }
  ],

  // 📢 Template promosi & pengumuman
  [
    { text: '📢 Template Promosi', callback_data: 'promo_template_menu' },
    { text: '📣 Kirim Pengumuman', callback_data: 'broadcast_menu' }
  ],
  [
    { text: '🔙 Kembali', callback_data: 'send_main_menu' }
  ]
];



    try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: adminKeyboard
    });
    logger.info('Admin menu sent');
  } catch (error) {
    if (error.response && error.response.error_code === 400) {
      await ctx.reply(headerText, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: adminKeyboard
        }
      });
      logger.info('Admin menu sent as new message');
    } else {
      logger.error('Error saat mengirim menu admin:', error);
    }
  }
}
// ====== ADMIN: PENGATURAN TRIAL ======
bot.action('admin_trial_menu', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }

    const cfg = await getTrialConfig();

    const tempCfg = {
      enabled: typeof cfg.enabled === 'boolean' ? cfg.enabled : DEFAULT_TRIAL_CONFIG.enabled,
      maxPerDay: Number.isInteger(cfg.maxPerDay) ? cfg.maxPerDay : DEFAULT_TRIAL_CONFIG.maxPerDay,
      durationHours: Number.isInteger(cfg.durationHours) ? cfg.durationHours : DEFAULT_TRIAL_CONFIG.durationHours,
      minBalanceForTrial: Number.isInteger(cfg.minBalanceForTrial) && cfg.minBalanceForTrial >= 0
        ? cfg.minBalanceForTrial
        : DEFAULT_TRIAL_CONFIG.minBalanceForTrial
    };

    adminTrialTemp[ctx.from.id] = tempCfg;

    await renderAdminTrialMenu(ctx, tempCfg, { edit: false });
  } catch (err) {
    logger.error('❌ Gagal membuka menu pengaturan trial:', err.message);
    ctx.reply('❌ Terjadi kesalahan saat membuka pengaturan trial.');
  }
});


bot.action('admin_trial_toggle', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }

    const temp = getAdminTrialTemp(ctx);
    temp.enabled = !temp.enabled;

    await renderAdminTrialMenu(ctx, temp, { edit: true });
  } catch (err) {
    logger.error('❌ Gagal mengubah status trial (temp):', err.message);
    ctx.reply('❌ Terjadi kesalahan saat mengubah status trial.');
  }
});

bot.action('admin_trial_max_inc', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }

    const temp = getAdminTrialTemp(ctx);
    let current = Number.isInteger(temp.maxPerDay)
      ? temp.maxPerDay
      : DEFAULT_TRIAL_CONFIG.maxPerDay;

    current += 1;
    if (current > 10) current = 10; // batas atas 10x/hari

    temp.maxPerDay = current;
    await renderAdminTrialMenu(ctx, temp, { edit: true });
  } catch (err) {
    logger.error('❌ Gagal menaikkan maxPerDay trial (temp):', err.message);
    ctx.reply('❌ Terjadi kesalahan saat mengubah batas trial per hari.');
  }
});

bot.action('admin_trial_max_dec', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }

    const temp = getAdminTrialTemp(ctx);
    let current = Number.isInteger(temp.maxPerDay)
      ? temp.maxPerDay
      : DEFAULT_TRIAL_CONFIG.maxPerDay;

    current -= 1;
    if (current < 1) current = 1; // minimal 1x/hari

    temp.maxPerDay = current;
    await renderAdminTrialMenu(ctx, temp, { edit: true });
  } catch (err) {
    logger.error('❌ Gagal menurunkan maxPerDay trial (temp):', err.message);
    ctx.reply('❌ Terjadi kesalahan saat mengubah batas trial per hari.');
  }
});
bot.action('admin_trial_min_inc', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }

    const temp = getAdminTrialTemp(ctx);
    let current = Number.isInteger(temp.minBalanceForTrial)
      ? temp.minBalanceForTrial
      : DEFAULT_TRIAL_CONFIG.minBalanceForTrial;

    const step = 1000;           // naik 1000 per klik (bisa kamu ubah)
    const maxVal = 1000000;      // batas atas 1 juta (bisa diubah juga)

    current += step;
    if (current > maxVal) current = maxVal;

    temp.minBalanceForTrial = current;
    await renderAdminTrialMenu(ctx, temp, { edit: true });
  } catch (err) {
    logger.error('❌ Gagal menaikkan minBalanceForTrial (temp):', err.message);
    ctx.reply('❌ Terjadi kesalahan saat mengubah minimal saldo trial.');
  }
});

bot.action('admin_trial_min_dec', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }

    const temp = getAdminTrialTemp(ctx);
    let current = Number.isInteger(temp.minBalanceForTrial)
      ? temp.minBalanceForTrial
      : DEFAULT_TRIAL_CONFIG.minBalanceForTrial;

    const step = 1000;
    current -= step;
    if (current < 0) current = 0;   // boleh 0 = bebas

    temp.minBalanceForTrial = current;
    await renderAdminTrialMenu(ctx, temp, { edit: true });
  } catch (err) {
    logger.error('❌ Gagal menurunkan minBalanceForTrial (temp):', err.message);
    ctx.reply('❌ Terjadi kesalahan saat mengubah minimal saldo trial.');
  }
});

bot.action('admin_trial_min_nop', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
});

bot.action('admin_trial_dur_inc', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }

    const temp = getAdminTrialTemp(ctx);
    let current = Number.isInteger(temp.durationHours)
      ? temp.durationHours
      : DEFAULT_TRIAL_CONFIG.durationHours;

    current += 1;
    if (current > 24) current = 24; // batas atas 24 jam

    temp.durationHours = current;
    await renderAdminTrialMenu(ctx, temp, { edit: true });
  } catch (err) {
    logger.error('❌ Gagal menaikkan durasi trial (temp):', err.message);
    ctx.reply('❌ Terjadi kesalahan saat mengubah durasi trial.');
  }
});

bot.action('admin_trial_dur_dec', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }

    const temp = getAdminTrialTemp(ctx);
    let current = Number.isInteger(temp.durationHours)
      ? temp.durationHours
      : DEFAULT_TRIAL_CONFIG.durationHours;

    current -= 1;
    if (current < 1) current = 1; // minimal 1 jam

    temp.durationHours = current;
    await renderAdminTrialMenu(ctx, temp, { edit: true });
  } catch (err) {
    logger.error('❌ Gagal menurunkan durasi trial (temp):', err.message);
    ctx.reply('❌ Terjadi kesalahan saat mengubah durasi trial.');
  }
});

bot.action('admin_trial_nop', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
});

bot.action('admin_trial_dur_nop', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
});

bot.action('admin_trial_save', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }

    const adminId = ctx.from.id;
    const temp = adminTrialTemp[adminId] || (await getTrialConfig());

    const normalized = {
      enabled: typeof temp.enabled === 'boolean' ? temp.enabled : DEFAULT_TRIAL_CONFIG.enabled,
      maxPerDay:
        Number.isInteger(temp.maxPerDay) && temp.maxPerDay > 0
          ? temp.maxPerDay
          : DEFAULT_TRIAL_CONFIG.maxPerDay,
      durationHours:
        Number.isInteger(temp.durationHours) && temp.durationHours > 0
          ? temp.durationHours
          : DEFAULT_TRIAL_CONFIG.durationHours,
      minBalanceForTrial:
        Number.isInteger(temp.minBalanceForTrial) && temp.minBalanceForTrial >= 0
          ? temp.minBalanceForTrial
          : DEFAULT_TRIAL_CONFIG.minBalanceForTrial
    };

    await updateTrialConfig(normalized);

    // Hapus draft sementara
    delete adminTrialTemp[adminId];

    const statusText = normalized.enabled ? 'Aktif ✅' : 'Nonaktif ⛔';

    await ctx.reply(
      '✅ *Pengaturan trial berhasil disimpan.*\n\n' +
      `Status trial          : *${statusText}*\n` +
      `Max trial / hari      : *${normalized.maxPerDay}x per user*\n` +
      `Lama trial per akun   : *${normalized.durationHours} jam*\n` +
      `Min saldo untuk trial : *Rp${normalized.minBalanceForTrial}*`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    logger.error('❌ Gagal menyimpan pengaturan trial:', err.message);
    ctx.reply('❌ Terjadi kesalahan saat menyimpan pengaturan trial.');
  }
});


function getAdminTrialTemp(ctx) {
  const adminId = ctx.from.id;
  let temp = adminTrialTemp[adminId];
  if (!temp) {
    temp = {
      enabled: DEFAULT_TRIAL_CONFIG.enabled,
      maxPerDay: DEFAULT_TRIAL_CONFIG.maxPerDay,
      durationHours: DEFAULT_TRIAL_CONFIG.durationHours
    };
    adminTrialTemp[adminId] = temp;
  }
  return temp;
}

async function renderResellerTargetMenu(ctx, options = {}) {
  const isEdit = options.edit || false;

  const statusText = RESELLER_TARGET_ENABLED ? 'Aktif ✅' : 'Nonaktif ⛔';
  const min30 = RESELLER_TARGET_MIN_30D_ACCOUNTS;
  const minDays = RESELLER_TARGET_MIN_DAYS_PER_MONTH;

  const message =
    '🎯 *Pengaturan Target Reseller*\n\n' +
    `Status target bulanan : *${statusText}*\n` +
    `Minimal akun 30 hari  : *${min30} akun/bulan*\n` +
    `Minimal total hari    : *${minDays} hari/bulan*\n\n` +
    '_Reseller yang tidak memenuhi salah satu target di atas ' +
    'pada akhir bulan akan otomatis turun menjadi member biasa._';

  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: RESELLER_TARGET_ENABLED ? '⛔ Nonaktifkan' : '✅ Aktifkan',
          callback_data: 'admin_res_target_toggle'
        }
      ],
      [
        { text: '➖', callback_data: 'admin_res_target_min30_dec' },
        {
          text: `Min 30 Hari: ${min30}`,
          callback_data: 'admin_res_target_min30_nop'
        },
        { text: '➕', callback_data: 'admin_res_target_min30_inc' }
      ],
      [
        { text: '⏬', callback_data: 'admin_res_target_days_dec' },
        {
          text: `Min Total: ${minDays} hari`,
          callback_data: 'admin_res_target_days_nop'
        },
        { text: '⏫', callback_data: 'admin_res_target_days_inc' }
      ],
      [
        {
          text: '🔙 Kembali ke Menu Reseller',
          callback_data: 'admin_reseller_menu'
        }
      ]
    ]
  };

  if (isEdit) {
    try {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      });
    } catch (err) {
      logger.error(
        'Gagal edit pesan menu target reseller:',
        err.message || err
      );
      try {
        await ctx.reply(message, {
          parse_mode: 'Markdown',
          reply_markup: replyMarkup
        });
      } catch (e2) {
        logger.error(
          'Gagal kirim pesan menu target reseller:',
          e2.message || e2
        );
      }
    }
  } else {
    try {
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      });
    } catch (err) {
      logger.error(
        'Gagal kirim pesan menu target reseller:',
        err.message || err
      );
    }
  }
}

async function renderAdminTrialMenu(ctx, cfg, options = {}) {
  const isEdit = options.edit || false;

  const statusText = cfg.enabled ? 'Aktif ✅' : 'Nonaktif ⛔';
  const maxPerDay = cfg.maxPerDay;
  const durationHours = cfg.durationHours;
  const minBalance = cfg.minBalanceForTrial || 0;

  const message =
    '⌛ *Pengaturan Trial Akun*\n\n' +
    `Status trial saat ini           : *${statusText}*\n` +
    `Maksimal trial / user / hari    : *${maxPerDay}x*\n` +
    `Lama trial (masa aktif akun)    : *${durationHours} jam*\n` +
    `Minimal saldo untuk trial       : *Rp${minBalance}*\n\n` +
    'Silakan atur nilai di bawah ini.\n' +
    'Perubahan *belum disimpan* sebelum kamu menekan tombol *✅ Simpan Pengaturan*.\n';

  const toggleText = cfg.enabled ? '⛔ Matikan Trial' : '✅ Aktifkan Trial';

  const replyMarkup = {
    inline_keyboard: [
      [{ text: toggleText, callback_data: 'admin_trial_toggle' }],
      [
        { text: '➖', callback_data: 'admin_trial_max_dec' },
        { text: `Max/Hari: ${maxPerDay}x`, callback_data: 'admin_trial_nop' },
        { text: '➕', callback_data: 'admin_trial_max_inc' }
      ],
      [
        { text: '⏬', callback_data: 'admin_trial_dur_dec' },
        { text: `Lama: ${durationHours} jam`, callback_data: 'admin_trial_dur_nop' },
        { text: '⏫', callback_data: 'admin_trial_dur_inc' }
      ],
      [
        { text: '⬇️', callback_data: 'admin_trial_min_dec' },
        { text: `Min Saldo: Rp${minBalance}`, callback_data: 'admin_trial_min_nop' },
        { text: '⬆️', callback_data: 'admin_trial_min_inc' }
      ],
      [
        { text: '✅ Simpan Pengaturan', callback_data: 'admin_trial_save' }
      ],
      [
        { text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' }
      ]
    ]
  };

  if (isEdit) {
    try {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      });
    } catch (err) {
      logger.error('Gagal edit pesan pengaturan trial, kirim baru:', err.message);
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      });
    }
  } else {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: replyMarkup
    });
  }
}


const resselFilePath = path.join(__dirname, 'ressel.db');

// Cache in-memory daftar reseller (string user_id)
let resellerCache = new Set();

/**
 * Load resellerCache dari file ressel.db (dipanggil saat start bot)
 */
function loadResellerCacheFromFile() {
  resellerCache = new Set();
  try {
    if (!fs.existsSync(resselFilePath)) {
      logger.info('ressel.db belum ada, resellerCache dikosongkan.');
      return;
    }

    const fileContent = fs.readFileSync(resselFilePath, 'utf8');
    fileContent
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '')
      .forEach((idStr) => {
        resellerCache.add(idStr);
      });

    logger.info(`Reseller cache dimuat: ${resellerCache.size} ID.`);
  } catch (e) {
    logger.error('⚠️ Gagal load resellerCache dari ressel.db:', e.message || e);
    resellerCache = new Set();
  }
}

/**
 * Simpan resellerCache ke file ressel.db
 */
function saveResellerCacheToFile() {
  try {
    const content =
      Array.from(resellerCache).join('\n') + (resellerCache.size ? '\n' : '');
    fs.writeFileSync(resselFilePath, content);
    logger.info(
      `Reseller cache disimpan ke ressel.db (${resellerCache.size} ID).`
    );
  } catch (e) {
    logger.error(
      '⚠️ Gagal menyimpan resellerCache ke ressel.db:',
      e.message || e
    );
  }
}

/**
 * Ambil snapshot Set reseller (untuk fungsi-fungsi lama yang butuh Set)
 */
function readResellerSetSync() {
  // sekarang tidak baca file lagi, pakai cache
  return new Set(resellerCache);
}

/**
 * Cek apakah user_id adalah reseller
 */
function isResellerId(userId) {
  if (!userId) return false;
  return resellerCache.has(String(userId));
}

/**
 * Tambah ID ke daftar reseller (update cache + file)
 */
function addResellerIdToCache(userId) {
  const idStr = String(userId).trim();
  if (!idStr) return false;
  if (resellerCache.has(idStr)) return false;

  resellerCache.add(idStr);
  saveResellerCacheToFile();
  return true;
}

/**
 * Hapus ID dari daftar reseller (update cache + file)
 */
function removeResellerIdFromCache(userId) {
  const idStr = String(userId).trim();
  if (!resellerCache.has(idStr)) return false;

  resellerCache.delete(idStr);
  saveResellerCacheToFile();
  return true;
}

// Panggil sekali saat start
loadResellerCacheFromFile();


// Ambil daftar target pengumuman sesuai pilihan
function getBroadcastTargetsFromMenu(target) {
  return new Promise((resolve, reject) => {
    if (target === 'all') {
      db.all('SELECT user_id FROM users', [], (err, rows) => {
        if (err) {
          logger.error('⚠️ Kesalahan saat mengambil daftar pengguna (broadcast menu all):', err.message);
          return reject(err);
        }
        const set = new Set();
        if (rows && rows.length > 0) {
          rows.forEach((r) => {
            const idNum = Number(r.user_id);
            if (!Number.isNaN(idNum)) {
              set.add(idNum);
            }
          });
        }
        resolve(set);
      });
      return;
    }

    // selain "all", butuh data reseller
    const resellerSet = readResellerSetSync();

    if (target === 'reseller') {
      const set = new Set();
      resellerSet.forEach((idStr) => {
        const idNum = Number(idStr);
        if (!Number.isNaN(idNum)) {
          set.add(idNum);
        }
      });
      resolve(set);
      return;
    }

    if (target === 'member') {
      db.all('SELECT user_id FROM users', [], (err, rows) => {
        if (err) {
          logger.error('⚠️ Kesalahan saat mengambil daftar pengguna (broadcast menu member):', err.message);
          return reject(err);
        }

        const set = new Set();
        if (rows && rows.length > 0) {
          rows.forEach((r) => {
            const idNum = Number(r.user_id);
            if (Number.isNaN(idNum)) return;

            const idStr = String(r.user_id);
            // Kecualikan reseller & admin
            if (resellerSet.has(idStr)) return;
            if (adminIds.includes(idNum)) return;
            if (idNum === MASTER_ID) return;

            set.add(idNum);
          });
        }
        resolve(set);
      });
      return;
    }

    // target tidak dikenal → kosong
    resolve(new Set());
  });
}

// ============================================================================

// ============ END SECTION: PAYMENT - QRIS AUTO TOPUP (ORDERKUOTA) ===========



// Kirim pengumuman ke target yang sudah dihitung
async function sendBroadcastFromMenu(ctx, target, message) {
  try {
    const targets = await getBroadcastTargetsFromMenu(target);

    if (!targets || targets.size === 0) {
      await ctx.reply('ℹ️ Tidak ada target yang cocok untuk pengumuman ini.');
      return;
    }

    let sukses = 0;
    let gagal = 0;

    for (const id of targets) {
      try {
        await bot.telegram.sendMessage(id, message, { parse_mode: 'HTML' });
        sukses++;
      } catch (e) {
        gagal++;
        logger.error(`⚠️ Gagal kirim pengumuman ke ${id}:`, e.message);
      }
    }

    // Simpan ringkasan ke memori
    const now = new Date();
    const timeLabel = now.toLocaleString('id-ID', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    // Potong pesan kalau terlalu panjang (biar ringkasan enak dibaca)
    const maxPreviewLen = 300;
    let previewMessage = message;
    if (previewMessage.length > maxPreviewLen) {
      previewMessage = previewMessage.slice(0, maxPreviewLen) + '...';
    }

    lastBroadcastInfo = {
      time: timeLabel,
      target,
      totalTarget: targets.size,
      sukses,
      gagal,
      messagePreview: previewMessage,
      fullMessage: message,
    };

    // Kirim ringkasan ke admin yang menjalankan
    await ctx.reply(
      `✅ Pengumuman selesai dikirim.\n` +
      `Waktu   : <b>${timeLabel}</b>\n` +
      `Target  : <b>${target}</b>\n` +
      `Total   : <b>${targets.size}</b> user\n` +
      `Berhasil: <b>${sukses}</b>, Gagal: <b>${gagal}</b>.`,
      { parse_mode: 'HTML' }
    );

    // Kirim ringkasan ke MASTER_ID (kalau beda dengan pengirim)
    try {
      if (MASTER_ID && ctx.from && ctx.from.id !== MASTER_ID) {
        await bot.telegram.sendMessage(
          MASTER_ID,
          `📢 <b>Ringkasan Pengumuman</b>\n` +
          `Dikirim oleh: <code>${ctx.from.id}</code>\n` +
          `Waktu   : <b>${timeLabel}</b>\n` +
          `Target  : <b>${target}</b>\n` +
          `Total   : <b>${targets.size}</b> user\n` +
          `Berhasil: <b>${sukses}</b>, Gagal: <b>${gagal}</b>\n\n` +
          `<b>Preview Pesan:</b>\n` +
          previewMessage,
          { parse_mode: 'HTML' }
        );
      }
    } catch (e) {
      logger.error('⚠️ Gagal kirim ringkasan broadcast ke MASTER_ID:', e.message);
    }
  } catch (err) {
    logger.error('❌ Error di sendBroadcastFromMenu:', err);
    await ctx.reply('❌ Terjadi kesalahan saat mengirim pengumuman.');
  }
}

// ==== MENU 📢 PENGUMUMAN DI ADMIN ====
bot.action('broadcast_menu', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) {
    return;
  }

  const adminId = ctx.from.id;
  if (!adminIds.includes(adminId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  broadcastSessions[adminId] = { step: 'choose_target' };

  const text =
    '📢 <b>Kirim Pengumuman</b>\n\n' +
    'Silakan pilih target pengumuman:\n' +
    '• 👥 Semua User\n' +
    '• 🧑‍💼 Reseller\n' +
    '• 👤 Member (bukan reseller & bukan admin)\n\n' +
    'Setelah pilih target, kirim teks pengumuman di chat ini.';

  const keyboard = [
    [
      { text: '👥 Semua User', callback_data: 'broadcast_target_all' },
    ],
    [
      { text: '🧑‍💼 Reseller', callback_data: 'broadcast_target_reseller' },
      { text: '👤 Member', callback_data: 'broadcast_target_member' },
    ],
    [
      { text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' },
    ],
  ];

  return ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard },
  });
});

async function handleBroadcastTargetFromMenu(ctx, target) {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) return;
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  let targetLabel = 'semua user';
  if (target === 'reseller') targetLabel = 'semua reseller';
  else if (target === 'member') targetLabel = 'member (bukan reseller & bukan admin)';

  // Simpan target, dan tunggu user pilih MODE (manual / template)
  broadcastSessions[adminId] = {
    step: 'choose_mode',
    target,
  };

  await ctx.reply(
    `📢 Pengumuman ke <b>${targetLabel}</b>\n\n` +
      'Pilih cara membuat pengumuman:\n' +
      '• ✍️ Tulis manual (ketik bebas)\n' +
      '• 🔧 Template Maintenance VPN\n' +
      '• 🏷 Template Promo/Diskon VPN',
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✍️ Tulis Manual', callback_data: 'broadcast_mode_manual' },
          ],
          [
            { text: '🔧 Maintenance VPN', callback_data: 'broadcast_mode_maintenance' },
          ],
          [
            { text: '🏷 Promo / Diskon', callback_data: 'broadcast_mode_promo' },
          ],
          [
            { text: '❌ Batal', callback_data: 'broadcast_cancel' },
          ],
        ],
      },
    }
  );
}
// Mode: Tulis manual
bot.action('broadcast_mode_manual', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) return;
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  const state = broadcastSessions[adminId];
  if (!state || !state.target) {
    return ctx.reply('ℹ️ Tidak ada sesi pengumuman yang aktif. Mulai dari menu 📢 lagi.');
  }

  state.step = 'wait_message';

  await ctx.reply(
    '✍️ Silakan kirim teks pengumuman yang ingin dikirim.\n' +
      '• Kalau ingin batal, kirim perintah lain (misalnya /start).',
    { parse_mode: 'HTML' }
  );
});

// Mode: Template Maintenance VPN
bot.action('broadcast_mode_maintenance', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) return;
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  const state = broadcastSessions[adminId];
  if (!state || !state.target) {
    return ctx.reply('ℹ️ Tidak ada sesi pengumuman yang aktif. Mulai dari menu 📢 lagi.');
  }

  // Step pertama: minta nama server/layanan
  state.step = 'tm_ask_layanan';

  await ctx.reply(
    '🔧 Template Maintenance VPN\n\n' +
      '1️⃣ Masukkan nama server atau layanan yang terkena maintenance.\n' +
      'Contoh:\n' +
      '• Semua server VPN\n' +
      '• Server SG-1 & SG-2\n' +
      '• Layanan SSH & VMESS',
    { parse_mode: 'HTML' }
  );
});

// Mode: Template Promo / Diskon VPN
bot.action('broadcast_mode_promo', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) return;
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  const state = broadcastSessions[adminId];
  if (!state || !state.target) {
    return ctx.reply('ℹ️ Tidak ada sesi pengumuman yang aktif. Mulai dari menu 📢 lagi.');
  }

  // Step pertama: minta nama paket promo
  state.step = 'promo_ask_paket';

  await ctx.reply(
    '🏷 Template Promo / Diskon VPN\n\n' +
      '1️⃣ Masukkan nama paket atau jenis promo.\n' +
      'Contoh:\n' +
      '• Paket 30 Hari All Server\n' +
      '• Promo Akhir Bulan 7 Hari\n' +
      '• Diskon 30% semua paket bulanan',
    { parse_mode: 'HTML' }
  );
});

bot.action('broadcast_target_all', async (ctx) => {
  return handleBroadcastTargetFromMenu(ctx, 'all');
});

bot.action('broadcast_target_reseller', async (ctx) => {
  return handleBroadcastTargetFromMenu(ctx, 'reseller');
});

bot.action('broadcast_target_member', async (ctx) => {
  return handleBroadcastTargetFromMenu(ctx, 'member');
});

bot.action('broadcast_confirm', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) return;
  const adminId = ctx.from.id;

  const state = broadcastSessions[adminId];
  if (!state || state.step !== 'confirm' || !state.message || !state.target) {
    return ctx.reply('ℹ️ Tidak ada pengumuman yang menunggu konfirmasi.');
  }

  const target = state.target;
  const message = state.message;

  delete broadcastSessions[adminId];

  await ctx.reply('⏳ Mengirim pengumuman, mohon tunggu...');
  await sendBroadcastFromMenu(ctx, target, message);
});

bot.action('broadcast_cancel', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) return;
  const adminId = ctx.from.id;

  if (broadcastSessions[adminId]) {
    delete broadcastSessions[adminId];
  }

  await ctx.reply('❌ Pengumuman dibatalkan.');
});

// ============================================================================
// SECTION: PAYMENT - TRIGGER TOPUP OTOMATIS (COMMAND & BUTTON)
// - /topupqris      : user ketik command manual
// - topupqris_btn   : user klik tombol di menu utama
// ============================================================================
bot.command('topupqris', async (ctx) => {
  await openTopupQrisMenu(ctx);
});

// User klik tombol di menu utama
bot.action('topupqris_btn', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await openTopupQrisMenu(ctx);
});
// ===== END SECTION: PAYMENT - TRIGGER TOPUP OTOMATIS =======================

bot.action('qris_auto_topup', async (ctx) => {
  try {
    const userId = String(ctx.from.id);

    // pastikan object-nya ada
    global.depositState = global.depositState || {};
    global.depositState[userId] = { amount: '' };

    const msg =
      `💰 *Silakan masukkan jumlah nominal saldo yang Anda ingin tambahkan ke akun Anda:*\n\n` +
      `Jumlah saat ini: *Rp 0*`;

    const opts = {
      reply_markup: { inline_keyboard: keyboard_nomor() },
      parse_mode: 'Markdown',
    };

    // kalau tombol ditekan dari pesan lama, coba edit biar tidak bikin pesan baru
    try {
      await ctx.editMessageText(msg, opts);
    } catch {
      await ctx.reply(msg, opts);
    }

    await ctx.answerCbQuery('OK').catch(() => {});
  } catch (e) {
    try { await ctx.answerCbQuery('Gagal membuka topup', { show_alert: true }); } catch {}
  }
});

bot.command('addressel', async (ctx) => {
  // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  try {
    const requesterId = ctx.from.id;

    // Hanya admin yang bisa menjalankan perintah ini
    if (!adminIds.includes(requesterId)) {
      return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
    }

    // Ambil ID Telegram dari argumen
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply(
        '⚠️ <b>Format salah.</b>\n\n' +
          'Gunakan:\n' +
          '<code>/addressel &lt;user_id&gt;</code>\n\n' +
          'Contoh:\n' +
          '<code>/addressel 5439429147</code>',
        { parse_mode: 'HTML' }
      );
    }

    const targetId = args[1].trim();

    if (!targetId) {
      return ctx.reply('⚠️ user_id tidak valid.', { parse_mode: 'HTML' });
    }

    // Cek di cache dulu
    if (isResellerId(targetId)) {
      return ctx.reply(
        `⚠️ User dengan ID <code>${targetId}</code> sudah menjadi reseller.`,
        { parse_mode: 'HTML' }
      );
    }

    // Tambah ke cache + simpan ke file
    const added = addResellerIdToCache(targetId);
    if (!added) {
      return ctx.reply(
        `⚠️ Gagal menambahkan ID <code>${targetId}</code> ke daftar reseller.`,
        { parse_mode: 'HTML' }
      );
    }

    ctx.reply(
      `✅ User dengan ID <code>${targetId}</code> berhasil dijadikan reseller.`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    logger.error('❌ Error di command /addressel:', e.message || e);
    ctx.reply('❌ Terjadi kesalahan saat menjalankan perintah.');
  }
});


bot.command('delressel', async (ctx) => {
  // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  try {
    const requesterId = ctx.from.id;

    // Hanya admin yang bisa menjalankan perintah ini
    if (!adminIds.includes(requesterId)) {
      return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
    }

    // Ambil ID Telegram dari argumen
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply(
        '⚠️ <b>Format salah.</b>\n\n' +
          'Gunakan:\n' +
          '<code>/delressel &lt;user_id&gt;</code>\n\n' +
          'Contoh:\n' +
          '<code>/delressel 5439429147</code>',
        { parse_mode: 'HTML' }
      );
    }

    const targetId = args[1].trim();

    if (!targetId) {
      return ctx.reply('⚠️ user_id tidak valid.', { parse_mode: 'HTML' });
    }

    if (!isResellerId(targetId)) {
      return ctx.reply(
        `ℹ️ User dengan ID <code>${targetId}</code> tidak ada di daftar reseller.`,
        { parse_mode: 'HTML' }
      );
    }

    const removed = removeResellerIdFromCache(targetId);
    if (!removed) {
      return ctx.reply(
        `⚠️ Gagal menghapus ID <code>${targetId}</code> dari daftar reseller.`,
        { parse_mode: 'HTML' }
      );
    }

    ctx.reply(
      `✅ User dengan ID <code>${targetId}</code> berhasil dihapus dari daftar reseller.`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    logger.error('❌ Error di command /delressel:', e.message || e);
    ctx.reply('❌ Terjadi kesalahan saat menjalankan perintah.');
  }
});


// ============================================================================
// SECTION: PAYMENT - HANDLER TOPUP MANUAL (ADMIN & USER)
// - bot.on('photo')       : admin kirim QRIS statis (disimpan ke qris.jpg)
// - bot.action('upload_qris') : tombol admin untuk mulai upload QRIS
// - bot.action('topup_manual'): tombol user untuk topup manual via QRIS
// ============================================================================
bot.on('photo', async (ctx) => {
  const adminId = ctx.from.id;
  const state = userState[adminId];
  if (!state || state.step !== 'upload_qris') return;

  const fileId = ctx.message.photo.pop().file_id;
  const fileLink = await ctx.telegram.getFileLink(fileId);
  const filePath = path.join(__dirname, 'qris.jpg');

  const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
  fs.writeFileSync(filePath, Buffer.from(response.data));

  await ctx.reply('✅ Gambar QRIS berhasil diunggah!');
  logger.info('🖼️ QRIS image uploaded by admin');
  delete userState[adminId];
});
// === 🖼️ UPLOAD GAMBAR QRIS ===
bot.action('upload_qris', async (ctx) => {
  const adminId = ctx.from.id;
  if (!adminIds.includes(adminId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  await ctx.reply('📸 Kirim gambar QRIS yang ingin digunakan:');
  userState[adminId] = { step: 'upload_qris' };
});

///////////////////////
// ====== TOPUP SALDO MANUAL (QRIS) ======
bot.action('topup_manual', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    const qrisPath = path.join(__dirname, 'qris.jpg');

    const storeName = NAMA_STORE || 'Layanan VPN';
    const adminName = ADMIN_USERNAME || 'Admin';
    const userId = ctx.from.id;

    const captionText = `
<b>📲 Top Up Saldo Manual via QRIS - ${storeName}</b>

1️⃣ Scan QRIS di atas dengan aplikasi pembayaran kamu.
2️⃣ Masukkan nominal sesuai saldo yang ingin kamu isi.
💸 Minimal top up: <b>Rp15.000</b>.
3️⃣ Setelah pembayaran <b>BERHASIL</b>, kirim bukti ke admin ${adminName}.

<b>📝 Format pesan ke admin:</b>
<code>Saya sudah top up saldo.
ID Telegram : ${userId}
Nominal     : Rp...
Metode      : QRIS</code>

Kalau belum pernah chat admin, klik username ${adminName}${ADMIN_WHATSAPP ? ` atau hubungi via WhatsApp:\nhttps://wa.me/${ADMIN_WHATSAPP.replace(/[^0-9]/g, '')}` : ''}

<i>Admin akan mengecek pembayaran kamu dan mengisi saldo secepatnya.</i>
`.trim();

        if (fs.existsSync(qrisPath)) {
      // Hapus menu sebelumnya kalau ada
      const userIdForTopup = ctx.from.id;
      const prevId = lastMenuMsgId.get(userIdForTopup);
      if (prevId) {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, prevId);
        } catch (e) {
          // kalau gagal hapus (pesan sudah lama / tidak boleh dihapus) abaikan saja
        }
      }

      // Kirim foto QRIS + caption
      const sent = await ctx.replyWithPhoto(
        { source: qrisPath },
        {
          caption: captionText,
          parse_mode: 'HTML',
        }
      );

      // Simpan ID pesan foto sebagai "menu" terakhir
      if (sent && sent.message_id) {
        lastMenuMsgId.set(userIdForTopup, sent.message_id);
      }
    } else {
      const msgText =
        `⚠️ QRIS belum diunggah oleh admin. Silakan hubungi ${adminName}.`;

      // Hapus menu sebelumnya kalau ada
      const userIdForTopup = ctx.from.id;
      const prevId = lastMenuMsgId.get(userIdForTopup);
      if (prevId) {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, prevId);
        } catch (e) {}
      }

      // Kirim pesan info & simpan ID sebagai menu terakhir
      const sent = await ctx.reply(msgText);
      if (sent && sent.message_id) {
        lastMenuMsgId.set(userIdForTopup, sent.message_id);
      }
    }
  } catch (err) {
    logger.error('❌ Error di topup_manual:', err.message);
    try {
      await sendCleanMenu(ctx, '❌ Terjadi kesalahan saat menampilkan QRIS.', {
        parse_mode: 'HTML',
      });
    } catch (e) {}
  }
});
// ===== END SECTION: PAYMENT - HANDLER TOPUP MANUAL (ADMIN & USER) ==========

/////
// ====== FUNGSI BACKUP OTOMATIS KE TELEGRAM ======
async function sendAutoBackup(reason = 'backup otomatis') {
  try {
    if (!BACKUP_CHAT_ID) {
      logger.warn('BACKUP_CHAT_ID tidak diset, lewati backup otomatis.');
      return;
    }

    const candidateFiles = [
      path.join(__dirname, 'sellvpn.db'),
      path.join(__dirname, 'ressel.db'),
      path.join(__dirname, 'trial.db'),
      path.join(__dirname, '.vars.json'),
    ];

    // Hanya kirim file yang benar-benar ada
    const files = candidateFiles.filter(filePath => fs.existsSync(filePath));

    if (files.length === 0) {
      await bot.telegram.sendMessage(
        BACKUP_CHAT_ID,
        '⚠️ Backup otomatis gagal: tidak ada file database yang ditemukan.'
      );
      return;
    }

    const waktu = new Date().toLocaleString('id-ID', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    await bot.telegram.sendMessage(
      BACKUP_CHAT_ID,
      `🗄️ Mulai backup otomatis bot VPN.\nAlasan: <b>${reason}</b>\nWaktu: <b>${waktu}</b>`,
      { parse_mode: 'HTML' }
    );

    for (const filePath of files) {
      const filename = path.basename(filePath);

      try {
        await bot.telegram.sendDocument(
          BACKUP_CHAT_ID,
          { source: filePath, filename },
          {
            caption: `📦 Backup: <b>${filename}</b>\nWaktu: <b>${waktu}</b>`,
            parse_mode: 'HTML',
          }
        );
      } catch (err) {
        logger.error(`❌ Gagal mengirim backup file ${filename}: ${err.message}`);
      }
    }

    await bot.telegram.sendMessage(
      BACKUP_CHAT_ID,
      `✅ Backup otomatis selesai.\nTotal file: <b>${files.length}</b>`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    logger.error('❌ Error di sendAutoBackup:', err);
  }
}

// ===== LAPORAN HARIAN KE MASTER =====
async function sendDailyReport(isManual = false) {
  try {
    if (!MASTER_ID) {
      logger.warn('MASTER_ID tidak diset, lewati laporan harian.');
      return;
    }

    const chatId = MASTER_ID;

    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();
    const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;

    const tanggalLabel = now.toLocaleDateString('id-ID', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });


    // === Akun dibuat hari ini ===
    const totalCreatedToday = await new Promise((resolve) => {
      db.get(
        'SELECT COUNT(*) AS count FROM accounts WHERE created_at >= ? AND created_at < ?',
        [todayStart, tomorrowStart],
        (err, row) => {
          if (err) {
            logger.error('Gagal menghitung akun hari ini:', err.message);
            return resolve(0);
          }
          resolve(row ? row.count : 0);
        }
      );
    });

    // === Ringkasan akun aktif / expired (pakai logika sama kayak monitor_panel) ===
    const [totalAccounts, totalActiveAccounts, totalExpiredAccounts] = await Promise.all([
      new Promise((resolve) => {
        db.get('SELECT COUNT(*) AS count FROM accounts', [], (err, row) => {
          if (err) {
            logger.error('Gagal menghitung total accounts:', err.message);
            return resolve(0);
          }
          resolve(row ? row.count : 0);
        });
      }),
      new Promise((resolve) => {
        db.get(
          'SELECT COUNT(*) AS count FROM accounts WHERE expires_at IS NULL OR expires_at > ?',
          [Date.now()],
          (err, row) => {
            if (err) {
              logger.error('Gagal menghitung akun aktif:', err.message);
              return resolve(0);
            }
            resolve(row ? row.count : 0);
          }
        );
      }),
      new Promise((resolve) => {
        db.get(
          'SELECT COUNT(*) AS count FROM accounts WHERE expires_at IS NOT NULL AND expires_at <= ?',
          [Date.now()],
          (err, row) => {
            if (err) {
              logger.error('Gagal menghitung akun expired:', err.message);
              return resolve(0);
            }
            resolve(row ? row.count : 0);
          }
        );
      }),
    ]);

    // === Total user & reseller ===
    const totalUsers = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) AS count FROM users', [], (err, row) => {
        if (err) {
          logger.error('Gagal menghitung total users:', err.message);
          return resolve(0);
        }
        resolve(row ? row.count : 0);
      });
    });

    let resellerSet = new Set();
    let totalReseller = 0;
    try {
      if (fs.existsSync(resselFilePath)) {
        const fileContent = fs.readFileSync(resselFilePath, 'utf8');
        const resellerList = fileContent
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l !== '');
        resellerSet = new Set(resellerList);
        totalReseller = resellerSet.size;
      }
    } catch (e) {
      logger.error('Gagal membaca ressel.db saat laporan harian:', e.message);
    }

    // === Top reseller HARI INI + total lifetime ===
    const topResellerRows = await new Promise((resolve) => {
      db.all(
        `SELECT user_id,
                COUNT(*) AS total_all,
                SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) AS total_today
         FROM accounts
         GROUP BY user_id
         ORDER BY total_today DESC, total_all DESC`,
        [todayStart, tomorrowStart],
        (err, rows) => {
          if (err) {
            logger.error('Gagal mengambil data top reseller (harian):', err.message);
            return resolve([]);
          }
          resolve(rows || []);
        }
      );
    });

    const topResellersToday = [];
    for (const row of topResellerRows) {
      const uidStr = String(row.user_id);
      if (!resellerSet.has(uidStr)) continue; // hanya reseller

      if (row.total_today > 0) {
        topResellersToday.push(row);
      }
      if (topResellersToday.length >= 5) break; // top 5 aja
    }

    const lines = [];
    lines.push(`<b>📅 Laporan Harian Bot VPN — ${tanggalLabel}</b>\n`);

    lines.push('<code>Ringkasan Pengguna</code>');
    lines.push(`• Total user    : <b>${totalUsers}</b>`);
    lines.push(`• Total reseller: <b>${totalReseller}</b>\n`);

    lines.push('<code>Ringkasan Akun</code>');
    lines.push(`• Total akun (semua) : <b>${totalAccounts}</b>`);
    lines.push(`• Akun aktif sekarang: <b>${totalActiveAccounts}</b>`);
    lines.push(`• Akun expired        : <b>${totalExpiredAccounts}</b>\n`);

    lines.push('<code>Aktivitas Hari Ini</code>');
    lines.push(`• Akun dibuat hari ini: <b>${totalCreatedToday}</b>\n`);

    lines.push('<code>Top Reseller Hari Ini</code>');
    if (topResellersToday.length === 0) {
      lines.push('Belum ada reseller yang membuat akun hari ini.');
    } else {
      let no = 1;
      for (const r of topResellersToday) {
        let username = '';
        try {
          username = await getUsernameById(r.user_id);
        } catch (e) {
          username = '';
        }

        const displayName = username
          ? (username.startsWith('@') ? username : '@' + username)
          : `ID:${r.user_id}`;

        const totalToday = r.total_today || 0;
        const totalAll = r.total_all || 0;

        lines.push(
          `${no}. ${displayName} — hari ini: <b>${totalToday}</b> akun | total: <b>${totalAll}</b> akun`
        );
        no++;
      }
    }

    lines.push('\n<i>Laporan ini dikirim ' + (isManual ? 'manual (/daily_report_test).' : 'otomatis setiap hari.') + '</i>');

    const text = lines.join('\n');

    await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
    logger.info('Laporan harian berhasil dikirim ke MASTER_ID.');
  } catch (err) {
    logger.error('❌ Error di sendDailyReport:', err);
  }
}
// ===============================
// PENGINGAT AKUN AKAN EXPIRED (H-n)
// ===============================
async function sendExpiryReminders() {
  try {
    if (!EXPIRY_REMINDER_ENABLED) {
      logger.info('Expiry reminder nonaktif, lewati pengecekan.');
      return;
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const now = new Date();

    // Awal hari (00:00) hari ini (pakai waktu server)
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();

    // Target H-n
    const targetStart =
      todayStart + EXPIRY_REMINDER_DAYS_BEFORE * dayMs;
    const targetEnd = targetStart + dayMs;

    logger.info(
      `Cek akun yang expired H-${EXPIRY_REMINDER_DAYS_BEFORE} (range=${targetStart}..${targetEnd})`
    );

    const rows = await new Promise((resolve, reject) => {
db.all(
  `
  SELECT a.user_id,
         a.username,
         a.type,
         a.server_id,
         a.expires_at,
         s.nama_server
  FROM accounts a
  LEFT JOIN Server s ON a.server_id = s.id
  WHERE a.expires_at IS NOT NULL
    AND a.expires_at >= ?
    AND a.expires_at < ?
`,
  [targetStart, targetEnd],
  (err, rows) => {
          if (err) {
            logger.error(
              '❌ Gagal membaca akun untuk reminder expired:',
              err.message
            );
            return reject(err);
          }
          resolve(rows || []);
        }
      );
    });

    if (!rows.length) {
      logger.info(
        `Tidak ada akun yang perlu diingatkan (H-${EXPIRY_REMINDER_DAYS_BEFORE}).`
      );
      return;
    }

    // Group per user_id
    const grouped = {};
    for (const row of rows) {
      if (!row.user_id) continue;
      const uid = String(row.user_id);
      if (!grouped[uid]) grouped[uid] = [];
      grouped[uid].push(row);
    }

    const targetDateLabel = new Date(targetStart).toLocaleDateString(
      'id-ID',
      {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }
    );

    let userCount = 0;
    let successCount = 0;
    let failCount = 0;

    for (const [userIdStr, accs] of Object.entries(grouped)) {
      const userIdNum = Number(userIdStr);
      if (!userIdNum) continue;

      userCount++;

const akunLines = accs
  .map((acc, idx) => {
    const expLabel = new Date(acc.expires_at).toLocaleDateString(
      'id-ID',
      {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }
    );

    let serverLabel = '-';
    if (
      typeof acc.server_id !== 'undefined' &&
      acc.server_id !== null
    ) {
      if (acc.nama_server && String(acc.nama_server).trim() !== '') {
        serverLabel = String(acc.nama_server);   // contoh: ID neva
      } else {
        serverLabel = `Server #${acc.server_id}`;
      }
    }

    const uname = acc.username || '-';
    const jenis = acc.type || 'AKUN';

    // satu baris, hemat tempat
    return `${idx + 1}. ${uname} | ${jenis} | ${serverLabel} | exp: ${expLabel}`;
  })
  .join('\n');

const akunLinesBlock = `<code>${akunLines}</code>`;

const text =
  `🔔 <b>Peringatan Akun VPN Akan Berakhir</b>\n\n` +
  `Beberapa akun VPN kamu akan expired <b>H-${EXPIRY_REMINDER_DAYS_BEFORE} (tanggal ${targetDateLabel})</b>:\n\n` +
  `${akunLinesBlock}\n\n` +
  `Kalau mau perpanjang, silakan buka menu bot:\n` +
  `• /start → 📂 Akun Saya → pilih akun → Perpanjang.\n\n` +
  `Kalau sudah diperpanjang, pesan ini bisa diabaikan 😊`;

      try {
        await bot.telegram.sendMessage(userIdNum, text, {
          parse_mode: 'HTML',
        });
        successCount++;
      } catch (err) {
        failCount++;
        logger.warn(
          `Gagal kirim reminder expired ke user ${userIdNum}:`,
          err.message || err
        );
      }
    }

    logger.info(
      `Reminder expired selesai: ${rows.length} akun, ${userCount} user, sukses=${successCount}, gagal=${failCount}`
    );

    // Kirim ringkasan ke MASTER_ID (kalau mau tau kerja bot)
    if (MASTER_ID) {
      try {
        await bot.telegram.sendMessage(
          MASTER_ID,
          `ℹ️ <b>Laporan Pengingat Expired</b>\n\n` +
            `Hari ini cek H-${EXPIRY_REMINDER_DAYS_BEFORE} (tanggal ${targetDateLabel}).\n` +
            `Total akun: <b>${rows.length}</b>\n` +
            `Total user: <b>${userCount}</b>\n` +
            `Berhasil dikirimi: <b>${successCount}</b>\n` +
            `Gagal (bot diblokir / error kirim): <b>${failCount}</b>`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        logger.warn(
          'Gagal kirim ringkasan reminder expired ke MASTER_ID:',
          e.message || e
        );
      }
    }
  } catch (err) {
    logger.error('❌ Error di sendExpiryReminders:', err);
  }
}
function startDailyReportScheduler() {
  const CHECK_INTERVAL_MS = 60 * 1000; // cek tiap 1 menit

  setInterval(async () => {
    try {
      // Kalau dimatikan dari menu admin, jangan kirim apa-apa
      if (!DAILY_REPORT_ENABLED) return;

      const { dateKey, hour, minute } = getTimeInConfiguredTimeZone();

      if (dateKey === lastDailyReportDateKey) return;

      if (hour === DAILY_REPORT_HOUR && minute === DAILY_REPORT_MINUTE) {
        logger.info('Waktu laporan harian tercapai, mengirim laporan...');
        await sendDailyReport(false);
        lastDailyReportDateKey = dateKey;
      }
    } catch (err) {
      logger.error('❌ Error di scheduler laporan harian:', err);
    }
  }, CHECK_INTERVAL_MS);

    logger.info(
    `Scheduler laporan harian aktif: jam ${DAILY_REPORT_HOUR}:${String(
      DAILY_REPORT_MINUTE
    ).padStart(2, '0')} (zona ${TIME_ZONE}, cek tiap 1 menit)`
  );
}


function startExpiryReminderScheduler() {
  const CHECK_INTERVAL_MS = 60 * 1000; // cek tiap 1 menit

  logger.info(
    `Scheduler pengingat expired aktif: jam ${EXPIRY_REMINDER_HOUR}:${String(
      EXPIRY_REMINDER_MINUTE
    ).padStart(2, '0')} (zona ${TIME_ZONE}, cek tiap 1 menit)`
  );

  setInterval(async () => {
    try {
      // Kalau OFF dari menu admin, jangan kirim apa-apa
      if (!EXPIRY_REMINDER_ENABLED) return;

      const { dateKey, hour, minute } = getTimeInConfiguredTimeZone();

      // Biar sehari cuma sekali per tanggal
      if (dateKey === lastExpiryReminderDateKey) return;

      // Konversi ke total menit
      const nowTotalMinutes = hour * 60 + minute;
      const targetTotalMinutes =
        Number(EXPIRY_REMINDER_HOUR) * 60 +
        Number(EXPIRY_REMINDER_MINUTE);

      // Kalau jam sekarang SUDAH lewat jam target dan
      // hari ini belum pernah kirim → kirim sekali
      if (nowTotalMinutes >= targetTotalMinutes) {
        logger.info(
          'Waktu reminder expired tercapai (atau sudah lewat dikit), mulai kirim pengingat...'
        );
        await sendExpiryReminders();
        lastExpiryReminderDateKey = dateKey;
      }
    } catch (err) {
      logger.error('❌ Error di scheduler reminder expired:', err);
    }
  }, CHECK_INTERVAL_MS);
}

// === CEK TARGET RESELLER & AUTO-DOWNGRADE BULANAN ===
async function checkAndDowngradeResellersForPreviousMonth() {
  try {
    const { dateKey } = getTimeInConfiguredTimeZone();
    const [yearStr, monthStr] = dateKey.split('-');
    let year = Number(yearStr);
    let month = Number(monthStr);

    // periode yang dicek = bulan sebelumnya
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }

    const monthKey = `${year}-${String(month).padStart(2, '0')}`;

    const monthStart = new Date(year, month - 1, 1).getTime();
    const monthEnd = new Date(year, month, 1).getTime();

    const resellerSet = readResellerSetSync();
    if (!resellerSet || resellerSet.size === 0) {
      logger.info(`[ResellerTarget] Tidak ada reseller di cache, lewati periode ${monthKey}.`);
      return;
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const downgraded = [];

    for (const idStr of resellerSet) {
      const userId = Number(idStr);
      if (!userId || Number.isNaN(userId)) continue;

      const accounts = await new Promise((resolve) => {
        db.all(
          `SELECT created_at, expires_at
           FROM accounts
           WHERE user_id = ?
             AND created_at >= ?
             AND created_at < ?`,
          [userId, monthStart, monthEnd],
          (err, rows) => {
            if (err) {
              logger.error(
                `[ResellerTarget] Gagal ambil data akun untuk user ${userId}:`,
                err.message || err
              );
              return resolve([]);
            }
            resolve(rows || []);
          }
        );
      });

      let totalAccounts = accounts.length;
      let totalDays = 0;
      let count30Days = 0;

      for (const acc of accounts) {
        if (!acc.expires_at || !acc.created_at) continue;

        const durMs = acc.expires_at - acc.created_at;
        let durDays = Math.round(durMs / dayMs);
        if (durDays < 1) durDays = 1;

        totalDays += durDays;
        if (durDays >= 30) count30Days++;
      }

      const meets30 = count30Days >= RESELLER_TARGET_MIN_30D_ACCOUNTS;
      const meetsDays = totalDays >= RESELLER_TARGET_MIN_DAYS_PER_MONTH;

      // kalau TIDAK memenuhi salah satu pun → downgrade
      if (!meets30 && !meetsDays) {
        const removed = removeResellerIdFromCache(userId);
        if (removed) {
          downgraded.push({ userId, totalAccounts, totalDays, count30Days });
        }
      }
    }

    // Kirim notifikasi ke reseller yang didowngrade
    for (const info of downgraded) {
      const { userId, totalAccounts, totalDays, count30Days } = info;
      try {
        await bot.telegram.sendMessage(
          userId,
          `⚠️ <b>Status Reseller Dibatalkan</b>\n\n` +
          `Bulan sebelumnya kamu tidak mencapai target penjualan.\n\n` +
          `<b>Ringkasan bulan ${monthKey}</b>\n` +
          `• Akun terjual        : <b>${totalAccounts}</b>\n` +
          `• Akun ≥ 30 hari      : <b>${count30Days}</b>\n` +
          `• Total hari akumulasi: <b>${totalDays}</b> hari\n\n` +
          `Status kamu sekarang berubah menjadi <b>member biasa</b>.\n` +
          `Silakan hubungi admin bila ingin mengajukan jadi reseller lagi.`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        logger.error(
          `[ResellerTarget] Gagal kirim pesan downgrade ke user ${userId}:`,
          e.message || e
        );
      }
    }

    // Laporan ke MASTER
    if (MASTER_ID && downgraded.length > 0) {
      const lines = downgraded.map((d, idx) =>
        `${idx + 1}. ID <code>${d.userId}</code> — akun: <b>${d.totalAccounts}</b>, 30d: <b>${d.count30Days}</b>, total hari: <b>${d.totalDays}</b>`
      );

      const msg =
        `<b>📉 Laporan Auto-Downgrade Reseller</b>\n` +
        `Periode: <b>${monthKey}</b>\n` +
        `Total reseller didowngrade: <b>${downgraded.length}</b>\n\n` +
        lines.join('\n');

      try {
        await bot.telegram.sendMessage(MASTER_ID, msg, { parse_mode: 'HTML' });
      } catch (e) {
        logger.error(
          '[ResellerTarget] Gagal kirim laporan downgrade ke MASTER_ID:',
          e.message || e
        );
      }
    }

    logger.info(
      `[ResellerTarget] Cek target reseller periode ${monthKey} selesai. Didowngrade: ${downgraded.length}`
    );
  } catch (err) {
    logger.error(
      '[ResellerTarget] Error di checkAndDowngradeResellersForPreviousMonth:',
      err
    );
  }
}

function startResellerTargetScheduler() {
  const CHECK_INTERVAL_MS = 60 * 1000; // cek tiap 1 menit

  logger.info(
    `Scheduler target reseller aktif: jam ${RESELLER_TARGET_CHECK_HOUR}:${String(
      RESELLER_TARGET_CHECK_MINUTE
    ).padStart(2, '0')} (zona ${TIME_ZONE}, cek tiap 1 menit)`
  );

  setInterval(async () => {
    try {
      if (!RESELLER_TARGET_ENABLED) return;

      const { dateKey, hour, minute } = getTimeInConfiguredTimeZone();
      if (
        hour !== RESELLER_TARGET_CHECK_HOUR ||
        minute !== RESELLER_TARGET_CHECK_MINUTE
      ) {
        return;
      }

      const [yearStr, monthStr, dayStr] = dateKey.split('-');
      const day = Number(dayStr);

      // hanya jalan di hari pertama tiap bulan
      if (day !== 1) return;

      let year = Number(yearStr);
      let month = Number(monthStr) - 1; // periode yang dicek = bulan sebelumnya
      if (month === 0) {
        month = 12;
        year -= 1;
      }

      const monthKey = `${year}-${String(month).padStart(2, '0')}`;

      if (lastResellerTargetMonthKey === monthKey) {
        // sudah pernah diproses untuk bulan ini
        return;
      }

      lastResellerTargetMonthKey = monthKey;

      await checkAndDowngradeResellersForPreviousMonth();
    } catch (err) {
      logger.error('[ResellerTarget] Error di scheduler target reseller:', err);
    }
  }, CHECK_INTERVAL_MS);
}


// === 🗂️ BACKUP DATABASE DAN KIRIM KE ADMIN ===
bot.action('backup_db', async (ctx) => {
  try {
    const adminId = ctx.from.id;

    // Hanya admin yang bisa pakai
    if (!adminIds.includes(adminId)) {
      return ctx.reply('🚫 Kamu tidak memiliki izin untuk melakukan tindakan ini.');
    }

    const dbPath = path.join(__dirname, 'sellvpn.db');
    if (!fs.existsSync(dbPath)) {
      return ctx.reply('⚠️ File database tidak ditemukan.');
    }

    // Kirim file sellvpn.db ke admin
    await ctx.replyWithDocument({ source: dbPath, filename: 'sellvpn.db' }, {
      caption: '📦 Backup database berhasil dikirim!',
    });

    logger.info(`📤 Backup database dikirim ke admin ${adminId}`);
  } catch (error) {
    logger.error('❌ Gagal mengirim file backup ke admin:', error);
    ctx.reply('❌ Terjadi kesalahan saat mengirim file backup.');
  }

});

// Buka menu pengingat expired
bot.action('expiry_reminder_menu', async (ctx) => {
  const adminId = ctx.from.id;

  // Hanya admin/master
  if (!ADMIN_IDS.includes(adminId)) {
    return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
  }

  await ctx.answerCbQuery().catch(() => {});

  try {
    await ctx.editMessageText(getExpiryReminderStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildExpiryReminderKeyboard(),
    });
  } catch (e) {
    logger.error('❌ Gagal kirim menu pengingat expired:', e.message);
    await ctx.reply(getExpiryReminderStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildExpiryReminderKeyboard(),
    });
  }
});

// ====== ADMIN: TIMEZONE BOT ======

function getTimezoneStatusText() {
  const nowSample = new Date().toLocaleString('id-ID', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    '🌏 <b>PENGATURAN TIMEZONE BOT</b>\n\n' +
    `Timezone saat ini: <b>${TIME_ZONE}</b>\n` +
    `Waktu sekarang (versi bot): <b>${nowSample}</b>\n\n` +
    'Timezone ini dipakai untuk:\n' +
    '• Laporan harian\n' +
    '• Pengingat expired akun\n' +
    '• Tampilan info lisensi /health\n\n' +
    'Silakan pilih timezone yang sesuai dengan lokasi kamu.'
  );
}

function buildTimezoneKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'WIB (Jakarta)',  callback_data: 'timezone_set_wib' },
        { text: 'WITA (Makassar)', callback_data: 'timezone_set_wita' },
      ],
      [
        { text: 'WIT (Jayapura)', callback_data: 'timezone_set_wit' },
      ],
      [
        { text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' },
      ],
    ],
  };
}

// Buka menu timezone
bot.action('timezone_menu', async (ctx) => {
  const adminId = ctx.from.id;
  if (!ADMIN_IDS.includes(adminId)) {
    return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
  }

  await ctx.answerCbQuery().catch(() => {});

  try {
    await ctx.reply(getTimezoneStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildTimezoneKeyboard(),
    });
  } catch (e) {
    logger.error('❌ Gagal kirim menu timezone:', e.message || e);
  }
});

async function setTimezoneAndRefresh(ctx, tzValue, label) {
  const adminId = ctx.from.id;
  if (!ADMIN_IDS.includes(adminId)) {
    return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
  }

  TIME_ZONE = tzValue;
  saveTimeZoneConfig();

  await ctx.answerCbQuery(`Timezone diatur ke ${label}.`, {
    show_alert: false,
  });

  try {
    await ctx.editMessageText(getTimezoneStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildTimezoneKeyboard(),
    });
  } catch {
    await ctx.reply(getTimezoneStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildTimezoneKeyboard(),
    });
  }
}

bot.action('timezone_set_wib', (ctx) =>
  setTimezoneAndRefresh(ctx, 'Asia/Jakarta', 'WIB (Asia/Jakarta)')
);
bot.action('timezone_set_wita', (ctx) =>
  setTimezoneAndRefresh(ctx, 'Asia/Makassar', 'WITA (Asia/Makassar)')
);
bot.action('timezone_set_wit', (ctx) =>
  setTimezoneAndRefresh(ctx, 'Asia/Jayapura', 'WIT (Asia/Jayapura)')
);


// ON/OFF
bot.action('expiry_reminder_toggle', async (ctx) => {
  const adminId = ctx.from.id;
  if (!ADMIN_IDS.includes(adminId)) {
    return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
  }

  EXPIRY_REMINDER_ENABLED = !EXPIRY_REMINDER_ENABLED;
  saveExpiryReminderConfig();

  await ctx.answerCbQuery(
    EXPIRY_REMINDER_ENABLED
      ? 'Pengingat expired diaktifkan.'
      : 'Pengingat expired dimatikan.',
    { show_alert: false }
  );

  try {
    await ctx.editMessageText(getExpiryReminderStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildExpiryReminderKeyboard(),
    });
  } catch {
    await ctx.reply(getExpiryReminderStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildExpiryReminderKeyboard(),
    });
  }
});

// Ubah jam/menit dan refresh tampilan
async function adjustReminderTimeAndRefresh(ctx, deltaHour, deltaMinute) {
  const adminId = ctx.from.id;
  if (!ADMIN_IDS.includes(adminId)) {
    return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
  }

  if (deltaHour) {
    EXPIRY_REMINDER_HOUR =
      (EXPIRY_REMINDER_HOUR + deltaHour + 24) % 24;
  }

  if (deltaMinute) {
    let total = EXPIRY_REMINDER_MINUTE + deltaMinute;
    while (total < 0) total += 60;
    while (total >= 60) total -= 60;
    EXPIRY_REMINDER_MINUTE = total;
  }

  saveExpiryReminderConfig();

  await ctx.answerCbQuery('Waktu pengingat diubah.', {
    show_alert: false,
  });

  try {
    await ctx.editMessageText(getExpiryReminderStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildExpiryReminderKeyboard(),
    });
  } catch {
    await ctx.reply(getExpiryReminderStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildExpiryReminderKeyboard(),
    });
  }
}

bot.action('expiry_hour_minus', (ctx) =>
  adjustReminderTimeAndRefresh(ctx, -1, 0)
);
bot.action('expiry_hour_plus', (ctx) =>
  adjustReminderTimeAndRefresh(ctx, +1, 0)
);

bot.action('expiry_minute_minus', (ctx) =>
  adjustReminderTimeAndRefresh(ctx, 0, -5)
);
bot.action('expiry_minute_plus', (ctx) =>
  adjustReminderTimeAndRefresh(ctx, 0, +5)
);

// Preset H-1 / H-2 / H-3
async function setReminderDaysPreset(ctx, value) {
  const adminId = ctx.from.id;
  if (!ADMIN_IDS.includes(adminId)) {
    return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
  }

  EXPIRY_REMINDER_DAYS_BEFORE = value;
  saveExpiryReminderConfig();

  await ctx.answerCbQuery(`Diatur ke H-${value}.`, {
    show_alert: false,
  });

  try {
    await ctx.editMessageText(getExpiryReminderStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildExpiryReminderKeyboard(),
    });
  } catch {
    await ctx.reply(getExpiryReminderStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildExpiryReminderKeyboard(),
    });
  }
}

bot.action('expiry_days_1', (ctx) => setReminderDaysPreset(ctx, 1));
bot.action('expiry_days_2', (ctx) => setReminderDaysPreset(ctx, 2));
bot.action('expiry_days_3', (ctx) => setReminderDaysPreset(ctx, 3));

function getExpiryReminderStatusText() {
  const statusText = EXPIRY_REMINDER_ENABLED ? '🟢 ON' : '🔴 OFF';
  const hourStr = String(EXPIRY_REMINDER_HOUR).padStart(2, '0');
  const minuteStr = String(EXPIRY_REMINDER_MINUTE).padStart(2, '0');

  return (
    '<b>⏰ Pengaturan Pengingat Expired Akun</b>\n\n' +
    `Status       : <b>${statusText}</b>\n` +
    `Waktu kirim  : <b>${hourStr}:${minuteStr}</b> (waktu server)\n` +
    `Hari sebelum : <b>H-${EXPIRY_REMINDER_DAYS_BEFORE}</b>\n\n` +
    'Bot akan mengirim pesan ke user yang punya akun akan expired pada hari tersebut.'
  );
}

function buildExpiryReminderKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: EXPIRY_REMINDER_ENABLED
            ? '🔌 Matikan Pengingat'
            : '⚡ Nyalakan Pengingat',
          callback_data: 'expiry_reminder_toggle',
        },
      ],
      [
        { text: '⏬ Jam -1', callback_data: 'expiry_hour_minus' },
        { text: '⏫ Jam +1', callback_data: 'expiry_hour_plus' },
      ],
      [
        { text: '⏬ Menit -5', callback_data: 'expiry_minute_minus' },
        { text: '⏫ Menit +5', callback_data: 'expiry_minute_plus' },
      ],
      [
        { text: 'H-1', callback_data: 'expiry_days_1' },
        { text: 'H-2', callback_data: 'expiry_days_2' },
        { text: 'H-3', callback_data: 'expiry_days_3' },
      ],
      [
        { text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' },
      ],
    ],
  };
}

function getAutoBackupStatusText() {
  const statusText = AUTO_BACKUP_ENABLED ? '🟢 ON' : '🔴 OFF';
  return (
    '<b>🗄️ Pengaturan Auto Backup Database</b>\n\n' +
    `Status   : <b>${statusText}</b>\n` +
    `Interval : <b>${AUTO_BACKUP_INTERVAL_HOURS}</b> jam\n` +
    `Tujuan   : <code>${BACKUP_CHAT_ID}</code>\n\n` +
    'Gunakan tombol di bawah untuk mengaktifkan/nonaktifkan dan mengubah interval backup.'
  );
}

function buildAutoBackupKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: AUTO_BACKUP_ENABLED ? '🔌 Matikan Auto Backup' : '⚡ Nyalakan Auto Backup',
          callback_data: 'backup_auto_toggle',
        },
      ],
      [
        { text: '⏬ -1 jam', callback_data: 'backup_auto_interval_minus' },
        { text: '⏫ +1 jam', callback_data: 'backup_auto_interval_plus' },
      ],
      [
        { text: '6 jam',  callback_data: 'backup_auto_set_6' },
        { text: '12 jam', callback_data: 'backup_auto_set_12' },
        { text: '24 jam', callback_data: 'backup_auto_set_24' },
      ],
      [
        { text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' },
      ],
    ],
  };
}

// Buka menu pengaturan auto-backup
bot.action('backup_auto_menu', async (ctx) => {
  const adminId = ctx.from.id;
  if (adminId !== MASTER_ID) {
  return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
}

  await ctx.answerCbQuery().catch(() => {});
  try {
    await ctx.reply(getAutoBackupStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildAutoBackupKeyboard(),
    });
  } catch (e) {
    logger.error('❌ Gagal kirim menu auto backup:', e.message);
  }
});

// Toggle ON/OFF
bot.action('backup_auto_toggle', async (ctx) => {
  const adminId = ctx.from.id;
  if (adminId !== MASTER_ID) {
  return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
}

  AUTO_BACKUP_ENABLED = !AUTO_BACKUP_ENABLED;
  saveAutoBackupConfig();
  restartAutoBackupScheduler();

  await ctx.answerCbQuery(
    AUTO_BACKUP_ENABLED ? 'Auto-backup diaktifkan.' : 'Auto-backup dimatikan.',
    { show_alert: false }
  );

  try {
    await ctx.editMessageText(getAutoBackupStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildAutoBackupKeyboard(),
    });
  } catch {
    await ctx.reply(getAutoBackupStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildAutoBackupKeyboard(),
    });
  }
});

// Ubah interval ±1 jam
async function adjustIntervalAndRefresh(ctx, delta) {
  const adminId = ctx.from.id;
  if (adminId !== MASTER_ID) {
  return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
}

  AUTO_BACKUP_INTERVAL_HOURS = Math.max(1, AUTO_BACKUP_INTERVAL_HOURS + delta); // minimal 1 jam
  saveAutoBackupConfig();
  restartAutoBackupScheduler();

  await ctx.answerCbQuery(`Interval diatur: ${AUTO_BACKUP_INTERVAL_HOURS} jam.`, {
    show_alert: false,
  });

  try {
    await ctx.editMessageText(getAutoBackupStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildAutoBackupKeyboard(),
    });
  } catch {
    await ctx.reply(getAutoBackupStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildAutoBackupKeyboard(),
    });
  }
}

bot.action('backup_auto_interval_minus', (ctx) => adjustIntervalAndRefresh(ctx, -1));
bot.action('backup_auto_interval_plus', (ctx) => adjustIntervalAndRefresh(ctx, +1));

// Preset interval 6 / 12 / 24 jam
async function setIntervalPreset(ctx, value) {
  const adminId = ctx.from.id;
  if (adminId !== MASTER_ID) {
  return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
}

  AUTO_BACKUP_INTERVAL_HOURS = value;
  saveAutoBackupConfig();
  restartAutoBackupScheduler();

  await ctx.answerCbQuery(`Interval diatur: ${value} jam.`, { show_alert: false });

  try {
    await ctx.editMessageText(getAutoBackupStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildAutoBackupKeyboard(),
    });
  } catch {
    await ctx.reply(getAutoBackupStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildAutoBackupKeyboard(),
    });
  }
}

bot.action('backup_auto_set_6',  (ctx) => setIntervalPreset(ctx, 6));
bot.action('backup_auto_set_12', (ctx) => setIntervalPreset(ctx, 12));
bot.action('backup_auto_set_24', (ctx) => setIntervalPreset(ctx, 24));

// === 💳 CEK SALDO USER ===
bot.action('cek_saldo_user', async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply('🚫 Anda tidak memiliki izin untuk menggunakan fitur ini.');
  }

  await ctx.answerCbQuery();
  await ctx.reply('🔍 Masukkan ID Telegram user yang ingin dicek saldonya:');
  userState[adminId] = { step: 'cek_saldo_userid' };
});

// === 📜 RIWAYAT SALDO USER ===
bot.action('riwayat_saldo_user', async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply('🚫 Anda tidak memiliki izin untuk menggunakan fitur ini.');
  }

  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('📜 Masukkan ID Telegram user/reseller yang ingin dilihat riwayat saldonya:');

  userState[adminId] = { step: 'riwayat_saldo_userid' };
});

// === 🚩 TANDAI / ATUR STATUS USER (NORMAL / WATCHLIST / NAKAL) ===
bot.action('flag_user_start', async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply('🚫 Anda tidak memiliki izin untuk menggunakan fitur ini.');
  }

  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    '🚩 *Mode tandai user*\n\n' +
      'Silakan kirim *ID Telegram user* yang ingin diatur statusnya.\n' +
      'Ketik *batal* untuk keluar dari mode ini.',
    { parse_mode: 'Markdown' }
  );

  // Simpan state: admin ini sekarang lagi mode input ID untuk flag user
  userState[adminId] = { step: 'flag_user_wait_id' };
});

// === Handler tombol pilih status: NORMAL / WATCHLIST / NAKAL ===
bot.action(/flag_user_set_(NORMAL|WATCHLIST|NAKAL)_(\d+)/, async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply('🚫 Anda tidak memiliki izin untuk menggunakan fitur ini.');
  }

  await ctx.answerCbQuery().catch(() => {});

  const newStatus = ctx.match[1]; // NORMAL / WATCHLIST / NAKAL
  const targetId = ctx.match[2];

  db.run(
    'UPDATE users SET flag_status = ? WHERE user_id = ?',
    [newStatus, targetId],
    function (err) {
      if (err) {
        logger.error('❌ Gagal mengupdate flag_status user:', err.message);
        return ctx.reply('❌ Terjadi kesalahan saat mengupdate status user.');
      }

      if (this.changes === 0) {
        return ctx.reply(
          `⚠️ User dengan ID ${targetId} tidak ditemukan di tabel users.`
        );
      }

      let label = '✅ NORMAL';
      if (newStatus === 'WATCHLIST') label = '⚠️ WATCHLIST';
      else if (newStatus === 'NAKAL') label = '🚫 NAKAL';

      ctx.reply(
        `✅ Status user \`${targetId}\` berhasil diubah menjadi: ${label}`,
        { parse_mode: 'Markdown' }
      );
    }
  );

  // Bersihkan state khusus flag kalau ada
  if (
    userState[adminId] &&
    userState[adminId].step &&
    userState[adminId].step.toString().startsWith('flag_user')
  ) {
    delete userState[adminId];
  }
});

// === 📊 MONITOR USER & RESELLER ===
bot.action('monitor_panel', async (ctx) => {
  const adminId = ctx.from.id;

  // Hanya admin yang boleh akses menu ini
  if (!ADMIN_IDS.includes(adminId)) {
    return ctx.reply('🚫 Anda tidak memiliki izin untuk menggunakan menu ini.');
  }

  await ctx.answerCbQuery().catch(() => {});

  try {
    const nowTs = Date.now();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    // ======= RINGKASAN PENGGUNA =======
    const totalUsers = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) AS count FROM users', [], (err, row) => {
        if (err) {
          logger.error('Gagal menghitung total users:', err.message);
          return resolve(0);
        }
        resolve(row ? row.count : 0);
      });
    });

    // ======= RINGKASAN AKUN =======
    const [totalAccounts, totalActiveAccounts, totalExpiredAccounts] = await Promise.all([
      new Promise((resolve) => {
        db.get('SELECT COUNT(*) AS count FROM accounts', [], (err, row) => {
          if (err) {
            logger.error('Gagal menghitung total accounts:', err.message);
            return resolve(0);
          }
          resolve(row ? row.count : 0);
        });
      }),
      new Promise((resolve) => {
        db.get(
          'SELECT COUNT(*) AS count FROM accounts WHERE expires_at IS NULL OR expires_at > ?',
          [nowTs],
          (err, row) => {
            if (err) {
              logger.error('Gagal menghitung akun aktif:', err.message);
              return resolve(0);
            }
            resolve(row ? row.count : 0);
          }
        );
      }),
      new Promise((resolve) => {
        db.get(
          'SELECT COUNT(*) AS count FROM accounts WHERE expires_at IS NOT NULL AND expires_at <= ?',
          [nowTs],
          (err, row) => {
            if (err) {
              logger.error('Gagal menghitung akun expired:', err.message);
              return resolve(0);
            }
            resolve(row ? row.count : 0);
          }
        );
      }),
    ]);

    // ======= BACA DAFTAR RESELLER DARI ressel.db =======
    let resellerSet = new Set();
    let totalReseller = 0;
    try {
      if (fs.existsSync(resselFilePath)) {
        const fileContent = fs.readFileSync(resselFilePath, 'utf8');
        const resellerList = fileContent
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l !== '');
        resellerSet = new Set(resellerList);
        totalReseller = resellerSet.size;
      }
    } catch (e) {
      logger.error('Gagal membaca ressel.db saat monitor_panel:', e.message);
    }

    // ======= TOP 5 RESELLER (BULAN INI + TOTAL) =======
    const topResellerRows = await new Promise((resolve) => {
      db.all(
        `SELECT user_id,
                COUNT(*) AS total_all,
                SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS total_month
         FROM accounts
         GROUP BY user_id
         ORDER BY total_month DESC, total_all DESC`,
        [monthStart],
        (err, rows) => {
          if (err) {
            logger.error('Gagal mengambil data top reseller (bulan):', err.message);
            return resolve([]);
          }
          resolve(rows || []);
        }
      );
    });

    const topResellers = [];
    for (const row of topResellerRows) {
      const uidStr = String(row.user_id);
      if (!resellerSet.has(uidStr)) continue; // hanya reseller

      // fokus ke yang punya aktivitas bulan ini
      if (row.total_month > 0) {
        topResellers.push(row);
      }
      if (topResellers.length >= 5) break;
    }

    // ======= SUSUN TEKS =======
    const lines = [];
    lines.push('<b>📊 Monitor User & Reseller</b>\n');

    // Ringkasan pengguna
    lines.push('<code>Ringkasan Pengguna</code>');
    lines.push(`• Total user terdaftar : <b>${totalUsers}</b>`);
    lines.push(`• Total reseller       : <b>${totalReseller}</b>\n`);

    // Ringkasan akun
    lines.push('<code>Ringkasan Akun</code>');
    lines.push(`• Total akun dibuat    : <b>${totalAccounts}</b>`);
    lines.push(`• Akun aktif sekarang  : <b>${totalActiveAccounts}</b>`);
    lines.push(`• Akun sudah expired   : <b>${totalExpiredAccounts}</b>\n`);

    // Top reseller
    lines.push('<code>Top 5 Reseller (berdasarkan akun bulan ini)</code>');
    if (topResellers.length === 0) {
      lines.push('Belum ada reseller yang membuat akun di bulan ini.');
    } else {
      let no = 1;
      for (const r of topResellers) {
        let username = '';
        try {
          username = await getUsernameById(r.user_id);
        } catch (e) {
          username = '';
        }

        const displayName = username
          ? (username.startsWith('@') ? username : '@' + username)
          : `ID:${r.user_id}`;

        const totalMonth = r.total_month || 0;
        const totalAll = r.total_all || 0;

        lines.push(
          `${no}. ${displayName} — bulan ini: <b>${totalMonth}</b> akun | total: <b>${totalAll}</b> akun`
        );
        no++;
      }
    }

    const text = lines.join('\n');

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' }],
        ],
      },
    });
  } catch (err) {
    logger.error('❌ Error di monitor_panel:', err);
    await ctx.reply('❌ Terjadi kesalahan saat menampilkan monitor user & reseller.');
  }
});

// === 👥 MENU LIST RESELLER & MEMBER ===
bot.action('list_res_mem', async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply('🚫 Anda tidak memiliki izin untuk menggunakan menu ini.');
  }

  await ctx.answerCbQuery().catch(() => {});

  await ctx.reply('Pilih daftar yang ingin ditampilkan:', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📋 List Reseller', callback_data: 'list_reseller' },
          { text: '📋 List Member',  callback_data: 'list_member'  }
        ],
        [
          { text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' }
        ]
      ]
    }
  });
});

// Tombol balik ke menu admin
bot.action('admin_menu', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await sendAdminMenu(ctx);
});
// === SUBMENU: RESELLER & SALDO ===
bot.action('admin_reseller_menu', async (ctx) => {
  const adminId = ctx.from.id;

  // Pastikan cuma admin yang bisa buka
  if (!adminIds.includes(adminId)) {
    return ctx
      .answerCbQuery('🚫 Khusus admin.', { show_alert: true })
      .catch(() => {});
  }

  await ctx.answerCbQuery().catch(() => {});

  const text =
    '<b>🧾 MENU RESELLER & SALDO</b>\n\n' +
    'Semua pengaturan yang berhubungan dengan reseller & saldo:\n\n' +
    '• Tambah server reseller\n' +
    '• Tambah saldo user / reseller\n' +
    '• Lihat riwayat saldo\n' +
    '• Lihat daftar reseller & member\n' +
    '• Upload QRIS untuk topup manual\n';

  const keyboard = [
    [
      { text: '🤝 Tambah Server Reseller', callback_data: 'addserver_reseller' }
    ],
    [
      { text: '💵 Tambah Saldo User',      callback_data: 'tambah_saldo' },
      { text: '📜 Riwayat Saldo User',    callback_data: 'riwayat_saldo_user' }
    ],
    [
      { text: '👥 List Res & Member',      callback_data: 'list_res_mem' }
    ],
        [
      { text: '🎯 Target Reseller',        callback_data: 'admin_reseller_target' }
    ],
    [
      { text: '🖼️ Upload Gambar QRIS',     callback_data: 'upload_qris' }
    ],
    [
      { text: '🔙 Kembali ke Menu Admin',  callback_data: 'admin_menu' }
    ]
  ];

  try {
    // Coba edit pesan inline yang sebelumnya (lebih rapi)
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (err) {
    logger.error('Error saat buka submenu reseller:', err.message || err);
    // Fallback: kalau nggak bisa edit (misal pesan lama), kirim pesan baru
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  }
});

// Buka menu "🎯 Target Reseller"
bot.action('admin_reseller_target', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('❌ *Menu ini khusus admin.*', {
        parse_mode: 'Markdown'
      });
    }

    await renderResellerTargetMenu(ctx, { edit: false });
  } catch (err) {
    logger.error('Gagal membuka menu target reseller:', err.message || err);
    ctx.reply('❌ Terjadi kesalahan saat membuka menu target reseller.');
  }
});

// ON/OFF target reseller
bot.action('admin_res_target_toggle', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('❌ *Menu ini khusus admin.*', {
        parse_mode: 'Markdown'
      });
    }

    RESELLER_TARGET_ENABLED = !RESELLER_TARGET_ENABLED;

    updateResellerTargetVars({
      RESELLER_TARGET_ENABLED: RESELLER_TARGET_ENABLED
    });

    await renderResellerTargetMenu(ctx, { edit: true });
  } catch (err) {
    logger.error('Gagal toggle RESELLER_TARGET_ENABLED:', err.message || err);
    ctx.reply('❌ Terjadi kesalahan saat mengubah status target reseller.');
  }
});

// Naikkan minimal akun 30 hari
bot.action('admin_res_target_min30_inc', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('❌ *Menu ini khusus admin.*', {
        parse_mode: 'Markdown'
      });
    }

    RESELLER_TARGET_MIN_30D_ACCOUNTS =
      Number(RESELLER_TARGET_MIN_30D_ACCOUNTS || 0) + 1;
    if (RESELLER_TARGET_MIN_30D_ACCOUNTS < 1)
      RESELLER_TARGET_MIN_30D_ACCOUNTS = 1;

    updateResellerTargetVars({
      RESELLER_TARGET_MIN_30D_ACCOUNTS
    });

    await renderResellerTargetMenu(ctx, { edit: true });
  } catch (err) {
    logger.error('Gagal menaikkan target akun 30 hari:', err.message || err);
    ctx.reply('❌ Terjadi kesalahan saat mengubah target akun 30 hari.');
  }
});

// Turunkan minimal akun 30 hari (minimal 1)
bot.action('admin_res_target_min30_dec', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('❌ *Menu ini khusus admin.*', {
        parse_mode: 'Markdown'
      });
    }

    RESELLER_TARGET_MIN_30D_ACCOUNTS =
      Number(RESELLER_TARGET_MIN_30D_ACCOUNTS || 1) - 1;
    if (RESELLER_TARGET_MIN_30D_ACCOUNTS < 1)
      RESELLER_TARGET_MIN_30D_ACCOUNTS = 1;

    updateResellerTargetVars({
      RESELLER_TARGET_MIN_30D_ACCOUNTS
    });

    await renderResellerTargetMenu(ctx, { edit: true });
  } catch (err) {
    logger.error('Gagal menurunkan target akun 30 hari:', err.message || err);
    ctx.reply('❌ Terjadi kesalahan saat mengubah target akun 30 hari.');
  }
});

// Naikkan minimal total hari (step 30 hari)
bot.action('admin_res_target_days_inc', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('❌ *Menu ini khusus admin.*', {
        parse_mode: 'Markdown'
      });
    }

    RESELLER_TARGET_MIN_DAYS_PER_MONTH =
      Number(RESELLER_TARGET_MIN_DAYS_PER_MONTH || 0) + 30;

    updateResellerTargetVars({
      RESELLER_TARGET_MIN_DAYS_PER_MONTH
    });

    await renderResellerTargetMenu(ctx, { edit: true });
  } catch (err) {
    logger.error('Gagal menaikkan target hari reseller:', err.message || err);
    ctx.reply('❌ Terjadi kesalahan saat mengubah target total hari.');
  }
});

// Turunkan minimal total hari (minimal 30)
bot.action('admin_res_target_days_dec', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('❌ *Menu ini khusus admin.*', {
        parse_mode: 'Markdown'
      });
    }

    RESELLER_TARGET_MIN_DAYS_PER_MONTH =
      Number(RESELLER_TARGET_MIN_DAYS_PER_MONTH || 30) - 30;
    if (RESELLER_TARGET_MIN_DAYS_PER_MONTH < 30)
      RESELLER_TARGET_MIN_DAYS_PER_MONTH = 30;

    updateResellerTargetVars({
      RESELLER_TARGET_MIN_DAYS_PER_MONTH
    });

    await renderResellerTargetMenu(ctx, { edit: true });
  } catch (err) {
    logger.error('Gagal menurunkan target hari reseller:', err.message || err);
    ctx.reply('❌ Terjadi kesalahan saat mengubah target total hari.');
  }
});

// Tombol tengah (NOP) biar nggak error kalau kepencet
bot.action('admin_res_target_min30_nop', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
});

bot.action('admin_res_target_days_nop', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
});


// === SUBMENU: MANAGEMEN SERVER ===
bot.action('admin_server_menu', async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    // Biar kalau ada user biasa iseng klik, dapat notif
    return ctx.answerCbQuery('🚫 Khusus admin.', { show_alert: true }).catch(() => {});
  }

  await ctx.answerCbQuery().catch(() => {});

  const text =
    '<b>🌐 MANAGEMEN SERVER</b>\n\n' +
    'Pilih pengaturan yang berhubungan dengan server:\n\n' +
    '• Tambah / Hapus server\n' +
    '• Edit harga, nama, domain, auth\n' +
    '• Edit quota, limit IP, batas & total create\n' +
    '• Lihat list & detail server\n';

  const keyboard = [
    [
      { text: '➕ Tambah Server', callback_data: 'addserver' },
      { text: '❌ Hapus Server', callback_data: 'deleteserver' }
    ],
    [
      { text: '💲 Edit Harga', callback_data: 'editserver_harga' },
      { text: '📝 Edit Nama', callback_data: 'nama_server_edit' }
    ],
    [
      { text: '🌐 Edit Domain', callback_data: 'editserver_domain' },
      { text: '🔑 Edit Auth', callback_data: 'editserver_auth' }
    ],
    [
      { text: '📊 Edit Quota', callback_data: 'editserver_quota' },
      { text: '📶 Edit Limit IP', callback_data: 'editserver_limit_ip' }
    ],
    [
      { text: '🔢 Edit Batas Create', callback_data: 'editserver_batas_create_akun' },
      { text: '🔢 Edit Total Create', callback_data: 'editserver_total_create_akun' }
    ],
    [
      { text: '📋 List Server', callback_data: 'listserver' },
      { text: '♻️ Reset Server', callback_data: 'resetdb' }
    ],
    [
      { text: 'ℹ️ Detail Server', callback_data: 'detailserver' }
    ],
    [
      { text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' }
    ]
  ];

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (err) {
    logger.error('Error saat buka submenu server:', err);
    // fallback: kirim pesan baru
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  }
});

// === SUBMENU: TEMPLATE PROMOSI ===
bot.action('promo_template_menu', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from || !adminIds.includes(ctx.from.id)) {
    return ctx.reply('🚫 Menu ini khusus admin.');
  }

  const keyboard = [
    [
      { text: '📜 Katalog Paket VPN', callback_data: 'promo_tpl_catalog' }
    ],
    [
      { text: '💎 Open Reseller', callback_data: 'promo_tpl_reseller' }
    ],
    [
      { text: '⚡ Promo Singkat Bot', callback_data: 'promo_tpl_short' }
    ],
    [
      { text: '👑 Template Kaisar', callback_data: 'promo_tpl_kaisar' }
    ],
    [
      { text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' }
    ]
  ];

  const text =
    '<b>📢 TEMPLATE PROMOSI</b>\n\n' +
    'Pilih template yang ingin dipakai.\n' +
    'Bot akan kirim teks iklan siap copas, ' +
    'bisa kamu edit dulu sebelum dikirim ke channel / grup.';

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (err) {
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  }
});
// Helper kecil untuk ambil username bot
async function getBotTagForPromo() {
  let botTag = '@BOT_KAMU';
  try {
    const me = await bot.telegram.getMe();
    if (me && me.username) {
      botTag = '@' + me.username;
    }
  } catch (e) {
    logger.error('Gagal ambil info bot untuk template promosi:', e.message);
  }
  return botTag;
}

// 📜 Template 1: Katalog Paket VPN
bot.action('promo_tpl_catalog', async (ctx) => {
  try { await ctx.answerCbQuery().catch(() => {}); } catch (e) {}

  if (!ctx.from || !adminIds.includes(ctx.from.id)) return;

  const botTag = await getBotTagForPromo();

  const text =
    '╭─❖  N A M A  S T O R E  ❖\n' +
    '│ 🔐 Pasti Aman ⚡ Anti Ngebug\n' +
    '╰───────────────────────╮\n' +
    '   ✨ READY CONFIG PREMIUM ✨\n' +
    '╭───────────────────────╯\n' +
    '│ 🔰 SSH WS / UDP\n' +
    '│ 🔰 XRAY VMESS WS & GRPC\n' +
    '│ 🔰 XRAY VLESS WS & GRPC\n' +
    '│ 🔰 TROJAN WS & GRPC\n' +
    '╰───────────────────────╮\n' +
    '   🌍 PILIH LOKASI SERVER\n' +
    '╭───────────────────────╯\n' +
    '│ 🇸🇬 SG DIGITALOCEAN\n' +
    '│   Rp. 10.000 / 30 Hari • 2 Device\n' +
    '│ 🇮🇩 ID NUSA\n' +
    '│   Rp. 12.000 / 30 Hari • 2 Device\n' +
    '│ 🇮🇩 ID RAJASA\n' +
    '│   Rp. 13.000 / 30 Hari • 2 Device\n' +
    '│ 🇮🇩 ID MSA\n' +
    '│   Rp. 12.000 / 30 Hari • 2 Device\n' +
    '│ 🌏 Lokasi lain bisa request\n' +
    '╰───────────────────────────┈❁\n' +
    '\n' +
    '✅ Anti Lag • Stabil Harian\n' +
    '✅ Cocok Game / Streaming / Zoom\n' +
    '✅ Bisa Trial dulu sebelum beli\n' +
    '\n' +
    '📩 Order via bot:\n' +
    '👉 ' + botTag;

  await ctx.reply(text);
});

// 💎 Template 2: Open Reseller
bot.action('promo_tpl_reseller', async (ctx) => {
  try { await ctx.answerCbQuery().catch(() => {}); } catch (e) {}

  if (!ctx.from || !adminIds.includes(ctx.from.id)) return;

  const botTag = await getBotTagForPromo();

  const text =
    '╭━━━❖  OPEN RESELLER VPN  ❖━━━╮\n' +
    '┃  Saatnya cuan dari jualan akun 💸\n' +
    '╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n' +
    '✨ HARGA RESELLER MULAI:\n' +
    '• Dari Rp. 4.500 / akun\n' +
    '• Bot auto create akun 24 jam\n' +
    '• Banyak pilihan server premium\n' +
    '• Trial bisa kapan saja\n\n' +
    '💳 HARGA MEMBER MULAI:\n' +
    '• Rp. 10.000 / bulan\n' +
    '• Support 2 Device\n\n' +
    '🧾 JOIN RESELLER:\n' +
    '• Minimal deposit: Rp. 25.000\n' +
    '• Sistem saldo, tinggal klik akun jadi\n\n' +
    '🎯 KEUNGGULAN:\n' +
    '• Panel dan bot mudah dipahami\n' +
    '• Bebas tentukan harga jual sendiri\n\n' +
    '📲 Minat daftar reseller?\n' +
    'Order langsung via bot:\n' +
    '👉 ' + botTag;

  await ctx.reply(text);
});

// ⚡ Template 3: Promo Singkat Bot Auto Order
bot.action('promo_tpl_short', async (ctx) => {
  try { await ctx.answerCbQuery().catch(() => {}); } catch (e) {}

  if (!ctx.from || !adminIds.includes(ctx.from.id)) return;

  const botTag = await getBotTagForPromo();

  const text =
    '╭────────❖  VPN AUTO ORDER  ❖────────╮\n' +
    '│   Bot siap melayani 24 jam non-stop ⚡\n' +
    '╰─────────────────────────────────────╯\n\n' +
    '🚀 PROTOKOL:\n' +
    '• SSH & UDP\n' +
    '• VMESS • VLESS • TROJAN\n\n' +
    '🌍 SERVER:\n' +
    '• 🇸🇬 Singapore\n' +
    '• 🇮🇩 Indonesia\n\n' +
    '💎 KEUNGGULAN:\n' +
    '• Banyak promo menarik\n' +
    '• Speed kencang dan stabil\n' +
    '• Akun langsung jadi tanpa tunggu admin\n' +
    '• Garansi sesuai masa aktif\n\n' +
    '🤖 Order otomatis di bot:\n' +
    '👉 ' + botTag;

  await ctx.reply(text);
});

// 👑 Template 4: Style “Kaisar Store”
bot.action('promo_tpl_kaisar', async (ctx) => {
  try { await ctx.answerCbQuery().catch(() => {}); } catch (e) {}

  if (!ctx.from || !adminIds.includes(ctx.from.id)) return;

  const botTag = await getBotTagForPromo();

  const text =
    '👑 NAMA STORE KAMU 👑\n' +
    '──────────────────────────\n' +
    'AKUN PREMIUM INDONESIA 🇮🇩\n\n' +
    '🇮🇩 ID CLOUD 1  :  Rp. 8K\n' +
    '🇮🇩 ID CLOUD 2  :  Rp. 8K\n' +
    '🇮🇩 ID CLOUD 3  :  Rp. 8K\n' +
    '🇮🇩 ID HERZA 1  :  Rp. 8K\n' +
    '🇮🇩 ID HERZA 2  :  Rp. 8K\n' +
    '──────────────────────────\n' +
    'TERSEDIA:\n' +
    '🛰 SSH\n' +
    '🛰 VMESS\n' +
    '🛰 SSH UDP\n' +
    '──────────────────────────\n' +
    '✅ Wajib trial dulu biar makin yakin\n' +
    '✅ Support 2 device\n' +
    '✅ Support STB / HP / Laptop\n\n' +
    '💳 Pembayaran:\n' +
    '✅ DANA\n' +
    '✅ OVO\n' +
    '✅ QRIS (All Payment)\n\n' +
    '📞 Order / tanya tanya via bot:\n' +
    '👉 ' + botTag;

  await ctx.reply(text);
});

// === 📋 LIST RESELLER ===
bot.action('list_reseller', async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply('🚫 Anda tidak memiliki izin untuk menggunakan menu ini.');
  }

  await ctx.answerCbQuery().catch(() => {});

  try {
    let resellerList = [];
    if (fs.existsSync(resselFilePath)) {
      const fileContent = fs.readFileSync(resselFilePath, 'utf8');
      resellerList = fileContent
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '');
    }

    if (resellerList.length === 0) {
      return ctx.reply('ℹ️ Belum ada reseller terdaftar.');
    }

    const lines = [];
    let no = 1;

    for (const idStr of resellerList) {
      const userId = Number(idStr);
      if (!userId) continue;

      // Ambil username Telegram
      let username = '';
      try {
        username = await getUsernameById(userId);
      } catch (e) {
        username = '';
      }

      const displayName = username
        ? (username.startsWith('@') ? username : '@' + username)
        : `ID:${userId}`;

      // Ambil saldo dari tabel users
      const saldoRow = await new Promise((resolve) => {
        db.get(
          'SELECT saldo FROM users WHERE user_id = ?',
          [userId],
          (err, row) => {
            if (err || !row) return resolve(null);
            resolve(row);
          }
        );
      });

      const saldoText = saldoRow ? `Rp${saldoRow.saldo}` : 'Rp0';

      lines.push(`${no}. ${displayName} (${userId}) — Saldo: ${saldoText}`);
      no++;
    }

    const message =
      '<b>📋 DAFTAR RESELLER</b>\n\n' +
      (lines.length ? lines.join('\n') : 'Belum ada reseller yang tercatat di database users.');

    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (err) {
    logger.error('❌ Error saat menampilkan daftar reseller:', err);
    await ctx.reply('❌ Terjadi kesalahan saat menampilkan daftar reseller.');
  }
});

// === 📋 LIST MEMBER (USER BIASA) ===
bot.action('list_member', async (ctx) => {
  const adminId = ctx.from.id;

  // Pakai ADMIN_IDS (array angka) untuk cek admin
  if (!ADMIN_IDS.includes(adminId)) {
    return ctx.reply('🚫 Anda tidak memiliki izin untuk menggunakan menu ini.');
  }

  await ctx.answerCbQuery().catch(() => {});

  try {
    // Ambil semua user dari tabel users
    const allUsers = await new Promise((resolve, reject) => {
      db.all('SELECT user_id, saldo FROM users', [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

    // Ambil daftar reseller dari ressel.db
    let resellerSet = new Set();
    try {
      if (fs.existsSync(resselFilePath)) {
        const fileContent = fs.readFileSync(resselFilePath, 'utf8');
        const resellerList = fileContent
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l !== '');
        resellerSet = new Set(resellerList);
      }
    } catch (e) {
      logger.error('⚠️ Gagal membaca ressel.db saat list_member:', e);
    }

    // Filter: user yang bukan reseller dan bukan admin
    const memberUsers = allUsers.filter((u) => {
      const uidStr = String(u.user_id);
      if (resellerSet.has(uidStr)) return false;                // buang reseller
      if (ADMIN_IDS.includes(Number(u.user_id))) return false;  // buang admin
      return true;
    });

    if (memberUsers.length === 0) {
      return ctx.reply('ℹ️ Belum ada member biasa yang terdaftar.');
    }

    const lines = [];
    let no = 1;

    // Susun teks dengan username + saldo
    for (const user of memberUsers) {
      const userId = user.user_id;

      let username = '';
      try {
        username = await getUsernameById(userId);
      } catch (e) {
        username = '';
      }

      const displayName = username
        ? (username.startsWith('@') ? username : '@' + username)
        : `ID:${userId}`;

      const saldoText = Number(user.saldo || 0).toLocaleString('id-ID');

      lines.push(`${no}. ${displayName} (${userId}) — Saldo: Rp${saldoText}`);
      no++;
    }

    const message = '<b>📋 DAFTAR MEMBER</b>\n\n' + lines.join('\n');
    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error) {
    logger.error('❌ Error saat menampilkan daftar member:', error);
    await ctx.reply('❌ Terjadi kesalahan saat menampilkan daftar member.');
  }
});

// === 📋 LIST SEMUA USER (ADMIN + RESELLER + MEMBER) + PAGING ===
const LIST_USERS_PAGE_SIZE = 40; // Ubah kalau mau lebih/kurang per halaman

async function renderAllUsersPage(ctx, page, editMessage) {
  try {
    const adminId = ctx.from?.id;
    if (!adminId || !ADMIN_IDS.includes(adminId)) {
      // kalau bukan admin, jangan apa-apa
      if (!editMessage) {
        await ctx.reply('🚫 Anda tidak memiliki izin untuk menggunakan menu ini.');
      }
      return;
    }

    // Ambil semua user dari tabel users (termasuk flag)
    const allUsers = await new Promise((resolve, reject) => {
      db.all(
        'SELECT user_id, saldo, flag_status, flag_note FROM users ORDER BY user_id ASC',
        [],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        }
      );
    });

    if (!allUsers.length) {
      if (editMessage) {
        // kalau mau, edit pesan jadi info kosong
        try {
          await ctx.editMessageText('ℹ️ Belum ada user terdaftar di database.', {
            parse_mode: 'HTML',
          });
        } catch (e) {
          await ctx.reply('ℹ️ Belum ada user terdaftar di database.', {
            parse_mode: 'HTML',
          });
        }
      } else {
        await ctx.reply('ℹ️ Belum ada user terdaftar di database.', {
          parse_mode: 'HTML',
        });
      }
      return;
    }

    // Ambil daftar reseller dari ressel.db
    let resellerSet = new Set();
    try {
      if (fs.existsSync(resselFilePath)) {
        const fileContent = fs.readFileSync(resselFilePath, 'utf8');
        const resellerList = fileContent
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l !== '');
        resellerSet = new Set(resellerList);
      }
    } catch (e) {
      logger.error('⚠️ Gagal membaca ressel.db saat list_all_users:', e);
    }

    const lines = [];
    let idx = 0;

    for (const user of allUsers) {
      const userId = user.user_id;
      if (!userId) continue;
      idx++;

      const uidNum = Number(userId);
      const uidStr = String(userId);

      // Tipe user: Admin / Reseller / Member (pakai singkatan)
      let tipeShort = 'MEM';
      if (ADMIN_IDS.includes(uidNum)) {
        tipeShort = 'ADM';
      } else if (resellerSet.has(uidStr)) {
        tipeShort = 'RES';
      }

      // Ambil username dari Telegram
      let username = '';
      try {
        username = await getUsernameById(userId);
      } catch (e) {
        username = '';
      }

      const displayName = username
        ? (username.startsWith('@') ? username : '@' + username)
        : `ID:${userId}`;

      const saldoText = Number(user.saldo || 0).toLocaleString('id-ID');

      // Flag status (pakai singkatan)
      let flagStatus = (user.flag_status || 'NORMAL').toString().toUpperCase();
      let flagShort = 'OK';
      if (flagStatus === 'WATCHLIST') {
        flagShort = 'WL';
      } else if (flagStatus === 'NAKAL') {
        flagShort = 'NK';
      }

      // Nomor global (01, 02, 03, ...)
      const num = String(idx).padStart(2, '0');

      // Catatan pendek (kalau ada)
      const note =
        user.flag_note && user.flag_note.trim()
          ? ` | Note: ${user.flag_note.trim()}`
          : '';

      // Satu baris per user, format rapih di monospace
      lines.push(
        `${num}. ${userId} | ${displayName} | ${tipeShort} | ${flagShort} | Rp${saldoText}${note}`
      );
    }

    const totalLines = lines.length;
    const pageSize = LIST_USERS_PAGE_SIZE;
    let totalPages = Math.ceil(totalLines / pageSize);
    if (totalPages < 1) totalPages = 1;

    // Normalisasi page
    if (!Number.isInteger(page) || page < 1) page = 1;
    if (page > totalPages) page = totalPages;

    const start = (page - 1) * pageSize;
    const pageLines = lines.slice(start, start + pageSize);
    const body =
      pageLines.length > 0
        ? pageLines.join('\n')
        : '(Tidak ada user di halaman ini)';

    const header =
      '<b>📋 DAFTAR SEMUA USER</b>\n' +
      `Hal ${page}/${totalPages} (maks ${pageSize} user/halaman)\n\n`;

    const message = header + '<pre>' + body + '</pre>';

    // Keyboard paging
    const buttons = [];
    if (page > 1) {
      buttons.push({
        text: '⬅️ Sebelumnya',
        callback_data: `list_all_users_p_${page - 1}`,
      });
    }
    if (page < totalPages) {
      buttons.push({
        text: 'Berikutnya ➡️',
        callback_data: `list_all_users_p_${page + 1}`,
      });
    }

    const opts = { parse_mode: 'HTML' };
    if (buttons.length) {
      opts.reply_markup = { inline_keyboard: [buttons] };
    }

    if (editMessage) {
      // Edit pesan list yang lama
      try {
        await ctx.editMessageText(message, opts);
      } catch (e) {
        // kalau gagal edit (misalnya pesan sudah dihapus), kirim baru
        await ctx.reply(message, opts);
      }
    } else {
      // Kirim pesan baru
      await ctx.reply(message, opts);
    }
  } catch (err) {
    logger.error('❌ Error di renderAllUsersPage:', err);
    if (!editMessage) {
      await ctx.reply('❌ Terjadi kesalahan saat menampilkan daftar semua user.', {
        parse_mode: 'HTML',
      });
    }
  }
}

// Tombol di menu admin → buka halaman 1
bot.action('list_all_users', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await renderAllUsersPage(ctx, 1, false);
});

// Tombol paging (Next / Prev) → ganti halaman di pesan yang sama
bot.action(/list_all_users_p_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const page = parseInt(ctx.match[1], 10) || 1;
  await renderAllUsersPage(ctx, page, true);
});


///////////////

// ====== PROGRAM RESELLER ======
bot.action('jadi_reseller', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});

  const userId = ctx.from.id;
  const storeName = NAMA_STORE || 'Layanan VPN';
  const adminName = ADMIN_USERNAME || 'Admin';

  const msg = `
<b>🤝 Program Reseller ${storeName}</b>

Pengen jualan akun VPN sendiri dengan modal lebih hemat?
Kamu bisa daftar sebagai <b>reseller resmi</b> di ${storeName}.

<b>✨ Keuntungan jadi reseller:</b>
• 💸 Dapat harga akun lebih murah dari harga user biasa.
• 🧾 Bebas atur harga jual ke pelanggan kamu sendiri.
• 🌐 Prioritas akses server & bantuan kalau ada kendala teknis.
• 🛟 Support langsung dari admin ${adminName} lewat chat.

<b>📌 Cara daftar reseller:</b>
1. Salin format pesan di bawah ini.
2. Kirim ke ${adminName} lewat chat Telegram.

<code>
Mau jadi reseller.
ID Telegram : ${userId}
Nama        : ....
</code>

<b>ℹ️ Keterangan tambahan:</b>
• Minimal deposit, list harga reseller, dan aturan lengkap akan dijelaskan oleh admin.
• Saldo reseller nantinya bisa dipakai untuk membuat akun VPN langsung dari bot.
• Disarankan pakai nomor & akun Telegram yang aktif agar mudah dihubungi.
`.trim();

    await sendCleanMenu(ctx, msg, {
    parse_mode: 'HTML',
  });
});

// ========= ❓ BANTUAN UNTUK PENGGUNA =========
bot.action('help_user', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});

  const storeName = NAMA_STORE || 'Layanan VPN';
  const adminName = ADMIN_USERNAME || 'Admin';

  const text = `
<b>Bantuan Pengguna ${storeName}</b>

<b>1. Cara beli akun VPN</b>
• Tekan tombol "<b>➕ Buat Akun</b>" di menu utama.
• Pilih jenis akun (VMess / VLess / Trojan / SSH / lain-lain).
• Pilih server dan durasi paket.
• Konfirmasi pembelian sesuai petunjuk di layar.

<b>2. Cara cek akun & masa aktif</b>
• Tekan tombol "<b>📂 Akun Saya</b>".
• Bot akan menampilkan daftar akun milik kamu.
• Status akun:
  • ✅ Aktif (~X hari lagi)
  • ⚠️ Aktif (habis HARI INI)
  • ❌ Sudah expired

<b>3. Cara melihat riwayat akun</b>
• Tekan tombol "<b>📊 Riwayat Saya</b>".
• Di sana ada ringkasan:
  • Total akun yang pernah dibuat.
  • Berapa yang masih aktif.
  • Berapa yang sudah expired.
• Riwayat bisa digeser dengan tombol ⬅️ dan ➡️ di bawah pesan.

<b>4. Trial akun</b>
• Tekan tombol "<b>⌛ Trial Akun</b>" (jika tersedia).
• Trial hanya bisa dipakai <b>1x per hari</b> per akun Telegram (non-reseller).
• Jika sudah pernah trial hari ini, bot akan memberi info bahwa trial belum bisa dipakai lagi.

<b>5. TopUp saldo manual (QRIS)</b>
• Tekan tombol "<b>💰 TopUp Saldo Manual via (QRIS)</b>" di menu utama.
• Scan QRIS dengan aplikasi pembayaran kamu.
• Ikuti petunjuk jumlah & kirim bukti pembayaran ke admin sesuai format yang muncul.
• Setelah pembayaran dicek dan valid, saldo kamu akan diisi oleh admin.
• Saldo ini bisa dipakai untuk beli akun langsung dari bot, tanpa perlu chat admin satu-satu.

<b>6. Program Reseller (harga lebih murah)</b>
• Kalau kamu mau jualan akun VPN sendiri, atau ingin harga akun lebih murah dari harga user biasa:
  • Tekan tombol "<b>🤝 Jadi Reseller harga lebih murah!!</b>" di menu utama.
  • Di sana ada format pesan yang bisa kamu salin dan kirim ke admin.
• Setelah disetujui dan diaktifkan sebagai reseller:
  • Kamu akan dapat harga akun lebih murah.
  • Kamu bisa jual lagi ke pelangganmu dengan harga sendiri.
  • Saldo yang kamu isi bisa dipakai untuk membuat akun lewat bot.

<b>7. Butuh bantuan / komplain?</b>
Kalau kamu mengalami kendala:
• Akun tidak bisa konek.
• Config error / tidak bisa di-import.
• Salah pilih paket / server, dll.

Silakan hubungi admin <b>${adminName}</b> melalui Telegram.
Saat menghubungi admin, sertakan:
• Username akun VPN.
• Jenis akun (VMess / VLess / Trojan / SSH).
• Server yang dipakai.
• Kendala yang kamu alami (sedetail mungkin).

<b>8. Peraturan singkat pemakaian VPN</b>
• Dilarang membagikan akun, 1 akun 1 perangkat, kecuali server yang ada keterangan [2 device].
• Dilarang menggunakan VPN untuk aktivitas yang melanggar hukum.
• Admin berhak memutus/mematikan akun yang melanggar ketentuan.

Terima kasih sudah memakai layanan ${storeName}.
Jika masih bingung, kamu selalu bisa tekan tombol ini lagi: "<b>❓ Bantuan</b>".
  `.trim();

    try {
    await sendCleanMenu(ctx, text, {
      parse_mode: 'HTML',
    });
  } catch (e) {
    logger.error('Gagal kirim pesan bantuan:', e.message || e);
  }
});

///////
bot.action('addserver_reseller', async (ctx) => {
  await ctx.answerCbQuery().catch(()=>{});
  userState[ctx.chat.id] = { step: 'reseller_domain' };
  await ctx.reply('🌐 Masukkan domain server reseller:');
});

////////
bot.action('tambah_saldo', async (ctx) => {
  // Hilangkan "loading" di tombol
  await ctx.answerCbQuery().catch(() => {});

  const adminId = ctx.from.id;

  // Pastikan hanya admin
  if (!adminIds.includes(adminId)) {
    return toastError(ctx, 'Kamu tidak memiliki izin');
  }

  // Set state agar handler teks tahu kita lagi mode tambah saldo
  userState[adminId] = { step: 'addsaldo_userid' };

  await ctx.reply('🔢 Masukkan ID Telegram user yang ingin ditambahkan saldo:');
});


bot.action('sendMainMenu', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    await sendMainMenu(ctx);
  } catch (error) {
    console.error('❌ Error saat kembali ke menu utama:', error);
    await ctx.reply('⚠️ Terjadi kesalahan saat membuka menu utama.');
  }
});


bot.action('service_trial', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error service_trial:', e.message);
    }
    return;
  }

  // Cek status trial dari konfigurasi
  try {
    const cfg = await getTrialConfig();
    if (!cfg.enabled) {
  return sendCleanMenu(ctx,
    '⌛ <b>Fitur trial sedang dimatikan oleh admin.</b>\n\n' +
    'Silakan gunakan menu <b>➕ Buat Akun</b> untuk membeli akun,\n' +
    'atau coba lagi nanti ketika trial diaktifkan kembali.',
    { parse_mode: 'HTML' }
  );
}

  } catch (err) {
    logger.error('⚠️ Gagal membaca konfigurasi trial:', err.message);
    // Kalau gagal baca config, biarkan lanjut supaya user tidak terkunci total
  }

  await handleServiceAction(ctx, 'trial');
});

bot.action('service_create', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error service_create:', e.message);
    }
    return;
  }
  await handleServiceAction(ctx, 'create');
});


bot.action('service_renew', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error service_renew:', e.message);
    }
    return;
  }
  await handleServiceAction(ctx, 'renew');
});


bot.action('service_del', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error service_del:', e.message);
    }
    return;
  }
  await handleServiceAction(ctx, 'del');
});


bot.action('service_lock', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error service_lock:', e.message);
    }
    return;
  }
  await handleServiceAction(ctx, 'lock');
});


bot.action('service_unlock', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error service_unlock:', e.message);
    }
    return;
  }
  await handleServiceAction(ctx, 'unlock');
});


bot.action('cek_service', async (ctx) => {
  try {
    // Tutup loading di tombol inline
    await ctx.answerCbQuery().catch(() => {});

    const userId = ctx.from.id;
    const isAdmin = ADMIN_IDS.includes(userId);

    // 🔍 Cek status reseller pakai helper yang sama dengan fitur lain
    let isReseller = false;
    try {
      isReseller = await isUserReseller(userId);
    } catch (e) {
      logger.error('❌ Gagal cek status reseller:', e.message || e);
    }

    // Hanya Reseller & Admin yang boleh cek server
    if (!isReseller && !isAdmin) {
      return ctx.reply(
        '❌ *Fitur cek server hanya untuk Reseller dan Admin.*\n\n' +
        'Kalau kamu ingin akses menu cek server & monitoring, kamu bisa daftar sebagai *Reseller* lewat menu yang tersedia atau hubungi admin.',
        { parse_mode: 'Markdown' }
      );
    }

    // ✅ Jika reseller / admin, lanjut jalankan cek service
    const loadingMsg = await ctx.reply('⏳ Sedang mengecek status server, mohon tunggu sebentar...');

    // Cek port pakai Node.js native net module
    const net = require('net');
    const PORTS_TO_CHECK = [22, 80, 443, 8080, 1194];
    const TIMEOUT_MS = 3000;

    function checkPort(host, port) {
      return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(TIMEOUT_MS);
        socket.once('connect', () => { socket.destroy(); resolve('OPEN'); });
        socket.once('timeout', () => { socket.destroy(); resolve('TIMEOUT'); });
        socket.once('error', () => { socket.destroy(); resolve('CLOSED'); });
        socket.connect(port, host);
      });
    }

    try {
      const servers = await new Promise((resolve, reject) => {
        db.all('SELECT id, nama_server, domain FROM Server', [], (err, rows) => {
          err ? reject(err) : resolve(rows || []);
        });
      });

      if (!servers.length) {
        await ctx.telegram.editMessageText(
          loadingMsg.chat.id, loadingMsg.message_id, undefined,
          '⚠️ Belum ada server yang terdaftar.', { parse_mode: 'HTML' }
        );
        return;
      }

      let output = '';
      for (const srv of servers) {
        const host = (srv.domain || '').replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
        if (!host) continue;
        output += `\n🖥 <b>${srv.nama_server || srv.domain}</b>\n`;
        for (const port of PORTS_TO_CHECK) {
          const status = await checkPort(host, port);
          const icon = status === 'OPEN' ? '🟢' : status === 'TIMEOUT' ? '🟡' : '🔴';
          output += `  ${icon} Port ${port}: ${status}\n`;
        }
      }

      const timestamp = new Date().toLocaleString('id-ID', { timeZone: TIME_ZONE });
      const legend =
        '\n<b>Keterangan:</b>\n' +
        '• 🟢 <b>OPEN</b>    : Port terbuka, layanan aktif.\n' +
        '• 🔴 <b>CLOSED</b>  : Port tertutup atau layanan nonaktif.\n' +
        '• 🟡 <b>TIMEOUT</b> : Tidak ada balasan dari server.';

      const resultText =
        `<b>📶 STATUS SERVER</b>\n` +
        `Waktu cek: <b>${timestamp}</b>\n` +
        output + legend;

      const safeText = resultText.length > 4000
        ? resultText.slice(0, 3900) + '\n... (dipotong)'
        : resultText;

      await ctx.telegram.editMessageText(
        loadingMsg.chat.id, loadingMsg.message_id, undefined,
        safeText, { parse_mode: 'HTML' }
      );
    } catch (innerErr) {
      logger.error('❌ Gagal cek port server:', innerErr.message || innerErr);
      await ctx.telegram.editMessageText(
        loadingMsg.chat.id, loadingMsg.message_id, undefined,
        '❌ Terjadi kesalahan saat mengecek server.', { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  } catch (err) {
    logger.error('❌ Error cek_service:', err);
    try {
      await ctx.reply('❌ Gagal menjalankan pengecekan server.');
    } catch (e) {}
  }
});

bot.action(/^qris_status:(.+)$/i, async (ctx) => {
  try {
    const invoiceId = String(ctx.match[1] || '').trim();
    if (!invoiceId) return ctx.answerCbQuery('Invoice kosong');
    await ctx.answerCbQuery('Mengecek...', { show_alert: false }).catch(() => {});


    db.get(
      'SELECT status, amount, base_amount, unique_suffix, created_at, paid_at FROM qris_payments WHERE invoice_id = ? ORDER BY id DESC LIMIT 1',
      [invoiceId],
      async (err, row) => {
        if (err || !row) {
          await ctx.answerCbQuery('Invoice tidak ditemukan', { show_alert: true }).catch(() => {});
          return;
        }

        const s = String(row.status || 'pending').toUpperCase();
        const msg =
          `🧾 <b>Status QRIS</b>\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `Invoice : <code>${invoiceId}</code>\n` +
          `Status  : <b>${s}</b>\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `Catatan: Saldo masuk otomatis saat status <b>PAID</b>.`;

        // Kalau tombol ditekan dari caption foto, coba edit captionnya
        try {
          await ctx.editMessageCaption(msg, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔎 Refresh Status', callback_data: `qris_status:${invoiceId}` }],
                [{ text: '🏠 Menu Utama', callback_data: 'send_main_menu' }],
              ],
            },
          });
        } catch {
          await ctx.answerCbQuery('Tidak bisa edit pesan ini. Buat QRIS baru / buka pesan QR terakhir.', { show_alert: true }).catch(() => {});
        }
        

        await ctx.answerCbQuery('OK').catch(() => {});
      }
    );
  } catch {
    try { await ctx.answerCbQuery('Gagal cek status', { show_alert: true }); } catch {}
  }
});


bot.action('send_main_menu', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error send_main_menu:', e.message);
    }
    return;
  }
  await sendMainMenu(ctx);
});

// === HANDLER: Ringkasan Penjualan Reseller (pakai akun & hari) ===
bot.action('sales_summary', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});

  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from) return;

  const userId = ctx.from.id;

  // Pastikan memang reseller (atau admin boleh lihat juga)
  if (!isResellerId(userId) && !adminIds.includes(userId)) {
    return ctx.reply(
      '❌ Fitur <b>Penjualan Saya</b> hanya untuk reseller.',
      { parse_mode: 'HTML' }
    );
  }

  const now = new Date();
  const monthStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  ).getTime();
  const monthEnd = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    1
  ).getTime();

  const dayMs = 24 * 60 * 60 * 1000;

  db.all(
    `SELECT created_at, expires_at, type, username
     FROM accounts
     WHERE user_id = ?
       AND created_at >= ?
       AND created_at < ?
     ORDER BY created_at ASC`,
    [userId, monthStart, monthEnd],
    async (err, rows) => {
      if (err) {
        logger.error(
          'Gagal ambil data penjualan reseller (sales_summary):',
          err.message || err
        );
        return ctx.reply(
          '❌ Gagal memuat ringkasan penjualan kamu. Silakan coba lagi.',
          { parse_mode: 'HTML' }
        );
      }

      const bulanLabel = now.toLocaleDateString('id-ID', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: 'long'
      });

      if (!rows || rows.length === 0) {
        const text =
          `<b>🧾 Penjualan Saya — ${bulanLabel}</b>\n\n` +
          'Kamu belum punya penjualan di bulan ini.\n\n' +
          `<b>🎯 Target Bulanan</b>\n` +
          `• Minimal <b>${RESELLER_TARGET_MIN_30D_ACCOUNTS}</b> akun berdurasi ≥ 30 hari\n` +
          `• Atau total <b>${RESELLER_TARGET_MIN_DAYS_PER_MONTH}</b> hari dari semua akun\n\n` +
          'Ayo mulai jualan, semua akun yang kamu buat dari menu utama akan dihitung di sini.';

        return sendCleanMenu(ctx, text, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Kembali', callback_data: 'send_main_menu' }]
            ]
          }
        });
      }

      let totalAccounts = rows.length;
      let totalDays = 0;
      let count30Days = 0;

      for (const acc of rows) {
        if (!acc.expires_at || !acc.created_at) continue;

        const durMs = acc.expires_at - acc.created_at;
        let durDays = Math.round(durMs / dayMs);
        if (durDays < 1) durDays = 1; // akun harian tetap minimal 1 hari

        totalDays += durDays;
        if (durDays >= 30) count30Days++;
      }

      const meets30 = count30Days >= RESELLER_TARGET_MIN_30D_ACCOUNTS;
      const meetsDays = totalDays >= RESELLER_TARGET_MIN_DAYS_PER_MONTH;

      let text =
        `<b>🧾 Penjualan Saya — ${bulanLabel}</b>\n\n` +
        `• Total akun terjual       : <b>${totalAccounts}</b>\n` +
        `• Akun durasi ≥ 30 hari    : <b>${count30Days}</b>\n` +
        `• Total hari akumulasi     : <b>${totalDays}</b> hari\n\n` +
        `<b>🎯 Target Bulanan</b>\n` +
        `• Minimal <b>${RESELLER_TARGET_MIN_30D_ACCOUNTS}</b> akun berdurasi ≥ 30 hari\n` +
        `• Atau total <b>${RESELLER_TARGET_MIN_DAYS_PER_MONTH}</b> hari dari semua akun\n\n` +
        `<b>📌 Status Target Bulan Ini</b>\n` +
        `• Target akun 30 hari : ${meets30 ? '✅ Tercapai' : '❌ Belum tercapai'}\n` +
        `• Target total hari   : ${meetsDays ? '✅ Tercapai' : '❌ Belum tercapai'}\n\n` +
        `<i>Catatan: di akhir bulan, reseller yang tidak mencapai salah satu target di atas akan otomatis diturunkan menjadi member biasa.</i>`;

      return sendCleanMenu(ctx, text, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Kembali', callback_data: 'send_main_menu' }]
          ]
        }
      });
    }
  );
});


bot.action('trial_vmess', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error trial_vmess:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  const flag = await getUserFlagStatus(userId);

  if (flag === 'NAKAL') {
    try {
      await ctx.answerCbQuery('⚠️ Akses trial kamu dibatasi.', { show_alert: true });
    } catch (e) {}
    await ctx.reply(
      '⚠️ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
        'Fitur <b>TRIAL VMESS</b> tidak dapat digunakan.\n' +
        'Silakan hubungi admin jika merasa ini salah.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  // WATCHLIST & NORMAL tetap boleh trial (nanti bisa kita batasi lagi kalau mau)
  await startSelectServer(ctx, 'trial', 'vmess');
});

bot.action('trial_vless', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error trial_vless:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  const flag = await getUserFlagStatus(userId);

  if (flag === 'NAKAL') {
    try {
      await ctx.answerCbQuery('⚠️ Akses trial kamu dibatasi.', { show_alert: true });
    } catch (e) {}
    await ctx.reply(
      '⚠️ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
        'Fitur <b>TRIAL VLESS</b> tidak dapat digunakan.\n' +
        'Silakan hubungi admin jika merasa ini salah.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  await startSelectServer(ctx, 'trial', 'vless');
});

bot.action('trial_trojan', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error trial_trojan:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  const flag = await getUserFlagStatus(userId);

  if (flag === 'NAKAL') {
    try {
      await ctx.answerCbQuery('⚠️ Akses trial kamu dibatasi.', { show_alert: true });
    } catch (e) {}
    await ctx.reply(
      '⚠️ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
        'Fitur <b>TRIAL TROJAN</b> tidak dapat digunakan.\n' +
        'Silakan hubungi admin jika merasa ini salah.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  await startSelectServer(ctx, 'trial', 'trojan');
});

bot.action('trial_shadowsocks', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error trial_shadowsocks:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  const flag = await getUserFlagStatus(userId);

  if (flag === 'NAKAL') {
    try {
      await ctx.answerCbQuery('⚠️ Akses trial kamu dibatasi.', { show_alert: true });
    } catch (e) {}
    await ctx.reply(
      '⚠️ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
        'Fitur <b>TRIAL SHADOWSOCKS</b> tidak dapat digunakan.\n' +
        'Silakan hubungi admin jika merasa ini salah.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  await startSelectServer(ctx, 'trial', 'shadowsocks');
});

bot.action('trial_ssh', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error trial_ssh:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  const flag = await getUserFlagStatus(userId);

  if (flag === 'NAKAL') {
    try {
      await ctx.answerCbQuery('⚠️ Akses trial kamu dibatasi.', { show_alert: true });
    } catch (e) {}
    await ctx.reply(
      '⚠️ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
        'Fitur <b>TRIAL SSH/OVPN</b> tidak dapat digunakan.\n' +
        'Silakan hubungi admin jika merasa ini salah.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  await startSelectServer(ctx, 'trial', 'ssh');
});


bot.action('create_vmess', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error create_vmess:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  const flag = await getUserFlagStatus(userId);

  if (flag === 'NAKAL') {
    try {
      await ctx.answerCbQuery('⚠️ Akses buat akun kamu dibatasi.', { show_alert: true });
    } catch (e) {}

    await ctx.reply(
      '⚠️ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
        'Fitur <b>BUAT AKUN VMESS</b> tidak dapat digunakan.\n' +
        'Silakan hubungi admin jika merasa ini salah.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  // NORMAL & WATCHLIST masih boleh buat akun (nanti bisa kita batasi kalau mau)
  await startSelectServer(ctx, 'create', 'vmess');
});


bot.action('create_vless', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error create_vless:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  const flag = await getUserFlagStatus(userId);

  if (flag === 'NAKAL') {
    try {
      await ctx.answerCbQuery('⚠️ Akses buat akun kamu dibatasi.', { show_alert: true });
    } catch (e) {}

    await ctx.reply(
      '⚠️ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
        'Fitur <b>BUAT AKUN VLESS</b> tidak dapat digunakan.\n' +
        'Silakan hubungi admin jika merasa ini salah.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  await startSelectServer(ctx, 'create', 'vless');
});

bot.action('create_trojan', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error create_trojan:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  const flag = await getUserFlagStatus(userId);

  if (flag === 'NAKAL') {
    try {
      await ctx.answerCbQuery('⚠️ Akses buat akun kamu dibatasi.', { show_alert: true });
    } catch (e) {}

    await ctx.reply(
      '⚠️ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
        'Fitur <b>BUAT AKUN TROJAN</b> tidak dapat digunakan.\n' +
        'Silakan hubungi admin jika merasa ini salah.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  await startSelectServer(ctx, 'create', 'trojan');
});

bot.action('create_shadowsocks', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error create_shadowsocks:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  const flag = await getUserFlagStatus(userId);

  if (flag === 'NAKAL') {
    try {
      await ctx.answerCbQuery('⚠️ Akses buat akun kamu dibatasi.', { show_alert: true });
    } catch (e) {}

    await ctx.reply(
      '⚠️ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
        'Fitur <b>BUAT AKUN SHADOWSOCKS</b> tidak dapat digunakan.\n' +
        'Silakan hubungi admin jika merasa ini salah.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  await startSelectServer(ctx, 'create', 'shadowsocks');
});

bot.action('create_ssh', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error create_ssh:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  const flag = await getUserFlagStatus(userId);

  if (flag === 'NAKAL') {
    try {
      await ctx.answerCbQuery('⚠️ Akses buat akun kamu dibatasi.', { show_alert: true });
    } catch (e) {}

    await ctx.reply(
      '⚠️ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
        'Fitur <b>BUAT AKUN SSH/OVPN</b> tidak dapat digunakan.\n' +
        'Silakan hubungi admin jika merasa ini salah.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  await startSelectServer(ctx, 'create', 'ssh');
});


//DELETE SSH
bot.action('del_ssh', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'del', 'ssh');
});

bot.action('del_vmess', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'del', 'vmess');
});

bot.action('del_vless', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'del', 'vless');
});

bot.action('del_trojan', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'del', 'trojan');
});
//DELETE BREAK

//LOCK
bot.action('lock_ssh', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'lock', 'ssh');
});

bot.action('lock_vmess', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'lock', 'vmess');
});

bot.action('lock_vless', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'lock', 'vless');
});

bot.action('lock_trojan', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'lock', 'trojan');
});
//LOCK BREAK
//UNLOCK
bot.action('unlock_ssh', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'unlock', 'ssh');
});

bot.action('unlock_vmess', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'unlock', 'vmess');
});

bot.action('unlock_vless', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'unlock', 'vless');
});

bot.action('unlock_trojan', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'unlock', 'trojan');
});
//UNLOCK BREAK

bot.action('renew_vmess', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error renew_vmess:', e.message);
    }
    return;
  }
  await startSelectServer(ctx, 'renew', 'vmess');
});


bot.action('renew_vless', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error renew_vless:', e.message);
    }
    return;
  }
  await startSelectServer(ctx, 'renew', 'vless');
});


bot.action('renew_trojan', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error renew_trojan:', e.message);
    }
    return;
  }
  await startSelectServer(ctx, 'renew', 'trojan');
});


bot.action('renew_shadowsocks', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error renew_shadowsocks:', e.message);
    }
    return;
  }
  await startSelectServer(ctx, 'renew', 'shadowsocks');
});


bot.action('renew_ssh', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error renew_ssh:', e.message);
    }
    return;
  }
  await startSelectServer(ctx, 'renew', 'ssh');
});

async function startSelectServer(ctx, action, type, page = 0) {

try {
  const isR = await isUserReseller(ctx.from.id);
  const query = isR
    ? 'SELECT * FROM Server'
    : 'SELECT * FROM Server WHERE is_reseller_only = 0 OR is_reseller_only IS NULL';

  db.all(query, [], (err, servers) => {
    if (err) {
      logger.error('⚠️ Error fetching servers:', err.message);
      return ctx.reply('⚠️ Tidak ada server yang tersedia saat ini.', { parse_mode: 'HTML' });
    }

    // ==== mulai logika pagination di bawah ini ====
    const serversPerPage = 6;
    const totalPages = Math.ceil(servers.length / serversPerPage);
    const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
    const start = currentPage * serversPerPage;
    const end = start + serversPerPage;
    const currentServers = servers.slice(start, end);

    const keyboard = [];
    for (let i = 0; i < currentServers.length; i += 2) {
      const row = [];
      const server1 = currentServers[i];
      const server2 = currentServers[i + 1];
      row.push({ text: server1.nama_server, callback_data: `${action}_username_${type}_${server1.id}` });
      if (server2) {
        row.push({ text: server2.nama_server, callback_data: `${action}_username_${type}_${server2.id}` });
      }
      keyboard.push(row);
    }

    const navButtons = [];
    if (totalPages > 1) {
      if (currentPage > 0) {
        navButtons.push({ text: '⬅️ Back', callback_data: `navigate_${action}_${type}_${currentPage - 1}` });
      }
      if (currentPage < totalPages - 1) {
        navButtons.push({ text: '➡️ Next', callback_data: `navigate_${action}_${type}_${currentPage + 1}` });
      }
    }
    if (navButtons.length > 0) keyboard.push(navButtons);
    keyboard.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'sendMainMenu' }]);

           const serverList = currentServers.map((server) => {
      // Sekarang server.harga dianggap harga paket 30 hari
      const hargaNormalPer30Hari = Number(server.harga) || 0;
      const hargaNormalPerHari =
        hargaNormalPer30Hari > 0
          ? Math.max(1, Math.round(hargaNormalPer30Hari / 30))
          : 0;

      // Hitung harga reseller (diskon dari harga 30 hari)
      const hargaResellerPer30Hari =
        hargaNormalPer30Hari > 0
          ? Math.max(1, Math.round(hargaNormalPer30Hari * RESELLER_DISCOUNT))
          : 0;
      const hargaResellerPerHari =
        hargaResellerPer30Hari > 0
          ? Math.max(1, Math.round(hargaResellerPer30Hari / 30))
          : 0;

      const isFull = server.total_create_akun >= server.batas_create_akun;

      let hargaText;
      if (isR) {
        // Tampilan khusus reseller
        hargaText =
          `💰 Harga normal 30 hari : <b>Rp${hargaNormalPer30Hari}</b>\n` +
          `💰 Harga reseller 30 hari : <b>Rp${hargaResellerPer30Hari}</b>\n` +
          `📅 Perkiraan reseller / hari : <b>Rp${hargaResellerPerHari}</b>`;
      } else {
        // User biasa
        hargaText =
          `💰 Harga 30 hari : <b>Rp${hargaNormalPer30Hari}</b>\n` +
          `📅 Perkiraan harga / hari : <b>Rp${hargaNormalPerHari}</b>`;
      }

      const statusText = isFull
        ? '⛔ <b>Server penuh, tidak bisa membuat akun baru.</b>'
        : `👥 Total akun dibuat: <b>${server.total_create_akun}/${server.batas_create_akun}</b>`;

      return (
        `🌐 <b>${server.nama_server}</b>\n` +
        `${hargaText}\n` +
        `📊 Quota : <b>${server.quota} GB</b>\n` +
        `🔢 Limit IP : <b>${server.iplimit} IP</b>\n` +
        statusText
      );
    }).join('\n\n');


       const header =
      `📋 <b>List Server</b>\n` +
      `Halaman ${currentPage + 1} dari ${totalPages}\n\n`;

    if (ctx.updateType === 'callback_query') {
      ctx.editMessageText(header + serverList, {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'HTML'
      });
    } else {
      ctx.reply(header + serverList, {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'HTML'
      });
    }


    userState[ctx.chat.id] = { step: `${action}_username_${type}`, page: currentPage };
  });
} catch (error) {
  logger.error(`❌ Error saat memulai proses ${action} untuk ${type}:`, error);
  await ctx.reply(`❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan.`, { parse_mode: 'Markdown' });
}
}

bot.action(/navigate_(\w+)_(\w+)_(\d+)/, async (ctx) => {
  const [, action, type, page] = ctx.match;
  await startSelectServer(ctx, action, type, parseInt(page, 10));
});

bot.action(/(create|renew)_username_(vmess|vless|trojan|shadowsocks|ssh)_(.+)/, async (ctx) => {
  const action = ctx.match[1];
  const type = ctx.match[2];
  const serverId = ctx.match[3];
  userState[ctx.chat.id] = { step: `username_${action}_${type}`, serverId, type, action };

  db.get('SELECT batas_create_akun, total_create_akun FROM Server WHERE id = ?', [serverId], async (err, server) => {
    if (err) {
      logger.error('⚠️ Error fetching server details:', err.message);
      return ctx.reply('❌ *Terjadi kesalahan saat mengambil detail server.*', { parse_mode: 'Markdown' });
    }

    if (!server) {
      return ctx.reply('❌ *Server tidak ditemukan.*', { parse_mode: 'Markdown' });
    }

    const batasCreateAkun = server.batas_create_akun;
    const totalCreateAkun = server.total_create_akun;

    if (totalCreateAkun >= batasCreateAkun) {
  return sendCleanMenu(
    ctx,
    '❌ <b>Server penuh.</b> Tidak dapat membuat akun baru di server ini.',
    { parse_mode: 'HTML' }
  );
}


await ctx.reply(
  '👤 <b>Masukkan username:</b>',
  { parse_mode: 'HTML' }
);

  });
});

// === ⚡️ KONFIRMASI TRIAL (semua tipe) ===
bot.action(/(trial)_username_(vmess|vless|trojan|shadowsocks|ssh)_(\d+)/, async (ctx) => {
  const [action, type, serverId] = [ctx.match[1], ctx.match[2], ctx.match[3]];

  // Ambil nama server dari database
  db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
    if (err) {
      logger.error('❌ Gagal mengambil data server:', err.message);
      return showErrorOnMenu(ctx, 'Terjadi kesalahan saat mengambil data server.');
    }

    if (!server) {
      return ctx.reply('⚠️ Server tidak ditemukan di database.');
    }

    // Simpan state untuk langkah berikutnya (konfirmasi trial)
    userState[ctx.chat.id] = {
      step: `username_${action}_${type}`,
      serverId,
      type,
      action,
      serverName: server.nama_server || server.domain
    };

    // Ambil pengaturan trial
    let cfg;
    try {
      cfg = await getTrialConfig();
    } catch (e) {
      cfg = DEFAULT_TRIAL_CONFIG;
      logger.error('⚠️ Gagal membaca konfigurasi trial di konfirmasi server:', e.message || e);
    }

    let durationHours =
      cfg && Number.isInteger(cfg.durationHours) && cfg.durationHours > 0
        ? cfg.durationHours
        : DEFAULT_TRIAL_CONFIG.durationHours;

    let maxPerDay =
      cfg && Number.isInteger(cfg.maxPerDay) && cfg.maxPerDay > 0
        ? cfg.maxPerDay
        : DEFAULT_TRIAL_CONFIG.maxPerDay;

    let minBalance =
      cfg && Number.isInteger(cfg.minBalanceForTrial) && cfg.minBalanceForTrial > 0
        ? cfg.minBalanceForTrial
        : 0;

    const serverName = server.nama_server || server.domain || `ID ${server.id}`;

        let info =
      `⚠️ <b>Konfirmasi Trial ${type.toUpperCase()}</b>\n\n` +
      `Kamu akan membuat akun <b>trial ${type.toUpperCase()}</b> di server <b>${serverName}</b>.\n\n` +
      `<b>Pengaturan trial saat ini:</b>\n` +
      `• Masa aktif trial   : <b>${durationHours} jam</b>\n` +
      `• Batas trial / hari : <b>${maxPerDay}x per user</b>\n`;

    if (minBalance > 0) {
      info += `• Minimal saldo trial: <b>Rp${minBalance}</b>\n`;
    }

    info +=
      '\nUsername untuk akun trial akan dibuat <b>acak otomatis oleh server</b>.\n' +
      'Jadi kamu <b>tidak perlu menentukan username sendiri</b>.\n\n' +
      'Kalau setuju, balas pesan ini dengan teks apa saja (contoh: <code>ok</code>, <code>lanjut</code>, atau emoji).\n' +
      'Setelah itu bot akan langsung membuat akun trial dan menampilkan username & password yang dibuat otomatis.';

    await sendCleanMenu(ctx, info, { parse_mode: 'HTML' });

  });
});


// ========= 📂 AKUN SAYA – LIST AKUN MILIK USER (AKTIF / EXPIRED / SEMUA) =========
async function showMyAccounts(ctx, filter) {
  try {
    // Tutup "loading" di tombol, kalau dipanggil dari callback
    try {
      await ctx.answerCbQuery().catch(() => {});
    } catch (e) {}

    if (!ctx.from) {
      return ctx.reply('❌ Tidak bisa membaca data pengguna.');
    }

    const userId = ctx.from.id;

    // Hitung awal hari (00:00) dalam bentuk timestamp (ms)
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0
    ).getTime();

    // Tentukan filter & SQL
    let whereClause = 'a.user_id = ?';
    const params = [userId];
    let filterText;
    let filterNormalized;

    switch (filter) {
      case 'expired':
        // Expired = tanggal expire sebelum hari ini
        whereClause += ' AND a.expires_at IS NOT NULL AND a.expires_at < ?';
        params.push(todayStart);
        filterText = 'Menampilkan hanya akun <b>EXPIRED</b>.';
        filterNormalized = 'expired';
        break;

      case 'all':
        filterText = 'Menampilkan semua akun (aktif & expired).';
        filterNormalized = 'all';
        break;

      case 'active':
      default:
        // Aktif = belum ada expire ATAU tanggal expire hari ini atau sesudahnya
        whereClause += ' AND (a.expires_at IS NULL OR a.expires_at >= ?)';
        params.push(todayStart);
        filterText = 'Menampilkan hanya akun <b>AKTIF</b>.';
        filterNormalized = 'active';
        break;
    }

    db.all(
      `SELECT a.id, a.username, a.type, a.server_id, a.expires_at, s.nama_server
       FROM accounts a
       LEFT JOIN Server s ON a.server_id = s.id
       WHERE ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT 25`,
      params,
      async (err, rows) => {
        if (err) {
          logger.error('❌ Gagal mengambil data akun:', err.message);
          try {
            await sendCleanMenu(ctx, '❌ Terjadi kesalahan saat mengambil data akun.', {
              parse_mode: 'HTML',
            });
          } catch (e) {
            logger.error('❌ Gagal kirim pesan error showMyAccounts:', e);
          }
          return;
        }

        // Tombol filter di atas daftar
        const activeLabel = filterNormalized === 'active' ? '✅ Aktif •' : '✅ Aktif';
        const expiredLabel = filterNormalized === 'expired' ? '❌ Expired •' : '❌ Expired';
        const allLabel = filterNormalized === 'all' ? '📋 Semua •' : '📋 Semua';

        const keyboard = [
          [
            { text: activeLabel, callback_data: 'my_accounts_active' },
            { text: expiredLabel, callback_data: 'my_accounts_expired' },
          ],
          [
            { text: allLabel, callback_data: 'my_accounts_all' },
          ],
        ];

        // Tidak ada data
        if (!rows || rows.length === 0) {
          let noDataMsg = 'Belum ada akun yang cocok dengan filter ini.';

          if (filterNormalized === 'active') {
            noDataMsg =
              'Belum ada akun aktif yang tercatat untuk kamu.\n' +
              'Coba lihat tab "📋 Semua" atau buat akun baru dari menu utama.';
          } else if (filterNormalized === 'expired') {
            noDataMsg =
              'Belum ada akun expired yang tercatat untuk kamu.\n' +
              'Coba lihat tab "✅ Aktif" atau "📋 Semua".';
          }

          const text =
            '📂 <b>Akun Saya</b>\n\n' +
            filterText + '\n\n' +
            noDataMsg;

          try {
            await sendCleanMenu(ctx, text, {
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: keyboard },
            });
          } catch (e) {
            logger.error('❌ Gagal kirim menu Akun Saya (no data):', e);
          }

          return;
        }

        // Ada data
        let text = '📂 <b>Akun Saya</b>\n\n' + filterText + '\n\n';

        rows.forEach((row, index) => {
  const serverName =
    row.nama_server || (row.server_id ? `Server ${row.server_id}` : 'Server ?');

  let status = '⏳ Tidak diketahui';
  if (row.expires_at) {
    const daysLeft = getAccountDaysLeft(row.expires_at);

    if (daysLeft > 0) {
      status = `✅ Aktif (~${daysLeft} hari lagi)`;
    } else if (daysLeft === 0) {
      status = '⚠️ Aktif (habis HARI INI)';
    } else if (daysLeft < 0) {
      status = '❌ Sudah expired';
    }
  }

  // Tambah ke teks daftar
  text +=
    `${index + 1}. [${row.type}] <b>${row.username}</b>\n` +
    `   Server : ${serverName}\n` +
    `   Status : ${status}\n\n`;

  // 🔘 Tambah tombol pilih akun (buat perpanjang, detail, dll)
  keyboard.push([
    {
      text: `${index + 1}. ${row.username} [${row.type}]`,
      callback_data: `accsel:${row.id}`,
    },
  ]);
});


        try {
          await sendCleanMenu(ctx, text, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard },
          });
        } catch (e) {
          logger.error('❌ Gagal kirim menu Akun Saya (ada data):', e);
        }
      }
    );
  } catch (err) {
    logger.error('❌ Error di showMyAccounts:', err);
    try {
      await sendCleanMenu(ctx, '❌ Terjadi kesalahan saat menampilkan akun.', {
        parse_mode: 'HTML',
      });
    } catch (e) {
      logger.error('❌ Gagal kirim pesan error luar showMyAccounts:', e);
    }
  }
}

// Default dari tombol 📂 Akun Saya → tampilkan akun AKTIF
bot.action('my_accounts', async (ctx) => {
  return showMyAccounts(ctx, 'active');
});

// Tombol filter
bot.action('my_accounts_active', async (ctx) => showMyAccounts(ctx, 'active'));
bot.action('my_accounts_expired', async (ctx) => showMyAccounts(ctx, 'expired'));
bot.action('my_accounts_all', async (ctx) => showMyAccounts(ctx, 'all'));

// ========= 📊 RIWAYAT / LAPORAN SAYA (VERSI DETAIL + PAGING) =========
const MY_STATS_PAGE_SIZE = 10; // 🔧 ganti ke 15 / 20 kalau mau

    async function showMyStatsPage(ctx, page) {
  try {
    if (!ctx.from) {
      return ctx.reply('❌ Tidak bisa membaca data pengguna.');
    }

    const userId = ctx.from.id;
    await ctx.answerCbQuery().catch(() => {});

    const nowTs = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // Awal hari ini (00:00) untuk logika aktif/expired berbasis TANGGAL
    const nowDate = new Date();
    const todayStart = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate()
    ).getTime();

    // ===== RINGKASAN AKUN DARI TABEL accounts =====
    function countAccounts(whereClause, params) {
      return new Promise((resolve) => {
        db.get(
          `SELECT COUNT(*) AS count FROM accounts WHERE ${whereClause}`,
          params,
          (err, row) => {
            if (err) {
              logger.error('Gagal ambil statistik accounts:', err.message);
              return resolve(0);
            }
            resolve(row ? row.count : 0);
          }
        );
      });
    }

    const [totalAll, totalActive, totalExpired] = await Promise.all([
      countAccounts('user_id = ?', [userId]),
      // Aktif = belum ada expire atau expire >= hari ini
      countAccounts(
        'user_id = ? AND (expires_at IS NULL OR expires_at >= ?)',
        [userId, todayStart]
      ),
      // Expired = expire < hari ini
      countAccounts(
        'user_id = ? AND expires_at IS NOT NULL AND expires_at < ?',
        [userId, todayStart]
      ),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalAll / MY_STATS_PAGE_SIZE));
    const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
    const offset = currentPage * MY_STATS_PAGE_SIZE;


    // ===== AKUN DI HALAMAN INI =====
    const recentAccounts = await new Promise((resolve) => {
      db.all(
        `SELECT a.username, a.type, a.server_id, a.created_at, a.expires_at,
                s.nama_server, s.domain
         FROM accounts a
         LEFT JOIN Server s ON a.server_id = s.id
         WHERE a.user_id = ?
         ORDER BY a.created_at DESC
         LIMIT ? OFFSET ?`,
        [userId, MY_STATS_PAGE_SIZE, offset],
        (err, rows) => {
          if (err) {
            logger.error('Gagal ambil riwayat accounts:', err.message);
            return resolve([]);
          }
          resolve(rows || []);
        }
      );
    });

    const typeLabel = (t) => {
      switch (t) {
        case 'ssh':          return '🔑 SSH';
        case 'vmess':        return '🔷 VMess';
        case 'vless':        return '🟦 VLess';
        case 'trojan':       return '🐴 Trojan';
        case 'shadowsocks':  return '🧦 Shadowsocks';
        default:             return t || '-';
      }
    };

        const formatDateTime = (ts) => {
      if (!ts) return '-';
      return new Date(ts).toLocaleString('id-ID', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const formatExpireStatus = (expiresAt) => {
      if (!expiresAt) return 'Tanpa masa aktif';
      // Hanya tampilkan TANGGAL, tanpa jam, supaya tidak bikin bingung
      return new Date(expiresAt).toLocaleDateString('id-ID', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    };

        const lines = [];

    lines.push('<b>📊 Riwayat Akun Kamu</b>');
    lines.push('<i>Catatan: Tanggal Expire adalah hari terakhir akun aktif. Setelah lewat tanggal itu, akun dianggap expired walaupun jam belum tertera di config.</i>\n');

    // Ringkasan akun
    lines.push('<code>Ringkasan Akun</code>');
    lines.push(`• Total dibuat   : <b>${totalAll}</b> akun`);
    lines.push(`• Aktif sekarang : <b>${totalActive}</b> akun`);
    lines.push(`• Sudah expired  : <b>${totalExpired}</b> akun\n`);

    lines.push(
      `<code>Riwayat Akun (halaman ${currentPage + 1} dari ${totalPages})</code>`
    );

    if (recentAccounts.length === 0) {
      lines.push('Belum ada akun yang tercatat di riwayat kamu.');
    } else {
      recentAccounts.forEach((row, idx) => {
        const dibuatText = formatDateTime(row.created_at);
        const expireText = formatExpireStatus(row.expires_at);

        const serverName =
          row.nama_server ||
          row.domain ||
          (row.server_id ? `Server #${row.server_id}` : '-');

        const username = row.username || '-';

        const nomor = offset + idx + 1;

        lines.push(
          `#${nomor} ${typeLabel(row.type)}\n` +
          `   User   : <b>${username}</b>\n` +
          `   Server : ${serverName}\n` +
          `   Dibuat : ${dibuatText}\n` +
          `   Expire : ${expireText}`
        );
      });
    }

    const text = lines.join('\n');

    // Inline keyboard untuk paging
    const navButtons = [];
    if (currentPage > 0) {
      navButtons.push({
        text: '⬅️ Sebelumnya',
        callback_data: `my_stats:${currentPage - 1}`,
      });
    }
    if (currentPage < totalPages - 1) {
      navButtons.push({
        text: '➡️ Selanjutnya',
        callback_data: `my_stats:${currentPage + 1}`,
      });
    }

    const replyMarkup =
      navButtons.length > 0
        ? { inline_keyboard: [navButtons] }
        : undefined;

    try {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      });
    } catch (e) {
          await sendCleanMenu(ctx, text, {
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });
    }
    } catch (err) {
    logger.error('❌ Error di showMyStatsPage:', err);
    try {
      await sendCleanMenu(ctx, '❌ Terjadi kesalahan saat menampilkan riwayat.', {
        parse_mode: 'HTML',
      });
    } catch {}
  }
}


// Callback dari tombol utama (tanpa halaman) → mulai dari halaman 0
bot.action('my_stats', async (ctx) => {
  return showMyStatsPage(ctx, 0);
});

// Callback dari tombol paging: my_stats:0, my_stats:1, dst
bot.action(/my_stats:(\d+)/, async (ctx) => {
  const page = parseInt(ctx.match[1], 10) || 0;
  return showMyStatsPage(ctx, page);
});

// ========= DETAIL AKUN – SAAT SATU AKUN DIPILIH =========
bot.action(/accsel:(\d+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) {
    return ctx.reply('❌ Tidak bisa membaca data pengguna.');
  }

  const userId = ctx.from.id;
  const accountId = parseInt(ctx.match[1], 10);
  if (!accountId) {
    return ctx.reply('❌ ID akun tidak valid.');
  }

  db.get(
    `SELECT a.id, a.user_id, a.username, a.type, a.server_id, a.expires_at, s.nama_server
     FROM accounts a
     LEFT JOIN Server s ON a.server_id = s.id
     WHERE a.id = ?`,
    [accountId],
    (err, row) => {
      if (err) {
        logger.error('Kesalahan saat mengambil detail akun:', err.message);
        return ctx.reply('❌ Terjadi kesalahan saat membaca detail akun.');
      }

      if (!row || row.user_id !== userId) {
        return ctx.reply('❌ Akun ini tidak ditemukan atau bukan milik kamu.');
      }

            const serverName =
        row.nama_server || (row.server_id ? `Server ${row.server_id}` : 'Server ?');

      let status = '⏳ Tidak diketahui';
      if (row.expires_at) {
        const daysLeft = getAccountDaysLeft(row.expires_at);

        if (daysLeft > 0) {
          status = `✅ Aktif (~${daysLeft} hari lagi)`;
        } else if (daysLeft === 0) {
          status = '⚠️ Aktif (habis HARI INI)';
        } else {
          status = '❌ Sudah expired';
        }
      }

      const detail =
        '📄 <b>Detail Akun</b>\n\n' +
        `Tipe    : <b>${row.type}</b>\n` +
        `Username: <b>${row.username}</b>\n` +
        `Server  : ${serverName}\n` +
        `Status  : ${status}\n\n` +
        'Pilih aksi yang ingin kamu lakukan:';

      const keyboard = [
        [
          { text: '♻️ Perpanjang Akun', callback_data: `accrenew:${row.id}` }
        ],
        [
          { text: '❌ Hapus Akun', callback_data: `accdel:${row.id}` }
        ],
        [
          { text: '🗝️ Kunci Akun', callback_data: `acclock:${row.id}` },
          { text: '🔐 Buka Kunci', callback_data: `accunlock:${row.id}` }
        ],
        [
          { text: '🔙 Kembali ke daftar', callback_data: 'my_accounts' }
        ]
      ];

            return sendCleanMenu(ctx, detail, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    }
  );
});
// ========= ❌ HAPUS AKUN DARI "AKUN SAYA" =========
bot.action(/accdel:(\d+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) {
    return ctx.reply('❌ Tidak bisa membaca data pengguna.');
  }

  const userId = ctx.from.id;
  const accountId = parseInt(ctx.match[1], 10);
  if (!accountId) {
    return ctx.reply('❌ ID akun tidak valid.');
  }

  db.get(
    'SELECT id, user_id, username, type, server_id FROM accounts WHERE id = ?',
    [accountId],
    async (err, row) => {
      if (err) {
        logger.error('Kesalahan saat mengambil akun untuk hapus:', err.message);
        return ctx.reply('❌ Terjadi kesalahan saat membaca data akun.');
      }

      if (!row || row.user_id !== userId) {
        return ctx.reply('❌ Akun ini tidak ditemukan atau bukan milik kamu.');
      }

      const delFunctions = {
        vmess: delvmess,
        vless: delvless,
        trojan: deltrojan,
        shadowsocks: delshadowsocks,
        ssh: delssh
      };

      const fn = delFunctions[row.type];
      if (!fn) {
        return ctx.reply('❌ Tipe akun tidak dikenal, tidak bisa dihapus.');
      }

      try {
        const password = 'none', exp = 'none', iplimit = 'none';
        const msg = await fn(row.username, password, exp, iplimit, row.server_id);
        await recordAccountTransaction(userId, row.type);

        // Hapus dari tabel accounts agar tidak muncul di "Akun Saya" lagi
        db.run('DELETE FROM accounts WHERE id = ?', [accountId], (err2) => {
          if (err2) {
            logger.error('Kesalahan menghapus record dari tabel accounts:', err2.message);
          }
        });

        await ctx.reply(msg, { parse_mode: 'Markdown' });
        logger.info(`✅ Akun ${row.type} (${row.username}) dihapus lewat Akun Saya oleh ${userId}`);
      } catch (e2) {
        logger.error('❌ Gagal hapus akun dari menu Akun Saya:', e2.message);
        await ctx.reply('❌ *Terjadi kesalahan saat menghapus akun.*', { parse_mode: 'Markdown' });
      }
    }
  );
});
// ========= 🗝️ KUNCI AKUN DARI "AKUN SAYA" =========
bot.action(/acclock:(\d+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) {
    return ctx.reply('❌ Tidak bisa membaca data pengguna.');
  }

  const userId = ctx.from.id;
  const accountId = parseInt(ctx.match[1], 10);
  if (!accountId) {
    return ctx.reply('❌ ID akun tidak valid.');
  }

  db.get(
    'SELECT id, user_id, username, type, server_id FROM accounts WHERE id = ?',
    [accountId],
    async (err, row) => {
      if (err) {
        logger.error('Kesalahan saat mengambil akun untuk lock:', err.message);
        return ctx.reply('❌ Terjadi kesalahan saat membaca data akun.');
      }

      if (!row || row.user_id !== userId) {
        return ctx.reply('❌ Akun ini tidak ditemukan atau bukan milik kamu.');
      }

      const lockFunctions = {
        vmess: lockvmess,
        vless: lockvless,
        trojan: locktrojan,
        shadowsocks: lockshadowsocks,
        ssh: lockssh
      };

      const fn = lockFunctions[row.type];
      if (!fn) {
        return ctx.reply('❌ Tipe akun tidak dikenal, tidak bisa dikunci.');
      }

      try {
        const password = 'none', exp = 'none', iplimit = 'none';
        const msg = await fn(row.username, password, exp, iplimit, row.server_id);
        await recordAccountTransaction(userId, row.type);

        await ctx.reply(msg, { parse_mode: 'Markdown' });
        logger.info(`✅ Akun ${row.type} (${row.username}) dikunci lewat Akun Saya oleh ${userId}`);
      } catch (e2) {
        logger.error('❌ Gagal lock akun dari menu Akun Saya:', e2.message);
        await ctx.reply('❌ *Terjadi kesalahan saat mengunci akun.*', { parse_mode: 'Markdown' });
      }
    }
  );
});
// ========= 🔐 BUKA KUNCI AKUN DARI "AKUN SAYA" =========
bot.action(/accunlock:(\d+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) {
    return ctx.reply('❌ Tidak bisa membaca data pengguna.');
  }

  const userId = ctx.from.id;
  const accountId = parseInt(ctx.match[1], 10);
  if (!accountId) {
    return ctx.reply('❌ ID akun tidak valid.');
  }

  db.get(
    'SELECT id, user_id, username, type, server_id FROM accounts WHERE id = ?',
    [accountId],
    async (err, row) => {
      if (err) {
        logger.error('Kesalahan saat mengambil akun untuk unlock:', err.message);
        return ctx.reply('❌ Terjadi kesalahan saat membaca data akun.');
      }

      if (!row || row.user_id !== userId) {
        return ctx.reply('❌ Akun ini tidak ditemukan atau bukan milik kamu.');
      }

      const unlockFunctions = {
        vmess: unlockvmess,
        vless: unlockvless,
        trojan: unlocktrojan,
        shadowsocks: unlockshadowsocks,
        ssh: unlockssh
      };

      const fn = unlockFunctions[row.type];
      if (!fn) {
        return ctx.reply('❌ Tipe akun tidak dikenal, tidak bisa dibuka kuncinya.');
      }

      try {
        const password = 'none', exp = 'none', iplimit = 'none';
        const msg = await fn(row.username, password, exp, iplimit, row.server_id);
        await recordAccountTransaction(userId, row.type);

        await ctx.reply(msg, { parse_mode: 'Markdown' });
        logger.info(`✅ Akun ${row.type} (${row.username}) di-unlock lewat Akun Saya oleh ${userId}`);
      } catch (e2) {
        logger.error('❌ Gagal unlock akun dari menu Akun Saya:', e2.message);
        await ctx.reply('❌ *Terjadi kesalahan saat membuka kunci akun.*', { parse_mode: 'Markdown' });
      }
    }
  );
});

// ========= ♻️ PERPANJANG AKUN DARI "AKUN SAYA" =========
bot.action(/accrenew:(\d+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) {
    return ctx.reply('❌ Tidak bisa membaca data pengguna.');
  }

  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const accountId = parseInt(ctx.match[1], 10);
  if (!accountId) {
    return ctx.reply('❌ ID akun tidak valid.');
  }

  db.get(
    `SELECT a.id, a.user_id, a.username, a.type, a.server_id, a.expires_at, s.nama_server
     FROM accounts a
     LEFT JOIN Server s ON a.server_id = s.id
     WHERE a.id = ?`,
    [accountId],
    async (err, row) => {
      if (err) {
        logger.error('Kesalahan saat mengambil data akun untuk perpanjang:', err.message);
        return ctx.reply('❌ Terjadi kesalahan saat membaca data akun.');
      }

      if (!row || row.user_id !== userId) {
        return ctx.reply('❌ Akun ini tidak ditemukan atau bukan milik kamu.');
      }

      const serverName = row.nama_server || (row.server_id ? `Server ${row.server_id}` : 'Server ?');

      let status = '⏳ Tidak diketahui';
      if (row.expires_at) {
        const daysLeft = getAccountDaysLeft(row.expires_at);

        if (daysLeft > 0) {
          status = `✅ Aktif (~${daysLeft} hari lagi)`;
        } else if (daysLeft === 0) {
          status = '⚠️ Aktif (habis HARI INI)';
        } else {
          status = '❌ Sudah expired';
        }
      }

      // ✅ Set state langsung ke langkah "exp_renew_*"
      userState[chatId] = {
        action: 'renew',
        type: row.type,           // vmess / vless / trojan / shadowsocks / ssh
        username: row.username,
        serverId: row.server_id,
        password: 'none',         // renew biasanya tidak pakai password baru
        step: `exp_renew_${row.type}`
      };

      const infoText =
        '♻️ <b>PERPANJANG AKUN</b>\n\n' +
        `Tipe    : <b>${row.type}</b>\n` +
        `Username: <b>${row.username}</b>\n` +
        `Server  : ${serverName}\n` +
        `Status  : ${status}\n\n` +
        'Silakan kirim <b>masa aktif tambahan</b> dalam hari.\n' +
        'Contoh: <code>30</code>';

            await sendCleanMenu(ctx, infoText, {
        parse_mode: 'HTML'
      });

    }
  );
});

bot.action(/(del)_username_(vmess|vless|trojan|shadowsocks|ssh)_(.+)/, async (ctx) => {
  const [action, type, serverId] = [ctx.match[1], ctx.match[2], ctx.match[3]];

  userState[ctx.chat.id] = {
    step: `username_${action}_${type}`,
    serverId, type, action
  };
  await ctx.reply('👤 *Masukkan username yang ingin dihapus:*', { parse_mode: 'Markdown' });
});
bot.action(/(unlock)_username_(vmess|vless|trojan|shadowsocks|ssh)_(.+)/, async (ctx) => {
  const [action, type, serverId] = [ctx.match[1], ctx.match[2], ctx.match[3]];

  userState[ctx.chat.id] = {
    step: `username_${action}_${type}`,
    serverId, type, action
  };
  await ctx.reply('👤 *Masukkan username yang ingin dibuka:*', { parse_mode: 'Markdown' });
});
bot.action(/(lock)_username_(vmess|vless|trojan|shadowsocks|ssh)_(.+)/, async (ctx) => {
  const [action, type, serverId] = [ctx.match[1], ctx.match[2], ctx.match[3]];

  userState[ctx.chat.id] = {
    step: `username_${action}_${type}`,
    serverId, type, action
  };
  await ctx.reply('👤 *Masukkan username yang ingin dikunci:*', { parse_mode: 'Markdown' });
});

bot.on('text', async (ctx) => {
const text = (ctx.message.text || '').trim();   // <-- TAMBAHKAN BARIS INI
 // === TEST KIRIM KE GRUP DARI /tesgroub ===
  if (text === '/tesgroub') {
    try {
      await bot.telegram.sendMessage(
        GROUP_ID,
        '? Test kirim pesan ke grup dari bot.'
      );
      await ctx.reply('? Pesan test sudah dikirim ke grup.');
    } catch (e) {
      logger.error('Gagal kirim notif test ke grup:', e.message);
      await ctx.reply('? Gagal kirim ke grup, cek ID grup & izin bot.');
    }
    return; // jangan lanjut ke bawah
  }

      // ==== MODE PENGUMUMAN (MANUAL & TEMPLATE) DARI MENU 📢 ====
  const fromId = ctx.from && ctx.from.id;
  if (fromId && adminIds.includes(fromId)) {
    const bState = broadcastSessions[fromId];

    // Kalau tidak ada sesi broadcast aktif → lanjut ke logika lain
    if (!bState) {
      // lanjut ke bawah (state menu biasa)
    } else if (bState.step === 'wait_message') {
      // ----- MODE MANUAL: user kirim teks bebas -----
      if (text.startsWith('/')) {
        await ctx.reply(
          'ℹ️ Pengumuman dibatalkan karena kamu mengirim perintah lain.\n' +
            'Kalau mau mulai lagi, buka menu admin lalu pilih "📢 Kirim Pengumuman".',
          { parse_mode: 'HTML' }
        );
        delete broadcastSessions[fromId];
        return;
      }

      bState.message = ctx.message.text;
      bState.step = 'confirm';

      let targetLabel = 'semua user';
      if (bState.target === 'reseller') {
        targetLabel = 'semua reseller';
      } else if (bState.target === 'member') {
        targetLabel = 'member (bukan reseller & bukan admin)';
      }

      await ctx.reply(
        `📄 <b>Preview Pengumuman</b>\n` +
          `Target: <b>${targetLabel}</b>\n\n` +
          bState.message +
          '\n\nKirim pengumuman ini?',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Kirim Sekarang', callback_data: 'broadcast_confirm' },
                { text: '❌ Batal', callback_data: 'broadcast_cancel' },
              ],
            ],
          },
        }
      );

      return;
    } else if (bState.step === 'tm_ask_layanan') {
      // ----- TEMPLATE MAINTENANCE: langkah 1 (nama layanan) -----
      bState.layanan = ctx.message.text;
      bState.step = 'tm_ask_waktu';

      await ctx.reply(
        '2️⃣ Masukkan waktu maintenance (hari, tanggal, dan jam mulai).\n' +
          'Contoh:\n' +
          '• Sabtu, 22-11-2025, jam 21.00 WIT\n' +
          '• Malam ini jam 23.00 WIT',
        { parse_mode: 'HTML' }
      );
      return;
    } else if (bState.step === 'tm_ask_waktu') {
      // ----- TEMPLATE MAINTENANCE: langkah 2 (waktu) -----
      bState.waktu = ctx.message.text;
      bState.step = 'tm_ask_durasi';

      await ctx.reply(
        '3️⃣ Masukkan perkiraan durasi maintenance.\n' +
          'Contoh:\n' +
          '• 30 menit\n' +
          '• 1 jam\n' +
          '• 2 jam',
        { parse_mode: 'HTML' }
      );
      return;
    } else if (bState.step === 'tm_ask_durasi') {
      // ----- TEMPLATE MAINTENANCE: langkah 3 (durasi) -----
      bState.durasi = ctx.message.text;
      bState.step = 'tm_ask_catatan';

      await ctx.reply(
        '4️⃣ Masukkan catatan tambahan (opsional).\n' +
          'Jika tidak ada, kirim tanda <code>-</code> saja.',
        { parse_mode: 'HTML' }
      );
      return;
    } else if (bState.step === 'tm_ask_catatan') {
      // ----- TEMPLATE MAINTENANCE: langkah 4 (catatan + susun pesan) -----
      const catatanRaw = ctx.message.text;
      bState.catatan = catatanRaw === '-' ? '' : catatanRaw;

      let targetLabel = 'semua user';
      if (bState.target === 'reseller') {
        targetLabel = 'semua reseller';
      } else if (bState.target === 'member') {
        targetLabel = 'member (bukan reseller & bukan admin)';
      }

      // Susun pesan maintenance otomatis
      const msgLines = [];

      msgLines.push('🔧 <b>PENGUMUMAN MAINTENANCE SERVER VPN</b>');
      msgLines.push('');
      msgLines.push('Kepada pengguna VPN,');
      msgLines.push(
        `Akan dilakukan maintenance pada layanan <b>${bState.layanan}</b>.`
      );
      msgLines.push('');
      msgLines.push(`📅 Waktu mulai : <b>${bState.waktu}</b>`);
      msgLines.push(`⏱ Durasi      : <b>${bState.durasi}</b>`);
      if (bState.catatan) {
        msgLines.push('');
        msgLines.push(`📝 Catatan: ${bState.catatan}`);
      }
      msgLines.push('');
      msgLines.push(
        'Selama proses maintenance, koneksi mungkin tidak stabil atau tidak dapat digunakan.'
      );
      msgLines.push('Terima kasih atas pengertian dan kerjasamanya.');

      const finalMessage = msgLines.join('\n');

      bState.message = finalMessage;
      bState.step = 'confirm';

      await ctx.reply(
        `📄 <b>Preview Pengumuman Maintenance</b>\n` +
          `Target: <b>${targetLabel}</b>\n\n` +
          finalMessage +
          '\n\nKirim pengumuman ini?',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Kirim Sekarang', callback_data: 'broadcast_confirm' },
                { text: '❌ Batal', callback_data: 'broadcast_cancel' },
              ],
            ],
          },
        }
      );

      return;
    } else if (bState.step === 'promo_ask_paket') {
      // ----- TEMPLATE PROMO: langkah 1 (nama paket/promo) -----
      bState.paket = ctx.message.text;
      bState.step = 'promo_ask_detail';

      await ctx.reply(
        '2️⃣ Masukkan detail promo/diskon singkat.\n' +
          'Contoh:\n' +
          '• Diskon 30%, dari 30K jadi 20K\n' +
          '• Beli 1 bulan gratis 7 hari\n' +
          '• Harga spesial hanya hari ini',
        { parse_mode: 'HTML' }
      );
      return;
    } else if (bState.step === 'promo_ask_detail') {
      // ----- TEMPLATE PROMO: langkah 2 (detail promo) -----
      bState.detail = ctx.message.text;
      bState.step = 'promo_ask_berlaku';

      await ctx.reply(
        '3️⃣ Masukkan masa berlaku promo.\n' +
          'Contoh:\n' +
          '• Sampai 30-11-2025\n' +
          '• Hanya sampai akhir bulan ini\n' +
          '• Berlaku 3 hari ke depan',
        { parse_mode: 'HTML' }
      );
      return;
    } else if (bState.step === 'promo_ask_berlaku') {
      // ----- TEMPLATE PROMO: langkah 3 (berlaku sampai) -----
      bState.berlaku = ctx.message.text;
      bState.step = 'promo_ask_catatan';

      await ctx.reply(
        '4️⃣ Masukkan catatan tambahan (opsional).\n' +
          'Jika tidak ada, kirim tanda <code>-</code> saja.',
        { parse_mode: 'HTML' }
      );
      return;
    } else if (bState.step === 'promo_ask_catatan') {
      // ----- TEMPLATE PROMO: langkah 4 (catatan + susun pesan) -----
      const catatanRaw = ctx.message.text;
      bState.catatan = catatanRaw === '-' ? '' : catatanRaw;

      let targetLabel = 'semua user';
      if (bState.target === 'reseller') {
        targetLabel = 'semua reseller';
      } else if (bState.target === 'member') {
        targetLabel = 'member (bukan reseller & bukan admin)';
      }

      const lines = [];
      lines.push('🎁 <b>PROMO / DISKON LAYANAN VPN</b>');
      lines.push('');
      lines.push(`Sekarang tersedia promo untuk <b>${bState.paket}</b>.`);
      lines.push(bState.detail);
      lines.push('');
      lines.push(`📅 Berlaku sampai: <b>${bState.berlaku}</b>`);
      if (bState.catatan) {
        lines.push('');
        lines.push(`📝 Catatan: ${bState.catatan}`);
      }
      lines.push('');
      lines.push('Minat? Silakan hubungi admin atau beli langsung melalui bot.');

      const finalMessage = lines.join('\n');

      bState.message = finalMessage;
      bState.step = 'confirm';

      await ctx.reply(
        `📄 <b>Preview Pengumuman Promo/Diskon</b>\n` +
          `Target: <b>${targetLabel}</b>\n\n` +
          finalMessage +
          '\n\nKirim pengumuman ini?',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Kirim Sekarang', callback_data: 'broadcast_confirm' },
                { text: '❌ Batal', callback_data: 'broadcast_cancel' },
              ],
            ],
          },
        }
      );

      return;
    }
  }

  const state = userState[ctx.chat.id];

// ?? Tambahan penting:
  // Kalau userState belum ada, jangan lanjut supaya
  // tidak error "Cannot read properties of undefined (reading 'step')"
  if (!state || !state.step) {
    return;
  }
  
    
    const lowerText = text.toLowerCase();

  // ========================================================================
  // SECTION: PAYMENT - STATE INPUT NOMINAL (QRIS AUTO TOPUP)
  // - Menangani step 'qris_topup_nominal'
  // - Validasi nominal, cek invoice pending, generate 3 digit acak,
  //   panggil createQrisInvoice, insert ke qris_payments
  // ========================================================================
  // === INPUT NOMINAL TOPUP QRIS OTOMATIS (DENGAN 3 DIGIT ACAK) ===
  if (state.step === 'qris_topup_nominal') {
    // Bisa batal
    if (lowerText === 'batal' || lowerText === '/batal') {
      delete userState[ctx.chat.id];
      await ctx.reply('❌ Topup otomatis dibatalkan.', { parse_mode: 'HTML' });
      return;
    }

    // Ambil angka saja (hilangkan titik, koma, huruf)
    const angkaBersih = text.replace(/[^\d]/g, '');
    const baseAmount = Number(angkaBersih);

    if (
      !baseAmount ||
      baseAmount < QRIS_AUTO_TOPUP_MIN ||
      baseAmount > QRIS_AUTO_TOPUP_MAX
    ) {
      await ctx.reply(
        `⚠️ Nominal tidak valid.\n\n` +
          `Minimal: <b>Rp${QRIS_AUTO_TOPUP_MIN.toLocaleString('id-ID')}</b>\n` +
          `Maksimal: <b>Rp${QRIS_AUTO_TOPUP_MAX.toLocaleString('id-ID')}</b>\n\n` +
          `Ketik ulang nominal, contoh: <code>25000</code>`,
        { parse_mode: 'HTML' }
      );
      return;
    }
// === CEK DULU: APAKAH MASIH ADA INVOICE PENDING UNTUK USER INI? ===
  try {
    const userId = ctx.from.id;
    const now = Date.now();
    const timeoutMin = QRIS_PAYMENT_TIMEOUT_MIN || 5;
    const expireThreshold = now - timeoutMin * 60 * 1000;

    const pendingRow = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM qris_payments
         WHERE user_id = ? AND status = 'pending'
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });

    if (pendingRow) {
      // Kalau pending-nya masih dalam batas waktu, JANGAN bikin invoice baru
      if (pendingRow.created_at >= expireThreshold) {
        // Bersihkan state supaya user nggak ke-lock
        delete userState[ctx.chat.id];

        await ctx.reply(
          '⚠️ Kamu masih punya 1 topup QRIS yang <b>belum dibayar</b>.\n\n' +
            `🧾 Invoice : <code>${pendingRow.invoice_id}</code>\n` +
            `💳 Nominal : <b>Rp${pendingRow.amount.toLocaleString('id-ID')}</b>\n\n` +
            `Silakan selesaikan pembayaran QRIS tersebut dulu, atau tunggu sekitar <b>${timeoutMin} menit</b> sampai kadaluarsa sebelum membuat topup baru.`,
          { parse_mode: 'HTML' }
        );
        return; // STOP di sini, tidak bikin invoice baru
      } else {
        // Kalau sebenarnya sudah lewat waktu, tandai expired saja
        db.run(
          `UPDATE qris_payments
           SET status = 'expired'
           WHERE id = ? AND status = 'pending'`,
          [pendingRow.id],
          (err) => {
            if (err) {
              logger.error(
                '⚠️ Gagal meng-update qris_payments ke expired dari handler nominal:',
                err
              );
            }
          }
        );
        // lanjut proses bikin invoice baru
      }
    }
  } catch (e) {
    logger.error('⚠️ Error saat cek invoice pending QRIS:', e);
    // kalau cek pending error, kita tetap lanjut bikin invoice
  }

        // === Generate kode unik 2–3 digit (50–200) ===
    const MIN_SUFFIX = 50;
    const MAX_SUFFIX = 200;

    // random antara 50–200 (bisa 2 digit atau 3 digit)
    let randomSuffix =
      MIN_SUFFIX + Math.floor(Math.random() * (MAX_SUFFIX - MIN_SUFFIX + 1));
    let billedAmount = baseAmount + randomSuffix;

    // Koreksi kalau sampai nabrak batas maksimal topup
    if (billedAmount > QRIS_AUTO_TOPUP_MAX) {
      const diff = QRIS_AUTO_TOPUP_MAX - baseAmount;

      if (diff >= MIN_SUFFIX) {
        // pakai nilai terkecil antara sisa ruang dan MAX_SUFFIX
        randomSuffix = Math.min(diff, MAX_SUFFIX);
        billedAmount = baseAmount + randomSuffix;
      } else {
        // kalau sisa ruang < 50, buang kode unik, pakai baseAmount saja
        randomSuffix = 0;
        billedAmount = baseAmount;
      }
    }


    // Hapus state biar nggak nyangkut
    delete userState[ctx.chat.id];

    try {
      const userId = ctx.from.id;

// 1) Buat invoice QRIS dari baseAmount (kode unik dibuat di createQrisInvoice)
const invoice = await createQrisInvoice(
  baseAmount,
  `Topup saldo user ${userId} (base=${baseAmount})`
);

async function getUserSaldo(userId) {
  return await new Promise((resolve, reject) => {
    db.get(`SELECT saldo FROM users WHERE user_id = ?`, [userId], (err, row) => {
      if (err) return reject(err);
      resolve(Number(row?.saldo || 0));
    });
  });
}

async function markQrisStatus(id, status, paidAt = null) {
  return await new Promise((resolve) => {
    if (paidAt) {
      db.run(`UPDATE qris_payments SET status=?, paid_at=? WHERE id=?`, [status, paidAt, id], () => resolve());
    } else {
      db.run(`UPDATE qris_payments SET status=? WHERE id=?`, [status, id], () => resolve());
    }
  });
}

function parseRupiahInt(v) {
  if (typeof v === 'number') return Math.round(v);
  if (!v) return 0;
  return parseInt(String(v).replace(/[^\d]/g, ''), 10) || 0;
}

async function pollQrisPayments() {
  if (global.__pollQrisRunning) return;
  global.__pollQrisRunning = true;
  try {
    const now = Date.now();
    const timeoutMin = Number(QRIS_PAYMENT_TIMEOUT_MIN || 5);
    const intervalMs = Number(QRIS_CHECK_INTERVAL_MS || 15000);

    // ambil pending terbaru saja (biar tidak berat)
    const cutoff = now - ((timeoutMin + 15) * 60 * 1000);

    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, user_id, invoice_id, amount, base_amount, unique_suffix, created_at
         FROM qris_payments
         WHERE status='pending' AND created_at >= ?
         ORDER BY created_at ASC
         LIMIT 50`,
        [cutoff],
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
      global.__pollQrisRunning = false;

    });

    if (!rows.length) return;

    logger.info(`🔎 Poll QRIS: cek ${rows.length} transaksi pending...`);

    // validasi config
    if (!API_KEY || API_KEY === 'NONE') {
      logger.error('❌ QRIS cekstatus: API_KEY belum diisi');
      return;
    }
    if (!ORDERKUOTA_AUTH_USERNAME || !ORDERKUOTA_AUTH_TOKEN) {
      logger.error('❌ QRIS cekstatus: ORDERKUOTA_AUTH_USERNAME/TOKEN belum diisi');
      return;
    }

    const accountId = String(ORDERKUOTA_AUTH_TOKEN).includes(':')
      ? String(ORDERKUOTA_AUTH_TOKEN).split(':')[0]
      : '';

    if (!accountId) {
      logger.error('❌ QRIS cekstatus: gagal ambil ACCOUNT_ID dari ORDERKUOTA_AUTH_TOKEN');
      return;
    }

    const web_mutasi = `https://app.orderkuota.com/api/v2/qris/mutasi/${accountId}`;

    for (const row of rows) {
      const expiresAt = Number(row.created_at) + (timeoutMin * 60 * 1000);

      // expired
      if (now > expiresAt) {
        await markQrisStatus(row.id, 'expired');
        try {
          await bot.telegram.sendMessage(
            row.user_id,
            `⏰ <b>QRIS EXPIRED</b>\n` +
              `━━━━━━━━━━━━━━━━\n` +
              `QR sudah tidak berlaku (melewati batas waktu).\n` +
              `Silakan buat QRIS baru untuk topup.\n` +
              `━━━━━━━━━━━━━━━━\n` +
              `Invoice: <code>${row.invoice_id}</code>`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '💳 Buat QRIS Baru', callback_data: 'topupqris_btn' }],
                  [{ text: '🏠 Menu Utama', callback_data: 'send_main_menu' }],
                ],
              },
            }
          );
          
        } catch (_) {}
        logger.info(`⌛ QRIS expired: invoice=${row.invoice_id} user=${row.user_id}`);
        continue;
      }

      // cek status by amount via gateway
      let data;
      try {
        const r = await axios.get('https://api.rajaserverpremium.web.id/orderkuota/cekstatus', {
          params: {
            apikey: API_KEY,
            auth_username: ORDERKUOTA_AUTH_USERNAME,
            auth_token: ORDERKUOTA_AUTH_TOKEN,
            web_mutasi,
            amount: Number(row.amount),
          },
          timeout: 15000,
        });
        data = r.data;
      } catch (e) {
        logger.error(`❌ QRIS cekstatus request error invoice=${row.invoice_id}: ${e?.message || e}`);
        continue;
      }

      if (!data || data.status !== 'success') {
        logger.error(`❌ QRIS cekstatus gagal invoice=${row.invoice_id}: ${data?.message || 'unknown'}`);
        continue;
      }

      // match pembayaran: kredit == amount
      const expected = Number(row.amount);
      let paid = false;

      if (Array.isArray(data.result) && data.result.length) {
        paid = data.result.some((t) => parseRupiahInt(t.kredit) === expected);
      }

      // fallback state
      if (!paid && data.payment && String(data.payment.state || '').toLowerCase() === 'paid') {
        paid = true;
      }

      if (!paid) continue;

      // tandai paid
      await markQrisStatus(row.id, 'paid', Date.now());

      // tambah saldo user (pakai fungsi yang sudah ada)
      const currentSaldo = await getUserSaldo(row.user_id);
      const addSaldo = Number(row.base_amount); // saldo yang ditambah = nominal pilihan user (tanpa kode unik)
      const newSaldo = currentSaldo + addSaldo;

      await updateUserSaldo(row.user_id, newSaldo);

      try {
        await bot.telegram.sendMessage(
          row.user_id,
          `✅ <b>TOPUP BERHASIL</b>\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `💰 <b>Saldo Masuk</b> : <b>Rp${addSaldo.toLocaleString('id-ID')}</b>\n` +
            `💳 <b>Saldo Sekarang</b> : <b>Rp${newSaldo.toLocaleString('id-ID')}</b>\n` +
            `🧾 <b>Invoice</b> : <code>${row.invoice_id}</code>\n` +
            `🕒 <b>Waktu</b> : ${new Date().toLocaleString('id-ID', { timeZone: TIME_ZONE })}\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `Terima kasih 🙏`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'send_main_menu' }]],
            },
          }
        );
        
      } catch (_) {}

      logger.info(`✅ QRIS PAID: invoice=${row.invoice_id} user=${row.user_id} billed=${expected} add=${addSaldo}`);
    }

  } catch (e) {
    logger.error(`❌ pollQrisPayments fatal: ${e?.message || e}`);
  }
}

// Jalankan polling hanya di primary instance (kalau PM2 cluster)
const IS_PRIMARY_INSTANCE = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
if (IS_PRIMARY_INSTANCE) {
  setInterval(pollQrisPayments, Number(QRIS_CHECK_INTERVAL_MS || 15000));
  logger.info(`✅ QRIS polling aktif. Interval=${Number(QRIS_CHECK_INTERVAL_MS || 15000)}ms`);
} else {
  logger.info('ℹ️ QRIS polling nonaktif di instance non-primary (PM2 cluster).');
}

const billedAmount = invoice.amount;         // total yang harus dibayar
const randomSuffix = invoice.unique_suffix;  // kode unik 1-1000 (atau 0 kalau fallback)


// 2. Simpan ke tabel qris_payments
const now = Date.now();
await new Promise((resolve, reject) => {
  db.run(
    `INSERT INTO qris_payments (
       user_id,
       invoice_id,
       amount,
       base_amount,
       unique_suffix,
       status,
       created_at
     )
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [userId, invoice.invoice_id, invoice.amount, invoice.base_amount, invoice.unique_suffix, now],
    (err) => (err ? reject(err) : resolve())
  );
});



      // 3. Kirim QR ke user (CUMA SEKALI)
let caption =
`✅ <b>QRIS TOPUP DIBUAT</b>\n` +
`━━━━━━━━━━━━━━━━\n` +
`🧾 <b>Invoice</b> : <code>${invoice.invoice_id}</code>\n` +
`💳 <b>Nominal</b> : <b>Rp${baseAmount.toLocaleString('id-ID')}</b>\n` +
(randomSuffix > 0
  ? `🎲 <b>Kode unik</b> : <b>${randomSuffix.toString().padStart(3, '0')}</b>\n` +
    `💰 <b>Total bayar</b> : <b>Rp${billedAmount.toLocaleString('id-ID')}</b>\n`
  : `💰 <b>Total bayar</b> : <b>Rp${billedAmount.toLocaleString('id-ID')}</b>\n`) +
`━━━━━━━━━━━━━━━━\n` +
`📌 Scan QR lalu bayar sesuai <b>TOTAL BAYAR</b>\n` +
`⏰ <b>Berlaku 5 menit</b>\n` +
`Saldo masuk otomatis setelah terdeteksi.`; // <-- PENTING: harus ada ; di akhir

const payKb = {
inline_keyboard: [
  [{ text: '🔎 Cek Status', callback_data: `qris_status:${invoice.invoice_id}` }],
  [{ text: '🏠 Menu Utama', callback_data: 'send_main_menu' }],
],
};

if (invoice.qris_image_path) {
await ctx.replyWithPhoto(
  { source: invoice.qris_image_path },
  { caption, parse_mode: 'HTML', reply_markup: payKb }
);
} else if (invoice.qris_image_url) {
await ctx.replyWithPhoto(
  { url: invoice.qris_image_url },
  { caption, parse_mode: 'HTML', reply_markup: payKb }
);
} else if (invoice.payment_link) {
await ctx.reply(caption + `\n\n🔗 Link Pembayaran:\n${invoice.payment_link}`, {
  parse_mode: 'HTML',
  reply_markup: payKb,
});
} else if (invoice.qris_text) {
await ctx.reply(
  caption +
    `\n\nKode QRIS:\n<code>${invoice.qris_text}</code>\n\n` +
    'Silakan buat QR dari text di atas jika diperlukan.',
  { parse_mode: 'HTML', reply_markup: payKb }
);
} else {
await ctx.reply('⚠️ Gagal membuat QRIS. Coba lagi nanti.', {
  parse_mode: 'HTML',
  reply_markup: payKb,
});
}

    } catch (e) {
      logger.error('❌ Error saat proses topup QRIS dari input nominal:', e);
      await ctx.reply(
        '❌ Terjadi kesalahan saat membuat QRIS. Coba lagi beberapa saat.',
        { parse_mode: 'HTML' }
      );
    }

    return; // stop di sini, jangan lanjut ke state lain
  }
  // ===== END SECTION: PAYMENT - STATE INPUT NOMINAL (QRIS AUTO TOPUP) ======


  // === EDIT NAMA SERVER (via ketikan biasa) ===
  if (state.step === 'edit_nama') {
  // Bisa batal pakai kata "batal"
  if (lowerText === 'batal' || lowerText === '/batal') {
    delete userState[ctx.chat.id];
    await ctx.reply('❌ Edit nama server dibatalkan.', {
      parse_mode: 'Markdown',
    });
    return;
  }

  const newName = text.trim();

  if (!newName) {
    await ctx.reply('⚠️ Nama server tidak boleh kosong. Silakan ketik lagi.', {
      parse_mode: 'Markdown',
    });
    return;
  }

  // Boleh kamu sesuaikan panjang maksimalnya
  if (newName.length > 50) {
    await ctx.reply('⚠️ Nama server terlalu panjang. Maksimal 50 karakter.', {
      parse_mode: 'Markdown',
    });
    return;
  }

  const serverId = state.serverId;

  db.run(
    'UPDATE Server SET nama_server = ? WHERE id = ?',
    [newName, serverId],
    function (err) {
      if (err) {
        logger.error('⚠️ Kesalahan saat mengedit nama server:', err.message);
        ctx.reply('⚠️ Terjadi kesalahan saat mengupdate nama server.', {
          parse_mode: 'Markdown',
        });
        return;
      }

      if (this.changes === 0) {
        ctx.reply('⚠️ Server tidak ditemukan.', {
          parse_mode: 'Markdown',
        });
        return;
      }

      ctx.reply(
        `✅ Nama berhasil diubah:\n*${newName}*`,
      { parse_mode: 'Markdown' }
      );
    }
  );
 
  delete userState[ctx.chat.id];
  return; // penting: jangan lanjut ke logika state lain
}
  // === EDIT DOMAIN SERVER (via ketikan biasa) ===
  if (state.step === 'edit_domain') {
    // Bisa batal pakai kata "batal"
    if (lowerText === 'batal' || lowerText === '/batal') {
      delete userState[ctx.chat.id];
      await ctx.reply('❌ Edit domain server dibatalkan.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    const newDomain = text.trim();

    if (!newDomain) {
      await ctx.reply('⚠️ Domain server tidak boleh kosong. Silakan ketik lagi.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    // Validasi sederhana: huruf, angka, titik, dash, tanpa spasi
    if (!/^[a-zA-Z0-9.-]+$/.test(newDomain)) {
      await ctx.reply(
        '⚠️ Format domain tidak valid.\n' +
          'Hanya boleh huruf, angka, titik, dan strip.\n' +
          'Contoh: `sg1.serverku.com`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (newDomain.length > 100) {
      await ctx.reply('⚠️ Domain terlalu panjang. Maksimal 100 karakter.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    const serverId = state.serverId;
    const oldDomain = state.oldDomain || '-';

    db.run(
      'UPDATE Server SET domain = ? WHERE id = ?',
      [newDomain, serverId],
      function (err) {
        if (err) {
          logger.error('⚠️ Kesalahan saat mengedit domain server:', err.message);
          ctx.reply('⚠️ Terjadi kesalahan saat mengupdate domain server.', {
            parse_mode: 'Markdown',
          });
          return;
        }

        if (this.changes === 0) {
          ctx.reply('⚠️ Server tidak ditemukan.', {
            parse_mode: 'Markdown',
          });
          return;
        }

        ctx.reply(
          `✅ Domain server berhasil diubah:\n` +
            `• Sebelumnya: \`${oldDomain}\`\n` +
            `• Menjadi   : \`${newDomain}\``,
          { parse_mode: 'Markdown' }
        );
      }
    );

    // Hapus state setelah berhasil / diproses
    delete userState[ctx.chat.id];
    return; // penting: jangan lanjut ke logika state lain
  }
  // === EDIT AUTH SERVER (via ketikan biasa) ===
  if (state.step === 'edit_auth') {
    // Bisa batal pakai kata "batal"
    if (lowerText === 'batal' || lowerText === '/batal') {
      delete userState[ctx.chat.id];
      await ctx.reply('❌ Edit auth server dibatalkan.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    const newAuth = text.trim();

    if (!newAuth) {
      await ctx.reply('⚠️ AUTH server tidak boleh kosong. Silakan ketik lagi.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    if (newAuth.length > 255) {
      await ctx.reply('⚠️ AUTH terlalu panjang. Maksimal 255 karakter.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    const serverId = state.serverId;
    const oldAuth = state.oldAuth || '-';
    const domain = state.domain || '-';
    const nama = state.nama || '-';

    db.run(
      'UPDATE Server SET auth = ? WHERE id = ?',
      [newAuth, serverId],
      function (err) {
        if (err) {
          logger.error('⚠️ Kesalahan saat mengedit auth server:', err.message);
          ctx.reply('⚠️ Terjadi kesalahan saat mengupdate auth server.', {
            parse_mode: 'Markdown',
          });
          return;
        }

        if (this.changes === 0) {
          ctx.reply('⚠️ Server tidak ditemukan.', {
            parse_mode: 'Markdown',
          });
          return;
        }

        // Biar nggak tampil full AUTH di chat, kita mask
        let maskedOld = oldAuth;
        if (maskedOld.length > 8) {
          maskedOld = maskedOld.slice(0, 4) + '...' + maskedOld.slice(-4);
        }
        let maskedNew = newAuth;
        if (maskedNew.length > 8) {
          maskedNew = maskedNew.slice(0, 4) + '...' + maskedNew.slice(-4);
        }

        ctx.reply(
          '✅ Auth server berhasil diubah:\n' +
            `• Server : \`${nama}\`\n` +
            `• Domain : \`${domain}\`\n` +
            `• Sebelumnya: \`${maskedOld}\`\n` +
            `• Menjadi   : \`${maskedNew}\``,
          { parse_mode: 'Markdown' }
        );
      }
    );

    // Hapus state setelah diproses
    delete userState[ctx.chat.id];
    return;
  }

  // === BATALKAN PROSES TAMBAH SERVER ===
  if (
    state.step &&
    state.step.startsWith('addserver') &&   // semua step: addserver, addserver_auth, dst
    (lowerText === 'batal' || lowerText === '/batal')
  ) {
    delete userState[ctx.chat.id];
    await ctx.reply('❌ Proses tambah server dibatalkan.', {
      parse_mode: 'Markdown',
    });
    return;
  }
  // === MODE TANDAI USER: INPUT ID USER ===
  if (state.step === 'flag_user_wait_id') {
    // Bisa batal
    if (lowerText === 'batal' || lowerText === '/batal') {
      delete userState[ctx.chat.id];
      await ctx.reply('❌ Mode tandai user dibatalkan.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    const targetId = text.trim();

    if (!/^\d+$/.test(targetId)) {
      await ctx.reply(
        '⚠️ ID Telegram harus berupa angka.\n' +
          'Silakan kirim ulang ID user yang ingin diatur statusnya, atau ketik *batal*.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    db.get(
      'SELECT user_id, saldo, flag_status, flag_note FROM users WHERE user_id = ?',
      [targetId],
      async (err, row) => {
        if (err) {
          logger.error('❌ Gagal mengambil data user untuk flag:', err.message);
          await ctx.reply('❌ Terjadi kesalahan saat mengambil data user.');
          return;
        }

        if (!row) {
          await ctx.reply(
            `⚠️ User dengan ID ${targetId} belum terdaftar di database.\n` +
              'Kirim ID lain atau ketik *batal* untuk membatalkan.',
            { parse_mode: 'Markdown' }
          );
          return;
        }

        const saldoText = Number(row.saldo || 0).toLocaleString('id-ID');
        const rawFlag = (row.flag_status || 'NORMAL').toString().toUpperCase();
        let flagLabel = '✅ NORMAL';
        if (rawFlag === 'WATCHLIST') flagLabel = '⚠️ WATCHLIST';
        else if (rawFlag === 'NAKAL') flagLabel = '🚫 NAKAL';

        const noteText =
          row.flag_note && row.flag_note.trim()
            ? `\n📝 Catatan saat ini: ${row.flag_note.trim()}`
            : '';

        const keyboard = {
          inline_keyboard: [
            [
              {
                text: '✅ NORMAL',
                callback_data: `flag_user_set_NORMAL_${targetId}`,
              },
              {
                text: '⚠️ WATCHLIST',
                callback_data: `flag_user_set_WATCHLIST_${targetId}`,
              },
              {
                text: '🚫 NAKAL',
                callback_data: `flag_user_set_NAKAL_${targetId}`,
              },
            ],
          ],
        };

        await ctx.reply(
          `👤 *Data user:*\n` +
            `• ID     : \`${targetId}\`\n` +
            `• Saldo  : \`Rp${saldoText}\`\n` +
            `• Status : ${flagLabel}${noteText}\n\n` +
            `Silakan pilih status baru untuk user ini:`,
          { parse_mode: 'Markdown', reply_markup: keyboard }
        );

        // Simpan state berikutnya (opsional, just in case)
        userState[ctx.chat.id] = {
          step: 'flag_user_choose',
          targetUserId: targetId,
        };
      }
    );

    return;
  }

//////
  if (state.step === 'cek_saldo_userid') {
    const targetId = ctx.message.text.trim();
    db.get('SELECT saldo FROM users WHERE user_id = ?', [targetId], (err, row) => {
      if (err) {
        logger.error('❌ Gagal mengambil saldo:', err.message);
        return ctx.reply('❌ Terjadi kesalahan saat mengambil data saldo.');
      }

      if (!row) {
        return ctx.reply(`⚠️ User dengan ID ${targetId} belum terdaftar di database.`);
      }

      ctx.reply(`💰 Saldo user ${targetId}: Rp${row.saldo.toLocaleString()}`);
      logger.info(`Admin ${ctx.from.id} mengecek saldo user ${targetId}: Rp${row.saldo}`);
      delete userState[ctx.from.id];
    });
  } else if (state.step === 'riwayat_saldo_userid') {
    const targetId = ctx.message.text.trim();

    // 1) Ambil saldo sekarang
    db.get('SELECT saldo FROM users WHERE user_id = ?', [targetId], (err, userRow) => {
      if (err) {
        logger.error('❌ Gagal mengambil saldo (riwayat):', err.message);
        return ctx.reply('❌ Terjadi kesalahan saat mengambil data saldo.');
      }

      if (!userRow) {
        return ctx.reply(`⚠️ User dengan ID ${targetId} belum terdaftar di database.`);
      }

      const currentSaldo = Number(userRow.saldo || 0);

    // 2) Ambil max 20 transaksi terakhir dari tabel transactions
    //    HANYA yang punya amount (transaksi saldo beneran)
    db.all(
      'SELECT amount, type, reference_id, timestamp FROM transactions WHERE user_id = ? AND amount IS NOT NULL ORDER BY timestamp DESC LIMIT 20',
      [targetId],
      (err2, rows) => {
          if (err2) {
            logger.error('❌ Gagal mengambil riwayat transaksi saldo:', err2.message);
            return ctx.reply('❌ Terjadi kesalahan saat mengambil riwayat saldo.');
          }

          if (!rows || rows.length === 0) {
            delete userState[ctx.from.id];
            return ctx.reply(
              `ℹ️ Belum ada riwayat transaksi saldo untuk user ${targetId}.\n` +
              `Biasanya riwayat muncul dari deposit otomatis (QRIS) dan log transaksi lain.`
            );
          }

          const lines = [];
          lines.push('<b>📜 RIWAYAT SALDO USER</b>');
          lines.push('');
          lines.push(`User ID: <code>${targetId}</code>`);
          lines.push(`Saldo sekarang: <b>Rp${currentSaldo.toLocaleString('id-ID')}</b>`);
          lines.push('');
          lines.push('<code>Max 20 transaksi terakhir</code>');

          rows.forEach((tr, idx) => {
            // Waktu
            let timeText = '-';
            if (tr.timestamp) {
              try {
                timeText = new Date(tr.timestamp).toLocaleString('id-ID', {
                  timeZone: TIME_ZONE,
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                });
              } catch (e) {
                timeText = '-';
              }
            }

            // Jenis transaksi
            const rawType = tr.type || '-';
const lowerType = rawType.toLowerCase();
let jenisText = rawType;

if (lowerType.includes('deposit')) {
  jenisText = 'TopUp (deposit otomatis)';
} else if (lowerType.includes('manual_addsaldo')) {
  jenisText = 'TopUp (manual admin)';
} else if (lowerType.includes('manual_minsaldo')) {
  jenisText = 'Pengurangan saldo (manual admin)';
} else if (lowerType.includes('buy_create')) {
  jenisText = 'Pembelian akun baru';
} else if (lowerType.includes('buy_renew')) {
  jenisText = 'Perpanjangan akun';
}

            // Jumlah (boleh null)
            let amountText = '-';
            if (typeof tr.amount === 'number' && !isNaN(tr.amount)) {
              const sign = tr.amount >= 0 ? '+' : '-';
              amountText = `${sign}Rp${Math.abs(tr.amount).toLocaleString('id-ID')}`;
            }

            const refId = tr.reference_id ? tr.reference_id : '';

            let block =
              `${idx + 1}) ${timeText}\n` +
              `   Jenis  : ${jenisText}\n`;

            if (amountText !== '-') {
              block += `   Jumlah : ${amountText}\n`;
            }

            if (refId) {
              block += `   Ref    : <code>${refId}</code>`;
            }

            lines.push(block);
          });

          const msg = lines.join('\n');
          ctx.reply(msg, { parse_mode: 'HTML' });

          delete userState[ctx.from.id];
        }
      );
    });
  }
///////
    if (state.step.startsWith('username_trial_')) {
                
// Hapus pesan konfirmasi user (biar chat tetap bersih)
  try { await ctx.deleteMessage().catch(() => {}); } catch (e) {}
  
  // Teks yang dikirim user hanya sebagai KONFIRMASI,
  // tidak dipakai sebagai username di server
  const userInput = text; // kalau mau, bisa dipakai untuk log
  const username = `trial${ctx.from.id}`; // username dummy, server akan buat username asli sendiri

  // Tidak perlu validasi format username, karena tidak dipakai oleh server

  const resselDbPath = './ressel.db';
  const idUser = ctx.from.id.toString().trim();
  // lanjut kode lama kamu di bawah ini...


// Baca file reseller
fs.readFile(resselDbPath, 'utf8', async (err, data) => {
  if (err) {
    logger.error('❌ Gagal membaca file ressel.db:', err.message);
    return ctx.reply('❌ *Terjadi kesalahan saat membaca data reseller.*', { parse_mode: 'Markdown' });
  }

  const resselList = data.split('\n').map(line => line.trim()).filter(Boolean);
  const isRessel = resselList.includes(idUser);

              // Cek jika bukan reseller, apakah sudah melewati batas trial harian
            // Cek jika BUKAN reseller
      if (!isRessel) {
        const cfg = await getTrialConfig();

        const maxPerDay = (cfg && Number.isInteger(cfg.maxPerDay) && cfg.maxPerDay > 0)
          ? cfg.maxPerDay
          : 1;

        const minBalance = (cfg && Number.isInteger(cfg.minBalanceForTrial) && cfg.minBalanceForTrial > 0)
          ? cfg.minBalanceForTrial
          : 0;

        // 🔹 Kalau ada minimal saldo → cek saldo user dulu
        if (minBalance > 0) {
          const saldoUser = await getUserBalance(ctx.from.id);
          if (saldoUser < minBalance) {
            return ctx.reply(
              '❌ *Kamu belum memenuhi syarat saldo untuk memakai trial.*\n\n' +
              `• Minimal saldo untuk trial saat ini: *Rp${minBalance}*\n` +
              `• Saldo kamu saat ini              : *Rp${saldoUser}*\n\n` +
              'Silakan topup saldo terlebih dahulu lewat menu *💰 TopUp Saldo Otomatis / Manual via (QRIS)*,\n' +
              'lalu coba lagi fitur trial-nya.',
              { parse_mode: 'Markdown' }
            );
          }
        }

      // 🔹 Jika user WATCHLIST → batas trial lebih ketat
      try {
        const flagStatus = await getUserFlagStatus(ctx.from.id);

        if (flagStatus === 'WATCHLIST') {
          // Contoh aturan: WATCHLIST hanya boleh 1x trial per hari
          const watchlistLimit = 1;
          const usedToday = await getTrialUsageToday(ctx.from.id);

          if (usedToday >= watchlistLimit) {
            return ctx.reply(
              '❌ *Batas trial harian untuk akun WATCHLIST sudah tercapai.*\n\n' +
              `Saat ini akun kamu berstatus *WATCHLIST* sehingga fitur trial hanya bisa dipakai *${watchlistLimit}x per hari*.\n` +
              'Silakan coba lagi besok, atau beli akun lewat menu *➕ Buat Akun*.',
              { parse_mode: 'Markdown' }
            );
          }
        }
      } catch (e) {
        // Kalau gagal baca flag, anggap saja NORMAL
        logger.error('⚠️ Gagal membaca flag_status user saat cek trial WATCHLIST:', e.message || e);
      }

        // 🔹 Cek batas trial harian
        const sudahPakai = await checkTrialAccess(ctx.from.id);
        if (sudahPakai) {
          return ctx.reply(
            '❌ *Batas trial harian sudah tercapai.*\n\n' +
            `Saat ini trial hanya bisa dipakai *${maxPerDay}x per hari* untuk 1 user.\n` +
            'Silakan coba lagi besok, atau beli akun lewat menu *➕ Buat Akun*.',
            { parse_mode: 'Markdown' }
          );
        }
      }

        // Lanjut buat trial
    const { type, serverId } = state;
    delete userState[ctx.chat.id];

        try {
      // Ambil durasi trial dari konfigurasi (satuan JAM)
      const cfg = await getTrialConfig();
      let durationHours = 1;
      if (cfg && Number.isInteger(cfg.durationHours) && cfg.durationHours > 0) {
        durationHours = cfg.durationHours;
      }

      const password = 'none';
      const exp = durationHours;   // DIKIRIM ke script trial sebagai JUMLAH JAM
      const iplimit = 'none';

      const delFunctions = {
        vmess: trialvmess,
        vless: trialvless,
        trojan: trialtrojan,
        shadowsocks: trialshadowsocks,
        ssh: trialssh
      };

      if (delFunctions[type]) {
        const msg = await delFunctions[type](username, password, exp, iplimit, serverId);
await recordAccountTransaction(ctx.from.id, type);
await saveTrialAccess(ctx.from.id);

const extraInfo =
  '\n\nℹ️ *Catatan:*\n' +
  'Username dan password yang tampil di atas dibuat *acak otomatis oleh server*.\n' +
  'Teks yang kamu kirim tadi hanya dipakai sebagai konfirmasi, bukan sebagai username akun.';

await ctx.reply(msg + extraInfo, { parse_mode: 'Markdown' });

        logger.info(`✅ Trial ${type} oleh ${ctx.from.id}`);
      }

    } catch (err) {
      logger.error('❌ Gagal proses trial akun:', err.message);
      await ctx.reply('❌ *Terjadi kesalahan saat memproses trial akun.*', { parse_mode: 'Markdown' });
    }

  });
  return;
}

    if (state.step.startsWith('username_unlock_')) {
    const username = text;
    // Validasi username (hanya huruf kecil dan angka, 3-20 karakter)
    if (!/^[a-z0-9]{3,20}$/.test(username)) {
      return ctx.reply('❌ *Username tidak valid. Gunakan huruf kecil dan angka (3–20 karakter).*', { parse_mode: 'Markdown' });
    }
       //izin ressel saja
    const resselDbPath = './ressel.db';
    fs.readFile(resselDbPath, 'utf8', async (err, data) => {
      if (err) {
        logger.error('❌ Gagal membaca file ressel.db:', err.message);
        return ctx.reply('❌ *Terjadi kesalahan saat membaca data reseller.*', { parse_mode: 'Markdown' });
      }

      const idUser = ctx.from.id.toString().trim();
      const resselList = data.split('\n').map(line => line.trim()).filter(Boolean);



      const isRessel = resselList.includes(idUser);

      if (!isRessel) {
        return ctx.reply('❌ *Fitur ini hanya untuk Ressel VPN.*', { parse_mode: 'Markdown' });
      }
  //izin ressel saja
    const { type, serverId } = state;
    delete userState[ctx.chat.id];

    let msg = 'none';
    try {
      const password = 'none', exp = 'none', iplimit = 'none';

      const delFunctions = {
        vmess: unlockvmess,
        vless: unlockvless,
        trojan: unlocktrojan,
        shadowsocks: unlockshadowsocks,
        ssh: unlockssh
      };

      if (delFunctions[type]) {
        msg = await delFunctions[type](username, password, exp, iplimit, serverId);
        await recordAccountTransaction(ctx.from.id, type);
      }

      await ctx.reply(msg, { parse_mode: 'Markdown' });
      logger.info(`✅ Akun ${type} berhasil unlock oleh ${ctx.from.id}`);
    } catch (err) {
      logger.error('❌ Gagal hapus akun:', err.message);
      await ctx.reply('❌ *Terjadi kesalahan saat menghapus akun.*', { parse_mode: 'Markdown' });
    }});
    return; // Penting! Jangan lanjut ke case lain
  }
    if (state.step.startsWith('username_lock_')) {
    const username = text;
    // Validasi username (hanya huruf kecil dan angka, 3-20 karakter)
    if (!/^[a-z0-9]{3,20}$/.test(username)) {
      return ctx.reply('❌ *Username tidak valid. Gunakan huruf kecil dan angka (3–20 karakter).*', { parse_mode: 'Markdown' });
    }
       //izin ressel saja
    const resselDbPath = './ressel.db';
    fs.readFile(resselDbPath, 'utf8', async (err, data) => {
      if (err) {
        logger.error('❌ Gagal membaca file ressel.db:', err.message);
        return ctx.reply('❌ *Terjadi kesalahan saat membaca data reseller.*', { parse_mode: 'Markdown' });
      }

      const idUser = ctx.from.id.toString().trim();
      const resselList = data.split('\n').map(line => line.trim()).filter(Boolean);



      const isRessel = resselList.includes(idUser);

      if (!isRessel) {
        return ctx.reply('❌ *Fitur ini hanya untuk Ressel VPN.*', { parse_mode: 'Markdown' });
      }
  //izin ressel saja
    const { type, serverId } = state;
    delete userState[ctx.chat.id];

    let msg = 'none';
    try {
      const password = 'none', exp = 'none', iplimit = 'none';

      const delFunctions = {
        vmess: lockvmess,
        vless: lockvless,
        trojan: locktrojan,
        shadowsocks: lockshadowsocks,
        ssh: lockssh
      };

      if (delFunctions[type]) {
        msg = await delFunctions[type](username, password, exp, iplimit, serverId);
        await recordAccountTransaction(ctx.from.id, type);
      }

      await ctx.reply(msg, { parse_mode: 'Markdown' });
      logger.info(`✅ Akun ${type} berhasil di kunci oleh ${ctx.from.id}`);
    } catch (err) {
      logger.error('❌ Gagal hapus akun:', err.message);
      await ctx.reply('❌ *Terjadi kesalahan saat menghapus akun.*', { parse_mode: 'Markdown' });
    }});
    return; // Penting! Jangan lanjut ke case lain
  }
  if (state.step.startsWith('username_del_')) {
    const username = text;
    // Validasi username (hanya huruf kecil dan angka, 3-20 karakter)
    if (!/^[a-z0-9]{3,20}$/.test(username)) {
      return ctx.reply('❌ *Username tidak valid. Gunakan huruf kecil dan angka (3–20 karakter).*', { parse_mode: 'Markdown' });
    }
       //izin ressel saja
    const resselDbPath = './ressel.db';
    fs.readFile(resselDbPath, 'utf8', async (err, data) => {
      if (err) {
        logger.error('❌ Gagal membaca file ressel.db:', err.message);
        return ctx.reply('❌ *Terjadi kesalahan saat membaca data reseller.*', { parse_mode: 'Markdown' });
      }

      const idUser = ctx.from.id.toString().trim();
      const resselList = data.split('\n').map(line => line.trim()).filter(Boolean);



      const isRessel = resselList.includes(idUser);

      if (!isRessel) {
        return ctx.reply('❌ *Fitur ini hanya untuk Ressel VPN.*', { parse_mode: 'Markdown' });
      }
  //izin ressel saja
    const { type, serverId } = state;
    delete userState[ctx.chat.id];

    let msg = 'none';
    try {
      const password = 'none', exp = 'none', iplimit = 'none';

      const delFunctions = {
        vmess: delvmess,
        vless: delvless,
        trojan: deltrojan,
        shadowsocks: delshadowsocks,
        ssh: delssh
      };

      if (delFunctions[type]) {
        msg = await delFunctions[type](username, password, exp, iplimit, serverId);
        await recordAccountTransaction(ctx.from.id, type);
      }

      await ctx.reply(msg, { parse_mode: 'Markdown' });
      logger.info(`✅ Akun ${type} berhasil dihapus oleh ${ctx.from.id}`);
    } catch (err) {
      logger.error('❌ Gagal hapus akun:', err.message);
      await ctx.reply('❌ *Terjadi kesalahan saat menghapus akun.*', { parse_mode: 'Markdown' });
    }});
    return; // Penting! Jangan lanjut ke case lain
  }
  if (state.step.startsWith('username_')) {
    state.username = text;

    if (!state.username) {
      return ctx.reply('❌ *Username tidak valid. Masukkan username yang valid.*', { parse_mode: 'Markdown' });
    }
    if (state.username.length < 4 || state.username.length > 20) {
      return ctx.reply('❌ *Username harus terdiri dari 4 hingga 20 karakter.*', { parse_mode: 'Markdown' });
    }
    if (/[A-Z]/.test(state.username)) {
      return ctx.reply('❌ *Username tidak boleh menggunakan huruf kapital. Gunakan huruf kecil saja.*', { parse_mode: 'Markdown' });
    }
    if (/[^a-z0-9]/.test(state.username)) {
      return ctx.reply('❌ *Username tidak boleh mengandung karakter khusus atau spasi. Gunakan huruf kecil dan angka saja.*', { parse_mode: 'Markdown' });
    }
    const { type, action } = state;
    if (action === 'create') {
      if (type === 'ssh') {
        state.step = `password_${state.action}_${state.type}`;
        await ctx.reply('🔑 *Masukkan password:*', { parse_mode: 'Markdown' });
      } else {
        state.step = `exp_${state.action}_${state.type}`;
        await ctx.reply('⏳ *Masukkan masa aktif (hari):*', { parse_mode: 'Markdown' });
      }
    } else if (action === 'renew') {
      state.step = `exp_${state.action}_${state.type}`;
      await ctx.reply('⏳ *Masukkan masa aktif (hari):*', { parse_mode: 'Markdown' });
    }
  } else if (state.step.startsWith('password_')) {
    state.password = ctx.message.text.trim();
    if (!state.password) {
      return ctx.reply('❌ *Password tidak valid. Masukkan password yang valid.*', { parse_mode: 'Markdown' });
    }
    if (state.password.length < 3) {
      return ctx.reply('❌ *Password harus terdiri dari minimal 3 karakter.*', { parse_mode: 'Markdown' });
    }
    if (/[^a-zA-Z0-9]/.test(state.password)) {
      return ctx.reply('❌ *Password tidak boleh mengandung karakter khusus atau spasi.*', { parse_mode: 'Markdown' });
    }
    state.step = `exp_${state.action}_${state.type}`;
    await ctx.reply('⏳ *Masukkan masa aktif (hari):*', { parse_mode: 'Markdown' });
  } else if (state.step.startsWith('exp_')) {
    const expInput = ctx.message.text.trim();
    
// Cek hanya angka
if (!/^\d+$/.test(expInput)) {
  return ctx.reply('❌ *Masa aktif hanya boleh angka, contoh: 30*', { parse_mode: 'Markdown' });
}

const exp = parseInt(expInput, 10);

if (isNaN(exp) || exp <= 0) {
  return ctx.reply('❌ *Masa aktif tidak valid. Masukkan angka yang valid.*', { parse_mode: 'Markdown' });
}

if (exp > 365) {
  return ctx.reply('❌ *Masa aktif tidak boleh lebih dari 365 hari.*', { parse_mode: 'Markdown' });
}
    state.exp = exp;

    db.get('SELECT quota, iplimit FROM Server WHERE id = ?', [state.serverId], async (err, server) => {
      if (err) {
        logger.error('⚠️ Error fetching server details:', err.message);
        return ctx.reply('❌ *Terjadi kesalahan saat mengambil detail server.*', { parse_mode: 'Markdown' });
      }

      if (!server) {
        return ctx.reply('❌ *Server tidak ditemukan.*', { parse_mode: 'Markdown' });
      }

      // baseQuota = kuota untuk paket 30 hari
  const baseQuota = server.quota;
  const days = state.exp || 30; // kalau exp nggak kebaca, anggap 30 hari

  let computedQuota = baseQuota;

  // Kalau baseQuota > 0 ? hitung proporsional
  if (baseQuota && baseQuota > 0) {
    computedQuota = Math.max(1, Math.floor(baseQuota * days / 30));
  }

  state.quota = computedQuota;
  state.iplimit = server.iplimit;

  const { username, password, exp, quota, iplimit, serverId, type, action } = state;
      let msg;

      db.get('SELECT harga FROM Server WHERE id = ?', [serverId], async (err, server) => {
        if (err) {
          logger.error('⚠️ Error fetching server price:', err.message);
          return ctx.reply('❌ *Terjadi kesalahan saat mengambil harga server.*', { parse_mode: 'Markdown' });
        }

        if (!server) {
          return ctx.reply('❌ *Server tidak ditemukan.*', { parse_mode: 'Markdown' });
        }

                // Harga dasar dari tabel Server (sebagai harga paket 30 hari)
const baseHarga30 = Number(server.harga) || 0;
const days = state.exp || 30;
// cek status reseller lebih awal agar bisa dipakai di bawah
const isR = await isUserReseller(ctx.from.id).catch(() => false);

let totalHarga = 0;
if (baseHarga30 > 0) {
  // Harga normal proporsional terhadap lama hari
  totalHarga = Math.max(1, Math.floor(baseHarga30 * days / 30));


  if (isR) {
    totalHarga = Math.max(1, Math.floor(totalHarga * RESELLER_DISCOUNT));
  }
} else {
  totalHarga = 0;
}


        db.get('SELECT saldo FROM users WHERE user_id = ?', [ctx.from.id], async (err, user) => {
          if (err) {
            logger.error('⚠️ Kesalahan saat mengambil saldo pengguna:', err.message);
            return ctx.reply('❌ *Terjadi kesalahan saat mengambil saldo pengguna.*', { parse_mode: 'Markdown' });
          }

          if (!user) {
            return ctx.reply('❌ *Pengguna tidak ditemukan.*', { parse_mode: 'Markdown' });
          }

          const saldo = user.saldo;
          if (saldo < totalHarga) {
            return ctx.reply('❌ *Saldo Anda tidak mencukupi untuk melakukan transaksi ini.*', { parse_mode: 'Markdown' });
          }
                            // 🔹 Limit create per hari untuk WATCHLIST (non-reseller)
          // isR sudah dihitung di atas (pakai isUserReseller)
          if (action === 'create' && !isR) {
            try {
              const flagStatus = await getUserFlagStatus(ctx.from.id);

              if (flagStatus === 'WATCHLIST') {
                // Aturan: user WATCHLIST hanya boleh X akun baru per hari
                const watchlistCreateLimit = 3; // 👉 silakan ganti angkanya kalau mau
                const createdToday = await getCreateUsageToday(ctx.from.id);

                if (createdToday >= watchlistCreateLimit) {
                  return ctx.reply(
                    '❌ *Batas pembuatan akun harian untuk akun WATCHLIST sudah tercapai.*\n\n' +
                      `Saat ini akun kamu berstatus *WATCHLIST* sehingga hanya boleh membuat *${watchlistCreateLimit} akun baru per hari*.\n` +
                      'Silakan coba lagi besok, atau gunakan akun yang sudah ada / hubungi admin.',
                    { parse_mode: 'Markdown' }
                  );
                }
              }
            } catch (e) {
              logger.error('⚠️ Gagal cek limit create user WATCHLIST:', e.message || e);
              // Kalau error, jangan blok user (anggap saja lolos)
            }
          }
                  let waitCtrl = null;
waitCtrl = await startWaiting(ctx, '⏳ Sedang membuat akun...');
          if (action === 'create') {
            if (type === 'vmess') {
              msg = await createvmess(username, exp, quota, iplimit, serverId);
              await recordAccountTransaction(ctx.from.id, 'vmess');
            } else if (type === 'vless') {
              msg = await createvless(username, exp, quota, iplimit, serverId);
              await recordAccountTransaction(ctx.from.id, 'vless');
            } else if (type === 'trojan') {
              msg = await createtrojan(username, exp, quota, iplimit, serverId);
              await recordAccountTransaction(ctx.from.id, 'trojan');
            } else if (type === 'shadowsocks') {
              msg = await createshadowsocks(username, exp, quota, iplimit, serverId);
              await recordAccountTransaction(ctx.from.id, 'shadowsocks');
            } else if (type === 'ssh') {
              msg = await createssh(username, password, exp, iplimit, serverId);
              await recordAccountTransaction(ctx.from.id, 'ssh');
            }
        // 📝 Simpan / update info akun di tabel accounts
            upsertAccount(ctx.from.id, username, type, serverId, exp);

            logger.info(`Account created and transaction recorded for user ${ctx.from.id}, type: ${type}`);
          } else if (action === 'renew') {
            if (type === 'vmess') {
              msg = await renewvmess(username, exp, quota, iplimit, serverId);
              await recordAccountTransaction(ctx.from.id, 'vmess');
            } else if (type === 'vless') {
              msg = await renewvless(username, exp, quota, iplimit, serverId);
              await recordAccountTransaction(ctx.from.id, 'vless');
            } else if (type === 'trojan') {
              msg = await renewtrojan(username, exp, quota, iplimit, serverId);
              await recordAccountTransaction(ctx.from.id, 'trojan');
            } else if (type === 'shadowsocks') {
              msg = await renewshadowsocks(username, exp, quota, iplimit, serverId);
              await recordAccountTransaction(ctx.from.id, 'shadowsocks');
            } else if (type === 'ssh') {
              msg = await renewssh(username, exp, iplimit, serverId);
              await recordAccountTransaction(ctx.from.id, 'ssh');
            }

            // 📝 Update info akun di tabel accounts (perpanjangan)
            upsertAccount(ctx.from.id, username, type, serverId, exp);

            logger.info(`Account renewed and transaction recorded for user ${ctx.from.id}, type: ${type}`);
          }
//SALDO DATABES
// setelah bikin akun (create/renew), kita cek hasilnya
if (msg.includes('❌')) {
  logger.error(`🔄 Rollback saldo user ${ctx.from.id}, type: ${type}, server: ${serverId}, respon: ${msg}`);
  try { if (waitCtrl) await waitCtrl.stop('❌ Gagal membuat akun. Coba lagi ya.', true); } catch (_) {}
  return ctx.reply(msg, { parse_mode: 'Markdown' });
}

// kalau sampai sini artinya tidak ada ❌, transaksi sukses
logger.info(`✅ Transaksi sukses untuk user ${ctx.from.id}, type: ${type}, server: ${serverId}`);

try {
  // 🔐 Pengurangan saldo + catat transaksi lewat helper
  await processAccountPayment(
    ctx.from.id,
    totalHarga,
    type,
    action,
    serverId,
    username
  );
} catch (err) {
  // Di titik ini kemungkinan besar akun sudah jadi,
  // tapi saldo gagal dipotong (misal karena race condition)
  logger.error('⚠️ Gagal memproses pengurangan saldo & transaksi pembelian:', err.message);
  // Optional: kamu bisa kirim notif ke admin di sini untuk cek manual
}


db.run('UPDATE Server SET total_create_akun = total_create_akun + 1 WHERE id = ?', [serverId], (err) => {
  if (err) {
    logger.error('⚠️ Kesalahan saat menambahkan total_create_akun:', err.message);
  }
});
// ==== NOTIF PEMBELIAN / RENEW KE GRUP ====
try {
   // Info user Telegram
  let userInfo;
  try {
    userInfo = await bot.telegram.getChat(ctx.from.id);
  } catch (e) {
    userInfo = {};
  }

  // ambil username TANPA @, kalau nggak ada pakai first_name, tanpa ID
  let usernameTelegram = userInfo.username || userInfo.first_name || '';

  usernameTelegram = usernameTelegram.trim();
  if (usernameTelegram.startsWith('@')) {
    usernameTelegram = usernameTelegram.slice(1);
  }
  if (!usernameTelegram) {
    usernameTelegram = '-';
  }

 // tampil di notif grup hanya username (tanpa ID)
  const userDisplay = usernameTelegram;
  
  // Role: Reseller / Member
  let roleLabel = 'Member';
  try {
    const isRes = await isUserReseller(ctx.from.id);
    if (isRes) roleLabel = 'Reseller';
  } catch (e) {
    // kalau error, biarkan tetap "Member"
  }

  const actionText = (action === 'create') ? 'ACCOUNT CREATED' : 'ACCOUNT RENEWED';

  // Ambil nama server dari tabel Server
  let serverName = 'Server ID ' + serverId;
  try {
    const serverRow = await new Promise((resolve) => {
      db.get('SELECT nama_server FROM Server WHERE id = ?', [serverId], (err, row) => {
        if (err) {
          logger.error('Gagal ambil nama_server:', err.message);
          return resolve(null);
        }
        resolve(row);
      });
    });

    if (serverRow && serverRow.nama_server) {
      serverName = serverRow.nama_server;
    }
  } catch (e) {
    // sudah di-log di atas kalau error
  }

    // ====== HITUNG DURASI & EXPIRED DARI TABEL accounts ======
  let createdText    = '-';
  let expiredDateOnly = '-';
  let durasiHari     = exp;   // default fallback = exp input
  let sisaHari       = '-';

  try {
    const accountRow = await new Promise((resolve) => {
      db.get(
        'SELECT created_at, expires_at FROM accounts WHERE username = ? AND server_id = ? AND type = ? ORDER BY id DESC LIMIT 1',
        [username, serverId, type],
        (err, row) => {
          if (err) {
            logger.error('Gagal ambil data akun untuk notif grup:', err.message);
            return resolve(null);
          }
          resolve(row);
        }
      );
    });

    const options = {
      timeZone: 'Asia/Jayapura',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    };
    const msPerDay = 24 * 60 * 60 * 1000;

    if (accountRow && accountRow.created_at && accountRow.expires_at) {
      const createdAtDate = new Date(accountRow.created_at);
      const expiredAtDate = new Date(accountRow.expires_at);

      createdText     = createdAtDate.toLocaleDateString('id-ID', options);
      expiredDateOnly = expiredAtDate.toLocaleDateString('id-ID', options);

      // Durasi = selisih hari antara created_at dan expires_at
      durasiHari = Math.max(
        1,
        Math.round((expiredAtDate.getTime() - createdAtDate.getTime()) / msPerDay)
      );

      // Sisa hari dari sekarang
      const diffNow = Math.ceil((expiredAtDate.getTime() - Date.now()) / msPerDay);
      sisaHari = diffNow > 0 ? diffNow : 0;
    } else {
      // Fallback kalau data di accounts belum ada / gagal ambil
      const now = new Date();
      const expiredAt = new Date(now.getTime() + exp * msPerDay);

      createdText     = now.toLocaleDateString('id-ID', options);
      expiredDateOnly = expiredAt.toLocaleDateString('id-ID', options);
      durasiHari      = exp;
      sisaHari        = exp;
    }
  } catch (e) {
    logger.error('Error hitung tanggal expired untuk notif grup:', e.message);
  }

  // Susun teks notif dengan garis '=' (aman di semua HP)
  let notifText = '';

  if (action === 'create') {
    // ➜ NOTIF UNTUK BUAT AKUN BARU
    notifText =
      '<blockquote>\n' +
      '<code>━━━━━━━━━━━━━━━━━━━━</code>\n' +
      '<b>ACCOUNT CREATED</b>\n' +
      '<code>━━━━━━━━━━━━━━━━━━━━</code>\n' +
      '<b>' + serverName + '</b>\n' +
      '<code>\n' + // <-- MULAI BLOK MONOSPACE
      '-> Client  : ' + userDisplay + '\n' +
      '-> Role    : ' + roleLabel + '\n' +
      '-> User    : <code>' + username + '</code>\n' +
      '-> Type    : ' + type.toUpperCase() + '\n' +
      '-> Durasi  : ' + exp + ' Hari\n' +       // durasi paket yang dipilih
     // '-> Sisa    : ' + sisaHari + ' Hari\n' +  // sisa sekarang (harusnya = exp kalau baru dibuat)
      '-> Expired : ' + expiredDateOnly + '\n' +
      '</code>\n' + // <-- AKHIR BLOK MONOSPACE
      '<code>━━━━━━━━━━━━━━━━━━━━</code>\n' +
      '</blockquote>';
  } else {
    // ➜ NOTIF UNTUK RENEW / PERPANJANG
    const sisaSebelum = Math.max(sisaHari - exp, 0); // kira2 sisa sebelum tambah hari

    notifText =
      '<blockquote>\n' +
      '<code>━━━━━━━━━━━━━━━━━━━━</code>\n' +
      '<b>ACCOUNT RENEWED</b>\n' +
      '<code>━━━━━━━━━━━━━━━━━━━━</code>\n' +
      '<b>' + serverName + '</b>\n' +
      '<code>\n' + // <-- MULAI BLOK MONOSPACE
      '-> Client  : ' + userDisplay + '\n' +
      '-> Role    : ' + roleLabel + '\n' +
      '-> User    : <code>' + username + '</code>\n' +
      '-> Type    : ' + type.toUpperCase() + '\n' +
      '-> Sisa sebelum : ' + sisaSebelum + ' Hari\n' +
      '-> Perpanjang   : +' + exp + ' Hari\n' +
      '-> Sisa sekarang: ' + sisaHari + ' Hari\n' +
      '-> Expired      : ' + expiredDateOnly + '\n' +
      '</code>\n' + // <-- AKHIR BLOK MONOSPACE
      '<code>━━━━━━━━━━━━━━━━━━━━</code>\n' +
      '</blockquote>';
  }

  await bot.telegram.sendMessage(GROUP_ID, notifText, { parse_mode: 'HTML' });

} catch (e) {
  logger.error('Gagal kirim notif pembelian ke grup:', e.message);
}
// ==== END NOTIF GRUP ====

if (waitCtrl) await waitCtrl.stop('✅ Akun berhasil dibuat.', true);
await ctx.reply(msg, { parse_mode: 'Markdown' });
delete userState[ctx.chat.id];
//SALDO DATABES
          });
        });
      });
    }
  else if (state.step === 'addserver') {
    const domain = ctx.message.text.trim();
    if (!domain) {
      await ctx.reply('⚠️ *Domain tidak boleh kosong.* Silakan masukkan domain server yang valid.', { parse_mode: 'Markdown' });
      return;
    }

    state.step = 'addserver_auth';
    state.domain = domain;
    await ctx.reply('🔑 *Silakan masukkan auth server:*', { parse_mode: 'Markdown' });
  } else if (state.step === 'addserver_auth') {
    const auth = ctx.message.text.trim();
    if (!auth) {
      await ctx.reply('⚠️ *Auth tidak boleh kosong.* Silakan masukkan auth server yang valid.', { parse_mode: 'Markdown' });
      return;
    }

    state.step = 'addserver_nama_server';
    state.auth = auth;
    await ctx.reply('🏷️ *Silakan masukkan nama server:*', { parse_mode: 'Markdown' });
  } else if (state.step === 'addserver_nama_server') {
    const nama_server = ctx.message.text.trim();
    if (!nama_server) {
      await ctx.reply('⚠️ *Nama server tidak boleh kosong.* Silakan masukkan nama server yang valid.', { parse_mode: 'Markdown' });
      return;
    }

    state.step = 'addserver_quota';
state.nama_server = nama_server;
await ctx.reply(
  '📊 *Silakan masukkan quota server (dalam GB, contoh: 500):*',
  { parse_mode: 'Markdown' }
);
} else if (state.step === 'addserver_quota') {
  const quota = parseInt(ctx.message.text.trim(), 10);
  if (isNaN(quota) || quota <= 0) {
    await ctx.reply(
      '⚠️ *Quota tidak valid.* Quota harus berupa angka dan lebih besar dari 0.\n' +
      'Contoh: `500` (untuk 500 GB).',
      { parse_mode: 'Markdown' }
    );
    return;
  }

    state.step = 'addserver_iplimit';
    state.quota = quota;
    await ctx.reply('🔢 *Silakan masukkan limit IP server:*', { parse_mode: 'Markdown' });
  } else if (state.step === 'addserver_iplimit') {
  const iplimit = parseInt(ctx.message.text.trim(), 10);
  if (isNaN(iplimit) || iplimit <= 0) {
    await ctx.reply(
      '⚠️ *Limit IP tidak valid.* Limit IP harus berupa angka dan lebih besar dari 0.\n' +
      'Contoh: `1` atau `2`.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

    state.step = 'addserver_batas_create_akun';
    state.iplimit = iplimit;
    await ctx.reply('🔢 *Silakan masukkan batas create akun server:*', { parse_mode: 'Markdown' });
  } else if (state.step === 'addserver_batas_create_akun') {
  const batas_create_akun = parseInt(ctx.message.text.trim(), 10);
  if (isNaN(batas_create_akun) || batas_create_akun <= 0) {
    await ctx.reply(
      '⚠️ *Batas create akun tidak valid.* Nilai harus berupa angka dan lebih besar dari 0.\n' +
      'Contoh: `100` (maksimal 100 akun).',
      { parse_mode: 'Markdown' }
    );
    return;
  }

    state.step = 'addserver_harga';
state.batas_create_akun = batas_create_akun;
await ctx.reply(
  '💰 *Silakan masukkan harga server untuk paket 30 hari* (dalam rupiah, tanpa titik. Contoh: 12000):',
  { parse_mode: 'Markdown' }
);

  } else if (state.step === 'addserver_harga') {
    const harga = parseFloat(ctx.message.text.trim());
    if (isNaN(harga) || harga <= 0) {
      await ctx.reply('⚠️ *Harga tidak valid.* Silakan masukkan harga server yang valid.', { parse_mode: 'Markdown' });
      return;
    }
    const { domain, auth, nama_server, quota, iplimit, batas_create_akun } = state;

  try {
    db.run('INSERT INTO Server (domain, auth, nama_server, quota, iplimit, batas_create_akun, harga, total_create_akun) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [domain, auth, nama_server, quota, iplimit, batas_create_akun, harga, 0], function(err) {        if (err) {
          logger.error('Error saat menambahkan server:', err.message);
          ctx.reply('❌ *Terjadi kesalahan saat menambahkan server baru.*', { parse_mode: 'Markdown' });
        } else {
          ctx.reply(`✅ *Server baru dengan domain ${domain} telah berhasil ditambahkan.*\n\n📄 *Detail Server:*\n- Domain: ${domain}\n- Auth: ${auth}\n- Nama Server: ${nama_server}\n- Quota: ${quota}\n- Limit IP: ${iplimit}\n- Batas Create Akun: ${batas_create_akun}\n- Harga: Rp ${harga}`, { parse_mode: 'Markdown' });
        }
      });
    } catch (error) {
      logger.error('Error saat menambahkan server:', error);
      await ctx.reply('❌ *Terjadi kesalahan saat menambahkan server baru.*', { parse_mode: 'Markdown' });
    }
    delete userState[ctx.chat.id];
  }
// === 🏷️ TAMBAH SERVER UNTUK RESELLER ===
if (state && state.step === 'reseller_domain') {
  state.domain = text;
  state.step = 'reseller_auth';
  return ctx.reply('🔑 Masukkan auth server:');
}

if (state && state.step === 'reseller_auth') {
  state.auth = text;
  state.step = 'reseller_harga';
  return ctx.reply('💰 Masukkan harga server (angka):');
}

if (state && state.step === 'reseller_harga') {
  state.harga = text;
  state.step = 'reseller_nama';
  return ctx.reply('📝 Masukkan nama server:');
}

if (state && state.step === 'reseller_nama') {
  state.nama_server = text;
  state.step = 'reseller_quota';
  return ctx.reply('📊 Masukkan quota (GB):');
}

if (state && state.step === 'reseller_quota') {
  state.quota = text;
  state.step = 'reseller_iplimit';
  return ctx.reply('📶 Masukkan IP limit:');
}

if (state && state.step === 'reseller_iplimit') {
  state.iplimit = text;
  state.step = 'reseller_batas';
  return ctx.reply('🔢 Masukkan batas create akun:');
}

if (state && state.step === 'reseller_batas') {
  state.batas_create_akun = text;

  db.run(
    `INSERT INTO Server (domain, auth, harga, nama_server, quota, iplimit, batas_create_akun, total_create_akun, is_reseller_only)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)`,
    [
      state.domain,
      state.auth,
      parseInt(state.harga),
      state.nama_server,
      parseInt(state.quota),
      parseInt(state.iplimit),
      parseInt(state.batas_create_akun),
    ],
    (err) => {
      if (err) {
        logger.error('❌ Gagal menambah server reseller:', err.message);
        ctx.reply('❌ Gagal menambah server reseller.');
      } else {
        ctx.reply(
          `✅ Server reseller *${state.nama_server}* berhasil ditambahkan!`,
          { parse_mode: 'Markdown' }
        );
      }
      delete userState[ctx.chat.id];
    }
  );
  return;
}
// === 💰 TAMBAH SALDO (LANGKAH 1: INPUT USER ID) ===
if (state && state.step === 'addsaldo_userid') {
  state.targetId = text.trim();
  state.step = 'addsaldo_amount';
  return ctx.reply('💰 Masukkan jumlah saldo yang ingin ditambahkan:');
}

// === 💰 TAMBAH SALDO (LANGKAH 1: INPUT USER ID) ===
if (state && state.step === 'addsaldo_userid') {
  state.targetId = text.trim();
  state.step = 'addsaldo_amount';
  return ctx.reply('💰 Masukkan jumlah saldo yang ingin ditambahkan:');
}

// === 💰 TAMBAH SALDO (LANGKAH 2: INPUT JUMLAH SALDO) ===
if (state && state.step === 'addsaldo_amount') {
  const amount = parseInt(text.trim());
  if (isNaN(amount) || amount <= 0) {
    return ctx.reply('⚠️ Jumlah saldo harus berupa angka dan lebih dari 0.');
  }

  const targetId = state.targetId;

// Tambahkan saldo
db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', [amount, targetId], (err) => {
  if (err) {
    logger.error('❌ Gagal menambah saldo:', err.message);
    return ctx.reply('❌ Gagal menambah saldo ke user.');
  }

          // Ambil saldo terbaru
      db.get(
        'SELECT saldo FROM users WHERE user_id = ?',
        [targetId],
        (err2, updated) => {
          const safeTargetId = Number(targetId);

          if (err2 || !updated) {
            // 🧾 Catat transaksi saldo
            recordSaldoTransaction(
              safeTargetId,
              amount,
              'manual_addsaldo',
              `addsaldo_by_${ctx.from.id}`
            );

            // 📩 Notif ke user
bot.telegram
  .sendMessage(
    safeTargetId,
    '💰 Saldo kamu telah <b>ditambahkan</b> sebesar <b>Rp ' + amount.toLocaleString() + '</b>.\n' +
      '💳 Silakan cek saldo kamu di bot.',
    { parse_mode: 'HTML' }
  )
  .catch((e) => {
    logger.error(
      '❌ Gagal mengirim notif saldo masuk ke user (menu tambah_saldo, saldo tidak terbaca):',
      e.message
    );
  });


            // 🎯 Balas ke admin
            ctx.reply(
              `✅ Saldo sebesar Rp${amount.toLocaleString()} berhasil ditambahkan ke user ${targetId}.`
            );
            logger.info(
              `Admin ${ctx.from.id} menambah saldo Rp${amount} ke user ${targetId} (gagal membaca saldo terbaru).`
            );
          } else {
            // 🧾 Catat transaksi saldo
            recordSaldoTransaction(
              safeTargetId,
              amount,
              'manual_addsaldo',
              `addsaldo_by_${ctx.from.id}`
            );

            // 📩 Notif ke user
bot.telegram
  .sendMessage(
    safeTargetId,
    '💰 Saldo kamu telah <b>ditambahkan</b> sebesar <b>Rp ' + amount.toLocaleString() + '</b>.\n' +
      '💳 Saldo sekarang: <b>Rp ' + updated.saldo.toLocaleString() + '</b>.',
    { parse_mode: 'HTML' }
  )
  .catch((e) => {
    logger.error(
      '❌ Gagal mengirim notif saldo masuk ke user (menu tambah_saldo):',
      e.message
    );
  });


            // 🎯 Balas ke admin
            ctx.reply(
              `✅ Saldo sebesar Rp${amount.toLocaleString()} berhasil ditambahkan ke user ${targetId}.\n` +
                `💳 Saldo sekarang: Rp${updated.saldo.toLocaleString()}`
            );
            logger.info(
              `Admin ${ctx.from.id} menambah saldo Rp${amount} ke user ${targetId} (Saldo akhir: Rp${updated.saldo}).`
            );
          }

          // 📨 NOTIF KE GRUP (LOG TOPUP MANUAL) – dipanggil kalau GROUP_ID ada
          try {
            if (NOTIF_TOPUP_GROUP && typeof GROUP_ID !== 'undefined' && GROUP_ID) {
              (async () => {
                try {
                  // Nama admin
                  const adminName = ctx.from.username
                    ? '@' + ctx.from.username
                    : (ctx.from.first_name || ctx.from.id);

                  // Info user yang di-topup
                  let targetInfo;
                  try {
                    targetInfo = await bot.telegram.getChat(safeTargetId);
                  } catch (e) {
                    targetInfo = {};
                  }

                  const targetName = targetInfo.username
                    ? '@' + targetInfo.username
                    : (targetInfo.first_name || String(safeTargetId));

                  const waktu = new Date().toLocaleString('id-ID', {
                    timeZone: 'Asia/Jayapura',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                  });

                  const notifTopup =
                    '<blockquote>\n' +
                    '━━━━━ TOPUP MANUAL ━━━━━\n\n' +
                                        '<code>\n' + // <-- MULAI BLOK MONOSPACE
                    'User   : ' + targetName + ' (' + safeTargetId + ')\n' +
                    'Topup  : Rp ' + amount.toLocaleString() + '\n' +
                    'Status : SUCCESS\n' +
                    'Tanggal: ' + waktu + '\n' +
                                        '</code>\n' + // <-- AKHIR BLOK MONOSPACE
                    '━━━━━━━━━━━━━━━━━━━━\n' +
                    '</blockquote>';

                  await bot.telegram.sendMessage(
                    GROUP_ID,
                    notifTopup,
                    { parse_mode: 'HTML' }
                  );
                } catch (e) {
                  logger.error('❌ Gagal kirim notif topup manual ke grup:', e.message);
                }
              })();
            }
          } catch (e) {
            logger.error('❌ Error umum saat proses notif grup topup manual:', e.message);
          }
        }
      );

  delete userState[ctx.from.id];
});

  return;
}
});
////////
bot.action('addserver', async (ctx) => {
  try {
    logger.info('📥 Proses tambah server dimulai');
    await ctx.answerCbQuery();
       await ctx.reply(
      '🌐 *Silakan masukkan domain/ip server.*\n' +
      'Ketik `batal` untuk membatalkan.',
      { parse_mode: 'Markdown' }
    );

    userState[ctx.chat.id] = { step: 'addserver' };
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses tambah server:', error);
    await ctx.reply('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
  }
});
bot.action('detailserver', async (ctx) => {
  try {
    logger.info('📋 Proses detail server dimulai');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('⚠️ Kesalahan saat mengambil detail server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil detail server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      logger.info('⚠️ Tidak ada server yang tersedia');
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia saat ini.*', { parse_mode: 'Markdown' });
    }

    const buttons = [];
    for (let i = 0; i < servers.length; i += 2) {
      const row = [];
      row.push({
        text: `${servers[i].nama_server}`,
        callback_data: `server_detail_${servers[i].id}`
      });
      if (i + 1 < servers.length) {
        row.push({
          text: `${servers[i + 1].nama_server}`,
          callback_data: `server_detail_${servers[i + 1].id}`
        });
      }
      buttons.push(row);
    }

    await ctx.reply('📋 *Silakan pilih server untuk melihat detail:*', {
      reply_markup: { inline_keyboard: buttons },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('⚠️ Kesalahan saat mengambil detail server:', error);
    await ctx.reply('⚠️ *Terjadi kesalahan saat mengambil detail server.*', { parse_mode: 'Markdown' });
  }
});

bot.action('listserver', async (ctx) => {
  try {
    logger.info('📜 Proses daftar server dimulai');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('⚠️ Kesalahan saat mengambil daftar server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      logger.info('⚠️ Tidak ada server yang tersedia');
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia saat ini.*', { parse_mode: 'Markdown' });
    }

    let serverList = '📜 *Daftar Server* 📜\n\n';
    servers.forEach((server, index) => {
      serverList += `🔹 ${index + 1}. ${server.domain}\n`;
    });

    serverList += `\nTotal Jumlah Server: ${servers.length}`;

    await ctx.reply(serverList, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('⚠️ Kesalahan saat mengambil daftar server:', error);
    await ctx.reply('⚠️ *Terjadi kesalahan saat mengambil daftar server.*', { parse_mode: 'Markdown' });
  }
});
bot.action('resetdb', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply('🚨 *PERHATIAN! Anda akan menghapus semua server yang tersedia. Apakah Anda yakin?*', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Ya', callback_data: 'confirm_resetdb' }],
          [{ text: '❌ Tidak', callback_data: 'cancel_resetdb' }]
        ]
      },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Error saat memulai proses reset database:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});

bot.action('confirm_resetdb', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM Server', (err) => {
        if (err) {
          logger.error('❌ Error saat mereset tabel Server:', err.message);
          return reject('❗️ *PERHATIAN! Terjadi KESALAHAN SERIUS saat mereset database. Harap segera hubungi administrator!*');
        }
        resolve();
      });
    });
    await ctx.reply('🚨 *PERHATIAN! Database telah DIRESET SEPENUHNYA. Semua server telah DIHAPUS TOTAL.*', { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('❌ Error saat mereset database:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});

bot.action('cancel_resetdb', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply('❌ *Proses reset database dibatalkan.*', { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('❌ Error saat membatalkan reset database:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});
bot.action('deleteserver', async (ctx) => {
  try {
    logger.info('🗑️ Proses hapus server dimulai');
    await ctx.answerCbQuery();

    db.all('SELECT * FROM Server', [], (err, servers) => {
      if (err) {
        logger.error('⚠️ Kesalahan saat mengambil daftar server:', err.message);
        return ctx.reply('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*', { parse_mode: 'Markdown' });
      }

      if (servers.length === 0) {
        logger.info('⚠️ Tidak ada server yang tersedia');
        return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia saat ini.*', { parse_mode: 'Markdown' });
      }

      const keyboard = servers.map(server => {
        return [{ text: server.nama_server, callback_data: `confirm_delete_server_${server.id}` }];
      });
      keyboard.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'kembali_ke_menu' }]);

      ctx.reply('🗑️ *Pilih server yang ingin dihapus:*', {
        reply_markup: {
          inline_keyboard: keyboard
        },
        parse_mode: 'Markdown'
      });
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses hapus server:', error);
    await ctx.reply('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
  }
});

async function getUserFlagStatus(userId) {
  return await new Promise((resolve) => {
    db.get(
      'SELECT flag_status FROM users WHERE user_id = ?',
      [userId],
      (err, row) => {
        if (err) {
          logger.error('❌ Kesalahan saat membaca flag_status user:', err.message);
          // Kalau error, anggap NORMAL supaya tidak ganggu user baik
          return resolve('NORMAL');
        }

        if (!row || !row.flag_status) {
          return resolve('NORMAL');
        }

        resolve(String(row.flag_status).toUpperCase());
      }
    );
  });
}

const getUsernameById = async (userId) => {
  try {
    const telegramUser = await bot.telegram.getChat(userId);
    return telegramUser.username || telegramUser.first_name;
  } catch (err) {
    logger.error('❌ Kesalahan saat mengambil username dari Telegram:', err.message);
    throw new Error('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil username dari Telegram.*');
  }
};

//////
bot.action(/next_users_(\d+)/, async (ctx) => {
  const currentPage = parseInt(ctx.match[1]);
  const offset = currentPage * 20;

  try {
    logger.info(`Next users process started for page ${currentPage + 1}`);
    await ctx.answerCbQuery();

    const users = await new Promise((resolve, reject) => {
      db.all(`SELECT user_id FROM users LIMIT 20 OFFSET ${offset}`, [], (err, users) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar user:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar user.*');
        }
        resolve(users);
      });
    });

    const totalUsers = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
        if (err) {
          logger.error('❌ Kesalahan saat menghitung total user:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat menghitung total user.*');
        }
        resolve(row.count);
      });
    });

    const keyboard = [];
    for (let i = 0; i < users.length; i += 2) {
      const row = [];
      const username1 = await getUsernameById(users[i].user_id);
      row.push({
        text: username1 || users[i].user_id,
        callback_data: `add_saldo_${users[i].user_id}`
      });
      if (i + 1 < users.length) {
        const username2 = await getUsernameById(users[i + 1].user_id);
        row.push({
          text: username2 || users[i + 1].user_id,
          callback_data: `add_saldo_${users[i + 1].user_id}`
        });
      }
      keyboard.push(row);
    }

    const replyMarkup = {
      inline_keyboard: [...keyboard]
    };

    const navigationButtons = [];
    if (currentPage > 0) {
      navigationButtons.push([{
        text: '⬅️ Back',
        callback_data: `prev_users_${currentPage - 1}`
      }]);
    }
    if (offset + 20 < totalUsers) {
      navigationButtons.push([{
        text: '➡️ Next',
        callback_data: `next_users_${currentPage + 1}`
      }]);
    }

    replyMarkup.inline_keyboard.push(...navigationButtons);

    await ctx.editMessageReplyMarkup(replyMarkup);
  } catch (error) {
    logger.error('❌ Kesalahan saat memproses next users:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});

bot.action(/prev_users_(\d+)/, async (ctx) => {
  const currentPage = parseInt(ctx.match[1]);
  const offset = (currentPage - 1) * 20;

  try {
    logger.info(`Previous users process started for page ${currentPage}`);
    await ctx.answerCbQuery();

    const users = await new Promise((resolve, reject) => {
      db.all(`SELECT user_id FROM users LIMIT 20 OFFSET ${offset}`, [], (err, users) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar user:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar user.*');
        }
        resolve(users);
      });
    });

    const totalUsers = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
        if (err) {
          logger.error('❌ Kesalahan saat menghitung total user:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat menghitung total user.*');
        }
        resolve(row.count);
      });
    });

    const keyboard = [];
    for (let i = 0; i < users.length; i += 2) {
      const row = [];
      const username1 = await getUsernameById(users[i].user_id);
      row.push({
        text: username1 || users[i].user_id,
        callback_data: `add_saldo_${users[i].user_id}`
      });
      if (i + 1 < users.length) {
        const username2 = await getUsernameById(users[i + 1].user_id);
        row.push({
          text: username2 || users[i + 1].user_id,
          callback_data: `add_saldo_${users[i + 1].user_id}`
        });
      }
      keyboard.push(row);
    }

    const replyMarkup = {
      inline_keyboard: [...keyboard]
    };

    const navigationButtons = [];
    if (currentPage > 0) {
      navigationButtons.push([{
        text: '⬅️ Back',
        callback_data: `prev_users_${currentPage - 1}`
      }]);
    }
    if (offset + 20 < totalUsers) {
      navigationButtons.push([{
        text: '➡️ Next',
        callback_data: `next_users_${currentPage}`
      }]);
    }

    replyMarkup.inline_keyboard.push(...navigationButtons);

    await ctx.editMessageReplyMarkup(replyMarkup);
  } catch (error) {
    logger.error('❌ Kesalahan saat memproses previous users:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});
bot.action('editserver_limit_ip', async (ctx) => {
  try {
    logger.info('Edit server limit IP process started');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT id, nama_server FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia untuk diedit.*', { parse_mode: 'Markdown' });
    }

    const buttons = servers.map(server => ({
      text: server.nama_server,
      callback_data: `edit_limit_ip_${server.id}`
    }));

    const inlineKeyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      inlineKeyboard.push(buttons.slice(i, i + 2));
    }

    await ctx.reply('📊 *Silakan pilih server untuk mengedit limit IP:*', {
      reply_markup: { inline_keyboard: inlineKeyboard },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses edit limit IP server:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});
bot.action('editserver_batas_create_akun', async (ctx) => {
  try {
    logger.info('Edit server batas create akun process started');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT id, nama_server FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia untuk diedit.*', { parse_mode: 'Markdown' });
    }

    const buttons = servers.map(server => ({
      text: server.nama_server,
      callback_data: `edit_batas_create_akun_${server.id}`
    }));

    const inlineKeyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      inlineKeyboard.push(buttons.slice(i, i + 2));
    }

    await ctx.reply('📊 *Silakan pilih server untuk mengedit batas create akun:*', {
      reply_markup: { inline_keyboard: inlineKeyboard },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses edit batas create akun server:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});
bot.action('editserver_total_create_akun', async (ctx) => {
  try {
    logger.info('Edit server total create akun process started');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT id, nama_server FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia untuk diedit.*', { parse_mode: 'Markdown' });
    }

    const buttons = servers.map(server => ({
      text: server.nama_server,
      callback_data: `edit_total_create_akun_${server.id}`
    }));

    const inlineKeyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      inlineKeyboard.push(buttons.slice(i, i + 2));
    }

    await ctx.reply('📊 *Silakan pilih server untuk mengedit total create akun:*', {
      reply_markup: { inline_keyboard: inlineKeyboard },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses edit total create akun server:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});
bot.action('editserver_quota', async (ctx) => {
  try {
    logger.info('Edit server quota process started');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT id, nama_server FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia untuk diedit.*', { parse_mode: 'Markdown' });
    }

    const buttons = servers.map(server => ({
      text: server.nama_server,
      callback_data: `edit_quota_${server.id}`
    }));

    const inlineKeyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      inlineKeyboard.push(buttons.slice(i, i + 2));
    }

    await ctx.reply('📊 *Silakan pilih server untuk mengedit quota:*', {
      reply_markup: { inline_keyboard: inlineKeyboard },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses edit quota server:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});
bot.action('editserver_auth', async (ctx) => {
  try {
    logger.info('Edit server auth process started');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT id, nama_server FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia untuk diedit.*', { parse_mode: 'Markdown' });
    }

    const buttons = servers.map(server => ({
      text: server.nama_server,
      callback_data: `edit_auth_${server.id}`
    }));

    const inlineKeyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      inlineKeyboard.push(buttons.slice(i, i + 2));
    }

    await ctx.reply('🌐 *Silakan pilih server untuk mengedit auth:*', {
      reply_markup: { inline_keyboard: inlineKeyboard },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses edit auth server:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});

bot.action('editserver_harga', async (ctx) => {
  try {
    logger.info('Edit server harga process started');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT id, nama_server FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia untuk diedit.*', { parse_mode: 'Markdown' });
    }

    const buttons = servers.map(server => ({
      text: server.nama_server,
      callback_data: `edit_harga_${server.id}`
    }));

    const inlineKeyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      inlineKeyboard.push(buttons.slice(i, i + 2));
    }

    await ctx.reply('💰 *Silakan pilih server untuk mengedit harga:*', {
      reply_markup: { inline_keyboard: inlineKeyboard },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses edit harga server:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});

bot.action('editserver_domain', async (ctx) => {
  try {
    logger.info('Edit server domain process started');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT id, nama_server FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia untuk diedit.*', { parse_mode: 'Markdown' });
    }

    const buttons = servers.map(server => ({
      text: server.nama_server,
      callback_data: `edit_domain_${server.id}`
    }));

    const inlineKeyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      inlineKeyboard.push(buttons.slice(i, i + 2));
    }

    await ctx.reply('🌐 *Silakan pilih server untuk mengedit domain:*', {
      reply_markup: { inline_keyboard: inlineKeyboard },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses edit domain server:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});

bot.action('nama_server_edit', async (ctx) => {
  try {
    logger.info('Edit server nama process started');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT id, nama_server FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia untuk diedit.*', { parse_mode: 'Markdown' });
    }

    const buttons = servers.map(server => ({
      text: server.nama_server,
      callback_data: `edit_nama_${server.id}`
    }));

    const inlineKeyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
      inlineKeyboard.push(buttons.slice(i, i + 2));
    }

    await ctx.reply('🏷️ *Silakan pilih server untuk mengedit nama:*', {
      reply_markup: { inline_keyboard: inlineKeyboard },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses edit nama server:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});

bot.action('topup_saldo', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    logger.info(`🔍 User ${userId} memulai proses top-up saldo.`);


    if (!global.depositState) {
      global.depositState = {};
    }
    global.depositState[userId] = { action: 'request_amount', amount: '' };

    logger.info(`🔍 User ${userId} diminta untuk memasukkan jumlah nominal saldo.`);


    const keyboard = keyboard_nomor();

    await ctx.editMessageText('💰 *Silakan masukkan jumlah nominal saldo yang Anda ingin tambahkan ke akun Anda:*', {
      reply_markup: {
        inline_keyboard: keyboard
      },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses top-up saldo:', error);
    await ctx.editMessageText('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
  }
});

bot.action(/edit_harga_(\d+)/, async (ctx) => {
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit harga server dengan ID: ${serverId}`);
  userState[ctx.chat.id] = { step: 'edit_harga', serverId: serverId };

  await ctx.reply('💰 *Silakan masukkan harga server baru:*', {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown'
  });
});
bot.action(/add_saldo_(\d+)/, async (ctx) => {
  const userId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk menambahkan saldo user dengan ID: ${userId}`);
  userState[ctx.chat.id] = { step: 'add_saldo', userId: userId };

  await ctx.reply('📊 *Silakan masukkan jumlah saldo yang ingin ditambahkan:*', {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown'
  });
});
bot.action(/edit_batas_create_akun_(\d+)/, async (ctx) => {
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit batas create akun server dengan ID: ${serverId}`);
  userState[ctx.chat.id] = { step: 'edit_batas_create_akun', serverId: serverId };

  await ctx.reply('📊 *Silakan masukkan batas create akun server baru:*', {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown'
  });
});
bot.action(/edit_total_create_akun_(\d+)/, async (ctx) => {
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit total create akun server dengan ID: ${serverId}`);
  userState[ctx.chat.id] = { step: 'edit_total_create_akun', serverId: serverId };

  await ctx.reply('📊 *Silakan masukkan total create akun server baru:*', {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown'
  });
});
bot.action(/edit_limit_ip_(\d+)/, async (ctx) => {
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit limit IP server dengan ID: ${serverId}`);
  userState[ctx.chat.id] = { step: 'edit_limit_ip', serverId: serverId };

  await ctx.reply('📊 *Silakan masukkan limit IP server baru:*', {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown'
  });
});
bot.action(/edit_quota_(\d+)/, async (ctx) => {
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit quota server dengan ID: ${serverId}`);
  userState[ctx.chat.id] = { step: 'edit_quota', serverId: serverId };

  await ctx.reply('📊 *Silakan masukkan quota server baru:*', {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown'
  });
});
bot.action(/edit_auth_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit auth server dengan ID: ${serverId}`);

  // Ambil data server untuk ditampilkan info
  db.get(
    'SELECT auth, domain, nama_server FROM Server WHERE id = ?',
    [serverId],
    async (err, row) => {
      if (err) {
        logger.error('Kesalahan saat mengambil data server untuk edit auth:', err.message);
        await ctx.reply('⚠️ Terjadi kesalahan saat mengambil data server.');
        return;
      }

      if (!row) {
        await ctx.reply('⚠️ Server tidak ditemukan.');
        return;
      }

      const currentAuth = row.auth || '-';
      const currentDomain = row.domain || '-';
      const currentNama = row.nama_server || '-';

      // Biar nggak bocor full key, kita mask dikit
      let maskedAuth = currentAuth;
      if (currentAuth.length > 8) {
        maskedAuth =
          currentAuth.slice(0, 4) + '...' + currentAuth.slice(-4);
      }

      // Simpan state: input berikutnya dianggap sebagai auth baru
      userState[ctx.chat.id] = {
        step: 'edit_auth',
        serverId: serverId,
        oldAuth: currentAuth,
        domain: currentDomain,
        nama: currentNama,
      };

      await ctx.reply(
        '🔐 *Edit AUTH Server*\n' +
          `• Nama   : \`${currentNama}\`\n` +
          `• Domain : \`${currentDomain}\`\n` +
          `• Auth   : \`${maskedAuth}\`\n\n` +
          '🌐 *Silakan ketik AUTH server baru, lalu kirim sebagai pesan biasa.*\n' +
          '❌ Ketik *batal* untuk membatalkan.',
        { parse_mode: 'Markdown' }
      );
    }
  );
});

bot.action(/edit_domain_(\d+)/, async (ctx) => {
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit domain server dengan ID: ${serverId}`);
  userState[ctx.chat.id] = { step: 'edit_domain', serverId: serverId };

  await ctx.reply('🌐 *Silakan masukkan domain server baru:*', {
    reply_markup: { inline_keyboard: keyboard_full() },
    parse_mode: 'Markdown'
  });
});
bot.action(/edit_domain_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit domain server dengan ID: ${serverId}`);

  // Ambil domain sekarang dari database
  db.get('SELECT domain FROM Server WHERE id = ?', [serverId], async (err, row) => {
    if (err) {
      logger.error('Kesalahan saat mengambil data server untuk edit domain:', err.message);
      await ctx.reply('⚠️ Terjadi kesalahan saat mengambil data server.');
      return;
    }

    if (!row) {
      await ctx.reply('⚠️ Server tidak ditemukan.');
      return;
    }

    const currentDomain = row.domain || '-';

    // Simpan state: input berikutnya dianggap sebagai domain baru (via chat teks)
    userState[ctx.chat.id] = {
      step: 'edit_domain',   // << ini yang nanti ditangani di bot.on("text")
      serverId: serverId,
      oldDomain: currentDomain,
    };

    await ctx.reply(
      '🌐 *Silakan ketik domain server baru, lalu kirim sebagai pesan biasa.*\n' +
        `📌 Domain saat ini: \`${currentDomain}\`\n` +
        '✏️ Contoh: `sg1.serverku.com`\n' +
        '❌ Ketik *batal* untuk membatalkan.',
      { parse_mode: 'Markdown' }
    );
  });
});

bot.action(/edit_nama_(\d+)/, async (ctx) => {
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit nama server dengan ID: ${serverId}`);

  // Ambil nama server sekarang dari database
  db.get('SELECT nama_server FROM Server WHERE id = ?', [serverId], async (err, row) => {
    if (err) {
      logger.error('Kesalahan saat mengambil data server:', err.message);
      await ctx.reply('⚠️ Terjadi kesalahan saat mengambil data server.');
      return;
    }

    if (!row) {
      await ctx.reply('⚠️ Server tidak ditemukan.');
      return;
    }

    const currentName = row.nama_server || '-';

    // Simpan state seperti sebelumnya
    userState[ctx.chat.id] = {
      step: 'edit_nama',
      serverId: serverId,
    };

    // Di sini contoh diganti jadi nama server sekarang
    await ctx.reply(
      '🏷️ *Silakan ketik nama server baru, lalu kirim sebagai pesan biasa.*\n' +
      `✏️ Contoh: \`${currentName}\`\n` +
      '❌ Ketik *batal* untuk membatalkan.',
      { parse_mode: 'Markdown' }
    );
  });
});


bot.action(/confirm_delete_server_(\d+)/, async (ctx) => {
  try {
    db.run('DELETE FROM Server WHERE id = ?', [ctx.match[1]], function(err) {
      if (err) {
        logger.error('Error deleting server:', err.message);
        return ctx.reply('⚠️ *PERHATIAN! Terjadi kesalahan saat menghapus server.*', { parse_mode: 'Markdown' });
      }

      if (this.changes === 0) {
        logger.info('Server tidak ditemukan');
        return ctx.reply('⚠️ *PERHATIAN! Server tidak ditemukan.*', { parse_mode: 'Markdown' });
      }

      logger.info(`Server dengan ID ${ctx.match[1]} berhasil dihapus`);
      ctx.reply('✅ *Server berhasil dihapus.*', { parse_mode: 'Markdown' });
    });
  } catch (error) {
    logger.error('Kesalahan saat menghapus server:', error);
    await ctx.reply('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
  }
});

bot.action(/server_detail_(\d+)/, async (ctx) => {
  const serverId = ctx.match[1];
  try {
    const server = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM Server WHERE id = ?', [serverId], (err, server) => {
        if (err) {
          logger.error('⚠️ Kesalahan saat mengambil detail server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil detail server.*');
        }
        resolve(server);
      });
    });

    if (!server) {
      logger.info('⚠️ Server tidak ditemukan');
      return ctx.reply('⚠️ *PERHATIAN! Server tidak ditemukan.*', { parse_mode: 'Markdown' });
    }

    const serverDetails = `📋 *Detail Server* 📋\n\n` +
      `🌐 *Domain:* \`${server.domain}\`\n` +
      `🔑 *Auth:* \`${server.auth}\`\n` +
      `🏷️ *Nama Server:* \`${server.nama_server}\`\n` +
      `📊 *Quota:* \`${server.quota}\`\n` +
      `📶 *Limit IP:* \`${server.iplimit}\`\n` +
      `🔢 *Batas Create Akun:* \`${server.batas_create_akun}\`\n` +
      `📋 *Total Create Akun:* \`${server.total_create_akun}\`\n` +
      `💵 *Harga 30 hari:* \`Rp ${server.harga}\`\n\n`;

    await ctx.reply(serverDetails, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('⚠️ Kesalahan saat mengambil detail server:', error);
    await ctx.reply('⚠️ *Terjadi kesalahan saat mengambil detail server.*', { parse_mode: 'Markdown' });
  }
});

bot.on('callback_query', async (ctx) => {
  const userId = ctx.from.id;
  const data = ctx.callbackQuery.data;
  const userStateData = userState[ctx.chat.id];

  if (global.depositState && global.depositState[userId] && global.depositState[userId].action === 'request_amount') {
    await handleDepositState(ctx, userId, data);
  } else if (userStateData) {
    switch (userStateData.step) {
case 'addsaldo_userid':
  state.targetId = ctx.message.text.trim();
  state.step = 'addsaldo_jumlah';
  return ctx.reply('💰 Masukkan jumlah saldo yang ingin ditambahkan:');

case 'addsaldo_amount':
  const amount = parseInt(ctx.message.text.trim());
  if (isNaN(amount) || amount <= 0) {
    return ctx.reply('⚠️ Jumlah saldo harus berupa angka dan lebih dari 0.');
  }

  const targetId = state.targetId;
  db.get('SELECT * FROM users WHERE user_id = ?', [targetId], (err, row) => {
    if (err) {
      logger.error('❌ Kesalahan saat memeriksa user_id:', err.message);
      return ctx.reply('❌ Terjadi kesalahan saat memeriksa user.');
    }

    if (!row) {
      return ctx.reply(`⚠️ User dengan ID ${targetId} belum terdaftar di database.`);
    }

    db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', [amount, targetId], function (err) {
      if (err) {
        logger.error('❌ Gagal menambah saldo:', err.message);
        return ctx.reply('❌ Gagal menambah saldo.');
      }

      // 🔥 Perbaikan di bawah ini
      db.get('SELECT saldo FROM users WHERE user_id = ?', [targetId], (err2, updatedRow) => {
        if (err2 || !updatedRow) {
          logger.info(`Admin ${ctx.from.id} menambah saldo Rp${amount} ke user ${targetId}, namun gagal membaca saldo terbaru.`);
          return ctx.reply(`✅ Saldo sebesar Rp${amount.toLocaleString()} berhasil ditambahkan ke user ${targetId}.`);
        }

        ctx.reply(`✅ Saldo sebesar Rp${amount.toLocaleString()} berhasil ditambahkan ke user ${targetId}.\n💰 Saldo user sekarang: Rp${updatedRow.saldo.toLocaleString()}`);
        logger.info(`Admin ${ctx.from.id} menambah saldo Rp${amount} ke user ${targetId}. Saldo user sekarang: Rp${updatedRow.saldo}`);
      });

      delete userState[ctx.from.id];
    });
  });
  break;

  default:
    await ctx.reply('❓ Perintah tidak dikenali.');
        break;
///////////////////////////
      case 'edit_batas_create_akun':
        await handleEditBatasCreateAkun(ctx, userStateData, data);
        break;
      case 'edit_limit_ip':
        await handleEditiplimit(ctx, userStateData, data);
        break;
      case 'edit_quota':
        await handleEditQuota(ctx, userStateData, data);
        break;
      case 'edit_auth':
        await handleEditAuth(ctx, userStateData, data);
        break;
      case 'edit_domain':
        await handleEditDomain(ctx, userStateData, data);
        break;
      case 'edit_harga':
        await handleEditHarga(ctx, userStateData, data);
        break;
      case 'edit_nama':
        await handleEditNama(ctx, userStateData, data);
        break;
      case 'edit_total_create_akun':
        await handleEditTotalCreateAkun(ctx, userStateData, data);
        break;
    }
  }
});

async function handleDepositState(ctx, userId, data) {
  let currentAmount = global.depositState[userId].amount;

  if (data === 'delete') {
    currentAmount = currentAmount.slice(0, -1);
  } else if (data === 'confirm') {
    if (currentAmount.length === 0) {
      return await ctx.answerCbQuery('⚠️ Jumlah tidak boleh kosong!', { show_alert: true });
    }
    if (parseInt(currentAmount) < 5000) {
      return await ctx.answerCbQuery('⚠️ Jumlah minimal adalah 5.000 !', { show_alert: true });
    }
    global.depositState[userId].action = 'confirm_amount';
    await processDeposit(ctx, currentAmount);
    return;
  } else {
    if (currentAmount.length < 12) {
      currentAmount += data;
    } else {
      return await ctx.answerCbQuery('⚠️ Jumlah maksimal adalah 12 digit!', { show_alert: true });
    }
  }

  global.depositState[userId].amount = currentAmount;
  const newMessage = `💰 *Silakan masukkan jumlah nominal saldo yang Anda ingin tambahkan ke akun Anda:*\n\nJumlah saat ini: *Rp ${currentAmount || '0'}*`;

  try {
  if (newMessage !== ctx.callbackQuery.message.text) {
    await ctx.editMessageText(newMessage, {
      reply_markup: { inline_keyboard: keyboard_nomor() },
      parse_mode: 'Markdown'
    });
    } else {
      await ctx.answerCbQuery();
    }
  } catch (error) {
    await ctx.answerCbQuery();
    logger.error('Error editing message:', error.message);
  }
}

async function handleAddSaldo(ctx, userStateData, data) {
  let currentSaldo = userStateData.saldo || '';

  if (data === 'backspace') {
    currentSaldo = currentSaldo.slice(0, -1);
  } else if (data === 'confirm') {
    if (currentSaldo.length === 0) {
      return await ctx.answerCbQuery('⚠️ *Jumlah saldo tidak boleh kosong!*', {
        show_alert: true,
      });
    }

    const amount = parseInt(currentSaldo, 10);
    if (isNaN(amount) || amount <= 0) {
      return await ctx.answerCbQuery('⚠️ *Jumlah saldo tidak valid!*', {
        show_alert: true,
      });
    }

    // Hitung bonus untuk topup manual oleh admin
    const { bonus, percent } = calculateTopupBonus(amount);
    const totalCredit = amount + bonus;

    try {
      // Tambah saldo ke user (jumlah yang benar-benar masuk = amount + bonus)
      await updateUserSaldo(userStateData.userId, totalCredit);

      // Catat transaksi saldo (opsional tapi disarankan)
      try {
        const refId = `admin_addsaldo_${ctx.from.id}_${Date.now()}`;
        recordSaldoTransaction(
          userStateData.userId,
          totalCredit,
          'manual_addsaldo',
          refId
        );
      } catch (e) {
        logger.error('⚠️ Gagal mencatat transaksi tambah saldo manual:', e.message);
      }

      let msg =
        '✅ *Saldo user berhasil ditambahkan.*\n\n' +
        '📄 *Detail:*\n' +
        `- Nominal Bayar : *Rp ${amount.toLocaleString('id-ID')}*\n`;

      if (bonus > 0) {
        msg +=
          `- Bonus        : *Rp ${bonus.toLocaleString('id-ID')} (${percent}%)*\n`;
      }

      msg += `- Saldo Masuk   : *Rp ${totalCredit.toLocaleString('id-ID')}*`;

      await ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('❌ Terjadi kesalahan saat menambahkan saldo user:', error.message);
      await ctx.reply(
        '❌ *Terjadi kesalahan saat menambahkan saldo user.*',
        { parse_mode: 'Markdown' }
      );
    }

    delete userState[ctx.chat.id];
    return;
  } else if (data === 'cancel') {
    delete userState[ctx.chat.id];
    return await ctx.answerCbQuery('❌ *Tambah saldo dibatalkan.*', {
      show_alert: true,
    });
  } else {
    if (currentSaldo.length < 10) {
      currentSaldo += data;
    } else {
      return await ctx.answerCbQuery(
        '⚠️ *Jumlah saldo maksimal adalah 10 karakter!*',
        { show_alert: true }
      );
    }
  }

  userStateData.saldo = currentSaldo;
  const newMessage =
    `📊 *Silakan masukkan jumlah saldo yang ingin ditambahkan:*\n\n` +
    `Jumlah saldo saat ini: *${currentSaldo || '0'}*`;

  await ctx.editMessageText(newMessage, {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown',
  });
}


async function handleEditBatasCreateAkun(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'batasCreateAkun', 'batas create akun', 'UPDATE Server SET batas_create_akun = ? WHERE id = ?');
}

async function handleEditTotalCreateAkun(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'totalCreateAkun', 'total create akun', 'UPDATE Server SET total_create_akun = ? WHERE id = ?');
}

async function handleEditiplimit(ctx, userStateData, data) {
  await handleEditField(
    ctx,
    userStateData,
    data,
    'iplimit',
    'limit IP',
    'UPDATE Server SET iplimit = ? WHERE id = ?'
  );
}


async function handleEditQuota(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'quota', 'quota', 'UPDATE Server SET quota = ? WHERE id = ?');
}

async function handleEditAuth(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'auth', 'auth', 'UPDATE Server SET auth = ? WHERE id = ?');
}

async function handleEditDomain(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'domain', 'domain', 'UPDATE Server SET domain = ? WHERE id = ?');
}

async function handleEditHarga(ctx, userStateData, data) {
  let currentAmount = userStateData.amount || '';

  if (data === 'delete') {
    currentAmount = currentAmount.slice(0, -1);
  } else if (data === 'confirm') {
    if (currentAmount.length === 0) {
      return await ctx.answerCbQuery('⚠️ *Jumlah tidak boleh kosong!*', { show_alert: true });
    }
    const hargaBaru = parseFloat(currentAmount);
    if (isNaN(hargaBaru) || hargaBaru <= 0) {
      return ctx.reply('❌ *Harga tidak valid. Masukkan angka yang valid.*', { parse_mode: 'Markdown' });
    }
    try {
      await updateServerField(userStateData.serverId, hargaBaru, 'UPDATE Server SET harga = ? WHERE id = ?');
      ctx.reply(`✅ *Harga server berhasil diupdate.*\n\n📄 *Detail Server:*\n- Harga Baru: *Rp ${hargaBaru}*`, { parse_mode: 'Markdown' });
    } catch (err) {
      ctx.reply('❌ *Terjadi kesalahan saat mengupdate harga server.*', { parse_mode: 'Markdown' });
    }
    delete userState[ctx.chat.id];
    return;
  } else {
    if (!/^\d+$/.test(data)) {
      return await ctx.answerCbQuery('⚠️ *Hanya angka yang diperbolehkan!*', { show_alert: true });
    }
    if (currentAmount.length < 12) {
      currentAmount += data;
    } else {
      return await ctx.answerCbQuery('⚠️ *Jumlah maksimal adalah 12 digit!*', { show_alert: true });
    }
  }

  userStateData.amount = currentAmount;
 const newMessage = `💰 *Silakan masukkan harga server baru (paket 30 hari):*\n\nJumlah saat ini: *Rp ${currentAmount}*`;
  if (newMessage !== ctx.callbackQuery.message.text) {
    await ctx.editMessageText(newMessage, {
      reply_markup: { inline_keyboard: keyboard_nomor() },
      parse_mode: 'Markdown'
    });
  }
}

async function handleEditNama(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'name', 'nama server', 'UPDATE Server SET nama_server = ? WHERE id = ?');
}

async function handleEditField(ctx, userStateData, data, field, fieldName, query) {
  let currentValue = userStateData[field] || '';

  if (data === 'delete') {
    currentValue = currentValue.slice(0, -1);
  } else if (data === 'confirm') {
    if (currentValue.length === 0) {
      return await ctx.answerCbQuery(`⚠️ *${fieldName} tidak boleh kosong!*`, { show_alert: true });
    }
    try {
      await updateServerField(userStateData.serverId, currentValue, query);
      ctx.reply(`✅ *${fieldName} server berhasil diupdate.*\n\n📄 *Detail Server:*\n- ${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}: *${currentValue}*`, { parse_mode: 'Markdown' });
    } catch (err) {
      ctx.reply(`❌ *Terjadi kesalahan saat mengupdate ${fieldName} server.*`, { parse_mode: 'Markdown' });
    }
    delete userState[ctx.chat.id];
    return;
  } else {
    if (!/^[a-zA-Z0-9.-]+$/.test(data)) {
      return await ctx.answerCbQuery(`⚠️ *${fieldName} tidak valid!*`, { show_alert: true });
    }
    if (currentValue.length < 253) {
      currentValue += data;
    } else {
      return await ctx.answerCbQuery(`⚠️ *${fieldName} maksimal adalah 253 karakter!*`, { show_alert: true });
    }
  }

  userStateData[field] = currentValue;
  const newMessage = `📊 *Silakan masukkan ${fieldName} server baru:*\n\n${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} saat ini: *${currentValue}*`;
  if (newMessage !== ctx.callbackQuery.message.text) {
    await ctx.editMessageText(newMessage, {
      reply_markup: { inline_keyboard: keyboard_nomor() },
      parse_mode: 'Markdown'
    });
  }
}
async function updateUserSaldo(userId, saldo) {
  return new Promise((resolve, reject) => {
    db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', [saldo, userId], function (err) {
      if (err) {
        logger.error('⚠️ Kesalahan saat menambahkan saldo user:', err.message);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
// 🔐 Helper: proses pengurangan saldo + catat transaksi pembelian akun
async function processAccountPayment(userId, amount, type, action, serverId, username) {
  // type: vmess/vless/trojan/ssh/shadowsocks
  // action: 'create' atau 'renew'

  const trxType = (action === 'create')
    ? `buy_create_${type}`   // contoh: buy_create_vmess
    : `buy_renew_${type}`;   // contoh: buy_renew_vless

  const refId = `buy-${serverId}-${username}-${Date.now()}`;

  return new Promise((resolve, reject) => {
    // 1) Kurangi saldo dengan syarat saldo masih cukup
    db.run(
      'UPDATE users SET saldo = saldo - ? WHERE user_id = ? AND saldo >= ?',
      [amount, userId, amount],
      function (err) {
        if (err) {
          logger.error('⚠️ Kesalahan saat mengurangi saldo pengguna:', err.message);
          return reject(err);
        }

        // Kalau tidak ada baris yang ke-update, artinya saldo sudah tidak cukup (mungkin terpakai transaksi lain)
        if (this.changes === 0) {
          const warnMsg = `⚠️ Gagal mengurangi saldo (saldo tidak cukup) untuk user ${userId} saat proses pembelian.`;
          logger.warn(warnMsg);
          return reject(new Error(warnMsg));
        }

        // 2) Catat transaksi saldo (kalau gagal, saldo sudah terpotong, jadi kita tetap resolve tapi log error)
        db.run(
          'INSERT INTO transactions (user_id, amount, type, reference_id, timestamp) VALUES (?, ?, ?, ?, ?)',
          [userId, -amount, trxType, refId, Date.now()],
          (err2) => {
            if (err2) {
              logger.error('⚠️ Gagal mencatat transaksi saldo pembelian akun:', err2.message);
              // saldo sudah berkurang, jadi jangan rollback, cukup log
            }
            resolve();
          }
        );
      }
    );
  });
}

async function updateServerField(serverId, value, query) {
  return new Promise((resolve, reject) => {
    db.run(query, [value, serverId], function (err) {
      if (err) {
        // Jangan pakai fieldName karena tidak didefinisikan
        logger.error('⚠️ Kesalahan saat mengupdate data server:', err.message);
        return reject(err);
      }
      resolve();
    });
  });
}



function generateRandomAmount(baseAmount) {
  const random = Math.floor(Math.random() * 99) + 1;
  return baseAmount + random;
}

global.depositState = {};
global.pendingDeposits = {};
let lastRequestTime = 0;
const requestInterval = 1000;

db.all('SELECT * FROM pending_deposits WHERE status = "pending"', [], (err, rows) => {
  if (err) {
    logger.error('Gagal load pending_deposits:', err.message);
    return;
  }
  rows.forEach(row => {
    global.pendingDeposits[row.unique_code] = {
      amount: row.amount,
      originalAmount: row.original_amount,
      userId: row.user_id,
      timestamp: row.timestamp,
      status: row.status,
      qrMessageId: row.qr_message_id
    };
  });
  logger.info('Pending deposit loaded:', Object.keys(global.pendingDeposits).length);
});

// ============================================================================
// ============================================================================
// SECTION: PAYMENT - QRIS AUTO TOPUP (RAJASERVERPREMIUM GATEWAY)
// - processDeposit : buat QR dinamis (createpayment) + simpan pending
// - checkQRISStatus: cek status via cekstatus (tanpa hit app.orderkuota.com dari VPS)
// ============================================================================

// PM2 cluster guard (biar interval cuma jalan 1x kalau pakai cluster)
const IS_PM2_PRIMARY = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';

function _getOrkutAccountId() {
  // token format: "2304754:xxxx"
  if (ORDERKUOTA_AUTH_TOKEN && String(ORDERKUOTA_AUTH_TOKEN).includes(':')) {
    return String(ORDERKUOTA_AUTH_TOKEN).split(':')[0];
  }
  return '';
}

function _getBaseQr() {
  // pakai ORDERKUOTA_BASE_QR kalau ada, fallback ke DATA_QRIS
  return ORDERKUOTA_BASE_QR || DATA_QRIS || '';
}

function _getTimeoutMs() {
  // pakai config kamu
  const ms = Number(QRIS_CHECK_INTERVAL_MS || 15000);
  return ms >= 2000 ? ms : 15000;
}

function _getPaymentTimeoutMin() {
  const m = Number(QRIS_PAYMENT_TIMEOUT_MIN || 5);
  return m > 0 ? m : 5;
}

function _getMinMaxTopup() {
  return {
    min: Number(QRIS_AUTO_TOPUP_MIN || 1000),
    max: Number(QRIS_AUTO_TOPUP_MAX || 300000),
  };
}

function _randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function processDeposit(ctx, amount) {
  const currentTime = Date.now();

  // Anti spam
  if (currentTime - lastRequestTime < requestInterval) {
    await ctx.editMessageText(
      '⚠️ *Terlalu banyak permintaan. Silakan tunggu sebentar sebelum mencoba lagi.*',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  lastRequestTime = currentTime;

  const userId = ctx.from.id;

  // batas nominal
  const amountNum = Number(amount || 0);
  const { min, max } = _getMinMaxTopup();
  if (!Number.isFinite(amountNum) || amountNum < min || amountNum > max) {
    await ctx.editMessageText(
      `❌ *Nominal tidak valid!*\n\nMinimal: *Rp ${min.toLocaleString('id-ID')}*\nMaksimal: *Rp ${max.toLocaleString('id-ID')}*`,
      { parse_mode: 'Markdown' }
    );
    delete global.depositState[userId];
    return;
  }

  // pastikan API_KEY ada
  if (!API_KEY || API_KEY === 'NONE') {
    await ctx.editMessageText(
      '❌ *API_KEY belum diisi.*\n\nIsi `API_KEY` di `.vars.json` dengan apikey dari rajaserverpremium.',
      { parse_mode: 'Markdown' }
    );
    delete global.depositState[userId];
    return;
  }

  const baseQr = _getBaseQr();
  if (!baseQr || baseQr.length < 10) {
    await ctx.editMessageText(
      '❌ *QR String belum benar.*\n\nCek `ORDERKUOTA_BASE_QR` / `DATA_QRIS` di `.vars.json`.',
      { parse_mode: 'Markdown' }
    );
    delete global.depositState[userId];
    return;
  }

  // Buat nominal unik (biar match pas cek status)
  const uniqueSuffix = _randomInt(1, 300);
  const finalAmount = amountNum + uniqueSuffix;
  const adminFee = uniqueSuffix;

  // kode unik internal + reference (buat info)
  const ts = Date.now();
  const uniqueCode = `TOPUP-${userId}-${ts}`;
  const referenceId = `REF-${ts}-${_randomInt(1000, 9999)}`;

  try {
    // 1) CREATE PAYMENT (QR DINAMIS)
    const createRes = await axios.get(
      'https://api.rajaserverpremium.web.id/orderkuota/createpayment',
      {
        params: {
          apikey: API_KEY,
          amount: finalAmount,
          codeqr: baseQr,
          reference: referenceId,
        },
        timeout: 15000,
      }
    );

    if (createRes.data?.status !== 'success') {
      throw new Error(createRes.data?.message || 'createpayment gagal');
    }

    const qrImageUrl = createRes.data?.result?.imageqris?.url;
    if (!qrImageUrl || String(qrImageUrl).includes('undefined')) {
      throw new Error('QR URL tidak valid dari createpayment');
    }

    // 2) DOWNLOAD QR
    const qrResponse = await axios.get(qrImageUrl, { responseType: 'arraybuffer', timeout: 15000 });
    const qrBuffer = Buffer.from(qrResponse.data);

    const timeoutMin = _getPaymentTimeoutMin();
    const caption =
      `💳 *INSTRUKSI PEMBAYARAN*\n\n` +
      `💰 *TOP-UP:* Rp ${amountNum.toLocaleString('id-ID')}\n` +
      `🎲 *ADMIN FEE:* Rp ${adminFee.toLocaleString('id-ID')}\n` +
      `💵 *TOTAL BAYAR:* Rp ${finalAmount.toLocaleString('id-ID')}\n\n` +
      `📌 *CARA BAYAR:*\n` +
      `1) Scan QR di atas\n` +
      `2) Transfer *TEPAT* Rp ${finalAmount.toLocaleString('id-ID')}\n` +
      `3) Jangan kurang / lebih\n\n` +
      `⏳ QR berlaku *${timeoutMin} menit*\n` +
      `🆔 Ref: \`${referenceId}\``;

    const qrMessage = await ctx.replyWithPhoto(
      { source: qrBuffer },
      { caption, parse_mode: 'Markdown' }
    );

    // Hapus pesan input nominal
    try { await ctx.deleteMessage(); } catch (_) {}

    // 3) SIMPAN KE MEMORY
    global.pendingDeposits[uniqueCode] = {
      amount: finalAmount,
      originalAmount: amountNum,
      adminFee,
      userId,
      timestamp: Date.now(),
      status: 'pending',
      qrMessageId: qrMessage.message_id,
      referenceId,
      expiresAt: Date.now() + (timeoutMin * 60 * 1000),
    };

    // 4) SIMPAN KE SQLITE (field existing kamu)
    db.run(
      `INSERT INTO pending_deposits
        (unique_code, user_id, amount, original_amount, timestamp, status, qr_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uniqueCode, userId, finalAmount, amountNum, Date.now(), 'pending', qrMessage.message_id],
      (err) => {
        if (err) logger.error('❌ Gagal insert pending_deposits:', err.message);
      }
    );

    delete global.depositState[userId];
    logger.info(`✅ QR dynamic sent: user=${userId} amount=${finalAmount} ref=${referenceId}`);

  } catch (error) {
    logger.error('❌ Deposit error:', error?.message || error);
    await ctx.editMessageText(
      '❌ *GAGAL MEMBUAT PEMBAYARAN*\n\nSilakan coba lagi.',
      { parse_mode: 'Markdown' }
    );
    delete global.depositState[userId];
  }
}

async function createQrisInvoice(baseAmount, noteOrReference) {
  // baseAmount = nominal yang diminta user (tanpa kode unik)
  const base_amount = Number(baseAmount);
  if (!Number.isFinite(base_amount) || base_amount <= 0) {
    throw new Error("Nominal baseAmount tidak valid");
  }

  // pastikan apikey gateway sudah diisi
  if (!API_KEY || API_KEY === "NONE") {
    throw new Error("API_KEY (RajaServerPremium) belum diisi di .vars.json");
  }

  // QR base string
  const baseQr = ORDERKUOTA_BASE_QR || DATA_QRIS;
  if (!baseQr || String(baseQr).length < 10 || baseQr === "00") {
    throw new Error("ORDERKUOTA_BASE_QR / DATA_QRIS belum benar");
  }

  // kode unik dibuat di sini (sesuai komentar di code kamu)
  // kamu bisa pakai range 50–200 atau 1–300, bebas. Aku samakan 50–200 biar rapi.
  const MIN_SUFFIX = 50;
  const MAX_SUFFIX = 200;

  let unique_suffix = MIN_SUFFIX + Math.floor(Math.random() * (MAX_SUFFIX - MIN_SUFFIX + 1));
  let amount = base_amount + unique_suffix;

  // patuhi batas MAX topup kalau variabel global ada
  if (typeof QRIS_AUTO_TOPUP_MAX !== "undefined") {
    const max = Number(QRIS_AUTO_TOPUP_MAX);
    if (Number.isFinite(max) && amount > max) {
      const diff = max - base_amount;
      if (diff >= MIN_SUFFIX) {
        unique_suffix = Math.min(diff, MAX_SUFFIX);
        amount = base_amount + unique_suffix;
      } else {
        unique_suffix = 0;
        amount = base_amount;
      }
    }
  }

  // reference untuk gateway
  const reference = String(noteOrReference || `TOPUP-${Date.now()}`);

  // panggil gateway createpayment
  const r = await axios.get("https://api.rajaserverpremium.web.id/orderkuota/createpayment", {
    params: {
      apikey: API_KEY,
      amount: amount,
      codeqr: baseQr,
      reference: reference,
    },
    timeout: 15000,
  });

  if (r.data?.status !== "success") {
    throw new Error(r.data?.message || "createpayment gagal");
  }

  // dari contoh: result.idtransaksi, result.imageqris.url
  const invoice_id = r.data?.result?.idtransaksi || r.data?.result?.id || "";
  const qr_url = r.data?.result?.imageqris?.url || "";

  if (!invoice_id) throw new Error("createpayment tidak mengembalikan id transaksi");
  if (!qr_url || String(qr_url).includes("undefined")) throw new Error("QR URL tidak valid dari createpayment");

  return {
  invoice_id,
  amount,
  base_amount,
  unique_suffix,
  qris_image_url: qr_url,   // <<< INI PENTING biar cocok dengan kode kamu
  // optional:
  qris_image_path: null,
  payment_link: null,
  qris_text: null,
  expired: r.data?.result?.expired || null,
  raw: r.data,
};

}

async function checkQRISStatus() {
  try {
    const entries = Object.entries(global.pendingDeposits || {}).filter(
      ([, d]) => d.status === 'pending'
    );
    if (entries.length === 0) return;

    const timeoutMin = _getPaymentTimeoutMin();
    const accountId = _getOrkutAccountId();
    const webMutasi = accountId
      ? `https://app.orderkuota.com/api/v2/qris/mutasi/${accountId}`
      : '';

    if (!API_KEY || API_KEY === 'NONE') {
      logger.error('❌ QRIS cekstatus: API_KEY belum diisi');
      return;
    }
    if (!ORDERKUOTA_AUTH_USERNAME || !ORDERKUOTA_AUTH_TOKEN || !webMutasi) {
      logger.error('❌ QRIS cekstatus: ORDERKUOTA_AUTH_USERNAME/TOKEN/ACCOUNT_ID belum valid');
      return;
    }

    for (const [uniqueCode, deposit] of entries) {
      // expired
      const expiredAt = deposit.expiresAt || (deposit.timestamp + (timeoutMin * 60 * 1000));
      if (Date.now() > expiredAt) {
        try {
          if (deposit.qrMessageId) {
            await bot.telegram.deleteMessage(deposit.userId, deposit.qrMessageId);
          }
          await bot.telegram.sendMessage(
            row.user_id,
            `⏰ <b>QRIS EXPIRED</b>\n` +
              `━━━━━━━━━━━━━━━━\n` +
              `QR sudah tidak berlaku (melewati batas waktu).\n` +
              `Silakan buat QRIS baru dari menu topup.\n` +
              `━━━━━━━━━━━━━━━━\n` +
              `Invoice: <code>${row.invoice_id}</code>`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🏠 Menu Utama', callback_data: 'send_main_menu' }],
                ],
              },
            }
          );
          
        } catch (e) {}
        delete global.pendingDeposits[uniqueCode];
        db.run('DELETE FROM pending_deposits WHERE unique_code = ?', [uniqueCode]);
        continue;
      }

      // 1) CEK STATUS BY AMOUNT (gateway rajaservers)
      let resp;
      try {
        const cekRes = await axios.get(
          'https://api.rajaserverpremium.web.id/orderkuota/cekstatus',
          {
            params: {
              apikey: API_KEY,
              auth_username: ORDERKUOTA_AUTH_USERNAME,
              auth_token: ORDERKUOTA_AUTH_TOKEN,
              web_mutasi: webMutasi,
              amount: Math.round(Number(deposit.amount || 0)),
            },
            timeout: 15000,
          }
        );
        resp = cekRes.data;
      } catch (e) {
        logger.error('❌ QRIS cekstatus error:', e?.message || e);
        continue;
      }

      if (!resp || resp.status !== 'success') {
        // gateway error / rate limit / dll
        if (resp?.message) logger.error(`❌ QRIS cekstatus: ${resp.message}`);
        continue;
      }

      // 2) DETEKSI PAYMENT MASUK
      const expected = Math.round(Number(deposit.amount || 0));
      let matchedTransaction = null;

      // kalau resp.result ada list mutasi
      if (Array.isArray(resp.result)) {
        for (const item of resp.result) {
          const kredit = parseRupiahInt(item.kredit || item.jumlah || item.amount || item.nominal);
          if (kredit === expected) {
            matchedTransaction = {
              amount: kredit,
              kredit,
              reference_id: String(item.id || item.tanggal || `rs-${kredit}-${Date.now()}`),
              tanggal: item.tanggal || '',
              raw: item,
            };
            break;
          }
        }
      }

      // fallback: kadang ada resp.payment.state
      if (!matchedTransaction && resp.payment && String(resp.payment.state || '').toLowerCase() === 'paid') {
        matchedTransaction = {
          amount: expected,
          kredit: expected,
          reference_id: String(resp.payment.reference || deposit.referenceId || uniqueCode),
          raw: resp,
        };
      }

      // 3) PROSES SALDO (pakai fungsi kamu yang sudah ada: processMatchingPayment)
      if (matchedTransaction) {
        const ok = await processMatchingPayment(deposit, matchedTransaction, uniqueCode);
        if (ok) {
          logger.info(`✅ QRIS paid: ${uniqueCode} amount=${expected}`);
        }
      }
    }
  } catch (error) {
    logger.error('Error in checkQRISStatus:', error?.message || error);
  }
}

// Jalankan auto check (pakai interval dari vars.json)
//if (IS_PM2_PRIMARY) {
//  setInterval(checkQRISStatus, _getTimeoutMs());
// logger.info(`✅ Auto-topup QRIS aktif. Interval: ${_getTimeoutMs()}ms`);
//} else {
//  logger.info('ℹ️ Auto-topup QRIS nonaktif di instance non-primary (PM2 cluster).');
//}

// ===== END SECTION: PAYMENT - QRIS AUTO TOPUP (RAJASERVERPREMIUM GATEWAY) ===


async function recordAccountTransaction(userId, type) {
  return new Promise((resolve, reject) => {
    const referenceId = `account-${type}-${userId}-${Date.now()}`;
    db.run(
      'INSERT INTO transactions (user_id, type, reference_id, timestamp) VALUES (?, ?, ?, ?)',
      [userId, type, referenceId, Date.now()],
      (err) => {
        if (err) {
          logger.error('Error recording account transaction:', err.message);
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}
function upsertAccount(userId, username, type, serverId, expDays) {
  const nowTs  = Date.now();
  const dayMs  = 24 * 60 * 60 * 1000;

  // Ubah exp (hari) jadi mili detik yang mau DITAMBAHKAN
  let addMs = 0;
  if (expDays && Number.isFinite(expDays) && expDays > 0) {
    addMs = expDays * dayMs;
  }

  db.get(
    'SELECT id, created_at, expires_at FROM accounts WHERE user_id = ? AND username = ? AND type = ? AND server_id = ? ORDER BY id DESC LIMIT 1',
    [userId, username, type, serverId],
    (err, row) => {
      if (err) {
        logger.error('Kesalahan saat membaca tabel accounts:', err.message);
        return;
      }

      if (row) {
        // ==== RENEW: akun sudah ada, kita TAMBAH hari ====
        const oldCreated  = row.created_at || nowTs;
        const oldExpires  = row.expires_at || nowTs;

        // Kalau expired lama masih di depan, tambah dari sana.
        // Kalau sudah lewat, mulai dari sekarang.
        const baseTs      = oldExpires > nowTs ? oldExpires : nowTs;
        const newExpires  = baseTs + addMs;

        db.run(
          'UPDATE accounts SET created_at = ?, expires_at = ? WHERE id = ?',
          [oldCreated, newExpires, row.id],
          (err2) => {
            if (err2) {
              logger.error('Kesalahan memperbarui data akun di tabel accounts:', err2.message);
            } else {
              logger.info(`Accounts updated untuk user ${userId}, ${type}:${username} di server ${serverId}`);
            }
          }
        );
      } else {
        // ==== CREATE: belum ada, buat record baru ====
        const createdAt = nowTs;
        const expiresAt = addMs ? nowTs + addMs : null;

        db.run(
          'INSERT INTO accounts (user_id, username, type, server_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
          [userId, username, type, serverId, createdAt, expiresAt],
          (err2) => {
            if (err2) {
              logger.error('Kesalahan menyimpan data akun ke tabel accounts:', err2.message);
            } else {
              logger.info(`Accounts inserted untuk user ${userId}, ${type}:${username} di server ${serverId}`);
            }
          }
        );
      }
    }
  );
}

if (EXPIRE_DATE) {
  const now = new Date();
  // Misal pakai zona waktu Jayapura
  const expire = new Date(EXPIRE_DATE + 'T23:59:59+09:00');

  if (now > expire) {
    console.log('⚠️ Lisensi bot sudah kadaluarsa. Harap hubungi pemilik panel.');
    // Kirim pesan ke admin bot kalau bisa
    try {
      const adminId = Number(vars.ADMIN_ID);
      if (adminId) {
        axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          chat_id: adminId,
          text: 'Lisensi bot kamu sudah kadaluarsa. Silakan hubungi pemilik panel.'
        }).catch(() => {});
      }
    } catch (e) {}

    process.exit(1); // keluar, pm2 akan restart tapi langsung mati lagi
  }

  // Cek tiap beberapa menit saat sudah jalan
  setInterval(() => {
    const now2 = new Date();
    if (now2 > expire) {
      console.log('⚠️ Lisensi bot kadaluarsa saat berjalan, menghentikan bot.');
      process.exit(1);
    }
  }, 5 * 60 * 1000); // cek tiap 5 menit
}


// Jalankan bot (hanya kalau BOT_TOKEN sudah di-set)
if (BOT_TOKEN) {
  bot.launch()
    .then(() => {
      logger.info('Bot telah dimulai (build QRIS AUTO v3)');
    })
    .catch((error) => {
      logger.error('Error saat memulai bot:', error);
    });

  // Jalankan scheduler di luar app.listen
  startAutoTopupMutasi(bot, db, logger, axios);
  restartAutoBackupScheduler();
  startDailyReportScheduler();
  startExpiryReminderScheduler();
  startResellerTargetScheduler();
} else {
  logger.warn('BOT_TOKEN belum di-set di .vars.json. Bot tidak akan berjalan. Set BOT_TOKEN terlebih dahulu.');
}
// startQrisAutoTopupChecker(); // JANGAN dipanggil lagi di sini,
//                              // soalnya di atas sudah ada "startQrisAutoTopupChecker();"

// HTTP server
app.listen(port, () => {
  logger.info(`Server berjalan di port ${port}`);
});



