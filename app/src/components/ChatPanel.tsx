import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../types'

interface Props {
  messages: ChatMessage[]
  onSend: (text: string) => void
  busy: boolean
  llmActive?: boolean
}

const SUGGESTIONS = [
  'Why did you include Sol Ring?',
  'How do I win?',
  'Make this more competitive',
  'Replace all cards over $20',
]

export function ChatPanel({ messages, onSend, busy, llmActive }: Props) {
  const [input, setInput] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const submit = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    onSend(trimmed)
    setInput('')
  }

  return (
    <div className="chat-panel">
      <h3>
        Deck Help
        {llmActive && <span className="badge">LLM</span>}
      </h3>
      <div className="chat-body" ref={bodyRef}>
        {messages.length === 0 && (
          <div className="chat-suggestions">
            <p>Ask about this deck...</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => submit(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.text}
          </div>
        ))}
        {busy && <div className="chat-msg assistant typing">...</div>}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault()
          submit(input)
        }}
      >
        <input
          value={input}
          placeholder="Ask about this deck..."
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          ↑
        </button>
      </form>
    </div>
  )
}
