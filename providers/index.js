// Provider Factory — returns the active data provider based on config
const config = require('../config/dataSource');
const JsonProvider = require('./jsonProvider');
const RedshiftProvider = require('./redshiftProvider');

function getProvider() {
  switch (config.provider) {
    case 'redshift':
      return new RedshiftProvider(config.redshift);
    case 'json':
    default:
      return new JsonProvider();
  }
}

module.exports = getProvider();
