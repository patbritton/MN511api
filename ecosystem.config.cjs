module.exports = {
  apps: [
    {
      name: "mn511-api",
      script: "src/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      time: true,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
