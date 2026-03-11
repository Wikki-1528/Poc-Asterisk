module.exports = {
  apps: [{
    name: 'callmetrik-bridge',
    script: 'dist/server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
