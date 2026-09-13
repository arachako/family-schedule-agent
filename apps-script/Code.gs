const CONFIG = {
  RECIPIENTS: [
    "your-email@example.com",
    "family-member@example.com"
  ],
  CALENDAR_NAMES: [],
  SEND_HOUR: 18,
  TIME_ZONE: "America/Los_Angeles",
  WEB_APP_URL: "https://arachako.github.io/family-schedule-agent/",
  GEMINI_MODEL: "gemini-3.5-flash-lite"
};

function sendDailyFamilySchedule() {
  validateConfig_();

  const range = tomorrowRange_();
  const calendars = selectedCalendars_();
  const rawEvents = collectEvents_(calendars, range.start, range.end);
  const events = dedupeEvents_(rawEvents);
  const deterministicConflicts = findConflicts_(events);
  const ai = analyzeScheduleWithAI_(events, deterministicConflicts);

  const dateLabel = Utilities.formatDate(range.start, CONFIG.TIME_ZONE, "EEEE, MMMM d");
  const html = buildEmailHtml_(dateLabel, events, ai);
  const text = buildPlainText_(dateLabel, events, ai);

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
    .filter(t => t.getHandlerFunction() === "sendDailyFamilySchedule")
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function validateConfig_() {
  if (!CONFIG.RECIPIENTS.length || CONFIG.RECIPIENTS.some(x => x.includes("example.com"))) {
    throw new Error("Update CONFIG.RECIPIENTS with the real family email addresses first.");
  }
}

function tomorrowRange_() {
  const start = new Date();
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
  return events.sort((a, b) => a.start - b.start || a.calendar.localeCompare(b.calendar));
}

function normalizeText_(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function dedupeEvents_(events) {
  const seen = new Set();
  return events.filter(event => {
    const key = [
      normalizeText_(event.calendar),
      normalizeText_(event.title),
      event.start.getTime(),
      event.end.getTime(),
      normalizeText_(event.location)
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameExactCommitment_(a, b) {
  return normalizeText_(a.title) === normalizeText_(b.title) &&
    a.start.getTime() === b.start.getTime() &&
    a.end.getTime() === b.end.getTime() &&
    normalizeText_(a.location) === normalizeText_(b.location);
}

function findConflicts_(events) {
  const conflicts = [];
  const byCalendar = groupByCalendar_(events);

  Object.keys(byCalendar).forEach(calendar => {
    const list = byCalendar[calendar]
      .filter(e => !e.allDay)
      .sort((a, b) => a.start - b.start);

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
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
          const gap = Math.round((b.start - a.end) / 60000);
          if (
            gap >= 0 && gap < 20 &&
            a.location && b.location &&
            normalizeText_(a.location) !== normalizeText_(b.location)
          ) {
            conflicts.push({
              severity: "MEDIUM",
              calendar,
              eventA: a.title,
              eventB: b.title,
              issue: `Only ${gap} minutes between ${a.title} and ${b.title}, at different locations`
            });
          }
          break;
        }
      }
    }
  });

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
  if (!apiKey) return fallbackAI_(deterministicConflicts, "Gemini API key is not configured.");

  const eventPayload = events.map(e => ({
    calendar: e.calendar,
    title: e.title,
    start: formatIsoLocal_(e.start),
    end: formatIsoLocal_(e.end),
    allDay: e.allDay,
    location: e.location,
    description: truncate_(e.description, 400)
  }));

  const prompt = `You are a read-only family scheduling analyst. Analyze tomorrow's calendar.

Rules:
1. Do not treat duplicate representations of the same real-world commitment as conflicts.
2. Different titles can represent the same event. Example: "Girls Instructional Fall Ball" and "Lacrosse Tanvi" at the same time may be one activity.
3. Put probable duplicates under likelyDuplicates, not trueConflicts.
4. Only mark a true conflict when the family genuinely appears to need to be in incompatible places or do incompatible things.
5. If uncertain, use watchItems.
6. Do not claim to edit, reschedule, message, or take actions.
7. Return only valid JSON in exactly this shape:
{
  "summary":"2-4 sentence family-level summary",
  "likelyDuplicates":[{"events":["event 1","event 2"],"reasoning":"why"}],
  "trueConflicts":[{"severity":"HIGH|MEDIUM|LOW","issue":"specific conflict","reasoning":"why"}],
  "watchItems":[{"issue":"something to verify","reasoning":"why"}],
  "recommendations":["specific read-only recommendation"]
}

Calendar events:
${JSON.stringify(eventPayload)}

Rule-based candidate conflicts, which may contain false positives:
${JSON.stringify(deterministicConflicts)}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(CONFIG.GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json" }
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
    const text = (data.candidates || [])
      .flatMap(c => (c.content && c.content.parts) || [])
      .map(p => p.text || "")
      .join("")
      .trim();

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
    return fallbackAI_(deterministicConflicts, error.message);
  }
}

function fallbackAI_(conflicts, reason) {
  return {
    available: false,
    reason,
    summary: conflicts.length
      ? "Potential schedule conflicts were found. AI analysis was unavailable, so this email is using rule-based checks."
      : "No obvious rule-based conflicts were found. AI analysis was unavailable.",
    likelyDuplicates: [],
    trueConflicts: conflicts.map(c => ({
      severity: c.severity,
      issue: c.issue,
      reasoning: "Detected by time-overlap rules."
    })),
    watchItems: [],
    recommendations: []
  };
}

function buildEmailHtml_(dateLabel, events, ai) {
  const byCalendar = groupByCalendar_(events);
  const badge = ai.available ? "AI analysis" : "Rule-based fallback";

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
      const time = event.allDay ? "All day" : `${formatTime_(event.start)}–${formatTime_(event.end)}`;
      const location = event.location ? ` · ${escapeHtml_(event.location)}` : "";
      return `<li><strong>${escapeHtml_(time)}</strong> · ${escapeHtml_(event.title)}${location}</li>`;
    }).join("");
    return `<h3 style="margin-bottom:6px">${escapeHtml_(calendar)}</h3><ul style="margin-top:0">${items || "<li>No events</li>"}</ul>`;
  }).join("");

  return `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#202124;max-width:720px">
    <h2 style="margin-bottom:4px">Family schedule for tomorrow</h2>
    <div style="color:#5f6368;margin-bottom:12px">${escapeHtml_(dateLabel)}</div>
    <div style="font-size:12px;color:#5f6368">${badge}</div>
    <h3>AI assessment</h3>
    <p>${escapeHtml_(ai.summary || "")}</p>
    ${duplicateHtml}
    <h3>True conflicts</h3>
    <ul>${conflictHtml}</ul>
    ${watchHtml}
    ${recommendationHtml}
    <h3>Schedule</h3>
    ${scheduleHtml || "<p>No events found.</p>"}
    <p style="margin-top:24px"><a href="${CONFIG.WEB_APP_URL}">Open Family Schedule Agent</a></p>
    <p style="font-size:12px;color:#80868b">Read-only calendar digest. No calendar events were changed.</p>
  </div>`;
}

function buildPlainText_(dateLabel, events, ai) {
  const lines = [
    `FAMILY SCHEDULE FOR TOMORROW · ${dateLabel}`,
    "",
    `AI ASSESSMENT${ai.available ? "" : " (FALLBACK)"}`,
    ai.summary || ""
  ];

  if (ai.likelyDuplicates.length) {
    lines.push("", "LIKELY DUPLICATE REPRESENTATIONS");
    ai.likelyDuplicates.forEach(d => lines.push(`- ${(d.events || []).join(" + ")}: ${d.reasoning || ""}`));
  }

  lines.push("", "TRUE CONFLICTS");
  if (!ai.trueConflicts.length) lines.push("- No true conflicts identified.");
  else ai.trueConflicts.forEach(c => lines.push(`- ${c.severity || ""} · ${c.issue || ""}: ${c.reasoning || ""}`));

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
