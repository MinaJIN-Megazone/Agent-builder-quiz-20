"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const host = "127.0.0.1";
const port = Number(process.env.QUIZ_LOCAL_PORT || 4173);
const root = __dirname;
const envText = fs.readFileSync(path.join(root, "supabase", "functions", ".env"), "utf8");
const answerLine = envText.split(/\r?\n/).find(line => line.startsWith("QUIZ_ANSWER_KEY="));

if (!answerLine) throw new Error("QUIZ_ANSWER_KEY is missing from supabase/functions/.env");

const scoring = JSON.parse(answerLine.slice("QUIZ_ANSWER_KEY=".length));
if (!Array.isArray(scoring.answers) || !Array.isArray(scoring.points) || scoring.answers.length !== 20 || scoring.points.length !== 20 || scoring.points.reduce((sum, point) => sum + point, 0) !== 1000) {
  throw new Error("The local answer key must contain 20 answers and total 1,000 points.");
}

const participants = new Map();
const results = [];

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 16_384) {
        reject(new Error("request_too_large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("invalid_request")); }
    });
    request.on("error", reject);
  });
}

function sortedLeaderboard() {
  return [...results]
    .sort((a, b) => b.score - a.score || Date.parse(a.submitted_at) - Date.parse(b.submitted_at) || a.sequence - b.sequence)
    .map((result, index) => ({ rank: index + 1, name: result.name, score: result.score, submitted_at: result.submitted_at }));
}

async function handleFunction(request, response, pathname) {
  const origin = request.headers.origin;
  const allowedOrigins = new Set([`http://${host}:${port}`, `http://localhost:${port}`]);
  if (origin && !allowedOrigins.has(origin)) return sendJson(response, 403, { error: "origin_not_allowed" });

  if (pathname === "/functions/v1/leaderboard" && request.method === "GET") {
    return sendJson(response, 200, sortedLeaderboard());
  }

  if (pathname === "/functions/v1/start-quiz" && request.method === "POST") {
    try {
      const body = await readJson(request);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const department = typeof body.department === "string" ? body.department.trim() : "";
      if (!name || name.length > 60 || !department || department.length > 80) {
        return sendJson(response, 400, { error: "invalid_participant" });
      }

      const participantId = randomUUID();
      const startedAt = new Date();
      participants.set(participantId, { name, department, startedAt, submitted: false });
      return sendJson(response, 200, { participant_id: participantId, started_at: startedAt.toISOString() });
    } catch (error) {
      return sendJson(response, 400, { error: error.message || "invalid_request" });
    }
  }

  if (pathname === "/functions/v1/submit-quiz" && request.method === "POST") {
    try {
      const body = await readJson(request);
      const participant = participants.get(body.participantId);
      if (!participant) return sendJson(response, 404, { error: "participant_not_found" });
      if (participant.submitted) return sendJson(response, 409, { error: "already_submitted" });

      const answers = body.answers;
      if (!Array.isArray(answers) || answers.length !== scoring.answers.length || answers.some(value => !Number.isInteger(value) || value < 0 || value > 3)) {
        return sendJson(response, 400, { error: "invalid_answers" });
      }

      const correctness = answers.map((answer, index) => answer === scoring.answers[index]);
      const score = correctness.reduce((sum, correct, index) => sum + (correct ? scoring.points[index] : 0), 0);
      const submittedAt = new Date();
      const result = {
        id: randomUUID(),
        name: participant.name,
        score,
        correct_count: correctness.filter(Boolean).length,
        correctness,
        correct_answers: scoring.answers,
        submitted_at: submittedAt.toISOString(),
        duration_ms: Math.max(0, submittedAt.getTime() - participant.startedAt.getTime()),
        sequence: results.length,
      };

      participant.submitted = true;
      results.push(result);
      return sendJson(response, 200, result);
    } catch (error) {
      return sendJson(response, 400, { error: error.message || "invalid_request" });
    }
  }

  return sendJson(response, 404, { error: "not_found" });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
  if ((url.pathname === "/" || url.pathname === "/index.html") && request.method === "GET") {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    return fs.createReadStream(path.join(root, "index.html")).pipe(response);
  }

  if (url.pathname.startsWith("/functions/v1/")) return handleFunction(request, response, url.pathname);
  return sendJson(response, 404, { error: "not_found" });
});

server.listen(port, host, () => {
  console.log(`Quiz local server: http://${host}:${port}`);
  console.log("Scoring key loaded server-side; participant and score records are held in memory only.");
});

server.on("error", error => {
  if (error.code === "EADDRINUSE") console.error(`Port ${port} is already in use. Set QUIZ_LOCAL_PORT to another localhost port.`);
  else console.error(error.message);
  process.exitCode = 1;
});