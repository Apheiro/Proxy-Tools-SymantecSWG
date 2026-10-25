'use client';
import { Component, createRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ScrollArea } from '@/components/ui/scroll-area';

type Props = { route: string; children: ReactNode };
/** Capture before React replaces the old route DOM, not after its height collapses. */
class RememberedScrollArea extends Component<Props> {
  private viewport = createRef<HTMLDivElement>();
  private positions = new Map<string, number>();
  private observer: ResizeObserver | null = null;
  private frame = 0;
  private restoring = true;
  private target = 0;

  getSnapshotBeforeUpdate(previous: Props) {
    if (previous.route !== this.props.route && !this.restoring) {
      this.positions.set(
        previous.route,
        this.viewport.current?.scrollTop ?? 0,
      );
    }
    return null;
  }
  componentDidMount() {
    const viewport = this.viewport.current;
    if (!viewport) return;
    this.observer = new ResizeObserver(this.applyTarget);
    this.observer.observe(viewport);
    if (viewport.firstElementChild)
      this.observer.observe(viewport.firstElementChild);
    this.beginRestore();
  }
  componentDidUpdate(previous: Props) {
    if (previous.route !== this.props.route) this.beginRestore();
  }
  componentWillUnmount() {
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
  }
  private beginRestore = () => {
    cancelAnimationFrame(this.frame);
    this.target = this.positions.get(this.props.route) ?? 0;
    this.restoring = true;
    this.applyTarget();
  };
  private applyTarget = () => {
    const viewport = this.viewport.current;
    if (!viewport || !this.restoring) return;
    cancelAnimationFrame(this.frame);
    const maximum = Math.max(
      0,
      viewport.scrollHeight - viewport.clientHeight,
    );
    viewport.scrollTop = Math.min(this.target, maximum);
    // Wait for asynchronously restored content instead of overwriting its saved position.
    if (maximum + 1 < this.target) return;
    this.frame = requestAnimationFrame(() => {
      if (!this.restoring || !this.viewport.current) return;
      this.viewport.current.scrollTop = this.target;
      this.frame = requestAnimationFrame(() => {
        this.restoring = false;
      });
    });
  };
  private remember = () => {
    if (!this.restoring && this.viewport.current)
      this.positions.set(
        this.props.route,
        this.viewport.current.scrollTop,
      );
  };
  private userScroll = () => {
    this.restoring = false;
    cancelAnimationFrame(this.frame);
  };
  render() {
    return (
      <ScrollArea
        className='min-h-0 w-full flex-1'
        viewportRef={this.viewport}
        onPointerDownCapture={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('[data-slot=scroll-area-scrollbar]')
          )
            this.userScroll();
        }}
        viewportProps={{
          style: { overflowAnchor: 'none' },
          onScroll: this.remember,
          onWheelCapture: this.userScroll,
          onTouchMoveCapture: this.userScroll,
          onKeyDownCapture: (event) => {
            if (
              [
                'ArrowUp',
                'ArrowDown',
                'PageUp',
                'PageDown',
                'Home',
                'End',
                ' ',
              ].includes(event.key)
            )
              this.userScroll();
          },
        }}
      >
        {this.props.children}
      </ScrollArea>
    );
  }
}
export default function RouteScrollArea({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <RememberedScrollArea route={pathname}>
      {children}
    </RememberedScrollArea>
  );
}
