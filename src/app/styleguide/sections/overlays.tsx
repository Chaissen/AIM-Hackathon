import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Kbd } from "@/components/ui/kbd";
import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator, MenubarTrigger } from "@/components/ui/menubar";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { Block } from "./block";

export function OverlaysSection() {
  return (
    <>
      <Block title="Overlays">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancel this request?</DialogTitle>
              <DialogDescription>The link stops working at once.</DialogDescription>
            </DialogHeader>
            <DialogFooter showCloseButton>
              <Button>Cancel request</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline">Alert dialog</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reject the answer?</AlertDialogTitle>
              <AlertDialogDescription>The upload is deleted.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep</AlertDialogCancel>
              <AlertDialogAction>Reject</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">Sheet</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Request 12</SheetTitle>
              <SheetDescription>Details in a side sheet.</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="outline">Drawer</Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Request 12</DrawerTitle>
              <DrawerDescription>Details in a bottom drawer.</DrawerDescription>
            </DrawerHeader>
          </DrawerContent>
        </Drawer>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">Popover</Button>
          </PopoverTrigger>
          <PopoverContent>
            <PopoverHeader>
              <PopoverTitle>Link expires</PopoverTitle>
              <PopoverDescription>6 November 2026</PopoverDescription>
            </PopoverHeader>
          </PopoverContent>
        </Popover>
        <HoverCard>
          <HoverCardTrigger asChild>
            <Button variant="link">Hover card</Button>
          </HoverCardTrigger>
          <HoverCardContent>Dr. Lena Hofer, Klinikum Beispielstadt.</HoverCardContent>
        </HoverCard>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline">Tooltip</Button>
          </TooltipTrigger>
          <TooltipContent>
            Sent encrypted <Kbd>⌘</Kbd>
          </TooltipContent>
        </Tooltip>
        <Button variant="outline" onClick={() => toast("Request 12 sent", { description: "The link is valid for seven days." })}>
          Toast
        </Button>
        <Toaster />
      </Block>

      <Block title="Menus">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">Dropdown menu</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Request 12</DropdownMenuLabel>
            <DropdownMenuItem>Accept</DropdownMenuItem>
            <DropdownMenuItem>Reject</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked>Notify me</DropdownMenuCheckboxItem>
            <DropdownMenuItem variant="destructive">Cancel</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ContextMenu>
          <ContextMenuTrigger className="flex h-9 items-center border border-dashed border-strong px-4 text-sm text-dim">Right click</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Copy link</ContextMenuItem>
            <ContextMenuItem>Open audit log</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <Menubar>
          <MenubarMenu>
            <MenubarTrigger>Requests</MenubarTrigger>
            <MenubarContent>
              <MenubarItem>New request</MenubarItem>
              <MenubarSeparator />
              <MenubarItem>Audit log</MenubarItem>
            </MenubarContent>
          </MenubarMenu>
          <MenubarMenu>
            <MenubarTrigger>Help</MenubarTrigger>
            <MenubarContent>
              <MenubarItem>Documentation</MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuTrigger>Platform</NavigationMenuTrigger>
              <NavigationMenuContent>
                <NavigationMenuLink href="#type">Requests</NavigationMenuLink>
                <NavigationMenuLink href="#type">Audit log</NavigationMenuLink>
              </NavigationMenuContent>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink href="#type">Pricing</NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
        <Command className="h-auto w-72 self-start border border-border">
          <CommandInput placeholder="Search a patient" />
          <CommandList>
            <CommandEmpty>No patient found.</CommandEmpty>
            <CommandGroup heading="Patients">
              <CommandItem>Anna Gruber</CommandItem>
              <CommandItem>Josef Maier</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </Block>
    </>
  );
}
