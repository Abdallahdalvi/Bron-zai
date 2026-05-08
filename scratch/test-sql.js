const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function test() {
  try {
    const SQL = await initSqlJs();
    console.log('SQL initialized');
    const db = new SQL.Database();
    console.log('Database created');
    db.run('CREATE TABLE test (id INTEGER)');
    console.log('Table created');
    console.log('Success!');
  } catch (err) {
    console.error('Error:', err);
  }
}

test();
