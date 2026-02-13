import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { Search, ExternalLink, Bot, User, Database, SlidersHorizontal } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Adjust base URL if needed, assume proxy handles local dev
const API_BASE = '';

interface SearchResult {
  id: string;
  title: string;
  url: string;
  content: string;
  source: string;
  vector: number[];
  _distance?: number;
}

interface ChatSource {
  title: string;
  url: string;
  source: string;
  excerpt: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
}

type StreamEvent =
  | { event: 'token'; data: { chunk?: string } }
  | { event: 'done'; data: { answer?: string; sources?: ChatSource[] } }
  | { event: 'error'; data: { message?: string } };

function parseSseBlock(block: string): StreamEvent | null {
  const lines = block.split('\n');
  let eventName = '';
  let dataLine = '';

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLine += line.slice(5).trim();
    }
  }

  if (!eventName || !dataLine) return null;
  try {
    const data = JSON.parse(dataLine);
    if (eventName === 'token' || eventName === 'done' || eventName === 'error') {
      return { event: eventName, data } as StreamEvent;
    }
  } catch {
    return null;
  }
  return null;
}

function toExcerpt(text: string, maxLen = 260) {
  const cleaned = text
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen).trim()}...`;
}

function SourceCard({
  source,
  title,
  url,
  excerpt,
}: {
  source: string;
  title: string;
  url: string;
  excerpt: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors p-3"
    >
      <div className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
        {source}
      </div>
      <div className="text-sm font-semibold text-gray-900 mt-1">{title}</div>
      <div className="text-sm text-gray-600 mt-1 line-clamp-4">{excerpt}</div>
      <div className="mt-2 text-xs text-blue-700 font-medium inline-flex items-center gap-1">
        Open bron <ExternalLink className="h-3 w-3" />
      </div>
    </a>
  );
}

function App() {
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [waitingForFirstToken, setWaitingForFirstToken] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const [availableSources, setAvailableSources] = useState<string[]>([])
  const [showFilters, setShowFilters] = useState(false)
  const [activeSearchQuery, setActiveSearchQuery] = useState('')

  const allSources = availableSources.length > 0
    ? availableSources
    : Array.from(new Set(results.map(r => r.source)));

  useEffect(() => {
    const fetchSources = async () => {
      try {
        const response = await axios.get(`${API_BASE}/sources`)
        const sources = Array.isArray(response.data?.sources)
          ? response.data.sources
          : []
        setAvailableSources(sources)
      } catch (error) {
        console.error('Failed to load sources', error)
      }
    }

    fetchSources()
  }, [])

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!query.trim()) return

    setLoading(true)
    try {
      const response = await axios.get(`${API_BASE}/search`, {
        params: { q: query }
      })
      setResults(response.data)
      setActiveSearchQuery(query.trim())
    } catch (error) {
      console.error('Search failed', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleSource = (source: string) => {
    setSelectedSources(prev =>
      prev.includes(source)
        ? prev.filter(s => s !== source)
        : [...prev, source]
    );
  }

  const filteredResults = selectedSources.length > 0
    ? results.filter(r => selectedSources.includes(r.source))
    : results;
  const latestAssistantSources = [...chatMessages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.sources && message.sources.length > 0)
    ?.sources || [];
  const visibleCurrentSources = selectedSources.length > 0
    ? latestAssistantSources.filter((source) => selectedSources.includes(source.source))
    : latestAssistantSources;
  const hasConversation = chatMessages.length > 0;

  const handleAskQuestion = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const question = chatInput.trim()
    if (!question || chatLoading) return

    const nextHistory: ChatMessage[] = [...chatMessages, { role: 'user', content: question }]
    setChatMessages([...nextHistory, { role: 'assistant', content: '' }])
    setChatInput('')
    setChatLoading(true)
    setWaitingForFirstToken(true)

    try {
      const response = await fetch(`${API_BASE}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question,
          selectedSources,
          history: nextHistory.map((m) => ({ role: m.role, content: m.content })),
        }),
      })

      if (!response.ok || !response.body) {
        throw new Error('Streaming not available')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let streamedAnswer = ''
      let streamedSources: ChatSource[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let separatorIndex = buffer.indexOf('\n\n')
        while (separatorIndex !== -1) {
          const block = buffer.slice(0, separatorIndex).trim()
          buffer = buffer.slice(separatorIndex + 2)
          const parsed = parseSseBlock(block)

          if (parsed?.event === 'token') {
            const chunk = parsed.data.chunk || ''
            if (chunk) {
              setWaitingForFirstToken(false)
              streamedAnswer += chunk
              setChatMessages((prev) => {
                if (prev.length === 0) return prev
                const next = [...prev]
                const idx = next.length - 1
                if (next[idx].role === 'assistant') {
                  next[idx] = {
                    ...next[idx],
                    content: streamedAnswer,
                  }
                }
                return next
              })
            }
          } else if (parsed?.event === 'done') {
            streamedSources = Array.isArray(parsed.data.sources) ? parsed.data.sources : []
            if (typeof parsed.data.answer === 'string' && parsed.data.answer.trim().length > 0) {
              streamedAnswer = parsed.data.answer
            }
            setWaitingForFirstToken(false)
            setChatMessages((prev) => {
              if (prev.length === 0) return prev
              const next = [...prev]
              const idx = next.length - 1
              if (next[idx].role === 'assistant') {
                next[idx] = {
                  ...next[idx],
                  content: streamedAnswer || next[idx].content,
                  sources: streamedSources,
                }
              }
              return next
            })
          } else if (parsed?.event === 'error') {
            setWaitingForFirstToken(false)
            throw new Error(parsed.data.message || 'Streaming failed')
          }

          separatorIndex = buffer.indexOf('\n\n')
        }
      }
    } catch (streamError) {
      console.error('Streaming chat failed, falling back', streamError)
      try {
        const fallbackResponse = await axios.post(`${API_BASE}/chat`, {
        question,
        selectedSources,
        history: nextHistory.map((m) => ({ role: m.role, content: m.content })),
      })

        const answer = typeof fallbackResponse.data?.answer === 'string'
          ? fallbackResponse.data.answer
          : 'Geen antwoord ontvangen.'
        const sources = Array.isArray(fallbackResponse.data?.sources)
          ? fallbackResponse.data.sources
          : []
        setChatMessages((prev) => {
          if (prev.length === 0) return prev
          const next = [...prev]
          const idx = next.length - 1
          if (next[idx].role === 'assistant') {
            next[idx] = { ...next[idx], content: answer, sources }
          }
          return next
        })
        setWaitingForFirstToken(false)
      } catch (fallbackError) {
        console.error('Chat failed', fallbackError)
        setChatMessages((prev) => {
          if (prev.length === 0) return prev
          const next = [...prev]
          const idx = next.length - 1
          if (next[idx].role === 'assistant') {
            next[idx] = {
              ...next[idx],
              content: 'Er ging iets mis bij het genereren van een antwoord.',
            }
          }
          return next
        })
        setWaitingForFirstToken(false)
      }
    } finally {
      setChatLoading(false)
    }
  }

  const resetToCurrentSources = () => {
    setActiveSearchQuery('')
    setQuery('')
  }

  if (!hasConversation) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
        <div className="w-full max-w-3xl text-center space-y-6">
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900">MijnServices Chat</h1>
          <p className="text-gray-600 text-lg">
            Stel een vraag over de documentatie en krijg direct antwoord met bronverwijzingen.
          </p>

          <form onSubmit={handleAskQuestion} className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 sm:p-5 flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              className="flex-1 min-h-[44px] rounded-xl border border-gray-300 bg-white px-4 text-base placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Bijv. Wat is TAP-straat en hoe werkt het?"
              autoFocus
            />
            <button
              type="submit"
              disabled={chatLoading || !chatInput.trim()}
              className="bg-gray-900 text-white px-4 py-2 rounded-xl font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {chatLoading ? 'Denken...' : 'Verstuur'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <header className="text-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900">MijnServices Chat</h1>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
          <main className="space-y-4">
            <div className="space-y-4">
              {chatMessages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`rounded-xl border p-4 bg-white ${
                    message.role === 'user'
                      ? 'border-blue-200'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wide font-semibold mb-2 text-gray-500">
                    {message.role === 'user' ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                    {message.role === 'user' ? 'Jij' : 'Assistent'}
                  </div>
                  <div className="markdown-content text-gray-800">
                    {message.role === 'assistant' && !message.content && chatLoading && waitingForFirstToken ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <span>Antwoord wordt geladen</span>
                        <span className="inline-flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-pulse" />
                          <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-pulse [animation-delay:150ms]" />
                          <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-pulse [animation-delay:300ms]" />
                        </span>
                      </div>
                    ) : (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={handleAskQuestion} className="bg-white border border-gray-200 rounded-2xl shadow-sm p-3 flex gap-2 sticky bottom-4">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="flex-1 min-h-[44px] rounded-xl border border-gray-300 bg-white px-4 text-base placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Typ je vraag..."
              />
              <button
                type="submit"
                disabled={chatLoading || !chatInput.trim()}
                className="bg-gray-900 text-white px-4 py-2 rounded-xl font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {chatLoading ? 'Denken...' : 'Verstuur'}
              </button>
            </form>
          </main>

          <aside className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-gray-500" />
                <h3 className="text-sm font-semibold text-gray-800">Broncontext</h3>
              </div>

              <form onSubmit={handleSearch} className="space-y-2">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="block w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 bg-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Aangepaste documentzoekopdracht..."
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Zoeken...' : 'Zoek in documenten'}
                </button>
              </form>

              <div className="text-xs text-gray-500">
                {activeSearchQuery
                  ? `Aangepaste zoekopdracht actief: "${activeSearchQuery}"`
                  : 'Standaard zie je bronnen uit je laatste assistent-antwoord.'}
              </div>

              {activeSearchQuery && (
                <button
                  onClick={resetToCurrentSources}
                  className="text-sm text-blue-700 hover:text-blue-900 font-medium"
                >
                  Terug naar huidige broncontext
                </button>
              )}

              {allSources.length > 0 && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowFilters((prev) => !prev)}
                    className="w-full flex items-center justify-between text-sm font-semibold text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-100"
                  >
                    <span className="flex items-center gap-2">
                      <SlidersHorizontal className="h-4 w-4" />
                      Filters
                    </span>
                    <span>{showFilters ? 'Verberg' : 'Toon'}</span>
                  </button>

                  {showFilters && (
                    <div className="space-y-2 border border-gray-200 rounded-lg p-3">
                      <div className="flex justify-end">
                        {selectedSources.length > 0 && (
                          <button
                            onClick={() => setSelectedSources([])}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Wis alles
                          </button>
                        )}
                      </div>
                      {allSources.map(source => (
                        <label key={source} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedSources.includes(source)}
                            onChange={() => toggleSource(source)}
                            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-gray-300"
                          />
                          <span className="text-sm font-medium text-gray-700">{source.toUpperCase()}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
              {activeSearchQuery ? (
                filteredResults.length > 0 ? (
                  filteredResults.map((result) => (
                    <SourceCard
                      key={result.id}
                      source={result.source.toUpperCase()}
                      title={result.title}
                      url={result.url}
                      excerpt={toExcerpt(result.content)}
                    />
                  ))
                ) : (
                  <div className="text-sm text-gray-500 bg-white border border-gray-200 rounded-xl p-3">
                    {results.length > 0
                      ? 'Geen resultaten die voldoen aan je filters.'
                      : 'Geen resultaten gevonden. Probeer een andere zoekopdracht.'}
                  </div>
                )
              ) : visibleCurrentSources.length > 0 ? (
                visibleCurrentSources.map((source, idx) => (
                  <SourceCard
                    key={`${source.url}-${idx}`}
                    source={source.source.toUpperCase()}
                    title={source.title}
                    url={source.url}
                    excerpt={source.excerpt}
                  />
                ))
              ) : (
                <div className="text-sm text-gray-500 bg-white border border-gray-200 rounded-xl p-3">
                  Stel eerst een chatvraag om broncontext te zien, of gebruik een aangepaste documentzoekopdracht.
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

export default App
