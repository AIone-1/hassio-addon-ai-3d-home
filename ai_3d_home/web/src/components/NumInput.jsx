import { useState, useEffect } from 'react'

// 数字输入框：本地缓冲，可自由输入/删除，失焦或回车才提交；无原生上下微调箭头（CSS 已隐藏）
export default function NumInput({ value, onChange, step = 0.1, min, max, style, title, disabled }) {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(String(value)) }, [value])

  const commit = () => {
    const v = parseFloat(text)
    if (!isNaN(v)) onChange(v)
    else setText(String(value))  // 非法输入，回退
  }

  return (
    <input
      type="number" step={step} min={min} max={max} title={title}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { commit(); e.target.blur() } }}
      style={style}
      disabled={disabled}
    />
  )
}
