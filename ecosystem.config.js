module.exports = {
  apps: [{
    name:      'dzimmo',
    script:    'server/index.js',
    instances: 'max',
    exec_mode: 'cluster',
    env_production: {
      NODE_ENV: 'production',
      PORT:     3001,
    },
    max_memory_restart: '512M',
    error_file:  'logs/err.log',
    out_file:    'logs/out.log',
    merge_logs:  true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
