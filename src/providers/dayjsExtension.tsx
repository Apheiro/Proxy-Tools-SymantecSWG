'use client';
import dayjs from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween';

dayjs.extend(isBetween);
export default function DayjsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
