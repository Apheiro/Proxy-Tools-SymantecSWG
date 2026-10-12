'use client';

import * as React from 'react';
import {
  defaultRangeExtractor,
  useVirtualizer,
} from '@tanstack/react-virtual';
import {
  findSelectMatch,
  nextSelectIndex,
} from '@/lib/selectNavigation';
import * as SelectPrimitive from '@radix-ui/react-select';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

const SELECT_CONTENT_CLASS =
  'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md';
const SELECT_POPPER_CLASS =
  'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1';

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot='select' {...props} />;
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group data-slot='select-group' {...props} />
  );
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return (
    <SelectPrimitive.Value data-slot='select-value' {...props} />
  );
}

type SelectFieldProps = Omit<
  React.ComponentProps<typeof SelectPrimitive.Root>,
  'value' | 'defaultValue'
> &
  Pick<
    React.ComponentProps<typeof SelectPrimitive.Trigger>,
    | 'id'
    | 'className'
    | 'aria-label'
    | 'aria-labelledby'
    | 'aria-describedby'
  > & {
    value?: string | number;
    defaultValue?: string | number;
    placeholder?: React.ReactNode;
    size?: 'sm' | 'default';
  };

// Encode every value so an empty application value remains a selectable option.
const selectValue = (value: string | number) => `value:${value}`;

function SelectField({
  children,
  className,
  id,
  value,
  defaultValue,
  placeholder,
  size,
  onValueChange,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  ...props
}: SelectFieldProps) {
  const [uncontrolledValue, setUncontrolledValue] =
    React.useState(defaultValue);
  const [uncontrolledOpen, setUncontrolledOpen] =
    React.useState(defaultOpen);
  const currentValue =
    value === undefined ? uncontrolledValue : value;
  const open =
    controlledOpen === undefined ? uncontrolledOpen : controlledOpen;
  const options = React.useMemo(
    () => collectSelectOptions(children),
    [children],
  );
  const selectedIndex = options.findIndex(
    (option) => option.value === String(currentValue),
  );
  const virtual = options.length > 40;
  const changeValue = (nextValue: string) => {
    if (value === undefined) setUncontrolledValue(nextValue);
    onValueChange?.(nextValue);
  };
  const handleTypeahead = useSelectTypeahead(
    options,
    selectedIndex,
    (index) => changeValue(options[index].value),
    !open,
  );
  return (
    <Select
      {...props}
      open={open}
      onOpenChange={(nextOpen) => {
        if (controlledOpen === undefined)
          setUncontrolledOpen(nextOpen);
        onOpenChange?.(nextOpen);
      }}
      value={
        currentValue === undefined
          ? undefined
          : selectValue(currentValue)
      }
      onValueChange={(nextValue) =>
        changeValue(nextValue.slice('value:'.length))
      }
    >
      <SelectTrigger
        id={id}
        size={size}
        className={cn('min-w-0 w-auto', className)}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        onKeyDown={virtual ? handleTypeahead : undefined}
      >
        <SelectValue placeholder={placeholder}>
          {options[selectedIndex]?.element.props.children}
        </SelectValue>
      </SelectTrigger>
      {virtual ? (
        open && (
          <VirtualSelectContent
            options={options}
            selectedIndex={selectedIndex}
          />
        )
      ) : (
        <SelectContent>{children}</SelectContent>
      )}
    </Select>
  );
}

type SelectOptionElement = React.ReactElement<
  React.ComponentProps<typeof SelectOption>
>;
type VirtualOption = {
  element: SelectOptionElement;
  value: string;
  text: string;
  disabled?: boolean;
};

function optionText(children: React.ReactNode): string {
  return React.Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number')
        return String(child);
      return React.isValidElement<{ children?: React.ReactNode }>(
        child,
      )
        ? optionText(child.props.children)
        : '';
    })
    .join('');
}

function collectSelectOptions(
  children: React.ReactNode,
): VirtualOption[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement(child)) return [];
    if (child.type === React.Fragment)
      return collectSelectOptions(
        (child.props as { children?: React.ReactNode }).children,
      );
    if (child.type !== SelectOption) return [];
    const element = child as SelectOptionElement;
    return [
      {
        element,
        value: String(element.props.value),
        text:
          element.props.textValue ??
          optionText(element.props.children),
        disabled: element.props.disabled,
      },
    ];
  });
}

function useSelectTypeahead(
  options: VirtualOption[],
  current: number,
  onMatch: (index: number) => void,
  active = true,
) {
  const search = React.useRef({ value: '', time: 0 });
  React.useEffect(() => {
    search.current = { value: '', time: 0 };
  }, [active]);
  return (event: React.KeyboardEvent) => {
    if (
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.key.length !== 1
    )
      return;
    const now = Date.now();
    const previous =
      now - search.current.time < 1000 ? search.current.value : '';
    // Space opens/selects unless it is part of an existing search.
    if (event.key === ' ' && !previous) return;
    event.preventDefault();
    event.stopPropagation();
    search.current = { value: previous + event.key, time: now };
    const match = findSelectMatch(
      options,
      current,
      search.current.value,
    );
    if (match !== -1) onMatch(match);
  };
}

