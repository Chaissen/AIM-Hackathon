# UML: current use case and relations

These diagrams model the target system from [`track/README.md`](../track/README.md) and [WHITEPAPER.md](WHITEPAPER.md). The [README status](../README.md#status) says which parts run.
Dashed elements are **proposed** and not built: managing register entries (UC13) and the register itself. Add comments as `> 💬 Name: ...`.

## 1. Use case diagram

```mermaid
flowchart LR
    hofer["👤 Requesting doctor<br/>(Dr. Hofer, PGK member)"]
    sender["👤 Outside sender<br/>(Dr. Brandl / S. Kern)"]
    wrong["👤 Wrong recipient<br/>(typo address, colleague)"]
    idp["⚙ ID Austria<br/>(simulated eID)"]
    fhir["⚙ FHIR server<br/>(HAPI)"]
    gw["⚙ Email / SMS<br/>(Mailpit, SMS page)"]

    subgraph SYS["Document request service"]
        direction TB
        UC1(["UC1 Request document"])
        UC2(["UC2 Look up recipient in register"])
        UC3(["UC3 Send access link"])
        UC4(["UC4 Open link"])
        UC5(["UC5 Verify identity"])
        UC6(["UC6 Answer request<br/>(upload / form)"])
        UC7(["UC7 Check patient match"])
        UC8(["UC8 File as FHIR + Provenance"])
        UC9(["UC9 Notify doctor in Matrix"])
        UC10(["UC10 Write audit entry"])
        UC11(["UC11 Handle misdelivery"])
        UC12(["UC12 Warn about lookalike address"])
        UC13(["UC13 Manage register entries"])
    end

    hofer --- UC1
    hofer --- UC13
    sender --- UC4
    sender --- UC6
    wrong --- UC4

    UC1 -.->|"«include»"| UC3
    UC1 -.->|"«include»"| UC2
    UC12 -.->|"«extend»"| UC1
    UC4 -.->|"«include»"| UC5
    UC6 -.->|"«include»"| UC7
    UC7 -.->|"«include»"| UC8
    UC8 -.->|"«include»"| UC9
    UC11 -.->|"«extend»: identity fails"| UC5
    UC11 -.->|"«extend»: patient mismatch"| UC7
    UC11 -.->|"«include»"| UC9

    UC3 --- gw
    UC5 --- idp
    UC8 --- fhir

    classDef planned stroke-dasharray: 5 5
    class UC13 planned
```

UC10 (audit) is included by UC3, UC4, UC5, UC6, UC8 and UC11. The diagram leaves those six edges out to stay readable. They are the six audit steps the jury counts.

| Use case | Actor | Covers |
|---|---|---|
| UC1 Request document | Dr. Hofer | Request form in the ordy workspace: patient, document type, named recipient, contact |
| UC3 Send access link | – | One-time link. No patient name, birth date or document type in the email or SMS |
| UC5 Verify identity | Sender, ID Austria | eID name must equal the named recipient → catches **M1, M2** |
| UC7 Check patient match | – | Patient in the document and form must equal the request's patient → catches **M3** |
| UC8 File as FHIR | FHIR server | Transaction Bundle: DiagnosticReport + Observations or DocumentReference, plus Provenance |
| UC11 Handle misdelivery | – | Nothing filed, audit entry, warning in Matrix |
| UC2 Look up recipient in register | Dr. Hofer, eHVD | Built on the eHVD as the directory search in the workspace's Contacts view and the recipient check while she types a new request |
| UC12 Warn about lookalike address | Dr. Hofer, eHVD | Built as the address check before sending (T15). A domain that differs from the organisation's `mail` domain in the eHVD, such as `labor-kanaI`, waits for **Send anyway** → helps catch **M1** |
| UC13 Manage register entries | Dr. Hofer | *Proposed*, see section 4 |

## 2. Domain relations (class diagram)

```mermaid
classDiagram
    direction LR

    class NetworkMember {
        matrixId
        name
        role
    }
    class OutsideContact {
        <<proposed register entry>>
        name
        role
        email / phone
        verifiedEidId
        lastVerifiedAt
    }
    class Organization {
        name
        knownDomains
        inNetwork : bool
    }
    class Register {
        <<proposed>>
        lookup(name, org)
        isLookalike(address)
    }
    class DocumentRequest {
        <<FHIR Task>>
        documentType : lab | rehab
        status
        note
    }
    class AccessLink {
        token, single use
        channel : email | sms
        sentTo
        expiresAt
    }
    class IdentityCheck {
        method : eID
        returnedName
        result : pass | fail
        checkedAt
    }
    class IdentityProvider {
        <<interface>>
        authenticate()
    }
    class SimulatedIdAustria
    class Answer {
        rawMarkdown
        formPatientName
        formBirthDate
    }
    class Patient {
        <<FHIR>>
        name
        birthDate
        MRN
    }
    class DiagnosticReport {
        <<FHIR>>
    }
    class Observation {
        <<FHIR>>
        LOINC code
        valueQuantity in UCUM
        referenceRange
    }
    class DocumentReference {
        <<FHIR>>
        attachment text-markdown
    }
    class Provenance {
        <<FHIR>>
        agent = sender
        recorded
        policy + signature = identity method
    }
    class AuditEvent {
        <<FHIR>>
        step 1 of 6
        who / what / when
    }

    Register "1" o-- "*" NetworkMember : PGK directory
    Register "1" o-- "*" OutsideContact : known outside senders
    Register "1" o-- "*" Organization
    NetworkMember "*" --> "1" Organization : works at
    OutsideContact "*" --> "1" Organization : works at

    NetworkMember "1" --> "*" DocumentRequest : requests
    DocumentRequest "*" --> "1" OutsideContact : named recipient
    DocumentRequest "*" --> "1" Patient : for
    DocumentRequest "1" *-- "1..*" AccessLink : sent via
    AccessLink "1" --> "*" IdentityCheck : opened → checked
    IdentityCheck --> IdentityProvider : uses
    IdentityProvider <|.. SimulatedIdAustria
    IdentityCheck "0..1" --> "1" Answer : passes → allows
    Answer --> DiagnosticReport : lab result
    Answer --> DocumentReference : rehab report
    DiagnosticReport "1" *-- "1..*" Observation : result
    DiagnosticReport --> Patient : subject
    Observation --> Patient : subject
    DocumentReference --> Patient : subject
    DocumentRequest --> DiagnosticReport : output
    DocumentRequest --> DocumentReference : output
    Provenance --> DiagnosticReport : target
    Provenance --> DocumentReference : target
    Provenance --> OutsideContact : agent
    Provenance --> IdentityCheck : how verified
    AuditEvent --> DocumentRequest : about
```

## 3. Component relations

```mermaid
flowchart LR
    subgraph Clinic["Runs at the clinic"]
        gateway["Workspace gateway<br/>(8081)"] <--> workspace["ordy workspace<br/>(Next.js)"]
        workspace <--> core["Core service<br/>(tRPC)"]
        core <--> synapse["Synapse<br/>(Matrix)"]
        element["Element Web<br/>(8082)"] <--> synapse
        element <--> widget["Optional request widget<br/>(iframe in Element)"]
        widget <--> core
        synapse <--> bot["Matrix bot<br/>(notices, !status)"]
        bot <--> core
        core <--> fhirsrv[("HAPI FHIR")]
        core --> audit[("Audit log")]
        core <-.-> reg[("Register<br/>(proposed)")]
        portal["Answer portal<br/>(HTTPS, public)"] <--> core
    end
    core --> mail["Mailpit / SMS page"]
    mail -. "link" .-> browser["Outside person's browser"]
    browser --> portal
    portal <--> eid["Simulated ID Austria"]

    classDef planned stroke-dasharray: 5 5
    class reg planned
```

## 4. The register: open questions

The track says outside people are **in no directory**. The PGK directory only lists network members. So our register would be the clinic's own address book of outside contacts, not a public directory.

| Question | Proposal | Your input |
|---|---|---|
| R1 What does the register hold? | PGK members (read from the directory), known outside contacts, and organisations with their known email domains | |
| R2 Who adds outside contacts? | Dr. Hofer on her first request (name + contact). The entry gets "verified" after the first successful eID check | |
| R3 What does ID Austria give us? | Name + birth date, plus an eID identifier (bPK-like). We store the identifier so later answers must come from the same person, not just the same name | |
| R4 Lookalike detection | Compare the typed address against known domains (`labor-kanaI` vs `labor-kanal`) → warning before sending (helps M1) | |
| R5 Is this in scope for the demo? | Minimal version: a seeded JSON file or a Postgres table, no admin UI | |

> 💬 Add further information here.
