// Loosely typed view of the engine, so pages can index its plain-JS tables freely.
import * as E from "./engine"
const A: any = E
export const { CLINIC, ME, PATIENTS, EHVD, DOC_TYPES, EVENTS, EVENT_LABEL, STATES, SAMPLE_DOCS, BASE_URL, citizens, patient, pName, req, reqByToken, recipientLabel, lookupPerson, addressCheck, buildMessage, contentCheck, parseDoc, parseStay, createRequest, linkStatus, openLink, login, submitAnswer, act, nameKey, uuid, now, fmtDT, fmtD, fmtISOd, fmtDur, ago, stepsFor, counts, metrics, subscribe, getVersion, commit, boot, resetSeed, resetEmpty, state } = A