function VirtualSelectContent({
  options,
  selectedIndex,
}: {
  options: VirtualOption[];
  selectedIndex: number;
}) {
  const [viewport, setViewport] =
    React.useState<HTMLDivElement | null>(null);
  const [focusedIndex, setFocusedIndex] = React.useState(() =>
    selectedIndex >= 0 && !options[selectedIndex].disabled
      ? selectedIndex
      : options.findIndex((option) => !option.disabled),
  );
  const nodes = React.useRef(new Map<number, HTMLDivElement>());
  const pendingFocus = React.useRef<number | null>(null);
  const virtualizer = useVirtualizer({
    count: options.length,
    getScrollElement: () => viewport,
    estimateSize: () => 32,
    getItemKey: (index) => options[index].value,
    overscan: 5,
    initialRect: { height: 320, width: 0 },
    initialOffset: Math.max(0, selectedIndex) * 32,
    rangeExtractor: (range) => {
      // Keep focus and the selection mounted when the user scrolls away.
      const indexes = new Set(defaultRangeExtractor(range));
      for (const index of [focusedIndex, selectedIndex]) {
        if (index >= 0 && index < options.length) indexes.add(index);
      }
      return [...indexes].sort((a, b) => a - b);
    },
  });
  const focusOption = (index: number) => {
    if (
      index < 0 ||
      index >= options.length ||
      options[index].disabled
    )
      return;
    pendingFocus.current = index;
    setFocusedIndex(index);
    virtualizer.scrollToIndex(index, { align: 'auto' });
    const node = nodes.current.get(index);
    if (node) {
      node.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  };
  const handleTypeahead = useSelectTypeahead(
    options,
    focusedIndex,
    focusOption,
  );
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot='select-content'
        position='popper'
        className={cn(SELECT_CONTENT_CLASS, SELECT_POPPER_CLASS)}
        onKeyDownCapture={(event) => {
          if (
            ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(
              event.key,
            ) &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey
          ) {
            event.preventDefault();
            event.stopPropagation();
            focusOption(
              nextSelectIndex(
                options,
                focusedIndex,
                event.key as 'ArrowUp' | 'ArrowDown' | 'Home' | 'End',
              ),
            );
          } else handleTypeahead(event);
        }}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          ref={setViewport}
          className='w-full min-w-[var(--radix-select-trigger-width)] min-h-0 p-1 scroll-my-1'
          style={{ height: options.length * 32 + 8 }}
        >
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const option = options[row.index];
              return (
                <div
                  key={row.key}
                  data-index={row.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  {React.cloneElement(option.element, {
                    ref: (node: HTMLDivElement | null) => {
                      if (node) {
                        nodes.current.set(row.index, node);
                        if (pendingFocus.current === row.index) {
                          node.focus({ preventScroll: true });
                          pendingFocus.current = null;
                        }
                      } else nodes.current.delete(row.index);
                    },
                    'aria-posinset': row.index + 1,
                    'aria-setsize': options.length,
                    onFocus: (
                      event: React.FocusEvent<HTMLDivElement>,
                    ) => {
                      setFocusedIndex(row.index);
                      option.element.props.onFocus?.(event);
                    },
                  })}
                </div>
              );
            })}
          </div>
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectOption({
  value,
  ...props
}: Omit<
  React.ComponentProps<typeof SelectPrimitive.Item>,
  'value'
> & { value: string | number }) {
  return <SelectItem {...props} value={selectValue(value)} />;
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: 'sm' | 'default';
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot='select-trigger'
      data-size={size}
      className={cn(
        "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className='size-4 opacity-50' />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot='select-content'
        className={cn(
          SELECT_CONTENT_CLASS,
          position === 'popper' && SELECT_POPPER_CLASS,
          className,
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            'p-1',
            position === 'popper' &&
              'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1',
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot='select-label'
      className={cn(
        'text-muted-foreground px-2 py-1.5 text-xs',
        className,
      )}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot='select-item'
      className={cn(
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <span className='absolute right-2 flex size-3.5 items-center justify-center'>
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className='size-4' />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot='select-separator'
      className={cn(
        'bg-border pointer-events-none -mx-1 my-1 h-px',
        className,
      )}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot='select-scroll-up-button'
      className={cn(
        'flex cursor-default items-center justify-center py-1',
        className,
      )}
      {...props}
    >
      <ChevronUpIcon className='size-4' />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot='select-scroll-down-button'
      className={cn(
        'flex cursor-default items-center justify-center py-1',
        className,
      )}
      {...props}
    >
      <ChevronDownIcon className='size-4' />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectField,
  SelectOption,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
