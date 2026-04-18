/**
 * db/index.js
 * Satu-satunya koneksi ke sellvpn.db.
 * Semua tabel & index dibuat di sini saat pertama kali di-require.
 */

const sqlite3 = require('sqlite3').verbose();
const path    = require('path');
const logger  = require('../config/logger');

const DB_PATH = path.join(__dirname, '..', 'sellvpn.db');

// ── Koneksi ───────────────────────────────────────────────────────────────────
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) logger.error('Kesalahan koneksi SQLite3: ' + err.message);
  else     logger.info('Terhubung ke SQLite3');
});

// ── Tabel: pending_deposits ───────────────────────────────────────────────────
db.run(`CREATE TABLE IF NOT EXISTS pending_deposits (
  unique_code      TEXT PRIMARY KEY,
  user_id          INTEGER,
  amount           INTEGER,
  original_amount  INTEGER,
  timestamp        INTEGER,
  status           TEXT,
  qr_message_id    INTEGER
)`, (err) => {
  if (err) logger.error('Kesalahan membuat tabel pending_deposits: ' + err.message);
});

// ── Tabel: Server ─────────────────────────────────────────────────────────────
db.run(`CREATE TABLE IF NOT EXISTS Server (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  domain              TEXT,
  auth                TEXT,
  harga               INTEGER,
  nama_server         TEXT,
  quota               INTEGER,
  iplimit             INTEGER,
  batas_create_akun   INTEGER,
  total_create_akun   INTEGER,
  is_reseller_only    INTEGER DEFAULT 0
)`, (err) => {
  if (err) logger.error('Kesalahan membuat tabel Server: ' + err.message);
  else     logger.info('Server table created or already exists');
});

// Perbaiki baris Server dengan total_create_akun NULL
db.run("UPDATE Server SET total_create_akun = 0 WHERE total_create_akun IS NULL", function(err) {
  if (err) logger.error('Error fixing NULL total_create_akun: ' + err.message);
  else if (this.changes > 0) logger.info(`✅ Fixed ${this.changes} servers with NULL total_create_akun`);
});

// ── Tabel: users ──────────────────────────────────────────────────────────────
db.run(`CREATE TABLE IF NOT EXISTS users (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  INTEGER UNIQUE,
  saldo    INTEGER DEFAULT 0,
  CONSTRAINT unique_user_id UNIQUE (user_id)
)`, (err) => {
  if (err) logger.error('Kesalahan membuat tabel users: ' + err.message);
  else     logger.info('Users table created or already exists');
});

// Upgrade: tambah kolom flag_status & flag_note kalau belum ada
db.get('SELECT flag_status FROM users LIMIT 1', (err) => {
  if (err && err.message && err.message.includes('no such column')) {
    logger.info('Menambahkan kolom flag_status dan flag_note ke tabel users...');

    db.run("ALTER TABLE users ADD COLUMN flag_status TEXT DEFAULT 'NORMAL'", (err2) => {
      if (err2) logger.error('Kesalahan menambahkan kolom flag_status: ' + err2.message);
      else      logger.info('Kolom flag_status berhasil ditambahkan ke tabel users');
    });

    db.run('ALTER TABLE users ADD COLUMN flag_note TEXT', (err3) => {
      if (err3) logger.error('Kesalahan menambahkan kolom flag_note: ' + err3.message);
      else      logger.info('Kolom flag_note berhasil ditambahkan ke tabel users');
    });
  }
});

// ── Tabel: transactions ───────────────────────────────────────────────────────
db.run(`CREATE TABLE IF NOT EXISTS transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER,
  amount        INTEGER,
  type          TEXT,
  reference_id  TEXT,
  timestamp     INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel transactions: ' + err.message);
    return;
  }
  logger.info('Transactions table created or already exists');

  // Upgrade: tambah kolom reference_id kalau belum ada
  db.get("SELECT * FROM transactions WHERE reference_id IS NULL LIMIT 1", (err2, row) => {
    if (err2 && err2.message.includes('no such column')) {
      db.run("ALTER TABLE transactions ADD COLUMN reference_id TEXT", (err3) => {
        if (err3) logger.error('Kesalahan menambahkan kolom reference_id: ' + err3.message);
        else      logger.info('Kolom reference_id berhasil ditambahkan ke tabel transactions');
      });
    } else if (row) {
      db.all("SELECT id, user_id, type, timestamp FROM transactions WHERE reference_id IS NULL", [], (err4, rows) => {
        if (err4) { logger.error('Kesalahan mengambil transaksi tanpa reference_id: ' + err4.message); return; }
        (rows || []).forEach((r) => {
          const refId = `account-${r.type}-${r.user_id}-${r.timestamp}`;
          db.run("UPDATE transactions SET reference_id = ? WHERE id = ?", [refId, r.id]);
        });
      });
    }
  });
});

// ── Tabel: accounts ───────────────────────────────────────────────────────────
db.run(`CREATE TABLE IF NOT EXISTS accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  username    TEXT,
  type        TEXT,
  server_id   INTEGER,
  created_at  INTEGER,
  expires_at  INTEGER
)`, (err) => {
  if (err) logger.error('Kesalahan membuat tabel accounts: ' + err.message);
  else     logger.info('Accounts table created or already exists');
});

// ── Index ─────────────────────────────────────────────────────────────────────
const INDEXES = [
  { name: 'idx_users_user_id',    sql: 'CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id)' },
  { name: 'idx_tx_user_time',     sql: 'CREATE INDEX IF NOT EXISTS idx_tx_user_time ON transactions(user_id, timestamp)' },
  { name: 'idx_tx_type_time',     sql: 'CREATE INDEX IF NOT EXISTS idx_tx_type_time ON transactions(type, timestamp)' },
  { name: 'idx_accounts_user_time', sql: 'CREATE INDEX IF NOT EXISTS idx_accounts_user_time ON accounts(user_id, expires_at)' },
];

for (const idx of INDEXES) {
  db.run(idx.sql, (err) => {
    if (err) logger.error(`Kesalahan membuat index ${idx.name}: ` + err.message);
    else     logger.info(`Index ${idx.name} siap dipakai`);
  });
}

// ── Query helpers ─────────────────────────────────────────────────────────────

/**
 * Ambil saldo user. Mengembalikan null jika error atau user tidak ditemukan.
 */
async function getUserSaldo(userId) {
  return new Promise((resolve) => {
    db.get('SELECT saldo FROM users WHERE user_id = ?', [userId], (e, r) => {
      if (e) return resolve(null);
      resolve(r ? Number(r.saldo || 0) : null);
    });
  });
}

/**
 * Catat transaksi saldo (topup/debit/dll.) ke tabel transactions.
 */
function recordSaldoTransaction(userId, amount, type, referenceId) {
  db.run(
    `INSERT INTO transactions (user_id, amount, type, reference_id, timestamp)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, amount, type, referenceId || null, Date.now()],
    (err) => {
      if (err) logger.error('Kesalahan mencatat transaksi saldo: ' + err.message);
    }
  );
}

// ── Export ────────────────────────────────────────────────────────────────────
module.exports = { db, getUserSaldo, recordSaldoTransaction };
