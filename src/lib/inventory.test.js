import { describe, it, expect, vi, beforeEach } from 'vitest'

// Supabase の偽物。呼ばれたメソッドを log に記録し、テーブルごとに用意した結果を順に返す。
const state = vi.hoisted(() => ({ log: [], results: {}, auth: {} }))

vi.mock('./supabaseClient', () => ({
  supabase: {
    auth: { getUser: async () => state.auth },
    from(table) {
      const entry = { table, calls: [] }
      state.log.push(entry)
      const result = (state.results[table] ?? []).shift() ?? { data: null, error: null }
      const builder = new Proxy(
        {},
        {
          get(_, method) {
            if (method === 'then') return (res, rej) => Promise.resolve(result).then(res, rej)
            return (...args) => {
              entry.calls.push([method, ...args])
              return builder
            }
          },
        }
      )
      return builder
    },
  },
}))

import {
  getCurrentTeamId,
  getMyMembership,
  findByBarcode,
  createProduct,
  adjustQuantity,
  listStock,
  archiveProduct,
  unarchiveProduct,
  updateCategory,
  listCategories,
} from './inventory'

const ok = (data) => ({ data, error: null })
const fail = (message) => ({ data: null, error: new Error(message) })
const loggedIn = { data: { user: { id: 'u1', email: 'a@example.com' } }, error: null }

beforeEach(() => {
  state.log = []
  state.results = {}
  state.auth = loggedIn
})

describe('getCurrentTeamId', () => {
  it('所属チームのIDを返す', async () => {
    state.results.team_members = [ok({ team_id: 't1' })]
    expect(await getCurrentTeamId()).toBe('t1')
    expect(state.log[0].table).toBe('team_members')
    expect(state.log[0].calls).toEqual([
      ['select', 'team_id'],
      ['eq', 'user_id', 'u1'],
      ['limit', 1],
      ['maybeSingle'],
    ])
  })

  it('未ログインならエラー', async () => {
    state.auth = { data: { user: null }, error: null }
    await expect(getCurrentTeamId()).rejects.toThrow('未ログインです')
  })

  it('ユーザー取得のエラーはそのまま投げる', async () => {
    state.auth = { data: { user: null }, error: new Error('auth boom') }
    await expect(getCurrentTeamId()).rejects.toThrow('auth boom')
  })

  it('所属が無ければエラー', async () => {
    state.results.team_members = [ok(null)]
    await expect(getCurrentTeamId()).rejects.toThrow('所属チームが見つかりません')
  })

  it('DBのエラーはそのまま投げる', async () => {
    state.results.team_members = [fail('db boom')]
    await expect(getCurrentTeamId()).rejects.toThrow('db boom')
  })
})

describe('getMyMembership', () => {
  it('owner は管理者として返す', async () => {
    state.results.team_members = [ok({ team_id: 't1', role: 'owner', teams: { name: '店A' } })]
    expect(await getMyMembership()).toEqual({
      teamId: 't1',
      teamName: '店A',
      role: 'owner',
      isAdmin: true,
      email: 'a@example.com',
    })
    expect(state.log[0].calls[0]).toEqual(['select', 'team_id, role, teams(name)'])
  })

  it('owner 以外は member、チーム名が無ければ「マイチーム」', async () => {
    state.results.team_members = [ok({ team_id: 't1', role: 'staff', teams: null })]
    const m = await getMyMembership()
    expect(m.role).toBe('member')
    expect(m.isAdmin).toBe(false)
    expect(m.teamName).toBe('マイチーム')
  })

  it('未ログイン・所属なしはエラー', async () => {
    state.auth = { data: { user: null }, error: null }
    await expect(getMyMembership()).rejects.toThrow('未ログインです')
    state.auth = loggedIn
    state.results.team_members = [ok(null)]
    await expect(getMyMembership()).rejects.toThrow('所属チームが見つかりません')
  })

  it('DBのエラーはそのまま投げる', async () => {
    state.results.team_members = [fail('db boom')]
    await expect(getMyMembership()).rejects.toThrow('db boom')
  })
})

