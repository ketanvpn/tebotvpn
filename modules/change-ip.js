const axios = require('axios');
const { exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sellvpn.db');

async function changelimipsshvpn(username, password, exp, iplimit, serverId) {
  console.log(`Change limit IP SSH account for ${username} with new IP limit ${iplimit}`);

  // Validasi username
  if (!/^[a-z0-9-]+$/.test(username)) {
    return '❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.';
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], (err, server) => {
      if (err || !server) {
        console.error('❌ Error fetching server:', err?.message || 'server null');
        return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');
      }

      const domain = server.domain;
      const param = `/vps/changelimipsshvpn`;
      const web_URL = `http://${domain}${param}`; // Contoh: http://domainmu.com/vps/changelimipsshvpn
      const AUTH_TOKEN = server.auth;

      const curlCommand = `curl -s -X POST "${web_URL}" \
-H "Authorization: ${AUTH_TOKEN}" \
-H "accept: application/json" \
-H "Content-Type: application/json" \
-d '{"limitip": ${iplimit},"username": "${username}"}'`;

      exec(curlCommand, (_, stdout) => {
        let d;
        try {
          d = JSON.parse(stdout);
        } catch (e) {
          console.error('❌ Gagal parsing JSON:', e.message);
          console.error('🪵 Output:', stdout);
          return resolve('❌ Format respon dari server tidak valid.');
        }

        if (d?.meta?.code !== 200 || !d.data) {
          console.error('❌ Respons error:', d);
          const errMsg = d?.message || d?.meta?.message || JSON.stringify(d, null, 2);
          return resolve(`❌ Respons error:\n${errMsg}`);
        }

        const s = d.data;
        console.log("⚠️ FULL DATA:", JSON.stringify(d, null, 2));
        const msg = `✅ *Change Limit IP SSH Account Success!*

🔄 *Batas IP berhasil diubah*
────────────────────────────
👤 *Username*     : \`${s.username}\`
📶 *Limit IP*    : \`${s.message}\`
────────────────────────────

✨ Terima kasih telah menggunakan layanan kami!
*© Telegram Bots - 2025*`;

        return resolve(msg);
      });
    });
  });
}
async function changelimipvmess(username, exp, quota, iplimit, serverId) {
  console.log(`Change limit IP VMess account for ${username} with new IP limit ${iplimit}`);

  // Validasi username
  if (!/^[a-z0-9-]+$/.test(username)) {
    return '❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.';
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], (err, server) => {
      if (err || !server) {
        console.error('❌ Error fetching server:', err?.message || 'server null');
        return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');
      }

      const domain = server.domain;
      const param = `/vps/changelimipvmess`;
      const web_URL = `http://${domain}${param}`; // contoh: http://domain.com/vps/changelimipvmess
      const AUTH_TOKEN = server.auth;

      const curlCommand = `curl -s -X POST "${web_URL}" \
-H "Authorization: ${AUTH_TOKEN}" \
-H "accept: application/json" \
-H "Content-Type: application/json" \
-d '{"limitip": ${iplimit},"username": "${username}"}'`;

      exec(curlCommand, (_, stdout) => {
        let d;
        try {
          d = JSON.parse(stdout);
        } catch (e) {
          console.error('❌ Gagal parsing JSON:', e.message);
          console.error('🪵 Output:', stdout);
          return resolve('❌ Format respon dari server tidak valid.');
        }

        if (d?.meta?.code !== 200 || !d.data) {
          console.error('❌ Respons error:', d);
          const errMsg = d?.message || d?.meta?.message || JSON.stringify(d, null, 2);
          return resolve(`❌ Respons error:\n${errMsg}`);
        }

        const s = d.data;
        console.log("⚠️ FULL DATA:", JSON.stringify(d, null, 2));
        const msg = `✅ *Change Limit IP VMess Account Success!*

🔄 *Batas IP berhasil diubah*
────────────────────────────
👤 *Username*    : \`${s.username}\`
📶 *Limit IP*    : \`${s.message}\`
────────────────────────────

✨ Terima kasih telah menggunakan layanan kami!
*© Telegram Bots - 2025*`;

        return resolve(msg);
      });
    });
  });
}
async function changelimipvless(username, exp, quota, iplimit, serverId) {
  console.log(`Change limit IP VLESS account for ${username} with new IP limit ${iplimit}`);

  // Validasi username
  if (!/^[a-z0-9-]+$/.test(username)) {
    return '❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.';
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], (err, server) => {
      if (err || !server) {
        console.error('❌ Error fetching server:', err?.message || 'server null');
        return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');
      }

      const domain = server.domain;
      const param = `/vps/changelimipvless`;
      const web_URL = `http://${domain}${param}`;       // contoh: http://domain.com/vps/changelimipvless
      const AUTH_TOKEN = server.auth;

      const curlCommand = `curl -s -X POST "${web_URL}" \
-H "Authorization: ${AUTH_TOKEN}" \
-H "accept: application/json" \
-H "Content-Type: application/json" \
-d '{"limitip": ${iplimit},"username": "${username}"}'`;

      exec(curlCommand, (_, stdout) => {
        let d;
        try {
          d = JSON.parse(stdout);
        } catch (e) {
          console.error('❌ Gagal parsing JSON:', e.message);
          console.error('🪵 Output:', stdout);
          return resolve('❌ Format respon dari server tidak valid.');
        }

        if (d?.meta?.code !== 200 || !d.data) {
          console.error('❌ Respons error:', d);
          const errMsg = d?.message || d?.meta?.message || JSON.stringify(d, null, 2);
          return resolve(`❌ Respons error:\n${errMsg}`);
        }

        const s = d.data;
        console.log("⚠️ FULL DATA:", JSON.stringify(d, null, 2));
        const msg = `✅ *Change Limit IP VLESS Account Success!*

🔄 *Batas IP berhasil diubah*
────────────────────────────
👤 *Username*    : \`${s.username}\`
📶 *Limit IP*    : \`${s.message}\`
────────────────────────────

✨ Terima kasih telah menggunakan layanan kami!
*© Telegram Bots - 2025*`;

        return resolve(msg);
      });
    });
  });
}
async function changelimiptrojan(username, exp, quota, iplimit, serverId) {
  console.log(`Change limit IP TROJAN account for ${username} with new IP limit ${iplimit}`);

  // Validasi username
  if (!/^[a-z0-9-]+$/.test(username)) {
    return '❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.';
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], (err, server) => {
      if (err || !server) {
        console.error('❌ Error fetching server:', err?.message || 'server null');
        return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');
      }

      const domain = server.domain;
      const param = `/vps/changelimiptrojan`;
      const web_URL = `http://${domain}${param}`;       // contoh: http://domain.com/vps/changelimiptrojan
      const AUTH_TOKEN = server.auth;

      const curlCommand = `curl -s -X POST "${web_URL}" \
-H "Authorization: ${AUTH_TOKEN}" \
-H "accept: application/json" \
-H "Content-Type: application/json" \
-d '{"limitip": ${iplimit},"username": "${username}"}'`;

      exec(curlCommand, (_, stdout) => {
        let d;
        try {
          d = JSON.parse(stdout);
        } catch (e) {
          console.error('❌ Gagal parsing JSON:', e.message);
          console.error('🪵 Output:', stdout);
          return resolve('❌ Format respon dari server tidak valid.');
        }

        if (d?.meta?.code !== 200 || !d.data) {
          console.error('❌ Respons error:', d);
          const errMsg = d?.message || d?.meta?.message || JSON.stringify(d, null, 2);
          return resolve(`❌ Respons error:\n${errMsg}`);
        }

        const s = d.data;
        console.log("⚠️ FULL DATA:", JSON.stringify(d, null, 2));
        const msg = `✅ *Change Limit IP TROJAN Account Success!*

🔄 *Batas IP berhasil diubah*
────────────────────────────
👤 *Username*    : \`${s.username}\`
📶 *Limit IP*    : \`${s.message}\`
────────────────────────────

✨ Terima kasih telah menggunakan layanan kami!
*© Telegram Bots - 2025*`;

        return resolve(msg);
      });
    });
  });
}

module.exports = { changelimiptrojan, changelimipvless, changelimipvmess, changelimipsshvpn };
