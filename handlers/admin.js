/**
 * handlers/admin.js
 * Semua bot.command untuk admin — dipanggil via register(bot, deps) dari app.js.
 *
 * Dependensi statis (diimport langsung):
 *   db, recordSaldoTransaction, logger, cfg, helpers, modules/reseller
 *
 * Dependensi dinamis (mutable state di app.js, diterima via deps):
 *   getLicenseInfo, setLicenseExpireDate, getExpireDate, getTimeZone,
 *   getTopupBonus, getSchedulerState, removeResellerIdFromCache,
 *   getLastBroadcastInfo, getTrialConfig
 */

'use strict';

const fs   = require('fs');
const os   = require('os');

const { db, recordSaldoTransaction } = require('../db');
const logger = require('../config/logger');
const cfg    = require('../config/vars');
const {
  ensurePrivateChat,
  NO_ACCESS_MESSAGE,
  MASTER_ONLY_MESSAGE,
} = require('../helpers');
const { listResellersSync } = require('../modules/reseller');

const {
  MASTER_ID,
  GROUP_ID,
  NOTIF_TOPUP_GROUP,
  BACKUP_CHAT_ID,
  NAMA_STORE,
  ADMIN_IDS,
} = cfg;

// ─────────────────────────────────────────────────────────────────────────────

