import { createAdminClient } from "../_shared/admin.ts";
import { isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (!isAllowedOrigin(request)) return jsonResponse(request, { error: "origin_not_allowed" }, 403);
  if (request.method !== "POST") return jsonResponse(request, { error: "method_not_allowed" }, 405);

  try {
    const body = await request.json();
    const participantId = typeof body.participantId === "string" ? body.participantId : "";
    const answers = body.answers;
    if (!participantId || !Array.isArray(answers) || answers.length !== 20 || answers.some((value) => !Number.isInteger(value) || value < 0 || value > 3)) {
      return jsonResponse(request, { error: "invalid_answers" }, 400);
    }

    const scoring = JSON.parse(Deno.env.get("QUIZ_ANSWER_KEY") ?? "null");
    if (!Array.isArray(scoring?.answers) || !Array.isArray(scoring?.points) || scoring.answers.length !== 20 || scoring.points.length !== 20 || scoring.points.reduce((sum, point) => sum + point, 0) !== 1000) {
      return jsonResponse(request, { error: "quiz_scoring_not_configured" }, 503);
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("submit_quiz", {
      _participant_id: participantId,
      _answers: answers,
      _answer_key: scoring.answers,
      _points: scoring.points,
    });

    if (error) {
      const alreadySubmitted = error.code === "23505";
      const eventClosed = error.message.includes("event_closed");
      return jsonResponse(request, {
        error: alreadySubmitted ? "already_submitted" : eventClosed ? "event_closed" : "could_not_submit",
      }, alreadySubmitted ? 409 : eventClosed ? 410 : 400);
    }

    return jsonResponse(request, data);
  } catch {
    return jsonResponse(request, { error: "invalid_request" }, 400);
  }
});