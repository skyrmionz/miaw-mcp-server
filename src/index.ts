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
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance, AxiosError } from 'axios';
import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as types from './types.js';
import { MIAW_TOOLS } from './tool-definitions.js';

// Load environment variables
dotenv.config();

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// In production, dist/index.js needs to go up to root, then to widgets
const WIDGETS_DIR = path.resolve(__dirname, '..', 'widgets');
console.error('Widget directory path:', WIDGETS_DIR);

// Widget configuration for Salesforce Chat
const salesforceChatWidget = {
  id: 'salesforce-chat',
  title: 'Salesforce Live Chat',
  templateUri: 'ui://widget/salesforce-chat.html',
  invoking: 'Connecting to Salesforce agent',
  invoked: 'Chat ready',
  html: '',
  responseText: 'Connected to Salesforce live agent. You can now chat directly with them in the interface above.'
};

// Load widget HTML
try {
  const htmlPath = path.join(WIDGETS_DIR, 'salesforce-chat.html');
  console.error('Attempting to load widget from:', htmlPath);
  console.error('Widget directory exists:', fs.existsSync(WIDGETS_DIR));
  console.error('Widget file exists:', fs.existsSync(htmlPath));
  
  if (fs.existsSync(htmlPath)) {
    salesforceChatWidget.html = fs.readFileSync(htmlPath, 'utf8');
    console.error('✓ Loaded Salesforce chat widget HTML (' + salesforceChatWidget.html.length + ' bytes)');
  } else {
    console.error('⚠ Warning: salesforce-chat.html not found at', htmlPath);
    console.error('Available files in WIDGETS_DIR:', fs.existsSync(WIDGETS_DIR) ? fs.readdirSync(WIDGETS_DIR) : 'DIR NOT FOUND');
  }
} catch (error) {
  console.error('⚠ Warning: Could not load widget HTML:', error);
}

// Widget metadata helpers - follows OpenAI Apps SDK spec
// https://developers.openai.com/apps-sdk/build/mcp-server/#content-security-policy-csp
function widgetDescriptorMeta(widget: typeof salesforceChatWidget) {
  return {
    'openai/outputTemplate': widget.templateUri,
    'openai/toolInvocation/invoking': widget.invoking,
    'openai/toolInvocation/invoked': widget.invoked,
    'openai/widgetAccessible': true,
    'openai/resultCanProduceWidget': true,
    // CSP - required for app submission
    'openai/widgetCSP': {
      connect_domains: [
        'https://miaw-mcp-server-6df009bc852c.herokuapp.com',
        'https://*.salesforce.com'
      ],
      resource_domains: [
        'https://miaw-mcp-server-6df009bc852c.herokuapp.com'
      ]
    },
    // Widget domain - required for app submission
    'openai/widgetDomain': 'miaw-mcp-server-6df009bc852c.herokuapp.com',
    // Widget description
    'openai/widgetDescription': 'Real-time chat interface for communicating with Salesforce live agents.'
  };
}

