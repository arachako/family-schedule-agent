# Family Schedule Agent

A read-only family scheduling agent designed as a lightweight interview demo and usable family web app.

## What it does

- Takes commitments for multiple family members
- Detects direct conflicts and tight handoffs deterministically
- Uses an in-browser LLM to reason about priority, flexibility, prep/travel buffers, transportation, and family context
- Produces recommendations and explains tradeoffs
- Never edits calendars, sends messages, books, cancels, or takes external actions
- Lets a user copy a shareable schedule snapshot link

## Why this version is free

The app is fully static and can be hosted on GitHub Pages. AI inference runs inside the user's browser with WebLLM and a small Llama 3.2 1B model. There is no OpenAI API key, no server, and no per-request API charge.

The first AI analysis downloads the model to the browser. The model is then cached by that browser. If WebGPU is unavailable, the app gracefully falls back to deterministic conflict analysis.

## Architecture

GitHub Pages static web app
   ↓
Browser UI + local schedule storage
   ↓
Deterministic conflict checks
   ↓
WebLLM / Llama 3.2 1B running in the browser
   ↓
Read-only recommendations

This follows an Observe → Detect → Reason → Recommend → Stop loop. The human remains in control.

## Publish on GitHub Pages

This repository is ready to publish directly from `main`.

1. Open the repository on GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select branch **main** and folder **/(root)**.
5. Click **Save**.

The site will be available at:

`https://arachako.github.io/family-schedule-agent/`

## Privacy and sharing

Schedule data is stored in the browser's local storage. AI inference also happens in the browser. The **Copy share link** button puts the current schedule snapshot into the URL so another family member can open that snapshot without a shared database.

A share link is a snapshot, not real-time synchronization. A future version can add read-only Google Calendar ingestion or a shared calendar data source.

## Interview framing

> I built a read-only family scheduling agent that combines deterministic conflict detection with local LLM reasoning. It weighs priorities, flexibility, buffers, and logistics, but deliberately stops before taking actions. I also designed it to run as a zero-cost static web app, with the model executing privately in the user's browser rather than through a paid API.

## Possible next upgrades

- Read-only Google Calendar ingestion
- ICS file import
- Shared family calendar synchronization
- Travel-time estimates
- Confidence and assumption tracking
- Evaluation set for conflict detection and recommendation quality
