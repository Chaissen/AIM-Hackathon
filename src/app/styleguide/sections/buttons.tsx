import { Mail, Settings, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";

import { Block } from "./block";

export function ButtonsSection() {
  return (
    <>
      <Block title="Button">
        <Button>Primary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="link">Link</Button>
        <Button disabled>Disabled</Button>
        <Button size="lg">
          <ShieldCheck /> Large with icon
        </Button>
        <Button size="sm" variant="outline">
          Small
        </Button>
        <Button size="xs" variant="outline">
          Extra small
        </Button>
        <Button size="icon" variant="outline" aria-label="Settings">
          <Settings />
        </Button>
        <ButtonGroup>
          <Button variant="outline">Email</Button>
          <Button variant="outline">SMS</Button>
        </ButtonGroup>
      </Block>

      <Block title="Badge and chips">
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="outline">Outline chip</Badge>
        <Badge variant="success">Answer filed</Badge>
        <Badge variant="warning">Needs your confirmation</Badge>
        <Badge variant="destructive">address_mismatch</Badge>
        <Badge variant="ghost">Ghost</Badge>
        <Badge variant="link">Link</Badge>
        <Badge variant="outline" className="h-9 gap-2 py-1 pr-3 pl-1 text-sm">
          <span className="flex size-7 items-center justify-center rounded-full bg-success/20 text-success">
            <Mail className="size-3.5" />
          </span>
          Hero chip
        </Badge>
      </Block>
    </>
  );
}
