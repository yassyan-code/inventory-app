# 第48課題 提出：待たせない設計（非同期と重い処理）

## 1. 重い所を見つける

`api/chat.js`（AIチャット機能）が該当した。`client.messages.create()`でClaudeの応答生成が**完了するまで待ってから**、一括でJSONを返していた。生成には数秒〜十数秒かかることがあり、その間ブラウザは`fetch`の`await`で完全にブロックされ、フロント側は「考え中...」を表示するだけで何も進まない状態だった。

## 2. 裏に回す（SSEストリーミング化）

`client.messages.create()` → `client.messages.stream()` に変更し、レスポンスを`text/event-stream`（SSE）にした。生成できたトークンから順に`data: {"delta": "..."}\n\n`として画面へ流し、フロント（`ChatPanel.jsx`）は受信の都度アシスタントの吹き出しを伸ばしていく。

```js
// api/chat.js（要点抜粋）
res.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
})
const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`)

const stream = client.messages.stream({ model: 'claude-opus-5', /* ... */ messages })
stream.on('text', (delta) => send({ delta }))
await stream.finalMessage()
send({ usage: { count: quota.count, limit: quota.limit } })
```

認証・レート制限・利用枠チェックは**ストリーミング開始前**に今まで通りJSONで即レスするようにし、そこを通過した後（＝実際にClaudeを呼ぶ「重い」区間）だけをSSE化した。これにより、エラー系のレスポンス形式（400/401/429のJSON）は変えずに済んだ。

**実測（本番のAnthropic APIに対して直接計測）**

| 項目 | 値 |
|---|---|
| 最初のトークンが届くまで | 1,219ms |
| 完了まで | 2,703ms |
| 受信チャンク数 | 28 |

従来の一括レスポンスなら「考え中...」が2,703ms間ずっと表示されたはずが、今回は**完了の45%の時点（約1.2秒）**で最初の文字が届き、そこから文章が伸びていく。ユーザーが「固まった」と感じる時間が最大で半分以下になる。

## 3. 流量を守る（レート制限）

`enforceRateLimit`（1ユーザーあたり60秒に10回まで、DB固定ウィンドウ方式）は第21回で`/api/chat`にすでに導入済みで、ストリーミング化後もこの制限は変更していない（認証・利用枠チェックと同じく、ストリーミング開始前のブロックにそのまま残している）。今回はここを新設する必要が無かったので、既存の仕組みが正しく機能し続けていることの確認にとどめた。

## 4. 設計判断の一言

このアプリはVercelのサーバーレス関数で動いており、独立したキュー（Redis等）を新設するのは今の規模には過剰と判断した。AIチャットのような「結果を今すぐ画面に見せたい」種類の重い処理には、キューよりも**ストリーミング**の方が体感速度への効果が直接的（バックグラウンドジョブ化すると「完了通知を待つ」別のUIが要る）。一方で「メール送信」のような結果を画面に即座に見せる必要のない処理であれば、キュー／バックグラウンド実行の方が適切——処理の性質によって「待たせない」の実装方法を使い分けるべき、という判断をした。