function widgetInvocationMeta(widget: typeof salesforceChatWidget) {
  return {
    'openai/toolInvocation/invoking': widget.invoking,
    'openai/toolInvocation/invoked': widget.invoked
  };
}

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
      platform: this.config.platform!
    };

    // NOTE: Salesforce MIAW API does NOT accept 'context' field
    // appName and clientVersion are for client-side tracking only, not sent to API
    
    // Only include captchaToken if provided
    if (captchaToken) {
      request.captchaToken = captchaToken;
    }

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
   * Per Salesforce MIAW API: DELETE /conversations/{conversationId}
   * https://developer.salesforce.com/docs/service/messaging-api/references/miaw-api-reference?meta=closeConversation
   */
  async closeConversation(conversationId: string): Promise<void> {
    console.error(`Closing conversation: ${conversationId}`);
    console.error(`DELETE URL: ${this.axiosInstance.defaults.baseURL}/conversations/${conversationId}`);
    try {
      await this.axiosInstance.delete(`/conversations/${conversationId}`);
      console.error('Conversation closed successfully');
    } catch (error: any) {
      console.error('Error closing conversation:', error.response?.status, error.response?.data || error.message);
      throw error;
    }
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
    console.error('Ending messaging session...');
    console.error(`DELETE URL: ${this.axiosInstance.defaults.baseURL}/messaging-session`);
    try {
      await this.axiosInstance.delete('/messaging-session');
      console.error('Messaging session ended successfully');
    } catch (error: any) {
      console.error('Error ending messaging session:', error.response?.status, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Close conversation and end session
   * Tries multiple approaches for MIAW API
   */
  async closeConversationAndSession(conversationId: string): Promise<void> {
    console.error(`Closing conversation and session for: ${conversationId}`);
    
    // Method 1: Send a ParticipantChanged entry to indicate user left
    // This is how MIAW tracks participant changes
    try {
      console.error('Method 1: POST ParticipantChanged entry (user left)...');
      const response = await this.axiosInstance.post(`/conversations/${conversationId}/entries`, {
        entryType: 'ParticipantChanged',
        entryPayload: {
          entries: [{
            participantChangeType: 'Left',
            displayName: 'Guest',
            role: 'EndUser'
          }]
        }
      });
      console.error('ParticipantChanged entry succeeded!', response.status);
      return;
    } catch (error: any) {
      console.error('ParticipantChanged entry failed:', error.response?.status, error.response?.data || error.message);
    }
    
    // Method 2: Send a RoutingResult entry with EndConversation
    try {
      console.error('Method 2: POST RoutingResult entry (EndConversation)...');
      const response = await this.axiosInstance.post(`/conversations/${conversationId}/entries`, {
        entryType: 'RoutingResult',
        entryPayload: {
          routingType: 'EndConversation'
        }
      });
      console.error('RoutingResult entry succeeded!', response.status);
      return;
    } catch (error: any) {
      console.error('RoutingResult entry failed:', error.response?.status, error.response?.data || error.message);
    }
    
    // Method 3: Send a system message indicating chat ended
    try {
      console.error('Method 3: Send system message (chat ended)...');
      await this.sendMessage(conversationId, {
        message: {
          messageType: 'StaticContentMessage',
          text: '[Chat ended by user]'
        }
      });
      console.error('System message sent!');
    } catch (error: any) {
      console.error('System message failed:', error.response?.status, error.response?.data || error.message);
    }
    
    // Method 4: Try DELETE endpoints anyway (might work in some configurations)
    try {
      console.error('Method 4: DELETE /messaging-session...');
      await this.endMessagingSession();
      console.error('endMessagingSession succeeded!');
    } catch (error: any) {
      console.error('endMessagingSession failed:', error.response?.status);
    }
    
    try {
      console.error('Method 5: DELETE /conversations/{id}...');
      await this.closeConversation(conversationId);
      console.error('closeConversation succeeded!');
    } catch (error: any) {
      console.error('closeConversation failed:', error.response?.status);
    }
    
    console.error('All close methods attempted');
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
          resources: {},
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
    // List resources (for widgets) - must be first
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: salesforceChatWidget.templateUri,
          name: salesforceChatWidget.title,
          description: `${salesforceChatWidget.title} widget markup`,
          mimeType: 'text/html+skybridge',
          _meta: widgetDescriptorMeta(salesforceChatWidget)
        }
      ]
    }));

    // Read resource (serve widget HTML)
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      console.error('ReadResource request received for:', request.params.uri);
      if (request.params.uri === salesforceChatWidget.templateUri) {
        if (!salesforceChatWidget.html) {
          throw new Error('Widget HTML not loaded. Check that widgets/salesforce-chat.html exists.');
        }
        console.error('Serving widget HTML (' + salesforceChatWidget.html.length + ' bytes)');
        return {
          contents: [
            {
              uri: salesforceChatWidget.templateUri,
              mimeType: 'text/html+skybridge',
              text: salesforceChatWidget.html,
              _meta: widgetDescriptorMeta(salesforceChatWidget)
            }
          ]
        };
      }
      throw new Error(`Unknown resource: ${request.params.uri}`);
    });

    // List resource templates
    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates: [
        {
          uriTemplate: salesforceChatWidget.templateUri,
          name: salesforceChatWidget.title,
          description: `${salesforceChatWidget.title} widget markup`,
          mimeType: 'text/html+skybridge',
          _meta: widgetDescriptorMeta(salesforceChatWidget)
        }
      ]
    }));

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
  ): Promise<{ content: Array<{ type: string; text: string }>; _meta?: any; structuredContent?: any }> {
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
        // Add explicit instruction to fetch greeting and start polling
        result = {
          ...convResult,
          _nextAction: 'MANDATORY: Wait 3 seconds, then call list_conversation_entries to get the agent\'s greeting. After displaying it, KEEP POLLING (call list_conversation_entries every 3 seconds) to display any additional agent messages until the user responds. Track message IDs to avoid duplicates.'
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
        // Add explicit instruction to fetch reply and resume polling
        result = {
          ...sendResult,
          _nextAction: 'MANDATORY: Wait 3-5 seconds, then call list_conversation_entries to get the agent\'s reply. After displaying it, KEEP POLLING (call list_conversation_entries every 3 seconds) to display any additional agent messages until the user responds again. Track message IDs to avoid duplicates.'
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
        
        // skipPolling=true: Widget requests - return immediately without waiting
        // skipPolling=false/undefined: ChatGPT requests - poll until valid message
        const shouldPoll = !args.skipPolling;
        
        const maxWaitTime = shouldPoll ? 25000 : 0; // 25 seconds for ChatGPT, 0 for widget
        const pollInterval = 500; // 500ms (0.5 seconds) - faster response!
        const startTime = Date.now();
        let entriesResult: any;
        let foundValidMessage = false;
        let mostRecentValidRole = '';
        let mostRecentValidSender = '';
        
        if (shouldPoll) {
          console.error('Polling for valid Chatbot/Agent message...');
        } else {
          console.error('Widget request - returning immediately (skipPolling=true)');
        }
        
        // Poll until the MOST RECENT message is from Chatbot or Agent (not EndUser)
        // Key: We need to wait for a response that's NEWER than the user's last message
        while (Date.now() - startTime < maxWaitTime || !entriesResult) {
          const pollStart = Date.now();
          
          entriesResult = await client.listConversationEntries(
            args.conversationId,
            args.continuationToken
          );
          
          const apiTime = Date.now() - pollStart;
          console.error(`API call took ${apiTime}ms`);
          
          // Salesforce returns conversationEntries (not entries)
          const allEntries: any[] = entriesResult.conversationEntries || entriesResult.entries || [];
          
          // Sort ALL messages by timestamp (newest first)
          const allMessages = allEntries
            .filter((e: any) => e.entryType === 'Message')
            .sort((a: any, b: any) => (b.transcriptedTimestamp || 0) - (a.transcriptedTimestamp || 0));
          
          // Get the ABSOLUTE most recent message (regardless of role)
          const absoluteMostRecent = allMessages[0];
          const absoluteRole = absoluteMostRecent?.sender?.role || '';
          const absoluteSender = absoluteMostRecent?.senderDisplayName || '';
          const absoluteText = absoluteMostRecent?.entryPayload?.abstractMessage?.staticContent?.text || '';
          const absoluteTimestamp = absoluteMostRecent?.transcriptedTimestamp || 0;
          
          console.error(`Absolute most recent: "${absoluteSender}" (role: ${absoluteRole}), ts: ${absoluteTimestamp}, text: "${absoluteText.substring(0, 50)}..."`);
          
          // Check if most recent is from Chatbot or Agent (a RESPONSE, not user's own message)
          const isSystemMessage = absoluteText.includes('One moment while I connect you') ||
                                  absoluteText.includes('connect you to the next available') ||
                                  absoluteText.includes('thanks for reaching out') ||
                                  absoluteText.includes('We will be with you shortly');
          const isAutomatedProcess = absoluteSender.includes('Automated Process');
          const isValidResponse = (absoluteRole === 'Chatbot' || absoluteRole === 'Agent') && 
                                  !isSystemMessage && !isAutomatedProcess;
          
          if (isValidResponse) {
            mostRecentValidRole = absoluteRole;
            mostRecentValidSender = absoluteSender;
            foundValidMessage = true;
            console.error(`Most recent is valid response from "${mostRecentValidSender}" (role: ${mostRecentValidRole}). Returning!`);
            break;
          }
          
          // If skipPolling (widget request), break after first attempt
          if (!shouldPoll) {
            console.error('Widget request - breaking after first fetch');
            // Still need to find most recent Chatbot/Agent for role info
            const validMsgs = allMessages.filter((e: any) => {
              const r = e.sender?.role || '';
              return r === 'Chatbot' || r === 'Agent';
            });
            if (validMsgs[0]) {
              mostRecentValidRole = validMsgs[0].sender?.role || '';
              mostRecentValidSender = validMsgs[0].senderDisplayName || '';
              foundValidMessage = true;
            }
            break;
          }
          
          console.error(`Most recent is ${absoluteRole} (not Chatbot/Agent). Waiting for response...`);
          
          const elapsed = Date.now() - startTime;
          if (elapsed < maxWaitTime) {
            console.error(`Polling again in ${pollInterval}ms... (${Math.floor(elapsed/1000)}s elapsed)`);
            await new Promise(resolve => setTimeout(resolve, pollInterval));
          }
        }
        
        if (!foundValidMessage && shouldPoll) {
          console.error('Timeout (25s). No valid Chatbot/Agent message found.');
        }
        
        // Get role info from most recent RESPONSE message (Chatbot/Agent only, not EndUser)
        // Salesforce returns conversationEntries (not entries)
        const allEntriesForRole: any[] = entriesResult.conversationEntries || entriesResult.entries || [];
        const responseMessages = allEntriesForRole
          .filter((e: any) => e.entryType === 'Message')
          .filter((e: any) => {
            const sender = e.senderDisplayName || '';
            const role = e.sender?.role || '';
            const messageReason = e.entryPayload?.messageReason || '';
            const messageText = e.entryPayload?.abstractMessage?.staticContent?.text || '';
            
            // Same strict filtering as polling
            const isSystemRole = role === 'System' || role === '' || !role;
            const isAutomatedProcess = sender.includes('Automated Process');
            const isAutomatedResponse = messageReason === 'AutomatedResponse';
            const isSystemMessage = messageText.includes('One moment while I connect you') ||
                                    messageText.includes('connect you to the next available') ||
                                    messageText.includes('thanks for reaching out') ||
                                    messageText.includes('We will be with you shortly');
            // Only Chatbot/Agent - not EndUser
            const isResponseRole = role === 'Chatbot' || role === 'Agent';
            
            return isResponseRole && !isSystemRole && !isAutomatedProcess && !isAutomatedResponse && !isSystemMessage;
          })
          .sort((a: any, b: any) => (b.transcriptedTimestamp || 0) - (a.transcriptedTimestamp || 0));
        
        const mostRecentResponse = responseMessages[0];
        const senderRole = mostRecentResponse?.sender?.role || mostRecentResponse?.senderRole || 'Unknown';
        const senderDisplayName = mostRecentResponse?.senderDisplayName || 'Unknown';
        
        console.error(`Most recent Chatbot/Agent response from: ${senderDisplayName} (role: ${senderRole})`);
        
        // Add role info to help ChatGPT decide whether to show chat widget
        // isLiveAgent is TRUE only when role is "Agent" (not Chatbot, not System)
        const isLiveAgent = senderRole === 'Agent';
        
        // Filter entries to ONLY include Chatbot/Agent messages - NO EndUser, NO System
        const allRawEntries = entriesResult.conversationEntries || entriesResult.entries || [];
        const filteredEntries = allRawEntries.filter((e: any) => {
          if (e.entryType !== 'Message') return false; // ONLY keep Message entries for ChatGPT
          const sender = e.senderDisplayName || '';
          const role = e.sender?.role || '';
          const messageReason = e.entryPayload?.messageReason || e.messageReason || '';
          const messageText = e.entryPayload?.abstractMessage?.staticContent?.text || '';
          
          // REJECT LIST: System role, EndUser, Automated Process, AutomatedResponse, known system messages
          const isSystemRole = role === 'System' || role === '' || !role;
          const isEndUser = role === 'EndUser'; // Don't show user's own messages back to them
          const isAutomatedProcess = sender.includes('Automated Process') || sender.includes('automated');
          const isAutomatedResponse = messageReason === 'AutomatedResponse';
          const isSystemMessage = messageText.includes('One moment while I connect you') ||
                                  messageText.includes('connect you to the next available') ||
                                  messageText.includes('thanks for reaching out') ||
                                  messageText.includes('We will be with you shortly');
          
          // ONLY accept Chatbot or Agent - NOT EndUser (user's own messages)
          const isResponseRole = role === 'Chatbot' || role === 'Agent';
          
          const shouldReject = isSystemRole || isEndUser || isAutomatedProcess || isAutomatedResponse || isSystemMessage || !isResponseRole;
          
          console.error(`Filter: sender="${sender}", role="${role}", REJECT=${shouldReject}`);
          return !shouldReject;
        });
        
        // Check for conversation close events
        const closeEvents = allRawEntries.filter((e: any) => 
          e.entryType === 'ConversationClose' || 
          (e.entryType === 'RoutingResult' && e.entryPayload?.routingType === 'EndConversation') ||
          (e.entryType === 'ParticipantChanged' && e.entryPayload?.participantChangeType === 'Left')
        );
        const conversationEnded = closeEvents.length > 0;
        
        if (conversationEnded) {
          console.error('Conversation has been closed');
        }
        
        // Return filtered entries for ChatGPT, but include _rawEntries for widget
        result = {
          entries: filteredEntries, // Return ONLY filtered messages for ChatGPT
          _rawEntries: allRawEntries, // Include raw entries for widget to detect close events
          continuationToken: entriesResult.continuationToken,
          _roleInfo: {
            mostRecentSenderRole: senderRole,
            mostRecentSenderName: senderDisplayName,
            isLiveAgent: isLiveAgent,
            conversationEnded: conversationEnded,
            // Include sessionId/conversationId so ChatGPT can pass them to show_salesforce_chat
            sessionIdToUse: args.sessionId,
            conversationIdToUse: args.conversationId,
            instruction: conversationEnded
              ? `The conversation has ended.`
              : isLiveAgent 
                ? `LIVE AGENT DETECTED! Call show_salesforce_chat NOW with: sessionId="${args.sessionId}", conversationId="${args.conversationId}", agentName="${senderDisplayName}". DO NOT display messages yourself - the chat widget will show them.`
                : !foundValidMessage || senderRole === 'Unknown' 
                  ? `Still waiting for Chatbot/Agent response. Call list_conversation_entries again to poll.`
                  : `VERBATIM ONLY: Reply with EXACTLY the most recent Chatbot/Agent message text. No commentary.`
          }
        };
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
        console.error('close_conversation called with:', { sessionId: args.sessionId, conversationId: args.conversationId });
        if (args.sessionId) {
          const session = sessions.get(args.sessionId);
          if (!session) {
            console.error('Session not found in sessions map. Available sessions:', Array.from(sessions.keys()));
            // Try to proceed anyway - the session might have been cleared but we still have valid auth
          } else {
            console.error('Found session, setting access token');
            client.setAccessToken(session.accessToken);
          }
        } else {
          console.error('No sessionId provided!');
        }
        try {
          // Try the combined approach - close conversation AND end messaging session
          await client.closeConversationAndSession(args.conversationId);
          result = { success: true, message: 'Conversation closed' };
        } catch (error: any) {
          console.error('closeConversationAndSession error:', error.response?.status, error.response?.data);
          // Return success anyway - we tried our best
          result = { success: true, message: 'Chat ended (cleanup attempted)' };
        }
        break;

      case 'show_salesforce_chat':
        if (args.sessionId) {
          const session = sessions.get(args.sessionId);
          if (!session) {
            throw new Error('Invalid sessionId. Please generate a new session first.');
          }
          client.setAccessToken(session.accessToken);
        }
        
        // Get current conversation entries to pass to the widget
        const chatEntries: any = await client.listConversationEntries(args.conversationId);
        // Salesforce returns conversationEntries (not entries)
        const rawChatEntries = chatEntries.conversationEntries || chatEntries.entries || [];
        const allMessages = rawChatEntries
          .filter((e: any) => e.entryType === 'Message')
          .filter((e: any) => {
            const sender = e.senderDisplayName || '';
            const role = e.sender?.role || '';
            const messageReason = e.entryPayload?.messageReason || '';
            const messageText = e.entryPayload?.abstractMessage?.staticContent?.text || '';
            
            // Same strict filtering
            const isSystemRole = role === 'System' || role === '' || !role;
            const isAutomatedProcess = sender.includes('Automated Process');
            const isAutomatedResponse = messageReason === 'AutomatedResponse';
            const isSystemMessage = messageText.includes('One moment while I connect you') ||
                                    messageText.includes('connect you to the next available') ||
                                    messageText.includes('thanks for reaching out') ||
                                    messageText.includes('We will be with you shortly');
            const isValidRole = role === 'Chatbot' || role === 'Agent' || role === 'EndUser';
            
            return isValidRole && !isSystemRole && !isAutomatedProcess && !isAutomatedResponse && !isSystemMessage;
          })
          .sort((a: any, b: any) => (a.transcriptedTimestamp || 0) - (b.transcriptedTimestamp || 0))
          .map((e: any) => ({
            sender: e.senderDisplayName || 'Agent',
            senderType: e.senderRole,
            senderName: e.senderDisplayName || 'Agent',
            text: e.messageContent?.staticContent?.text || '',
            timestamp: e.transcriptedTimestamp || Date.now()
          }));
        
        // Return widget with structured content for the embedded UI
        return {
          content: [
            {
              type: 'text',
              text: salesforceChatWidget.responseText
            }
          ],
          structuredContent: {
            sessionId: args.sessionId,
            conversationId: args.conversationId,
            serverUrl: process.env.SERVER_URL || 'https://miaw-mcp-server-6df009bc852c.herokuapp.com',
            agentName: args.agentName || 'Salesforce Agent',
            messages: allMessages
          },
          _meta: widgetInvocationMeta(salesforceChatWidget)
        };

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
      ],
      _meta: {
        'openai/toolInvocation/invoking': 'Talking to Salesforce',
        'openai/toolInvocation/invoked': 'Salesforce responded'
      }
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
          resources: {},
          tools: {},
        },
      }
    );

    // Setup handlers for this instance - resources first
    // List resources (for widgets)
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: salesforceChatWidget.templateUri,
          name: salesforceChatWidget.title,
          description: `${salesforceChatWidget.title} widget markup`,
          mimeType: 'text/html+skybridge',
          _meta: widgetDescriptorMeta(salesforceChatWidget)
        }
      ]
    }));

    // Read resource (serve widget HTML)
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      console.error('SSE ReadResource request received for:', request.params.uri);
      if (request.params.uri === salesforceChatWidget.templateUri) {
        if (!salesforceChatWidget.html) {
          throw new Error('Widget HTML not loaded. Check that widgets/salesforce-chat.html exists.');
        }
        console.error('SSE Serving widget HTML (' + salesforceChatWidget.html.length + ' bytes)');
        return {
          contents: [
            {
              uri: salesforceChatWidget.templateUri,
              mimeType: 'text/html+skybridge',
              text: salesforceChatWidget.html,
              _meta: widgetDescriptorMeta(salesforceChatWidget)
            }
          ]
        };
      }
      throw new Error(`Unknown resource: ${request.params.uri}`);
    });

    // List resource templates
    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates: [
        {
          uriTemplate: salesforceChatWidget.templateUri,
          name: salesforceChatWidget.title,
          description: `${salesforceChatWidget.title} widget markup`,
          mimeType: 'text/html+skybridge',
          _meta: widgetDescriptorMeta(salesforceChatWidget)
        }
      ]
    }));

    // List tools
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    // Handle tool calls
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
        api_endpoints: '/api/*',
        health_check: '/health',
        openapi_schema: '/openapi-schema.json',
        documentation: 'https://github.com/your-repo/miaw-mcp-server'
      });
    });

    // Serve OpenAPI schema for ChatGPT Actions
    app.get('/openapi-schema.json', (_req, res) => {
      res.sendFile('openapi-schema.json', { root: process.cwd() });
    });

    // Privacy policy endpoint
    app.get('/privacy-policy', (_req, res) => {
      res.type('html').send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Privacy Policy - MIAW MCP Server</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; }
        h1 { color: #0066cc; border-bottom: 2px solid #0066cc; padding-bottom: 10px; }
        h2 { color: #0066cc; margin-top: 30px; }
        h3 { color: #555; }
        code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-family: 'Courier New', monospace; }
        pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; }
        .highlight { background: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 20px 0; }
        .updated { color: #666; font-style: italic; }
    </style>
</head>
<body>
    <h1>Privacy Policy for MIAW MCP Server</h1>
    <p class="updated"><strong>Last Updated:</strong> January 2025</p>

    <h2>Overview</h2>
    <p>This service provides an integration between ChatGPT and Salesforce Enhanced Chat (MIAW) API to facilitate messaging sessions with Salesforce agents.</p>

    <h2>Information We Collect</h2>
    <h3>Session Data</h3>
    <ul>
        <li><strong>Session IDs:</strong> Temporary identifiers generated to manage your messaging session</li>
        <li><strong>Conversation IDs:</strong> Identifiers for your chat conversations with Salesforce agents</li>
        <li><strong>Messages:</strong> Text messages you send and receive during conversations</li>
    </ul>

    <h3>Technical Data</h3>
    <ul>
        <li><strong>API Requests:</strong> Standard HTTP request data (timestamps, endpoints accessed)</li>
        <li><strong>Server Logs:</strong> Basic request logging for debugging and monitoring</li>
    </ul>

    <h2>How We Use Your Information</h2>
    <ul>
        <li><strong>Session Management:</strong> To maintain your connection and conversation state</li>
        <li><strong>Message Delivery:</strong> To relay messages between you and Salesforce agents</li>
        <li><strong>Service Operation:</strong> To ensure the API functions correctly</li>
    </ul>

    <h2>Data Storage and Retention</h2>
    <div class="highlight">
        <strong>Important:</strong> All data is stored <strong>in-memory only</strong> and is <strong>never persisted to disk</strong>.
    </div>
    <ul>
        <li><strong>Temporary Storage:</strong> All session data (session IDs, access tokens, conversation IDs) is stored in-memory only</li>
        <li><strong>Automatic Deletion:</strong> All data is automatically deleted when the session expires, the server restarts, or the conversation is closed</li>
        <li><strong>No Persistent Storage:</strong> We do NOT store any data in databases or permanent storage</li>
        <li><strong>Message Content:</strong> Messages are transmitted through our server but are NOT stored permanently</li>
    </ul>

    <h2>Data Sharing</h2>
    <ul>
        <li><strong>Salesforce:</strong> Messages and session data are transmitted to Salesforce MIAW API to facilitate agent conversations</li>
        <li><strong>No Third Parties:</strong> We do not share your data with any other third parties</li>
        <li><strong>No Analytics:</strong> We do not use analytics or tracking services</li>
    </ul>

    <h2>Security</h2>
    <ul>
        <li><strong>HTTPS:</strong> All connections use HTTPS encryption</li>
        <li><strong>Token Management:</strong> Access tokens are managed server-side and never exposed to the client</li>
        <li><strong>Server-Side Sessions:</strong> Sensitive authentication data is stored server-side, not client-side</li>
    </ul>

    <h2>Your Rights</h2>
    <ul>
        <li><strong>Access:</strong> You can view your messages during active conversations</li>
        <li><strong>Deletion:</strong> Close your conversation to remove session data</li>
        <li><strong>Control:</strong> You control what information you share during conversations</li>
    </ul>

    <h2>Data Controller</h2>
    <p>This service acts as a <strong>data processor</strong> on behalf of:</p>
    <ul>
        <li><strong>Your Organization:</strong> The Salesforce organization you're connecting to</li>
        <li><strong>Salesforce:</strong> The ultimate data controller for MIAW conversations</li>
    </ul>

    <h2>Cookies</h2>
    <p>This service does not use cookies.</p>

    <h2>Children's Privacy</h2>
    <p>This service is not intended for use by children under 13 years of age.</p>

    <h2>Changes to This Policy</h2>
    <p>We may update this privacy policy from time to time. Updates will be reflected in the "Last Updated" date.</p>

    <h2>Contact</h2>
    <p>For questions about this privacy policy or data handling practices, please contact your Salesforce administrator.</p>

    <h2>Compliance</h2>
    <p>This service processes data in accordance with:</p>
    <ul>
        <li>Salesforce's MIAW API Terms of Service</li>
        <li>Your organization's Salesforce agreement</li>
        <li>Applicable data protection laws</li>
    </ul>

    <h2>Technical Details</h2>
    <h3>What We Store (Temporarily, In-Memory Only):</h3>
    <pre><code>{
  "sessionId": "random-generated-id",
  "accessToken": "jwt-token-from-salesforce",
  "conversationId": "uuid-for-conversation"
}</code></pre>

    <h3>What We Don't Store:</h3>
    <ul>
        <li>Message history beyond active transmission</li>
        <li>User profiles or personal information</li>
        <li>Persistent conversation logs</li>
        <li>Analytics or usage data</li>
    </ul>

    <h3>Data Flow:</h3>
    <p>You → ChatGPT/Custom GPT → This Server → Salesforce MIAW API → This Server → ChatGPT/Custom GPT → You</p>
    <p>All data transmission is encrypted via HTTPS.</p>

    <div class="highlight">
        <strong>Important:</strong> This server is a technical integration layer. The actual data storage and retention policies are governed by your Salesforce organization's settings and Salesforce's terms of service.
    </div>
</body>
</html>
      `);
    });

    // Thin REST API wrappers for ChatGPT Actions - reuses MCP tool handler logic
    // Helper to call MCP tool handler and unwrap JSON-RPC response
    const callMCPToolHandler = async (toolName: string, args: any) => {
      const client = this.initializeClient();
      const mcpResponse = await this.handleToolCall(client, toolName, args);
      // Unwrap the MCP response format: { content: [{ type: 'text', text: '...' }] }
      const resultText = mcpResponse.content[0].text;
      const result = JSON.parse(resultText);
      // Include _meta field if present (for OpenAI Custom GPT Actions)
      if (mcpResponse._meta) {
        result._meta = mcpResponse._meta;
      }
      return result;
    };

    // REST API endpoints - thin wrappers that call existing MCP tool handlers
    app.post('/api/generate-session', async (req, res) => {
      try {
        const result = await callMCPToolHandler('generate_guest_access_token', req.body || {});
        res.json(result);
      } catch (error: any) {
        console.error('Error in /api/generate-session:', error);
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/create-conversation', async (req, res) => {
      try {
        const result = await callMCPToolHandler('create_conversation', req.body);
        res.json(result);
      } catch (error: any) {
        console.error('Error in /api/create-conversation:', error);
        res.status(error.response?.status || 500).json({ error: error.message });
      }
    });

    app.post('/api/send-message', async (req, res) => {
      try {
        const result = await callMCPToolHandler('send_message', req.body);
        res.json(result);
      } catch (error: any) {
        console.error('Error in /api/send-message:', error);
        res.status(error.response?.status || 500).json({ error: error.message });
      }
    });

    app.post('/api/list-conversation-entries', async (req, res) => {
      try {
        const result = await callMCPToolHandler('list_conversation_entries', req.body);
        res.json(result);
      } catch (error: any) {
        console.error('Error in /api/list-conversation-entries:', error);
        res.status(error.response?.status || 500).json({ error: error.message });
      }
    });

    app.post('/api/get-conversation-status', async (req, res) => {
      try {
        const result = await callMCPToolHandler('get_conversation_routing_status', req.body);
        res.json(result);
      } catch (error: any) {
        console.error('Error in /api/get-conversation-status:', error);
        res.status(error.response?.status || 500).json({ error: error.message });
      }
    });

    app.post('/api/close-conversation', async (req, res) => {
      try {
        const result = await callMCPToolHandler('close_conversation', req.body);
        res.json(result);
      } catch (error: any) {
        console.error('Error in /api/close-conversation:', error);
        res.status(error.response?.status || 500).json({ error: error.message });
      }
    });

    // Store active MCP server instances and transports (following Pizzaz pattern)
    const mcpSessions = new Map<string, { server: Server; transport: SSEServerTransport }>();

    // MCP endpoint - GET establishes SSE connection (ChatGPT connector)
    app.get('/mcp', async (req, res) => {
      console.error(`MCP GET (SSE) request from ${req.ip || 'unknown'}`);
      console.error(`User-Agent: ${req.headers['user-agent'] || 'unknown'}`);
      
      try {
        // Create a new server instance for this session
        const serverInstance = this.createServerInstance();
        
        // Create SSE transport - first param is the POST message endpoint path
        const transport = new SSEServerTransport('/mcp/messages', res);
        const sessionId = transport.sessionId; // Transport generates its own session ID
        
        // Store both server and transport (needed for POST message handling)
        mcpSessions.set(sessionId, { server: serverInstance, transport });
        
        console.error(`Session ${sessionId}: Connecting MCP server instance...`);
        
        // Set up transport event handlers
        transport.onclose = async () => {
          console.error(`Session ${sessionId}: Transport closed`);
          mcpSessions.delete(sessionId);
          // Don't call server.close() here to avoid circular reference
        };

        transport.onerror = (error: any) => {
          console.error(`Session ${sessionId}: Transport error:`, error);
        };
        
        // Connect server to transport
        await serverInstance.connect(transport);
        console.error(`Session ${sessionId}: MCP server connected successfully`);
        
      } catch (error) {
        console.error('Error establishing SSE connection:', error);
        if (!res.headersSent) {
          res.status(500).send('Failed to establish SSE connection');
        }
      }
    });

    // POST /mcp/messages - handles SSE messages from ChatGPT (following Pizzaz pattern)
    app.post('/mcp/messages', async (req, res) => {
      const sessionId = req.query.sessionId as string;
      
      console.error(`MCP POST message for session: ${sessionId}`);
      
      if (!sessionId) {
        return res.status(400).send('Missing sessionId query parameter');
      }
      
      const session = mcpSessions.get(sessionId);
      
      if (!session) {
        console.error(`Session ${sessionId} not found. Active sessions:`, Array.from(mcpSessions.keys()));
        return res.status(404).send('Unknown session');
      }
      
      try {
        // Let the transport handle the POST message
        await session.transport.handlePostMessage(req, res);
      } catch (error) {
        console.error(`Failed to process message for session ${sessionId}:`, error);
        if (!res.headersSent) {
          res.status(500).send('Failed to process message');
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
                version: '1.0.0',
                instructions: 'CRITICAL RULES: 1) Reply VERBATIM with Chatbot messages - no commentary. 2) ONLY call show_salesforce_chat when _roleInfo.isLiveAgent=true AND mostRecentSenderRole="Agent". NEVER call it for Chatbot messages. The chat widget is ONLY for human agents, not AI chatbots.'
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

          case 'resources/list':
            result = {
              resources: [
                {
                  uri: salesforceChatWidget.templateUri,
                  name: salesforceChatWidget.title,
                  description: `${salesforceChatWidget.title} widget markup`,
                  mimeType: 'text/html+skybridge',
                  _meta: widgetDescriptorMeta(salesforceChatWidget)
                }
              ]
            };
            break;

          case 'resources/read':
            const resourceUri = jsonrpcRequest.params?.uri;
            console.error('POST /mcp resources/read request for:', resourceUri);
            
            if (resourceUri === salesforceChatWidget.templateUri) {
              if (!salesforceChatWidget.html) {
                throw new Error('Widget HTML not loaded');
              }
              console.error('Returning widget HTML (' + salesforceChatWidget.html.length + ' bytes)');
              result = {
                contents: [
                  {
                    uri: salesforceChatWidget.templateUri,
                    mimeType: 'text/html+skybridge',
                    text: salesforceChatWidget.html,
                    _meta: widgetDescriptorMeta(salesforceChatWidget)
                  }
                ]
              };
            } else {
              throw new Error(`Unknown resource: ${resourceUri}`);
            }
            break;

          case 'resources/templates/list':
            result = {
              resourceTemplates: [
                {
                  uriTemplate: salesforceChatWidget.templateUri,
                  name: salesforceChatWidget.title,
                  description: `${salesforceChatWidget.title} widget markup`,
                  mimeType: 'text/html+skybridge',
                  _meta: widgetDescriptorMeta(salesforceChatWidget)
                }
              ]
            };
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

