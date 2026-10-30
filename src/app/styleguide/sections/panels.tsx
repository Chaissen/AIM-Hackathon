import { FileText, Inbox } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import { EventLabel } from "@/app/audit/audit-table";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

import { Block } from "./block";
import { EVENTS } from "./fixtures";

const CHART: ChartConfig = { requests: { label: "Requests", color: "var(--chart-1)" }, filed: { label: "Filed", color: "var(--chart-2)" } };
const CHART_DATA = [
  { month: "Jun", requests: 12, filed: 9 },
  { month: "Jul", requests: 18, filed: 15 },
  { month: "Aug", requests: 9, filed: 8 },
  { month: "Sep", requests: 21, filed: 17 },
  { month: "Oct", requests: 16, filed: 14 },
];

export function PanelsSection() {
  return (
    <>
      <Block title="Lists and feedback" wide>
        <Item variant="outline" className="max-w-xl">
          <ItemMedia variant="icon">
            <FileText />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Lab result</ItemTitle>
            <ItemDescription>Requested from Maria Huber, Labor Kanalstraße.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button size="sm" variant="outline">
              Open
            </Button>
          </ItemActions>
        </Item>
        <Empty className="max-w-xl border border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle>No requests yet</EmptyTitle>
            <EmptyDescription>Send the first request from the widget.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button>Request a document</Button>
          </EmptyContent>
        </Empty>
        <div className="flex flex-wrap items-center gap-4">
          <Spinner />
          <Skeleton className="h-9 w-40" />
          <Progress value={62} className="w-48" />
          <Avatar>
            <AvatarFallback>LH</AvatarFallback>
          </Avatar>
          <Separator orientation="vertical" className="h-6" />
          <Collapsible className="grid gap-2">
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm">
                Collapsible
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="text-sm text-dim">Hidden until opened.</CollapsibleContent>
          </Collapsible>
        </div>
        <ScrollArea className="h-24 max-w-xl border border-border p-3 text-sm">
          {EVENTS.map((e) => (
            <p key={e} className="py-1">
              <EventLabel event={e} />
            </p>
          ))}
        </ScrollArea>
      </Block>

      <Block title="Layout" wide>
        <ResizablePanelGroup orientation="horizontal" className="max-w-xl border border-border">
          <ResizablePanel defaultSize={50} className="p-4 text-sm">
            Requests
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={50} className="p-4 text-sm">
            Audit log
          </ResizablePanel>
        </ResizablePanelGroup>
        <div className="w-64">
          <AspectRatio ratio={16 / 9}>
            <div className="hatch size-full border border-border" />
          </AspectRatio>
        </div>
        <div className="w-full max-w-xs px-12">
          <Carousel>
            <CarouselContent>
              {[1, 2, 3].map((n) => (
                <CarouselItem key={n}>
                  <div className="flex h-32 items-center justify-center border border-border text-2xl font-heading font-bold">{n}</div>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious />
            <CarouselNext />
          </Carousel>
        </div>
        <Calendar mode="single" className="border border-border" />
        <ChartContainer config={CHART} className="h-48 w-full max-w-xl">
          <BarChart data={CHART_DATA}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="requests" fill="var(--color-requests)" />
            <Bar dataKey="filed" fill="var(--color-filed)" />
          </BarChart>
        </ChartContainer>
      </Block>
    </>
  );
}
