/**
 * Complete tool definitions with ChatGPT-required fields
 */

export const MIAW_TOOLS: any[] = [
  {
    name: 'generate_guest_access_token',
    title: 'Generate Guest Access Token',
    description: 'Generate an access token for an unauthenticated (guest) user. This is the first step to start a messaging session. For Web platform, deviceId should be omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'Unique device identifier (UUID format). Optional - omit for Web platform.' },
        appName: { type: 'string', description: 'Name of the application' },
        clientVersion: { type: 'string', description: 'Version of the client' },
        captchaToken: { type: 'string', description: 'Optional CAPTCHA token' }
      },
      required: [],
      additionalProperties: false
    },
    outputSchema: {
      type: 'object',
      properties: {
        accessToken: { type: 'string', description: 'The generated access token' },
        expiresIn: { type: 'number', description: 'Token expiration in seconds' }
      },
      required: ['accessToken']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: {}
  },
  {
    name: 'create_conversation',
    title: 'Create Conversation',
    description: 'Create a new conversation with a Salesforce agent (human or AI). Call this after obtaining an access token.',
    inputSchema: {
      type: 'object',
      properties: {
        routableType: { type: 'string', description: 'Type of routing (e.g., "Queue", "Agent")' },
        routingAttributes: { type: 'object', description: 'Routing attributes' },
        capabilities: { type: 'array', items: { type: 'string' }, description: 'Client capabilities' },
        prechatDetails: { type: 'array', items: { type: 'object' }, description: 'Pre-chat form data' }
      },
      additionalProperties: false
    },
    outputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'string', description: 'The conversation ID. SAVE THIS for future calls.' },
        status: { type: 'string', description: 'Current conversation status' }
      },
      required: ['conversationId']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: {}
  },
  {
    name: 'send_message',
    title: 'Send Message',
    description: 'Send a text message in an active conversation. Use this to communicate with the Salesforce agent.',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'string', description: 'The ID of the conversation' },
        text: { type: 'string', description: 'The message text to send' },
        messageType: { type: 'string', description: 'Message type (default: "StaticContentMessage")' }
      },
      required: ['conversationId', 'text'],
      additionalProperties: false
    },
    outputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The sent message ID' },
        timestamp: { type: 'number', description: 'Message timestamp' },
        success: { type: 'boolean', description: 'Whether the message was sent successfully' }
      }
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: {}
  },
  {
    name: 'list_conversation_entries',
    title: 'List Conversation Messages',
    description: 'List all messages in a conversation. Use this to read messages from the Salesforce agent.',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'string', description: 'The ID of the conversation' },
        continuationToken: { type: 'string', description: 'Optional pagination token' }
      },
      required: ['conversationId'],
      additionalProperties: false
    },
    outputSchema: {
      type: 'object',
      properties: {
        entries: { type: 'array', items: { type: 'object' }, description: 'Array of conversation messages' },
        continuationToken: { type: 'string', description: 'Token for next page' }
      },
      required: ['entries']
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: {}
  },
  {
    name: 'get_conversation_routing_status',
    title: 'Get Conversation Status',
    description: 'Check if conversation is queued, connected to agent, or waiting.',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'string', description: 'The ID of the conversation' }
      },
      required: ['conversationId'],
      additionalProperties: false
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Current routing status' },
        estimatedWaitTime: { type: 'number', description: 'Estimated wait time in seconds' }
      },
      required: ['status']
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: {}
  },
  {
    name: 'close_conversation',
    title: 'Close Conversation',
    description: 'Close an active conversation. This ends the chat session.',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'string', description: 'The ID of the conversation to close' }
      },
      required: ['conversationId'],
      additionalProperties: false
    },
    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', description: 'Whether the conversation was closed successfully' }
      },
      required: ['success']
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    _meta: {}
  }
];

