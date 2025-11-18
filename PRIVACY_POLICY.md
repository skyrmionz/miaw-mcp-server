# Privacy Policy for MIAW MCP Server

**Last Updated:** January 2025

## Overview

This service provides an integration between ChatGPT and Salesforce Enhanced Chat (MIAW) API to facilitate messaging sessions with Salesforce agents.

## Information We Collect

### Session Data
- **Session IDs**: Temporary identifiers generated to manage your messaging session
- **Conversation IDs**: Identifiers for your chat conversations with Salesforce agents
- **Messages**: Text messages you send and receive during conversations

### Technical Data
- **API Requests**: Standard HTTP request data (timestamps, endpoints accessed)
- **Server Logs**: Basic request logging for debugging and monitoring

## How We Use Your Information

- **Session Management**: To maintain your connection and conversation state
- **Message Delivery**: To relay messages between you and Salesforce agents
- **Service Operation**: To ensure the API functions correctly

## Data Storage and Retention

- **Temporary Storage**: All session data (session IDs, access tokens, conversation IDs) is stored **in-memory only**
- **Automatic Deletion**: All data is automatically deleted when:
  - The session expires
  - The server restarts
  - The conversation is closed
- **No Persistent Storage**: We do NOT store any data in databases or permanent storage
- **Message Content**: Messages are transmitted through our server but are NOT stored permanently

## Data Sharing

- **Salesforce**: Messages and session data are transmitted to Salesforce MIAW API to facilitate agent conversations
- **No Third Parties**: We do not share your data with any other third parties
- **No Analytics**: We do not use analytics or tracking services

## Security

- **HTTPS**: All connections use HTTPS encryption
- **Token Management**: Access tokens are managed server-side and never exposed to the client
- **Server-Side Sessions**: Sensitive authentication data is stored server-side, not client-side

## Your Rights

- **Access**: You can view your messages during active conversations
- **Deletion**: Close your conversation to remove session data
- **Control**: You control what information you share during conversations

## Data Controller

This service acts as a **data processor** on behalf of:
- **Your Organization**: The Salesforce organization you're connecting to
- **Salesforce**: The ultimate data controller for MIAW conversations

## Cookies

This service does not use cookies.

## Children's Privacy

This service is not intended for use by children under 13 years of age.

## Changes to This Policy

We may update this privacy policy from time to time. Updates will be reflected in the "Last Updated" date.

## Contact

For questions about this privacy policy or data handling practices, please contact your Salesforce administrator.

## Compliance

This service processes data in accordance with:
- Salesforce's MIAW API Terms of Service
- Your organization's Salesforce agreement
- Applicable data protection laws

## Technical Details

### What We Store (Temporarily, In-Memory Only):
```
{
  "sessionId": "random-generated-id",
  "accessToken": "jwt-token-from-salesforce",
  "conversationId": "uuid-for-conversation"
}
```

### What We Don't Store:
- Message history beyond active transmission
- User profiles or personal information
- Persistent conversation logs
- Analytics or usage data

### Data Flow:
1. You → ChatGPT/Custom GPT → This Server → Salesforce MIAW API
2. Salesforce MIAW API → This Server → ChatGPT/Custom GPT → You

All data transmission is encrypted via HTTPS.

---

**Important**: This server is a technical integration layer. The actual data storage and retention policies are governed by your Salesforce organization's settings and Salesforce's terms of service.

