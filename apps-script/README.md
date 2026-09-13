# Daily Family Schedule Email

This Google Apps Script sends a read-only family calendar digest every day without requiring a laptop to stay on.

## What the scheduled email includes

- Tomorrow's events from the calendars visible to the Google account running the script
- Exact duplicate removal before analysis
- Deterministic overlap and tight-transition checks
- Optional Gemini AI analysis that separates likely duplicate representations from real conflicts
- Things to verify and practical read-only recommendations
- A link to the Family Schedule Agent web app

The scheduled job does not edit calendar events.

## One-time setup

1. Go to https://script.google.com and create a new project named `Family Schedule Agent Daily Digest`.
2. Replace the default `Code.gs` with the contents of this repository's `apps-script/Code.gs`.
3. At the top of the script, replace the placeholder values in `CONFIG.RECIPIENTS` with the family email addresses that should receive the report.
4. If you only want certain calendars, add their exact names to `CONFIG.CALENDAR_NAMES`. Leave the array empty to include every calendar visible to the account running the script.
5. In Project Settings, set the time zone to `America/Los_Angeles` or your preferred local time zone.

## Enable scheduled AI analysis

The script uses the Gemini API only for the AI classification and summary. If no Gemini key is configured, the email still sends using deterministic checks.

1. Create a Gemini API key in Google AI Studio.
2. In Apps Script, open **Project Settings**.
3. Scroll to **Script Properties** and choose **Add script property**.
4. Set the property name to:

   `GEMINI_API_KEY`

5. Paste the Gemini API key as the value and save it.

Do not put the Gemini API key directly in `Code.gs` and do not commit it to GitHub.

The script currently uses `gemini-2.5-flash-lite`.

### Privacy note

The browser web app keeps AI reasoning local in the browser. The scheduled Apps Script cannot use that browser-local model when nobody has the page open, so scheduled AI analysis sends a reduced representation of tomorrow's calendar events to the Gemini API: calendar name, event title, start/end time, location, and a truncated event description.

If you do not want calendar details sent to an external AI service, leave `GEMINI_API_KEY` unset. The daily email will still work with deterministic conflict detection and duplicate removal.

## Test the email

1. Save `Code.gs`.
2. In the function dropdown, choose `sendTestEmail`.
3. Click **Run**.
4. Google will ask for Calendar, external-request, and email permissions. Approve them.
5. Confirm the test email looks correct.

The email should now contain:

- AI assessment
- likely duplicate representations
- true conflicts
- things to verify
- recommendations
- tomorrow's schedule

## Turn on the daily schedule

Choose `createDailyTrigger` in the function dropdown and click **Run** once.

The default `SEND_HOUR` is 18, which means approximately 6 PM in the script's time zone. Apps Script time-based triggers may run at some point within that hour rather than at an exact minute.

## Change the delivery hour

Edit:

```javascript
SEND_HOUR: 18
```

Examples:

- `7` = around 7 AM
- `18` = around 6 PM
- `20` = around 8 PM

Then run `createDailyTrigger` again. It removes the prior daily trigger before creating the new one.

## Duplicate handling

The script now uses two layers:

1. Exact duplicate removal: identical title, time, location, and calendar entries are collapsed before conflict detection.
2. AI semantic classification: differently named events that appear to describe the same real-world commitment can be labeled as likely duplicates instead of true conflicts.

This prevents repeated alerts such as multiple copies of the same sports event from dominating the digest.
