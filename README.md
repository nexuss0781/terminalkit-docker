# TerminalKit Docker Agent

TerminalKit Docker Agent is the client-instance component of the Terminal-Kit control plane. It runs alongside a managed terminal environment and provides the communication layer between that instance and the central controller.

## Purpose

The agent enables a Terminal-Kit instance to identify itself, report availability and resource status, receive terminal work, stream execution output, and support interactive input when required.

It is designed for multi-instance terminal operations where a central controller coordinates distributed execution environments for agentic systems.

## Scope

This repository contains the Docker-based client agent only. The central controller, orchestration API, instance registry, and management interface are maintained in the [Terminal-Kit](https://github.com/nexuss0781/Terminal-kit) repository.

## License

MIT