describe('findByBarcode', () => {
  const row = { id: 'p1', barcode: '123', name: '水', category: '飲料' }

  it('在庫が単一オブジェクトでも配列でも数量を取り出す', async () => {
    state.results.products = [
      ok({ ...row, stock_items: { quantity: 4 } }),
      ok({ ...row, stock_items: [{ quantity: 7 }] }),
    ]
    expect(await findByBarcode('123')).toEqual({ ...row, quantity: 4 })
    expect(await findByBarcode('123')).toEqual({ ...row, quantity: 7 })
  })

  it('在庫が無ければ数量0', async () => {
    state.results.products = [ok({ ...row, stock_items: [] }), ok({ ...row, stock_items: null })]
    expect((await findByBarcode('123')).quantity).toBe(0)
    expect((await findByBarcode('123')).quantity).toBe(0)
  })

  it('商品が無ければ null、エラーは投げる', async () => {
    state.results.products = [ok(null), fail('db boom')]
    expect(await findByBarcode('999')).toBeNull()
    await expect(findByBarcode('999')).rejects.toThrow('db boom')
  })

  it('バーコードで絞り込む', async () => {
    state.results.products = [ok(null)]
    await findByBarcode('123')
    expect(state.log[0].calls).toEqual([
      ['select', 'id, barcode, name, category, stock_items(quantity)'],
      ['eq', 'barcode', '123'],
      ['maybeSingle'],
    ])
  })
})

describe('createProduct', () => {
  it('商品・在庫・入出庫履歴を、この順に登録する', async () => {
    state.results.team_members = [ok({ team_id: 't1' })]
    state.results.products = [ok({ id: 'p1', name: '水' })]
    const product = await createProduct('123', '水', 5, '飲料')
    expect(product).toEqual({ id: 'p1', name: '水' })
    expect(state.log.map((l) => l.table)).toEqual([
      'team_members',
      'products',
      'stock_items',
      'stock_movements',
    ])
    expect(state.log[1].calls[0]).toEqual([
      'insert',
      { barcode: '123', name: '水', category: '飲料', team_id: 't1' },
    ])
    expect(state.log[2].calls[0]).toEqual([
      'insert',
      { product_id: 'p1', quantity: 5, team_id: 't1' },
    ])
    expect(state.log[3].calls[0]).toEqual([
      'insert',
      { product_id: 'p1', change: 5, note: '初期登録', team_id: 't1' },
    ])
  })

  it('初期数量0なら履歴は残さない。カテゴリ未指定は null', async () => {
    state.results.team_members = [ok({ team_id: 't1' })]
    state.results.products = [ok({ id: 'p1' })]
    await createProduct('123', '水')
    expect(state.log.map((l) => l.table)).toEqual(['team_members', 'products', 'stock_items'])
    expect(state.log[1].calls[0][1].category).toBeNull()
  })

  it('在庫の登録に失敗したらエラー', async () => {
    state.results.team_members = [ok({ team_id: 't1' })]
    state.results.products = [ok({ id: 'p1' })]
    state.results.stock_items = [fail('stock boom')]
    await expect(createProduct('123', '水', 1)).rejects.toThrow('stock boom')
  })
})

describe('adjustQuantity', () => {
  it('在庫を更新し、履歴を残し、新しい数量を返す', async () => {
    state.results.stock_items = [ok({ quantity: 3 }), ok(null)]
    state.results.team_members = [ok({ team_id: 't1' })]
    expect(await adjustQuantity('p1', -2, '出庫')).toBe(1)
    expect(state.log.map((l) => l.table)).toEqual([
      'stock_items',
      'stock_items',
      'team_members',
      'stock_movements',
    ])
    expect(state.log[1].calls).toEqual([
      ['update', { quantity: 1 }],
      ['eq', 'product_id', 'p1'],
    ])
    expect(state.log[3].calls[0]).toEqual([
      'insert',
      { product_id: 'p1', change: -2, note: '出庫', team_id: 't1' },
    ])
  })

  it('取得に失敗したら更新しない', async () => {
    state.results.stock_items = [fail('fetch boom')]
    await expect(adjustQuantity('p1', 1)).rejects.toThrow('fetch boom')
    expect(state.log).toHaveLength(1)
  })

  it('更新に失敗したら履歴を残さない', async () => {
    state.results.stock_items = [ok({ quantity: 3 }), fail('update boom')]
    await expect(adjustQuantity('p1', 1)).rejects.toThrow('update boom')
    expect(state.log.map((l) => l.table)).toEqual(['stock_items', 'stock_items'])
  })
})

