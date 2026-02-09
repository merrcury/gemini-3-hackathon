# 2nd Brain Agent System

A soulful AI assistant with personality, memory, and integrated tools.

**Inspired by [OpenClaw](https://github.com/openclaw/openclaw):** local-first identity (soul), workspace tools via MCP, single control plane, and persistent memory. Tool definitions are fetched from the MCP server; search grounding and identity/calendar context are wired into the orchestrator.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      2nd Brain                              │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │    Soul     │  │   Memory    │  │       Skills        │  │
│  │             │  │             │  │                     │  │
│  │ - Identity  │  │ - Mem0 API  │  │ - Web Search        │  │
│  │ - Values    │  │ - Long-term │  │ - Gmail             │  │
│  │ - Traits    │  │ - Learning  │  │ - Calendar          │  │
│  │ - Style     │  │             │  │ - Drive             │  │
│  └─────────────┘  └─────────────┘  │ - Contacts          │  │
│                                    │ - Deep Thinking     │  │
│                                    └─────────────────────┘  │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    Brain (Orchestrator)                │ │
│  │                                                        │ │
│  │  - Skill detection based on message                    │ │
│  │  - Tool orchestration (MCP, Search, Thinking)          │ │
│  │  - Memory context integration                          │ │
│  │  - Agentic loop for multi-step tasks                   │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Soul System

Inspired by OpenSouls and OpenClaw, the agent has a **soul** - a persistent identity that includes:

### Identity
- **Name**: "2nd Brain" (customizable)
- **Purpose**: Your cognitive partner
- **Version**: Tracked for upgrades

### Personality
- **Traits**: genuinely helpful, intellectually curious, proactively thoughtful
- **Tone**: warm, capable, and refreshingly human
- **Communication Style**: Natural, conversational, like a trusted friend
- **Quirks**: Remembers details, proactively suggests, admits uncertainty

### Values & Principles
- Privacy and trust are sacred
- Time is precious
- Clarity over complexity
- Proactive helpfulness
- Continuous growth

### Skills
Each skill has:
- **Triggers**: Keywords that activate it
- **Category**: workspace, research, memory, reasoning, communication
- **Description**: What it does
- **Enabled**: Can be toggled on/off

## Memory Integration

Uses Mem0 for long-term memory:

```typescript
// Stored on first setup and persisted
await saveSoul(soul, jwtToken);

// Retrieved on every session
const soul = await loadSoul(jwtToken);

// Conversations stored automatically
await storeConversationMemory(userMessage, assistantResponse, jwtToken);

// Context retrieved before responding
const memories = await getRelevantMemories(message, jwtToken);
```

## Usage

```typescript
import { initializeBrain, chat, getSoul } from '@/services/agents';

// Initialize with JWT for memory
const status = await initializeBrain(jwtToken);
console.log(`${status.soul.name} is ready!`);

// Chat with events
const response = await chat(message, context, (event) => {
  if (event.type === 'tool_call') {
    console.log(`Using ${event.data.name}...`);
  }
});
```

## Files

- `types.ts` - TypeScript interfaces
- `soul.ts` - Soul configuration and system prompt generation
- `memory.ts` - Mem0 integration
- `brain.ts` - Main orchestrator
- `index.ts` - Public exports

## Customization

### Change Agent Name
```typescript
const customSoul = {
  ...DEFAULT_SOUL,
  name: "Jarvis",
};
await saveSoul(customSoul, jwtToken);
```

### Add Skills
```typescript
const newSkill: AgentSkill = {
  id: "custom_skill",
  name: "Custom Skill",
  description: "Does something custom",
  category: "reasoning",
  triggers: ["custom", "special"],
  enabled: true,
};
soul.skills.push(newSkill);
```

### Modify Personality
```typescript
const updatedSoul = evolveSoul(soul, {
  preferredName: "Boss",
  timezone: "America/New_York",
  interests: ["AI", "productivity"],
});
```

## Reverification Checklist

Use this to reverify the entire agent stack (Agents, MCPs, Search Grounding, Websearch, Soul, Identity, prompting, memory, OpenClaw inspiration):

| Area | Where | What to verify |
|------|--------|----------------|
| **Agents** | `brain.ts`, `soul.ts`, `memory.ts`, `index.ts` | Orchestrator uses soul + memory + tools; retry/fallback; event callbacks |
| **MCP** | `mcp-client.ts`, `mcp-servers/google-workspace/server.py` | Tools from `/api/tools`; minimal aliases; REST context & OAuth persistence |
| **Search grounding** | `brain.ts` | `googleSearch` in `config.tools`; system prompt prefers search over memory when both present |
| **Websearch** | `brain.ts`, `soul.ts` | Triggers (price, today, current, latest, …); forced grounding instruction when enabled |
| **Soul** | `soul.ts` | Identity contract, traits, skills with triggers; `saveSoul` / `loadSoul` |
| **Identity** | `soul.ts`, `memory.ts` | Identity in system prompt; memory recall for name/work/location/preferences |
| **Prompting** | `soul.ts`, `brain.ts` | System prompt = soul + memory context + calendar/date + search/skills instructions |
| **Memory** | `memory.ts` | Mem0 add/search; `getRelevantMemories` returns array; identity-enriching queries; store conversation |
| **OpenClaw** | README, `index.ts` | Local identity, workspace via MCP, single control plane, persistent memory; tool defs from server |
