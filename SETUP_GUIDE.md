# Step-by-Step Setup Guide

This guide walks you through setting up the MIAW MCP Server for ChatGPT integration from scratch.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Salesforce Configuration](#salesforce-configuration)
3. [Deploy to Heroku](#deploy-to-heroku)
4. [ChatGPT Integration](#chatgpt-integration)
5. [Testing](#testing)
6. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Accounts

- ✅ **Salesforce Org** with Service Cloud
  - Enhanced Chat (MIAW) enabled
  - Agentforce or human agents configured
  - Admin access to configure Embedded Service Deployments

- ✅ **Heroku Account** (free tier works)
  - Sign up at [heroku.com](https://heroku.com)
  - Credit card required (for identity verification, free tier has no charges)

- ✅ **ChatGPT Plus or Team** ($20/month)
  - For MCP Connectors: Developer Mode enabled
  - For Custom GPT: Ability to create custom GPTs

### Required Tools (for manual deployment)

- ✅ **Git** - [Download](https://git-scm.com/downloads)
- ✅ **Heroku CLI** - [Download](https://devcenter.heroku.com/articles/heroku-cli)
- ✅ **Node.js 18+** (optional, for local testing) - [Download](https://nodejs.org/)

---

## Salesforce Configuration

### Step 1: Enable Enhanced Chat

1. Go to **Setup** → Search for "Embedded Service Deployments"
2. If you don't have one, click **New Deployment**
3. Choose **Messaging for In-App and Web**
4. Complete the setup wizard:
   - Name your deployment (e.g., "ChatGPT Handoff")
   - Configure your routing (queues, skills, etc.)
   - Set up agent availability
   - Customize messaging appearance (optional)

### Step 2: Get Your SCRT URL

1. In **Setup** → **Embedded Service Deployments**
2. Click on your deployment name
3. Click **View** button next to the deployment
4. Look for the code snippet - find the base URL
5. Copy the URL that looks like:
   ```
   https://scrt01.uengage1.sfdc-yfeipo.svc.sfdcfc.net
   ```
6. **Save this URL** - you'll need it for Heroku

### Step 3: Get Your Developer Name

1. In **Setup** → **Embedded Service Deployments**
2. Look at the **API Name** column for your deployment
3. Example: `Target_Messaging_for_In_App_and_Web`
4. **Save this name** - you'll need it for Heroku

### Step 4: Get Your Organization ID

1. In **Setup** → Search for "Company Information"
2. Copy the **Organization ID**
3. Format: `00D` followed by 15 characters
4. Example: `00DHu000000p8j3R`
5. **Save this ID** - you'll need it for Heroku

---

## Deploy to Heroku

### Option A: One-Click Deploy (Easiest)

1. Click this button:
   
   [![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy)

2. Fill in the required environment variables:
   - **MIAW_SCRT_URL**: Your SCRT URL from Step 2
   - **MIAW_ES_DEVELOPER_NAME**: Your API Name from Step 3
   - **MIAW_ORG_ID**: Your Organization ID from Step 4

3. Click **Deploy app**

4. Wait 2-3 minutes for deployment

5. Click **View app** - you should see:
   ```json
   {
     "status": "ok",
     "message": "MIAW MCP Server",
     "version": "1.0.0",
     "capabilities": { "tools": 6 }
   }
   ```

6. Copy your app URL (e.g., `https://your-app-name.herokuapp.com`)

### Option B: Manual Deploy

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/miaw-mcp-server.git
cd miaw-mcp-server

# 2. Login to Heroku
heroku login

# 3. Create a new Heroku app
heroku create your-app-name

# 4. Set environment variables (replace with your values)
heroku config:set MIAW_SCRT_URL="https://scrt01.uengage1.sfdc-yfeipo.svc.sfdcfc.net"
heroku config:set MIAW_ES_DEVELOPER_NAME="Your_ES_Developer_Name"
heroku config:set MIAW_ORG_ID="00DHu000000p8j3R"
heroku config:set MCP_TRANSPORT="http"
heroku config:set PORT="443"

# 5. Deploy
git push heroku main

# 6. Verify deployment
heroku open
```

---

## ChatGPT Integration

You have **two options** for connecting ChatGPT to your server:

### Option A: MCP Connector (Simpler, Beta Feature)

**Pros:**
- Simpler setup
- No need to create a custom GPT

**Cons:**
- Requires Developer Mode (beta)
- Less stable than Custom GPT
- May have rate limits

**Setup:**

1. Go to **ChatGPT** → Click your profile → **Settings**

2. Navigate to **Developer** → **Apps & Connectors**

3. Click **Add MCP Server**

4. Enter your Heroku URL with `/mcp` endpoint:
   ```
   https://your-app-name.herokuapp.com/mcp
   ```

5. Click **Connect**

6. You should see 6 tools appear:
   - generate_guest_access_token
   - create_conversation
   - send_message
   - list_conversation_entries
   - get_conversation_routing_status
   - close_conversation

7. Test by chatting: "Connect me to a Salesforce agent"

### Option B: Custom GPT (Recommended, More Stable)

**Pros:**
- More stable and reliable
- Better control over behavior
- Can share with team/organization
- Professional appearance

**Cons:**
- Slightly more setup required
- Need to create a custom GPT

**Setup:**

#### 1. Create the Custom GPT

1. Go to **ChatGPT** → Click your name → **My GPTs**

2. Click **Create a GPT**

3. Click **Configure** tab

#### 2. Configure Basic Info

**Name:** Target Shopping Assistant (or your preferred name)

**Description:**
```
Your helpful shopping assistant for Target. Can connect you to live agents when needed.
```

**Instructions:** (Copy and paste this entire block)
```
You are a helpful shopping assistant for Target. Answer questions about products, deals, and shopping. When you encounter questions you cannot answer or when the user explicitly requests to speak with an agent, connect them to Salesforce support.

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

HANDOFF FLOW:
1. When user requests an agent, call generate_guest_access_token
2. Then immediately call create_conversation
3. Then call list_conversation_entries to get the agent greeting
4. Display the greeting verbatim
5. For each user message, call send_message then list_conversation_entries
6. Always display agent messages verbatim without attribution
```

**Conversation Starters:**
```
Help me find a Christmas tree
I need to return something
Can I speak to an agent?
What's on sale this week?
```

#### 3. Add Actions

1. Scroll down to **Actions** section

2. Click **Create new action**

3. Click **Import from URL**

4. Enter your OpenAPI schema URL:
   ```
   https://your-app-name.herokuapp.com/openapi-schema.json
   ```

5. Click **Import**

6. The schema will load with 6 actions

7. For **Authentication**, select **None** (server doesn't require auth)

8. For **Privacy Policy**, enter:
   ```
   https://your-app-name.herokuapp.com/privacy-policy
   ```

9. Click **Save** in the top right

#### 4. Test the GPT

1. Click **Preview** in the top right

2. In the test chat, type:
   ```
   I'd like to speak with an agent
   ```

3. The GPT should:
   - Call `generateSession`
   - Call `createConversation`
   - Call `listConversationEntries`
   - Display the agent's greeting (e.g., "Hi! I'm Selena, how can I help?")

4. Continue the conversation to test message flow

#### 5. Publish (Optional)

1. Click **Save** in the top right

2. Choose who can access:
   - **Only me**: Private testing
   - **Anyone with a link**: Share with specific people
   - **Everyone**: Public (requires OpenAI review)

3. Click **Confirm**

---

## Testing

### Test 1: Health Check

Visit your Heroku app URL:
```
https://your-app-name.herokuapp.com
```

**Expected Response:**
```json
{
  "status": "ok",
  "message": "MIAW MCP Server",
  "version": "1.0.0",
  "capabilities": { "tools": 6 },
  "endpoints": {
    "mcp": "/mcp",
    "schema": "/openapi-schema.json",
    "privacy": "/privacy-policy"
  }
}
```

### Test 2: Session Generation

In ChatGPT, trigger the GPT to generate a session. The log should show:
```
Calling generateSession
```

If successful, you'll get a `sessionId` back.

### Test 3: Conversation Flow

In ChatGPT, say:
```
I'd like to speak with an agent
```

**Expected Behavior:**
1. GPT calls `generateSession` → gets `sessionId`
2. GPT calls `createConversation` → gets `conversationId`
3. GPT calls `listConversationEntries` → waits for agent greeting (up to 25s)
4. GPT displays agent greeting: "Hi! I'm Selena, how can I help?"

**Then type:**
```
Hi! I need help with an order
```

**Expected Behavior:**
1. GPT calls `sendMessage` with your text
2. GPT calls `listConversationEntries` → waits for agent response
3. GPT displays agent response verbatim

### Test 4: Agent Transfer

If your Salesforce flow includes Agentforce → Human transfer:

**Expected Behavior:**
1. You chat with Agentforce bot initially
2. When transfer happens, GPT should display:
   ```
   Transferring you to Agent Name
   
   [Agent's greeting message]
   ```
3. Conversation continues with human agent

---

## Troubleshooting

### Issue: "Error creating connector" or "Connection closed"

**Cause:** Wrong endpoint URL.

**Solution:** Make sure you're using `/mcp`:
```
https://your-app-name.herokuapp.com/mcp
```

NOT:
```
https://your-app-name.herokuapp.com
https://your-app-name.herokuapp.com/sse
```

### Issue: "Request failed with status code 400" on token generation

**Cause:** Invalid Salesforce configuration.

**Solution:**

1. Verify your SCRT URL is correct:
   ```bash
   heroku config:get MIAW_SCRT_URL
   ```
   Should include `https://` and no trailing slash

2. Verify your ES Developer Name:
   ```bash
   heroku config:get MIAW_ES_DEVELOPER_NAME
   ```
   Must exactly match the API Name in Salesforce (case-sensitive)

3. Verify your Org ID:
   ```bash
   heroku config:get MIAW_ORG_ID
   ```
   Should start with `00D` and be 18 characters

4. Update if needed:
   ```bash
   heroku config:set MIAW_SCRT_URL="https://correct-url.net"
   ```

### Issue: ChatGPT says "Selena replied: ..." instead of just the message

**Cause:** Missing instructions in Custom GPT.

**Solution:**

1. Go to your Custom GPT → **Configure**
2. Check the **Instructions** field
3. Make sure it includes the "CRITICAL MESSAGING RULES" section
4. Save and test again

### Issue: No agent greeting appears

**Cause:** No agents available OR routing not configured.

**Solution:**

1. Check agent availability in Salesforce:
   - Setup → Omni-Channel Settings
   - Verify agents are online and available

2. Check routing configuration:
   - Setup → Embedded Service Deployments → Your Deployment
   - Verify routing is configured correctly

3. Check Heroku logs:
   ```bash
   heroku logs --tail --app your-app-name
   ```
   Look for error messages

### Issue: Conversations time out after 25 seconds

**Cause:** Heroku has a 30-second timeout; server stops polling at 25s.

**Solution:** This is normal if no agent is available. Options:

1. Ensure agents are online and have capacity
2. Adjust queue settings to prioritize faster routing
3. The GPT will automatically retry if needed

### Issue: Messages arrive late

**Cause:** Server polls every 500ms, which may feel slow.

**Solution:** This is a balance between responsiveness and API rate limits. To adjust:

1. Clone the repo and modify `src/index.ts`:
   ```typescript
   const pollInterval = 500; // Change to 250 for faster polling
   ```

2. Redeploy to Heroku

### Issue: "Invalid sessionId" errors

**Cause:** Session expired (tokens last ~6 hours).

**Solution:** This is expected behavior. ChatGPT should automatically:
1. Detect the error
2. Call `generate_guest_access_token` again
3. Continue with new session

If it doesn't, manually trigger a new session.

### Getting More Help

1. **Check Heroku Logs:**
   ```bash
   heroku logs --tail --app your-app-name
   ```

2. **Check Salesforce Debug Logs:**
   - Setup → Debug Logs
   - Add your API user to debug logs

3. **GitHub Issues:**
   - [Open an issue](https://github.com/yourusername/miaw-mcp-server/issues)
   - Include logs and error messages

4. **Salesforce Trailblazer Community:**
   - [Service Cloud Community](https://trailblazers.salesforce.com)
   - Search for "Enhanced Chat" or "MIAW"

---

## Next Steps

- ✅ Customize your Custom GPT's personality and responses
- ✅ Add more conversation starters
- ✅ Configure routing rules in Salesforce for better agent matching
- ✅ Set up Agentforce flows for common questions
- ✅ Share your Custom GPT with your team

---

**Congratulations! Your MIAW MCP Server is now running! 🎉**

