import { FileText } from "lucide-react";

import { EventLabel } from "@/app/audit/audit-table";
import { Attachment, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle } from "@/components/ui/attachment";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bubble, BubbleContent, BubbleGroup } from "@/components/ui/bubble";
import { CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockTitle } from "@/components/ui/code-block";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { Message, MessageAvatar, MessageContent, MessageGroup, MessageHeader } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Spinner } from "@/components/ui/spinner";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";

import { Block } from "./block";
import { EVENTS } from "./fixtures";

export function ConversationSection() {
  return (
    <Block title="Conversation" wide>
      <MessageGroup className="max-w-xl">
        <Message>
          <MessageAvatar>
            <Avatar>
              <AvatarFallback>LH</AvatarFallback>
            </Avatar>
          </MessageAvatar>
          <MessageContent>
            <MessageHeader>Dr. Lena Hofer</MessageHeader>
            <BubbleGroup>
              <Bubble variant="outline">
                <BubbleContent>Could you send the lab result for Anna Gruber?</BubbleContent>
              </Bubble>
            </BubbleGroup>
          </MessageContent>
        </Message>
        <Message align="end">
          <MessageContent>
            <BubbleGroup>
              <Bubble align="end">
                <BubbleContent>Sent. The link is valid for seven days.</BubbleContent>
              </Bubble>
            </BubbleGroup>
          </MessageContent>
        </Message>
      </MessageGroup>
      <Marker variant="separator">
        <MarkerContent>Today</MarkerContent>
      </Marker>
      <Trace>
        <TraceLine status="running">
          <TraceIcon>
            <Spinner />
          </TraceIcon>
          <TraceTitle>Checking the role of the sender with the eHVD</TraceTitle>
        </TraceLine>
        <TraceLine>
          <TraceTitle>Patient check</TraceTitle>
          <TraceDescription>Name and birth date match</TraceDescription>
        </TraceLine>
        <TraceLine status="error">
          <TraceTitle>Address check</TraceTitle>
          <TraceDescription>Domain does not match the organisation</TraceDescription>
        </TraceLine>
      </Trace>
      <div className="flex flex-wrap gap-3">
        <Attachment>
          <AttachmentMedia>
            <FileText />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>lab-result.md</AttachmentTitle>
            <AttachmentDescription>4 KB</AttachmentDescription>
          </AttachmentContent>
        </Attachment>
        <Attachment state="error">
          <AttachmentMedia>
            <FileText />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>scan.pdf</AttachmentTitle>
            <AttachmentDescription>Not a Markdown file</AttachmentDescription>
          </AttachmentContent>
        </Attachment>
      </div>
      <CodeBlock className="max-w-xl border border-border">
        <CodeBlockHeader>
          <CodeBlockTitle>DocumentReference.json</CodeBlockTitle>
        </CodeBlockHeader>
        <CodeBlockContent lineNumbers>{'{\n  "resourceType": "DocumentReference",\n  "status": "current"\n}\n'}</CodeBlockContent>
      </CodeBlock>
      <MessageScrollerProvider>
        <MessageScroller className="h-32 max-w-xl border border-border">
          <MessageScrollerViewport>
            <MessageScrollerContent className="grid gap-2 p-3 text-sm">
              {EVENTS.map((e) => (
                <MessageScrollerItem key={e}>
                  <EventLabel event={e} />
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
      <Combobox items={["Lab result", "Rehab discharge report"]}>
        <ComboboxInput placeholder="Document type" className="w-72" />
        <ComboboxContent>
          <ComboboxList>{(item: string) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}</ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Block>
  );
}
