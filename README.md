# Family Schedule Agent

A read-only family scheduling agent that pulls upcoming commitments from Google Calendar, detects conflicts, and provides recommendations without modifying calendars.

## What it does

- Connects to Google Calendar with read-only OAuth scopes
- Lets the user choose which accessible calendars to include
- Loads upcoming events for the selected time window
- Detects obvious double-bookings and tight transitions deterministically
- Uses an in-browser LLM for contextual scheduling recommendations
- Never creates, edits, deletes, or reschedules events
- Does not require a paid AI API key

## Architecture

Google Calendar
→ Google OAuth read-only authorization
→ Calendar List + Events API
→ selected family calendars
→ deterministic conflict checks
→ in-browser LLM reasoning
→ read-only recommendations

Calendar OAuth access tokens are held in browser memory only by this app.

## One-time Google setup

1. Create or select a Google Cloud project.
2. Enable the Google Calendar API.
3. Configure the OAuth consent screen.
4. Create an OAuth 2.0 Client ID of type **Web application**.
5. Add this Authorized JavaScript origin:

   `https://arachako.github.io`

   For local testing you can also add your local origin, such as `http://localhost:8000`.
6. If the OAuth app is in Testing mode, add the family Google accounts that should use the app as test users.
7. Copy the Web Client ID. It ends in `.apps.googleusercontent.com`.
8. Put that Client ID in `config.js`:

```js
window.APP_CONFIG = {
  googleClientId: "YOUR_CLIENT_ID.apps.googleusercontent.com"
};
```

The OAuth Client ID is public configuration for a browser app. Do not add a Google client secret to this repository.

## GitHub Pages

Publish the `main` branch from `/(root)` using GitHub Pages.

The site URL is expected to be:

`https://arachako.github.io/family-schedule-agent/`

## Family calendar model

The Google account signing in can read every calendar that has been shared with that account and appears in its Google Calendar list. For the simplest family setup, share each family member's calendar with the account that will run the analysis, or let each family member sign in separately when using the web app.

## Agent boundary

The application intentionally requests only read-only Calendar scopes. The agent can observe, reason, detect conflicts, and recommend. It cannot execute calendar changes or contact anyone.
