# Family Schedule Agent

A small, read-only AI agent demo for interviews.

## What it does

- Takes commitments for multiple family members
- Detects schedule overlaps
- Considers priority, flexibility, location, prep/travel buffer, and family context
- Uses an LLM to reason about the best plan
- Explains tradeoffs
- Never edits a calendar, sends a message, books, cancels, or takes any external action

## Why it qualifies as an AI agent

The system follows an Observe → Reason → Recommend loop:

1. Observe: ingest family commitments and constraints
2. Detect: identify explicit overlaps and implicit logistical risks
3. Reason: weigh priority, flexibility, buffer time, and context
4. Recommend: produce a prioritized plan with tradeoffs
5. Stop: human remains in control

This is deliberately bounded autonomy.

## Run locally

1. Install Node.js 20+
2. In this folder:

   npm install

3. Copy the environment template:

   cp .env.example .env

4. Add your OpenAI API key to `.env`
5. Start:

   npm run dev

6. Open:

   http://localhost:3000

If no API key is configured, the app still runs in deterministic fallback mode.

## Interview demo script

"I built a read-only family scheduling agent because our family has multiple school, interview, activity, and household commitments. A normal calendar can show overlaps, but it does not reason about which commitments are fixed, which are flexible, who needs transportation, or how much prep time matters.

The agent observes the schedule, detects conflicts, reasons about priorities and constraints, and recommends the best plan. I intentionally stopped autonomy before execution. It cannot modify calendars or message family members. That boundary keeps the human in control while still capturing the value of agentic reasoning."

## Architecture

Browser UI
   ↓
Express API
   ↓
Deterministic conflict detector
   ↓
LLM reasoning layer
   ↓
Read-only recommendations

## Good next upgrades

- Read-only Google Calendar ingestion
- ICS file import
- Recurring family preferences
- Travel-time estimates
- Confidence and assumption tracking
- Evaluation set for conflict detection and recommendation quality
