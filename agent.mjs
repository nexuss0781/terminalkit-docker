import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { arch, cpus, freemem, hostname, loadavg, platform, totalmem } from "node:os";
import { readFile, statfs, writeFile } from "node:fs/promises";

const protocolVersion = "2";
const agentVersion = "2.0.0";
const controllerUrl = "https://terminalkit.onrender.com";
const port = Number(process.env.PORT || 8080);
const statePath = process.env.AGENT_STATE_PATH || "/app/.agent-token";
const bootstrapPath = process.env.AGENT_BOOTSTRAP_PATH || "/app/.agent-bootstrap";

let agentToken = "";
let bootstrapSecret = "";
let instanceId = "";
let controllerQueue = Promise.resolve();
const sessions = new Map();

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readText(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

async function readJson(req) {
  const body = await readText(req);
  return body ? JSON.parse(body) : {};
}

function publicEndpoint() {
  return (process.env.RENDER_EXTERNAL_URL || process.env.INSTANCE_PUBLIC_URL || "").replace(/\/$/, "");
}

function identity() {
  return { hostname: hostname(), agentVersion, osPlatform: platform(), architecture: arch(), instanceUrl: publicEndpoint() };
}

async function metrics() {
  const totalMemory = totalmem();
  const usedMemory = totalMemory - freemem();
  const cpuCount = Math.max(1, cpus().length);
  let diskTotalMb = 0;
  let diskFreeMb = 0;
  try {
    const disk = await statfs("/");
    diskTotalMb = Math.round(Number(disk.blocks) * Number(disk.bsize) / 1024 / 1024);
    diskFreeMb = Math.round(Number(disk.bfree) * Number(disk.bsize) / 1024 / 1024);
  } catch {}
  return {
    cpuCount,
    cpuPercent: Math.min(100, Math.round((loadavg()[0] / cpuCount) * 100)),
    memoryPercent: Math.round((usedMemory / totalMemory) * 100),
    memoryTotalMb: Math.round(totalMemory / 1024 / 1024),
    diskPercent: diskTotalMb ? Math.round(((diskTotalMb - diskFreeMb) / diskTotalMb) * 100) : 0,
    diskTotalMb,
    diskFreeMb,
  };
}

function authorized(req) {
  return Boolean(agentToken) && req.headers.authorization === `Bearer ${agentToken}`;
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function notifyController(path, body, retries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      if (!controllerUrl || !agentToken) throw new Error("Agent is not enrolled");
      const response = await fetch(`${controllerUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${agentToken}` },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Controller returned ${response.status}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await wait(attempt * 500);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Controller delivery failed");
}

function queueController(path, body) {
  const report = controllerQueue.then(() => notifyController(path, body));
  controllerQueue = report.catch(error => console.error("Terminal-Kit controller delivery failed:", error.message));
  return report;
}

export function createOrderedStdinWriter(stdin) {
  let queue = Promise.resolve();
  return input => {
    const write = queue.then(() => new Promise((resolve, reject) => {
      if (!stdin.writable) return reject(new Error("Terminal stdin is closed"));
      stdin.write(input, error => error ? reject(error) : resolve());
    }));
    queue = write.catch(() => undefined);
    return write;
  };
}

async function enroll() {
  if (!agentToken) agentToken = await readFile(statePath, "utf8").catch(() => "");
  if (agentToken) return;
  if (!bootstrapSecret) bootstrapSecret = await readFile(bootstrapPath, "utf8").catch(() => "");
  if (!bootstrapSecret) {
    bootstrapSecret = randomBytes(32).toString("base64url");
    await writeFile(bootstrapPath, bootstrapSecret, { mode: 0o600 });
  }
  if (!publicEndpoint()) throw new Error("Waiting for the Render public endpoint before automatic enrollment");
  const response = await fetch(`${controllerUrl}/api/agent/auto-enroll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bootstrapSecret, ...identity(), ...(await metrics()) }),
  });
  if (!response.ok) throw new Error(`Enrollment failed with ${response.status}`);
  const data = await response.json();
  agentToken = data.agentToken;
  instanceId = String(data.instanceId);
  await writeFile(statePath, agentToken, { mode: 0o600 });
}

async function heartbeat() {
  if (!agentToken) return;
  await queueController("/api/agent/heartbeat", { instanceId, ...identity(), ...(await metrics()) });
}

function launchSession({ sessionId, command }) {
  const child = spawn("script", ["-qfec", command, "/dev/null"], { stdio: ["pipe", "pipe", "pipe"] });
  const session = { child, sequence: 0, writeInput: createOrderedStdinWriter(child.stdin) };
  sessions.set(sessionId, session);
  const emit = (kind, chunk) => queueController(`/api/agent/sessions/${sessionId}/events`, { kind, payload: chunk.toString(), sequence: ++session.sequence });
  child.stdout.on("data", chunk => { void emit("stdout", chunk); });
  child.stderr.on("data", chunk => { void emit("stderr", chunk); });
  child.on("error", error => { void emit("stderr", error.message); });
  child.on("close", code => {
    sessions.delete(sessionId);
    void queueController(`/api/agent/sessions/${sessionId}/complete`, { exitCode: code ?? 1 });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (req.method === "GET" && url.pathname === "/v1/terminal-kit/health") return send(res, 200, { status: "online", protocolVersion, ...identity(), ...(await metrics()) });
  if (req.method === "POST" && url.pathname === "/v1/terminal-kit/bootstrap") {
    return req.headers["x-terminal-kit-bootstrap"] === bootstrapSecret
      ? send(res, 202, { accepted: true, protocolVersion })
      : send(res, 401, { error: "Unauthorized" });
  }
  if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
  if (req.method === "POST" && url.pathname === "/v1/terminal-kit/sessions") {
    const body = await readJson(req);
    if (!body.sessionId || !body.command) return send(res, 400, { error: "sessionId and command are required" });
    launchSession(body);
    return send(res, 202, { accepted: true });
  }
  const inputMatch = url.pathname.match(/^\/v1\/terminal-kit\/sessions\/([^/]+)\/stdin$/);
  if (req.method === "POST" && inputMatch) {
    const body = await readJson(req);
    const session = sessions.get(inputMatch[1]);
    if (!session) return send(res, 404, { error: "Session not found" });
    try {
      await session.writeInput(String(body.input ?? ""));
      return send(res, 202, { accepted: true });
    } catch (error) {
      return send(res, 409, { error: error instanceof Error ? error.message : "Terminal stdin is unavailable" });
    }
  }
  return send(res, 404, { error: "Not found" });
});

async function start() {
  await new Promise(resolve => server.listen(port, "0.0.0.0", resolve));
  const synchronize = async () => {
    try {
      await enroll();
      await heartbeat();
    } catch (error) {
      console.error("Terminal-Kit automatic enrollment is waiting:", error instanceof Error ? error.message : error);
    }
  };
  await synchronize();
  setInterval(() => { void synchronize(); }, 30_000).unref();
}

if (process.env.TERMINAL_KIT_TEST !== "1") start().catch(error => { console.error(error); process.exit(1); });
