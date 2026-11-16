import { NodeSqliteDatabase } from '../backend/repositories/node-sqlite';
const db = new NodeSqliteDatabase('.local/compasso.sqlite');
for (const table of ['demo_sessions','accounts','categories','entries','plans','plan_occurrences','processed_commands']) {
  const result = await db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first<{total:number}>();
  console.log(`${table}: ${result?.total ?? 0} registro(s)`);
}
db.close();
