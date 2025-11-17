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
    deviceId: string,
    context?: { appName?: string; clientVersion?: string },
    captchaToken?: string
  ): Promise<types.AccessTokenResponse> {
    const request: types.AccessTokenRequest = {
      orgId: this.config.orgId,
      esDeveloperName: this.config.esDeveloperName,
      capabilitiesVersion: this.config.capabilitiesVersion!,
      platform: this.config.platform!,
      deviceId,
      context,
      captchaToken
    };

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
    request: types.CreateConversationRequest
  ): Promise<types.CreateConversationResponse> {
    const response = await this.axiosInstance.post<types.CreateConversationResponse>(
      '/conversations',
      request
    );
    return response.data;
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
    const response = await this.axiosInstance.post<types.SendMessageResponse>(
      `/conversations/${conversationId}/messages`,
      request
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
      `/conversations/${conversationId}/entries`,
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
  private getTools(): Tool[] {
    return [
      {
        name: 'generate_guest_access_token',
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
          required: ['deviceId']
        }
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
    ];
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
        result = await client.generateGuestAccessToken(
          args.deviceId,
          { appName: args.appName, clientVersion: args.clientVersion },
          args.captchaToken
        );
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
        result = await client.createConversation({
          routableType: args.routableType,
          routingAttributes: args.routingAttributes,
          capabilities: args.capabilities,
          conversationContextId: args.conversationContextId,
          prechatDetails: args.prechatDetails
        });
        break;

      case 'send_message':
        result = await client.sendMessage(args.conversationId, {
          message: {
            text: args.text,
            messageType: args.messageType || 'StaticContentMessage'
          },
          clientTimestamp: args.clientTimestamp
        });
        break;

      case 'send_typing_indicator':
        await client.sendTypingIndicator(args.conversationId, args.isTyping);
        result = { success: true, message: 'Typing indicator sent' };
        break;

      case 'list_conversation_entries':
        result = await client.listConversationEntries(
          args.conversationId,
          args.continuationToken
        );
        break;

      case 'get_conversation_routing_status':
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

    // MCP endpoint - supports GET, POST, DELETE (ChatGPT compatible)
    const handleMcpConnection = async (req: any, res: any) => {
      const method = req.method;
      const accept = req.headers.accept || '';
      
      console.error(`MCP ${method} request from ${req.ip || 'unknown'}`);
      console.error(`Accept header: ${accept}`);
      console.error(`User-Agent: ${req.headers['user-agent'] || 'unknown'}`);
      
      try {
        // For HEAD requests, just return 200
        if (method === 'HEAD') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
          return res.status(200).end();
        }

        // For OPTIONS requests (CORS preflight)
        if (method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
          res.setHeader('Access-Control-Max-Age', '86400');
          return res.status(204).end();
        }

        // Set CORS headers for all responses
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');

        // Create a new server instance for this connection
        const serverInstance = this.createServerInstance();
        const transport = new SSEServerTransport('/mcp', res);
        
        console.error('Connecting MCP server instance...');
        await serverInstance.connect(transport);
        console.error('MCP server instance connected successfully');
        
        // Handle connection close
        req.on('close', () => {
          console.error('MCP connection closed by client');
        });

        req.on('error', (err: any) => {
          console.error('MCP connection error:', err);
        });
      } catch (error) {
        console.error('Error establishing MCP connection:', error);
        if (!res.headersSent) {
          res.status(500).json({ 
            jsonrpc: '2.0',
            id: 'server-error',
            error: {
              code: -32603,
              message: 'Internal error: Failed to establish connection',
              data: error instanceof Error ? error.message : String(error)
            }
          });
        }
      }
    };

    // Support all HTTP methods for MCP endpoint
    app.options('/mcp', handleMcpConnection);
    app.head('/mcp', handleMcpConnection);
    app.get('/mcp', handleMcpConnection);
    app.post('/mcp', handleMcpConnection);
    app.delete('/mcp', handleMcpConnection);

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

