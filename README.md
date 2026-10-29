# AIM-Hackathon: Track 2, health data interoperability

This is our entry for [Track 2 of the AIM hackathon](https://github.com/AIM-Austria/TRACK-2-interoperability). Dr. Lena Hofer works inside PGK, a closed document network built on Matrix. The service in this repository lets her request a document from someone outside the network, such as a lab or a rehab clinic. The outside person logs in with ID Austria, answers in the browser, and the service files the answer as FHIR R4 on the clinic's FHIR server.

Status: design written, no code yet.

## Documents

| Document | What it covers |
|---|---|
| [Whitepaper](organisations/WHITEPAPER.md) | The problem, the solution, our answers to the five design questions, and how we measure the metrics |
| [Architecture](organisations/ARCHITECTURE.md) | Components, ports, the request lifecycle, the Matrix bot, messages, parsing, and the audit log |
| [Identity and misdelivery](organisations/IDENTITY.md) | Real ID Austria and eHVD, the Keycloak simulation, the identity checks, and the three misdelivery tests |
| [FHIR model](organisations/FHIR.md) | The resources we file, how they reference each other, and how we validate them |
| [Timeline](organisations/TIMELINE.md) | Milestones, tasks, owners, and the cut list |
| [Roles and workflow](organisations/ROLES_AND_WORKFLOW.md) | Who owns what, git rules, and handoffs |
| [Compliance and safety](organisations/COMPLIANCE_AND_SAFETY.md) | Synthetic data, message rules, data we keep, AI rules, and the disclaimer |
| [UML diagrams](organisations/UML.md) | Use cases, domain classes, and component relations |
| [Track brief](track/README.md) and [scenario](track/scenario/README.md) | The task as the organisers wrote it |

Prototype on synthetic data only. Not a medical device. Not for clinical use.
