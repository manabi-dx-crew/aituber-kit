import { NextRequest } from 'next/server'

export const config = {
  runtime: 'edge',
}

export default async function handler(req: NextRequest) {
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({
        error: 'DifyMethod Not Allowed',
        errorCode: 'MethodNotAllowed',
      }),
      {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  const { query, apiKey, url, conversationId, stream } = await req.json()

  const difyKey = apiKey || process.env.DIFY_KEY || process.env.DIFY_API_KEY
  if (!difyKey) {
    return new Response(
      JSON.stringify({ error: 'Dify Empty API Key', errorCode: 'EmptyAPIKey' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
  const cleanUrl = (url: string) => {
    const trimmedUrl = url.replace(/\/$/, '')
    return trimmedUrl.endsWith('/v1/chat-messages')
      ? trimmedUrl
      : `${trimmedUrl}/v1/chat-messages`
  }

  const difyUrl = url
    ? cleanUrl(url)
    : process.env.DIFY_URL
      ? cleanUrl(process.env.DIFY_URL)
      : ''
  if (!difyUrl) {
    return new Response(
      JSON.stringify({
        error: 'Dify Empty URL',
        errorCode: 'AIInvalidProperty',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  // デバッグ情報をコンソールに出力
  console.log('=== Dify API Debug Info ===')
  console.log('Original URL from request:', url)
  console.log('Final processed URL:', difyUrl)
  console.log(
    'API Key present:',
    difyKey ? 'Yes (***' + difyKey.slice(-4) + ')' : 'No'
  )
  console.log('User query:', query)
  console.log('Conversation ID:', conversationId)

  const headers = {
    Authorization: `Bearer ${difyKey}`,
    'Content-Type': 'application/json',
  }
  const body = JSON.stringify({
    inputs: {},
    query: query,
    response_mode: stream ? 'streaming' : 'blocking',
    conversation_id: conversationId,
    user: 'aituber-kit',
    files: [],
  })
  try {
    console.log('Making request to Dify API...')
    const response = await fetch(difyUrl, {
      method: 'POST',
      headers: headers,
      body: body,
    })

    console.log('Response received:')
    console.log('- Status:', response.status, response.statusText)
    console.log('- Headers:', Object.fromEntries(response.headers.entries()))

    if (!response.ok) {
      let errorBody = ''
      try {
        errorBody = await response.text()
        console.log('- Error body:', errorBody)
      } catch (e) {
        console.log('- Could not read error response body')
      }

      return new Response(
        JSON.stringify({
          error: 'Dify API request failed',
          errorCode: 'AIAPIError',
          details: {
            status: response.status,
            statusText: response.statusText,
            url: difyUrl,
            responseBody: errorBody,
          },
        }),
        {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    if (stream) {
      return new Response(response.body, {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    } else {
      const data = await response.json()
      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
  } catch (error) {
    console.error('Critical error in Dify API call:', error)
    return new Response(
      JSON.stringify({
        error: 'Dify Internal Server Error',
        errorCode: 'AIAPIError',
        details: {
          message: error instanceof Error ? error.message : 'Unknown error',
          url: difyUrl,
        },
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