describe('listStock', () => {
  const calls = () => state.log[0].calls

  it('既定: 非表示を除き、名前順', async () => {
    state.results.products = [ok([])]
    await listStock()
    expect(calls()).toEqual([
      ['select', 'id, barcode, name, category, created_at, archived_at, stock_items(quantity)'],
      ['is', 'archived_at', null],
      ['order', 'name'],
    ])
  })

  it('並び順: 新しい順・古い順', async () => {
    state.results.products = [ok([]), ok([])]
    await listStock('', 'newest')
    expect(calls()[2]).toEqual(['order', 'created_at', { ascending: false }])
    state.log = []
    await listStock('', 'oldest')
    expect(calls()[2]).toEqual(['order', 'created_at', { ascending: true }])
  })

  it('非表示も含める指定なら、絞り込まない', async () => {
    state.results.products = [ok([])]
    await listStock('', 'name', '', true)
    expect(calls().some(([m]) => m === 'is')).toBe(false)
  })

  it('検索語の % _ , はエスケープし、カテゴリで絞り込む', async () => {
    state.results.products = [ok([])]
    await listStock('a%b_c,d', 'name', '飲料')
    expect(calls().slice(3)).toEqual([
      [
        'or',
        'name.ilike.%a\\%b\\_c\\,d%,barcode.ilike.%a\\%b\\_c\\,d%,category.ilike.%a\\%b\\_c\\,d%',
      ],
      ['eq', 'category', '飲料'],
    ])
  })

  it('画面用の形に整える', async () => {
    state.results.products = [
      ok([
        {
          id: 'p1',
          barcode: '123',
          name: '水',
          category: null,
          created_at: '2026-10-01T00:00:00Z',
          archived_at: null,
          stock_items: { quantity: 2 },
        },
      ]),
    ]
    expect(await listStock()).toEqual([
      {
        id: 'p1',
        barcode: '123',
        name: '水',
        category: null,
        createdAt: '2026-10-01T00:00:00Z',
        archivedAt: null,
        quantity: 2,
      },
    ])
  })

  it('データが null なら空配列、エラーは投げる', async () => {
    state.results.products = [ok(null), fail('db boom')]
    expect(await listStock()).toEqual([])
    await expect(listStock()).rejects.toThrow('db boom')
  })
})

describe('商品の更新', () => {
  it('archiveProduct は archived_at に現在時刻を入れる', async () => {
    state.results.products = [ok(null)]
    await archiveProduct('p1')
    const [method, values] = state.log[0].calls[0]
    expect(method).toBe('update')
    expect(Number.isNaN(Date.parse(values.archived_at))).toBe(false)
    expect(state.log[0].calls[1]).toEqual(['eq', 'id', 'p1'])
  })

  it('unarchiveProduct は archived_at を null に戻す', async () => {
    state.results.products = [ok(null)]
    await unarchiveProduct('p1')
    expect(state.log[0].calls).toEqual([
      ['update', { archived_at: null }],
      ['eq', 'id', 'p1'],
    ])
  })

  it('updateCategory は空文字を null で保存する', async () => {
    state.results.products = [ok(null), ok(null)]
    await updateCategory('p1', '飲料')
    await updateCategory('p1', '')
    expect(state.log[0].calls[0]).toEqual(['update', { category: '飲料' }])
    expect(state.log[1].calls[0]).toEqual(['update', { category: null }])
  })

  it('3つとも、DBのエラーはそのまま投げる', async () => {
    state.results.products = [fail('e1'), fail('e2'), fail('e3')]
    await expect(archiveProduct('p1')).rejects.toThrow('e1')
    await expect(unarchiveProduct('p1')).rejects.toThrow('e2')
    await expect(updateCategory('p1', 'x')).rejects.toThrow('e3')
  })
})

describe('listCategories', () => {
  it('重複と空を除き、日本語順に並べる', async () => {
    state.results.products = [
      ok([{ category: 'ぱん' }, { category: 'あめ' }, { category: 'ぱん' }, { category: '' }]),
    ]
    expect(await listCategories()).toEqual(['あめ', 'ぱん'])
    expect(state.log[0].calls).toEqual([
      ['select', 'category'],
      ['not', 'category', 'is', null],
    ])
  })

  it('エラーは投げる', async () => {
    state.results.products = [fail('db boom')]
    await expect(listCategories()).rejects.toThrow('db boom')
  })
})
