import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import Sidebar from './Sidebar';
import type { MobileSidebarDrawerProps } from './MobileSidebarDrawerHost';

export default function MobileSidebarDrawer({ open, onOpenChange, onItemClick }: MobileSidebarDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="p-0 w-[85vw] max-w-[320px] sm:w-[280px] sm:max-w-[280px]" showCloseButton={false}>
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <Sidebar isMobile onItemClick={onItemClick} />
      </SheetContent>
    </Sheet>
  );
}
