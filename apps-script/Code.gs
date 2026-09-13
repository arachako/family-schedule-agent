const CONFIG = {
  // Replace these with the addresses that should receive the daily digest.
  RECIPIENTS: [
    "your-email@example.com",
    "family-member@example.com"
  ],

  // Leave empty to include every calendar visible to the Google account
  // running this script. Or list exact calendar names to include, for example:
  // ["Priya", "Anil", "Aarush", "Tanvi"]
  CALENDAR_NAMES: [],

  // Apps Script time-based triggers run approximately within the selected hour.
  SEND_HOUR: 18,
  TIME_ZONE: "America/Los_Angeles",
  WEB_APP_URL: "https://arachako.github.io/family-schedule-agent/"
};

function sendDailyFamilySchedule() {
  validateConfig_();

  const range = tomorrowRange_();
  const calendars = selectedCalendars_();
  const events = collectEvents_(calendars, range.start, range.end);
  const conflicts = findConflicts_(events);

  const dateLabel = Utilities.formatDate(
    range.start,
    CONFIG.TIME_ZONE,
    "EEEE, MMMM d"
  );

  const html = buildEmailHtml_(dateLabel, events, conflicts);
  const text = buildPlainText_(dateLabel, events, conflicts);

  MailApp.sendEmail({
    to: CONFIG.RECIPIENTS.join(","),
    subject: `Family schedule for tomorrow · ${dateLabel}`,
    body: text,
    htmlBody: html,
    name: "Family Schedule Agent"
  });
}

function sendTestEmail() {
  sendDailyFamilySchedule();
}

function createDailyTrigger() {
  deleteDailyTrigger_();

  ScriptApp.newTrigger("sendDailyFamilySchedule")
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.SEND_HOUR)
    .create();
}

function deleteDailyTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === "sendDailyFamilySchedule")
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
}

function validateConfig_() {
  if (!CONFIG.RECIPIENTS.length || CONFIG.RECIPIENTS.some(x => x.includes("example.com"))) {
    throw new Error("Update CONFIG.RECIPIENTS with the real family email addresses first.");
  }
}

function tomorrowRange_() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
}

function selectedCalendars_() {
  const all = CalendarApp.getAllCalendars();
  if (!CONFIG.CALENDAR_NAMES.length) return all;

  const wanted = new Set(CONFIG.CALENDAR_NAMES.map(x => x.trim().toLowerCase()));
  return all.filter(cal => wanted.has(cal.getName().trim().toLowerCase()));
}

function collectEvents_(calendars, start, end) {
  const events = [];

  calendars.forEach(cal => {
    cal.getEvents(start, end).forEach(event => {
      events.push({
        person: cal.getName(),
        title: event.getTitle() || "Busy",
        start: event.getStartTime(),
        end: event.getEndTime(),
        allDay: event.isAllDayEvent(),
        location: event.getLocation() || ""
      });
    });
  });

  events.sort((a, b) => a.start - b.start || a.person.localeCompare(b.person));
  return events;
}

function findConflicts_(events) {
  const conflicts = [];
  const byPerson = {};

  events.forEach(event => {
    if (!byPerson[event.person]) byPerson[event.person] = [];
    byPerson[event.person].push(event);
  });

  Object.keys(byPerson).forEach(person => {
    const list = byPerson[person]
      .filter(e => !e.allDay)
      .sort((a, b) => a.start - b.start);

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];

        if (a.start < b.end && b.start < a.end) {
          conflicts.push({
            severity: "HIGH",
            person,
            issue: `${a.title} overlaps with ${b.title}`
          });
          continue;
        }

        if (a.end <= b.start) {
          const gapMinutes = Math.round((b.start - a.end) / 60000);
          if (
            gapMinutes >= 0 &&
            gapMinutes < 20 &&
            a.location &&
            b.location &&
            a.location !== b.location
          ) {
            conflicts.push({
              severity: "MEDIUM",
              person,
              issue: `Only ${gapMinutes} minutes between ${a.title} and ${b.title}, at different locations`
            });
          }
          break;
        }
      }
    }
  });

  return conflicts;
}

function buildEmailHtml_(dateLabel, events, conflicts) {
  const byPerson = groupByPerson_(events);
  const conflictHtml = conflicts.length
    ? conflicts.map(c => `<li><strong>${escapeHtml_(c.severity)} · ${escapeHtml_(c.person)}</strong>: ${escapeHtml_(c.issue)}</li>`).join("")
    : "<li>No direct overlaps or tight location transitions detected.</li>";

  const scheduleHtml = Object.keys(byPerson).sort().map(person => {
    const items = byPerson[person].map(event => {
      const time = event.allDay
        ? "All day"
        : `${formatTime_(event.start)}–${formatTime_(event.end)}`;
      const location = event.location ? ` · ${escapeHtml_(event.location)}` : "";
      return `<li><strong>${escapeHtml_(time)}</strong> · ${escapeHtml_(event.title)}${location}</li>`;
    }).join("");
    return `<h3 style="margin-bottom:6px">${escapeHtml_(person)}</h3><ul style="margin-top:0">${items || "<li>No events</li>"}</ul>`;
  }).join("");

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#202124;max-width:720px">
      <h2 style="margin-bottom:4px">Family schedule for tomorrow</h2>
      <div style="color:#5f6368;margin-bottom:20px">${escapeHtml_(dateLabel)}</div>

      <h3>Conflicts and tight transitions</h3>
      <ul>${conflictHtml}</ul>

      <h3>Schedule</h3>
      ${scheduleHtml || "<p>No events found.</p>"}

      <p style="margin-top:24px">
        <a href="${CONFIG.WEB_APP_URL}">Open Family Schedule Agent</a>
        for the full interactive AI analysis.
      </p>
      <p style="font-size:12px;color:#80868b">Read-only calendar digest. No calendar events were changed.</p>
    </div>`;
}

function buildPlainText_(dateLabel, events, conflicts) {
  const lines = [
    `FAMILY SCHEDULE FOR TOMORROW · ${dateLabel}`,
    "",
    "CONFLICTS AND TIGHT TRANSITIONS"
  ];

  if (!conflicts.length) {
    lines.push("- No direct overlaps or tight location transitions detected.");
  } else {
    conflicts.forEach(c => lines.push(`- ${c.severity} · ${c.person}: ${c.issue}`));
  }

  lines.push("", "SCHEDULE");
  const byPerson = groupByPerson_(events);
  Object.keys(byPerson).sort().forEach(person => {
    lines.push("", person);
    byPerson[person].forEach(event => {
      const time = event.allDay ? "All day" : `${formatTime_(event.start)}-${formatTime_(event.end)}`;
      lines.push(`- ${time} · ${event.title}${event.location ? " · " + event.location : ""}`);
    });
  });

  lines.push("", `Full interactive analysis: ${CONFIG.WEB_APP_URL}`);
  return lines.join("\n");
}

function groupByPerson_(events) {
  return events.reduce((out, event) => {
    if (!out[event.person]) out[event.person] = [];
    out[event.person].push(event);
    return out;
  }, {});
}

function formatTime_(date) {
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, "h:mm a");
}

function escapeHtml_(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
