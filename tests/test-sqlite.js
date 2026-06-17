const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.prepare('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)').run();
db.prepare('INSERT INTO test (name) VALUES (?)').run('it works');
const row = db.prepare('SELECT * FROM test').get();
console.log(row);
db.close();
