import type { Database, SqlValue } from 'sql.js';
import type { StoreDatabase } from '../store';

/** Statements are short-lived: sql.js export invalidates prepared statements. */
export function browserSqlite(db: Database): StoreDatabase {
  return {
    exec(sql) { db.run(sql); },
    prepare(sql) {
      const read = (params: unknown[], first: boolean): unknown[] => {
        const statement = db.prepare(sql, params as SqlValue[]);
        try {
          const rows: unknown[] = [];
          while (statement.step()) {
            rows.push(statement.getAsObject());
            if (first) break;
          }
          return rows;
        } finally { statement.free(); }
      };
      return {
        run(...params) { db.run(sql, params as SqlValue[]); return { changes: db.getRowsModified() }; },
        get(...params) { return read(params, true)[0]; },
        all(...params) { return read(params, false); },
      };
    },
    transaction(operation) {
      return (...args) => {
        db.run('BEGIN');
        try {
          const result = operation(...args);
          db.run('COMMIT');
          return result;
        } catch (error) { db.run('ROLLBACK'); throw error; }
      };
    },
  };
}
