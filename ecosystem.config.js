module.exports = {
    apps : [{
      name: "easiBlock-bot",
      script: "./app.js",
      watch: true,
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },
      error_file: "logs/pm2_error.log",
      out_file: "logs/pm2_output.log",
      log_file: "logs/pm2_combined.log",
      time: true
    }]
  }