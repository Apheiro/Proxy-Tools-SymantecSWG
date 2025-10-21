import { useAutoAnimate } from '@formkit/auto-animate/react';
import dayjs from 'dayjs';
import { Filter } from 'lucide-react';
import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function isEmpty(obj: object) {
  let isEmpty = true;
  for (const key in obj) {
    if (obj[key] !== '' && obj[key] !== null) {
      isEmpty = false;
      break;
    }
  }
  return isEmpty;
}

function createFilterObj(
  e: FormEvent<HTMLFormElement>,
): Filters | null {
  e.preventDefault();
  const formData = Object.fromEntries(new FormData(e.currentTarget));
  if (isEmpty(formData)) return null;
  console.log('is not empty');
  let filter: Filters = {};
  if (formData.timePickerStart && formData.timePickerEnd) {
    const [hourStart, minuteStart, secondStart] = (
      formData.timePickerStart as string
    )
      .split(':')
      .map(Number);
    const [hourEnd, minuteEnd, secondEnd] = (
      formData.timePickerEnd as string
    )
      .split(':')
      .map(Number);

    filter = {
      start: dayjs()
        .hour(hourStart)
        .minute(minuteStart)
        .second(secondStart)
        .format('YYYY-MM-DD HH:mm:ss'),
      end: dayjs()
        .hour(hourEnd)
        .minute(minuteEnd)
        .second(secondEnd)
        .format('YYYY-MM-DD HH:mm:ss'),
    };
  }
  console.log(formData.status);
  if (formData.status !== '') {
    filter.status = formData.status as string;
  }
  return filter;
}

export default function FilterBar({
  setFilter,
  searchBy,
  setSearchBy,
  setSearchFilter,
  searchFilter,
}: {
  setFilter: Dispatch<SetStateAction<Filters>>;
  setSearchFilter: Dispatch<SetStateAction<string>>;
  searchBy: string;
  setSearchBy: Dispatch<SetStateAction<string>>;
  searchFilter: string;
}) {
  const [show, setShow] = useState(false);
  const selectInputRef = useRef<HTMLInputElement>(null);
  const [parent] = useAutoAnimate({
    duration: 200,
  });

  return (
    <div
      className='flex justify-center flex-col items-center gap-3 w-full'
      ref={parent}
    >
      <div className='flex justify-center items-center gap-3 w-full'>
        <Input
          type='search'
          placeholder='Search'
          className='max-w-70'
          onChange={(e) => {
            setSearchFilter(e.target.value);
          }}
          value={searchFilter}
        />
        <Select onValueChange={setSearchBy}>
          <SelectTrigger className='w-fit'>
            <SelectValue placeholder='By: URL ' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='url'>Url</SelectItem>
            <SelectItem value='transaction'>
              Transaction ID
            </SelectItem>
            <SelectItem value='user'>User</SelectItem>
            <SelectItem value='ip'>Ip</SelectItem>
          </SelectContent>
        </Select>

        <Button
          onClick={() => setShow(!show)}
          variant={show ? 'default' : 'outline'}
        >
          <Filter />
        </Button>
      </div>
      {show && (
        <form
          onSubmit={(e) => {
            const filter = createFilterObj(e);
            console.log(filter);
            if (filter) setFilter(filter);
          }}
          className='flex justify-center items-center gap-3 w-full'
        >
          <input type='hidden' ref={selectInputRef} name='status' />
          <Select
            onValueChange={(v) => {
              if (selectInputRef.current)
                selectInputRef.current.value = v;
            }}
          >
            <SelectTrigger className='w-fit' name='status'>
              <SelectValue placeholder='Status' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All</SelectItem>
              <SelectItem value='allowed'>Allow</SelectItem>
              <SelectItem value='denied'>Denied</SelectItem>
              <SelectItem value='exception'>Exception</SelectItem>
              <SelectItem value='unreached'>Unreachable</SelectItem>
              <SelectItem value='unknown'>Unknown</SelectItem>
            </SelectContent>
          </Select>
          <div className='flex items-center gap-2'>
            <Input
              type='time'
              name='timePickerStart'
              step='1'
              className='w-fit appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none'
            />
            -
            <Input
              type='time'
              name='timePickerEnd'
              step='1'
              className='w-fit appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none'
            />
          </div>
          <Button variant='outline' type='submit'>
            Apply filter
          </Button>
        </form>
      )}
    </div>
  );
}
