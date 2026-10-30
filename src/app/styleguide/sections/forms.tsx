import { Bold, Italic, Search, Underline } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { Block } from "./block";

export function FormsSection() {
  return (
    <>
      <Block title="Inputs" wide>
        <div className="grid max-w-md gap-4">
          <div className="grid gap-2">
            <Label htmlFor="sg-input">Patient name</Label>
            <Input id="sg-input" placeholder="As written in the document" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sg-invalid">Invalid</Label>
            <Input id="sg-invalid" aria-invalid defaultValue="not an address" />
            <p className="text-xs text-destructive">Enter an email address.</p>
          </div>
          <Input disabled placeholder="Disabled" />
          <Input type="date" aria-label="Birth date" />
          <Textarea placeholder="Textarea" />
          <NativeSelect className="w-full" aria-label="Patient">
            <NativeSelectOption>Anna Gruber, born 12 March 1984</NativeSelectOption>
            <NativeSelectOption>Josef Maier</NativeSelectOption>
          </NativeSelect>
          <Select>
            <SelectTrigger className="w-full" aria-label="Document type">
              <SelectValue placeholder="Select a document type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lab">Lab result</SelectItem>
              <SelectItem value="rehab">Rehab discharge report</SelectItem>
            </SelectContent>
          </Select>
          <InputGroup>
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput placeholder="Search requests" />
          </InputGroup>
          <InputOTP maxLength={6} aria-label="One-time code">
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </div>
      </Block>

      <Block title="Choices">
        <div className="flex items-center gap-2">
          <Checkbox id="sg-c1" />
          <Label htmlFor="sg-c1">Unchecked</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="sg-c2" defaultChecked />
          <Label htmlFor="sg-c2">Checked</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="sg-c3" disabled />
          <Label htmlFor="sg-c3">Disabled</Label>
        </div>
        <RadioGroup defaultValue="email" className="w-auto">
          <div className="flex items-center gap-2">
            <RadioGroupItem id="sg-r1" value="email" />
            <Label htmlFor="sg-r1">Email</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="sg-r2" value="sms" />
            <Label htmlFor="sg-r2">SMS</Label>
          </div>
        </RadioGroup>
        <div className="flex items-center gap-2">
          <Switch id="sg-s1" />
          <Label htmlFor="sg-s1">Off</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="sg-s2" defaultChecked />
          <Label htmlFor="sg-s2">On</Label>
        </div>
        <Slider defaultValue={[40]} className="w-48" aria-label="Slider" />
        <Toggle aria-label="Bold">
          <Bold />
        </Toggle>
        <ToggleGroup type="multiple" variant="outline" defaultValue={["italic"]}>
          <ToggleGroupItem value="bold" aria-label="Bold">
            <Bold />
          </ToggleGroupItem>
          <ToggleGroupItem value="italic" aria-label="Italic">
            <Italic />
          </ToggleGroupItem>
          <ToggleGroupItem value="underline" aria-label="Underline">
            <Underline />
          </ToggleGroupItem>
        </ToggleGroup>
      </Block>

      <Block title="Field" wide>
        <FieldSet className="max-w-md">
          <FieldLegend>Who should send it?</FieldLegend>
          <FieldDescription>Only this person can open the request.</FieldDescription>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="sg-f1">First name</FieldLabel>
              <Input id="sg-f1" />
            </Field>
            <Field data-invalid>
              <FieldLabel htmlFor="sg-f2">Organisation</FieldLabel>
              <Input id="sg-f2" aria-invalid />
              <FieldError>Enter the organisation.</FieldError>
            </Field>
          </FieldGroup>
        </FieldSet>
      </Block>
    </>
  );
}
