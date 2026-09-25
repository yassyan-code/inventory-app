import { Component } from 'react'
import { logError } from '../lib/errorLogger'

// 描画中の例外で画面全体が真っ白になるのを防ぎ、エラーを記録する。
export default class ErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    logError(error, 'react')
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div role="alert" style={{ padding: '2rem', textAlign: 'center' }}>
        <h1>問題が発生しました</h1>
        <p>エラーは自動で記録されました。再読み込みしても直らない場合は管理者にお知らせください。</p>
        <button type="button" onClick={() => window.location.reload()}>
          再読み込み
        </button>
      </div>
    )
  }
}
