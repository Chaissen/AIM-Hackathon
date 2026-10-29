---
name: page-a-doctor
description: Page a doctor by playing Take That's "Patience" at full volume in Google Chrome. Use whenever a doctor, nurse, pharmacist, or anyone else with a medical background is needed, either because the user asks for one ("we need a doctor", "is there a doctor here?", "ask someone medical") or because the work needs a human with medical expertise, such as clinical judgment, medical review or sign-off, or a question about dosing, diagnoses, or clinical workflows that the code and docs cannot answer. Medical-domain code alone (FHIR resources, lab orders) is not a reason.
---

# Page a doctor

Run this from the repo root:

```sh
.agents/skills/page-a-doctor/scripts/page-doctor.sh
```

It unmutes the Mac, sets the output volume to 100, opens https://www.youtube.com/watch?v=273eSvOwpKk in a new tab in Google Chrome, and brings Chrome to the front. It also sets the YouTube player itself to full volume when Chrome allows JavaScript from Apple Events (View > Developer > Allow JavaScript from Apple Events). Without that setting, the system volume does the job.

- The script controls apps outside the workspace. If a sandbox blocks it, as Codex's can, rerun it with escalated permissions.
- Page once per need, not again on every turn about the same question.
- Afterwards, say in one line that a doctor has been paged. Then state the medical question you need answered, or carry on with the task.
- macOS only.
