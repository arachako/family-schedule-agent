const CONFIG = {
  // Replace these in your Apps Script copy with the addresses that should receive the daily digest.
  RECIPIENTS: [
    "your-email@example.com",
    "family-member@example.com"
  ],

  // Leave empty to include every calendar visible to the Google account running this script.
  CALENDAR_NAMES: [],

  // Apps Script time-based triggers run approximately within the selected hour.
  SEND_HOUR: 18,
  TIME_ZONE: "America/Los_Angeles",
  WEB_APP_URL: "https://arachako.github.io/family-schedule-agent/",

  // Free Gemini model for scheduled AI analysis.
  GEMINI_MODEL: "gemini-2.5-flash-lite"
};

function sendDailyFamilySchedule() {
  validateConfig_();

  const range = tomorrowRange_();
  const calendars = selectedCalendars_();
  const rawEvents = collectEvents_(calendars, range.start, range.end);
  const events = dedupeEvents_(rawEvents);
  const deterministicConflicts = findConflicts_(events);
  const ai = analyzeScheduleWithAI_(events, deterministicConflicts);

  const dateLabel = Utilities.formatDate(
    range.start,
    CONFIG.TIME_ZONE,
    "EEEE, MMMM d"
  );

  const html = buildEmailHtml_(dateLabel, events, deterministicConflicts, ai);
  const text = buildPlainText_(dateLabel, events, deterministicConflicts, ai);

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
        calendar: cal.getName(),
        title: event.getTitle() || "Busy",
        start: event.getStartTime(),
        end: event.getEndTime(),
        allDay: event.isAllDayEvent(),
        location: event.getLocation() || "",
        description: event.getDescription() || ""
      });
    });
  });

  events.sort((a, b) => a.start - b.start || a.calendar.localeCompare(b.calendar));
  return events;
}

function normalizeText_(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function eventFingerprint_(event) {
  return [
    normalizeText_(event.calendar),
    normalizeText_(event.title),
    event.start.getTime(),
    event.end.getTime(),
    normalizeText_(event.location)
  ].join("|");
}

function dedupeEvents_(events) {
  const seen = new Set();
  const unique = [];

  events.forEach(event => {
    const key = eventFingerprint_(event);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(event);
  });

  return unique;
}

function sameExactCommitment_(a, b) {
  return normalizeText_(a.title) === normalizeText_(b.title) &&
    a.start.getTime() === b.start.getTime() &&
    a.end.getTime() === b.end.getTime() &&
    normalizeText_(a.location) === normalizeText_(b.location);
}

function findConflicts_(events) {
  const conflicts = [];
  const byCalendar = {};

  events.forEach(event => {
    if (!byCalendar[event.calendar]) byCalendar[event.calendar] = [];
    byCalendar[event.calendar].push(event);
  });

  Object.keys(byCalendar).forEach(calendar => {
    const list = byCalendar[calendar]
      .filter(e => !e.allDay)
      .sort((a, b) => a.start - b.start);

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];

        // Never report two identical copies of the same commitment as a conflict.
        if (sameExactCommitment_(a, b)) continue;

        if (a.start < b.end && b.start < a.end) {
          conflicts.push({
            severity: "HIGH",
            calendar,
            eventA: a.title,
            eventB: b.title,
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
            normalizeText_(a.location) !== normalizeText_(b.location)
          ) {
            conflicts.push({
              severity: "MEDIUM",
              calendar,
              eventA: a.title,
              eventB: b.title,
              issue: `Only ${gapMinutes} minutes between ${a.title} and ${b.title}, at different locations`
            });
          }
          break;
        }
      }
    }
  });

  return dedupeConflictRows_(conflicts);
}

