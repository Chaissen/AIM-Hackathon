import { Bell } from "lucide-react";

import { EventLabel, OutcomeBadge } from "@/app/audit/audit-table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { Block } from "./block";
import { EVENTS } from "./fixtures";

export function DisplaySection() {
  return (
    <>
      <Block title="Alert" wide>
        <Alert className="max-w-xl">
          <Bell />
          <AlertTitle>The request went out</AlertTitle>
          <AlertDescription>The link is valid for seven days.</AlertDescription>
        </Alert>
        <Alert variant="destructive" className="max-w-xl">
          <AlertTitle>The login did not work. Try again.</AlertTitle>
          <AlertDescription>Nothing was shared with you.</AlertDescription>
        </Alert>
      </Block>

      <Block title="Card">
        <Card className="w-80">
          <CardHeader>
            <CardTitle>Request 12</CardTitle>
            <CardDescription>Lab result</CardDescription>
            <CardAction>
              <Badge variant="outline">Sent</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>Maria Huber, Labor Kanalstraße.</CardContent>
          <CardFooter className="gap-3">
            <Button size="sm">Accept</Button>
            <Button size="sm" variant="outline">
              Reject
            </Button>
          </CardFooter>
        </Card>
        <Card size="sm" className="w-64">
          <CardHeader>
            <CardTitle>Small card</CardTitle>
          </CardHeader>
          <CardContent>Dense tool UI.</CardContent>
        </Card>
      </Block>

      <Block title="Accordion" wide>
        <Accordion type="single" collapsible className="max-w-xl">
          <AccordionItem value="a">
            <AccordionTrigger>What is ordy?</AccordionTrigger>
            <AccordionContent>A secure way to request documents from outside the PGK network.</AccordionContent>
          </AccordionItem>
          <AccordionItem value="b">
            <AccordionTrigger>Who can answer a request?</AccordionTrigger>
            <AccordionContent>Only the person it was sent to, after an ID Austria login.</AccordionContent>
          </AccordionItem>
          <AccordionItem value="c">
            <AccordionTrigger>Where does the document go?</AccordionTrigger>
            <AccordionContent>Into the FHIR server, as a DocumentReference.</AccordionContent>
          </AccordionItem>
        </Accordion>
      </Block>

      <Block title="Table" wide>
        <div className="min-w-0 border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time (UTC)</TableHead>
                <TableHead>Request</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {EVENTS.map((event, i) => (
                <TableRow key={event}>
                  <TableCell>2026-10-30 09:1{i}:00</TableCell>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    <EventLabel event={event} />
                  </TableCell>
                  <TableCell>
                    <OutcomeBadge entry={{ event, outcome: event === "misdelivery_caught" ? "address_mismatch" : i % 3 === 2 ? "fail" : "pass" }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Block>

      <Block title="Tabs">
        <Tabs defaultValue="requests" className="w-80">
          <TabsList>
            <TabsTrigger value="requests">Requests</TabsTrigger>
            <TabsTrigger value="audit">Audit log</TabsTrigger>
          </TabsList>
          <TabsContent value="requests">Three open requests.</TabsContent>
          <TabsContent value="audit">Nine entries.</TabsContent>
        </Tabs>
        <Tabs defaultValue="requests" className="w-80">
          <TabsList variant="line">
            <TabsTrigger value="requests">Requests</TabsTrigger>
            <TabsTrigger value="audit">Audit log</TabsTrigger>
          </TabsList>
          <TabsContent value="requests">Line variant.</TabsContent>
          <TabsContent value="audit">Nine entries.</TabsContent>
        </Tabs>
      </Block>
    </>
  );
}
