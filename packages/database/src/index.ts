import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, sql } from 'kysely';
import path from 'node:path';
import { ensureSecureDirectory } from '@agentdeck/security';
import { DatabaseSchema } from './schema.js';
import { initialMigration, v104Migration, Migration } from './migrations.js';

export * from './schema.js';
export * from './migrations.js';

export interface DatabaseOptions {
  dbPath: string;
  inMemory?: boolean;
}

export class AgentDeckDatabase {
  private rawDb: Database.Database;
  public db: Kysely<DatabaseSchema>;

  constructor(options: DatabaseOptions) {
    if (options.inMemory) {
      this.rawDb = new Database(':memory:');
    } else {
      this.rawDb = new Database(options.dbPath);
    }

    // Configure SQLite for high concurrency, safety, and performance
    this.rawDb.pragma('journal_mode = WAL');
    this.rawDb.pragma('foreign_keys = ON');
    this.rawDb.pragma('busy_timeout = 5000');
    this.rawDb.pragma('synchronous = NORMAL');

    this.db = new Kysely<DatabaseSchema>({
      dialect: new SqliteDialect({
        database: this.rawDb,
      }),
    });
  }

  /**
   * Initializes and runs pending versioned migrations.
   */
  public async migrate(): Promise<void> {
    // Ensure migrations meta table exists
    await this.db.schema
      .createTable('schema_migrations')
      .ifNotExists()
      .addColumn('version', 'integer', (col) => col.primaryKey())
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('applied_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    const appliedRows = await this.db
      .selectFrom('schema_migrations' as unknown as keyof DatabaseSchema)
      .select(['version' as unknown as keyof DatabaseSchema[keyof DatabaseSchema]])
      .execute();

    const appliedVersions = new Set(appliedRows.map((r) => (r as unknown as { version: number }).version));

    const migrations: Migration[] = [initialMigration, v104Migration];

    for (const migration of migrations) {
      if (!appliedVersions.has(migration.version)) {
        await migration.up(this.db as unknown as Kysely<unknown>);
        await this.db
          .insertInto('schema_migrations' as unknown as keyof DatabaseSchema)
          .values({
            version: migration.version,
            name: migration.name,
          } as unknown as never)
          .execute();
      }
    }
  }

  /**
   * Executes a raw query or PRAGMA on the underlying database.
   */
  public async raw<T = unknown>(query: string): Promise<T[]> {
    return this.rawDb.prepare(query).all() as T[];
  }

  public close(): void {
    this.rawDb.close();
  }

  /**
   * Runs diagnostic SQLite integrity check.
   */
  public async integrityCheck(): Promise<{ ok: boolean; message: string }> {
    try {
      const result = this.rawDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
      const isOk = result.length > 0 && result[0]?.integrity_check === 'ok';
      return { ok: isOk, message: isOk ? 'Database integrity OK' : JSON.stringify(result) };
    } catch (err: unknown) {
      return { ok: false, message: (err as Error).message };
    }
  }
}

/**
 * Creates and initializes the default database connection under ~/.agentdeck/data/agentdeck.db
 */
export async function createDatabase(customPath?: string): Promise<AgentDeckDatabase> {
  const finalPath = customPath || path.join(process.env['HOME'] || '/tmp', '.agentdeck', 'data', 'agentdeck.db');
  if (!customPath) {
    await ensureSecureDirectory(path.dirname(finalPath));
  }
  const db = new AgentDeckDatabase({ dbPath: finalPath });
  await db.migrate();
  return db;
}
