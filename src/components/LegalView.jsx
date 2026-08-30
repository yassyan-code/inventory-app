import { LEGAL_DOCS } from '../lib/legalContent'

// ?legal=terms|privacy|tokushoho で表示する法務ページ。ログイン前でも見られる。
export default function LegalView({ slug, onBack }) {
  const doc = LEGAL_DOCS[slug]
  if (!doc) {
    return (
      <div className="legal-view">
        <button className="link" onClick={onBack}>← 戻る</button>
        <p>ページが見つかりません。</p>
      </div>
    )
  }
  return (
    <div className="legal-view">
      <button className="link" onClick={onBack}>← 戻る</button>
      <h1>{doc.title}</h1>
      <pre className="legal-body">{doc.body}</pre>
    </div>
  )
}
