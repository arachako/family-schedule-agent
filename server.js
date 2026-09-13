import "dotenv/config";
import express from "express";
import OpenAI from "openai";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

function overlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function deterministicConflicts(events) {
  const conflicts = [];
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i];
      const b = events[j];
      if (overlap(a, b)) {
        conflicts.push({
          a: `${a.person}: ${a.title} (${a.start}-${a.end})`,
          b: `${b.person}: ${b.title} (${b.start}-${b.end})`
        });
      }
    }
  }
  return conflicts;
}

app.post("/api/analyze", async (req, res) => {
  const { events = [], familyContext = "" } = req.body || {};

  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: "Add at least one event." });
  }

  const conflicts = deterministicConflicts(events);

  if (!process.env.OPENAI_API_KEY) {
    return res.json({
      mode: "fallback",
      summary: "OPENAI_API_KEY is not configured, so this result uses deterministic conflict detection only.",
      conflicts,
      priorities: events
        .slice()
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
        .map(e => `${e.person}: ${e.title}`),
      recommendations: conflicts.length
        ? ["Review each overlap. Protect the higher-priority or least-flexible commitment first."]
        : ["No time overlaps detected. Add an API key to get contextual reasoning and recommendations."],
      questions: []
    });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const prompt = `
You are a read-only family scheduling advisor.

Your job:
1. Review all family commitments.
2. Detect direct overlaps, tight handoffs, and likely logistical problems.
3. Reason about priority, flexibility, location, preparation time, and family context.
4. Recommend the best options.
5. NEVER take actions. Never claim to reschedule, message, book, cancel, or modify anything.
6. When information is missing, state assumptions clearly.
7. Prefer practical recommendations over generic advice.
8. Return ONLY valid JSON. No markdown.

JSON shape:
{
  "summary": "2-4 sentence assessment",
  "conflicts": [
    {
      "issue": "specific conflict or risk",
      "severity": "high|medium|low",
      "reasoning": "why it matters"
    }
  ],
  "priorities": [
    {
      "rank": 1,
      "event": "event name",
      "person": "person",
      "reason": "why this should be protected"
    }
  ],
  "recommendations": [
    {
      "recommendation": "specific read-only recommendation",
      "tradeoff": "what this optimizes and what it sacrifices"
    }
  ],
  "questions": ["only questions whose answers would materially improve the plan"]
}

Family context:
${familyContext || "No additional family context provided."}

Events:
${JSON.stringify(events, null, 2)}
`.trim();

  try {
    const response = await client.responses.create({
      model: "gpt-5.6-luna",
      reasoning: { effort: "low" },
      input: prompt
    });

    const raw = response.output_text?.trim() || "";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : null;
    }

    if (!parsed) throw new Error("Model did not return valid JSON.");

    res.json({
      mode: "ai",
      deterministicConflicts: conflicts,
      ...parsed
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "AI analysis failed.",
      detail: err?.message || "Unknown error"
    });
  }
});

app.listen(port, () => {
  console.log(`Family Schedule Agent running at http://localhost:${port}`);
});
