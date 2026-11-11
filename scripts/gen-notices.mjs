// 本番に入る依存(devでないもの)の著作権表示・ライセンス全文を、1つのテキストにまとめる。
// 使い方: npm run notices   → public/THIRD-PARTY-NOTICES.txt を作り直す(ビルドでそのまま dist に入る)
// 依存を足したり上げたりしたら、もう一度実行してコミットする。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))

const packages = Object.entries(lock.packages)
  .filter(([path, info]) => path && !info.dev) // 開発用(dev)は納品物に入らないので除く
  .map(([path, info]) => ({ path, name: path.replace(/^.*node_modules\//, ''), info }))
  .sort((a, b) => a.name.localeCompare(b.name))

const findLicenseFile = (dir) => {
  if (!existsSync(dir)) return null
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f))
  return file ? join(dir, file) : null
}

const missing = []
const sections = packages.map(({ path, name, info }) => {
  const dir = join(root, path)
  const file = findLicenseFile(dir)
  const license = info.license ?? JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).license ?? '不明'
  if (!file) missing.push(name)
  const text = file ? readFileSync(file, 'utf8').trim() : '(LICENSE ファイルが見つかりません。パッケージの配布元を確認してください)'
  return `----------------------------------------\n${name} ${info.version}\nライセンス: ${license}\n----------------------------------------\n\n${text}\n`
})

const header = `このソフトウェアには、次のオープンソースの部品が含まれています。
各部品の著作権表示とライセンス全文を以下に示します。
(npm run notices で package-lock.json から自動生成。本番に入る ${packages.length} 個)

`
writeFileSync(join(root, 'public', 'THIRD-PARTY-NOTICES.txt'), header + sections.join('\n') + '\n')

console.log(`${packages.length} 個を public/THIRD-PARTY-NOTICES.txt に出力しました`)
if (missing.length) {
  console.error(`LICENSE ファイルが無い: ${missing.join(', ')}`)
  process.exitCode = 1
}
