module.exports = {
  apps: [
    {
      name: "sellvpn",
      script: "app.js",
      cwd: "/root/BotVPN",

      // pastikan tidak cluster
      exec_mode: "fork",
      instances: 1,

      autorestart: true,
      watch: false,
      max_memory_restart: "512M",

      // log file biar gampang cek
      out_file: "/root/BotVPN/logs/out.log",
      error_file: "/root/BotVPN/logs/err.log",
      merge_logs: true,
      time: true
    }
  ]
};
