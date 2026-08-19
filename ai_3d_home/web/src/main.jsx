import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// 全局错误边界：任何组件渲染出错只显示错误提示 + 重新加载按钮，不再让整个应用静默卸载成黑屏
// （踩过坑：App.jsx 里 deviceModal.entity_id.split 遇到 null 崩溃 → React 卸载整棵树 → 黑屏）
class ErrorBoundary extends React.Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) { console.error('[ErrorBoundary] 渲染出错:', error) }
  render() {
    if (this.state.error) {
      return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0a0f1e', color: '#fff', fontFamily: 'system-ui', gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>页面出错了</div>
          <div style={{ fontSize: 13, opacity: 0.7, maxWidth: 420, textAlign: 'center', padding: '0 20px' }}>
            {(this.state.error.message || String(this.state.error)).slice(0, 200)}
          </div>
          <button onClick={() => location.reload()} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#3d88ff', color: '#fff', cursor: 'pointer', fontSize: 14 }}>重新加载</button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
