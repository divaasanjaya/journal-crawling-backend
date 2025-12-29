const { MongoClient } = require('mongodb');

let _client = null;
let _db = null;

async function connect(mongoUri) {
  const uri = mongoUri || process.env.MONGO_URI || 'mongodb://crawler:journal-crawler123@localhost:27017/journal_crawling?authSource=admin';
  console.log(`DB: attempting connection to ${uri}`);
  _client = new MongoClient(uri);
  try {
    await _client.connect();
  } catch (err) {
    console.warn('DB: initial connect failed:', err && err.message ? err.message : err);
    // If auth failed and URI included credentials, try fallback to no-auth local URI
    try {
      const hasCredentials = /:\/\/[^@]+@/.test(uri);
      if (hasCredentials) {
        // strip credentials: scheme://user:pass@host... -> scheme://host...
        const stripped = uri.replace(/(^.*:\/\/)[^@]+@/, '$1');
        console.log(`DB: retrying without credentials to ${stripped}`);
        _client = new MongoClient(stripped);
        await _client.connect();
      } else {
        throw err;
      }
    } catch (err2) {
      // rethrow original error for visibility
      console.error('DB: fallback connect also failed:', err2 && err2.message ? err2.message : err2);
      throw err;
    }
  }
  try {
    const dbName = (new URL(uri)).pathname.replace(/^\//, '') || 'journal_crawling';
    _db = _client.db(dbName);
    console.log(`DB: connected, using database ${dbName}`);
  } catch (e) {
    _db = _client.db('journal_crawling');
    console.log('DB: connected, using fallback database journal_crawling');
  }
  return _db;
}

function getDb() {
  if (!_db) throw new Error('Database not connected. Call connect() first.');
  return _db;
}

async function close() {
  if (_client) await _client.close();
  _client = null; _db = null;
}

module.exports = { connect, getDb, close };
