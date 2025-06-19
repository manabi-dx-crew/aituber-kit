import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { EMOTIONS, Message } from '@/features/messages/messages'
import ReactMarkdown from 'react-markdown'

import homeStore from '@/features/stores/home'
import settingsStore from '@/features/stores/settings'
import { messageSelectors } from '@/features/messages/messageSelectors'
import { handleSendChatFn } from '@/features/chat/handlers'

export const ChatLog = () => {
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const resizeHandleRef = useRef<HTMLDivElement>(null)
  const chatLogRef = useRef<HTMLDivElement>(null)

  const characterName = settingsStore((s) => s.characterName)
  const chatLogWidth = settingsStore((s) => s.chatLogWidth)
  const messages = messageSelectors.getTextAndImageMessages(
    homeStore((s) => s.chatLog)
  )

  const [isDragging, setIsDragging] = useState<boolean>(false)

  useEffect(() => {
    chatScrollRef.current?.scrollIntoView({
      behavior: 'auto',
      block: 'center',
    })
  }, [])

  useEffect(() => {
    chatScrollRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }, [messages])

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      setIsDragging(true)
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return

      const newWidth = e.clientX

      const constrainedWidth = Math.max(
        300,
        Math.min(newWidth, window.innerWidth * 0.8)
      )

      settingsStore.setState({ chatLogWidth: constrainedWidth })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    const resizeHandle = resizeHandleRef.current
    if (resizeHandle) {
      resizeHandle.addEventListener('mousedown', handleMouseDown)
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      if (resizeHandle) {
        resizeHandle.removeEventListener('mousedown', handleMouseDown)
      }
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  return (
    <div
      ref={chatLogRef}
      className="absolute h-[100svh] pb-16 z-10 max-w-full"
      style={{ width: `${chatLogWidth}px` }}
    >
      <div className="max-h-full px-4 pt-24 pb-16 overflow-y-auto scroll-hidden">
        {messages.map((msg, i) => {
          return (
            <div key={i} ref={messages.length - 1 === i ? chatScrollRef : null}>
              {typeof msg.content === 'string' ? (
                <Chat
                  role={msg.role}
                  message={msg.content}
                  characterName={characterName}
                />
              ) : (
                <>
                  <Chat
                    role={msg.role}
                    message={msg.content ? msg.content[0].text : ''}
                    characterName={characterName}
                  />
                  <ChatImage
                    role={msg.role}
                    imageUrl={msg.content ? msg.content[1].image : ''}
                    characterName={characterName}
                  />
                </>
              )}
            </div>
          )
        })}
      </div>
      <div
        ref={resizeHandleRef}
        className="absolute top-0 right-0 h-full w-4 cursor-ew-resize hover:bg-secondary hover:bg-opacity-20"
        style={{
          cursor: isDragging ? 'grabbing' : 'ew-resize',
        }}
      >
        <div className="absolute top-1/2 right-1 h-16 w-1 bg-secondary bg-opacity-40 rounded-full transform -translate-y-1/2"></div>
      </div>
    </div>
  )
}

const Chat = ({
  role,
  message,
  characterName,
}: {
  role: string
  message: string
  characterName: string
}) => {
  const sendChat = handleSendChatFn() // sendChatをここで定義
  const emotionPattern = new RegExp(`\\[(${EMOTIONS.join('|')})\\]\\s*`, 'gi')
  const processedMessage = message.replace(emotionPattern, '')

  const roleColor =
    role !== 'user' ? 'bg-secondary text-white ' : 'bg-base-light text-primary'
  const roleText = role !== 'user' ? 'text-secondary' : 'text-primary'

  const handleButtonClick = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (target.tagName === 'BUTTON') {
      const message = target.dataset.message
      if (message) {
        sendChat(message)
      }
    }
  }

  // ボタン風テキストの検出と変換
  function renderWithButtons(text: string) {
    // 例: 「👉他に声かけのバリエーションは？」のような行をボタンに変換
    // 先頭に「👉」があり、改行区切りで複数行ある場合を想定
    const lines = text.split(/\n/)
    return lines.map((line, idx) => {
      const match = line.match(/^([👉👍]\s*)(.+)$/)
      if (match) {
        return (
          <button
            key={idx}
            data-message={match[2]}
            onClick={handleButtonClick}
            className="block w-full text-left bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-xl px-4 py-3 my-2 shadow-md transition-colors duration-150"
          >
            {match[1]}
            {match[2]}
          </button>
        )
      }
      return (
        <span key={idx}>
          {line}
          {idx !== lines.length - 1 && <br />}
        </span>
      )
    })
  }

  return (
    <div className={`mx-auto ml-0 md:ml-10 lg:ml-20 my-4`}>
      {role === 'code' ? (
        <pre className="whitespace-pre-wrap break-words bg-[#1F2937] text-white p-4 rounded-lg">
          <code className="font-mono text-sm">{message}</code>
        </pre>
      ) : (
        <>
          <div
            className={`px-6 py-2 rounded-t-lg font-bold tracking-wider ${roleColor}`}
          >
            {role !== 'user' ? characterName || 'CHARACTER' : 'YOU'}
          </div>
          <div className="px-6 py-4 bg-white rounded-b-lg">
            <div className={`text-base font-bold ${roleText}`}>
              {/* ボタンテキスト優先で変換し、残りはMarkdownで表示 */}
              {renderWithButtons(processedMessage)}
              {/* マークダウン部分 */}
              <ReactMarkdown
                components={{
                  strong: ({ node, ...props }) => (
                    <strong className="font-bold" {...props} />
                  ),
                  h1: ({ node, ...props }) => (
                    <h1 className="text-2xl font-bold my-2" {...props} />
                  ),
                  h2: ({ node, ...props }) => (
                    <h2 className="text-xl font-bold my-2" {...props} />
                  ),
                  h3: ({ node, ...props }) => (
                    <h3 className="text-lg font-bold my-2" {...props} />
                  ),
                  li: ({ node, ...props }) => (
                    <li className="list-disc ml-6" {...props} />
                  ),
                  code: ({ node, ...props }) => (
                    <code className="bg-gray-100 rounded px-1" {...props} />
                  ),
                }}
              >
                {processedMessage}
              </ReactMarkdown>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const ChatImage = ({
  role,
  imageUrl,
  characterName,
}: {
  role: string
  imageUrl: string
  characterName: string
}) => {
  const offsetX = role === 'user' ? 'pl-40' : 'pr-40'

  return (
    <div className={`mx-auto ml-0 md:ml-10 lg:ml-20 my-4 ${offsetX}`}>
      <Image
        src={imageUrl}
        alt="Generated Image"
        className="rounded-lg"
        width={512}
        height={512}
      />
    </div>
  )
}
