import "dotenv/config";
import express from "express";

const app = express();
const port = process.env.PORT || 3000;
const ollamaModel = process.env.OLLAMA_MODEL || "llama3.2:3b";
const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";

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

function fallbackResult(events, conflicts, detail = "") {
  return {
    mode: "fallback",
    summary: detail
      ? `Local AI is unavailable right now, so this result uses deterministic conflict detection only. ${detail}`
      : "This result uses deterministic conflict detection only.",
    conflicts,
    priorities: events
      .slice()
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      .map(e => `${e.person}: ${e.title}`),
    recommendations: conflicts.length
      ? ["Review each overlap. Protect the higher-priority or least-flexible commitment first."]
      : ["No direct time overlaps detected."],
    questions: []
  };
}

app.post("/api/analyze", async (req, res) => {
  const { events = [], familyContext = "" } = req.body || {};

  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: "Add at least one event." });
  }

  const conflicts = deterministicConflicts(events);

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
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: "You are a careful scheduling reasoning assistant. Return only JSON." },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}.`);
    }

    const data = await response.json();
    const raw = data?.message?.content?.trim() || "";
    const parsed = JSON.parse(raw);

    res.json({
      mode: "ai-local",
      model: ollamaModel,
      deterministicConflicts: conflicts,
      ...parsed
    });
  } catch (err) {
    console.error(err);
    res.json(fallbackResult(events, conflicts, "Start Ollama and make sure the local model is installed for AI reasoning."));
  }
});

app.listen(port, () => {
  console.log(`Family Schedule Agent running at http://localhost:${port}`);
  console.log(`Local AI model: ${ollamaModel} via ${ollamaUrl}`);
});
