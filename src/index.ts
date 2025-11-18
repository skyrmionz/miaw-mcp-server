#!/usr/bin/env node

/**
 * MCP Server for Salesforce Enhanced Chat (MIAW) API
 * 
 * This server enables AI agents (like ChatGPT) to interact with Salesforce
 * Enhanced Chat messaging system, allowing them to escalate conversations
 * to human or AI agents within Salesforce when needed.
 * 
 * Supports both stdio (local) and HTTP/SSE (hosted) transports.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance, AxiosError } from 'axios';
import express from 'express';
import dotenv from 'dotenv';
import * as types from './types.js';
import { MIAW_TOOLS } from './tool-definitions.js';

// Load environment variables
dotenv.config();

/**
 * MIAW API Client
 */
class MIAWClient {
  private axiosInstance: AxiosInstance;
  private config: types.MIAWConfig;
  private accessToken: string | null = null;

  constructor(config: types.MIAWConfig) {
    this.config = {
      capabilitiesVersion: '1',
      platform: 'Web',
      ...config
    };

    this.axiosInstance = axios.create({
      baseURL: `https://${this.config.scrtUrl}/iamessage/api/v2`,
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  }

  /**
   * Set the access token for authenticated requests
   */
  setAccessToken(token: string) {
    this.accessToken = token;
    this.axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  /**
   * Generate access token for unauthenticated (guest) user
   */
  async generateGuestAccessToken(
    deviceId?: string,
    context?: { appName?: string; clientVersion?: string },
    captchaToken?: string
  ): Promise<types.AccessTokenResponse> {
    const request: any = {
      orgId: this.config.orgId,
      esDeveloperName: this.config.esDeveloperName,
      capabilitiesVersion: this.config.capabilitiesVersion!,
      platform: this.config.platform!,
      context,
      captchaToken
    };

    // For Web platform, NEVER include deviceId (API requirement)
    // The API explicitly rejects requests with deviceId for Web platform
    if (this.config.platform !== 'Web' && deviceId) {
      request.deviceId = deviceId;
    }

    console.error('Guest token request:', {
      platform: this.config.platform,
      hasDeviceId: !!deviceId,
      willIncludeDeviceId: this.config.platform !== 'Web' && !!deviceId,
      requestKeys: Object.keys(request)
    });

    const response = await this.axiosInstance.post<types.AccessTokenResponse>(
      '/authorization/unauthenticated/access-token',
      request
    );

    // Automatically set the access token for subsequent requests
    if (response.data.accessToken) {
      this.setAccessToken(response.data.accessToken);
    }

    return response.data;
  }

  /**
   * Generate access token for authenticated user
   */
  async generateAuthenticatedAccessToken(
    jwt: string,
    subject: string,
    deviceId: string,
    context?: { appName?: string; clientVersion?: string }
  ): Promise<types.AccessTokenResponse> {
    const request: types.AuthenticatedTokenRequest = {
      orgId: this.config.orgId,
      esDeveloperName: this.config.esDeveloperName,
      capabilitiesVersion: this.config.capabilitiesVersion!,
      platform: this.config.platform!,
      deviceId,
      jwt,
      subject,
      context
    };

    const response = await this.axiosInstance.post<types.AccessTokenResponse>(
      '/authorization/authenticated/access-token',
      request
    );

    // Automatically set the access token for subsequent requests
    if (response.data.accessToken) {
      this.setAccessToken(response.data.accessToken);
    }

    return response.data;
  }

  /**
   * Generate continuation token for maintaining session
   */
  async generateContinuationToken(): Promise<types.ContinuationTokenResponse> {
    const response = await this.axiosInstance.get<types.ContinuationTokenResponse>(
      '/authorization/continuation-token'
    );
    return response.data;
  }

  /**
   * Revoke the current access token
   */
  async revokeToken(): Promise<void> {
    await this.axiosInstance.delete('/authorization/token');
    this.accessToken = null;
    delete this.axiosInstance.defaults.headers.common['Authorization'];
  }

  /**
   * Create a new conversation
   */
  async createConversation(
    request: types.CreateConversationRequest,
    conversationId?: string
  ): Promise<types.CreateConversationResponse> {
    // Generate a UUID for the conversation if not provided
    const convId = conversationId || generateUUID();
    
    // Format request according to MIAW API spec
    // IMPORTANT: Only send conversationId, esDeveloperName, and routingAttributes
    // Other fields like capabilities, prechatDetails cause 400 errors
    const formattedRequest: any = {
      conversationId: convId,
      esDeveloperName: this.config.esDeveloperName
    };
    
    // Only add routingAttributes if provided and not empty
    if (request.routingAttributes && Object.keys(request.routingAttributes).length > 0) {
      formattedRequest.routingAttributes = request.routingAttributes;
    } else {
      // Send empty object if not provided
      formattedRequest.routingAttributes = {};
    }
    
    // Note: capabilities, prechatDetails, conversationContextId, routableType are NOT supported by the API
    
    console.error('Creating conversation with ID:', convId);
    
    const response = await this.axiosInstance.post<types.CreateConversationResponse>(
      '/conversation',
      formattedRequest
    );
    
    // Return the conversation ID we generated
    return {
      ...response.data,
      conversationId: convId
    };
  }

  /**
   * Send a typing indicator
   */
  async sendTypingIndicator(
    conversationId: string,
    isTyping: boolean
  ): Promise<void> {
    await this.axiosInstance.post(
      `/conversations/${conversationId}/typing`,
      { isTyping }
    );
  }

  /**
   * Send a message in a conversation
   */
  async sendMessage(
    conversationId: string,
    request: types.SendMessageRequest
  ): Promise<types.SendMessageResponse> {
    // Generate message ID if not provided
    const messageId = request.message.staticContentId || generateUUID();
    
    // Format according to MIAW API spec
    const formattedRequest: any = {
      message: {
        id: messageId,
        messageType: request.message.messageType || 'StaticContentMessage',
        staticContent: {
          text: request.message.text || '',
          formatType: request.message.format || 'Text'  // Required field, default to 'Text'
        }
      },
      esDeveloperName: this.config.esDeveloperName
    };
    
    console.error('Sending message with ID:', messageId, 'to conversation:', conversationId);
    
    const response = await this.axiosInstance.post<types.SendMessageResponse>(
      `/conversation/${conversationId}/message`,
      formattedRequest
    );
    return response.data;
  }

  /**
   * Send delivery acknowledgements or read receipts
   */
  async sendDeliveryAcknowledgements(
    conversationId: string,
    request: types.SendDeliveryAcknowledgementRequest
  ): Promise<void> {
    await this.axiosInstance.post(
      `/conversations/${conversationId}/acknowledgements`,
      request
    );
  }

  /**
   * Send a file in a conversation
   */
  async sendFile(
    conversationId: string,
    request: types.SendFileRequest
  ): Promise<types.SendMessageResponse> {
    const response = await this.axiosInstance.post<types.SendMessageResponse>(
      `/conversations/${conversationId}/files`,
      request
    );
    return response.data;
  }

  /**
   * Close a conversation
   */
  async closeConversation(conversationId: string): Promise<void> {
    await this.axiosInstance.delete(`/conversations/${conversationId}`);
  }

  /**
   * Get conversation routing status
   */
  async getConversationRoutingStatus(
    conversationId: string
  ): Promise<types.ConversationRoutingStatus> {
    const response = await this.axiosInstance.get<types.ConversationRoutingStatus>(
      `/conversations/${conversationId}/routing-status`
    );
    return response.data;
  }

  /**
   * End messaging session
   */
  async endMessagingSession(): Promise<void> {
    await this.axiosInstance.delete('/messaging-session');
  }

  /**
   * List all conversations for the current user
   */
  async listConversations(): Promise<types.ListConversationsResponse> {
    const response = await this.axiosInstance.get<types.ListConversationsResponse>(
      '/conversations'
    );
    return response.data;
  }

  /**
   * List conversation entries (messages) for a specific conversation
   */
  async listConversationEntries(
    conversationId: string,
    continuationToken?: string
  ): Promise<types.ListConversationEntriesResponse> {
    const params = continuationToken ? { continuationToken } : {};
    const response = await this.axiosInstance.get<types.ListConversationEntriesResponse>(
      `/conversation/${conversationId}/entries`,
      { params }
    );
    return response.data;
  }

  /**
   * Retrieve full conversation transcript
   */
  async getConversationTranscript(
    conversationId: string
  ): Promise<types.ConversationTranscript> {
    const response = await this.axiosInstance.get<types.ConversationTranscript>(
      `/conversations/${conversationId}/transcript`
    );
    return response.data;
  }

  /**
   * Register device for push notifications
   */
  async registerDeviceForPushNotifications(
    request: types.RegisterDeviceRequest
  ): Promise<void> {
    await this.axiosInstance.post('/push-notifications/device', request);
  }

  /**
   * Unregister device from push notifications
   */
  async unregisterDeviceFromPushNotifications(deviceToken: string): Promise<void> {
    await this.axiosInstance.delete(`/push-notifications/device/${deviceToken}`);
  }
}

/**
 * Session storage for managing access tokens server-side
 * This prevents exposing JWTs to ChatGPT (which triggers moderation)
 */
const sessions = new Map<string, { accessToken: string; conversationId?: string }>();

/**
 * Generate a simple session ID
 */
function generateSessionId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Generate a UUID v4 for conversation IDs
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * MCP Server Implementation
 */
class MIAWMCPServer {
  private server: Server;
  private client: MIAWClient | null = null;

  constructor() {
    this.server = new Server(
      {
        name: 'miaw-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  /**
   * Initialize the MIAW client with configuration
   */
  private initializeClient() {
    if (!this.client) {
      const scrtUrl = process.env.MIAW_SCRT_URL;
      const orgId = process.env.MIAW_ORG_ID;
      const esDeveloperName = process.env.MIAW_ES_DEVELOPER_NAME;

      if (!scrtUrl || !orgId || !esDeveloperName) {
        throw new Error(
          'Missing required environment variables: MIAW_SCRT_URL, MIAW_ORG_ID, MIAW_ES_DEVELOPER_NAME'
        );
      }

      this.client = new MIAWClient({
        scrtUrl,
        orgId,
        esDeveloperName,
        capabilitiesVersion: process.env.MIAW_CAPABILITIES_VERSION || '1',
        platform: process.env.MIAW_PLATFORM || 'Web'
      });
    }
    return this.client;
  }

  /**
   * Setup MCP request handlers
   */
  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const client = this.initializeClient();
        return await this.handleToolCall(client, request.params.name, request.params.arguments);
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError<types.ErrorResponse>;
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: true,
                  message: axiosError.response?.data?.error?.message || axiosError.message,
                  code: axiosError.response?.data?.error?.code || axiosError.code,
                  details: axiosError.response?.data?.error?.details
                }, null, 2)
              }
            ]
          };
        }
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: true,
                message: error instanceof Error ? error.message : 'Unknown error occurred'
              }, null, 2)
            }
          ]
        };
      }
    });
  }

  /**
   * Define all available MCP tools
   */
  private getTools(): any[] {
    // Use the properly formatted tool definitions for ChatGPT compatibility
    return MIAW_TOOLS;
    
    // Original 17 tools (keeping for reference, but using simplified 6-tool set above)
    /* return [
      {
        name: 'generate_guest_access_token',
        title: 'Generate Guest Access Token',
        description: 'Generate an access token for an unauthenticated (guest) user. This is the first step to start a messaging session. The access token is automatically saved for subsequent requests.',
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: {
              type: 'string',
              description: 'Unique device identifier (UUID format recommended)'
            },
            appName: {
              type: 'string',
              description: 'Name of the application initiating the chat'
            },
            clientVersion: {
              type: 'string',
              description: 'Version of the client application'
            },
            captchaToken: {
              type: 'string',
              description: 'Optional CAPTCHA token if required by the deployment'
            }
          },
          required: ['deviceId'],
          additionalProperties: false
        },
        outputSchema: {
          type: 'object',
          properties: {
            accessToken: {
              type: 'string',
              description: 'The generated access token'
            },
            tokenType: {
              type: 'string',
              description: 'Type of token (Bearer)'
            },
            expiresIn: {
              type: 'number',
              description: 'Token expiration time in seconds'
            }
          },
          required: ['accessToken']
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false
        },
        _meta: {}
      },
      {
        name: 'generate_authenticated_access_token',
        description: 'Generate an access token for an authenticated user using a JWT. The access token is automatically saved for subsequent requests.',
        inputSchema: {
          type: 'object',
          properties: {
            jwt: {
              type: 'string',
              description: 'JSON Web Token for authentication'
            },
            subject: {
              type: 'string',
              description: 'Subject identifier for the authenticated user'
            },
            deviceId: {
              type: 'string',
              description: 'Unique device identifier (UUID format recommended)'
            },
            appName: {
              type: 'string',
              description: 'Name of the application initiating the chat'
            },
            clientVersion: {
              type: 'string',
              description: 'Version of the client application'
            }
          },
          required: ['jwt', 'subject', 'deviceId']
        }
      },
      {
        name: 'create_conversation',
        description: 'Create a new conversation/chat session with a Salesforce agent (human or AI). This should be called after obtaining an access token.',
        inputSchema: {
          type: 'object',
          properties: {
            routableType: {
              type: 'string',
              description: 'Type of routing to use (e.g., "Queue", "Agent")'
            },
            routingAttributes: {
              type: 'object',
              description: 'Attributes used for routing the conversation to the appropriate agent or queue'
            },
            capabilities: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of capabilities supported by the client (e.g., ["MessageRead", "MessageDelivered"])'
            },
            conversationContextId: {
              type: 'string',
              description: 'Optional conversation context ID for resuming a previous conversation'
            },
            prechatDetails: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  name: { type: 'string' },
                  value: { type: 'string' },
                  displayToAgent: { type: 'boolean' }
                }
              },
              description: 'Pre-chat form details to be displayed to the agent'
            }
          }
        }
      },
      {
        name: 'send_message',
        description: 'Send a text message in an active conversation. Use this to communicate with the Salesforce agent.',
        inputSchema: {
          type: 'object',
          properties: {
            conversationId: {
              type: 'string',
              description: 'The ID of the conversation to send the message to'
            },
            text: {
              type: 'string',
              description: 'The message text to send'
            },
            messageType: {
              type: 'string',
              description: 'Type of message (default: "StaticContentMessage")'
            },
            clientTimestamp: {
              type: 'number',
              description: 'Optional client-side timestamp (milliseconds since epoch)'
            }
          },
          required: ['conversationId', 'text']
        }
      },
      {
        name: 'send_typing_indicator',
        description: 'Send a typing indicator to show that the user is typing a message.',
        inputSchema: {
          type: 'object',
          properties: {
            conversationId: {
              type: 'string',
              description: 'The ID of the conversation'
            },
            isTyping: {
              type: 'boolean',
              description: 'True if user is typing, false if user stopped typing'
            }
          },
          required: ['conversationId', 'isTyping']
        }
      },
      {
        name: 'list_conversation_entries',
        description: 'List all messages and entries in a conversation. Use this to read messages from the agent.',
        inputSchema: {
          type: 'object',
          properties: {
            conversationId: {
              type: 'string',
              description: 'The ID of the conversation'
            },
            continuationToken: {
              type: 'string',
              description: 'Optional token for pagination'
            }
          },
          required: ['conversationId']
        }
      },
      {
        name: 'get_conversation_routing_status',
        description: 'Check the routing status of a conversation (e.g., queued, connected to agent, waiting).',
        inputSchema: {
          type: 'object',
          properties: {
            conversationId: {
              type: 'string',
              description: 'The ID of the conversation'
            }
          },
          required: ['conversationId']
        }
      },
      {
        name: 'get_conversation_transcript',
        description: 'Retrieve the full transcript of a conversation including all messages and metadata.',
        inputSchema: {
          type: 'object',
          properties: {
            conversationId: {
              type: 'string',
              description: 'The ID of the conversation'
            }
          },
          required: ['conversationId']
        }
      },
      {
        name: 'send_delivery_acknowledgements',
        description: 'Send delivery acknowledgements or read receipts for received messages.',
        inputSchema: {
          type: 'object',
          properties: {
            conversationId: {
              type: 'string',
              description: 'The ID of the conversation'
            },
            acknowledgements: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  entryId: { type: 'string' },
                  deliveryStatus: { type: 'string', enum: ['Delivered', 'Read'] },
                  clientTimestamp: { type: 'number' }
                }
              },
              description: 'Array of acknowledgements to send'
            }
          },
          required: ['conversationId', 'acknowledgements']
        }
      },
      {
        name: 'send_file',
        description: 'Send a file attachment in a conversation.',
        inputSchema: {
          type: 'object',
          properties: {
            conversationId: {
              type: 'string',
              description: 'The ID of the conversation'
            },
            fileData: {
              type: 'string',
              description: 'Base64 encoded file data'
            },
            fileName: {
              type: 'string',
              description: 'Name of the file'
            },
            mimeType: {
              type: 'string',
              description: 'MIME type of the file (e.g., "image/png", "application/pdf")'
            }
          },
          required: ['conversationId', 'fileData', 'fileName', 'mimeType']
        }
      },
      {
        name: 'close_conversation',
        description: 'Close an active conversation. This ends the chat session.',
        inputSchema: {
          type: 'object',
          properties: {
            conversationId: {
              type: 'string',
              description: 'The ID of the conversation to close'
            }
          },
          required: ['conversationId']
        }
      },
      {
        name: 'list_conversations',
        description: 'List all conversations for the current user/session.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'end_messaging_session',
        description: 'End the entire messaging session, closing all active conversations.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'generate_continuation_token',
        description: 'Generate a continuation token to maintain the session and prevent timeout.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'revoke_token',
        description: 'Revoke the current access token and end authentication.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]; */
  }

  /**
   * Handle tool calls
   */
  private async handleToolCall(
    client: MIAWClient,
    toolName: string,
    args: any
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    let result: any;

    switch (toolName) {
      case 'generate_guest_access_token':
        const tokenResponse = await client.generateGuestAccessToken(
          args.deviceId,
          { appName: args.appName, clientVersion: args.clientVersion },
          args.captchaToken
        );
        // Store token server-side and return sessionId (avoids exposing JWT to ChatGPT)
        const sessionId = generateSessionId();
        sessions.set(sessionId, { accessToken: tokenResponse.accessToken });
        result = {
          sessionId: sessionId,
          expiresIn: tokenResponse.expiresIn || 3600,
          message: 'Session created successfully. Use this sessionId for all subsequent calls.'
        };
        break;

      case 'generate_authenticated_access_token':
        result = await client.generateAuthenticatedAccessToken(
          args.jwt,
          args.subject,
          args.deviceId,
          { appName: args.appName, clientVersion: args.clientVersion }
        );
        break;

      case 'create_conversation':
        if (args.sessionId) {
          const session = sessions.get(args.sessionId);
          if (!session) {
            throw new Error('Invalid sessionId. Please generate a new session first.');
          }
          client.setAccessToken(session.accessToken);
        }
        const convResult = await client.createConversation({
          routableType: args.routableType,
          routingAttributes: args.routingAttributes,
          capabilities: args.capabilities,
          conversationContextId: args.conversationContextId,
          prechatDetails: args.prechatDetails
        });
        // Store conversationId in session
        if (args.sessionId) {
          const session = sessions.get(args.sessionId);
          if (session) {
            session.conversationId = convResult.conversationId;
          }
        }
        // Add explicit instruction to fetch greeting
        result = {
          ...convResult,
          _nextAction: 'MANDATORY: You MUST now call list_conversation_entries (wait 3 seconds first) to retrieve and display the agent\'s initial greeting to the user. DO NOT respond with "connected" - fetch the actual greeting message.'
        };
        break;

      case 'send_message':
        if (args.sessionId) {
          const session = sessions.get(args.sessionId);
          if (!session) {
            throw new Error('Invalid sessionId. Please generate a new session first.');
          }
          client.setAccessToken(session.accessToken);
        }
        const sendResult = await client.sendMessage(args.conversationId, {
          message: {
            text: args.text,
            messageType: args.messageType || 'StaticContentMessage'
          },
          clientTimestamp: args.clientTimestamp
        });
        // Add explicit instruction to fetch reply
        result = {
          ...sendResult,
          _nextAction: 'MANDATORY: You MUST now wait 3-5 seconds, then call list_conversation_entries to retrieve the agent\'s reply. Display the reply verbatim as your own response.'
        };
        break;

      case 'send_typing_indicator':
        await client.sendTypingIndicator(args.conversationId, args.isTyping);
        result = { success: true, message: 'Typing indicator sent' };
        break;

      case 'list_conversation_entries':
        if (args.sessionId) {
          const session = sessions.get(args.sessionId);
          if (!session) {
            throw new Error('Invalid sessionId. Please generate a new session first.');
          }
          client.setAccessToken(session.accessToken);
        }
        result = await client.listConversationEntries(
          args.conversationId,
          args.continuationToken
        );
        break;

      case 'get_conversation_routing_status':
        if (args.sessionId) {
          const session = sessions.get(args.sessionId);
          if (!session) {
            throw new Error('Invalid sessionId. Please generate a new session first.');
          }
          client.setAccessToken(session.accessToken);
        }
        result = await client.getConversationRoutingStatus(args.conversationId);
        break;

      case 'get_conversation_transcript':
        result = await client.getConversationTranscript(args.conversationId);
        break;

      case 'send_delivery_acknowledgements':
        await client.sendDeliveryAcknowledgements(args.conversationId, {
          acknowledgements: args.acknowledgements
        });
        result = { success: true, message: 'Acknowledgements sent' };
        break;

      case 'send_file':
        result = await client.sendFile(args.conversationId, {
          file: {
            data: args.fileData,
            fileName: args.fileName,
            mimeType: args.mimeType
          }
        });
        break;

      case 'close_conversation':
        if (args.sessionId) {
          const session = sessions.get(args.sessionId);
          if (!session) {
            throw new Error('Invalid sessionId. Please generate a new session first.');
          }
          client.setAccessToken(session.accessToken);
        }
        await client.closeConversation(args.conversationId);
        result = { success: true, message: 'Conversation closed' };
        break;

      case 'list_conversations':
        result = await client.listConversations();
        break;

      case 'end_messaging_session':
        await client.endMessagingSession();
        result = { success: true, message: 'Messaging session ended' };
        break;

      case 'generate_continuation_token':
        result = await client.generateContinuationToken();
        break;

      case 'revoke_token':
        await client.revokeToken();
        result = { success: true, message: 'Token revoked' };
        break;

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }

  /**
   * Start the MCP server in stdio mode (local)
   */
  async startStdio() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('MIAW MCP Server running on stdio');
  }

  /**
   * Create a new MCP Server instance for a connection
   */
  private createServerInstance(): Server {
    const server = new Server(
      {
        name: 'miaw-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Setup handlers for this instance
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const client = this.initializeClient();
        return await this.handleToolCall(client, request.params.name, request.params.arguments);
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError<types.ErrorResponse>;
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: true,
                  message: axiosError.response?.data?.error?.message || axiosError.message,
                  code: axiosError.response?.data?.error?.code || axiosError.code,
                  details: axiosError.response?.data?.error?.details
                }, null, 2)
              }
            ]
          };
        }
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: true,
                message: error instanceof Error ? error.message : 'Unknown error occurred'
              }, null, 2)
            }
          ]
        };
      }
    });

    return server;
  }

  /**
   * Start the MCP server in HTTP/SSE mode (hosted)
   */
  async startHttp(port: number = 3000) {
    const app = express();
    
    // Enable CORS for all routes
    app.use((_req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS, HEAD');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
      next();
    });
    
    // Enable JSON body parsing with increased limit
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Health check endpoint
    app.get('/health', (_req, res) => {
      res.json({ status: 'healthy', service: 'miaw-mcp-server', version: '1.0.0' });
    });

    // Root endpoint with info
    app.get('/', (_req, res) => {
      res.json({
        name: 'MIAW MCP Server',
        description: 'MCP Server for Salesforce Enhanced Chat (MIAW) API',
        version: '1.0.0',
        mcp_endpoint: '/mcp',
        health_check: '/health',
        documentation: 'https://github.com/your-repo/miaw-mcp-server'
      });
    });

    // Store active MCP sessions
    const sessions = new Map<string, Server>();

    // MCP endpoint - GET establishes SSE connection
    app.get('/mcp', async (req, res) => {
      console.error(`MCP GET (SSE) request from ${req.ip || 'unknown'}`);
      console.error(`User-Agent: ${req.headers['user-agent'] || 'unknown'}`);
      
      try {
        // Generate session ID
        const sessionId = Math.random().toString(36).substring(7);
        
        // Create a new server instance for this session
        const serverInstance = this.createServerInstance();
        sessions.set(sessionId, serverInstance);
        
        // Create SSE transport with message endpoint
        const transport = new SSEServerTransport(`/mcp`, res);
        
        console.error(`Session ${sessionId}: Connecting MCP server instance...`);
        await serverInstance.connect(transport);
        console.error(`Session ${sessionId}: MCP server connected successfully`);
        
        // Clean up on close
        req.on('close', () => {
          console.error(`Session ${sessionId}: Connection closed by client`);
          sessions.delete(sessionId);
        });

        req.on('error', (err: any) => {
          console.error(`Session ${sessionId}: Connection error:`, err);
          sessions.delete(sessionId);
        });
      } catch (error) {
        console.error('Error establishing SSE connection:', error);
        if (!res.headersSent) {
          res.status(500).json({ 
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal error: Failed to establish SSE connection',
              data: error instanceof Error ? error.message : String(error)
            }
          });
        }
      }
    });

    // POST for stateless HTTP JSON-RPC (what Cursor actually uses!)
    app.post('/mcp', async (req, res) => {
      console.error(`MCP POST (JSON-RPC) request from ${req.ip || 'unknown'}`);
      console.error(`User-Agent: ${req.headers['user-agent'] || 'unknown'}`);
      console.error(`Method: ${req.body?.method}, ID: ${req.body?.id}`);
      
      try {
        const jsonrpcRequest = req.body;
        
        // Validate JSON-RPC request
        if (!jsonrpcRequest || jsonrpcRequest.jsonrpc !== '2.0') {
          return res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32600,
              message: 'Invalid Request: Not a valid JSON-RPC 2.0 request'
            },
            id: null
          });
        }

        // Create a new MIAWClient for this request (stateless)
        const client = new MIAWClient({
          scrtUrl: process.env.MIAW_SCRT_URL!,
          orgId: process.env.MIAW_ORG_ID!,
          esDeveloperName: process.env.MIAW_ES_DEVELOPER_NAME!
        });

        // Handle different JSON-RPC methods
        let result: any;
        
        switch (jsonrpcRequest.method) {
          case 'initialize':
            result = {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {}
              },
              serverInfo: {
                name: 'miaw-mcp-server',
                version: '1.0.0'
              }
            };
            break;

          case 'tools/list':
            result = {
              tools: this.getTools()
            };
            break;

          case 'tools/call':
            const toolName = jsonrpcRequest.params?.name;
            const toolArgs = jsonrpcRequest.params?.arguments || {};
            
            if (!toolName) {
              throw new Error('Tool name is required');
            }

            const toolResult = await this.handleToolCall(client, toolName, toolArgs);
            result = toolResult;
            break;

          default:
            return res.status(200).json({
              jsonrpc: '2.0',
              error: {
                code: -32601,
                message: `Method not found: ${jsonrpcRequest.method}`
              },
              id: jsonrpcRequest.id
            });
        }

        // Send successful response
        res.status(200).json({
          jsonrpc: '2.0',
          result: result,
          id: jsonrpcRequest.id
        });

      } catch (error) {
        console.error('Error handling JSON-RPC request:', error);
        
        // Handle Axios errors (API errors)
        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError<types.ErrorResponse>;
          const apiError = axiosError.response?.data?.error;
          
          console.error('MIAW API Error:', {
            status: axiosError.response?.status,
            message: apiError?.message || axiosError.message,
            code: apiError?.code,
            details: apiError?.details
          });
          
          res.status(200).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: apiError?.message || axiosError.message || 'API request failed',
              data: {
                httpStatus: axiosError.response?.status,
                errorCode: apiError?.code,
                errorMessage: apiError?.message,
                details: apiError?.details,
                url: axiosError.config?.url
              }
            },
            id: req.body?.id || null
          });
        } else {
          // Handle other errors
          res.status(200).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: error instanceof Error ? error.message : 'Internal error',
              data: {
                errorType: error instanceof Error ? error.constructor.name : 'Unknown',
                errorMessage: error instanceof Error ? error.message : String(error)
              }
            },
            id: req.body?.id || null
          });
        }
      }
    });

    // OPTIONS and HEAD for CORS
    app.options('/mcp', (_req, res) => {
      res.status(204).end();
    });

    app.head('/mcp', (_req, res) => {
      res.status(200).end();
    });

    app.delete('/mcp', (_req, res) => {
      console.error('MCP DELETE request - closing session');
      res.status(200).json({ success: true });
    });

    // Legacy SSE endpoint (kept for backwards compatibility)
    app.get('/sse', async (req, res) => {
      console.error('New SSE connection established via GET (legacy)');
      
      try {
        const serverInstance = this.createServerInstance();
        const transport = new SSEServerTransport('/message', res);
        
        await serverInstance.connect(transport);
        
        req.on('close', () => {
          console.error('SSE connection closed');
        });
      } catch (error) {
        console.error('Error establishing SSE connection:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to establish SSE connection' });
        }
      }
    });

    // Start HTTP server
    app.listen(port, () => {
      console.error(`MIAW MCP Server running on HTTP port ${port}`);
      console.error(`Health check: http://localhost:${port}/health`);
      console.error(`MCP endpoint: http://localhost:${port}/mcp (POST)`);
      console.error(`Legacy SSE endpoint: http://localhost:${port}/sse (GET)`);
    });
  }

  /**
   * Start the server based on environment
   */
  async start() {
    const mode = process.env.MCP_TRANSPORT || 'stdio';
    const port = parseInt(process.env.PORT || '3000', 10);

    if (mode === 'http' || process.env.PORT) {
      // HTTP/SSE mode (for hosted deployment like Heroku)
      await this.startHttp(port);
    } else {
      // stdio mode (for local Claude Desktop integration)
      await this.startStdio();
    }
  }
}

// Start the server
const server = new MIAWMCPServer();
server.start().catch((error) => {
  console.error('Fatal error starting server:', error);
  process.exit(1);
});

