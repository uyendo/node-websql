'use strict';
var sqlite3 = require('@journeyapps/sqlcipher');
var SQLiteResult = require('./SQLiteResult');

var READ_ONLY_ERROR = new Error(
  'could not prepare statement (23 not authorized)');
function SQLiteDatabase(name) {
  this._db = new sqlite3.Database(name, (err) => {
    if (err) {
      return console.error(err.message);
    }
    console.log('Connected SQlite database.');
    var key = undefined;
    if (typeof window !== "undefined" && (window).sqlitePragmaKey) {
      key = (window).sqlitePragmaKey;
    } else if (typeof process !== "undefined" && process.sqlitePragmaKey) {
      key = process.sqlitePragmaKey;
    }
    if (key) {
      this._db.run("PRAGMA cipher_compatibility = 3");
      this._db.run(`PRAGMA KEY = '${key}'`);
    }
    this._db.run(`PRAGMA journal_mode = WAL`, (err) => {
      if (err && err.message && err.message.indexOf('cannot change into wal mode from within a transaction') > -1) {
        this._db.run(`COMMIT`, (error) => {
          if(!error) {
            this._db.run(`PRAGMA journal_mode = WAL`);
          }
        });
      } else if (err && err.message && err.message.indexOf('file is not a database') > -1) {
      } else {
        throw err;
      }
    });
  });
}

function runSelect(db, sql, args, cb) {
  db.all(sql, args, function (err, rows) {
    if (err) {
      return cb(new SQLiteResult(err));
    }
    var insertId = void 0;
    var rowsAffected = 0;
    var resultSet = new SQLiteResult(null, insertId, rowsAffected, rows);
    cb(resultSet);
  });
}

function runNonSelect(db, sql, args, cb) {
  db.run(sql, args, function (err) {
    if (err) {
      return cb(new SQLiteResult(err));
    }
    /* jshint validthis:true */
    var executionResult = this;
    var insertId = executionResult.lastID;
    var rowsAffected = executionResult.changes;
    var rows = [];
    var resultSet = new SQLiteResult(null, insertId, rowsAffected, rows);
    cb(resultSet);
  });
}

SQLiteDatabase.prototype.exec = function exec(queries, readOnly, callback) {

  var db = this._db;
  var len = queries.length;
  var results = new Array(len);

  var i = 0;

  function checkDone() {
    if (++i === len) {
      callback(null, results);
    } else {
      doNext();
    }
  }

  function onQueryComplete(i) {
    return function (res) {
      results[i] = res;
      checkDone();
    };
  }

  function doNext() {
    var query = queries[i];
    var sql = query.sql;
    var args = query.args;

    // TODO: It seems like the node-sqlite3 API either allows:
    // 1) all(), which returns results but not rowsAffected or lastID
    // 2) run(), which doesn't return results, but returns rowsAffected and lastID
    // So we try to sniff whether it's a SELECT query or not.
    // This is inherently error-prone, although it will probably work in the 99%
    // case.
    var isSelect = /^\s*SELECT\b/i.test(sql);

    if (readOnly && !isSelect) {
      onQueryComplete(i)(new SQLiteResult(READ_ONLY_ERROR));
    } else if (isSelect) {
      runSelect(db, sql, args, onQueryComplete(i));
    } else {
      runNonSelect(db, sql, args, onQueryComplete(i));
    }
  }

  doNext();
};

module.exports = SQLiteDatabase;
