'use client';

import { useForm } from '@mantine/form';
import { valibotResolver } from 'mantine-form-valibot-resolver';
import { type ReactNode, useId } from 'react';
import * as v from 'valibot';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

export default function RegisterSourceForm({
  title,
  description,
  label,
  placeholder,
  action,
  disabled,
  onSubmit,
  extraField,
  requiredMessage = 'Please enter a valid hostname before proceeding.',
}: {
  title: string;
  description: string;
  label: string;
  placeholder: string;
  action: string;
  disabled: boolean;
  onSubmit: (address: string) => void;
  extraField?: ReactNode;
  requiredMessage?: string;
}) {
  const titleId = useId();
  const addressId = useId();
  const schema = v.object({
    address: v.pipe(v.string(), v.nonEmpty(requiredMessage)),
  });
  const form = useForm({
    validate: valibotResolver(schema),
    initialValues: { address: '' },
  });
  return (
    <section aria-labelledby={titleId}>
      <Card>
        <CardContent className='flex flex-col gap-5 p-5 md:flex-row md:items-center md:justify-between md:p-6'>
          <div className='min-w-0 md:max-w-md'>
            <div className='flex flex-col gap-1'>
              <h2 id={titleId} className='text-lg font-semibold'>
                {title}
              </h2>
              <p className='max-w-lg text-sm text-muted-foreground'>
                {description}
              </p>
            </div>
          </div>
          <form
            onSubmit={form.onSubmit((values) =>
              onSubmit(values.address),
            )}
            className='flex w-full flex-col gap-3 sm:flex-row sm:items-start md:max-w-lg'
          >
            {extraField}
            <FormItem className='min-w-0 flex-1'>
              <FormLabel htmlFor={addressId}>{label}</FormLabel>
              <Input
                id={addressId}
                {...form.getInputProps('address')}
                placeholder={placeholder}
              />
              {form.errors.address && (
                <FormMessage>{form.errors.address}</FormMessage>
              )}
            </FormItem>
            <Button
              type='submit'
              disabled={disabled}
              className='shrink-0 self-end'
            >
              {action}
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
