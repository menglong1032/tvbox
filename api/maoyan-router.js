const maoyan = require('./maoyan');
const trailers = require('./trailers');

module.exports = async function handler(req, res) {
  if (String(req.query.action || '') === 'videos') {
    return trailers(req, res);
  }
  return maoyan(req, res);
};
