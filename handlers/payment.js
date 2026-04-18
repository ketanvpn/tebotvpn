'use strict';

// ============================================================================
// handlers/payment.js — PAYMENT & QRIS TOPUP HANDLERS
// Dipindahkan dari app.js (Tahap 5 refactoring)
//
// Exports:
//   register(bot, deps)    — daftarkan semua handler ke bot
//   processDeposit(ctx, amount) — buat QR dinamis rajaserverpremium
//   createQrisInvoice(base, ref) — buat invoice QRIS (gateway rajaserverpremium)
// ============================================================================

const axios  = require('axios');
const { db } = require('../db');
const logger = require('../config/logger');
const cfg    = require('../config/vars');
const { ensurePrivateChat, NO_ACCESS_MESSAGE } = require('../helpers');

const {
  ADMIN_IDS,
  MASTER_ID,
  GROUP_ID,
  NOTIF_TOPUP_GROUP,
  API_KEY,
  ORDERKUOTA_BASE_QR,
  ORDERKUOTA_AUTH_USERNAME,
  ORDERKUOTA_AUTH_TOKEN,
  DATA_QRIS,
  QRIS_AUTO_TOPUP_MIN,
  QRIS_AUTO_TOPUP_MAX,
  QRIS_CHECK_INTERVAL_MS,
  QRIS_PAYMENT_TIMEOUT_MIN,
} = cfg;

// ── module-level state ────────────────────────────────────────────────────────
let _bot;

// Anti-spam interval untuk processDeposit
let lastRequestTime = 0;
const requestInterval = 1000;

// Inisialisasi global state (safe: jangan reset kalau sudah ada)
global.depositState    = global.depositState    || {};
global.pendingDeposits = global.pendingDeposits || {};

// Muat ulang pending_deposits dari DB ke memory saat startup
db.all('SELECT * FROM pending_deposits WHERE status = "pending"', [], (err, rows) => {
  if (err) {
    logger.error('Gagal load pending_deposits:', err.message);
    return;
  }
  rows.forEach(row => {
    global.pendingDeposits[row.unique_code] = {
      amount:         row.amount,
      originalAmount: row.original_amount,
      userId:         row.user_id,
      timestamp:      row.timestamp,
      status:         row.status,
      qrMessageId:    row.qr_message_id,
    };
  });
  logger.info('Pending deposit loaded:', Object.keys(global.pendingDeposits).length);
});

// ── PM2 cluster guard ─────────────────────────────────────────────────────────
const IS_PM2_PRIMARY = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';

// ── Private helper functions ─────────────────────────────────────────────────
function _getOrkutAccountId() {
  if (ORDERKUOTA_AUTH_TOKEN && String(ORDERKUOTA_AUTH_TOKEN).includes(':')) {
    return String(ORDERKUOTA_AUTH_TOKEN).split(':')[0];
  }
  return '';
}

function _getBaseQr() {
  return ORDERKUOTA_BASE_QR || DATA_QRIS || '';
}

