# Custom GPT Setup Guide

This guide explains how to add Salesforce MIAW messaging capabilities to your Custom GPT using Actions.

## Overview

Your MCP server now provides **two integration methods**:

1. **MCP Connector** (ChatGPT Plus) - Uses `/mcp` endpoint
2. **Custom GPT Actions** (NEW) - Uses REST API endpoints at `/api/*`

Both integrations work independently and don't affect each other.

---

## Setting Up Custom GPT Actions

### Step 1: Create or Edit Your Custom GPT

1. Go to [ChatGPT](https://chatgpt.com)
2. Click your profile → **My GPTs**
3. Click **Create a GPT** (or edit an existing one)
4. Go to the **Configure** tab

### Step 2: Add the Schema URL

1. Scroll down to **Actions** section
2. Click **Create new action**
3. In the **Schema** field, enter this URL:

```
https://miaw-mcp-server-6df009bc852c.herokuapp.com/openapi-schema.json
```

4. Click **Import**

**Note:** The schema includes a privacy policy URL that ChatGPT will automatically recognize. If prompted for a privacy policy, it's already configured at:
```
https://miaw-mcp-server-6df009bc852c.herokuapp.com/privacy-policy
```

### Step 3: Configure the Actions

After importing, you should see 6 actions:
- `generateSession` - Start a new messaging session
- `createConversation` - Connect to a Salesforce agent
- `sendMessage` - Send a message to the agent
- `listConversationEntries` - Retrieve agent messages
- `getConversationStatus` - Check conversation status
- `closeConversation` - End the chat session

### Step 4: Add Instructions to Your GPT

In the **Instructions** section of your Custom GPT, add behavior guidelines:

```
When a user needs help beyond your capabilities:

1. Call generateSession to start a session
2. Call createConversation to connect with a Salesforce agent
3. Wait 3 seconds, then call listConversationEntries repeatedly until you see a message where senderDisplayName contains "Agent" (ignore "Automated Process")
4. Display the agent's message verbatim as if YOU are saying it (no attribution like "The agent said...")
5. After displaying any agent message, keep calling listConversationEntries every 3 seconds to check for more messages
6. Only stop polling when the user sends a new message
7. When user responds, call sendMessage with their text
8. Resume polling for agent replies

CRITICAL MESSAGING RULES:

When you receive messages from list_conversation_entries:
1. Extract ONLY the message text from the most recent entry
2. Reply to the user with EXACTLY that text - NOTHING ELSE
3. Do NOT add "Selena replied:", "The agent said:", or ANY prefix
4. Do NOT add follow-up questions, commentary, or instructions
5. Present the message AS IF you are speaking those words directly

WRONG: "Selena replied: 'Hello' - go ahead and respond!"
RIGHT: "Hello"

Exception: On agent transfer (ParticipantChanged event), announce "Transferring you to [name]" then show their greeting only.

You ARE the messenger. Their words become YOUR words. No meta-commentary.
```

### Step 5: Test Your GPT

1. Save your Custom GPT
2. Test it by asking: "I need help from a Salesforce agent"
3. The GPT should:
   - Create a session
   - Connect to an agent
   - Display the agent's greeting
   - Facilitate a seamless conversation

---

## API Endpoints Reference

All endpoints are available at:
```
https://miaw-mcp-server-6df009bc852c.herokuapp.com/api/*
```

### Available Endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/generate-session` | POST | Create a new guest session |
| `/api/create-conversation` | POST | Start a conversation with an agent |
| `/api/send-message` | POST | Send a message to the agent |
| `/api/list-conversation-entries` | POST | Get messages from the conversation |
| `/api/get-conversation-status` | POST | Check conversation routing status |
| `/api/close-conversation` | POST | End the conversation |

---

## How It Works

### Session Management

The server handles session tokens internally:
- You get a simple `sessionId` from `generateSession`
- Pass this `sessionId` to all subsequent API calls
- The server manages the JWT access token behind the scenes
- This prevents ChatGPT moderation issues

### Polling Behavior

The OpenAPI schema includes instructions for ChatGPT to:
- Automatically fetch the initial agent greeting after creating a conversation
- Continuously poll for new agent messages
- Display messages as they arrive
- Only stop polling when the user sends a new message

### Message Filtering

The schema instructs ChatGPT to:
- Filter for messages where `senderDisplayName` contains "Agent"
- Ignore "Automated Process" system messages
- Display agent messages verbatim without attribution

---

## Troubleshooting

### Action Import Fails
- Verify the schema URL is accessible: https://miaw-mcp-server-6df009bc852c.herokuapp.com/openapi-schema.json
- Check your Heroku app is running: https://miaw-mcp-server-6df009bc852c.herokuapp.com/health

### GPT Doesn't Poll for Messages
- Review your GPT instructions
- Make sure the polling behavior is explicitly stated
- The OpenAPI schema already includes polling instructions in the operation descriptions

### Authentication Errors
- Ensure environment variables are set in Heroku:
  - `MIAW_BASE_URL`
  - `MIAW_ORG_ID`
  - `MIAW_ES_DEVELOPER_NAME`

### GPT Says "Connected" Instead of Showing Agent Greeting
- This means it's not following the polling instructions
- Add more explicit instructions in the GPT configuration
- Emphasize that it MUST call `listConversationEntries` after creating a conversation

---

## Comparison: MCP Connector vs Custom GPT Actions

| Feature | MCP Connector | Custom GPT Actions |
|---------|---------------|-------------------|
| **Setup** | Add server URL to ChatGPT settings | Import OpenAPI schema to Custom GPT |
| **Endpoint** | `/mcp` (JSON-RPC) | `/api/*` (REST) |
| **Use Case** | Research/tools in regular ChatGPT | Specific GPT with defined behavior |
| **Polling** | Relies on tool descriptions | Relies on operation descriptions + instructions |
| **Session Management** | Server-side | Server-side |
| **Best For** | General ChatGPT usage | Custom GPT with specific persona/workflow |

---

## Next Steps

1. ✅ Your server is deployed and ready
2. ✅ REST API endpoints are live at `/api/*`
3. ✅ OpenAPI schema is available at `/openapi-schema.json`
4. 📝 Import the schema into your Custom GPT
5. 📝 Add polling instructions to your GPT
6. 🎯 Test the conversation flow

---

## Support

- **Server Info**: https://miaw-mcp-server-6df009bc852c.herokuapp.com/
- **Health Check**: https://miaw-mcp-server-6df009bc852c.herokuapp.com/health
- **OpenAPI Schema**: https://miaw-mcp-server-6df009bc852c.herokuapp.com/openapi-schema.json
- **Privacy Policy**: https://miaw-mcp-server-6df009bc852c.herokuapp.com/privacy-policy

Both MCP and REST API integrations are fully functional and don't interfere with each other!

