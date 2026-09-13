# Daily Family Schedule Email

This optional Google Apps Script sends a read-only family calendar digest every day without requiring a laptop to stay on and without using a paid AI API.

## What the scheduled email includes

- Tomorrow's events from the calendars visible to the Google account running the script
- Same-calendar overlaps
- Tight transitions under 20 minutes when consecutive events have different locations
- A link to the Family Schedule Agent web app for richer interactive AI analysis

The scheduled job does not edit calendar events.

## One-time setup

1. Go to https://script.google.com and create a new project named `Family Schedule Agent Daily Digest`.
2. Replace the default `Code.gs` with the contents of this repository's `apps-script/Code.gs`.
3. At the top of the script, replace the placeholder values in `CONFIG.RECIPIENTS` with the family email addresses that should receive the report.
4. If you only want certain calendars, add their exact names to `CONFIG.CALENDAR_NAMES`. Leave the array empty to include every calendar visible to the account running the script.
5. In Project Settings, set the time zone to `America/Los_Angeles` or your preferred local time zone.
6. In the function dropdown, choose `sendTestEmail` and click Run. Google will ask for Calendar and email permissions. Approve them.
7. Confirm the test email looks correct.
8. Choose `createDailyTrigger` and click Run once. This creates one daily trigger around the hour configured by `CONFIG.SEND_HOUR`.

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

## Important architecture note

The browser app's WebLLM model only runs while a browser is open, so it cannot power an unattended scheduled job. The scheduled email therefore uses deterministic conflict and transition checks. The email links back to the web app for the richer in-browser AI reasoning.