function register(bot, deps) {
  const {
    getLicenseInfo,
    setLicenseExpireDate,
    getExpireDate,
    getTimeZone,
    getTopupBonus,
    getSchedulerState,
    removeResellerIdFromCache,
    getLastBroadcastInfo,
    getTrialConfig,
  } = deps;

  // ── /testgroup ───────────────────────────────────────────────────────────
  bot.command('testgroup', async (ctx) => {
    if (!ensurePrivateChat(ctx)) return;
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
    }
    try {
      await bot.telegram.sendMessage(GROUP_ID, '✅ Test kirim notif ke grup berhasil!');
      await ctx.reply('✅ Pesan test sudah dikirim ke grup.');
    } catch (e) {
      logger.error('Gagal kirim ke grup:', e.message);
      await ctx.reply('❌ Gagal kirim ke grup, cek ID grup & izin bot.');
    }
  });

  // ── /lisensi ─────────────────────────────────────────────────────────────
  bot.command('lisensi', async (ctx) => {
    if (!ensurePrivateChat(ctx)) return;
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
    }
    if (!getExpireDate()) {
      return ctx.reply('ℹ️ EXPIRE_DATE belum di-set di .vars.json untuk bot ini.');
    }
    const info = getLicenseInfo();
    const now  = new Date();
    const TZ   = getTimeZone();

    const nowText = now.toLocaleString('id-ID', {
      timeZone: TZ, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    const expireText = info.expire.toLocaleDateString('id-ID', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    });

    let statusText;
    if (info.daysLeft > 0) {
      statusText = `✅ Lisensi masih aktif.\nSisa: <b>${info.daysLeft}</b> hari lagi.`;
    } else if (info.daysLeft === 0) {
      statusText = '⚠️ Lisensi akan berakhir <b>hari ini</b>.';
    } else {
      statusText = `❌ Lisensi sudah kadaluarsa <b>${Math.abs(info.daysLeft)}</b> hari yang lalu.`;
    }

    return ctx.reply(
      '<b>🔐 INFO LISENSI BOT</b>\n\n' +
      `Aktif sampai: <b>${expireText}</b>\n` +
      `${statusText}\n\n` +
      `Waktu sekarang: ${nowText}`,
      { parse_mode: 'HTML' }
    );
  });

  // ── /health ──────────────────────────────────────────────────────────────
  bot.command('health', async (ctx) => {
    if (!ensurePrivateChat(ctx)) return;
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
    }

    let dbStatus = '❌ Gagal cek database';
    try {
      const row = await new Promise((resolve, reject) => {
        db.get('SELECT 1 AS ok', [], (err, r) => { if (err) return reject(err); resolve(r); });
      });
      dbStatus = (row && row.ok === 1) ? '✅ Terhubung & bisa query' : '⚠️ Respons aneh dari database';
    } catch (e) {
      dbStatus = `❌ Error DB: ${e.message || e}`;
    }

    const TZ = getTimeZone();
    let licenseStatus = 'ℹ️ EXPIRE_DATE belum di-set di .vars.json';
    if (getExpireDate()) {
      const info = getLicenseInfo();
      const expireText = info.expire.toLocaleDateString('id-ID', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      });
      if (info.daysLeft > 0) {
        licenseStatus = `✅ Aktif, sisa <b>${info.daysLeft}</b> hari (sampai <b>${expireText}</b>)`;
      } else if (info.daysLeft === 0) {
        licenseStatus = `⚠️ Akan berakhir <b>HARI INI</b> (sampai ${expireText})`;
      } else {
        licenseStatus = `❌ Sudah kadaluarsa <b>${Math.abs(info.daysLeft)}</b> hari yang lalu (terakhir <b>${expireText}</b>)`;
      }
    }

    const sched = getSchedulerState();
    const abStatus = sched.autoBackupEnabled ? '🟢 ON' : '🔴 OFF';
    const abDetail = BACKUP_CHAT_ID
      ? `Interval: <b>${sched.autoBackupIntervalHours}</b> jam\n   Tujuan : <code>${BACKUP_CHAT_ID}</code>`
      : '⚠️ BACKUP_CHAT_ID belum di-set.';
    const drStatus = sched.dailyReportEnabled ? '🟢 ON' : '🔴 OFF';
    const drTime   = `${String(sched.dailyReportHour).padStart(2,'0')}:${String(sched.dailyReportMinute).padStart(2,'0')}`;
    const erStatus = sched.expiryReminderEnabled ? '🟢 ON' : '🔴 OFF';
    const erTime   = `${String(sched.expiryReminderHour).padStart(2,'0')}:${String(sched.expiryReminderMinute).padStart(2,'0')}`;
    const erDays   = `H-${sched.expiryReminderDaysBefore}`;

    const upSec  = Math.floor(process.uptime());
    const upHour = Math.floor(upSec / 3600);
    const upMin  = Math.floor((upSec % 3600) / 60);
    const nowText = new Date().toLocaleString('id-ID', {
      timeZone: TZ, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit',
    });

    const msg =
      '<b>🩺 STATUS BOT & SERVER</b>\n\n' +
      `<code>Waktu Sekarang</code>\n• ${nowText}\n• Uptime bot: <b>${upHour} jam ${upMin} menit</b>\n\n` +
      `<code>Lisensi Bot</code>\n• ${licenseStatus}\n\n` +
      `<code>Database</code>\n• ${dbStatus}\n\n` +
      `<code>Auto Backup</code>\n• Status  : ${abStatus}\n• ${abDetail}\n\n` +
      `<code>Laporan Harian</code>\n• Status : ${drStatus}\n• Jam    : <b>${drTime}</b>\n\n` +
      `<code>Pengingat Expired Akun</code>\n• Status : ${erStatus}\n• Jadwal : <b>${erTime}</b>\n• Mode   : <b>${erDays}</b>\n\n` +
      'Kalau ada yang merah/kuning, cek pengaturan di .vars.json atau menu Admin.';

    try {
      await ctx.reply(msg, { parse_mode: 'HTML' });
    } catch (e) {
      logger.error('❌ Gagal kirim pesan /health:', e.message || e);
    }
  });

  // ── /addhari ─────────────────────────────────────────────────────────────
  bot.command('addhari', async (ctx) => {
    if (!ensurePrivateChat(ctx)) return;
    if (!ctx.from || ctx.from.id !== MASTER_ID) {
      return ctx.reply(MASTER_ONLY_MESSAGE, { parse_mode: 'HTML' });
    }
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length !== 2) {
      return ctx.reply(
        '⚠️ <b>Format salah.</b>\nContoh yang benar:\n<code>/addhari 30</code>',
        { parse_mode: 'HTML' }
      );
    }
    const days = parseInt(parts[1], 10);
    if (isNaN(days) || days <= 0) {
      return ctx.reply(
        '⚠️ <b>Jumlah hari tidak valid.</b>\nHarus berupa angka lebih dari 0.\n\nContoh:\n<code>/addhari 7</code>',
        { parse_mode: 'HTML' }
      );
    }

    const TZ = getTimeZone();
    const oldInfo = getLicenseInfo();
    let baseDate = oldInfo ? new Date(oldInfo.expire.getTime()) : new Date();
    baseDate.setDate(baseDate.getDate() + days);
    const newDateStr = baseDate.toISOString().slice(0, 10);
    setLicenseExpireDate(newDateStr);
    const newInfo = getLicenseInfo();

    const fmt = (d) => d.toLocaleDateString('id-ID', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
    const oldText = oldInfo ? fmt(oldInfo.expire) : '-';

    return ctx.reply(
      '<b>✅ Berhasil menambah masa aktif lisensi bot.</b>\n\n' +
      `Sebelumnya : <b>${oldText}</b>\n` +
      `Ditambah   : <b>${days}</b> hari\n` +
      `Tanggal baru: <b>${fmt(newInfo.expire)}</b>\n` +
      `Sisa sekarang: <b>${newInfo.daysLeft}</b> hari`,
      { parse_mode: 'HTML' }
    );
  });

  // ── /kuranghari ──────────────────────────────────────────────────────────
  bot.command('kuranghari', async (ctx) => {
    if (!ensurePrivateChat(ctx)) return;
    if (!ctx.from || ctx.from.id !== MASTER_ID) {
      return ctx.reply(MASTER_ONLY_MESSAGE, { parse_mode: 'HTML' });
    }
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length !== 2) {
      return ctx.reply(
        '⚠️ <b>Format salah.</b>\nContoh yang benar:\n<code>/kuranghari 7</code>',
        { parse_mode: 'HTML' }
      );
    }
    const days = parseInt(parts[1], 10);
    if (isNaN(days) || days <= 0) {
      return ctx.reply(
        '⚠️ <b>Jumlah hari tidak valid.</b>\nHarus berupa angka lebih dari 0.\n\nContoh:\n<code>/kuranghari 7</code>',
        { parse_mode: 'HTML' }
      );
    }

    const TZ = getTimeZone();
    const oldInfo = getLicenseInfo();
    let baseDate = oldInfo ? new Date(oldInfo.expire.getTime()) : new Date();
    baseDate.setDate(baseDate.getDate() - days);
    const newDateStr = baseDate.toISOString().slice(0, 10);
    setLicenseExpireDate(newDateStr);
    const newInfo = getLicenseInfo();

    const fmt = (d) => d.toLocaleDateString('id-ID', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
    const oldText = oldInfo ? fmt(oldInfo.expire) : '-';

    return ctx.reply(
      '<b>✅ Berhasil mengurangi masa aktif lisensi bot.</b>\n\n' +
      `Sebelumnya : <b>${oldText}</b>\n` +
      `Dikurangi  : <b>${days}</b> hari\n` +
      `Tanggal baru: <b>${fmt(newInfo.expire)}</b>\n` +
      `Sisa sekarang: <b>${newInfo.daysLeft}</b> hari`,
      { parse_mode: 'HTML' }
    );
  });

  // ── /addsaldo ────────────────────────────────────────────────────────────
  bot.command('addsaldo', async (ctx) => {
    if (!ensurePrivateChat(ctx)) return;
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
    }
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length !== 3) {
      return ctx.reply(
        '⚠️ <b>Format salah.</b>\n\nGunakan:\n<code>/addsaldo &lt;user_id&gt; &lt;jumlah&gt;</code>\n\nContoh:\n<code>/addsaldo 5439429147 50000</code>',
        { parse_mode: 'HTML' }
      );
    }
    const targetId = Number(parts[1]);
    const amount   = Number(parts[2]);
    if (!targetId || !amount || amount <= 0) {
      return ctx.reply(
        '⚠️ <b>user_id atau jumlah tidak valid.</b>\nContoh yang benar:\n<code>/addsaldo 5439429147 50000</code>',
        { parse_mode: 'HTML' }
      );
    }

    db.get('SELECT saldo FROM users WHERE user_id = ?', [targetId], (err, row) => {
      if (err) {
        logger.error('Error ambil data user:', err.message);
        return ctx.reply('❌ Gagal membaca data user. Coba lagi nanti.');
      }
      if (!row) {
        return ctx.reply(`❌ User dengan ID ${targetId} tidak ditemukan di database.`);
      }

      const oldSaldo = Number(row.saldo || 0);
      const bonus    = getTopupBonus();
      const bonusEnabled = !!bonus.enabled;
      const tier1Min = Number(bonus.tier1Min) || 50000;
      const tier1Pct = Number(bonus.tier1Pct) || 5;
      const tier2Min = Number(bonus.tier2Min) || 100000;
      const tier2Pct = Number(bonus.tier2Pct) || 7;
      const tier3Min = Number(bonus.tier3Min) || 200000;
      const tier3Pct = Number(bonus.tier3Pct) || 10;

      let bonusPercent = 0;
      if (bonusEnabled) {
        if (amount >= tier3Min && tier3Min > 0 && tier3Pct > 0)      bonusPercent = tier3Pct;
        else if (amount >= tier2Min && tier2Min > 0 && tier2Pct > 0) bonusPercent = tier2Pct;
        else if (amount >= tier1Min && tier1Min > 0 && tier1Pct > 0) bonusPercent = tier1Pct;
      }
      const bonusAmt   = bonusPercent > 0 ? Math.floor((amount * bonusPercent) / 100) : 0;
      const totalCredit = amount + bonusAmt;
      const newSaldo    = oldSaldo + totalCredit;

      db.run('UPDATE users SET saldo = ? WHERE user_id = ?', [newSaldo, targetId], async (err2) => {
        if (err2) {
          logger.error('Error update saldo:', err2.message);
          return ctx.reply('❌ Gagal menambahkan saldo. Coba lagi nanti.');
        }

        try {
          recordSaldoTransaction(targetId, totalCredit, 'manual_addsaldo', `addsaldo_by_${ctx.from.id}`);
        } catch (e) {
          logger.error('Gagal mencatat transaksi tambah saldo manual:', e.message);
        }

        let msgAdmin = `✅ Saldo user ID <code>${targetId}</code> berhasil ditambah.\n\n💵 Nominal bayar : <b>Rp${amount.toLocaleString('id-ID')}</b>\n`;
        if (bonusAmt > 0) {
          msgAdmin += `🎁 Bonus         : <b>Rp${bonusAmt.toLocaleString('id-ID')} (${bonusPercent}%)</b>\n💳 Saldo masuk   : <b>Rp${totalCredit.toLocaleString('id-ID')}</b>\n`;
        } else {
          msgAdmin += `💳 Saldo masuk   : <b>Rp${totalCredit.toLocaleString('id-ID')}</b>\n`;
        }
        msgAdmin += `\n💼 Saldo sekarang: <b>Rp${newSaldo.toLocaleString('id-ID')}</b>`;
        await ctx.reply(msgAdmin, { parse_mode: 'HTML' });

        try {
          let msgUser = '💰 Saldo kamu telah <b>ditambahkan</b>.\n\n' + `💵 Topup : <b>Rp ${amount.toLocaleString('id-ID')}</b>\n`;
          if (bonusAmt > 0) {
            msgUser += `🎁 Bonus : <b>Rp ${bonusAmt.toLocaleString('id-ID')} (${bonusPercent}%)</b>\n💳 Masuk : <b>Rp ${totalCredit.toLocaleString('id-ID')}</b>\n`;
          } else {
            msgUser += `💳 Masuk : <b>Rp ${totalCredit.toLocaleString('id-ID')}</b>\n`;
          }
          msgUser += `\n💼 Saldo sekarang: <b>Rp ${newSaldo.toLocaleString('id-ID')}</b>`;
          await bot.telegram.sendMessage(targetId, msgUser, { parse_mode: 'HTML' });
        } catch (e) {
          logger.error('Gagal kirim notif ke user:', e.message);
        }

        if (NOTIF_TOPUP_GROUP && GROUP_ID) {
          try {
            let targetInfo;
            try { targetInfo = await bot.telegram.getChat(targetId); } catch (e) { targetInfo = {}; }
            const userLabel = targetInfo.username || targetInfo.first_name || String(targetId);
            const waktu = new Date().toLocaleString('id-ID', {
              timeZone: getTimeZone(), year: 'numeric', month: '2-digit',
              day: '2-digit', hour: '2-digit', minute: '2-digit',
            });
            let notifTopup =
              '<blockquote>\n━━━ TOPUP MANUAL ━━━\n<code>\n' +
              `👤 User   : ${userLabel}\n🆔 ID     : ${targetId}\n💵 Bayar  : Rp ${amount.toLocaleString('id-ID')}\n`;
            if (bonusAmt > 0) {
              notifTopup += `🎁 Bonus  : Rp ${bonusAmt.toLocaleString('id-ID')} (${bonusPercent}%)\n💳 Masuk  : Rp ${totalCredit.toLocaleString('id-ID')}\n`;
            } else {
              notifTopup += `💳 Masuk  : Rp ${totalCredit.toLocaleString('id-ID')}\n`;
            }
            notifTopup += `💼 Saldo  : Rp ${newSaldo.toLocaleString('id-ID')}\n📅 Tanggal: ${waktu}\n</code>\n━━━━━━━━━━━━━━━━━━━━\n</blockquote>`;
            await bot.telegram.sendMessage(GROUP_ID, notifTopup, { parse_mode: 'HTML' });
          } catch (e) {
            logger.error('Gagal kirim notif topup manual ke grup:', e.message);
          }
        }
      });
    });
  });

  // ── /minsaldo ────────────────────────────────────────────────────────────
  bot.command('minsaldo', async (ctx) => {
    if (!ensurePrivateChat(ctx)) return;
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
    }
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length !== 3) {
      return ctx.reply(
        '⚠️ <b>Format salah.</b>\n\nGunakan:\n<code>/minsaldo &lt;user_id&gt; &lt;jumlah&gt;</code>\n\nContoh:\n<code>/minsaldo 5439429147 10000</code>',
        { parse_mode: 'HTML' }
      );
    }
    const targetId = Number(parts[1]);
    const amount   = Number(parts[2]);
    if (!targetId || !amount || amount <= 0) {
      return ctx.reply(
        '⚠️ <b>user_id atau jumlah tidak valid.</b>\nContoh yang benar:\n<code>/minsaldo 5439429147 10000</code>',
        { parse_mode: 'HTML' }
      );
    }

    db.get('SELECT saldo FROM users WHERE user_id = ?', [targetId], (err, row) => {
      if (err) {
        logger.error('Error ambil data user:', err.message);
        return ctx.reply('❌ Gagal membaca data user. Coba lagi nanti.');
      }
      if (!row) {
        return ctx.reply(`⚠️ User dengan ID ${targetId} tidak ditemukan di database.`);
      }
      const oldSaldo = Number(row.saldo || 0);
      if (oldSaldo < amount) {
        return ctx.reply(
          `⚠️ Saldo user tidak cukup.\nSaldo sekarang: Rp${oldSaldo.toLocaleString()}\nJumlah pengurangan: Rp${amount.toLocaleString()}`
        );
      }
      const newSaldo = oldSaldo - amount;
      db.run('UPDATE users SET saldo = ? WHERE user_id = ?', [newSaldo, targetId], async (err2) => {
        if (err2) {
          logger.error('Error update saldo:', err2.message);
          return ctx.reply('❌ Gagal mengurangi saldo. Coba lagi nanti.');
        }
        recordSaldoTransaction(targetId, amount, 'manual_minsaldo', `minsaldo_by_${ctx.from.id}`);
        await ctx.reply(
          `✅ Saldo user ID <code>${targetId}</code> berhasil dikurangi Rp${amount.toLocaleString()}.\n💰 Saldo sekarang: <b>Rp${newSaldo.toLocaleString()}</b>`,
          { parse_mode: 'HTML' }
        );

        try {
          await bot.telegram.sendMessage(
            targetId,
            '💸 Saldo kamu telah <b>dikurangi</b> sebesar <b>Rp ' + amount.toLocaleString() + '</b>.\n💳 Saldo sekarang: <b>Rp ' + newSaldo.toLocaleString() + '</b>.',
            { parse_mode: 'HTML' }
          );
        } catch (e) {
          logger.error('Gagal kirim notif ke user saat pengurangan saldo:', e.message);
        }

        if (NOTIF_TOPUP_GROUP) {
          try {
            let targetInfo;
            try { targetInfo = await bot.telegram.getChat(targetId); } catch (e) { targetInfo = {}; }
            const userLabel = targetInfo.username || targetInfo.first_name || String(targetId);
            const waktu = new Date().toLocaleString('id-ID', {
              timeZone: getTimeZone(), year: 'numeric', month: '2-digit',
              day: '2-digit', hour: '2-digit', minute: '2-digit',
            });
            const notifPotong =
              '<blockquote>\n━━ PENGURANGAN SALDO ━━\n<code>\n' +
              `👤 User   : ${userLabel}\n💸 Jumlah : Rp ${amount.toLocaleString()}\n📅 Tanggal: ${waktu}\n` +
              '</code>\n━━━━━━━━━━━━━━━━━━━━\n</blockquote>';
            await bot.telegram.sendMessage(GROUP_ID, notifPotong, { parse_mode: 'HTML' });
          } catch (e) {
            logger.error('Gagal kirim notif pengurangan saldo ke grup:', e.message);
          }
        }
      });
    });
  });

  // ── /deluser ─────────────────────────────────────────────────────────────
  bot.command('deluser', async (ctx) => {
    if (!ensurePrivateChat(ctx)) return;
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
    }
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length !== 2) {
      return ctx.reply(
        '⚠️ <b>Format salah.</b>\n\nGunakan:\n<code>/deluser &lt;user_id&gt;</code>\n\nContoh:\n<code>/deluser 5439429147</code>',
        { parse_mode: 'HTML' }
      );
    }
    const targetId = Number(parts[1]);
    if (!targetId) {
      return ctx.reply(
        '⚠️ <b>user_id tidak valid.</b>\nContoh yang benar:\n<code>/deluser 5439429147</code>',
        { parse_mode: 'HTML' }
      );
    }

    db.get('SELECT * FROM users WHERE user_id = ?', [targetId], (err, row) => {
      if (err) {
        logger.error('❌ Kesalahan saat memeriksa user_id di /deluser:', err.message);
        return ctx.reply('❌ Terjadi kesalahan saat memeriksa user.');
      }
      if (!row) {
        return ctx.reply(`ℹ️ User dengan ID ${targetId} tidak ditemukan di database.`);
      }
      db.run('DELETE FROM users WHERE user_id = ?', [targetId], (err2) => {
        if (err2) {
          logger.error('❌ Gagal menghapus user di /deluser:', err2.message);
          return ctx.reply('❌ Gagal menghapus user dari database.');
        }
        logger.info(`✅ User ${targetId} dihapus dari tabel users oleh admin ${ctx.from.id}`);
        try {
          const removed = removeResellerIdFromCache(targetId);
          if (removed) logger.info(`✅ User ${targetId} juga dihapus dari daftar reseller`);
        } catch (e) {
          logger.error('⚠️ Gagal mengupdate resellerCache di /deluser:', e.message || e);
        }
        ctx.reply(`✅ User dengan ID <code>${targetId}</code> berhasil dihapus dari database.`, { parse_mode: 'HTML' });
      });
    });
  });

  // ── /listuser ────────────────────────────────────────────────────────────
  bot.command('listuser', async (ctx) => {
    if (!ensurePrivateChat(ctx)) return;
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
    }
    db.get('SELECT COUNT(*) AS total FROM users', [], (err, row) => {
      if (err) {
        logger.error('Gagal menghitung total user:', err.message);
        return ctx.reply('❌ Terjadi kesalahan saat mengambil data user.');
      }
      const totalUser = row ? row.total : 0;
      db.all('SELECT user_id, saldo FROM users ORDER BY id DESC LIMIT 10', [], (err2, rows) => {
        if (err2) {
          logger.error('Gagal mengambil daftar user:', err2.message);
          return ctx.reply('❌ Terjadi kesalahan saat mengambil daftar user.');
        }
        let totalReseller = 0;
        try {
          const resList = listResellersSync();
          if (Array.isArray(resList)) totalReseller = resList.length;
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
      });
    });
  });

  // ── /setflag ─────────────────────────────────────────────────────────────
  bot.command('setflag', async (ctx) => {
    if (!ensurePrivateChat(ctx)) return;
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
    }
    const args = ctx.message.text.trim().split(/\s+/);
    if (args.length < 3) {
      return ctx.reply(
        '⚠️ Format salah.\nGunakan:\n`/setflag <user_id> <NORMAL|WATCHLIST|NAKAL> [catatan...]`',
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
        '⚠️ Status tidak dikenal.\nGunakan salah satu: `NORMAL`, `WATCHLIST`, atau `NAKAL`.',
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
          return ctx.reply(`⚠️ User dengan ID ${targetId} tidak ditemukan di tabel users.`, { parse_mode: 'Markdown' });
        }
        let label = '✅ NORMAL';
        if (rawStatus === 'WATCHLIST') label = '⚠️ WATCHLIST';
        else if (rawStatus === 'NAKAL') label = '🚫 NAKAL';
        const noteText = note ? `\n📝 Catatan: ${note}` : '';
        ctx.reply(`✅ Status user \`${targetId}\` berhasil diubah menjadi: ${label}${noteText}`, { parse_mode: 'Markdown' });
      }
    );
  });

  // ── /lastbroadcast ───────────────────────────────────────────────────────
  bot.command('lastbroadcast', async (ctx) => {
    if (!ensurePrivateChat(ctx)) return;
    if (!ctx.from) return;
    const userId = ctx.from.id;
    if (!ADMIN_IDS.includes(userId) && userId !== MASTER_ID) {
      return ctx.reply(MASTER_ONLY_MESSAGE, { parse_mode: 'HTML' });
    }
    const info = getLastBroadcastInfo();
    if (!info) {
      return ctx.reply('ℹ️ Belum ada data broadcast yang tersimpan (atau bot baru saja direstart).');
    }
    let targetLabel = info.target;
    if (info.target === 'all')      targetLabel = 'semua user';
    else if (info.target === 'reseller') targetLabel = 'semua reseller';
    else if (info.target === 'member')   targetLabel = 'member (bukan reseller & bukan admin)';

    await ctx.reply(
      `📊 <b>Broadcast Terakhir</b>\n\n` +
      `Waktu   : <b>${info.time}</b>\nTarget  : <b>${targetLabel}</b>\n` +
      `Total   : <b>${info.totalTarget}</b> user\nBerhasil: <b>${info.sukses}</b>\nGagal   : <b>${info.gagal}</b>\n\n` +
      `<b>Preview Pesan:</b>\n` + info.messagePreview,
      { parse_mode: 'HTML' }
    );
  });

  // ── /hapuslog ────────────────────────────────────────────────────────────
  bot.command('hapuslog', async (ctx) => {
    if (!ensurePrivateChat(ctx)) return;
    if (!ADMIN_IDS.includes(ctx.from.id)) return ctx.reply('Tidak ada izin!');
    try {
      if (fs.existsSync('bot-combined.log')) fs.unlinkSync('bot-combined.log');
      if (fs.existsSync('bot-error.log'))    fs.unlinkSync('bot-error.log');
      ctx.reply('Log berhasil dihapus.');
      logger.info('Log file dihapus oleh admin.');
    } catch (e) {
      ctx.reply('Gagal menghapus log: ' + e.message);
      logger.error('Gagal menghapus log: ' + e.message);
    }
  });

  // ── /botstatus & /statusbot ──────────────────────────────────────────────
  bot.command(['botstatus', 'statusbot'], async (ctx) => {
    if (!ensurePrivateChat(ctx)) return;
    const adminId = ctx.from?.id;
    if (!adminId || !ADMIN_IDS.includes(adminId)) {
      return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
    }

    let licenseText = '';
    if (getExpireDate()) {
      const info = getLicenseInfo();
      if (info) {
        if (info.daysLeft > 0) {
          licenseText = `📅 Sampai: <b>${info.expire.toLocaleDateString('id-ID')}</b>\n⏳ Sisa  : <b>${info.daysLeft}</b> hari`;
        } else if (info.daysLeft === 0) {
          licenseText = `📅 Sampai: <b>${info.expire.toLocaleDateString('id-ID')}</b>\n⏳ Status: <b>HARI INI</b>`;
        } else {
          licenseText = `📅 Habis : <b>${info.expire.toLocaleDateString('id-ID')}</b>\n⏳ Lewat : <b>${Math.abs(info.daysLeft)}</b> hari`;
        }
      } else {
        licenseText = '⚠️ Tidak dapat membaca informasi lisensi.';
      }
    } else {
      licenseText = '♾️ Lisensi: <b>lifetime / belum diatur</b>';
    }

    const sched = getSchedulerState();
    const abStatus   = sched.autoBackupEnabled ? '🟢 ON' : '🔴 OFF';
    const abInterval = sched.autoBackupIntervalHours && sched.autoBackupIntervalHours > 0
      ? `${sched.autoBackupIntervalHours} jam` : 'tidak di-set';
    const abChat = BACKUP_CHAT_ID ? `<code>${BACKUP_CHAT_ID}</code>` : '<i>belum di-set</i>';

    const erStatus = sched.expiryReminderEnabled ? '🟢 ON' : '🔴 OFF';
    const erTime   = `${String(sched.expiryReminderHour).padStart(2,'0')}:${String(sched.expiryReminderMinute).padStart(2,'0')}`;
    const erDays   = sched.expiryReminderDaysBefore;

    let trialInfoText = '';
    try {
      const trialCfg = await getTrialConfig();
      const tStatus = trialCfg.enabled ? '🟢 ON' : '🔴 OFF';
      trialInfoText =
        `Status   : ${tStatus}\nMax/hari : <b>${trialCfg.maxPerDay}</b> x\n` +
        `Durasi   : <b>${trialCfg.durationHours}</b> jam\nMin saldo: <b>${trialCfg.minBalanceForTrial}</b>`;
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
• Jam      : <b>${erTime}</b> (zona ${getTimeZone()})
<code>╰──────────────────────────────╯</code>

<code>╭──── PENGATURAN TRIAL ────────╮</code>
${trialInfoText}
<code>╰──────────────────────────────╯</code>
`.trim();

    return ctx.reply(text, { parse_mode: 'HTML' });
  });

  // ── /helpadmin ───────────────────────────────────────────────────────────
  bot.command('helpadmin', async (ctx) => {
    if (!ensurePrivateChat(ctx)) return;
    const userId = ctx.message.from.id;
    if (!ADMIN_IDS.includes(userId)) {
      return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
    }
    return ctx.reply(
      '📋 DAFTAR PERINTAH ADMIN TAPEKETAN VPN\n\n' +
      'Gunakan perintah berikut hanya jika Anda memahami fungsinya.\n' +
      'Beberapa perintah tertentu sebaiknya hanya dipakai OWNER / MASTER.\n\n' +
      '1) PANEL & BANTUAN\n' +
      '- /admin        → Buka Menu Admin (panel tombol)\n' +
      '- /helpadmin    → Menampilkan daftar perintah admin ini\n' +
      '- /botstatus atau /statusbot -> Cek status bot & server\n\n' +
      '2) MANAJEMEN USER & RESELLER\n' +
      '- /listuser     → Menampilkan daftar user yang terdaftar di database\n' +
      '- /addressel    → Menambahkan reseller baru\n' +
      '- /delressel    → Menghapus ID reseller\n' +
      '- /deluser      → Menghapus user dari database (hati-hati)\n\n' +
      '3) SALDO & TRANSAKSI\n' +
      '- /addsaldo     → Menambahkan saldo ke akun user\n' +
      '- /minsaldo     → Mengurangi saldo akun user\n' +
      '- /cekqris <invoice_id> -> Cek status QRIS manual\n\n' +
      '4) SERVER & PAKET\n' +
      '- /addserver          → Menambahkan server baru\n' +
      '- /addserver_reseller → Mengatur server default untuk reseller\n' +
      '- /editharga          → Mengedit harga paket pada server\n' +
      '- /editauth           → Mengedit akun/auth panel\n' +
      '- /editdomain         → Mengedit domain server\n' +
      '- /editlimitcreate    → Mengedit batas pembuatan akun per server\n' +
      '- /editlimitip        → Mengedit batas jumlah IP per akun\n' +
      '- /editlimitquota     → Mengedit batas kuota paket\n' +
      '- /editnama           → Mengedit nama server\n' +
      '- /edittotalcreate    → Mengedit total limit pembuatan akun server\n\n' +
      '5) BROADCAST & PENGUMUMAN\n' +
      '- /broadcast      → Broadcast ke semua user\n' +
      '- /broadcastres   → Broadcast ke semua reseller\n' +
      '- /broadcastmem   → Broadcast ke semua member biasa\n' +
      '- /lastbroadcast  → Menampilkan ringkasan broadcast terakhir\n\n' +
      '6) LOG & MAINTENANCE\n' +
      '- /hapuslog       → Menghapus file log bot\n' +
      '- /testgroup      → Menguji kirim pesan ke GROUP_ID\n\n' +
      '7) LISENSI BOT\n' +
      '- /lisensi        → Melihat masa aktif lisensi bot\n' +
      '- /addhari        → Menambah masa aktif lisensi bot\n' +
      '- /kuranghari     → Mengurangi masa aktif lisensi bot\n\n' +
      '8) LAPORAN, BACKUP & REMINDER\n' +
      '- /health               → Cek kesehatan bot\n' +
      '- /daily_report_test    → Mengirim laporan harian (test)\n' +
      '- /backup_auto_test     → Menguji fungsi auto-backup\n' +
      '- /expired_reminder_test → Preview pengingat akun expired\n\n' +
      '9) TROUBLESHOOTING / MODERASI\n' +
      '- /setflag <user_id> <NORMAL|WATCHLIST|NAKAL> [catatan...]\n\n' +
      'Catatan:\n' +
      '- Hak akses admin diatur melalui MASTER_ID dan ADMIN_IDS di file .vars.json\n' +
      '- Jangan gunakan perintah penghapusan/ubah server/lisensi jika belum paham akibatnya.'
    );
  });
}

module.exports = { register };