function dedupeConflictRows_(conflicts) {
  const seen = new Set();
  return conflicts.filter(c => {
    const pair = [normalizeText_(c.eventA), normalizeText_(c.eventB)].sort().join("|");
    const key = `${normalizeText_(c.calendar)}|${c.severity}|${pair}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function analyzeScheduleWithAI_(events, deterministicConflicts) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) {
    return {
      available: false,
      reason: "Gemini API key is not configured.",
      summary: deterministicConflicts.length
        ? "Potential schedule conflicts were found. AI classification is not configured yet."
        : "No obvious rule-based conflicts were found.",
      likelyDuplicates: [],
      trueConflicts: deterministicConflicts.map(c => ({
        severity: c.severity,
        issue: c.issue,
        reasoning: "Detected by time-overlap rules."
      })),
      watchItems: [],
      recommendations: []
    };
  }

  const eventPayload = events.map(e => ({
    calendar: e.calendar,
    title: e.title,
    start: formatIsoLocal_(e.start),
    end: formatIsoLocal_(e.end),
    allDay: e.allDay,
    location: e.location,
    description: truncate_(e.description, 400)
  }));

  const prompt = `
You are a read-only family scheduling analyst. Analyze tomorrow's calendar.

Important rules:
1. Do NOT treat duplicate representations of the same real-world commitment as a conflict.
2. Different titles can still represent the same commitment. Example: "Girls Instructional Fall Ball" and "Lacrosse Tanvi" at the same time may be the same activity. Use time, location, description, and wording to infer this.
3. If two events are probably the same commitment, put them under likelyDuplicates, not trueConflicts.
4. Only call something a true conflict when there is evidence that the family actually needs to be in two incompatible places or do two incompatible things.
5. Be conservative. If uncertain, put it under watchItems rather than trueConflicts.
6. Do not claim to edit, reschedule, message, or take actions.
7. Keep the summary concise and practical for a family email.
8. Return ONLY valid JSON with exactly this shape:
{
  "summary": "2-4 sentence family-level summary",
  "likelyDuplicates": [
    {"events":["event 1","event 2"],"reasoning":"why they are probably the same commitment"}
  ],
  "trueConflicts": [
    {"severity":"HIGH|MEDIUM|LOW","issue":"specific conflict","reasoning":"why it is a real conflict"}
  ],
  "watchItems": [
    {"issue":"something to verify","reasoning":"why it may matter"}
  ],
  "recommendations": [
    "specific read-only recommendation"
  ]
}

Calendar events:
${JSON.stringify(eventPayload)}

Rule-based candidate conflicts (these may include false positives, so verify them against the events):
${JSON.stringify(deterministicConflicts)}
  `.trim();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(CONFIG.GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2
    }
  };

  try {
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });

    const status = response.getResponseCode();
    if (status < 200 || status >= 300) {
      throw new Error(`Gemini request failed (${status}): ${truncate_(response.getContentText(), 300)}`);
    }

    const data = JSON.parse(response.getContentText());
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
    if (!text) throw new Error("Gemini returned an empty response.");

    const parsed = JSON.parse(text);
    return {
      available: true,
      summary: parsed.summary || "AI analysis completed.",
      likelyDuplicates: Array.isArray(parsed.likelyDuplicates) ? parsed.likelyDuplicates : [],
      trueConflicts: Array.isArray(parsed.trueConflicts) ? parsed.trueConflicts : [],
      watchItems: Array.isArray(parsed.watchItems) ? parsed.watchItems : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : []
    };
  } catch (error) {
    console.error(error);
    return {
      available: false,
      reason: error.message,
      summary: deterministicConflicts.length
        ? "Potential schedule conflicts were found. AI analysis was temporarily unavailable, so this email is using rule-based checks."
        : "No obvious rule-based conflicts were found. AI analysis was temporarily unavailable.",
      likelyDuplicates: [],
      trueConflicts: deterministicConflicts.map(c => ({
        severity: c.severity,
        issue: c.issue,
        reasoning: "Detected by time-overlap rules."
      })),
      watchItems: [],
      recommendations: []
    };
  }
}

function buildEmailHtml_(dateLabel, events, deterministicConflicts, ai) {
  const byCalendar = groupByCalendar_(events);

  const aiBadge = ai.available
    ? '<span style="display:inline-block;background:#dcfce7;padding:4px 8px;border-radius:999px;font-size:12px">AI analysis</span>'
    : '<span style="display:inline-block;background:#fef3c7;padding:4px 8px;border-radius:999px;font-size:12px">Rule-based fallback</span>';

  const duplicateHtml = ai.likelyDuplicates.length
    ? `<h3>Likely duplicate representations</h3><ul>${ai.likelyDuplicates.map(d => `<li><strong>${escapeHtml_((d.events || []).join(" + "))}</strong><br><span style="color:#5f6368">${escapeHtml_(d.reasoning || "")}</span></li>`).join("")}</ul>`
    : "";

  const conflictHtml = ai.trueConflicts.length
    ? ai.trueConflicts.map(c => `<li><strong>${escapeHtml_(c.severity || "")}</strong> · ${escapeHtml_(c.issue || "")}<br><span style="color:#5f6368">${escapeHtml_(c.reasoning || "")}</span></li>`).join("")
    : "<li>No true conflicts identified.</li>";

  const watchHtml = ai.watchItems.length
    ? `<h3>Things to verify</h3><ul>${ai.watchItems.map(w => `<li><strong>${escapeHtml_(w.issue || "")}</strong><br><span style="color:#5f6368">${escapeHtml_(w.reasoning || "")}</span></li>`).join("")}</ul>`
    : "";

  const recommendationHtml = ai.recommendations.length
    ? `<h3>Recommendations</h3><ul>${ai.recommendations.map(r => `<li>${escapeHtml_(r)}</li>`).join("")}</ul>`
    : "";

  const scheduleHtml = Object.keys(byCalendar).sort().map(calendar => {
    const items = byCalendar[calendar].map(event => {
      const time = event.allDay
        ? "All day"
        : `${formatTime_(event.start)}–${formatTime_(event.end)}`;
      const location = event.location ? ` · ${escapeHtml_(event.location)}` : "";
      return `<li><strong>${escapeHtml_(time)}</strong> · ${escapeHtml_(event.title)}${location}</li>`;
    }).join("");
    return `<h3 style="margin-bottom:6px">${escapeHtml_(calendar)}</h3><ul style="margin-top:0">${items || "<li>No events</li>"}</ul>`;
  }).join("");

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#202124;max-width:720px">
      <h2 style="margin-bottom:4px">Family schedule for tomorrow</h2>
      <div style="color:#5f6368;margin-bottom:12px">${escapeHtml_(dateLabel)}</div>
      ${aiBadge}

      <h3>AI assessment</h3>
      <p>${escapeHtml_(ai.summary || "")}</p>

      ${duplicateHtml}

      <h3>True conflicts</h3>
      <ul>${conflictHtml}</ul>

      ${watchHtml}
      ${recommendationHtml}

      <h3>Schedule</h3>
      ${scheduleHtml || "<p>No events found.</p>"}

      <p style="margin-top:24px">
        <a href="${CONFIG.WEB_APP_URL}">Open Family Schedule Agent</a>
        for the full interactive view.
      </p>
      <p style="font-size:12px;color:#80868b">Read-only calendar digest. No calendar events were changed.</p>
    </div>`;
}

function buildPlainText_(dateLabel, events, deterministicConflicts, ai) {
  const lines = [
    `FAMILY SCHEDULE FOR TOMORROW · ${dateLabel}`,
    "",
    `AI ASSESSMENT${ai.available ? "" : " (FALLBACK)"}`,
    ai.summary || ""
  ];

  if (ai.likelyDuplicates.length) {
    lines.push("", "LIKELY DUPLICATE REPRESENTATIONS");
    ai.likelyDuplicates.forEach(d => {
      lines.push(`- ${(d.events || []).join(" + ")}: ${d.reasoning || ""}`);
    });
  }

  lines.push("", "TRUE CONFLICTS");
  if (!ai.trueConflicts.length) {
    lines.push("- No true conflicts identified.");
  } else {
    ai.trueConflicts.forEach(c => lines.push(`- ${c.severity || ""} · ${c.issue || ""}: ${c.reasoning || ""}`));
  }

  if (ai.watchItems.length) {
    lines.push("", "THINGS TO VERIFY");
    ai.watchItems.forEach(w => lines.push(`- ${w.issue || ""}: ${w.reasoning || ""}`));
  }

  if (ai.recommendations.length) {
    lines.push("", "RECOMMENDATIONS");
    ai.recommendations.forEach(r => lines.push(`- ${r}`));
  }

  lines.push("", "SCHEDULE");
  const byCalendar = groupByCalendar_(events);
  Object.keys(byCalendar).sort().forEach(calendar => {
    lines.push("", calendar);
    byCalendar[calendar].forEach(event => {
      const time = event.allDay ? "All day" : `${formatTime_(event.start)}-${formatTime_(event.end)}`;
      lines.push(`- ${time} · ${event.title}${event.location ? " · " + event.location : ""}`);
    });
  });

  lines.push("", `Full interactive view: ${CONFIG.WEB_APP_URL}`);
  return lines.join("\n");
}

function groupByCalendar_(events) {
  return events.reduce((out, event) => {
    if (!out[event.calendar]) out[event.calendar] = [];
    out[event.calendar].push(event);
    return out;
  }, {});
}

function formatTime_(date) {
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, "h:mm a");
}

function formatIsoLocal_(date) {
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function truncate_(value, maxLength) {
  const text = String(value || "");
  return text.length <= maxLength ? text : text.slice(0, maxLength) + "…";
}

function escapeHtml_(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
