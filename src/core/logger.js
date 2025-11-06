const dayjs = require('dayjs');

function formatLog(level, message, meta = {}) {
  const timestamp = dayjs().format('YYYY-MM-DD HH:mm:ss.SSS');
  const metaStr = Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : '';
  return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
}

const logger = {
  info: (message, meta = {}) => {
    console.log(formatLog('info', message, meta));
  },
  
  error: (message, meta = {}) => {
    console.error(formatLog('error', message, meta));
  },
  
  warn: (message, meta = {}) => {
    console.warn(formatLog('warn', message, meta));
  },
  
  debug: (message, meta = {}) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(formatLog('debug', message, meta));
    }
  }
};

module.exports = logger;

