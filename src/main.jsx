import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { installGlobalErrorHandlers } from './lib/errorLogger'

installGlobalErrorHandlers()

// StrictModeはカメラ(getUserMedia)の二重初期化と相性が悪いため使用しない
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
