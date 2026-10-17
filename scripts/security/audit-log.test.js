// 第67課題: 監査ログ（supabase/013_data_audit_log.sql）を、ローカルのPostgres(PGlite)で実際のRLSごと確かめる。
// Supabase の auth スキーマ・ロール・auth.uid() だけを最小限まねて、本物のマイグレーションをそのまま流す。
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const sql = (f) => fs.readFileSync(path.resolve(import.meta.dirname, '../../supabase', f), 'utf8')

const OWNER_A = '00000000-0000-0000-0000-00000000000a'
const MEMBER_A = '00000000-0000-0000-0000-0000000000a2'
const OWNER_B = '00000000-0000-0000-0000-00000000000b'

let db
let teamA, productA

// Supabase の PostgREST と同じく、JWT の sub を設定してロールを切り替えて実行する
async function as(user, fn) {
  await db.exec(`select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', false); set role authenticated`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`)
  }
}
const audit = async () => (await db.query('select * from data_audit_log order by id')).rows // 管理者権限で全件を見る

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
  `)
  for (const f of ['schema.sql', '007_role_write_policies.sql', '010_stock_product_team_consistency.sql', '013_data_audit_log.sql']) {
    await db.exec(sql(f))
  }
  await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated`) // Supabase の既定の権限。data_audit_log は 013 で絞った後に付け直す
  await db.exec(`revoke all on data_audit_log from authenticated; grant select on data_audit_log to authenticated`)

  // ユーザー作成 → トリガーで各自の専用チーム(owner)ができる
  await db.exec(`insert into auth.users values ('${OWNER_A}', 'a@example.com'), ('${OWNER_B}', 'b@example.com'), ('${MEMBER_A}', 'm@example.com')`)
  teamA = (await db.query(`select team_id from team_members where user_id = '${OWNER_A}'`)).rows[0].team_id
  await db.exec(`delete from team_members where user_id = '${MEMBER_A}'`) // MEMBER の専用チームの owner 行は消し、A の member にする
  await db.exec(`insert into team_members (team_id, user_id, role) values ('${teamA}', '${MEMBER_A}', 'member')`)

  await as(OWNER_A, async () => {
    productA = (await db.query(`insert into products (barcode, name, category, team_id) values ('111', 'りんご', '果物', '${teamA}') returning id`)).rows[0].id
    await db.query(`insert into stock_items (product_id, quantity, team_id) values ('${productA}', 10, '${teamA}')`)
  })
  await db.exec('truncate data_audit_log') // セットアップ分は数えない
})

describe('監査ログ: 記録される', () => {
  it('メンバーが在庫数を直接書き換えると、誰が・いくつからいくつに変えたかが残る（履歴を残さない迂回も記録される）', async () => {
    await as(MEMBER_A, () => db.query(`update stock_items set quantity = 3 where product_id = '${productA}'`)) // stock_movements には何も書かない
    const rows = (await audit()).filter((r) => r.table_name === 'stock_items')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actor: MEMBER_A, op: 'UPDATE', team_id: teamA, old_data: { quantity: 10 }, new_data: { quantity: 3 } })
  })

  it('商品マスタの変更は「変わった列」だけが残る（updated_at は除く）', async () => {
    await as(OWNER_A, () => db.query(`update products set category = '青果' where id = '${productA}'`))
    const row = (await audit()).filter((r) => r.table_name === 'products').at(-1)
    expect(row).toMatchObject({ actor: OWNER_A, op: 'UPDATE', old_data: { category: '果物' }, new_data: { category: '青果' } })
  })

  it('値が変わらない更新は記録しない（ログが膨らまない）', async () => {
    const before = (await audit()).length
    await as(OWNER_A, () => db.query(`update products set category = '青果' where id = '${productA}'`))
    expect(await audit()).toHaveLength(before)
  })

  it('ロールの変更も残る。SQLエディタなどシステム側の操作は actor が null になる', async () => {
    await db.exec(`update team_members set role = 'owner' where user_id = '${MEMBER_A}'`)
    const row = (await audit()).filter((r) => r.table_name === 'team_members').at(-1)
    expect(row).toMatchObject({ actor: null, op: 'UPDATE', row_id: MEMBER_A, old_data: { role: 'member' }, new_data: { role: 'owner' } })
    await db.exec(`update team_members set role = 'member' where user_id = '${MEMBER_A}'`)
  })
})

describe('監査ログ: 守られている', () => {
  it('owner は自チームのログを読める', async () => {
    const rows = await as(OWNER_A, async () => (await db.query('select * from data_audit_log')).rows)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.team_id === teamA)).toBe(true)
  })

  it('一般メンバーは読めない（0件）', async () => {
    const rows = await as(MEMBER_A, async () => (await db.query('select * from data_audit_log')).rows)
    expect(rows).toHaveLength(0)
  })

  it('別チームの owner には見えない', async () => {
    const rows = await as(OWNER_B, async () => (await db.query('select * from data_audit_log')).rows)
    expect(rows).toHaveLength(0)
  })

  it('アプリのキー（authenticated）からは、書き込み・改ざん・削除ができない（追記専用）', async () => {
    for (const q of [
      `insert into data_audit_log (table_name, op) values ('x', 'INSERT')`,
      `update data_audit_log set actor = null`,
      `delete from data_audit_log`,
    ]) {
      await expect(as(OWNER_A, () => db.query(q))).rejects.toThrow(/permission denied/)
    }
  })
})

describe('created_by の申告を信用しない', () => {
  it('他人の ID を created_by に書いて履歴を insert しても、本人の ID に上書きされる', async () => {
    await as(MEMBER_A, () =>
      db.query(`insert into stock_movements (product_id, change, team_id, created_by) values ('${productA}', -1, '${teamA}', '${OWNER_A}')`),
    )
    const { rows } = await db.query(`select created_by from stock_movements order by created_at desc limit 1`)
    expect(rows[0].created_by).toBe(MEMBER_A)
  })
})