function _getTimeoutMs() {
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

function parseRupiahInt(val) {
  if (val === null || val === undefined) return 0;
  return parseInt(String(val).replace(/[^\d]/g, ''), 10) || 0;
}

// ── openTopupQrisMenu ─────────────────────────────────────────────────────────
// (fungsi helper; dipanggil oleh /topupqris dan topupqris_btn)
async function openTopupQrisMenu(ctx, userState) {
  if (!ensurePrivateChat(ctx)) return;

  const chatId = ctx.chat.id;
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

// ── processDeposit ────────────────────────────────────────────────────────────
// Buat QR dinamis via rajaserverpremium + simpan ke pendingDeposits
async function processDeposit(ctx, amount) {
  const currentTime = Date.now();

  if (currentTime - lastRequestTime < requestInterval) {
    await ctx.editMessageText(
      '⚠️ *Terlalu banyak permintaan. Silakan tunggu sebentar sebelum mencoba lagi.*',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  lastRequestTime = currentTime;

  const userId = ctx.from.id;

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

  const uniqueSuffix = _randomInt(1, 300);
  const finalAmount  = amountNum + uniqueSuffix;
  const adminFee     = uniqueSuffix;

  const ts          = Date.now();
  const uniqueCode  = `TOPUP-${userId}-${ts}`;
  const referenceId = `REF-${ts}-${_randomInt(1000, 9999)}`;

  try {
    const createRes = await axios.get(
      'https://api.rajaserverpremium.web.id/orderkuota/createpayment',
      {
        params: {
          apikey:    API_KEY,
          amount:    finalAmount,
          codeqr:    baseQr,
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

    const qrResponse = await axios.get(qrImageUrl, { responseType: 'arraybuffer', timeout: 15000 });
    const qrBuffer   = Buffer.from(qrResponse.data);

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

    try { await ctx.deleteMessage(); } catch (_) {}

    global.pendingDeposits[uniqueCode] = {
      amount:         finalAmount,
      originalAmount: amountNum,
      adminFee,
      userId,
      timestamp:      Date.now(),
      status:         'pending',
      qrMessageId:    qrMessage.message_id,
      referenceId,
      expiresAt:      Date.now() + (timeoutMin * 60 * 1000),
    };

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

// ── createQrisInvoice ─────────────────────────────────────────────────────────
async function createQrisInvoice(baseAmount, noteOrReference) {
  const base_amount = Number(baseAmount);
  if (!Number.isFinite(base_amount) || base_amount <= 0) {
    throw new Error('Nominal baseAmount tidak valid');
  }

  if (!API_KEY || API_KEY === 'NONE') {
    throw new Error('API_KEY (RajaServerPremium) belum diisi di .vars.json');
  }

  const baseQr = ORDERKUOTA_BASE_QR || DATA_QRIS;
  if (!baseQr || String(baseQr).length < 10 || baseQr === '00') {
    throw new Error('ORDERKUOTA_BASE_QR / DATA_QRIS belum benar');
  }

  const MIN_SUFFIX   = 50;
  const MAX_SUFFIX   = 200;
  let unique_suffix  = MIN_SUFFIX + Math.floor(Math.random() * (MAX_SUFFIX - MIN_SUFFIX + 1));
  let amount         = base_amount + unique_suffix;

  if (typeof QRIS_AUTO_TOPUP_MAX !== 'undefined') {
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

  const reference = String(noteOrReference || `TOPUP-${Date.now()}`);

  const r = await axios.get('https://api.rajaserverpremium.web.id/orderkuota/createpayment', {
    params: {
      apikey:    API_KEY,
      amount:    amount,
      codeqr:    baseQr,
      reference: reference,
    },
    timeout: 15000,
  });

  if (r.data?.status !== 'success') {
    throw new Error(r.data?.message || 'createpayment gagal');
  }

  const invoice_id = r.data?.result?.idtransaksi || r.data?.result?.id || '';
  const qr_url     = r.data?.result?.imageqris?.url || '';

  if (!invoice_id) throw new Error('createpayment tidak mengembalikan id transaksi');
  if (!qr_url || String(qr_url).includes('undefined')) throw new Error('QR URL tidak valid dari createpayment');

  return {
    invoice_id,
    amount,
    base_amount,
    unique_suffix,
    qris_image_url:  qr_url,
    qris_image_path: null,
    payment_link:    null,
    qris_text:       null,
    expired:         r.data?.result?.expired || null,
    raw:             r.data,
  };
}

// ── checkQRISStatus ───────────────────────────────────────────────────────────
// (setInterval-nya di-comment: aktifkan kembali jika diperlukan)
async function checkQRISStatus() {
  try {
    const entries = Object.entries(global.pendingDeposits || {}).filter(
      ([, d]) => d.status === 'pending'
    );
    if (entries.length === 0) return;

    const timeoutMin  = _getPaymentTimeoutMin();
    const accountId   = _getOrkutAccountId();
    const webMutasi   = accountId
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
      const expiredAt = deposit.expiresAt || (deposit.timestamp + (timeoutMin * 60 * 1000));
      if (Date.now() > expiredAt) {
        try {
          if (deposit.qrMessageId) {
            await _bot.telegram.deleteMessage(deposit.userId, deposit.qrMessageId);
          }
          await _bot.telegram.sendMessage(
            deposit.userId,
            `⏰ <b>QRIS EXPIRED</b>\n` +
              `━━━━━━━━━━━━━━━━\n` +
              `QR sudah tidak berlaku (melewati batas waktu).\n` +
              `Silakan buat QRIS baru dari menu topup.\n` +
              `━━━━━━━━━━━━━━━━\n` +
              `Invoice: <code>${uniqueCode}</code>`,
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

      let resp;
      try {
        const cekRes = await axios.get(
          'https://api.rajaserverpremium.web.id/orderkuota/cekstatus',
          {
            params: {
              apikey:          API_KEY,
              auth_username:   ORDERKUOTA_AUTH_USERNAME,
              auth_token:      ORDERKUOTA_AUTH_TOKEN,
              web_mutasi:      webMutasi,
              amount:          Math.round(Number(deposit.amount || 0)),
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
        if (resp?.message) logger.error(`❌ QRIS cekstatus: ${resp.message}`);
        continue;
      }

      const expected = Math.round(Number(deposit.amount || 0));
      let matchedTransaction = null;

      if (Array.isArray(resp.result)) {
        for (const item of resp.result) {
          const kredit = parseRupiahInt(item.kredit || item.jumlah || item.amount || item.nominal);
          if (kredit === expected) {
            matchedTransaction = {
              amount:       kredit,
              kredit,
              reference_id: String(item.id || item.tanggal || `rs-${kredit}-${Date.now()}`),
              tanggal:      item.tanggal || '',
              raw:          item,
            };
            break;
          }
        }
      }

      if (!matchedTransaction && resp.payment && String(resp.payment.state || '').toLowerCase() === 'paid') {
        matchedTransaction = {
          amount:       expected,
          kredit:       expected,
          reference_id: String(resp.payment.reference || deposit.referenceId || uniqueCode),
          raw:          resp,
        };
      }

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
// if (IS_PM2_PRIMARY) {
//   setInterval(checkQRISStatus, _getTimeoutMs());
//   logger.info(`✅ Auto-topup QRIS aktif. Interval: ${_getTimeoutMs()}ms`);
// } else {
//   logger.info('ℹ️ Auto-topup QRIS nonaktif di instance non-primary (PM2 cluster).');
// }

// ── register(bot, deps) ───────────────────────────────────────────────────────
function register(bot, deps) {
  _bot = bot;

  const { userState, getTimeZone } = deps;

  // ── /cekqris ─────────────────────────────────────────────────────────────
  bot.command('cekqris', async (ctx) => {
    if (!ensurePrivateChat(ctx)) return;

    const userId = ctx.from?.id || 0;

    if (!ADMIN_IDS.includes(userId) && userId !== MASTER_ID) {
      return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
    }

    const parts     = ctx.message.text.trim().split(/\s+/);
    const invoiceId = parts[1];

    if (!invoiceId) {
      return ctx.reply(
        'ℹ️ Penggunaan:\n<code>/cekqris INV123456789</code>',
        { parse_mode: 'HTML' }
      );
    }

    try {
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

      let dbStatus = row.status || 'pending';
      let dbPaidAt = row.paid_at || null;

      let apiStatus = '-';
      let apiPaidAt = null;
      let apiExtra  = '';

      try {
        const apiRes = await checkQrisInvoiceStatus(row.invoice_id, row.amount, row.created_at);
        if (apiRes) {
          apiStatus = (apiRes.status || '-').toUpperCase();
          apiPaidAt = apiRes.paid_at || null;
          if (apiPaidAt) {
            apiExtra =
              '\n📅 Paid API: ' +
              new Date(apiPaidAt).toLocaleString('id-ID', { timeZone: getTimeZone() });
          }
        }
      } catch (e) {
        logger.error('⚠️ Gagal cek status QRIS ke API dari /cekqris:', e);
        apiStatus = 'ERROR';
        apiExtra  = `\n⚠️ ${e.message || String(e)}`;
      }

      if (dbStatus !== 'paid' && apiStatus === 'PAID') {
        const paidTs = apiPaidAt || Date.now();

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
          await new Promise((resolve, reject) => {
            db.run(
              'UPDATE users SET saldo = saldo + ? WHERE user_id = ?',
              [row.amount, row.user_id],
              (err) => (err ? reject(err) : resolve())
            );
          });

          const now = Date.now();
          await new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO transactions (user_id, amount, type, reference_id, timestamp) VALUES (?, ?, ?, ?, ?)',
              [row.user_id, row.amount, 'qris_manual_topup', `qris_manual_${row.invoice_id}`, now],
              (err) => (err ? reject(err) : resolve())
            );
          });

          dbStatus = 'paid';
          dbPaidAt = paidTs;

          try {
            const userRow = await new Promise((resolve, reject) => {
              db.get(
                'SELECT saldo FROM users WHERE user_id = ?',
                [row.user_id],
                (err, r) => (err ? reject(err) : resolve(r))
              );
            });

            const saldoNow = userRow?.saldo || 0;
            const msgUser  =
              '✅ <b>Topup Saldo Berhasil (Manual Sync)</b>\n\n' +
              '💳 Metode : <b>QRIS Otomatis</b>\n' +
              `🧾 Invoice : <code>${row.invoice_id}</code>\n` +
              `💰 Nominal : <b>Rp${row.amount.toLocaleString('id-ID')}</b>\n\n` +
              `💼 Saldo kamu sekarang: <b>${saldoNow.toLocaleString('id-ID')}</b>`;

            await bot.telegram.sendMessage(row.user_id, msgUser, { parse_mode: 'HTML' });

            if (GROUP_ID && NOTIF_TOPUP_GROUP) {
              const chatId = row.user_id;
              let chatInfo;
              try { chatInfo = await bot.telegram.getChat(chatId); } catch (e) { chatInfo = {}; }

              let userLabel;
              if (chatInfo.username)       userLabel = chatInfo.username;
              else if (chatInfo.first_name) userLabel = chatInfo.first_name;
              else                          userLabel = String(chatId);

              const msgGroup =
                '<blockquote>\n' +
                '💰 TOPUP SALDO (QRIS)' +
                '<code>\n' +
                `👤 User   : ${userLabel}\n` +
                `💰 Nominal: Rp${row.amount.toLocaleString('id-ID')}\n` +
                `🧾 Invoice: ${row.invoice_id}\n` +
                '</code>\n' +
                '━━━━━━━━━━━━━━━━━━━━\n' +
                '</blockquote>';

              await bot.telegram.sendMessage(GROUP_ID, msgGroup, { parse_mode: 'HTML' });
            }
          } catch (e) {
            logger.error('❌ Gagal kirim notif ke user/grup setelah /cekqris:', e);
          }
        }
      }

      const TZ           = getTimeZone();
      const createdAtText = new Date(row.created_at).toLocaleString('id-ID', { timeZone: TZ });
      const paidAtDbText  = dbPaidAt
        ? new Date(dbPaidAt).toLocaleString('id-ID', { timeZone: TZ })
        : '-';

      const baseAmount   = row.base_amount   || 0;
      const uniqueSuffix = row.unique_suffix || 0;

      let nominalInfo = '';
      if (baseAmount > 0) {
        if (uniqueSuffix > 0) {
          nominalInfo =
            `💰 Dipilih user : <b>Rp${baseAmount.toLocaleString('id-ID')}</b>\n` +
            `💠 Kode unik    : <b>${uniqueSuffix.toString().padStart(3, '0')}</b>\n` +
            `💳 Dibayar      : <b>Rp${row.amount.toLocaleString('id-ID')}</b>\n`;
        } else {
          nominalInfo =
            `💰 Dipilih user : <b>Rp${baseAmount.toLocaleString('id-ID')}</b>\n` +
            `💳 Dibayar      : <b>Rp${row.amount.toLocaleString('id-ID')}</b>\n`;
        }
      } else {
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
      await ctx.reply('❌ Terjadi kesalahan saat cek invoice QRIS.', { parse_mode: 'HTML' });
    }
  });

  // ── /topupqris & topupqris_btn ────────────────────────────────────────────
  bot.command('topupqris', async (ctx) => {
    await openTopupQrisMenu(ctx, userState);
  });

  bot.action('topupqris_btn', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await openTopupQrisMenu(ctx, userState);
  });

  // ── qris_auto_topup ───────────────────────────────────────────────────────
  bot.action('qris_auto_topup', async (ctx) => {
    try {
      const userId = String(ctx.from.id);

      global.depositState = global.depositState || {};
      global.depositState[userId] = { amount: '' };

      const msg =
        `💰 *Silakan masukkan jumlah nominal saldo yang Anda ingin tambahkan ke akun Anda:*\n\n` +
        `Jumlah saat ini: *Rp 0*`;

      const opts = {
        reply_markup: { inline_keyboard: keyboard_nomor() },
        parse_mode: 'Markdown',
      };

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

  // ── qris_status:* ─────────────────────────────────────────────────────────
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

          const s   = String(row.status || 'pending').toUpperCase();
          const msg =
            `🧾 <b>Status QRIS</b>\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `Invoice : <code>${invoiceId}</code>\n` +
            `Status  : <b>${s}</b>\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `Catatan: Saldo masuk otomatis saat status <b>PAID</b>.`;

          try {
            await ctx.editMessageCaption(msg, {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔎 Refresh Status', callback_data: `qris_status:${invoiceId}` }],
                  [{ text: '🏠 Menu Utama',      callback_data: 'send_main_menu' }],
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

  // ── topup_saldo ───────────────────────────────────────────────────────────
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
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'Markdown',
      });
    } catch (error) {
      logger.error('❌ Kesalahan saat memulai proses top-up saldo:', error);
      await ctx.editMessageText('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
    }
  });
}

module.exports = { register, processDeposit, createQrisInvoice };
