# BotVPN 1FORCR

## Overview
A Telegram bot for automated VPN service management. Users can purchase VPN accounts (SSH, VMess, VLESS, Trojan, Shadowsocks), top up their balance via QRIS payments, and try trial accounts. Admins can manage users, balances, servers, and resellers.

## Architecture
- **Runtime**: Node.js
- **Bot Framework**: Telegraf (Telegram bot API)
- **HTTP Server**: Express on port 5000
- **Database**: SQLite3 (`sellvpn.db`, `ressel.db`, `trial.db`)
- **Payment**: Order Kuota / QRIS via `autoft-orkut`
- **External VPN API**: AutoScript Potato API

## Project Structure
- `app.js` — Main entry point (14,000+ lines): bot setup, all commands, schedulers, HTTP server
- `modules/` — VPN account operations (create, renew, delete, lock/unlock, trial, change-ip, reseller)
- `services/` — Payment integration (orderkuotaQris.js)
- `.vars.json` — Configuration file (BOT_TOKEN, admin IDs, payment credentials, etc.)
- `trial_config.json` — Trial access configuration
- `sellvpn.db` — Main SQLite database (users, servers, transactions, accounts)

## Configuration
All configuration is in `.vars.json`. Required fields:
- `BOT_TOKEN` — Telegram bot token from @BotFather
- `MASTER_ID` / `USER_ID` — Owner's Telegram user ID
- `ADMIN_IDS` — Comma-separated admin Telegram IDs

Optional payment/QRIS fields:
- `ORDERKUOTA_BASE_QR`, `ORDERKUOTA_AUTH_USERNAME`, `ORDERKUOTA_AUTH_TOKEN`

## Running
The workflow runs `node app.js` — the Express server starts on port 5000.
If `BOT_TOKEN` is not set, the HTTP server still runs but the Telegram bot will not start.

## Dependencies
- npm packages: telegraf, express, sqlite3, axios, winston, autoft-orkut, dotenv, qs, crypto
- System packages: libuuid, cairo, pango, libjpeg, giflib, librsvg, pkg-config (for canvas support)
