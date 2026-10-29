import { DOCUMENT_TYPES, type DocumentType } from "@/lib/document-types";
import { getBotClient } from "@/server/matrix/client";

// The notices in Dr. Hofer's room, docs/ARCHITECTURE.md, "Matrix bot".
// Names come from Dr. Hofer's input and from ID Austria tokens, so the body is plain text, never HTML.

type LabValues = { within: number; outside: number };

export type Notice =
  | { kind: "sent"; requestId: number; recipient: string; org: string; channel: "email" | "sms" }
  | { kind: "wrong-person"; requestId: number; recipient: string; idAustriaName: string }
  // The requested patient. The notice never names the patient in the document (M3).
  | { kind: "patient-mismatch"; requestId: number; patient: string }
  | { kind: "held"; requestId: number; hold: "identity" | "answer"; reason: string }
  | ({ kind: "filed"; patient: string; sender: string } & (
      | { docType: "lab-result"; values: LabValues }
      | { docType: Exclude<DocumentType, "lab-result"> }
    ));

export function noticeText(notice: Notice): string {
  switch (notice.kind) {
    case "sent":
      return `Request ${notice.requestId} sent to ${notice.recipient} (${notice.org}) by ${notice.channel === "sms" ? "SMS" : "email"}.`;
    case "wrong-person":
      return `Request ${notice.requestId} was opened by someone who is not ${notice.recipient} (ID Austria name: ${notice.idAustriaName}). Nothing was shown or filed. Check the address.`;
    case "patient-mismatch":
      return `The answer to request ${notice.requestId} is about a different patient. Name and birth date do not match ${notice.patient}. Nothing was filed.`;
    case "held":
      return notice.hold === "identity"
        ? `Request ${notice.requestId} is on hold. ${notice.reason} Accept or reject the person in the widget.`
        : `The answer to request ${notice.requestId} is on hold. ${notice.reason} Accept or reject the answer in the widget.`;
    case "filed": {
      const name = DOCUMENT_TYPES[notice.docType].messageName;
      const text = `${name[0].toUpperCase()}${name.slice(1)} for ${notice.patient} from ${notice.sender} is filed. Identity checked with ID Austria.`;
      return notice.docType === "lab-result" ? `${text} ${valuesText(notice.values)}` : text;
    }
  }
}

function valuesText({ within, outside }: LabValues) {
  const total = within + outside;
  if (total === 1) return `1 value, ${outside === 1 ? "outside" : "within"} the reference range.`;
  return `${total} values, ${outside === 0 ? "all within" : `${outside} outside`} the reference range.`;
}

/**
 * Posts a notice in a room as the bot and returns its event id. Without `threadRoot` the notice starts the request's
 * thread, and the caller stores its event id in `requests.matrix_event`. Later notices pass that id to join the thread.
 */
export async function notifyRoom(roomId: string, notice: Notice, threadRoot?: string): Promise<string> {
  const body = noticeText(notice);
  // The reply fallback points at the root, so clients without threads show each notice as a reply to the request.
  const content = threadRoot
    ? {
        msgtype: "m.notice",
        body,
        "m.relates_to": { rel_type: "m.thread", event_id: threadRoot, is_falling_back: true, "m.in_reply_to": { event_id: threadRoot } },
      }
    : { msgtype: "m.notice", body };
  const client = await getBotClient();
  const { event_id } = await client.sendEvent(roomId, "m.room.message", content);
  return event_id;
}
