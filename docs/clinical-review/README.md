# Clinical review

This folder holds the questions that only the clinical staff can decide. There is one file per GitHub issue, named `SIGNOFF_<issue>_<topic>.md`.

Each file states the rule as it stands, our recommended answer with its sources, and an answer box per question. The files use plain clinical language and no code.

## How to answer

1. Read the file. Each one says how long it takes.
2. Tick one box per question: **Confirm as written**, or **Change to** with the rule you want.
3. Add your name and the date under each answer.
4. Commit the filled-in file, or hand it to a developer who commits it for you. The commit is the record of the sign-off.

A developer then applies any change to the docs and the code and closes the issue.

Until a file is signed, the rules it covers are marked "pending clinical sign-off" in the docs.

## Open reviews

| File | Issue | Topic |
|---|---|---|
| [SIGNOFF_18_IDENTITY_AND_RELEASE.md](SIGNOFF_18_IDENTITY_AND_RELEASE.md) | [#18](https://github.com/Chaissen/AIM-Hackathon/issues/18) | Who may release a lab result, hold or block, and the legal basis |
