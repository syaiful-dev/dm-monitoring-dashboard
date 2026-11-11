// Trend Provider Factory
// Returns the right DB provider for a given connection based on its `client`
// dialect ('mssql' | 'mysql'). Both providers expose the SAME interface
// (runQueryOn / testConnection / loadFromConnection), so callers can stay
// engine-agnostic and just do getProvider(conn).loadFromConnection(conn, query).

const mssqlProvider = require('./trendMssqlProvider');
const mysqlProvider = require('./trendMysqlProvider');

function getProvider(conn) {
  const client = String((conn && conn.client) || 'mssql').toLowerCase();
  switch (client) {
    case 'mysql':
    case 'mariadb':
      return mysqlProvider;
    case 'mssql':
    case 'sqlserver':
      return mssqlProvider;
    default:
      throw new Error(`Unsupported DB client "${client}" for connection "${conn && conn.name}". Use 'mssql' or 'mysql'.`);
  }
}

module.exports = { getProvider };
