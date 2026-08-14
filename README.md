# TerminalKit Docker Agent

This repository contains the public, auditable Docker agent for the [Terminal-Kit](https://github.com/nexuss0781/Terminal-kit) control plane. The agent self-enrolls with a controller, reports its public endpoint and resource inventory, accepts terminal commands, streams output, and supports interactive standard input.

> **This public repository contains no controller key, administrator password, agent token, or enrollment token.** Do not add those credentials to a public repository.

## Recommended Provisioning Flow

Use the controller’s password-protected administrator console at `https://terminalkit.onrender.com` to download a per-instance provisioning Dockerfile. That file has the same agent protocol as this repository but includes a unique enrollment credential privately. Deploy it directly to your remote Render service or Docker host. The agent then automatically reports its endpoint, hostname, operating system, architecture, CPU, RAM, disk, and health to the central controller.

The Dockerfile from the administrator console is a secret enrollment artifact. Do not commit, publish, or reuse it for multiple instances.

## Build This Public Template

This repository is useful for auditing the agent or building a custom image. It requires the controller provisioning values at runtime:

```bash
docker build -t terminalkit-agent .
docker run --rm -p 8080:8080 \
  -e CONTROLLER_URL="https://terminalkit.onrender.com" \
  -e ENROLLMENT_TOKEN="<private one-time enrollment token>" \
  -e INSTANCE_PUBLIC_URL="https://your-public-agent.example.com" \
  terminalkit-agent
```

On Render, the agent automatically uses `RENDER_EXTERNAL_URL` when `INSTANCE_PUBLIC_URL` is not set. For a custom domain or another hosting provider, set `INSTANCE_PUBLIC_URL` to the agent’s reachable HTTPS endpoint.

## Environment Contract

| Variable | Required | Purpose |
| --- | --- | --- |
| `CONTROLLER_URL` | Yes, first start | The public Terminal-Kit controller URL. |
| `ENROLLMENT_TOKEN` | Yes, first start | A private, per-instance enrollment credential. |
| `INSTANCE_PUBLIC_URL` | Only outside Render or for a custom domain | The externally reachable HTTPS URL of this agent. |
| `RENDER_EXTERNAL_URL` | Provided by Render Web Services | Used automatically when `INSTANCE_PUBLIC_URL` is absent. |
| `PORT` | No | Agent listen port; defaults to `8080`. |
| `AGENT_STATE_PATH` | No | Persistent agent-token file path; defaults to `/app/.agent-token`. |

## Protocol Endpoints

| Endpoint | Use |
| --- | --- |
| `GET /v1/terminal-kit/health` | Public health and resource inventory response. |
| `POST /v1/terminal-kit/sessions` | Agent-token-protected command dispatch. |
| `POST /v1/terminal-kit/sessions/:sessionId/stdin` | Agent-token-protected interactive input. |

The controller communicates with the agent after enrollment. AI agents communicate with the central controller’s protected `/api/v1/*` API rather than directly with remote agents.

## Security

Treat the enrollment token and issued agent token as secrets. They authorize an agent to join and communicate with the controller. Use one private provisioning artifact per instance and delete it after a successful deployment.

## License

MIT
